import { applyRoomUpdate, roomPollDelay, type RoomUpdate } from './room-sync';
import type { RoomSnapshot, RoomAction } from './room-engine';
import type { PuzzleTable } from './puzzle-table';
import { retryDelay } from './request-backoff';
import { successfulDrop,successfulRemoteConnection } from './connection-feedback';
export type RoomTicket = { token: string; playerId: string; room: RoomSnapshot };
type Position = { dx: number; dy: number };
type DragTask = {
  id: number; seq: number; granted: boolean; canceled: boolean; lastMoveAt: number;
  latest: Position | null; ending: ({ type: 'drop' } & Position) | { type: 'release' } | null;
  wake: (() => void) | null; finished: Promise<void>; finish: () => void;
  grant: (ok: boolean) => void;
};

export class RoomClient {
  ticket: RoomTicket; snapshot: RoomSnapshot; state;
  connected = true; message = '房间已连接';
  private table: PuzzleTable | null = null;
  private stopped = false;
  private listeners = new Set<() => void>();
  private revision = -1;
  private toolbarKey = '';
  private ownersKey = '';
  private pollTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatAt = 0;
  private failures = 0;
  private idlePolls = 0;
  private retryAt = 0;
  private receivedAt = Date.now();
  private drags = new Map<number, DragTask>();
  private active: DragTask | null = null;
  private previousDrag: Promise<void> = Promise.resolve();
  private organizing = false;

