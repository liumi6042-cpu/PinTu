import { applyRoomUpdate, roomPollDelay, type RoomUpdate } from './room-sync';
import type { RoomSnapshot, RoomAction } from './room-engine';
import type { PuzzleState } from './puzzle-engine';
import type { PuzzleTable } from './puzzle-table';
import { retryDelay } from './request-backoff';
import { successfulDrop,successfulRemoteConnection } from './connection-feedback';
import { applySoloDrop, replaySoloOps, otherPlayersPresent, acknowledgeSoloOps, loadSoloOutbox, saveSoloOutbox, saveCachedRoom, removeCachedRoom, toWireSoloOp, SOLO_BATCH_MAX, SOLO_MAX_PENDING, type SoloOp, type SoloWireOp, type SoloStorage, type SoloBatchReceipt } from './solo-play';
export type RoomTicket = { token: string; playerId: string; room: RoomSnapshot; cachedOffline?: boolean };
export type RoomClientOptions = { solo?: boolean; storage?: SoloStorage };
type ClientAction = RoomAction | { type: 'batch'; requestId?: string; ops: SoloWireOp[] };
type RoomReplyData = RoomUpdate & { error?: string; code?: string; soloBatch?: SoloBatchReceipt };
type Position = { dx: number; dy: number };
type DragTask = {
  id: number; seq: number; granted: boolean; canceled: boolean; lastMoveAt: number;
  latest: Position | null; ending: ({ type: 'drop' } & Position) | { type: 'release' } | null;
  wake: (() => void) | null; finished: Promise<void>; finish: () => void;
  grant: (ok: boolean) => void;
};
const randomHexId = () => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID().replaceAll('-', '');
  const bytes = new Uint8Array(16);
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') crypto.getRandomValues(bytes);
  else for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
  return Array.from(bytes, n => n.toString(16).padStart(2, '0')).join('');
};

export class RoomClient {
  ticket: RoomTicket; snapshot: RoomSnapshot; state;
  connected = true; message = '房间已连接';
  private table: PuzzleTable | null = null;
  private options: RoomClientOptions;
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
  private localMode = false;
  private disconnectedLocal = false;
  private exiting = false;
  private soloOps: SoloOp[] = [];
  private soloInflight = 0;
  private localPuzzle: PuzzleState | null = null;
  private localDrag: number | null = null;
  private soloDropping = false;
  private soloGroupsKey = '';
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private flushing: Promise<boolean> | null = null;
  private soloFailures = 0;
  private firstUnsentAt: number | null = null;
  private soloRetryAt = 0;
  private exitWake: (() => void) | null = null;
  get localPlay() { return this.localMode; }
  get offlineFallback() { return this.disconnectedLocal; }
  get pendingSoloOps() { return this.soloOps.length; }

