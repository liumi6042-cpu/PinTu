import type { RoomSnapshot, RoomAction } from './room-engine';
import type { PuzzleTable } from './puzzle-table';
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
  private drags = new Map<number, DragTask>();
  private active: DragTask | null = null;
  private previousDrag: Promise<void> = Promise.resolve();

  constructor(ticket: RoomTicket) {
    this.ticket = ticket; this.snapshot = ticket.room;
    this.state = structuredClone(ticket.room.puzzle);
  }
  subscribe(fn: () => void) { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; }
  private emit() {
    // Presence timestamps and piece positions do not change the toolbar.
    const key = JSON.stringify([this.connected, this.message, this.snapshot.members.map(({ id, name, color }) => [id, name, color])]);
    if (key === this.toolbarKey) return;
    this.toolbarKey = key;
    for (const fn of this.listeners) fn();
  }
  private async request(action?: RoomAction) {
    const response = await fetch(`/api/rooms/${this.ticket.room.id}`, {
      method: action ? 'POST' : 'GET',
      headers: { Authorization: `Bearer ${this.ticket.token}`, ...(action ? { 'Content-Type': 'application/json' } : {}) },
      body: action ? JSON.stringify(action) : undefined, cache: 'no-store', signal: AbortSignal.timeout(6500),
    });
    const data = await response.json() as RoomSnapshot & { error?: string };
    if (!response.ok) { const error = new Error(data.error || '连接暂时中断') as Error & { status: number }; error.status = response.status; throw error; }
    return data;
  }
  private receive(s: RoomSnapshot, force = false) {
    if (this.stopped || s.revision < this.revision || (s.revision === this.revision && s.serverTime < this.snapshot.serverTime)) return;
    const changed = s.revision !== this.revision;
    const elapsedChanged = s.puzzle.elapsed !== this.state.elapsed;
    this.revision = s.revision; this.snapshot = s;
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
      if (changed || elapsedChanged || force || ownersKey !== this.ownersKey) {
        this.table.syncRemote(s.puzzle, owners, new Set([...this.drags.values()].filter(t => !t.canceled).map(t => t.id)));
      }
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
      canAcquire: id => this.connected && this.active === null && !this.drags.has(id) && this.drags.size < 8,
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
      this.receive(data);
    } catch (error) { this.fail(error); }
    finally { if (!this.stopped) this.pollTimer = setTimeout(() => void this.poll(), this.connected ? 300 : Math.min(4000, 800 * this.failures)); }
  }
  acquire(id: number): Promise<boolean> {
    if (!this.connected || this.active || this.drags.has(id) || this.drags.size >= 8) return Promise.resolve(false);
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
          const result = await this.request(task.ending.type === 'drop'
            ? { type: 'drop', groupId: task.id, dx: task.ending.dx, dy: task.ending.dy, seq: ++task.seq }
            : { type: 'release', groupId: task.id });
          this.drags.delete(task.id);
          this.receive(result, true);
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
      if (this.active === task) this.active = null;
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
  leave() {
    this.stop();
    void fetch(`/api/rooms/${this.ticket.room.id}`, { method: 'POST', keepalive: true,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.ticket.token}` }, body: JSON.stringify({ type: 'leave' }),
    }).catch(() => {});
  }
}
export function roomSessionKey(id: string) { return `together-puzzle:room:${id}`; }
export function saveTicket(ticket: RoomTicket) { try { sessionStorage.setItem(roomSessionKey(ticket.room.id), JSON.stringify({ token: ticket.token, playerId: ticket.playerId })); } catch {} }