  constructor(ticket: RoomTicket) {
    this.ticket = ticket; this.snapshot = ticket.room;
    this.state = structuredClone(ticket.room.puzzle);
  }
  subscribe(fn: () => void) { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; }
  elapsedNow(now = Date.now()) {
    const s = this.snapshot;
    if (s.completedAt != null || s.startedAt === null) return s.puzzle.elapsed;
    const start = s.startedAt ?? s.serverTime - s.puzzle.elapsed * 1000;
    return Math.floor(Math.max(0, s.serverTime + Math.max(0, now - this.receivedAt) - start) / 1000);
  }
  private emit() {
    // Presence timestamps and piece positions do not change the toolbar.
    const key = JSON.stringify([this.connected, this.message, this.snapshot.title, this.snapshot.acceptingNew, this.snapshot.completedAt, this.snapshot.achievementDays, this.snapshot.members.map(({ id, name, color }) => [id, name, color])]);
    if (key === this.toolbarKey) return;
    this.toolbarKey = key;
    for (const fn of this.listeners) fn();
  }
  private async request(action?: RoomAction) {
    if (Date.now() < this.retryAt) { const error=Object.assign(new Error('服务器繁忙，正在等待重试'),{status:503}); throw error; }
    const response = await fetch(`/api/rooms/${this.ticket.room.id}?since=${this.snapshot.revision}`, {
      method: action ? 'POST' : 'GET',
      headers: { Authorization: `Bearer ${this.ticket.token}`, ...(action ? { 'Content-Type': 'application/json' } : {}) },
      body: action ? JSON.stringify(action) : undefined, cache: 'no-store', signal: AbortSignal.timeout(6500),
    });
    const data = await response.json().catch(()=>({error:'连接暂时中断'})) as RoomUpdate & { error?: string };
    if (!response.ok) { if(response.status===429||response.status===503)this.retryAt=Date.now()+retryDelay(response.headers.get('Retry-After'));const error = new Error(data.error || '连接暂时中断') as Error & { status: number }; error.status = response.status; throw error; }
    const merged = applyRoomUpdate(this.snapshot, data);
    if (merged) return merged;
    const recovery = await fetch(`/api/rooms/${this.ticket.room.id}`, { headers: { Authorization: `Bearer ${this.ticket.token}` }, cache: 'no-store', signal: AbortSignal.timeout(6500) });
    const full = await recovery.json() as RoomSnapshot & { error?: string };
    if (!recovery.ok) throw new Error(full.error || '连接暂时中断');
    return full;
  }
  private receive(s: RoomSnapshot, force = false, soundRemote = true) {
    if (this.stopped || s.revision < this.revision || (s.revision === this.revision && s.serverTime < this.snapshot.serverTime)) return;
    const showFeedback=this.connected&&this.revision>=0;
    const beforeGroups=this.snapshot.puzzle.groups;
    const changed = s.puzzle.groups !== beforeGroups;
    const elapsedChanged = s.puzzle.elapsed !== this.state.elapsed;
    this.revision = s.revision; this.snapshot = s; this.receivedAt = Date.now();
    this.connected = true; this.failures = 0; this.message = '房间已连接';
    for (const task of this.drags.values()) {
      // An unconfirmed local drag is deliberately protected from older poll results.
      if (task.granted && !task.ending && s.leases[task.id]?.playerId !== this.ticket.playerId) {
        task.canceled = true; task.wake?.();
        if (this.active === task) this.active = null;
        this.table?.cancelNetworkDrag(task.id);
      }
    }
    const owners: Record<string, { name: string; color: string }> = {};
    for (const [id, lease] of Object.entries(s.leases)) if (lease.playerId !== this.ticket.playerId) {
      const member = s.members.find(p => p.id === lease.playerId);
      owners[id] = { name: member?.name || '朋友', color: member?.color || '#99caf4' };
    }
    const ownersKey = JSON.stringify(owners);
    if (this.table) {
      this.table.networkReady = true;
      if (changed || force || ownersKey !== this.ownersKey) {
        const protectedIds=new Set([...this.drags.values()].filter(t => !t.canceled).map(t => t.id));
        const teammateConnected=showFeedback&&soundRemote&&successfulRemoteConnection(beforeGroups,s.puzzle,protectedIds);
        this.table.syncRemote(s.puzzle, owners, protectedIds,showFeedback);
        if(teammateConnected)this.table.playConnectionSound('teammate');
      } else if (elapsedChanged) { this.state.elapsed = s.puzzle.elapsed; }
    } else { this.state.groups = structuredClone(s.puzzle.groups); this.state.elapsed = s.puzzle.elapsed; }
    this.ownersKey = ownersKey;
    this.emit();
  }
  private fail(error: unknown) {
    if (this.stopped) return;
    const status = (error as { status?: number })?.status;
    this.message = error instanceof Error ? error.message : '连接中断，正在重连';
    if (status !== 409 && status !== 400) {
      this.connected = false; this.failures++;
      for (const task of this.drags.values()) { task.canceled = true; task.grant(false); task.wake?.(); }
      this.active = null;
      if (this.table) { this.table.networkReady = false; this.table.cancelNetworkDrag(); }
    }
    this.emit();
  }
  attach(table: PuzzleTable) {
    this.table = table; this.stopped = false;
    table.network = {
      // A group whose drop is still being confirmed can be picked up again: the piece is back
      // on the table, and waiting for the confirmation is what made a quick second drag feel
      // blocked. Only a group that is being moved right now is refused.
      canAcquire: id => this.connected && !this.organizing && this.active === null && this.drags.size < 8 && !this.moving(id),
      acquire: id => this.acquire(id), move: (id, dx, dy) => this.move(id, dx, dy),
      drop: (id, dx, dy) => this.drop(id, dx, dy), release: id => this.release(id),
    };
    this.receive(this.snapshot, true); void this.poll();
    return () => { this.stop(); this.table = null; };
  }
  private async poll() {
    if (this.stopped) return;
    try {
      const now = Date.now(); let data: RoomSnapshot;
      if (now - this.heartbeatAt > 5000) {
        this.heartbeatAt = now;
        const holding = [...this.drags.values()].find(t => t.granted && !t.canceled && !t.ending);
        // Heartbeats never wait in the movement queue.
        data = await this.request({ type: 'heartbeat', ...(holding ? { groupId: holding.id } : {}) });
      } else data = await this.request();
      this.idlePolls = data.puzzle.groups === this.snapshot.puzzle.groups ? this.idlePolls + 1 : 0;
      this.receive(data);
    } catch (error) { this.fail(error); }
    finally { if (!this.stopped) this.pollTimer = setTimeout(() => void this.poll(), Math.max(this.retryAt-Date.now(),this.connected ? roomPollDelay(this.drags.size > 0 || Object.keys(this.snapshot.leases).length > 0, this.idlePolls, typeof document !== 'undefined' && document.hidden) : Math.min(4000, 800 * this.failures))); }
  }
  // Keep a group reserved until its drop/release request is acknowledged. A
  // second drag of the same group during that window can otherwise be replaced
  // by the older server response and visibly flash back to the previous offset.
  // A drop stays in the map until the server acknowledges it so an older
  // snapshot cannot overwrite the local position. It must not, however, make
  // the same group feel stuck when the player immediately picks it up again.
  // The new drag replaces the ending task and waits for its request chain to
  // finish before claiming the group, preserving server ordering.
  private moving(id: number) { const task = this.drags.get(id); return !!task && !task.ending; }
  acquire(id: number): Promise<boolean> {
    if (!this.connected || this.organizing || this.active || this.drags.size >= 8 || this.moving(id)) return Promise.resolve(false);
    let grant!: (ok: boolean) => void; let finish!: () => void;
    const granted = new Promise<boolean>(resolve => { grant = resolve; });
    const finished = new Promise<void>(resolve => { finish = resolve; });
    const task: DragTask = { id, seq: 0, granted: false, canceled: false, lastMoveAt: -Infinity, latest: null, ending: null, wake: null, finished, finish, grant };
    // Reserve immediately so incoming snapshots cannot pull the local piece backward.
    this.drags.set(id, task); this.active = task;
    const previous = this.previousDrag; this.previousDrag = finished;
    void this.runDrag(task, previous);
    return granted;
  }
  private async runDrag(task: DragTask, previous: Promise<void>) {
    let error: unknown;
    try {
      await previous;
      if (this.stopped || task.canceled || task.ending?.type === 'release') { task.grant(false); return; }
      const claimed = await this.request({ type: 'claim', groupId: task.id });
      task.granted = true;
      if (this.stopped || task.canceled) { task.grant(false); return; }
      this.receive(claimed); task.grant(!task.canceled);
      while (!this.stopped && !task.canceled) {
        // Drop has priority over unsent movement. At most one movement is in flight.
        if (task.ending) {
          const before=task.ending.type==='drop'?this.snapshot.puzzle.groups.find(g=>g.id===task.id):undefined;
          const result = await this.request(task.ending.type === 'drop'
            ? { type: 'drop', groupId: task.id, dx: task.ending.dx, dy: task.ending.dy, seq: ++task.seq }
            : { type: 'release', groupId: task.id });
          // A newer drag of this group may have taken the reservation over; leave it in place.
          if (this.drags.get(task.id) === task) this.drags.delete(task.id);
          this.receive(result, true, false);
          // A polling response may arrive before this acknowledgement. Sound still
          // belongs to this successful local drop, never to general room updates.
          if(!this.stopped&&successfulDrop(before,result.puzzle,task.id)){
            this.table?.playConnectionSound?.('local');
            if(typeof window!=='undefined')window.dispatchEvent(new CustomEvent('puzzle:successful-drop',{detail:{roomId:this.ticket.room.id}}));
          }
          return;
        }
        if (task.latest) {
          const delay = 60 - (performance.now() - task.lastMoveAt);
          if (delay > 0) { await this.waitForMove(task, delay); continue; }
          const latest = task.latest; task.latest = null;
          task.lastMoveAt = performance.now();
          const result = await this.request({ type: 'move', groupId: task.id, ...latest, seq: ++task.seq });
          this.receive(result);
          continue;
        }
        await this.waitForMove(task);
      }
    } catch (failure) { error = failure; task.grant(false); }
    finally {
      task.grant(false);
      // A newer drag of the same group replaces this one in the map and owns the group now.
      const superseded = this.drags.has(task.id) && this.drags.get(task.id) !== task;
      if (this.drags.get(task.id) === task) this.drags.delete(task.id);
      if (this.active === task) this.active = null;
      // A refusal belongs to the drag it was sent for: it never cancels the newer one, which
      // hears about it through its own claim.
      if (error) { if (!superseded) this.table?.cancelNetworkDrag(task.id); this.fail(error); }
      // Reconcile denied/expired claims, including other players' authoritative offsets.
      if (!this.stopped) {
        if (error) { try { this.receive(await this.request(), true); } catch (failure) { this.fail(failure); } }
        else this.receive(this.snapshot, true);
      }
      task.finish();
    }
  }
  private waitForMove(task: DragTask, delay?: number) {
    return new Promise<void>(resolve => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      task.wake = () => { clearTimeout(timer); task.wake = null; resolve(); };
      if (delay !== undefined) timer = setTimeout(task.wake, delay);
    });
  }
  private move(id: number, dx: number, dy: number) {
    const task = this.drags.get(id);
    if (!task || task.canceled || task.ending || !this.connected) return;
    task.latest = { dx, dy }; task.wake?.();
  }
  private drop(id: number, dx: number, dy: number) {
    const task = this.drags.get(id); if (!task) return Promise.resolve();
    task.latest = null; task.ending = { type: 'drop', dx, dy };
    if (this.active === task) this.active = null;
    task.wake?.(); return task.finished;
  }
  private release(id: number) {
    const task = this.drags.get(id); if (!task) return;
    task.latest = null; task.ending = { type: 'release' };
    if (this.active === task) this.active = null;
    task.wake?.();
  }
  private stop() {
    this.stopped = true;
    if (this.pollTimer) clearTimeout(this.pollTimer);
    for (const task of this.drags.values()) { task.canceled = true; task.grant(false); task.wake?.(); }
    this.active = null; this.table?.cancelNetworkDrag();
  }
  async organize() {
    if(this.organizing)throw new Error('正在整理，请稍候。');
    const pending=[...this.drags.values()];
    if(pending.some(task=>!task.ending&&!task.canceled))throw new Error('请先放下当前拼块');
    this.organizing=true;
    try{
      // Pointer-up may still be saving its drop. Finish it before rearranging.
      await Promise.all(pending.map(task=>task.finished));
      if(!this.connected||this.stopped)throw new Error('正在重连，请连接恢复后再整理。');
      const snapshot=await this.request({type:'shuffle'});this.receive(snapshot,true);
      if(this.snapshot.visibility==='solo')this.table?.fit();
    }finally{this.organizing=false;}
  }
  leave() {
    this.stop();
    void fetch(`/api/rooms/${this.ticket.room.id}`, { method: 'POST', keepalive: true,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.ticket.token}` }, body: JSON.stringify({ type: 'leave' }),
    }).catch(() => {});
  }
}
export function roomSessionKey(id: string) { return `together-puzzle:room:${id}`; }
export function saveTicket(ticket: RoomTicket) { const value=JSON.stringify({ token: ticket.token, playerId: ticket.playerId });try { sessionStorage.setItem(roomSessionKey(ticket.room.id),value); } catch {}if(ticket.room.visibility){try{localStorage.setItem(roomSessionKey(ticket.room.id)+':account',value);}catch{}} }