  constructor(ticket: RoomTicket, options: RoomClientOptions = {}) {
    this.ticket = ticket; this.snapshot = ticket.room;
    this.options = options;
    this.state = structuredClone(ticket.room.puzzle);
    if (options.solo && options.storage) {
      const box = loadSoloOutbox(options.storage, ticket.room.id);
      if (box) { this.soloOps = box.ops; this.persistSolo(); }
    }
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
    const key = JSON.stringify([this.connected, this.message, this.localMode, this.disconnectedLocal, this.soloOps.length, this.snapshot.title, this.snapshot.acceptingNew, this.snapshot.completedAt, this.snapshot.achievementDays, this.snapshot.members.map(({ id, name, color }) => [id, name, color])]);
    if (key === this.toolbarKey) return;
    this.toolbarKey = key;
    for (const fn of this.listeners) fn();
  }
  private async request(action?: RoomAction) {
    return (await this.requestWithData(action)).snapshot;
  }
  private async requestWithData(action?: ClientAction, init?: { keepalive?: boolean }): Promise<{ snapshot: RoomSnapshot; data: RoomReplyData }> {
    if (Date.now() < this.retryAt) { const error=Object.assign(new Error('服务器繁忙，正在等待重试'),{status:503}); throw error; }
    const response = await fetch(`/api/rooms/${this.ticket.room.id}?since=${this.snapshot.revision}`, {
      method: action ? 'POST' : 'GET',
      headers: { Authorization: `Bearer ${this.ticket.token}`, 'X-Jigsaw-Artwork-Snapshot':'1', ...(action ? { 'Content-Type': 'application/json' } : {}) },
      body: action ? JSON.stringify(action) : undefined, cache: 'no-store', signal: AbortSignal.timeout(6500),
      ...init,
    });
    const data = await response.json().catch(()=>({error:'连接暂时中断'})) as RoomReplyData;
    if (!response.ok) { if(response.status===429||response.status===503)this.retryAt=Date.now()+retryDelay(response.headers.get('Retry-After'));const error = new Error(data.error || '连接暂时中断') as Error & { status: number; code?: string }; error.status = response.status; error.code = data.code; throw error; }
    const merged = applyRoomUpdate(this.snapshot, data);
    if (merged) return { snapshot: merged, data };
    const recovery = await fetch(`/api/rooms/${this.ticket.room.id}`, { headers: { Authorization: `Bearer ${this.ticket.token}`,'X-Jigsaw-Artwork-Snapshot':'1' }, cache: 'no-store', signal: AbortSignal.timeout(6500), ...init });
    const full = await recovery.json() as RoomSnapshot & { error?: string };
    if (!recovery.ok) throw Object.assign(new Error(full.error || '连接暂时中断'), { status: recovery.status });
    return { snapshot: full, data };
  }
  private receive(s: RoomSnapshot, force = false, soundRemote = true) {
    if (this.stopped || s.revision < this.revision || (s.revision === this.revision && s.serverTime < this.snapshot.serverTime)) return;
    const showFeedback=this.connected&&this.revision>=0;
    const beforeGroups=this.snapshot.puzzle.groups;
    const changed = s.puzzle.groups !== beforeGroups;
    const elapsedChanged = s.puzzle.elapsed !== this.state.elapsed;
    const wasDisconnected = this.disconnectedLocal;
    this.revision = s.revision; this.snapshot = s; this.receivedAt = Date.now();
    this.connected = true; this.failures = 0; this.disconnectedLocal = false; this.message = '房间已连接';
    this.persistCachedRoom();
    if (this.localMode) {
      if (wasDisconnected) { this.retryAt = 0; this.soloRetryAt = 0; }
      if (otherPlayersPresent(s, this.ticket.playerId) || !this.options.solo || s.completedAt != null) this.beginExit();
      else if (wasDisconnected && this.soloOps.length) this.scheduleSoloFlush(0);
      if (!this.soloInflight) this.rebaseSoloPuzzle();
      this.emit(); return;
    }
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
    this.maybeEnterLocal();
  }
  private soloTransient(error: unknown) {
    const status = (error as { status?: number })?.status;
    return status === undefined || status === 408 || status === 429 || status >= 500;
  }
  private canEnterDisconnectedLocal() {
    return !this.stopped && this.options.solo === true && !!this.table && this.snapshot.completedAt == null && !this.organizing;
  }
  private enterDisconnectedLocal(message = '网络中断，已切至本地继续拼，恢复后自动同步') {
    this.connected = false; this.failures++;
    for (const task of this.drags.values()) { task.canceled = true; task.grant(false); task.wake?.(); }
    this.drags.clear(); this.active = null;
    this.table?.cancelNetworkDrag();
    this.localMode = true; this.disconnectedLocal = true; this.exiting = false;
    this.ownersKey = '{}';
    this.localPuzzle = replaySoloOps(this.snapshot.puzzle, this.soloOps);
    if (this.table) this.table.networkReady = true;
    this.syncSoloPuzzle(false);
    this.message = message;
    this.emit();
  }
  private fail(error: unknown) {
    if (this.stopped) return;
    const status = (error as { status?: number })?.status;
    if (this.localMode && this.soloTransient(error)) {
      this.failures++;
      if (this.exiting) { this.exiting = false; this.disconnectedLocal = true; this.connected = false; this.message = '网络中断，已切至本地继续拼，恢复后自动同步'; }
      else this.message = this.disconnectedLocal ? '网络中断，已切至本地继续拼，恢复后自动同步' : '网络不稳，拼好的进度会自动保存';
      this.emit(); return;
    }
    if (!this.localMode && this.soloTransient(error) && this.canEnterDisconnectedLocal()) {
      this.enterDisconnectedLocal();
      return;
    }
    if (this.localMode) this.leaveLocalMode();
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
      canAcquire: id => this.localMode ? this.canAcquireLocal(id) : this.connected && !this.organizing && this.active === null && this.drags.size < 8 && !this.moving(id),
      acquire: id => this.acquire(id), move: (id, dx, dy) => this.move(id, dx, dy),
      drop: (id, dx, dy) => this.drop(id, dx, dy), release: id => this.release(id),
    };
    if (this.ticket.cachedOffline === true && this.canEnterDisconnectedLocal()) {
      this.connected = false; this.disconnectedLocal = true; this.localMode = true; this.exiting = false;
      this.localPuzzle = replaySoloOps(this.snapshot.puzzle, this.soloOps);
      this.message = '离线继续拼，联网后自动同步';
      table.networkReady = true;
      this.syncSoloPuzzle(false);
      this.emit();
      if (this.soloOps.length) this.scheduleSoloFlush(0);
      void this.poll();
      return () => { this.stop(); this.table = null; };
    }
    this.receive(this.snapshot, true);
    if (this.soloOps.length && this.options.solo) this.scheduleSoloFlush(0);
    void this.poll();
    return () => { this.stop(); this.table = null; };
  }
  private isDedicatedSolo() {
    return this.options.solo === true && this.snapshot.visibility === 'solo' && !otherPlayersPresent(this.snapshot, this.ticket.playerId);
  }
  private soloHeartbeatMs() {
    return this.localMode && this.isDedicatedSolo() && !this.soloOps.length ? 12000 : 5000;
  }
  private async poll() {
    if (this.stopped) return;
    try {
      const now = Date.now(); let data: RoomSnapshot;
      const heartbeatMs = this.soloHeartbeatMs();
      if (now - this.heartbeatAt > heartbeatMs) {
        this.heartbeatAt = now;
        const holding = [...this.drags.values()].find(t => t.granted && !t.canceled && !t.ending);
        // Heartbeats never wait in the movement queue.
        data = await this.request({ type: 'heartbeat', ...(holding ? { groupId: holding.id } : {}) });
      } else data = await this.request();
      this.idlePolls = data.puzzle.groups === this.snapshot.puzzle.groups ? this.idlePolls + 1 : 0;
      this.receive(data);
    } catch (error) { this.fail(error); }
    finally {
      if (!this.stopped) {
        const heartbeatMs = this.soloHeartbeatMs();
        const delay = this.localMode && (this.failures || this.disconnectedLocal)
          ? Math.min(4000, 800 * Math.max(1, this.failures))
          : this.localMode && this.isDedicatedSolo() && this.connected
            ? Math.max(100, heartbeatMs + 1 - (Date.now() - this.heartbeatAt))
            : this.connected
              ? roomPollDelay(this.drags.size > 0 || Object.keys(this.snapshot.leases).length > 0, this.idlePolls, typeof document !== 'undefined' && document.hidden)
              : Math.min(4000, 800 * this.failures);
        this.pollTimer = setTimeout(() => void this.poll(), Math.max(this.retryAt - Date.now(), delay));
      }
    }
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
    if (this.localMode) { if (!this.canAcquireLocal(id)) return Promise.resolve(false); this.localDrag = id; return Promise.resolve(true); }
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
      const capturedDrop = error && !superseded && !this.stopped && task.ending?.type === 'drop' && this.soloTransient(error) && this.canEnterDisconnectedLocal()
        ? { id: task.id, dx: task.ending.dx, dy: task.ending.dy } : null;
      // A refusal belongs to the drag it was sent for: it never cancels the newer one, which
      // hears about it through its own claim.
      if (error) { if (!superseded) this.table?.cancelNetworkDrag(task.id); this.fail(error); }
      if (capturedDrop && this.localMode && !this.stopped) {
        this.localDrag = capturedDrop.id;
        void this.localDrop(capturedDrop.id, capturedDrop.dx, capturedDrop.dy);
      } else if (!this.stopped) {
        // Reconcile denied/expired claims, including other players' authoritative offsets.
        if (error) { if (!this.disconnectedLocal) { try { this.receive(await this.request(), true); } catch (failure) { this.fail(failure); } } }
        else this.receive(this.snapshot, true);
      }
      task.finish();
      this.maybeEnterLocal();
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
    if (this.localMode) return;
    const task = this.drags.get(id);
    if (!task || task.canceled || task.ending || !this.connected) return;
    task.latest = { dx, dy }; task.wake?.();
  }
  private drop(id: number, dx: number, dy: number) {
    if (this.localMode) return this.localDrop(id, dx, dy);
    const task = this.drags.get(id); if (!task) return Promise.resolve();
    task.latest = null; task.ending = { type: 'drop', dx, dy };
    if (this.active === task) this.active = null;
    task.wake?.(); return task.finished;
  }
  private release(id: number) {
    if (this.localMode) { if (this.localDrag === id) this.localDrag = null; this.exitWake?.(); return; }
    const task = this.drags.get(id); if (!task) return;
    task.latest = null; task.ending = { type: 'release' };
    if (this.active === task) this.active = null;
    task.wake?.();
  }
  private persistCachedRoom() {
    if (!this.options.solo || !this.options.storage) return;
    if (this.snapshot.completedAt != null && !this.soloOps.length) { removeCachedRoom(this.options.storage, this.ticket.room.id); return; }
    saveCachedRoom(this.options.storage, { v: 1, roomId: this.ticket.room.id, playerId: this.ticket.playerId, token: this.ticket.token, snapshot: this.snapshot, savedAt: Date.now() });
  }
  private persistSolo() {
    if (!this.options.storage) return;
    saveSoloOutbox(this.options.storage, { v: 1, roomId: this.ticket.room.id, playerId: this.ticket.playerId, token: this.ticket.token, ops: this.soloOps, savedAt: Date.now() });
  }
  private maybeEnterLocal() {
    if (this.localMode || this.stopped || !this.options.solo || !this.table || !this.connected
      || this.snapshot.completedAt != null || this.drags.size || this.organizing) return;
    const others = otherPlayersPresent(this.snapshot, this.ticket.playerId);
    if (others && !this.soloOps.length) return;
    this.localMode = true; this.localPuzzle = replaySoloOps(this.snapshot.puzzle, this.soloOps);
    this.syncSoloPuzzle(false);
    if (this.soloOps.length) this.scheduleSoloFlush(0);
    if (others) this.beginExit();
    this.emit();
  }
  private canAcquireLocal(id: number) {
    return !this.stopped && !this.exiting && !this.organizing && !this.soloDropping && this.localDrag === null && this.soloOps.length < SOLO_MAX_PENDING
      && !!this.localPuzzle?.groups.some(group => group.id === id && !group.locked);
  }
  private syncSoloPuzzle(feedback: boolean, protect = new Set<number>()) {
    if (!this.localPuzzle) return;
    this.soloGroupsKey = JSON.stringify(this.localPuzzle.groups);
    this.table?.syncRemote(this.localPuzzle, {}, protect, feedback);
  }
  private rebaseSoloPuzzle() {
    if (!this.localMode) return;
    this.localPuzzle = replaySoloOps(this.snapshot.puzzle, this.soloOps);
    if (JSON.stringify(this.localPuzzle.groups) !== this.soloGroupsKey)
      this.syncSoloPuzzle(false, this.localDrag === null ? new Set() : new Set([this.localDrag]));
  }
  private async localDrop(id: number, dx: number, dy: number) {
    if (!this.localPuzzle || this.localDrag !== id) { this.rebaseSoloPuzzle(); return; }
    this.localDrag = null; this.soloDropping = true;
    try {
      const result = applySoloDrop(this.localPuzzle, { groupId: id, dx, dy });
      if (!result.applied) { this.syncSoloPuzzle(false); return; }
      const op: SoloOp = {
        requestId: randomHexId(), groupId: id, dx: result.dx, dy: result.dy, snapped: result.snapped,
        ...(result.snapped && result.pieceId !== undefined ? { pieceId: result.pieceId } : {}),
        ...(result.snapKind ? { snapKind: result.snapKind } : {}),
        ...(result.mergedPieces?.length ? { mergedPieces: result.mergedPieces } : {}),
      };
      const last = this.soloOps[this.soloOps.length - 1];
      if (!op.snapped && this.soloOps.length - 1 >= this.soloInflight && last && !last.snapped && last.groupId === id) this.soloOps[this.soloOps.length - 1] = op;
      else this.soloOps.push(op);
      this.persistSolo(); this.localPuzzle = result.puzzle; this.syncSoloPuzzle(true);
      if (op.snapped) {
        this.table?.playConnectionSound?.('local');
        if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('puzzle:successful-drop', { detail: { roomId: this.ticket.room.id, requestId: op.requestId, groupId: id } }));
      }
      const now = Date.now(); this.firstUnsentAt ??= now;
      const unsent = this.soloOps.length - this.soloInflight;
      const lazy = this.isDedicatedSolo(), debounce = lazy ? 2500 : 800, maxDefer = lazy ? 10000 : 3000;
      this.scheduleSoloFlush(result.completed || unsent >= 25 ? 0 : Math.max(0, Math.min(debounce, maxDefer - (now - this.firstUnsentAt))));
      this.emit();
    } finally { this.soloDropping = false; this.exitWake?.(); }
  }
  private clearSoloTimer() { if (this.flushTimer) clearTimeout(this.flushTimer); this.flushTimer = null; }
  private scheduleSoloFlush(delay: number) {
    this.clearSoloTimer();
    if (this.stopped || !this.soloOps.length) return;
    const wait = Math.max(delay, this.soloRetryAt - Date.now(), this.retryAt - Date.now());
    this.flushTimer = setTimeout(() => { this.flushTimer = null; void this.flushSolo(); }, wait);
  }
  private async flushSolo(opts?: { keepalive?: boolean }): Promise<boolean> {
    if (this.flushing) { if (!await this.flushing) return false; return this.soloOps.length ? this.flushSolo(opts) : true; }
    if (!this.soloOps.length) return true;
    if (Date.now() < Math.max(this.soloRetryAt, this.retryAt)) { this.scheduleSoloFlush(0); return false; }
    this.clearSoloTimer();
    const pending = this.sendSoloBatch(opts); this.flushing = pending;
    try { return await pending; } finally { this.flushing = null; }
  }
  private async sendSoloBatch(opts?: { keepalive?: boolean }): Promise<boolean> {
    const batch = this.soloOps.slice(0, SOLO_BATCH_MAX);
    this.soloInflight = batch.length; this.firstUnsentAt = null;
    try {
      if (Date.now() - this.receivedAt > 15000) this.receive(await this.request({ type: 'heartbeat' }));
      const { snapshot, data } = await this.requestWithData({ type: 'batch', requestId: randomHexId(), ops: batch.map(toWireSoloOp) }, opts);
      if (!data.soloBatch) throw new Error('Missing solo batch receipt');
      const remaining = acknowledgeSoloOps(this.soloOps, data.soloBatch);
      if (remaining.length === this.soloOps.length) throw new Error('Solo batch made no progress');
      this.soloOps = remaining;
      if (!this.stopped) this.persistSolo();
      this.soloFailures = 0; this.soloRetryAt = 0; this.soloInflight = 0;
      this.receive(snapshot, true);
      this.scheduleSoloFlush(0);
      return true;
    } catch (error) {
      this.soloInflight = 0;
      if (this.stopped) return false;
      const status = (error as { status?: number })?.status;
      if (status === 404 || status === 410) {
        this.soloOps = []; this.persistSolo();
        if (this.options.storage) removeCachedRoom(this.options.storage, this.ticket.room.id);
        this.leaveLocalMode(); this.fail(error);
      } else {
        this.soloFailures++; this.soloRetryAt = Math.max(this.retryAt, Date.now() + Math.min(15000, 1000 * 2 ** this.soloFailures));
        if (this.soloTransient(error)) {
          this.message = this.disconnectedLocal ? '网络中断，已切至本地继续拼，恢复后自动同步' : '网络不稳，拼好的进度会自动保存';
          this.emit();
        } else { this.leaveLocalMode(); this.fail(error); }
        this.scheduleSoloFlush(0);
      }
      return false;
    } finally { this.soloInflight = 0; this.exitWake?.(); }
  }
  flushSoloNow() { void this.flushSolo({ keepalive: true }); }
  private leaveLocalMode() {
    this.localMode = false; this.disconnectedLocal = false; this.exiting = false;
    this.localPuzzle = null; this.localDrag = null;
    this.clearSoloTimer(); this.exitWake?.();
  }
  private beginExit() {
    if (this.exiting) return;
    this.exiting = true; this.emit();
    void (async () => {
      while (!this.stopped && this.localMode && this.exiting) {
        if (this.localDrag !== null || this.soloDropping) { await this.waitSoloExit(); continue; }
        if (!this.soloOps.length) break;
        const delay = Math.max(this.soloRetryAt, this.retryAt) - Date.now();
        if (delay > 0) { await this.waitSoloExit(delay); continue; }
        await this.flushSolo();
      }
      if (!this.localMode || !this.exiting || this.stopped) return;
      this.leaveLocalMode(); this.receive(this.snapshot, true);
    })();
  }
  private waitSoloExit(delay?: number) {
    return new Promise<void>(resolve => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      this.exitWake = () => { clearTimeout(timer); this.exitWake = null; resolve(); };
      if (delay !== undefined) timer = setTimeout(this.exitWake, delay);
    });
  }
  private stop() {
    this.stopped = true;
    this.clearSoloTimer(); this.localDrag = null; this.exitWake?.();
    this.leaveLocalMode();
    if (this.pollTimer) clearTimeout(this.pollTimer);
    for (const task of this.drags.values()) { task.canceled = true; task.grant(false); task.wake?.(); }
    this.active = null; this.table?.cancelNetworkDrag();
  }
  async organize() {
    if(this.organizing)throw new Error('正在整理，请稍候。');
    if (this.localDrag !== null || this.soloDropping) throw new Error('请先放下当前拼块');
    const pending=[...this.drags.values()];
    if(pending.some(task=>!task.ending&&!task.canceled))throw new Error('请先放下当前拼块');
    this.organizing=true;
    try{
      while (this.soloOps.length) { if (!await this.flushSolo()) throw new Error('正在保存，请稍候'); }
      // Pointer-up may still be saving its drop. Finish it before rearranging.
      await Promise.all(pending.map(task=>task.finished));
      if(!this.connected||this.stopped)throw new Error('正在重连，请连接恢复后再整理。');
      const snapshot=await this.request({type:'shuffle'});this.receive(snapshot,true);
      if(this.snapshot.visibility==='solo')this.table?.fit();
    }finally{this.organizing=false;this.maybeEnterLocal();}
  }
  leave() {
    this.stop();
    const sendLeave = () => fetch(`/api/rooms/${this.ticket.room.id}`, { method: 'POST', keepalive: true,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.ticket.token}` }, body: JSON.stringify({ type: 'leave' }),
    }).catch(() => {});
    if (!this.soloOps.length) { void sendLeave(); return; }
    void (async () => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      let timedOut = false;
      try {
        await Promise.race([
          (async () => { while (!timedOut && this.soloOps.length && await this.flushSolo({ keepalive: true })) {} })(),
          new Promise<void>(resolve => { timer = setTimeout(() => { timedOut = true; resolve(); }, 3000); }),
        ]);
      } finally { clearTimeout(timer); void sendLeave(); }
    })();
  }
}
export function roomSessionKey(id: string) { return `together-puzzle:room:${id}`; }
export function saveTicket(ticket: RoomTicket) { const value=JSON.stringify({ token: ticket.token, playerId: ticket.playerId });try { sessionStorage.setItem(roomSessionKey(ticket.room.id),value); } catch {}if(ticket.room.visibility){try{localStorage.setItem(roomSessionKey(ticket.room.id)+':account',value);}catch{}} }
