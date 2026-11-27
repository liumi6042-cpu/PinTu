import { applyRoomUpdate, roomPollDelay, type RoomUpdate } from './room-sync';
import type { RoomSnapshot, RoomAction } from './room-engine';
import type { PuzzleTable } from './puzzle-table';
import { retryDelay } from './request-backoff';
import { successfulDrop,successfulRemoteConnection } from './connection-feedback';
import type {RealtimeRoomStream} from './room-realtime';
import {DiagnosticDragPipeline} from './diagnostic-drag-pipeline';
import type {MovePreview} from './room-preview';
import type {PuzzleState} from './puzzle-engine';
import {applySoloDrop,replaySoloOps,otherPlayersPresent,soloCanAfford,loadSoloOutbox,saveSoloOutbox,acknowledgeSoloOps,SOLO_BATCH_MAX,SOLO_MAX_PENDING,type SoloOp,type SoloEnergy,type SoloStorage,type SoloBatchReceipt} from './solo-play';
/** The room protocol does not require a DOM table or browser networking. */
export type RoomTable = Pick<PuzzleTable,'network'|'networkReady'|'syncRemote'|'cancelNetworkDrag'|'playConnectionSound'|'fit'>;
export type RoomFetchReply = {ok:boolean;status:number;headers:{get(name:string):string|null};json():Promise<any>};
export type RoomDecoration={id:string;title:string;artKey:string;color:string;kind?:string};
export type RoomPieceOwner={name:string;color:string;level?:number;decoration?:RoomDecoration|null;playerId?:string};
export type RoomClientDependencies = {
  fetch:(url:string,init?:RequestInit)=>Promise<RoomFetchReply>;
  randomId:()=>string;
  emit:(name:string,detail?:unknown)=>void;
  hidden:()=>boolean;
  now:()=>number;
  performanceNow:()=>number;
  realtime?:RealtimeRoomStream;
  profile?:(data:unknown)=>void;
  refreshProfile?:()=>Promise<unknown>;
  solo?:{enabled():boolean;storage?:SoloStorage;energy():SoloEnergy|null};
  traceTimings?:()=>boolean;
};
const browserDependencies:RoomClientDependencies={
  fetch:(url,init)=>fetch(url,init),
  randomId:()=>Array.from(crypto.getRandomValues(new Uint8Array(16)),n=>n.toString(16).padStart(2,'0')).join(''),
  emit:(name,detail)=>{if(typeof window!=='undefined')window.dispatchEvent(new CustomEvent(name,{detail}));},
  hidden:()=>typeof document!=='undefined'&&document.hidden,
  now:()=>Date.now(),performanceNow:()=>typeof performance!=='undefined'?performance.now():Date.now(),
};
const cloneRoomValue=<T>(value:T):T=>typeof structuredClone==='function'?structuredClone(value):JSON.parse(JSON.stringify(value));
const requestTimeout=()=>typeof AbortSignal!=='undefined'&&typeof AbortSignal.timeout==='function'?AbortSignal.timeout(6500):undefined;
export type RoomTicket = { token: string; playerId: string; room: RoomSnapshot };
type MobileContribution = { requestId: string; groupId: number; creditedXp: number };
type MobileRoomSnapshot = RoomSnapshot & { mobileContribution?: MobileContribution;offline?:boolean;diagnostic?:boolean;diagnosticTiming?:{serverMs:number} };
type ClientAction = RoomAction | {type:'batch';ops:Omit<SoloOp,'snapped'>[]};
type RoomReplyData = RoomUpdate & {error?:string;code?:string;profile?:unknown;mobileProfile?:unknown;mobileContribution?:MobileContribution;soloBatch?:SoloBatchReceipt;diagnosticTiming?:{serverMs:number}};
export type RoomRequestTiming={action:string;ms:number;status:number;serverMs?:number};
type Position = { dx: number; dy: number };
type DragTask = {
  id: number; seq: number; granted: boolean; canceled: boolean; lastMoveAt: number;
  latest: Position | null; ending: ({ type: 'drop' } & Position) | { type: 'release' } | null;
  wake: (() => void) | null; finished: Promise<void>; finish: () => void;
  grant: (ok: boolean) => void;droppedAt?:number;
};
// One gesture may be awaiting confirmation while the next follows the pointer.
// Count tasks, not group IDs: repeatedly picking up one group replaces its map
// entry but must never create an unbounded chain of claim/drop requests.
const MAX_PENDING_DRAGS = 2;

export class RoomClient {
  ticket: RoomTicket; snapshot: RoomSnapshot; state;
  connected = true; message = '房间已连接';
  private table: RoomTable | null = null;
  private deps:RoomClientDependencies;
  private stopped = false;
  private listeners = new Set<() => void>();
  private revision = -1;
  private toolbarKey = '';
  private ownersKey = '';
  private pieceOwners:Record<string,RoomPieceOwner>={};private previewMoves:MovePreview[]=[];
  private pollTimer: ReturnType<typeof setTimeout> | null = null;
  private polling=false;private forcePoll=false;private realtimeCleanups:Array<()=>void>=[];
  private heartbeatAt = 0;
  private failures = 0;
  private idlePolls = 0;
  private retryAt = 0;
  private receivedAt:number;
  private drags = new Map<number, DragTask>();
  private pendingDrags = new Set<DragTask>();
  private active: DragTask | null = null;
  private previousDrag: Promise<void> = Promise.resolve();
  private organizing = false;
  private diagnosticPipeline:DiagnosticDragPipeline|null=null;
  private localMode=false;
  private exiting=false;
  private soloOps:SoloOp[]=[];
  private soloInflight=0;
  private localPuzzle:PuzzleState|null=null;
  private localDrag:number|null=null;
  private soloDropping=false;
  private soloGroupsKey='';
  private flushTimer:ReturnType<typeof setTimeout>|null=null;
  private flushing:Promise<boolean>|null=null;
  private soloFailures=0;
  private firstUnsentAt:number|null=null;
  private soloRetryAt=0;
  private soloRefused=false;
  private rejoinRequired=false;
  private exitWake:(()=>void)|null=null;
  get localPlay(){return this.localMode;}
  get pendingSoloOps(){return this.soloOps.length;}
  get diagnosticActionsActive(){return this.diagnosticPipeline?.inUse===true;}

