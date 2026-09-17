import { applyRoomUpdate, roomPollDelay, type RoomUpdate } from './room-sync';
import type { RoomSnapshot, RoomAction } from './room-engine';
import type { PuzzleTable } from './puzzle-table';
import { retryDelay } from './request-backoff';
import { successfulDrop } from './connection-feedback';
export type RoomTicket = { token: string; playerId: string; room: RoomSnapshot };
type Position = { dx: number; dy: number };
// How many groups one player may hold at the same time on the server. Must match
// `DRAG_LEASE_GROUPS` in the room engine, and must be at least as large as a full
// multi-piece selection (`MULTI_SELECT_LIMIT` in puzzle-table), because one gesture
// claims its whole selection up front.
const DRAG_LEASE_LIMIT = 12;
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
  // The tasks one gesture is holding. A single-piece drag is a batch of one, which
  // is why the old single-slot field worked for it; a multi-piece selection claims
  // several groups in turn, so the batch has to be a set rather than one slot.
  // `batched` is only false before the first claim of a gesture, and a new gesture
  // may only start once the previous batch has fully drained.
  private active = new Set<DragTask>();
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
  private receive(s: RoomSnapshot, force = false) {
    if (this.stopped || s.revision < this.revision || (s.revision === this.revision && s.serverTime < this.snapshot.serverTime)) return;
    const showFeedback=this.connected&&this.revision>=0;
    const changed = s.puzzle.groups !== this.snapshot.puzzle.groups;
    const elapsedChanged = s.puzzle.elapsed !== this.state.elapsed;
    this.revision = s.revision; this.snapshot = s; this.receivedAt = Date.now();
    this.connected = true; this.failures = 0; this.message = '房间已连接';
    for (const task of this.drags.values()) {
      // An unconfirmed local drag is deliberately protected from older poll results.
      if (task.granted && !task.ending && s.leases[task.id]?.playerId !== this.ticket.playerId) {
        task.canceled = true; task.wake?.();
        this.active.delete(task);
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
        this.table.syncRemote(s.puzzle, owners, new Set([...this.drags.values()].filter(t => !t.canceled).map(t => t.id)),showFeedback);
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
      this.active.clear();
      if (this.table) { this.table.networkReady = false; this.table.cancelNetworkDrag(); }
    }
    this.emit();
  }
  attach(table: PuzzleTable) {
    this.table = table; this.stopped = false;
    table.network = {
      // A gesture may grow its own batch up to the lease ceiling, but a *new*
      // gesture must wait for the previous batch to drain. That keeps one player's
      // movements ordered without refusing the later groups of a multi-selection.
      canAcquire: id => this.connected && !this.organizing && !this.drags.has(id) && this.drags.size < DRAG_LEASE_LIMIT,
      // A selection is claimed in one request. Claiming group by group would race the
      // server's "one gesture at a time" rule and leak a lease on every refusal.
      canAcquireAll: ids => this.connected && !this.organizing
        && ids.every(id => !this.drags.has(id)) && this.drags.size + ids.length <= DRAG_LEASE_LIMIT,
      acquireAll: ids => this.acquireAll(ids),
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
  /**
   * Claims a whole selection with one request. Every id in the batch gets its own
   * DragTask (movement and dropping stay per group), but they share one claim
   * round-trip: either the server leases all of them or it leases none, so a refused
   * gesture can never leave half a selection locked to us.
   */
  acquireAll(ids: number[]): Promise<boolean> {
    const wanted = [...new Set(ids)];
    if (!wanted.length) return Promise.resolve(false);
    if (!this.connected || this.organizing) return Promise.resolve(false);
    if (wanted.some(id => this.drags.has(id))) return Promise.resolve(false);
    if (this.drags.size + wanted.length > DRAG_LEASE_LIMIT) return Promise.resolve(false);
    const tasks: DragTask[] = [];
    for (const id of wanted) {
      let finish!: () => void;
      const finished = new Promise<void>(resolve => { finish = resolve; });
      tasks.push({ id, seq: 0, granted: false, canceled: false, lastMoveAt: -Infinity,
        latest: null, ending: null, wake: null, finished, finish, grant: () => {} });
    }
    // Reserve immediately so incoming snapshots cannot pull the local pieces backward.
    const previous = this.previousDrag;
    for (const task of tasks) { this.drags.set(task.id, task); this.active.add(task); }
    let settle!: (ok: boolean) => void;
    const claimed = new Promise<boolean>(resolve => { settle = resolve; });
    this.previousDrag = this.runBatch(tasks, previous, settle);
    return claimed;
  }
  /**
   * Claims a batch in one request, then runs each task's movement loop in id order so
   * one player's movements stay ordered. A refusal leases nothing, so the reserved
   * batch is released wholesale and no task can dangle.
   */
  private async runBatch(tasks: DragTask[], previous: Promise<void>, settle: (ok: boolean) => void) {
    let leased = false;
    let chain = previous;
    try {
      await previous;
      if (this.stopped || tasks.some(t => t.canceled)) { settle(false); return; }
      const claimed = await this.request({ type: 'claimMany', groupIds: tasks.map(t => t.id) });
      this.receive(claimed);
      if (this.stopped || tasks.some(t => t.canceled)) { settle(false); return; }
      leased = true;
      for (const task of tasks) { task.granted = true; task.grant(true); chain = this.runClaimed(task, chain); }
      settle(true);
    } catch (failure) {
      settle(false);
      for (const task of tasks) task.grant(false);
      this.fail(failure);
      for (const task of tasks) this.table?.cancelNetworkDrag(task.id);
    } finally {
      if (!leased) {
        // Nothing was leased, so forget the reserved batch outright.
        for (const task of tasks) {
          if (this.drags.get(task.id) === task) this.drags.delete(task.id);
          this.active.delete(task);
          task.finish();
        }
      }
    }
  }
  /** The movement loop for a task whose lease is already held. */
  private async runClaimed(task: DragTask, previous: Promise<void>) {
    let error: unknown;
    try {
      await previous;
      if (this.stopped || task.canceled || task.ending?.type === 'release') return;
      while (!this.stopped && !task.canceled) {
        if (task.ending) {
          // Drop has priority over unsent movement. At most one movement is in flight.
          const before = task.ending.type === 'drop' ? this.snapshot.puzzle.groups.find(g => g.id === task.id) : undefined;
          const result = await this.request(task.ending.type === 'drop'
            ? { type: 'drop', groupId: task.id, dx: task.ending.dx, dy: task.ending.dy, seq: ++task.seq }
            : { type: 'release', groupId: task.id });
          this.drags.delete(task.id);
          this.receive(result, true);
          if (!this.stopped && successfulDrop(before, result.puzzle, task.id)) this.table?.playConnectionSound?.();
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
    } catch (failure) { error = failure; }
    finally {
      if (this.drags.get(task.id) === task) this.drags.delete(task.id);
      this.active.delete(task);
      if (error) { this.table?.cancelNetworkDrag(task.id); this.fail(error); }
      task.finish();
    }
  }
  acquire(id: number): Promise<boolean> {
    if (!this.connected || this.organizing || this.drags.has(id) || this.drags.size >= DRAG_LEASE_LIMIT) return Promise.resolve(false);
    let grant!: (ok: boolean) => void; let finish!: () => void;
    const granted = new Promise<boolean>(resolve => { grant = resolve; });
    const finished = new Promise<void>(resolve => { finish = resolve; });
    const task: DragTask = { id, seq: 0, granted: false, canceled: false, lastMoveAt: -Infinity, latest: null, ending: null, wake: null, finished, finish, grant };
    // Reserve immediately so incoming snapshots cannot pull the local piece backward.
    this.drags.set(id, task); this.active.add(task);
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
          this.drags.delete(task.id);
          this.receive(result, true);
          // A polling response may arrive before this acknowledgement. Sound still
          // belongs to this successful local drop, never to general room updates.
          if(!this.stopped&&successfulDrop(before,result.puzzle,task.id))this.table?.playConnectionSound?.();
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
      if (this.drags.get(task.id) === task) this.drags.delete(task.id);
      this.active.delete(task);
      if (error) { this.table?.cancelNetworkDrag(task.id); this.fail(error); }
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
    this.active.delete(task);
    task.wake?.(); return task.finished;
  }
  private release(id: number) {
    const task = this.drags.get(id); if (!task) return;
    task.latest = null; task.ending = { type: 'release' };
    this.active.delete(task);
    task.wake?.();
  }
  private stop() {
    this.stopped = true;
    if (this.pollTimer) clearTimeout(this.pollTimer);
    for (const task of this.drags.values()) { task.canceled = true; task.grant(false); task.wake?.(); }
    this.active.clear(); this.table?.cancelNetworkDrag();
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