  constructor(ticket: RoomTicket,dependencies:Partial<RoomClientDependencies>={}) {
    this.deps={...browserDependencies,...dependencies};this.receivedAt=this.deps.now();
    this.ticket = ticket; this.snapshot = ticket.room;
    this.state = cloneRoomValue(ticket.room.puzzle);
    if(this.deps.solo?.storage){
      const box=loadSoloOutbox(this.deps.solo.storage,ticket.room.id);
      if(box){this.soloOps=box.ops;this.persistSolo();}
    }
  }
  subscribe(fn: () => void) { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; }
  elapsedNow(now = this.deps.now()) {
    const s = this.snapshot;
    if (s.completedAt != null || s.startedAt === null) return s.puzzle.elapsed;
    const start = s.startedAt ?? s.serverTime - s.puzzle.elapsed * 1000;
    return Math.floor(Math.max(0, s.serverTime + Math.max(0, now - this.receivedAt) - start) / 1000);
  }
  private emit() {
    // Presence timestamps and piece positions do not change the toolbar.
    const key = JSON.stringify([this.connected, this.message, this.localMode, this.exiting, this.soloOps.length, this.snapshot.title, this.snapshot.acceptingNew, this.snapshot.completedAt, this.snapshot.achievementDays, this.snapshot.members.map(member => [member.id, member.name, member.color, (member as typeof member & {level?:number}).level,(member as typeof member & {decoration?:RoomDecoration|null}).decoration?.id])]);
    if (key === this.toolbarKey) return;
    this.toolbarKey = key;
    for (const fn of this.listeners) fn();
  }
  private async request(action?: RoomAction): Promise<MobileRoomSnapshot> {
    return (await this.requestWithData(action)).snapshot;
  }
  private async requestWithData(action?:ClientAction,init?:{keepalive?:boolean}):Promise<{snapshot:MobileRoomSnapshot;data:RoomReplyData}> {
    if (this.deps.now() < this.retryAt) { const error=Object.assign(new Error('服务器繁忙，正在等待重试'),{status:503}); throw error; }
    const actionWithId = action as (ClientAction & {requestId?:string}) | undefined;
    if (actionWithId && !actionWithId.requestId) actionWithId.requestId = this.deps.randomId();
    const started=this.deps.performanceNow();
    const response = await this.deps.fetch(`/api/rooms/${this.ticket.room.id}?since=${this.snapshot.revision}`, {
      method: action ? 'POST' : 'GET',
      headers: { Authorization: `Bearer ${this.ticket.token}`, ...(action ? { 'Content-Type': 'application/json' } : {}) },
      body: actionWithId ? JSON.stringify(actionWithId) : undefined, cache: 'no-store', signal: requestTimeout(),
      ...init,
    }).catch(error=>{this.trace(action?.type??'poll',started,0);throw error;});
    const data = await response.json().catch(()=>({error:'连接暂时中断'})) as RoomReplyData;
    this.trace(action?.type??'poll',started,response.status,data.diagnosticTiming?.serverMs);
    if (data.profile ?? data.mobileProfile) this.deps.emit('mobile:profile',data.profile ?? data.mobileProfile);
    if (!response.ok) { if(response.status===429||response.status===503)this.retryAt=this.deps.now()+retryDelay(response.headers.get('Retry-After'));const error = new Error(data.error || '连接暂时中断') as Error & { status: number; code?: string }; error.status = response.status; error.code = data.code; throw error; }
    const receipt = data.mobileContribution;
    const contribution = actionWithId?.type === 'drop' && receipt
      && receipt.requestId === actionWithId.requestId && receipt.groupId === actionWithId.groupId
      && Number.isFinite(receipt.creditedXp) && receipt.creditedXp > 0
      ? receipt : undefined;
    const merged = applyRoomUpdate(this.snapshot, data);
    // Preserve the drop receipt even if a poll already received its puzzle state.
    // Clear old receipts on unrelated responses so movement cannot award XP again.
    if (merged) return {snapshot:{ ...merged, mobileContribution: contribution },data};
    const recovery = await this.deps.fetch(`/api/rooms/${this.ticket.room.id}`, { headers: { Authorization: `Bearer ${this.ticket.token}` }, cache: 'no-store', signal: requestTimeout(),...init });
    const full = await recovery.json() as RoomSnapshot & { error?: string; profile?: unknown; mobileProfile?: unknown };
    if (full.profile ?? full.mobileProfile) this.deps.emit('mobile:profile',full.profile ?? full.mobileProfile);
    if (!recovery.ok) throw Object.assign(new Error(full.error || '连接暂时中断'),{status:recovery.status});
    return {snapshot:{ ...full, mobileContribution: contribution },data};
  }
  private trace(action:string,started:number,status=200,serverMs?:number){
    if((this.ticket.room as MobileRoomSnapshot).diagnostic!==true&&this.deps.traceTimings?.()!==true)return;
    this.deps.emit('room:request-timing',{action,ms:Math.max(0,this.deps.performanceNow()-started),status,...(Number.isFinite(serverMs)?{serverMs}:{})} satisfies RoomRequestTiming);
  }
  private receive(s: RoomSnapshot, force = false, soundRemote = true,ownDropId?:number) {
    if (this.stopped || s.revision < this.revision || (s.revision === this.revision && s.serverTime < this.snapshot.serverTime)) return;
    const showFeedback=this.connected&&this.revision>=0;
    const beforeGroups=this.snapshot.puzzle.groups;
    const changed = s.puzzle.groups !== beforeGroups;
    const elapsedChanged = s.puzzle.elapsed !== this.state.elapsed;
    this.revision = s.revision; this.snapshot = s; this.receivedAt = this.deps.now();
    this.deps.realtime?.preview?.observe(s);
    this.diagnosticPipeline?.observe(s);
    this.connected = true; this.failures = 0; this.message = '房间已连接';
    if(this.localMode){
      if(otherPlayersPresent(s,this.ticket.playerId)||this.deps.solo?.enabled()!==true||(s as MobileRoomSnapshot).diagnostic===true||s.completedAt!=null)this.beginExit();
      if(!this.soloInflight)this.rebaseSoloPuzzle();
      this.emit();return;
    }
    for (const task of this.drags.values()) {
      // An unconfirmed local drag is deliberately protected from older poll results.
      // Offline rooms have one local player and deliberately never issue leases.
      if (task.granted && !task.ending && (s as MobileRoomSnapshot).offline !== true && s.leases[task.id]?.playerId !== this.ticket.playerId) {
        task.canceled = true; task.wake?.();
        if (this.active === task) this.active = null;
        this.table?.cancelNetworkDrag(task.id);
      }
    }
    const owners: Record<string,RoomPieceOwner> = {};
    for (const [id, lease] of Object.entries(s.leases)) if (lease.playerId !== this.ticket.playerId) {
      const member = s.members.find(p => p.id === lease.playerId);
      owners[id] = { playerId: lease.playerId, name: member?.name || '朋友', color: member?.color || '#99caf4',level:(member as typeof member & {level?:number})?.level,decoration:(member as typeof member & {decoration?:RoomDecoration|null})?.decoration??null };
    }
    const ownersKey = JSON.stringify(owners);
    this.pieceOwners=owners;
    if (this.table) {
      this.table.networkReady = true;
      if (changed || force || ownersKey !== this.ownersKey) {
        const protectedIds=new Set([...this.drags.values()].filter(t => !t.canceled).map(t => t.id));
        for(const id of this.diagnosticPipeline?.protectedIds()??[])protectedIds.add(id);
        const silentIds=new Set(protectedIds);
        if(ownDropId!==undefined){
          const ownPieces=new Set(beforeGroups.find(group=>group.id===ownDropId)?.pieces??[ownDropId]);
          for(const group of s.puzzle.groups)if(group.id===ownDropId||group.pieces.some(id=>ownPieces.has(id)))silentIds.add(group.id);
        }
        const teammateConnected=showFeedback&&soundRemote&&successfulRemoteConnection(beforeGroups,s.puzzle,silentIds);
        this.table.syncRemote(this.previewPuzzle(), owners, protectedIds,showFeedback);
        if(teammateConnected)this.table.playConnectionSound('teammate');
      } else if (elapsedChanged) { this.state.elapsed = s.puzzle.elapsed; }
    } else { this.state.groups = cloneRoomValue(s.puzzle.groups); this.state.elapsed = s.puzzle.elapsed; }
    this.ownersKey = ownersKey;
    this.emit();
    this.maybeEnterLocal();
  }
  private previewPuzzle(){
    const previews=new Map(this.previewMoves.filter(move=>this.snapshot.leases[move.groupId]?.playerId===move.playerId&&this.snapshot.leases[move.groupId]?.previewId===move.leaseId).map(move=>[move.groupId,move]));
    if(!previews.size)return this.snapshot.puzzle;
    return {...this.snapshot.puzzle,groups:this.snapshot.puzzle.groups.map(group=>{const move=previews.get(group.id);return move&&!group.locked?{...group,dx:move.dx,dy:move.dy}:group;})};
  }
  private fail(error: unknown) {
    if (this.stopped) return;
    const status = (error as { status?: number })?.status, code = (error as { code?: string })?.code;
    if(this.localMode&&!this.exiting&&this.soloTransient(error)){
      this.failures++;this.message='网络不稳，拼好的进度会自动保存';this.emit();return;
    }
    if(this.localMode)this.leaveLocalMode();
    this.message = error instanceof Error ? error.message : '连接中断，正在重连';
    const gameplayError = status === 400 || status === 402 || status === 409 || status === 422 || (status === 403 && code === 'ENERGY_EMPTY');
    if (gameplayError) {
      this.deps.emit('mobile:gameplay-error',{code,message:this.message});
      if (code === 'ENERGY_EMPTY' || status === 402) this.deps.emit('mobile:energy-empty');
    }
    if (!gameplayError) {
      this.connected = false; this.failures++;
      for (const task of this.pendingDrags) { task.canceled = true; task.grant(false); task.wake?.(); }
      this.active = null;
      // HTTP polling can fail while the ordered action stream is still alive.
      // If the board is about to forget the held piece, end that hold there too.
      const holdingId=this.diagnosticPipeline?.holdingId;
      if(holdingId!==undefined)this.diagnosticPipeline?.release(holdingId);
      if (this.table) { this.table.networkReady = false; this.table.cancelNetworkDrag(); }
    }
    this.emit();
  }
  attach(table: RoomTable) {
    this.table = table; this.stopped = false;
    if(this.deps.realtime?.sendAction){
      this.diagnosticPipeline?.stop();
      this.diagnosticPipeline=new DiagnosticDragPipeline(this.deps.realtime,{
        randomId:()=>this.deps.randomId(),now:()=>this.deps.performanceNow(),revision:()=>this.snapshot.revision,
        cancel:id=>this.table?.cancelNetworkDrag(id),error:error=>this.fail(error),timing:(...args)=>this.trace(...args),
        reconcile:async()=>{
          if(this.stopped)return;
          this.receive(await this.request(),true);
          if(!this.stopped)void this.deps.refreshProfile?.().catch(()=>{});
        },
        profile:data=>{this.deps.profile?.(data);if(data?.profile??data?.mobileProfile)this.deps.emit('mobile:profile',data.profile??data.mobileProfile);},
        receive:(reply,input)=>{
          const action=input.action;
          const receipt=reply.data?.mobileContribution;
          const contribution=action.type==='drop'&&receipt?.requestId===input.id&&receipt.groupId===action.groupId&&Number.isFinite(receipt.creditedXp)&&receipt.creditedXp>0?receipt:undefined;
          const before=action.type==='drop'?this.snapshot.puzzle.groups.find(g=>g.id===action.groupId):undefined;
          const merged=applyRoomUpdate(this.snapshot,reply.data);
          if(merged)this.receive(merged,true,true,action.type==='drop'?action.groupId:undefined);else{this.forcePoll=true;this.schedulePoll(0);}
          // An authoritative contribution belongs to this ACK even when its
          // delta needs a later full read or was overtaken by a room push.
          if(action.type==='drop'&&(contribution||merged&&successfulDrop(before,merged.puzzle,action.groupId))){this.table?.playConnectionSound?.('local');this.deps.emit('puzzle:successful-drop',{roomId:this.ticket.room.id,...contribution});}
        },
      },(this.ticket.room as MobileRoomSnapshot).diagnostic===true);
    }
    table.network = {
      // A group whose drop is still being confirmed can be picked up again: the piece is back
      // on the table. Permit that quick next gesture while the bounded confirmation
      // queue has capacity, without admitting another gesture during an active drag.
      canAcquire: id => this.localMode?this.canAcquireLocal(id):this.connected && !this.organizing && (this.useDiagnosticPipeline()?this.diagnosticPipeline!.canAcquire(id):this.active === null && this.pendingDrags.size < MAX_PENDING_DRAGS && !this.moving(id)),
      acquire: id => this.acquire(id), move: (id, dx, dy) => this.move(id, dx, dy),
      drop: (id, dx, dy) => this.drop(id, dx, dy), release: id => this.release(id),
      resync: () => this.resyncTable(),
    };
    for(const cleanup of this.realtimeCleanups)cleanup();this.realtimeCleanups=[];
    if(this.deps.realtime?.preview)this.realtimeCleanups.push(this.deps.realtime.preview.subscribeMoves(moves=>{
      if(this.stopped)return;this.previewMoves=moves;
      if(this.localMode)return;
      const protectedIds=new Set([...this.drags.values()].filter(t=>!t.canceled).map(t=>t.id));for(const id of this.diagnosticPipeline?.protectedIds()??[])protectedIds.add(id);
      this.table?.syncRemote(this.previewPuzzle(),this.pieceOwners,protectedIds,false);
    }));
    if(this.deps.realtime){
      this.realtimeCleanups.push(this.deps.realtime.subscribeRoom(update=>{
        if(this.stopped)return;const room=applyRoomUpdate(this.snapshot,update);
        if(room)this.receive(room);else{this.forcePoll=true;this.schedulePoll(0);}
      }),this.deps.realtime.subscribeState(connected=>{
        if(this.stopped)return;if(!connected){if(this.backgroundSuspended()){this.schedulePoll(4000);return;}this.forcePoll=true;}this.schedulePoll(connected?Math.max(0,5001-(this.deps.now()-this.heartbeatAt)):0);
      }));
    }
    this.receive(this.snapshot, true);
    // A lost completion ACK can leave an outbox for an already completed room,
    // which must drain even though completed rooms cannot enter local play.
    if(this.soloOps.length&&this.deps.solo?.enabled()===true&&(this.snapshot as MobileRoomSnapshot).diagnostic!==true)this.scheduleSoloFlush(0);
    void this.poll();
    return () => { this.stop(); this.table = null; };
  }
  private backgroundSuspended(){
    return this.deps.hidden()&&this.drags.size===0&&this.pendingDrags.size===0&&!this.diagnosticPipeline?.hasActive()&&this.soloOps.length===0;
  }
  /** Pause background heartbeats while hidden so idle backgrounded clients age out cleanly; resume immediately on foreground return. */
  setHidden(hidden:boolean){
    if(this.stopped)return;
    if(hidden){
      if(this.backgroundSuspended()&&this.pollTimer){clearTimeout(this.pollTimer);this.pollTimer=null;this.schedulePoll(4000);}
      return;
    }
    this.heartbeatAt=0;this.forcePoll=true;this.retryAt=0;
    this.schedulePoll(0);
  }
  private async poll() {
    if (this.stopped||this.polling) return;
    if (this.backgroundSuspended()) { this.schedulePoll(4000); return; }
    this.polling=true;
    try {
      const now = this.deps.now(); let data: RoomSnapshot;
      const force=this.forcePoll;this.forcePoll=false;
      if (now - this.heartbeatAt > 5000) {
        this.heartbeatAt = now;
        const holding = [...this.drags.values()].find(t => t.granted && !t.canceled && !t.ending);
        // Heartbeats never wait in the movement queue.
        const holdingId=holding?.id??this.diagnosticPipeline?.holdingId;
        data = await this.request({ type: 'heartbeat', ...(holdingId!==undefined ? { groupId: holdingId } : {}) });
      } else if(this.deps.realtime?.connected&&!force)return;
      else data = await this.request();
      this.idlePolls = data.puzzle.groups === this.snapshot.puzzle.groups ? this.idlePolls + 1 : 0;
      this.receive(data);
      this.diagnosticPipeline?.retryRecovery();
    } catch (error) { this.fail(error); }
    finally {
      this.polling=false;
      if(!this.stopped){const delay=this.forcePoll?0:this.localMode&&this.failures?Math.min(4000,800*this.failures):this.deps.realtime?.connected?Math.max(100,5001-(this.deps.now()-this.heartbeatAt)):this.connected?roomPollDelay(this.drags.size>0||Object.keys(this.snapshot.leases).length>0,this.idlePolls,this.deps.hidden()):Math.min(4000,800*this.failures);this.schedulePoll(Math.max(this.retryAt-this.deps.now(),delay));}
    }
  }
  /** Ask for an immediate resynchronisation (the reconnect banner's 重试). */
  retryNow(){this.retryAt=0;this.forcePoll=true;this.schedulePoll(0);}
  private schedulePoll(delay:number){if(this.pollTimer)clearTimeout(this.pollTimer);this.pollTimer=null;if(!this.stopped)this.pollTimer=setTimeout(()=>{this.pollTimer=null;void this.poll();},delay);}
  // Keep a group reserved until its drop/release request is acknowledged. A
  // second drag of the same group during that window can otherwise be replaced
  // by the older server response and visibly flash back to the previous offset.
  // A drop stays in the map until the server acknowledges it so an older
  // snapshot cannot overwrite the local position. It must not, however, make
  // the same group feel stuck when the player immediately picks it up again.
  // The new drag replaces the ending task and waits for its request chain to
  // finish before claiming the group, preserving server ordering.
  private moving(id: number) { const task = this.drags.get(id); return !!task && !task.ending; }
  private useDiagnosticPipeline(){return !!this.diagnosticPipeline&&(this.diagnosticPipeline.inUse||this.pendingDrags.size===0&&this.diagnosticPipeline.available);}
  acquire(id: number): Promise<boolean> {
    if(this.localMode){if(!this.canAcquireLocal(id))return Promise.resolve(false);this.localDrag=id;return Promise.resolve(true);}
    if(this.useDiagnosticPipeline())return !this.connected||this.organizing?Promise.resolve(false):this.diagnosticPipeline!.acquire(id);
    if (!this.connected || this.organizing || this.active || this.pendingDrags.size >= MAX_PENDING_DRAGS || this.moving(id)) return Promise.resolve(false);
    let grant!: (ok: boolean) => void; let finish!: () => void;
    const granted = new Promise<boolean>(resolve => { grant = resolve; });
    const finished = new Promise<void>(resolve => { finish = resolve; });
    const task: DragTask = { id, seq: 0, granted: false, canceled: false, lastMoveAt: -Infinity, latest: null, ending: null, wake: null, finished, finish, grant };
    // Reserve immediately so incoming snapshots cannot pull the local piece backward.
    this.drags.set(id, task); this.pendingDrags.add(task); this.active = task;
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
          if(task.ending.type==='drop'&&task.droppedAt!==undefined)this.trace('drop-queue',task.droppedAt);
          const before=task.ending.type==='drop'?this.snapshot.puzzle.groups.find(g=>g.id===task.id):undefined;
          const result = await this.request(task.ending.type === 'drop'
            ? { type: 'drop', groupId: task.id, dx: task.ending.dx, dy: task.ending.dy, seq: ++task.seq }
            : { type: 'release', groupId: task.id });
          // A newer drag of this group may have taken the reservation over; leave it in place.
          if (this.drags.get(task.id) === task) this.drags.delete(task.id);
          this.receive(result, true,true,task.ending.type==='drop'?task.id:undefined);
          if(task.ending.type==='drop'&&task.droppedAt!==undefined)this.trace('drop-total',task.droppedAt);
          // A polling response may arrive before this acknowledgement. Sound still
          // belongs to this successful local drop, never to general room updates.
          if(!this.stopped&&(result.mobileContribution||successfulDrop(before,result.puzzle,task.id))){
            this.table?.playConnectionSound?.('local');
            this.deps.emit('puzzle:successful-drop',{roomId:this.ticket.room.id,...result.mobileContribution});
          }
          return;
        }
        if (task.latest) {
          const delay = 60 - (this.deps.performanceNow() - task.lastMoveAt);
          if (delay > 0) { await this.waitForMove(task, delay); continue; }
          const latest = task.latest; task.latest = null;
          task.lastMoveAt = this.deps.performanceNow();
          const seq=++task.seq;
          if(this.deps.realtime?.preview?.sendMove(task.id,latest.dx,latest.dy))continue;
          const result = await this.request({ type: 'move', groupId: task.id, ...latest, seq });
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
      if(!superseded)this.deps.realtime?.preview?.clearMove(task.id);
      if (this.active === task) this.active = null;
      // A refusal belongs to the drag it was sent for: it never cancels the newer one, which
      // hears about it through its own claim.
      if (error) { if (!superseded) this.table?.cancelNetworkDrag(task.id); this.fail(error); }
      // Reconcile denied/expired claims, including other players' authoritative offsets.
      if (!this.stopped) {
        if (error) { try { this.receive(await this.request(), true); } catch (failure) { this.fail(failure); } }
        else this.receive(this.snapshot, true);
      }
      this.pendingDrags.delete(task); task.finish();
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
    if(this.localMode)return;
    if(this.diagnosticPipeline?.handles(id)){this.diagnosticPipeline.move(id,dx,dy);return;}
    const task = this.drags.get(id);
    if (!task || task.canceled || task.ending || !this.connected) return;
    task.latest = { dx, dy }; task.wake?.();
  }
  private drop(id: number, dx: number, dy: number) {
    if(this.localMode)return this.localDrop(id,dx,dy).catch(error=>this.localPlayFailed(error));
    if(this.diagnosticPipeline?.handles(id))return this.diagnosticPipeline.drop(id,dx,dy);
    // A drop with no drag behind it (its claim failed or local play ended mid-gesture) must not leave
    // the piece drawn where the room never put it: show the room's own position again.
    const task = this.drags.get(id); if (!task) { this.resyncTable(); return Promise.resolve(); }
    task.latest = null; task.ending = { type: 'drop', dx, dy };task.droppedAt=this.deps.performanceNow();this.trace('drop-start',task.droppedAt);
    if (this.active === task) this.active = null;
    task.wake?.(); return task.finished;
  }
  private release(id: number) {
    if(this.localMode){if(this.localDrag===id)this.localDrag=null;this.exitWake?.();return;}
    if(this.diagnosticPipeline?.handles(id)){this.diagnosticPipeline.release(id);return;}
    const task = this.drags.get(id); if (!task) return;
    task.latest = null; task.ending = { type: 'release' };
    if (this.active === task) this.active = null;
    task.wake?.();
  }
  private persistSolo(){
    const storage=this.deps.solo?.storage;
    if(storage)saveSoloOutbox(storage,{v:1,roomId:this.ticket.room.id,playerId:this.ticket.playerId,token:this.ticket.token,ops:this.soloOps,savedAt:this.deps.now()});
  }
  private pruneStoredSolo(acknowledged:Set<string>){
    const storage=this.deps.solo?.storage,box=storage&&loadSoloOutbox(storage,this.ticket.room.id);
    if(!storage||!box)return;
    const ops=box.ops.filter(op=>!acknowledged.has(op.requestId));
    if(ops.length!==box.ops.length)saveSoloOutbox(storage,{...box,ops,savedAt:this.deps.now()});
  }
  private maybeEnterLocal(){
    if(this.localMode||this.stopped||this.soloRefused||this.deps.solo?.enabled()!==true||!this.table||!this.connected
      ||(this.snapshot as MobileRoomSnapshot).diagnostic===true||this.snapshot.completedAt!=null
      ||this.drags.size||this.pendingDrags.size||this.diagnosticPipeline?.inUse||this.organizing)return;
    const others=otherPlayersPresent(this.snapshot,this.ticket.playerId);
    if(others&&!this.soloOps.length)return;
    this.localMode=true;this.localPuzzle=replaySoloOps(this.snapshot.puzzle,this.soloOps);
    this.syncSoloPuzzle(false);
    if(this.soloOps.length)this.scheduleSoloFlush(0);
    if(others)this.beginExit();
    this.emit();
  }
  private canAcquireLocal(id:number){
    return !this.stopped&&!this.exiting&&!this.organizing&&!this.soloDropping&&this.localDrag===null&&this.soloOps.length<SOLO_MAX_PENDING
      &&!!this.localPuzzle?.groups.some(group=>group.id===id&&!group.locked);
  }
  private syncSoloPuzzle(feedback:boolean,protect=new Set<number>()){
    if(!this.localPuzzle)return;
    this.soloGroupsKey=JSON.stringify(this.localPuzzle.groups);
    this.table?.syncRemote(this.localPuzzle,{},protect,feedback);
  }
  /** Draw the room's authoritative state again (local play: the device's puzzle), keeping only a held piece. */
  resyncTable(){
    if(this.stopped||!this.table)return;
    if(this.localMode){if(this.localPuzzle)this.syncSoloPuzzle(false,this.localDrag===null?new Set():new Set([this.localDrag]));return;}
    const protectedIds=new Set([...this.drags.values()].filter(t=>!t.canceled).map(t=>t.id));for(const id of this.diagnosticPipeline?.protectedIds()??[])protectedIds.add(id);
    this.table.syncRemote(this.previewPuzzle(),this.pieceOwners,protectedIds,false);
  }
  private rebaseSoloPuzzle(){
    if(!this.localMode)return;
    this.localPuzzle=replaySoloOps(this.snapshot.puzzle,this.soloOps);
    if(JSON.stringify(this.localPuzzle.groups)!==this.soloGroupsKey)
      this.syncSoloPuzzle(false,this.localDrag===null?new Set():new Set([this.localDrag]));
  }
  private energyEmpty(message='体力不足，请使用补给或稍后再来'){
    this.deps.emit('mobile:gameplay-error',{code:'ENERGY_EMPTY',message});this.deps.emit('mobile:energy-empty');
  }
  private async localDrop(id:number,dx:number,dy:number){
    if(!this.localPuzzle||this.localDrag!==id){this.resyncTable();return;}
    this.localDrag=null;this.soloDropping=true;
    try{
      let result=applySoloDrop(this.localPuzzle,{groupId:id,dx,dy});
      if(!result.applied){this.syncSoloPuzzle(false);return;}
      const canAfford=()=>soloCanAfford(this.deps.solo?.energy()??null,this.soloOps.filter(op=>op.snapped).length);
      if(result.snapped&&!canAfford()){
        // Pending receipts publish the fresh profile before this prediction is retried.
        while(this.soloOps.length){if(!await this.flushSolo())break;}
        if(!this.localMode||!this.localPuzzle||this.stopped)return;
        result=applySoloDrop(this.localPuzzle,{groupId:id,dx,dy});
        if(!result.applied){this.syncSoloPuzzle(false);return;}
        if(result.snapped&&!canAfford()){this.syncSoloPuzzle(false);this.energyEmpty();return;}
      }
      const op:SoloOp={requestId:this.deps.randomId(),groupId:id,dx:result.dx,dy:result.dy,snapped:result.snapped};
      const last=this.soloOps[this.soloOps.length-1];
      if(!op.snapped&&this.soloOps.length-1>=this.soloInflight&&last&&!last.snapped&&last.groupId===id)this.soloOps[this.soloOps.length-1]=op;
      else this.soloOps.push(op);
      this.persistSolo();this.localPuzzle=result.puzzle;this.syncSoloPuzzle(true);
      if(op.snapped){
        this.table?.playConnectionSound('local');
        const xp=this.deps.solo?.energy()?.xp;
        this.deps.emit('puzzle:successful-drop',{roomId:this.ticket.room.id,requestId:op.requestId,groupId:id,...(typeof xp==='number'&&Number.isInteger(xp)&&xp>0?{creditedXp:xp}:{})});
      }
      const now=this.deps.now();this.firstUnsentAt??=now;
      const unsent=this.soloOps.length-this.soloInflight;
      this.scheduleSoloFlush(result.completed||unsent>=25?0:Math.max(0,Math.min(800,3000-(now-this.firstUnsentAt))));
      this.emit();
    }finally{this.soloDropping=false;this.exitWake?.();}
  }
  /** Local play threw (an old WebView lacking a newer built-in, say). Never leave the piece drawn where the
   * room did not put it: save what is pending, return to server drags for this room and redraw its state. */
  private localPlayFailed(error:unknown){
    this.deps.emit('room:local-play-error',{roomId:this.ticket.room.id,message:error instanceof Error?error.message:String(error)});
    this.soloRefused=true;this.soloDropping=false;this.localDrag=null;
    if(this.localMode)this.beginExit();else this.resyncTable();
  }
  private clearSoloTimer(){if(this.flushTimer)clearTimeout(this.flushTimer);this.flushTimer=null;}
  private scheduleSoloFlush(delay:number){
    this.clearSoloTimer();
    if(this.stopped||!this.soloOps.length)return;
    const wait=Math.max(delay,this.soloRetryAt-this.deps.now(),this.retryAt-this.deps.now());
    this.flushTimer=setTimeout(()=>{this.flushTimer=null;void this.flushSolo();},wait);
  }
  private soloTransient(error:unknown){
    const status=(error as {status?:number})?.status;
    return status===undefined||status===408||status===429||status>=500;
  }
  private async flushSolo(opts?:{keepalive?:boolean}):Promise<boolean>{
    if(this.flushing){if(!await this.flushing)return false;return this.soloOps.length?this.flushSolo(opts):true;}
    if(!this.soloOps.length)return true;
    if(this.deps.now()<Math.max(this.soloRetryAt,this.retryAt)){this.scheduleSoloFlush(0);return false;}
    this.clearSoloTimer();
    const pending=this.sendSoloBatch(opts);this.flushing=pending;
    try{return await pending;}finally{this.flushing=null;}
  }
  private async sendSoloBatch(opts?:{keepalive?:boolean}):Promise<boolean>{
    const batch=this.soloOps.slice(0,SOLO_BATCH_MAX),sent=new Set(batch.map(op=>op.requestId));
    this.soloInflight=batch.length;this.firstUnsentAt=null;
    const discardBatch=()=>{this.soloOps=this.soloOps.filter(op=>!sent.has(op.requestId));this.persistSolo();};
    try{
      // Refresh the seat before acknowledging moves after a long background pause.
      if(this.deps.now()-this.receivedAt>15000)this.receive(await this.request({type:'heartbeat'}));
      const {snapshot,data}=await this.requestWithData({type:'batch',ops:batch.map(({snapped,...op})=>op)},opts);
      if(!data.soloBatch)throw new Error('Missing solo batch receipt');
      const remaining=acknowledgeSoloOps(this.soloOps,data.soloBatch);
      if(remaining.length===this.soloOps.length)throw new Error('Solo batch made no progress');
      // A stopped client only prunes what the server acknowledged: a replacement client may own newer ops.
      if(this.stopped)this.pruneStoredSolo(new Set(this.soloOps.filter(op=>!remaining.includes(op)).map(op=>op.requestId)));
      this.soloOps=remaining;if(!this.stopped)this.persistSolo();this.soloFailures=0;this.soloRetryAt=0;
      this.soloInflight=0;
      if(data.soloBatch.stopped)this.energyEmpty(data.soloBatch.stopped.message);
      this.receive(snapshot,true);
      // Explicit leave-time flushes still update the saved authoritative state.
      if(this.stopped){this.snapshot=snapshot;this.localPuzzle=replaySoloOps(snapshot.puzzle,this.soloOps);}
      this.scheduleSoloFlush(0);return true;
    }catch(error){
      this.soloInflight=0;
      // A replacement client may already own this room's stored outbox.
      if(this.stopped)return false;
      const status=(error as {status?:number})?.status;
      const code=(error as {code?:string})?.code;
      if((status===400||status===409)&&(code==='SOLO_BATCH_DISABLED'||code==='SOLO_BATCH_UNAVAILABLE'||status===400&&code==='INVALID_BATCH')){
        // The server switched batching off: return to server drags instead of discarding every later drop.
        if(code==='SOLO_BATCH_DISABLED'||code==='SOLO_BATCH_UNAVAILABLE'){this.soloRefused=true;this.soloOps=[];this.persistSolo();this.leaveLocalMode();}
        else discardBatch();
        try{this.receive(await this.request(),true);this.scheduleSoloFlush(0);return true;}catch(failure){this.fail(failure);}
      }else if(status===404||status===410){
        this.soloOps=[];this.persistSolo();this.leaveLocalMode();this.fail(error);
      }else{
        this.soloFailures++;this.soloRetryAt=Math.max(this.retryAt,this.deps.now()+Math.min(15000,1000*2**this.soloFailures));
        if(this.soloTransient(error)){this.message='网络不稳，拼好的进度会自动保存';this.emit();}
        else{this.leaveLocalMode();this.fail(error);}
        this.scheduleSoloFlush(0);
        if((status===401||status===403)&&!this.rejoinRequired){this.rejoinRequired=true;this.deps.emit('room:rejoin-required',{roomId:this.ticket.room.id});}
      }
      return false;
    }finally{this.soloInflight=0;this.exitWake?.();}
  }
  /** Flush on application hide without waiting for the debounce. */
  flushSoloNow(){void this.flushSolo({keepalive:true});}
  private leaveLocalMode(){
    this.localMode=false;this.exiting=false;this.localPuzzle=null;this.localDrag=null;
    this.clearSoloTimer();this.exitWake?.();
  }
  private beginExit(){
    if(this.exiting)return;
    this.exiting=true;this.emit();
    void (async()=>{
      while(!this.stopped&&this.localMode&&this.exiting){
        if(this.localDrag!==null||this.soloDropping){await this.waitSoloExit();continue;}
        if(!this.soloOps.length)break;
        const delay=Math.max(this.soloRetryAt,this.retryAt)-this.deps.now();
        if(delay>0){await this.waitSoloExit(delay);continue;}
        await this.flushSolo();
      }
      if(!this.localMode||!this.exiting||this.stopped)return;
      this.leaveLocalMode();this.receive(this.snapshot,true);
    })();
  }
  private waitSoloExit(delay?:number){
    return new Promise<void>(resolve=>{
      let timer:ReturnType<typeof setTimeout>|undefined;
      this.exitWake=()=>{clearTimeout(timer);this.exitWake=null;resolve();};
      if(delay!==undefined)timer=setTimeout(this.exitWake,delay);
    });
  }
  private stop() {
    this.stopped = true;
    this.clearSoloTimer();this.localDrag=null;this.exitWake?.();
    this.leaveLocalMode();
    this.diagnosticPipeline?.stop();
    if (this.pollTimer) clearTimeout(this.pollTimer);
    for(const cleanup of this.realtimeCleanups)cleanup();this.realtimeCleanups=[];
    for (const task of this.pendingDrags) { task.canceled = true; task.grant(false); task.wake?.(); }
    this.active = null; this.table?.cancelNetworkDrag();
  }
  async organize() {
    if(this.organizing)throw new Error('正在整理，请稍候。');
    if(this.localDrag!==null||this.soloDropping)throw new Error('请先放下当前拼块');
    if(this.diagnosticPipeline?.hasActive())throw new Error('请先放下当前拼块');
    const pending=[...this.pendingDrags];
    if(pending.some(task=>!task.ending&&!task.canceled))throw new Error('请先放下当前拼块');
    this.organizing=true;
    try{
      while(this.soloOps.length){if(!await this.flushSolo())throw new Error('正在保存，请稍候');}
      // Pointer-up may still be saving its drop. Finish it before rearranging.
      await Promise.all(pending.map(task=>task.finished));
      await this.diagnosticPipeline?.drain();
      if(!this.connected||this.stopped)throw new Error('正在重连，请连接恢复后再整理。');
      const snapshot=await this.request({type:'shuffle'});this.receive(snapshot,true);
      if(this.snapshot.visibility==='solo')this.table?.fit();
    }finally{this.organizing=false;this.maybeEnterLocal();}
  }
  leave() {
    this.stop();
    const sendLeave=()=>this.deps.fetch(`/api/rooms/${this.ticket.room.id}`, { method: 'POST', keepalive: true,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.ticket.token}` }, body: JSON.stringify({ type: 'leave' }),
    }).catch(() => {});
    if(!this.soloOps.length){void sendLeave();return;}
    void (async()=>{
      let timer:ReturnType<typeof setTimeout>|undefined;
      let timedOut=false;
      try{await Promise.race([(async()=>{while(!timedOut&&this.soloOps.length&&await this.flushSolo({keepalive:true})){} })(),new Promise<void>(resolve=>{timer=setTimeout(()=>{timedOut=true;resolve();},3000);})]);}
      finally{clearTimeout(timer);void sendLeave();}
    })();
  }
}
export function roomSessionKey(id: string) { return `together-puzzle:room:${id}`; }
export function saveTicket(ticket: RoomTicket) { const value=JSON.stringify({ token: ticket.token, playerId: ticket.playerId });try { sessionStorage.setItem(roomSessionKey(ticket.room.id),value); } catch {}if(ticket.room.visibility){try{localStorage.setItem(roomSessionKey(ticket.room.id)+':account',value);}catch{}} }
