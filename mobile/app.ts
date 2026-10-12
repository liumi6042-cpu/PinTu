import type {Platform,Input,Rect,Route} from './ports';
import {GameClient} from './client';
import {Stage} from './ui';
import {PuzzleBoard} from './puzzle-board';
import {RoomClient,type RoomTicket} from '../lib/room-client';
import {CursorClient} from '../lib/cursor-client';
import {GALLERY_PHOTOS,RESTORABLE_PHOTOS,CATEGORIES} from '../lib/puzzle-catalog';
import {photoGuidance} from '../lib/play-guidance';
import {customPhoto} from '../lib/custom-images';
import {placedCount} from '../lib/puzzle-engine';
import collectionCatalog from '../lib/mobile-collection-catalog.json';
import type {MobileTaskView,MobileGiftKind,MobileGiftOpenResult,MobileRoomInput} from '../h5/mobile-api';
import type {MobileCollectionView,CollectionPack,CollectionDecoration} from '../h5/mobile-collection-api';
import type {RoomCard} from '../lib/lobby-types';
import type {AssistanceGrant} from '../lib/assistance-policy';

type Direction='all'|'portrait'|'landscape'|'square';
type Modal='filters'|'settings'|'manage'|'invite'|'tools'|'chat'|'completion'|'purchase'|'packPreview'|null;
type RoomListing=RoomCard&{actualPieces?:number};
const directions:[Direction,string][]=[['all','全部'],['portrait','竖图'],['landscape','横图'],['square','方图']];
const counts=[48,108,300,500] as const;
const phrases=['大家好！','我来找边缘','这块放这里','一起加油！','谢谢你！','稍等一下'];
const photoMap=new Map(RESTORABLE_PHOTOS.map(photo=>[photo.id,photo]));
const packed=new Set(collectionCatalog.packs.flatMap(pack=>pack.imageIds));
function orientation(id:string):Direction{const size=photoGuidance(id);return !size?'all':size.width===size.height?'square':size.width>size.height?'landscape':'portrait';}
function errorText(error:unknown){return error instanceof Error?error.message:'连接暂时中断，请重试';}
function clamp(value:number,min:number,max:number){return Math.max(min,Math.min(max,value));}
function inside(r:Rect,x:number,y:number){return x>=r.x&&x<=r.x+r.w&&y>=r.y&&y<=r.y+r.h;}

/** One scene graph and one set of game rules for both mobile platforms. */
export class GameApp{
 route:Route='lobby';
 private routeStack:Route[]=[];
 private ready=false;private destroyed=false;private busy=false;private message='正在连接游戏…';private messageUntil=0;
 private scroll=0;private extent=0;private bodyTop=100;private bodyBottom=0;private pointer:{x:number;y:number;lastY:number;scroll:boolean;board:boolean}|null=null;
 private modal:Modal=null;private modalScroll=0;private modalExtent=0;private modalArea:Rect={x:0,y:0,w:0,h:0};private modalStart=0;
 private direction:Direction='all';private filterCount=0;private openOnly=true;private activeOnly=false;
 private rooms:RoomListing[]=[];private lobbyCursor:string|null=null;private lobbyLoading=false;private lobbySerial=0;private lobbyReload=false;
 private pieces:48|108|300|500=108;private selected:string|null=null;private visibility:'public'|'private'='public';private category='全部';private search='';private source:'free'|'owned'|'all'='free';private packId:string|null=null;
 private galleryIds:Set<string>|null=null;private packedIds=packed;
 private tasks:MobileTaskView|null=null;private taskTab:'tasks'|'gifts'='tasks';private taskDetailsOpen=false;
 private collection:MobileCollectionView|null=null;private collectionTab:'albums'|'packs'|'decorations'='albums';private albumId='';private decorationId='';private decorationOwnedOnly=false;private purchase:CollectionPack|null=null;
 private previewPack:CollectionPack|null=null;private previewIndex=0;
 private room:RoomClient|null=null;private board:PuzzleBoard|null=null;private detachRoom:(()=>void)|null=null;private unsubscribeRoom:(()=>void)|null=null;
 private cursor:CursorClient|null=null;private cursorVisible=false;
 private roomArea:Rect={x:0,y:0,w:0,h:0};private roomImage='';private imageReady=false;private roomViewPending=false;private imageError='';private toolsOpen=false;private hidden=false;private completedId='';
 private aid:{grants:AssistanceGrant[];freeRemaining?:{hint:number;underlay:number};newcomerProtected?:boolean;serverTime:number}|null=null;
 private messages:Array<{id:number;name:string;text:string;playerId:string}>=[];private chatCursor=0;
 private timers:Array<ReturnType<typeof setInterval>>=[];private cleanups:Array<()=>void>=[];private attempts=new Map<string,string>();
 private handledQueries=new Set<string>();
 constructor(readonly platform:Platform,readonly client:GameClient,readonly stage:Stage){}
 private invalidate=()=>this.stage.invalidate();
 private note(message:string,permanent=false){this.message=message;this.messageUntil=permanent?Infinity:Date.now()+7000;this.invalidate();}
 private attempt(key:string){let value=this.attempts.get(key);if(!value){value=this.platform.randomId();this.attempts.set(key,value);}return value;}
 private async run(action:()=>Promise<void>){if(this.busy)return;this.busy=true;this.invalidate();try{await action();}catch(error){this.note(errorText(error));}finally{this.busy=false;this.invalidate();}}
 async start(){
  this.client.onChange=()=>{this.invalidate();};
  this.cleanups.push(this.platform.onHide(()=>{this.hidden=true;this.pointer=null;}),this.platform.onShow(query=>{this.hidden=false;void this.client.refresh().catch(error=>this.note(errorText(error)));void this.handleQuery(query);this.invalidate();}));
  try{await this.client.start();this.ready=true;this.message='';await this.loadGallery();await this.loadLobby();await this.handleQuery(this.platform.initialQuery);}
  catch(error){this.note(errorText(error),true);}
  this.timers.push(setInterval(()=>{if(this.destroyed||this.hidden)return;if(this.route==='lobby'&&!this.busy)void this.loadLobby(false,true);if(this.route==='tasks'&&!this.busy)void this.loadTasks();if(this.route==='gallery'&&!this.busy)void this.loadGallery();if(this.route==='collection'&&!this.busy)void this.loadCollection();if(this.modal==='chat')void this.loadChat();},9000));
  this.timers.push(setInterval(()=>{if(!this.hidden){if(this.route==='room')this.invalidate();else if(this.messageUntil&&Date.now()>this.messageUntil){this.message='';this.messageUntil=0;this.invalidate();}}},1000));
  this.invalidate();
 }
 destroy(){this.destroyed=true;this.leaveRoom();this.client.onChange=undefined;for(const timer of this.timers)clearInterval(timer);for(const cleanup of this.cleanups)cleanup();}
 private async handleQuery(query:Record<string,string>){
  const invitation=query.invite||query.inviteCode||query.friend||query.ref;
  const room=query.room||query.roomId,key=[room??'',invitation??'',query.roomInvite??query.code??''].join(':');
  if((!room&&!invitation)||this.handledQueries.has(key))return;this.handledQueries.add(key);
  if(invitation&&/^[a-zA-Z0-9-]{6,64}$/.test(invitation)){this.pendingInvitation=invitation;this.modal='invite';await this.loadTasks();}
  if(room&&/^[a-f0-9]{32}$/.test(room)){await this.enterRoom(room,query.roomInvite||query.code);if(this.pendingInvitation)this.showModal('invite');}
 }
 private pendingInvitation='';
 private navigate(route:Route){if(route!=='room')this.clearRoomPointer();if(route!==this.route){if(route==='lobby'||route==='room')this.routeStack=[];else this.routeStack.push(this.route);this.route=route;this.scroll=0;}this.modal=null;this.toolsOpen=false;this.message='';this.invalidate();if(route==='lobby')void this.loadLobby();if(route==='gallery')void this.loadGallery();if(route==='tasks')void this.loadTasks();if(route==='collection')void this.loadCollection();}
 private back(){const previous=this.routeStack.pop()??(this.room?'room':'lobby');this.route=previous==='room'&&!this.room?'lobby':previous;this.scroll=0;this.modal=null;this.toolsOpen=false;this.message='';this.invalidate();if(this.route==='lobby')void this.loadLobby();if(this.route==='tasks')void this.loadTasks();if(this.route==='collection')void this.loadCollection();}
 private clearRoomPointer(){this.cursor?.point(null);this.board?.input({type:'cancel',points:[],changed:[]});this.pointer=null;this.cursorVisible=false;}
 private showModal(modal:Modal){if(modal)this.clearRoomPointer();this.modal=modal;this.modalScroll=0;this.modalExtent=0;this.invalidate();if(modal==='chat')void this.loadChat();if(modal==='invite')void this.loadTasks();}
 private async loadLobby(more=false,quiet=false){
  if(this.lobbyLoading){if(!more&&!quiet)this.lobbyReload=true;return;}this.lobbyLoading=true;const serial=this.lobbySerial;
  try{const query='limit=16&direction='+this.direction+(this.filterCount?'&pieces='+this.filterCount:'')+(this.openOnly?'&open=1':'')+(this.activeOnly?'&active=1':'')+(more&&this.lobbyCursor?'&cursor='+encodeURIComponent(this.lobbyCursor):'');
   const data=await this.client.json<{rooms:RoomListing[];nextCursor?:string|null}>('/api/lobby?'+query);if(serial!==this.lobbySerial)return;
   if(!Array.isArray(data.rooms))throw Error('大厅数据暂不可用');
   if(more){const byId=new Map(this.rooms.map(room=>[room.id,room]));for(const room of data.rooms)byId.set(room.id,room);this.rooms=[...byId.values()];}
   else if(quiet&&this.rooms.length>16){const incoming=new Map(data.rooms.map(room=>[room.id,room]));this.rooms=this.rooms.map(room=>incoming.get(room.id)??room);for(const room of data.rooms)if(!this.rooms.some(old=>old.id===room.id))this.rooms.push(room);}
   else this.rooms=data.rooms;
   if(!quiet||this.rooms.length<=16)this.lobbyCursor=data.nextCursor??null;
  }catch(error){if(!quiet)this.note(errorText(error));}finally{this.lobbyLoading=false;this.invalidate();if(this.lobbyReload&&!this.destroyed){this.lobbyReload=false;void this.loadLobby();}}
 }
 private changeDirection(value:Direction){this.direction=value;this.scroll=0;if(this.route==='lobby'){this.lobbySerial++;this.rooms=[];this.lobbyCursor=null;void this.loadLobby();}this.invalidate();}
 private async loadTasks(){try{this.tasks=await this.client.json<MobileTaskView>('/api/mobile/tasks');this.invalidate();}catch(error){this.note(errorText(error));}}
 private async loadCollection(){try{this.collection=await this.client.json<MobileCollectionView>('/api/mobile/collection');this.invalidate();}catch(error){this.note(errorText(error));}}
 private async loadGallery(){try{const data=await this.client.json<{imageIds:string[];packedImageIds:string[]}>('/api/mobile/gallery');this.galleryIds=new Set(data.imageIds);this.packedIds=new Set(data.packedImageIds);if(this.selected&&!this.galleryIds.has(this.selected))this.selected=null;this.invalidate();}catch(error){this.note(errorText(error));}}
 private availableGallery(){if(!this.galleryIds)return GALLERY_PHOTOS;const baseIds=new Set(GALLERY_PHOTOS.map(photo=>photo.id));return [...GALLERY_PHOTOS,...RESTORABLE_PHOTOS.filter(photo=>!baseIds.has(photo.id))].filter(photo=>this.galleryIds!.has(photo.id));}
 private async launch(input:MobileRoomInput){
  if((this.client.profile?.ownedRooms.length??0)>=3){this.showModal('manage');return;}
  await this.run(async()=>{const key='create:'+JSON.stringify(input),ticket=await this.client.createRoom({...input,requestId:this.attempt(key)});this.attempts.delete(key);await this.attachTicket(ticket);});
 }
 private async enterRoom(id:string,invite?:string){await this.run(async()=>{const ticket=await this.client.joinRoom(id,invite);await this.attachTicket(ticket);});}
 private leaveRoom(){this.cursor?.stop();this.cursor=null;this.cursorVisible=false;this.detachRoom?.();this.unsubscribeRoom?.();this.room?.leave();this.board?.destroy?.();this.detachRoom=null;this.unsubscribeRoom=null;this.room=null;this.board=null;this.aid=null;}
 private async attachTicket(ticket:RoomTicket){
  this.leaveRoom();this.route='room';this.routeStack=[];this.scroll=0;this.modal=null;this.imageReady=false;this.roomViewPending=false;this.imageError='';this.messages=[];this.chatCursor=0;this.completedId='';
  const room=new RoomClient(ticket,{fetch:this.client.fetchLike,randomId:()=>this.platform.randomId(),hidden:()=>this.hidden,now:()=>Date.now(),performanceNow:()=>Date.now(),emit:(name,detail)=>{
   if(name==='mobile:profile')this.invalidate();
   if(name==='mobile:gameplay-error')this.note((detail as {message?:string})?.message||'操作暂未完成');
   if(name==='mobile:energy-empty'){this.note('体力不足，请使用礼包或补给');this.navigate('supplies');}
  }});this.room=room;
  const board=new PuzzleBoard(this.platform,room.state,this.invalidate);this.board=board;board.soundUrl='assets/audio/mobile-snap.wav';board.onNotice=message=>this.note(message);board.drawDecoration=(value,rect)=>this.stage.icon(value.artKey,rect);board.selfDecoration=this.client.profile?.collection?.equipped??null;this.detachRoom=room.attach(board);
  const cursor=new CursorClient(ticket.room.id,ticket.token,ticket.playerId,cursors=>board.setCursors(cursors),()=>room.connected,()=>this.hidden||this.route!=='room'||!!this.modal||this.toolsOpen,{fetch:this.client.fetchLike,randomId:()=>this.platform.randomId(),now:()=>Date.now(),performanceNow:()=>Date.now(),subscribeVisibility:fn=>{const hide=this.platform.onHide(fn),show=this.platform.onShow(()=>fn());return()=>{hide();show();};}});this.cursor=cursor;board.onCursor=point=>cursor.point(point);cursor.start();
  this.unsubscribeRoom=room.subscribe(()=>{if(room.snapshot.completedAt&&this.completedId!==room.snapshot.id){this.completedId=room.snapshot.id;this.showModal('completion');void this.client.refresh().catch(()=>{});}this.invalidate();});
  const photo=photoMap.get(ticket.room.puzzle.imageId);this.roomImage=this.client.asset(ticket.room.customImage?customPhoto(ticket.room.customImage,ticket.room.id).src:photo?.src??'');
  this.invalidate();void this.loadAssistance();
  try{if(!this.roomImage)throw Error('这张拼图的图片暂不可用');await board.setImage(this.roomImage);if(this.room!==room||this.board!==board)return;this.imageReady=true;this.roomViewPending=true;}catch(error){if(this.room!==room||this.board!==board)return;this.imageError=errorText(error);this.note(this.imageError,true);}this.invalidate();
 }
 private async loadAssistance(){if(!this.room)return;try{const room=this.room;const data=await this.client.json<typeof this.aid>('/api/rooms/'+room.ticket.room.id+'/assistance','GET',undefined,{Authorization:'Bearer '+room.ticket.token});if(this.room!==room)return;if(data){const offset=Date.now()-data.serverTime;data.grants=data.grants.map(grant=>({...grant,expiresAt:grant.expiresAt+offset}));this.aid=data;this.applyAssistance();}}catch(error){this.note(errorText(error));}}
 private activeAid(kind:'hint'|'underlay'){const grants=this.aid?.grants??[],now=Date.now();for(let i=grants.length-1;i>=0;i--)if(grants[i].kind===kind&&grants[i].expiresAt>now)return grants[i];return undefined;}
 private applyAssistance(){if(!this.board)return;const underlay=this.activeAid('underlay'),hint=this.activeAid('hint');this.board.setUnderlay?.(underlay?.expiresAt??0);this.board.setHints?.(hint?.pieceIds??[],hint?.expiresAt??0);this.invalidate();}
 private async activateAssistance(kind:'hint'|'underlay'){
  if(!this.room||!this.aid)return;if(this.aid.grants.some(grant=>grant.kind===kind&&grant.expiresAt>Date.now()))return;
  await this.run(async()=>{const room=this.room!,key='aid:'+room.ticket.room.id+':'+kind,headers={Authorization:'Bearer '+room.ticket.token,'Content-Type':'application/json'},path='/api/rooms/'+room.ticket.room.id+'/assistance',storageKey='jigsaw:shared:'+this.platform.config.apiBase+':'+key;
   let pending:{kind:string;requestId:string;rewardToken:string;completed:true}|null=null;try{const stored=JSON.parse(this.platform.storage.get(storageKey)||'null');if(stored?.kind===kind&&stored.completed===true&&typeof stored.requestId==='string'&&typeof stored.rewardToken==='string')pending=stored;}catch{}
   const id=pending?.requestId??this.attempt(key);let data:any;try{data=await this.client.json(path,'POST',pending??{kind,requestId:id},headers);}catch(error){if(pending&&[400,401,403,410].includes((error as{status?:number}).status??0)){this.platform.storage.remove(storageKey);this.attempts.delete(key);throw error;}if((error as {code?:string}).code!=='AD_REQUIRED')throw error;
    if(!this.client.config.adRewardEnabled||!this.client.config.rewardedAdUnitId)throw Error('广告暂未开放，仍可正常拼图');
    const challenge=await this.client.json<{rewardToken:string}>('/api/rewarded/challenge','POST',{kind,requestId:id,context:'room/'+room.ticket.room.id},headers);
    const result=await this.platform.watchAd(this.client.config.rewardedAdUnitId);if(result!=='completed')throw Error(result==='closed'?'广告未完整观看，本次未解锁':'广告暂时无法播放');
    pending={kind,requestId:id,rewardToken:challenge.rewardToken,completed:true};this.platform.storage.set(storageKey,JSON.stringify(pending));data=await this.client.json(path,'POST',pending,headers);
   }
   this.platform.storage.remove(storageKey);this.attempts.delete(key);if(this.room!==room)return;const offset=Date.now()-data.serverTime;this.aid={...data,grants:data.grants.map((grant:AssistanceGrant)=>({...grant,expiresAt:grant.expiresAt+offset}))};this.applyAssistance();this.note(kind==='hint'?'提示已开启30秒':'底图已开启30秒');
  });
 }
 private async claimSupply(kind:'energy'|'create'){
  await this.run(async()=>{const profile=this.client.profile;if(!profile?.adEligible)throw Error(profile?.newcomer?'先享受首局体验，结束后再来领取广告补给':'广告补给暂未开放');if(profile.supply[kind]>=3)throw Error('库存已满，使用后再领取');
   if(!this.client.config.adRewardEnabled||!this.client.config.rewardedAdUnitId)throw Error('当前平台尚未配置广告位，暂不能领取广告补给');
   const storageKey='jigsaw:shared:reward:'+this.platform.config.apiBase;let pending:any=null;try{pending=JSON.parse(this.platform.storage.get(storageKey)||'null');}catch{}
   if(pending?.completed&&pending.kind!==kind)throw Error('上次奖励待到账，请先重试领取原来的补给');
   if(!pending?.completed){const requestId=this.platform.randomId(),challenge=await this.client.post<{rewardToken:string}>('/api/mobile/supply/challenge',{kind,requestId});pending={kind,requestId,rewardToken:challenge.rewardToken,completed:false};
    const result=await this.platform.watchAd(this.client.config.rewardedAdUnitId);if(result!=='completed'){await this.client.post('/api/mobile/supply/cancel',pending).catch(()=>{});throw Error(result==='closed'?'本次未完整观看，未领取奖励':'广告暂时无法播放，请稍后再试');}
    pending.completed=true;this.platform.storage.set(storageKey,JSON.stringify(pending));
   }
   try{await this.client.post('/api/mobile/supply/redeem',pending);}catch(error){if([400,401,403,410].includes((error as{status?:number}).status??0))this.platform.storage.remove(storageKey);throw error;}this.platform.storage.remove(storageKey);await this.client.refresh();this.note(kind==='energy'?'体力包已存入':'建房券已存入');
  });
 }
 private async useEnergy(){await this.run(async()=>{const key='use-energy';await this.client.post('/api/mobile/supply/use',{kind:'energy',requestId:this.attempt(key)});this.attempts.delete(key);await this.client.refresh();this.note('体力已补满');});}
 private async openGift(kind:MobileGiftKind,quantity=1){await this.run(async()=>{const key='gift:'+kind;const data=await this.client.post<MobileGiftOpenResult>('/api/mobile/gifts/open',{kind,quantity,requestId:this.attempt(key)});this.attempts.delete(key);this.tasks=data;await this.client.refresh();this.note('体力 +'+data.opened.energy+' · 经验 +'+data.opened.xp);});}
 private async shareInvitation(){await this.run(async()=>{if(!this.tasks)await this.loadTasks();if(!this.tasks)throw Error('邀请码暂时无法加载');const privateCode=(this.client.ticket as RoomTicket&{inviteCode?:string})?.inviteCode;const result=await this.platform.share({title:'来'+this.platform.config.gameName+'一起拼图',roomId:this.room?.ticket.room.id,inviteCode:this.tasks.invitation.code,query:privateCode?{roomInvite:privateCode}:undefined});this.note(result==='opened'?'已打开分享，请选择好友；好友有效参与后会计入任务':result==='copied'?'邀请链接已复制；好友有效参与后会计入任务':result==='cancelled'?'本次分享已取消':'当前环境无法分享，请使用邀请码');});}
 private async acceptInvitation(){const code=this.pendingInvitation.trim();if(!code)return;await this.run(async()=>{await this.client.post('/api/mobile/invitations/accept',{code,requestId:this.attempt('accept:'+code)});this.attempts.delete('accept:'+code);this.pendingInvitation='';await this.loadTasks();this.note('已建立好友关系，一起完成拼图吧');});}
 private async collectionAction(kind:'buy'|'craft'|'equip',id:string){await this.run(async()=>{const key=kind+':'+id;this.collection=await this.client.post<MobileCollectionView>('/api/mobile/collection/'+kind,{[kind==='buy'?'packId':'decorationId']:id,requestId:this.attempt(key)});this.attempts.delete(key);this.modal=null;await this.client.refresh();this.note(kind==='buy'?'图包已永久解锁':kind==='craft'?'装饰已合成':'装饰已装备');});}
 private async loadChat(){if(!this.room)return;try{const room=this.room,data=await this.client.json<any>('/api/rooms/'+room.ticket.room.id+'/chat?after='+this.chatCursor,'GET',undefined,{Authorization:'Bearer '+room.ticket.token});if(room!==this.room)return;const map=new Map(this.messages.map(item=>[item.id,item]));for(const item of data.messages??[])map.set(item.id,item);this.messages=[...map.values()].slice(-60);this.chatCursor=data.cursor??this.chatCursor;this.invalidate();}catch(error){this.note(errorText(error));}}
 private async say(text:string){if(!this.room)return;await this.run(async()=>{const room=this.room!,key='chat:'+text;await this.client.json('/api/rooms/'+room.ticket.room.id+'/chat','POST',{text,requestId:this.attempt(key),after:this.chatCursor},{Authorization:'Bearer '+room.ticket.token,'Content-Type':'application/json'});this.attempts.delete(key);await this.loadChat();});}

 draw(){
  const s=this.stage;s.background();
  this.bodyBottom=s.h-this.platform.viewport().bottom-12;
  if(!this.ready){this.drawBoot();return;}
  if(this.route==='room')this.drawRoom();
  else{this.drawHeader();switch(this.route){case'lobby':this.drawLobby();break;case'gallery':this.drawGallery();break;case'tasks':this.drawTasks();break;case'supplies':this.drawSupplies();break;case'collection':this.drawCollection();break;default:this.drawPolicy();}}
  if(this.modal)this.drawModal();
  if(this.message&&Date.now()<=this.messageUntil)this.drawNotice();
  if(this.busy){s.panel({x:s.w/2-72,y:this.platform.viewport().top+6,w:144,h:28},'cream');s.text('正在处理…',s.w/2-42,this.platform.viewport().top+12,13,this.colors.ink);}
 }
 private drawBoot(){const s=this.stage,y=s.h*.25;s.icon('avatar',{x:s.w/2-40,y:y-65,w:80,h:80});s.text(this.platform.config.gameName,24,y+38,26,this.colors.ink,700,s.w-48);this.paragraph(this.message||'正在连接游戏…',24,y+84,s.w-48,16);s.button({x:32,y:y+165,w:s.w-64,h:44},'重新连接',()=>void this.run(async()=>{await this.client.start();this.ready=true;this.message='';await this.loadLobby();}),{tone:'berry'});}
 private drawHeader(){
  const s=this.stage,p=this.client.profile,safe=this.platform.viewport().top,top=safe+12,wide=s.w>=640&&s.h>560,small=s.w<360;
  if(this.platform.config.id==='wechat'&&safe>=30)s.text(this.platform.config.gameName,14,safe-26,13,this.colors.ink,700,Math.max(100,s.w-160));
  const line=(y:number)=>{s.ctx.fillStyle='#c99586';s.ctx.fillRect(12,Math.round(y),s.w-24,1);};
  const energy=(x:number,y:number,width:number,size=16)=>{s.icon('lightning',{x,y:y+3,w:22,h:31});const label=p?p.energy+'/'+p.energyCap:'—/—',tw=Math.min(s.measure(label,size,800),Math.max(33,width-49));s.text(label,x+25,y+12,size,this.colors.ink,800,tw+1);s.frame({x:x+29+tw,y:y+10,w:19,h:21},'plus-gold-normal');s.text('+',x+33+tw,y+11,17,'#fffaf0',700);s.hit({x,y,w:width,h:42},()=>this.navigate('supplies'));};
  if(this.route==='lobby'||this.route==='gallery'){
   let y=top;const gallery=this.route==='gallery';
   if(gallery){s.button({x:12,y,w:32,h:32},'',()=>this.back(),{icon:'back'});s.text('创建房间',53,y+3,small?22:24,this.colors.ink,800,s.w-157);s.button({x:s.w-106,y,w:94,h:32},'券 '+(p?.supply.create??0),()=>this.navigate('supplies'),{tone:'linen',icon:'ticket',fontSize:12});line(y+37);y+=43;}
   const h=wide?74:56,avatar=wide?64:small?43:49,playerWidth=gallery?(small?127:151):wide?174:small?96:110;
   if(!gallery)line(y);s.icon('avatar',{x:12,y:y+3,w:avatar,h:h-5});s.hit({x:12,y,w:playerWidth,h},()=>this.showModal('settings'));
   const lx=12+avatar+4,lw=gallery?small?66:85:wide?92:small?42:55;
   s.text('Lv.'+(p?.level??'—'),lx,y+5,wide?23:small?14:16,this.levelColor(p?.level??0),800,lw);s.meter({x:lx,y:y+(wide?36:28),w:lw,h:8},p?p.xp/Math.max(1,p.xpToNext):0);s.text(p?p.xp+' / '+p.xpToNext:'—',lx,y+(wide?48:40),wide?12:10,this.colors.ink,500,lw+8);
   if(gallery){energy(12+playerWidth,y+5,Math.min(135,s.w-playerWidth-60),wide?20:16);s.icon('sprig',{x:s.w-45,y:y+h-39,w:30,h:28});}
   else{const supplyWidth=wide?103:small?61:72,taskWidth=wide?86:small?46:54,supplyX=s.w-12-supplyWidth,taskX=supplyX-taskWidth,ex=12+playerWidth+4;
    energy(ex,y+(h-43)/2,taskX-ex-4,wide?22:small?14:16);
    s.ctx.fillStyle='#c99586';s.ctx.fillRect(taskX-4,y+7,1,h-14);s.ctx.fillRect(supplyX-4,y+7,1,h-14);
    const iy=y+(h-33)/2,tw=wide?34:small?23:27;s.icon('gift',{x:taskX,y:iy,w:tw,h:33});s.text('任务',taskX+tw+1,y+(h-12)/2,wide?16:small?10:12,this.colors.ink,750);s.hit({x:taskX,y,w:taskWidth,h},()=>this.navigate('tasks'));
    if((p?.giftCount??0)>0){s.ctx.fillStyle='#b46177';s.ctx.fillRect(taskX+tw-3,iy-2,13,13);s.text(Math.min(99,p?.giftCount??0),taskX+tw,iy-1,9,'#fff9ec',700);}
    const sw=wide?44:small?28:33;s.icon('store',{x:supplyX,y:iy,w:sw,h:34});s.text('补给站',supplyX+sw+2,y+(h-12)/2,wide?16:small?10:12,this.colors.ink,750);s.hit({x:supplyX,y,w:supplyWidth,h},()=>this.navigate('supplies'));
    s.icon('sprig',{x:s.w-30,y:y-14,w:18,h:18});
   }
   line(y+h);this.bodyTop=y+h+9;return;
  }
  const title=this.route==='tasks'?'任务与礼包':this.route==='supplies'?'补给站':this.route==='collection'?'我的收藏':this.route==='privacy'?'隐私说明':this.route==='terms'?'服务说明':'玩法与设置';
  s.button({x:12,y:top,w:32,h:34},'',()=>this.back(),{icon:'back'});s.text(title,53,top+6,this.route==='collection'&&small?20:23,this.colors.ink,800,this.route==='collection'?s.w-220:s.w-112);
  if(this.route==='collection'){const c=this.collection?.wallet??p?.collection;const coin=String(c?.coins??0),fragment=String(c?.fragments??0),fx=s.w-67,cx=fx-Math.max(61,s.measure(coin,12,700)+26);s.icon('coin',{x:cx,y:top+7,w:20,h:22});s.text(coin,cx+23,top+11,12,this.colors.ink,700,fx-cx-25);s.icon('fragment',{x:fx,y:top+7,w:19,h:22});s.text(fragment,fx+22,top+11,12,this.colors.ink,700,42);}
  else if(this.route==='supplies'){energy(Math.max(151,s.w-169),top-1,104,small?13:15);s.icon('ticket',{x:s.w-58,y:top+5,w:24,h:25});s.text(p?.supply.create??0,s.w-30,top+12,13,this.colors.ink,700);}
  else s.button({x:s.w-52,y:top+1,w:38,h:32},'设置',()=>this.showModal('settings'),{fontSize:10});
  line(top+46);this.bodyTop=top+59;
 }

 private levelColor(level:number){return level>=1000?'#a34f8c':level>=500?'#4a4277':level>=300?'#ac5f82':level>=180?'#9971a7':level>=120?'#b6863c':level>=80?'#758795':level>=50?'#b16984':level>=30?'#ad843b':level>=20?'#8c6bac':level>=10?'#638ca7':level>=5?'#749866':this.colors.ink;}
 private drawNotice(){const s=this.stage,w=Math.min(s.w-24,520),lines=Math.ceil(this.message.length/Math.max(10,Math.floor((w-26)/13))),h=Math.min(104,34+Math.max(0,lines-1)*19);s.panel({x:(s.w-w)/2,y:s.h-this.platform.viewport().bottom-h-12,w,h},'cream');this.paragraph(this.message,(s.w-w)/2+12,s.h-this.platform.viewport().bottom-h, w-24,13);}
 private paragraph(text:string,x:number,y:number,w:number,size=14,color=this.colors.muted){this.stage.ctx.font=size+'px '+this.stage.font;let line='',cy=y;for(const char of text){if(char==='\n'||this.stage.ctx.measureText(line+char).width>w){this.stage.text(line,x,cy,size,color);line=char==='\n'?'':char;cy+=size*1.65;}else line+=char;}if(line)this.stage.text(line,x,cy,size,color);return cy+size*1.65;}
 private button(x:number,y:number,w:number,label:string,action:()=>void,tone='cream',h=38,disabled=false){this.stage.button({x,y,w,h},label,action,{tone,disabled:this.busy||disabled,fontSize:13});}
 private rowOptions<T extends string|number>(options:readonly (readonly[T,string])[],value:T,x:number,y:number,w:number,change:(value:T)=>void,h=34){this.stage.segments({x,y,w,h},options,value,change);}

 private scrolled(draw:()=>void,top=this.bodyTop,bottom=this.bodyBottom){this.stage.clip({x:0,y:top,w:this.stage.w,h:Math.max(0,bottom-top)},draw);const next=clamp(this.scroll,0,Math.max(0,this.extent-(bottom-top)));if(next!==this.scroll){this.scroll=next;this.invalidate();}}
 private cardImage(src:string,r:Rect){this.stage.frame(r,'panel-cream');this.stage.image(this.client.asset(src),{x:r.x+6,y:r.y+6,w:r.w-12,h:r.h-12},'cover');this.stage.ornaments(r);}

 private drawLobby(){
  const s=this.stage,narrow=s.w<360,landscape=s.w>s.h,short=landscape&&s.h<=560,large=s.w>=640&&!short,margin=narrow?9:12,width=Math.min(1120,s.w-2*margin),left=(s.w-width)/2;
  let y=this.bodyTop;const titleSize=large?30:short?25:narrow?20:23,titleIcon=large?34:narrow?25:28,titleWidth=titleIcon+5+s.measure('拼图大厅',titleSize,800),collectionWidth=large?67:48,headingHeight=large?44:short?36:34;
  s.icon('piece',{x:left,y:y+(headingHeight-titleIcon)/2,w:titleIcon,h:titleIcon});s.text('拼图大厅',left+titleIcon+5,y+(headingHeight-titleSize)/2-1,titleSize,this.colors.ink,800);
  const dailyX=left+titleWidth+(narrow?4:7),dailyWidth=Math.min(large?181:short?149:narrow?117:125,width-titleWidth-collectionWidth-14),dailyHeight=large?38:32;
  this.drawPictureButton({x:dailyX,y:y+(headingHeight-dailyHeight)/2,w:dailyWidth,h:dailyHeight},'每日拼图 · 108片',()=>void this.launch({mode:'daily',pieces:108,visibility:'public'}),'gold','daily',large?15:narrow?10:11,large?20:14,this.busy||!this.client.profile);
  const collectionX=left+width-collectionWidth;s.icon('book',{x:collectionX,y:y+(headingHeight-27)/2,w:25,h:27});s.text('收藏',collectionX+27,y+(headingHeight-(large?16:12))/2,large?16:12,this.colors.ink,800);s.hit({x:collectionX,y,w:collectionWidth,h:headingHeight},()=>this.navigate('collection'));
  y+=headingHeight+6;const groupGap=narrow?5:8,filterGroup=(width-groupGap)*1.18/2.18,filterButton=large?95:narrow?29:58,filterGap=narrow?5:8,controlHeight=large?40:short?36:35,railHeight=large?38:33;
  s.segments({x:left,y:y+(controlHeight-railHeight)/2,w:filterGroup-filterButton-filterGap,h:railHeight},directions.slice(0,3),this.direction,v=>this.changeDirection(v));
  this.drawPictureButton({x:left+filterGroup-filterButton,y:y+(controlHeight-railHeight)/2,w:filterButton,h:railHeight},narrow?'':'筛选',()=>this.showModal('filters'),this.filterCount||this.activeOnly||this.direction==='square'?'berry':'linen','filter',large?15:11,large?18:13);
  const actionX=left+filterGroup+groupGap,actionGap=6,actionWidth=(width-filterGroup-groupGap-actionGap)/2,actionFont=large?16:narrow?10:11;
  this.drawPictureButton({x:actionX,y,w:actionWidth,h:controlHeight},'快速加入',()=>{const room=this.rooms.find(room=>room.players<8&&room.acceptingNew!==false&&!room.completed);if(room)void this.enterRoom(room.id);else this.note('暂时没有可加入的房间，可以创建一间');},'berry','players',actionFont,narrow?12:large?22:16,this.lobbyLoading);
  this.drawPictureButton({x:actionX+actionWidth+actionGap,y,w:actionWidth,h:controlHeight},'创建房间',()=>this.navigate('gallery'),'cream','create',actionFont,narrow?12:large?22:16);
  this.bodyTop=y+controlHeight+9;const columns=!landscape?2:short?Math.max(2,Math.floor((width+10)/170)):s.w>=1000?4:s.w>=640?3:2,gap=large?15:10,rowGap=large?15:9,cw=(width-gap*(columns-1))/columns,imageHeight=(cw-12)/1.12,ch=imageHeight+76;
  this.extent=Math.ceil(this.rooms.length/columns)*(ch+rowGap)+(this.lobbyCursor?60:18);
  this.scrolled(()=>{this.rooms.forEach((room,index)=>{const x=left+(index%columns)*(cw+gap),cy=this.bodyTop+Math.floor(index/columns)*(ch+rowGap)-this.scroll;if(cy+ch<this.bodyTop||cy>this.bodyBottom)return;
   const photo=photoMap.get(room.imageId),total=room.actualPieces??room.pieces,percent=clamp(Math.round(room.placed/Math.max(1,total)*100),0,100),art={x:x+6,y:cy+6,w:cw-12,h:imageHeight};s.frame({x,y:cy,w:cw,h:ch},'panel-cream');s.ctx.fillStyle=this.colors.cream;s.ctx.fillRect(x+6,cy+6,cw-12,ch-12);if(photo)s.image(this.client.asset(photo.thumbSrc),art);s.ornaments(art,20);
   const copyY=cy+imageHeight+13;s.text(room.title,x+11,copyY,narrow?15:16,this.colors.ink,800,cw-22);const metaY=copyY+23;s.icon('piece',{x:x+11,y:metaY,w:15,h:17});s.text(total+'片',x+29,metaY+2,12);const peopleX=x+Math.max(64,cw*.37);s.icon('person',{x:peopleX,y:metaY,w:12,h:17},'#896c63');s.text(room.players+'/8',peopleX+15,metaY+2,12);s.text(percent+'%',x+cw-32,metaY+4,10,this.colors.ink,800);
   s.meter({x:x+11,y:cy+ch-16,w:cw-22,h:8},percent/100);if(room.players>=8||room.acceptingNew===false){s.ctx.fillStyle='#6f374edb';s.ctx.fillRect(art.x,art.y+art.h-23,art.w,23);s.text(room.players>=8?'已满员':'暂停加入',art.x+8,art.y+art.h-18,11,'#fff9f0',700);}
   s.hit({x,y:cy,w:cw,h:ch},()=>{if(room.players>=8)this.note('房间已满，请选择其他房间');else if(room.acceptingNew===false||room.completed)this.note('房间暂不接受加入');else void this.enterRoom(room.id);});});
   if(!this.rooms.length){const emptyY=this.bodyTop+28;s.icon('players',{x:left+width/2-22,y:emptyY,w:44,h:44});const message=this.lobbyLoading?'正在寻找拼图桌面…':'等你开第一桌';s.text(message,left+(width-s.measure(message,17,800))/2,emptyY+57,17,this.colors.ink,800);if(!this.lobbyLoading)this.drawPictureButton({x:left+width/2-75,y:emptyY+92,w:150,h:38},'创建房间',()=>this.navigate('gallery'),'berry','create',13,18);this.extent=200;}
   if(this.lobbyCursor)this.button(left+18,this.bodyTop+this.extent-54-this.scroll,width-36,this.lobbyLoading?'加载中…':'加载更多',()=>void this.loadLobby(true),'cream',38,this.lobbyLoading);
  });
 }
 private drawGallery(){
  const s=this.stage,narrow=s.w<360,landscape=s.w>s.h,short=landscape&&s.h<=560,large=s.w>=640&&!short,margin=narrow?9:12,width=Math.min(1120,s.w-margin*2),left=(s.w-width)/2,controlHeight=large?38:33,controlGap=narrow?6:9,directionWidth=(width-controlGap)*(narrow?.77:.83)/2;
  let y=this.bodyTop;s.segments({x:left,y,w:directionWidth,h:controlHeight},directions.slice(0,3),this.direction,v=>{this.selected=null;this.changeDirection(v);});const countX=left+directionWidth+controlGap,countWidth=(width-directionWidth-controlGap-12)/4;
  counts.forEach((count,i)=>this.drawPictureButton({x:countX+i*(countWidth+4),y,w:countWidth,h:controlHeight},String(count),()=>{this.pieces=count;this.invalidate();},this.pieces===count?'berry':'linen','piece',large?16:narrow?10:11,narrow?10:large?17:12,false,this.pieces===count));
  y+=controlHeight+5;const filterWidth=large?38:27,sourceGap=6,sourceSpace=width-filterWidth-3*sourceGap,sourceSpecs=[['free','免费图库','underlay',1.1],['owned','我的图包','bag',1.05],['all','全部','tools',.7]] as const;let sourceX=left;
  for(const [value,label,icon,weight]of sourceSpecs){const sw=sourceSpace*weight/2.85;this.drawPictureButton({x:sourceX,y,w:sw,h:large?38:32},label,()=>{this.source=value;this.packId=null;this.selected=null;this.scroll=0;this.invalidate();},this.source===value?'berry':'linen',icon,large?15:12,large?21:16,false,this.source===value);sourceX+=sw+sourceGap;}
  this.drawPictureButton({x:left+width-filterWidth,y,w:filterWidth,h:large?38:32},'',()=>this.showModal('filters'),this.category!=='全部'||this.search||this.direction==='square'?'berry':'linen','filter',11,15);y+=(large?38:32)+6;
  const owned=new Set(this.client.profile?.collection?.ownedImageIds??[]),pack=this.packId?(this.collection?.packs.find(p=>p.id===this.packId)??collectionCatalog.packs.find(p=>p.id===this.packId)):null;if(pack){s.icon('book',{x:left+2,y,w:23,h:25});s.text(pack.title,left+30,y+5,12,this.colors.ink,700,width-127);s.text('查看所有图包',left+width-88,y+6,11,this.colors.muted);s.hit({x:left+width-96,y,w:96,h:30},()=>{this.packId=null;this.selected=null;this.scroll=0;this.invalidate();});y+=34;}
  this.bodyTop=y;const photos=this.availableGallery().filter(photo=>(this.direction==='all'||orientation(photo.id)===this.direction)&&(this.category==='全部'||this.category===photo.category)&&photo.title.includes(this.search)&&(!pack||pack.imageIds.includes(photo.id))&&(this.source==='all'||this.source==='free'&&!this.packedIds.has(photo.id)||this.source==='owned'&&owned.has(photo.id))),columns=!landscape?2:short?Math.max(2,Math.floor((width+10)/170)):s.w>=1000?4:s.w>=640?3:2,gap=large?15:10,rowGap=large?15:9,cw=(width-gap*(columns-1))/columns,imageHeight=(cw-12)/1.38,captionHeight=narrow?47:30,ch=imageHeight+captionHeight+12,dockHeight=short?80:131,bottom=s.h-this.platform.viewport().bottom-dockHeight-9;this.bodyBottom=bottom;this.extent=Math.ceil(photos.length/columns)*(ch+rowGap)+12;
  this.scrolled(()=>{photos.forEach((photo,index)=>{const x=left+(index%columns)*(cw+gap),cy=y+Math.floor(index/columns)*(ch+rowGap)-this.scroll;if(cy+ch<y||cy>bottom)return;const selected=this.selected===photo.id,art={x:x+6,y:cy+6,w:cw-12,h:imageHeight};s.frame({x,y:cy,w:cw,h:ch},selected?'panel-gold':'panel-cream');s.ctx.fillStyle=selected?'#fff3e7':this.colors.cream;s.ctx.fillRect(x+6,cy+6,cw-12,ch-12);s.image(this.client.asset(photo.thumbSrc),art);s.ornaments(art,20);
   if(selected){s.frame({x:art.x+5,y:art.y+5,w:27,h:27},'segment-berry-selected');s.icon('check',{x:art.x+10,y:art.y+10,w:17,h:17},'#fff9ed');}
   const label=owned.has(photo.id)?'已拥有':this.packedIds.has(photo.id)?'图包':'随机免费',labelWidth=label.length*10+10,labelX=x+cw-labelWidth-10,captionY=cy+imageHeight+12;s.text(photo.title,x+10,captionY,narrow?14:large?17:15,this.colors.ink,800,narrow?cw-20:Math.max(32,cw-labelWidth-28));const tagY=narrow?captionY+21:captionY-1;s.ctx.fillStyle=owned.has(photo.id)?'#cc8996':'#f2d5ad';s.ctx.fillRect(labelX,tagY,labelWidth,18);s.text(label,labelX+5,tagY+3,10,owned.has(photo.id)?'#fff8ec':'#674625',700);s.hit({x,y:cy,w:cw,h:ch},()=>{this.selected=photo.id;this.invalidate();});});if(!photos.length){const message=this.source==='owned'?'收藏一个喜欢的图包':'换个条件试试';s.icon(this.source==='owned'?'book':'underlay',{x:left+width/2-26,y:y+20,w:52,h:52});s.text(message,left+(width-s.measure(message,17,800))/2,y+85,17,this.colors.ink,800);this.drawPictureButton({x:left+width/2-85,y:y+122,w:170,h:36},this.source==='owned'?'前往主题图包':'查看全部图片',()=>{if(this.source==='owned'){this.collectionTab='packs';this.navigate('collection');}else{this.direction='all';this.category='全部';this.search='';this.source='all';this.packId=null;this.scroll=0;this.invalidate();}},'cream','book',12,17);this.extent=190;}},y,bottom);
  const dockWidth=Math.min(short?1120:700,width),dockX=(s.w-dockWidth)/2,dockY=bottom+7,dockInner=dockWidth-24,photo=this.selected?photoMap.get(this.selected):null,freeOwned=!!this.selected&&owned.has(this.selected)&&this.visibility==='public',freeFirst=!!this.client.profile?.firstSelectionAvailable,available=(this.client.profile?.supply.create??0)>0,roomCount=this.client.profile?.ownedRooms.length??0;
  s.frame({x:dockX,y:dockY,w:dockWidth,h:dockHeight},'panel-cream');const actionW=short?(dockInner-(s.w>730?355:165)-14):Math.floor((dockInner-9)/2.35),actionX=dockX+dockWidth-12-actionW,optionsW=short?158:actionX-dockX-25,optionsX=dockX+12,optionsY=dockY+10;
  const manageWidth=25,optionGap=4,optionWidth=(optionsW-manageWidth-2*optionGap)/2;this.drawPictureButton({x:optionsX,y:optionsY,w:optionWidth,h:31},'公开',()=>{this.visibility='public';this.invalidate();},this.visibility==='public'?'berry':'linen','players',11,narrow?11:13,false,this.visibility==='public');this.drawPictureButton({x:optionsX+optionWidth+optionGap,y:optionsY,w:optionWidth,h:31},'私人',()=>{this.visibility='private';this.invalidate();},this.visibility==='private'?'berry':'linen','lock',11,narrow?11:13,false,this.visibility==='private');s.text(roomCount+'/3',optionsX+optionsW-manageWidth+2,optionsY+11,10,this.colors.muted);s.hit({x:optionsX+optionsW-manageWidth,y:optionsY,w:manageWidth,h:31},()=>this.showModal('manage'));
  if(!short||s.w>730){const previewX=short?optionsX+177:optionsX,previewY=short?dockY+12:dockY+53,previewW=short?167:optionsW,thumbSize=narrow?34:short?45:48;if(photo){s.frame({x:previewX,y:previewY,w:thumbSize,h:thumbSize},'plus-cream-normal');s.image(this.client.asset(photo.thumbSrc),{x:previewX+3,y:previewY+3,w:thumbSize-6,h:thumbSize-6});s.text(photo.title,previewX+thumbSize+6,previewY+3,narrow?11:13,this.colors.ink,800,previewW-thumbSize-7);s.text(this.pieces+'片',previewX+thumbSize+6,previewY+21,10,this.colors.muted);s.text(freeOwned?'已拥有':freeFirst?'首次免费':'建房券 ×1',previewX+thumbSize+6,previewY+36,10,this.colors.muted,previewW-thumbSize-7);}else{s.icon('piece',{x:previewX,y:previewY+8,w:24,h:27});this.paragraph('点选一张喜欢的图片',previewX+29,previewY+8,previewW-31,11);}}
  s.ctx.strokeStyle='#d5ac99';s.ctx.lineWidth=1;s.ctx.beginPath();s.ctx.moveTo(actionX-8,dockY+10);s.ctx.lineTo(actionX-8,dockY+dockHeight-12);s.ctx.stroke();
  const createLabel=roomCount>=3?'管理房间':freeOwned?'创建公开房间':freeFirst?'首次免费创建':available?'用券创建房间':'广告领建房券',createAction=()=>{if(roomCount>=3){this.showModal('manage');return;}if(!this.selected){this.note('先选择一张图片');return;}if(freeOwned||freeFirst||available)void this.launch({mode:'selected',pieces:this.pieces,visibility:this.visibility,imageId:this.selected});else void this.claimSupply('create');},createW=short?(actionW-6)/2:actionW,createH=short?52:49,createY=dockY+10;
  this.drawPictureButton({x:actionX,y:createY,w:createW,h:createH},createLabel,createAction,'berry',freeOwned||freeFirst||available?'players':'video',narrow?10:11,short?15:16,this.busy||!this.client.profile);this.drawPictureButton({x:short?actionX+createW+6:actionX,y:short?createY:createY+createH+7,w:short?createW:actionW,h:short?createH:35},'随机公开房 · 免费',()=>void this.launch({mode:'random',pieces:this.pieces,visibility:'public',direction:this.direction}),'cream','dice',narrow?9:11,narrow?11:15,this.busy||!this.client.profile);
 }
 private drawPictureButton(r:Rect,label:string,fn:()=>void,tone='cream',icon='',fontSize=11,iconSize=16,disabled=false,selected=false){
  const s=this.stage,c=s.ctx;c.save();if(selected){s.frame(r,'button-'+tone+'-'+(disabled?'disabled':'selected'));if(!disabled)s.hit(r,fn);}else s.button(r,'',fn,{tone,disabled});const textColor=disabled?'#9d7b7b':tone==='berry'||tone==='gold'?'#fffaf0':this.colors.ink,gap=label&&icon?3:0,contentWidth=s.measure(label,fontSize,750)+(icon?iconSize:0)+gap,start=r.x+(r.w-contentWidth)/2;if(icon)s.icon(icon,{x:start,y:r.y+(r.h-iconSize)/2,w:iconSize,h:iconSize},disabled?'#9d7b7b':tone==='berry'||tone==='gold'?'#fffaf0':icon==='create'?this.colors.gold:undefined);if(label)s.text(label,start+(icon?iconSize+gap:0),r.y+(r.h-fontSize)/2-1,fontSize,textColor,750);c.restore();
 }
 private drawTasks(){
  const s=this.stage,data=this.tasks,p=this.client.profile,y=this.bodyTop,pad=12,w=s.w-pad*2,compact=s.w<360;
  s.icon('avatar',{x:pad,y,w:47,h:44});s.text('Lv.'+(p?.level??'—'),pad+53,y+1,15,this.colors.ink,700);s.meter({x:pad+53,y:y+22,w:60,h:7},(p?.xp??0)/Math.max(1,p?.xpToNext??1));s.text((p?.xp??0)+'/'+(p?.xpToNext??1),pad+53,y+32,9,this.colors.muted);
  const energyX=s.w-(compact?174:196);s.icon('lightning',{x:energyX,y:y+6,w:22,h:31});s.text((p?.energy??'—')+'/'+(p?.energyCap??'—'),energyX+25,y+13,compact?13:15,this.colors.ink,700);s.hit({x:energyX,y,w:85,h:42},()=>this.navigate('supplies'));
  const tx=s.w-103;s.icon('gift',{x:tx,y:y+7,w:25,h:29});s.text('任务',tx+27,y+15,10,this.colors.ink,700);s.hit({x:tx,y,w:50,h:42},()=>{this.taskTab='tasks';this.scroll=0;this.invalidate();});s.icon('store',{x:s.w-52,y:y+7,w:26,h:29});s.hit({x:s.w-54,y,w:45,h:42},()=>this.navigate('supplies'));
  s.ctx.fillStyle=this.colors.line;s.ctx.fillRect(pad,y+49,w,1);
  const ty=y+59,tw=(w-6)/2;
  s.button({x:pad,y:ty,w:tw,h:38},'任务',()=>{this.taskTab='tasks';this.scroll=0;this.invalidate();},{tone:this.taskTab==='tasks'?'berry':'linen',icon:'daily',fontSize:17});
  s.button({x:pad+tw+6,y:ty,w:tw,h:38},'我的礼包',()=>{this.taskTab='gifts';this.scroll=0;this.invalidate();},{tone:this.taskTab==='gifts'?'berry':'linen',icon:'giftFlat',fontSize:17});
  if((data?.giftCount??0)>0){const count=String(Math.min(99,data!.giftCount));s.ctx.fillStyle=this.colors.rose;s.ctx.beginPath();s.ctx.arc(s.w-38,ty+2,9,0,Math.PI*2);s.ctx.fill();s.text(count,s.w-38-s.measure(count,10)/2,ty-4,10,'#fff9ef',700);}
  this.bodyTop=ty+47;if(!data){s.text('正在整理任务与礼包…',pad+8,this.bodyTop+25,14);this.extent=0;return;}
  let cy=this.bodyTop-this.scroll;
  const gifts=data.inventory.filter(gift=>gift.count>0),full=(p?.energy??0)>=(p?.energyCap??1);
  const drawGift=(gift:typeof gifts[number])=>{const r={x:pad,y:cy,w,h:88},art=gift.effect==='full-energy'?'refillGift':gift.kind.startsWith('ten')?'pouch':gift.kind.startsWith('friend')?'goldGift':'xpChest';s.panel(r);s.icon(art,{x:pad+10,y:cy+14,w:57,h:58});const bx=s.w-(compact?99:117),bw=compact?86:103;
   s.text(gift.title+' ×'+gift.count,pad+76,cy+23,compact?13:15,this.colors.ink,700,bx-pad-82);s.text(gift.effect==='full-energy'?'恢复至当前体力上限':'体力 +'+gift.energyMin+(gift.energyMax!==gift.energyMin?'～'+gift.energyMax:'')+(gift.xp?' · 经验 +'+gift.xp:''),pad+76,cy+49,10,this.colors.muted,Math.max(60,bx-pad-81));
   this.button(bx,cy+27,bw,gift.effect==='full-energy'?(full?'体力已满':'使用1份'):'开启1份',()=>void this.openGift(gift.kind),'berry',35,gift.effect==='full-energy'&&full);cy+=99;};
  const drawTask=(task:typeof data.tasks[number])=>{const r={x:pad,y:cy,w,h:99},rewardW=compact?91:110,divider=s.w-pad-rewardW-9,art=task.group==='invitation'||task.group==='friend'?'friendArt':'cooperationArt';s.panel(r);s.ornaments(r,16);s.icon(art,{x:pad+8,y:cy+25,w:compact?51:60,h:59});const cx=pad+(compact?65:76),copyW=divider-cx-7,title=task.group==='invitation'?'好友加入':task.group==='friend'?'好友默契':'一起拼图';
   s.text(title,cx,cy+17,compact?14:16,this.colors.ink,700,copyW);s.text(task.group==='invitation'?'好友完成3次有效拼合':'完成'+task.target+'次'+(task.group==='friend'?'好友':'协作')+'拼合',cx,cy+44,10,this.colors.muted,copyW);const label=Math.min(task.progress,task.target)+'/'+task.target+(task.group==='invitation'?'人':'');const lw=s.measure(label,10);s.meter({x:cx,y:cy+72,w:Math.max(26,copyW-lw-6),h:8},task.progress/Math.max(1,task.target));s.text(label,divider-lw-5,cy+69,10);
   s.ctx.fillStyle='#ddbdac';s.ctx.fillRect(divider,cy+12,1,75);const rx=divider+9,rw=s.w-pad-rx-9;
   if(task.effect==='full-energy'){s.icon('refillGift',{x:rx,y:cy+17,w:28,h:28});s.text('补满体力包×1',rx+31,cy+26,compact?8:9,this.colors.ink,500,rw-27);}else{s.icon('lightning',{x:rx+3,y:cy+11,w:17,h:23});s.text('+'+task.energy,rx+26,cy+16,16,this.colors.ink,700);if(task.xp){s.icon('xpStar',{x:rx+3,y:cy+36,w:18,h:18});s.text('+'+task.xp,rx+26,cy+36,16,this.colors.ink,700);}}
   this.button(rx,cy+60,rw,task.group==='invitation'?'邀请好友 ›':task.earned?'已存入':'进行中',()=>task.group==='invitation'?this.showModal('invite'):(this.taskTab='gifts',this.scroll=0,this.invalidate()),'berry',32,task.group!=='invitation'&&!task.earned);cy+=111;};
  this.scrolled(()=>{if(this.taskTab==='tasks'){
   s.panel({x:pad,y:cy,w,h:46});s.text('拼合奖励',pad+9,cy+16,11,this.colors.ink,700);const slotX=pad+61,slotW=(w-129)/10;for(let i=0;i<10;i++)s.icon('piece',{x:slotX+i*slotW,y:cy+13,w:slotW-2,h:19},i<data.giftProgress?this.colors.rose:'#e8c9b8');s.text(data.giftProgress+'/10',s.w-pad-62,cy+16,11,this.colors.ink,700);s.icon('gift',{x:s.w-pad-34,y:cy+8,w:27,h:30});s.hit({x:pad,y:cy,w,h:46},()=>{this.taskTab='gifts';this.scroll=0;this.invalidate();});cy+=58;
   const cooperative=data.tasks.filter(t=>t.group==='cooperation'),featured=cooperative.find(t=>!t.earned)??cooperative.at(-1),invitation=data.tasks.find(t=>t.group==='invitation');if(invitation)drawTask(invitation);if(featured)drawTask(featured);
   s.icon('gift',{x:pad,y:cy+1,w:23,h:24});s.text('已存礼包',pad+30,cy+4,17,this.colors.ink,700);s.ctx.fillStyle=this.colors.line;s.ctx.fillRect(pad+107,cy+13,Math.max(5,w-171),1);s.text('全部 '+data.giftCount+' ›',s.w-pad-57,cy+7,10);s.hit({x:s.w-95,y:cy-4,w:83,h:32},()=>{this.taskTab='gifts';this.scroll=0;this.invalidate();});cy+=34;
   if(gifts.length)gifts.slice(0,3).forEach(drawGift);else{s.panel({x:pad,y:cy,w,h:67});s.icon('pouch',{x:pad+10,y:cy+8,w:49,h:49});s.text('每10次有效拼合，存入一份小礼',pad+66,cy+25,11,this.colors.muted,w-77);cy+=80;}
   const others=data.tasks.filter(t=>(t.group==='friend'||t.group==='cooperation')&&t!==featured);if(others.length){s.ctx.fillStyle=this.colors.line;s.ctx.fillRect(pad,cy,w,1);s.icon('players',{x:pad,y:cy+15,w:16,h:16});s.text('全部协作任务',pad+23,cy+17,12,this.colors.muted,700);s.text(this.taskDetailsOpen?'−':'+',s.w-pad-14,cy+13,20,this.colors.rose,700);s.hit({x:pad,y:cy,w,h:43},()=>{this.taskDetailsOpen=!this.taskDetailsOpen;this.invalidate();});cy+=46;if(this.taskDetailsOpen)others.forEach(drawTask);}
   s.ctx.fillStyle=this.colors.line;s.ctx.fillRect(pad,cy,w,1);s.icon('invite',{x:pad,y:cy+17,w:16,h:16});s.text('邀请详情与邀请码',pad+24,cy+18,12,this.colors.muted,700);s.text('+',s.w-pad-13,cy+15,20,this.colors.rose,700);s.hit({x:pad,y:cy,w,h:45},()=>this.showModal('invite'));cy+=55;
  }else{s.icon('gift',{x:pad,y:cy+3,w:25,h:27});s.text('存下的小确幸',pad+32,cy+8,18,this.colors.ink,700);cy+=40;s.text('礼包可积累，需要时再开启',pad,cy,12,this.colors.muted);cy+=29;if(gifts.length)gifts.forEach(drawGift);else{s.icon('xpChest',{x:s.w/2-52,y:cy+30,w:104,h:90});s.text('礼包正在路上',s.w/2-60,cy+138,18,this.colors.ink,700);s.text('继续拼图，礼包会自动存到这里',s.w/2-101,cy+172,12,this.colors.muted);cy+=228;}this.button(pad,cy,w,'继续拼图',()=>this.back(),'berry',39);cy+=52;}
  });this.extent=cy-(this.bodyTop-this.scroll)+12;
 }
 private drawSupplies(){
  const s=this.stage,p=this.client.profile,pad=12,w=s.w-pad*2,landscape=s.w>650&&s.w>s.h;let y=this.bodyTop-this.scroll+4;
  this.scrolled(()=>{const cw=landscape?(w-12)/2:w,ch=s.w<360?171:180,start=y;
   for(const [index,[kind,title,description,art,smallArt]]of ([['energy','补满体力包','需要时再开启','supplyEnergy','lightning'],['create','建房券','指定图片或私人房间','supplyTicket','ticket']] as const).entries()){
    const x=pad+(landscape?index*(cw+12):0),cy=start+(landscape?0:index*(ch+12)),r={x,y:cy,w:cw,h:ch},imageW=Math.floor((cw-27)*.54),imageR={x:x+7,y:cy+7,w:imageW,h:ch-14};s.panel(r);s.clip(imageR,()=>{const edge=Math.max(imageR.w,imageR.h);s.icon(art,{x:imageR.x+(imageR.w-edge)/2,y:imageR.y+(imageR.h-edge)/2,w:edge,h:edge});});
    const dx=x+imageW+18,dw=cw-imageW-25,small=cw<330,stock=p?.supply[kind]??0;
    s.icon(smallArt,{x:dx,y:cy+15,w:kind==='energy'?25:31,h:35});s.text(title,dx+(kind==='energy'?27:34),cy+20,small?16:19,this.colors.ink,700,dw-(kind==='energy'?26:33));s.text(description,dx+(kind==='energy'?27:8),cy+49,small?9:10,this.colors.ink,500,dw-(kind==='energy'?25:8));
    s.ctx.fillStyle='#f8e8d8';s.ctx.fillRect(dx,cy+70,dw,27);s.text('库存',dx+Math.max(7,(dw-85)/2),cy+77,12,this.colors.muted);s.text(stock+'/3',dx+Math.max(42,(dw-85)/2+38),cy+74,18,this.colors.ink,700);s.ctx.fillStyle='#e0bbaa';s.ctx.fillRect(dx,cy+109,dw,1);
    s.button({x:dx,y:cy+ch-54,w:dw,h:43},stock>=3?'库存已满':'看广告领取',()=>void this.claimSupply(kind),{tone:'berry',icon:'video',fontSize:small?12:14,disabled:this.busy||stock>=3});s.ornaments(r,17);
   }y=start+(landscape?ch:2*ch+12)+12;
   s.panel({x:pad,y,w,h:40},'linen');s.icon('store',{x:pad+10,y:y+5,w:31,h:28});s.text('已购图包可免费创建公开房间。',pad+49,y+14,11,this.colors.ink,700,w-92);s.icon('sprig',{x:s.w-pad-31,y:y+11,w:22,h:20});y+=52;
   const inventory={x:pad,y,w,h:100};s.panel(inventory);s.icon('bag',{x:pad+13,y:y+11,w:17,h:18},this.colors.ink);s.text('我的库存',pad+37,y+12,18,this.colors.ink,700);s.ctx.fillStyle='#dfbdad';s.ctx.fillRect(pad+9,y+38,w-18,1);
   const slotW=(w-24)*.31,bx=pad+18+slotW*2,bw=s.w-pad-bx-11;
   for(const[index,[kind,label,art]]of ([['energy','体力包','energy'],['create','建房券','ticket']] as const).entries()){const sx=pad+12+index*slotW;s.icon(art,{x:sx,y:y+48,w:31,h:38});s.text(label,sx+35,y+47,10,this.colors.ink,700);s.ctx.fillStyle='#f8e8d8';s.ctx.fillRect(sx+35,y+64,33,21);s.text(p?.supply[kind]??0,sx+44,y+65,17,this.colors.ink,700);if(index===0){s.ctx.fillStyle='#dfbdad';s.ctx.fillRect(sx+slotW-4,y+45,1,43);}}
   this.button(bx,y+48,bw,p&&p.energy>=p.energyCap?'体力已满':'使用体力包',()=>void this.useEnergy(),'berry',42,!p||p.supply.energy===0||p.energy>=p.energyCap);s.ornaments(inventory,17);y+=115;
   const note='提前准备，拼图时随用随取';s.text(note,(s.w-s.measure(note,11))/2,y,11,this.colors.muted);y+=28;
   if(!this.client.config.adRewardEnabled)y=this.paragraph('当前平台广告尚未开放，已有库存可以正常使用。',pad+7,y,w-14,11)+12;
   s.text('回去拼图  →',(s.w-80)/2,y+4,12,this.colors.muted);s.hit({x:pad,y:y-4,w,h:36},()=>this.back());y+=46;
  });this.extent=y-(this.bodyTop-this.scroll)+12;
 }
 private drawCollection(){
  const s=this.stage,data=this.collection,pad=12,w=s.w-pad*2;let y=this.bodyTop;
  if(this.collectionTab==='decorations'&&data){s.icon('avatar',{x:pad,y,w:46,h:47});s.text('Lv.'+data.profile.level,pad+51,y+1,15,this.colors.ink,700);s.meter({x:pad+51,y:y+23,w:58,h:7},data.profile.xp/Math.max(1,data.profile.xpToNext));s.text(data.profile.xp+'/'+data.profile.xpToNext,pad+51,y+35,9,this.colors.muted);y+=56;}
  const tabs=[['albums','图鉴','underlay'],['packs','图包','piece'],['decorations','装饰','leaf']] as const,tw=(w-10)/3;
  tabs.forEach(([id,label,icon],index)=>s.button({x:pad+index*(tw+5),y,w:tw,h:39},label,()=>{this.collectionTab=id;this.scroll=0;this.invalidate();},{tone:this.collectionTab===id?'berry':'linen',icon,fontSize:16}));
  this.bodyTop=y+54;if(!data){s.text('正在翻开收藏…',pad+8,this.bodyTop+32,15);this.extent=0;return;}
  if(this.collectionTab==='albums')this.drawAlbums(data);else if(this.collectionTab==='packs')this.drawPacks(data);else this.drawDecorations(data);
 }
 private drawAlbums(data:MobileCollectionView){
  const s=this.stage,pad=12,w=s.w-24,album=data.albums.find(a=>a.id===this.albumId)??data.albums[0];if(!album){s.text('参与完成作品，点亮第一张图鉴',20,this.bodyTop+35,14);this.extent=0;return;}this.albumId=album.id;let y=this.bodyTop-this.scroll;
  this.scrolled(()=>{const countW=Math.min(122,w*.34),countX=s.w-pad-countW;s.icon('book',{x:pad,y:y+3,w:35,h:32});s.text(album.title,pad+42,y+1,s.w<360?19:23,this.colors.ink,700,countX-pad-50);s.hit({x:pad,y:y-3,w:countX-pad-7,h:45},()=>{this.albumId=data.albums[(data.albums.indexOf(album)+1)%data.albums.length].id;this.scroll=0;this.invalidate();});s.icon('sprig',{x:countX-25,y:y+1,w:18,h:18});s.text(album.description,pad+42,y+35,10,this.colors.muted,countX-pad-40);s.icon('fragment',{x:countX,y:y+2,w:24,h:24});s.text(album.collected+'/'+album.total,countX+31,y+2,23,this.colors.ink,700);s.meter({x:countX,y:y+36,w:countW,h:9},album.collected/Math.max(1,album.total));y+=61;
   const columns=s.w<600?3:Math.max(4,Math.floor(s.w/145)),gap=9,cw=(w-gap*(columns-1))/columns,artH=cw*1.16,ch=artH+55,base=y;
   album.images.forEach((image,index)=>{const x=pad+(index%columns)*(cw+gap),cy=base+Math.floor(index/columns)*(ch+gap),r={x,y:cy,w:cw,h:ch};if(cy+ch<this.bodyTop||cy>this.bodyBottom)return;s.panel(r);const picture={x:x+5,y:cy+5,w:cw-10,h:artH-5};s.image(this.client.asset(image.thumbSrc),picture,'cover');if(!image.collected){s.ctx.fillStyle='rgba(232,212,196,.77)';s.ctx.fillRect(picture.x,picture.y,picture.w,picture.h);s.ctx.fillStyle='#b9848d';s.ctx.fillRect(x+cw/2-12,cy+artH/2-12,24,27);s.icon('lock',{x:x+cw/2-9,y:cy+artH/2-10,w:18,h:22},'#fff9ef');}
    s.text(image.title,x+8,cy+artH+7,s.w<360?10:12,this.colors.ink,700,cw-16);s.ctx.fillStyle=image.collected?'#efd9d6':'#f7e3d5';s.ctx.fillRect(x+8,cy+ch-24,cw-16,17);const label=image.collected?'已收藏':'未收集';s.text(label,x+(cw-s.measure(label,9))/2,cy+ch-21,9,this.colors.muted,700);s.ornaments(r,12);
   });y=base+Math.ceil(album.images.length/columns)*(ch+gap)+5;
   if(album.milestones.length){const r={x:pad,y,w,h:113},final=album.milestones.find(m=>m.decorationId),reward=data.decorations.find(d=>d.id===final?.decorationId),trackW=reward?w*.48:w-18,coins=album.milestones.filter(m=>m.coins>0);s.panel(r);s.ornaments(r,15);s.meter({x:pad+18,y:y+24,w:trackW-26,h:6},album.collected/Math.max(1,album.total));coins.forEach((m,i)=>{const cx=pad+19+(i+.5)*(trackW-23)/Math.max(1,coins.length);s.ctx.fillStyle=this.colors.cream;s.ctx.fillRect(cx-11,y+14,22,23);s.icon(m.earned?'check':'lock',{x:cx-8,y:y+14,w:16,h:22},this.colors.rose);s.text(m.target+'张',cx-10,y+43,11,this.colors.ink,700);s.icon('coin',{x:cx-21,y:y+63,w:20,h:20});s.text(m.coins,cx+2,y+66,11);s.text(m.earned?'已获得':'集齐可得',cx-20,y+91,8,this.colors.muted);});if(reward){const rx=pad+trackW+8,rw=w-trackW-22;s.ctx.fillStyle='#dfbdad';s.ctx.fillRect(rx-4,y+13,1,88);s.ctx.fillStyle=this.colors.rose;s.ctx.fillRect(rx+8,y+16,49,19);s.text(final?.earned?'已获得':'集齐可得',rx+12,y+21,9,'#fff9ed',700);s.text(reward.title,rx+8,y+44,14,this.colors.ink,700,rw-52);s.wrap(reward.description,rx+8,y+69,rw-54,9,this.colors.muted,13);s.icon(reward.artKey,{x:s.w-pad-60,y:y+28,w:49,h:62});}y+=130;}
   y=this.paragraph('有效参与并完成作品即可收集；图鉴奖励达成后自动存入。',pad+9,y,w-18,10)+12;
  });this.extent=y-(this.bodyTop-this.scroll);
 }
 private drawPacks(data:MobileCollectionView){
  const s=this.stage,pad=12,w=s.w-24;let y=this.bodyTop-this.scroll;
  const action=(pack:CollectionPack)=>{if(pack.owned){this.packId=pack.id;this.source='owned';this.navigate('gallery');}else{this.purchase=pack;this.showModal('purchase');}};
  this.scrolled(()=>{const first=data.packs[0];if(first){const remaining=first.images.slice(3),mainH=Math.min(210,w*.45),thumbH=remaining.length?Math.min(100,Math.max(48,(w-28)/remaining.length*.6)):0,h=100+mainH+thumbH+89,r={x:pad,y,w,h};s.panel(r);s.ornaments(r,16);s.text(first.title,pad+14,y+17,23,this.colors.ink,700,w*.48);s.icon('underlay',{x:pad+14,y:y+48,w:15,h:15},this.colors.ink);s.text(first.images.length+'张主题图片',pad+33,y+49,11,this.colors.ink,700);s.wrap(first.description,pad+w*.55,y+23,w*.4,10,this.colors.muted,15);s.icon('sprig',{x:pad+14,y:y+68,w:19,h:18});s.text('永久解锁 · 免费公开建房',pad+37,y+72,10,this.colors.ink,700);
    const ix=pad+14,iy=y+94,iw=w-28,leftW=iw*.62,preview=(index:number,r:Rect)=>{const image=first.images[index];if(!image)return;this.cardImage(image.thumbSrc,r);s.hit(r,()=>this.openPackPreview(first,index));};
    preview(0,{x:ix,y:iy,w:leftW,h:mainH});first.images.slice(1,3).forEach((_image,index)=>preview(index+1,{x:ix+leftW+6,y:iy+index*(mainH/2+3),w:iw-leftW-6,h:mainH/2-3}));
    const thumbGap=7,thumbW=(iw-thumbGap*(remaining.length-1))/Math.max(1,remaining.length);remaining.forEach((_image,index)=>preview(index+3,{x:ix+index*(thumbW+thumbGap),y:iy+mainH+9,w:thumbW,h:thumbH}));
    const previewLabel='点图查看全部 '+first.images.length+' 张  ›';s.text(previewLabel,s.w/2-s.measure(previewLabel,11,700)/2,y+h-77,11,this.colors.ink,700);s.hit({x:ix,y:y+h-83,w:iw,h:27},()=>this.openPackPreview(first));
    s.button({x:s.w/2-89,y:y+h-53,w:178,h:40},first.owned?'已拥有 · 去建房':first.price+' 解锁图包',()=>action(first),{tone:'berry',icon:first.owned?'check':'coin',fontSize:15,disabled:this.busy});y+=h+13;}
   const others=data.packs.slice(1),columns=s.w<640?2:3,gap=12,cw=(w-(columns-1)*gap)/columns,cardH=80+cw*.53+71,base=y;others.forEach((pack,index)=>{const x=pad+index%columns*(cw+gap),cy=base+Math.floor(index/columns)*(cardH+13),r={x,y:cy,w:cw,h:cardH};s.panel(r);s.ornaments(r,15);s.text(pack.title,x+12,cy+15,17,this.colors.ink,700,cw-24);s.icon('underlay',{x:x+12,y:cy+42,w:12,h:12},this.colors.ink);s.text(pack.images.length+'张主题图片',x+27,cy+42,10,this.colors.ink,700,cw-38);const art={x:x+12,y:cy+64,w:cw-24,h:cw*.53};if(pack.images[0]){this.cardImage(pack.images[0].thumbSrc,art);s.hit(art,()=>this.openPackPreview(pack));}
    const label='查看全部 '+pack.images.length+' 张  ›';s.text(label,x+(cw-s.measure(label,11,700))/2,cy+cardH-70,11,this.colors.ink,700,cw-20);s.hit({x:x+8,y:cy+cardH-76,w:cw-16,h:28},()=>this.openPackPreview(pack));
    const by=cy+cardH-46,buttonW=Math.max(69,cw*.52);s.icon('coin',{x:x+10,y:by+10,w:20,h:20});s.text(pack.owned?'✓':String(pack.price),x+33,by+13,12,this.colors.ink,700);s.button({x:x+cw-buttonW-10,y:by,w:buttonW,h:35},pack.owned?'去建房':'解锁图包',()=>action(pack),{tone:'berry',fontSize:11,disabled:this.busy});});y=base+Math.ceil(others.length/columns)*(cardH+13);if(!data.packs.length){s.text('新的画作正在路上',22,y+28,16);y+=100;}
  });this.extent=y-(this.bodyTop-this.scroll)+12;
 }
 private openPackPreview(pack:CollectionPack,index=0){if(!pack.images.length)return;this.previewPack=pack;this.previewIndex=clamp(index,0,pack.images.length-1);this.stage.retryImages();this.showModal('packPreview');}
 private stepPackPreview(delta:number){if(!this.previewPack)return;this.previewIndex=clamp(this.previewIndex+delta,0,this.previewPack.images.length-1);this.modalScroll=0;this.invalidate();}
 private drawDecorations(data:MobileCollectionView){
  const s=this.stage,pad=12,w=s.w-24,decorations=data.decorations.filter(item=>!this.decorationOwnedOnly||item.owned),selected=decorations.find(item=>item.id===this.decorationId)??decorations.find(item=>item.equipped)??decorations[0];let y=this.bodyTop-this.scroll;
  this.scrolled(()=>{s.button({x:pad,y,w:67,h:34},'全部',()=>{this.decorationOwnedOnly=false;this.scroll=0;this.invalidate();},{tone:this.decorationOwnedOnly?'linen':'berry',fontSize:13});s.button({x:pad+71,y,w:78,h:34},'已拥有',()=>{this.decorationOwnedOnly=true;this.scroll=0;this.invalidate();},{tone:this.decorationOwnedOnly?'berry':'linen',fontSize:13});s.ctx.fillStyle=this.colors.line;s.ctx.fillRect(pad+164,y+17,Math.max(0,w-195),1);s.icon('sprig',{x:s.w-pad-20,y:y+7,w:19,h:18});y+=47;if(selected){const gap=12,leftW=(w-gap)*.58,rightW=w-gap-leftW,h=Math.max(248,Math.min(290,leftW*1.15)),rx=pad+leftW+gap,r={x:rx,y,w:rightW,h},preview=data.albums.flatMap(a=>a.images).find(i=>i.collected)??data.packs[0]?.images[0]??data.albums[0]?.images[0];
    const pr={x:pad,y,w:leftW,h};s.panel(pr);if(preview)s.image(this.client.asset(preview.src||preview.thumbSrc),{x:pad+5,y:y+5,w:leftW-10,h:h-10},'cover');s.ctx.save();s.ctx.strokeStyle='#fff4dd88';s.ctx.lineWidth=.65;for(let i=1;i<5;i++){s.ctx.beginPath();s.ctx.moveTo(pad+5+i*(leftW-10)/5,y+5);s.ctx.lineTo(pad+5+i*(leftW-10)/5,y+h-5);s.ctx.stroke();s.ctx.beginPath();s.ctx.moveTo(pad+5,y+5+i*(h-10)/5);s.ctx.lineTo(pad+leftW-5,y+5+i*(h-10)/5);s.ctx.stroke();}s.ctx.restore();s.panel({x:pad+8,y:y+10,w:53,h:25});s.text('◎ 预览',pad+14,y+17,10,this.colors.ink,700);s.icon(selected.artKey,{x:pad+leftW*.4,y:y+h*.58,w:41,h:44});s.panel({x:pad+leftW*.54,y:y+h*.73,w:leftW*.41,h:38});s.icon('avatar',{x:pad+leftW*.55,y:y+h*.74,w:25,h:28});s.text(data.profile.name,pad+leftW*.55+28,y+h*.75,8,this.colors.ink,700,Math.max(26,leftW*.41-30));s.text('Lv.'+data.profile.level,pad+leftW*.55+28,y+h*.75+13,7,this.colors.ink,700);s.ornaments(pr,17);
    s.panel(r);s.ornaments(r,17);s.text(selected.title,rx+12,y+17,16,this.colors.ink,700,rightW-24);s.icon(selected.artKey,{x:rx+rightW/2-39,y:y+48,w:78,h:78});s.icon('create',{x:rx+12,y:y+59,w:9,h:9},this.colors.gold);s.icon('create',{x:rx+rightW-20,y:y+102,w:8,h:8},this.colors.gold);s.wrap(selected.description,rx+12,y+132,rightW-24,10,this.colors.ink,15);
    const label=selected.equipped?'✓ 已装备':selected.owned?'装备':selected.source==='album'?'图鉴奖励':data.wallet.fragments<selected.cost?'碎片不足':'合成装饰';if(!selected.owned&&selected.source==='craft'){s.text(data.wallet.fragments+'/'+selected.cost+' 碎片',rx+12,y+h-75,10,this.colors.muted);s.meter({x:rx+12,y:y+h-59,w:rightW-24,h:7},data.wallet.fragments/Math.max(1,selected.cost));}this.button(rx+10,y+h-45,rightW-20,label,()=>void this.collectionAction(selected.owned?'equip':'craft',selected.id),'berry',34,selected.equipped||(!selected.owned&&(selected.source!=='craft'||data.wallet.fragments<selected.cost)));y+=h+15;}
   const columns=s.w<640?2:3,gap=12,cw=(w-(columns-1)*gap)/columns,h=s.w<360?146:134,base=y;
   decorations.forEach((item,index)=>{const x=pad+index%columns*(cw+gap),cy=base+Math.floor(index/columns)*(h+13),r={x,y:cy,w:cw,h};s.panel(r);if(selected?.id===item.id){s.ctx.fillStyle='#e8c496';s.ctx.fillRect(x+5,cy+h-5,cw-10,2);}s.ornaments(r,16);s.icon(item.artKey,{x:x+11,y:cy+11,w:18,h:20});s.text(item.title,x+33,cy+16,13,this.colors.ink,700,cw-40);s.icon(item.artKey,{x:x+13,y:cy+46,w:51,h:57});const dx=x+70,dw=cw-80,label=item.equipped?'已装备':item.owned?'可装备':item.source==='album'?'图鉴奖励':'未合成';s.ctx.fillStyle=item.equipped?this.colors.rose:'#f2ddb9';s.ctx.fillRect(dx,cy+45,Math.min(47,dw),18);s.text(label,dx+4,cy+49,8,item.equipped?'#fff9ed':'#a36c2e',700,dw-4);s.wrap(item.description,dx,cy+71,dw,9,this.colors.ink,13);if(!item.owned&&item.source==='craft'){s.icon('fragment',{x:dx,y:cy+h-22,w:13,h:13});s.text(item.cost,dx+16,cy+h-20,9,this.colors.ink,700);}s.hit(r,()=>{this.decorationId=item.id;this.scroll=0;this.invalidate();});});y=base+Math.ceil(decorations.length/columns)*(h+13)+7;y=this.paragraph('装饰会在拖动拼块时展示，让一起拼图的人认出你。',pad+7,y,w-14,10)+12;
  });this.extent=y-(this.bodyTop-this.scroll);
 }
 private drawPolicy(){const s=this.stage;let y=this.bodyTop-this.scroll;const sections=this.route==='privacy'?[
  ['个人信息与游戏数据','本游戏保存必要的玩家凭证、昵称、等级经验、拼图进度、任务、邀请关系及奖励库存。昵称、等级及拖动装饰会向同房玩家显示，请勿填写个人隐私。'],
  ['本机身份','当前版本使用本机保存的游客凭证。清除本机数据或更换设备后，可能无法恢复原身份与库存。请妥善保留客户端数据。'],
  ['广告与分享','广告仅在主动领取补给或帮助时播放；完整观看后申请所选奖励。分享界面打开不等于好友已收到邀请，好友任务由服务端验证有效参与。'],
  ['账号与数据处理','如需删除游戏数据或咨询素材来源，请通过平台游戏页面的开发者联系入口提出申请。平台账号、广告服务另适用平台公示的隐私规则。'],
 ]:this.route==='terms'?[
  ['游戏内容','本游戏为多人合作拼图。图片可用于游戏内游玩，不代表获得图片的再分发或商用授权。'],['玩家行为','请文明协作，不冒用他人身份，不利用漏洞重复获取奖励，不对其他玩家进行骚扰。'],['测试版本','测试期间可能调整内容和规则。当前版本无会员、现金付费或自动续费。'],
 ]:[
  ['一起拼图','拖动拼块，靠近正确位置松开即可拼合。双指缩放和平移；“适配”可找回完整桌面。边缘筛选和整理可帮助寻找拼块。'],
  ['体力与经验','有效拼合消耗1点体力并获得1经验。升级会补满体力；每10次有效拼合存入小礼包。完成拼图按贡献获得体力、金币和装饰碎片。'],
  ['房间与收藏','随机公开房免费创建。指定图片或私人房使用建房券；已购图包可免费创建公开房。同时最多保留3个未结束的自建房间。'],
  ['邀请与礼包','好友首次接受邀请并完成3次有效拼合，邀请者可获得补满体力包，每日最多3位。与好友实际协作，还可积累每日任务礼包。'],
 ];this.scrolled(()=>{for(const[title,text]of sections){s.text(title,20,y,18,this.colors.ink,700);y=this.paragraph(text,20,y+31,s.w-40,14)+24;}this.button(20,y,s.w-40,'隐私说明',()=>this.navigate('privacy'));y+=48;this.button(20,y,s.w-40,'服务说明',()=>this.navigate('terms'));y+=52;});this.extent=y-(this.bodyTop-this.scroll);}

 private drawRoom(){
  const s=this.stage,room=this.room,board=this.board,view=this.platform.viewport(),top=view.top+5,p=this.client.profile;
  if(!room||!board){s.text('尚未加入房间',20,top+30,18);this.button(20,top+76,s.w-40,'返回大厅',()=>this.navigate('lobby'));return;}
  const visible=!this.hidden&&!this.modal&&!this.toolsOpen;if(visible!==this.cursorVisible){this.cursorVisible=visible;if(visible)this.cursor?.refresh();else this.clearRoomPointer();}
  const photo=photoMap.get(room.state.imageId),total=room.state.cols*room.state.rows,placed=placedCount(room.state),landscape=s.w>s.h&&s.w>=540,c=s.ctx;
  const mainH=landscape?57:50,headerBottom=top+mainH+(landscape?0:42),statusW=landscape?Math.min(208,Math.round(s.w*.28)):Math.min(204,Math.round(s.w*.55));
  const inviteW=landscape?66:74,inviteX=s.w-8-inviteW,statusX=landscape?inviteX-statusW-9:s.w-8-statusW,titleW=landscape?Math.max(100,Math.min(178,s.w*.2)):Math.max(86,statusX-15);
  const title=room.snapshot.title||photo?.title||'一起拼图',brand=this.platform.config.id==='wechat',titleTextX=47,titleTextW=titleW-titleTextX+8;
  s.button({x:8,y:top+7,w:32,h:36},'',()=>{this.leaveRoom();this.navigate('lobby');});s.icon('back',{x:14,y:top+14,w:20,h:22});
  if(titleTextW>155){s.icon('piece',{x:47,y:top+13,w:23,h:27});s.text(title,75,top+(brand?8:17),landscape?19:18,this.colors.ink,800,titleTextW-28);}
  else s.text(title,titleTextX,top+(brand?8:17),landscape?17:16,this.colors.ink,800,titleTextW);
  if(brand)s.text(this.platform.config.gameName,titleTextX+(titleTextW>155?28:0),top+31,9,this.colors.muted,500,titleTextW);
  const avatarW=statusW<190?37:43,levelX=statusX+avatarW+4,levelW=statusW<190?43:49,energyX=levelX+levelW+7;
  s.icon('avatar',{x:statusX,y:top+4,w:avatarW,h:45});s.text('Lv.'+(p?.level??'—'),levelX,top+4,14,this.levelColor(p?.level??0),800,levelW);
  s.meter({x:levelX,y:top+23,w:levelW,h:8},p?p.xp/Math.max(1,p.xpToNext):0,this.colors.rose);s.text(p?p.xp+' / '+p.xpToNext:'— / —',levelX,top+35,9,this.colors.ink,500,levelW+2);
  s.hit({x:statusX,y:top,w:avatarW+levelW+4,h:mainH},()=>this.showModal('settings'));
  c.fillStyle=this.colors.line;c.fillRect(energyX-4,top+11,1,30);s.icon('lightning',{x:energyX,y:top+12,w:19,h:28});
  const plusX=statusX+statusW-18,energyWidth=Math.max(28,plusX-energyX-22);s.text(p?p.energy+'/'+p.energyCap:'—/—',energyX+21,top+18,statusW<190?13:15,this.colors.ink,800,energyWidth);
  s.button({x:plusX,y:top+15,w:18,h:23},'+',()=>this.navigate('supplies'),{tone:'gold',fontSize:16});s.hit({x:energyX-3,y:top+4,w:statusX+statusW-energyX+3,h:43},()=>this.navigate('supplies'));
  const members=room.snapshot.members.length,progressY=landscape?top+8:top+mainH+5,onlineX=landscape?titleW+17:inviteX-65,progressX=landscape?onlineX+56:8,progressW=landscape?statusX-progressX-9:onlineX-progressX-8;
  if(!landscape){c.fillStyle=this.colors.line;c.fillRect(8,top+mainH,s.w-16,1);}
  s.icon('piece',{x:progressX,y:progressY+4,w:22,h:26});
  const count=placed+'/'+total,countSize=landscape?15:17,countW=Math.min(80,s.measure(count,countSize,800));
  if(landscape){s.text(count,progressX+28+(Math.max(0,progressW-28-countW))/2,progressY,15,this.colors.ink,800,progressW-28);s.meter({x:progressX+28,y:progressY+23,w:Math.max(20,progressW-28),h:10},placed/Math.max(1,total),this.colors.rose);}
  else{s.text(count,progressX+27,progressY+8,countSize,this.colors.ink,800,countW);s.meter({x:progressX+33+countW,y:progressY+12,w:Math.max(20,progressW-countW-34),h:11},placed/Math.max(1,total),this.colors.rose);}
  if(!landscape){c.fillStyle=this.colors.line;c.fillRect(onlineX-4,progressY+5,1,26);}
  s.icon('person',{x:onlineX+1,y:progressY+6,w:20,h:25});s.text(members+'/8',onlineX+26,progressY+11,14,this.colors.ink,700);s.hit({x:onlineX-2,y:progressY,w:57,h:35},()=>this.showModal('chat'));
  s.button({x:inviteX,y:landscape?top+13:progressY,w:inviteW,h:35},'邀请',()=>this.showModal('invite'),{tone:'berry',icon:'invite',fontSize:14});
  c.fillStyle=this.colors.line;c.fillRect(0,headerBottom,s.w,1);
  const safeBottom=s.h-view.bottom;this.roomArea={x:0,y:headerBottom+1,w:s.w,h:Math.max(90,safeBottom-headerBottom-1)};this.bodyTop=this.roomArea.y;this.bodyBottom=safeBottom;
  board.selfDecoration=p?.collection?.equipped??null;board.setRect(this.roomArea);if(this.roomViewPending){board.openMobileView({bottom:72});this.roomViewPending=false;}board.draw(c);
  if(!this.imageReady){s.panel({x:18,y:this.roomArea.y+20,w:s.w-36,h:74});this.paragraph(this.imageError||'正在铺开拼图…',30,this.roomArea.y+37,s.w-60,14);if(this.imageError)this.button(25,this.roomArea.y+104,s.w-50,'重新加载图片',()=>void this.run(async()=>{await board.setImage(this.roomImage);this.imageReady=true;this.imageError='';this.message='';board.fit();}));}
  if(!room.connected){s.panel({x:12,y:safeBottom-114,w:s.w-24,h:37});s.text(room.message,23,safeBottom-103,12,'#a54860',400,s.w-46);}
  const giftY=safeBottom-62,giftLabel='任务 '+(p?.giftProgress??0)+'/10';s.icon('gift',{x:13,y:giftY+4,w:44,h:46});s.text(giftLabel,59,giftY+20,15,this.colors.ink,700);s.hit({x:10,y:giftY,w:144,h:52},()=>this.navigate('tasks'));
  const giftCount=p?.giftCount??0;if(giftCount>0){const label=giftCount>99?'99+':String(giftCount),badgeW=Math.max(20,s.measure(label,10,700)+8);s.panel({x:43,y:giftY-2,w:badgeW,h:19},'berry');s.text(label,47,giftY+2,10,'#fffaf0',700);}
  this.drawRoomTools({x:s.w-63,y:safeBottom-65,w:50,h:50},landscape);
 }
 private drawRoomTools(toggle:Rect,landscape:boolean){
  const s=this.stage,board=this.board;if(!board)return;const c=s.ctx;
  // The original B2 toggle is an integer-stepped circle, not a rounded rectangle.
  c.save();c.translate(toggle.x,toggle.y);c.scale(toggle.w/54,toggle.h/54);
  const circle=(points:number[],fill:string)=>{c.beginPath();for(let i=0;i<points.length;i+=2){if(i)c.lineTo(points[i],points[i+1]);else c.moveTo(points[i],points[i+1]);}c.closePath();c.fillStyle=fill;c.fill();};
  circle([18,1,36,1,36,3,42,3,42,6,48,6,48,12,51,12,51,18,53,18,53,36,51,36,51,42,48,42,48,48,42,48,42,51,36,51,36,53,18,53,18,51,12,51,12,48,6,48,6,42,3,42,3,36,1,36,1,18,3,18,3,12,6,12,6,6,12,6,12,3,18,3],'#925363');
  circle([18,3,36,3,36,5,42,5,42,8,46,8,46,12,49,12,49,18,51,18,51,36,49,36,49,42,46,42,46,46,42,46,42,49,36,49,36,51,18,51,18,49,12,49,12,46,8,46,8,42,5,42,5,36,3,36,3,18,5,18,5,12,8,12,8,8,12,8,12,5,18,5],'#e3bda4');
  circle([19,5,35,5,35,7,41,7,41,10,44,10,44,13,47,13,47,19,49,19,49,35,47,35,47,41,44,41,44,44,41,44,41,47,35,47,35,49,19,49,19,47,13,47,13,44,10,44,10,41,7,41,7,35,5,35,5,19,7,19,7,13,10,13,10,10,13,10,13,7,19,7],this.toolsOpen?'#f4e7db':'#fff8ef');c.restore();
  s.icon(this.toolsOpen?'close':'tools',{x:toggle.x+12,y:toggle.y+12,w:26,h:26});s.hit(toggle,()=>{this.clearRoomPointer();this.toolsOpen=!this.toolsOpen;this.invalidate();});
  if(!this.toolsOpen)return;
  const width=Math.min(366,s.w-26),sideways=landscape&&toggle.x-width-12>150,box={x:sideways?toggle.x-width-12:s.w-13-width,y:sideways?Math.max(this.roomArea.y+7,toggle.y-40):Math.max(this.roomArea.y+7,toggle.y-104),w:width,h:91};s.panel(box);s.hit(box,()=>{});
  const buttons:[string,string,()=>void][]=[['edge','边缘',()=>{board.edgeOnly=!board.edgeOnly;this.invalidate();}],['hint','提示',()=>void this.activateAssistance('hint')],['underlay','底图',()=>void this.activateAssistance('underlay')],['fit','适配',()=>{board.fit(false,{bottom:board.trayOpen?220:72});this.toolsOpen=false;this.invalidate();}],['tools','更多',()=>this.showModal('tools')]];
  const cellW=(box.w-14)/5;
  buttons.forEach(([icon,label,fn],index)=>{const x=box.x+7+index*cellW,y=box.y+11,cx=x+cellW/2,active=icon==='edge'?board.edgeOnly:icon==='hint'||icon==='underlay'?!!this.activeAid(icon):false;
   s.button({x:cx-19,y:y+10,w:38,h:38},'',fn,{tone:active?'berry':'cream'});s.icon(icon,{x:cx-13,y:y+16,w:26,h:26});s.text(label,cx-s.measure(label,12,600)/2,y+54,12,this.colors.ink,600);s.hit({x,y:box.y+5,w:cellW,h:79},fn);
   if(icon==='hint'||icon==='underlay'){const activeAid=this.activeAid(icon),free=this.aid?.freeRemaining?.[icon]??0,pending=!this.aid||this.busy,badge=activeAid?Math.ceil((activeAid.expiresAt-Date.now())/1000)+'秒':pending?'读取中':this.aid?.newcomerProtected?'新手免费':free>0?'免费'+free+'次':'广告',ad=!activeAid&&!pending&&!this.aid?.newcomerProtected&&free===0,bw=Math.min(cellW-2,s.measure(badge,9,500)+7),bx=cx+19-bw;
    c.fillStyle=ad?'#ba667e':activeAid?'#fae7b8':pending?'#eee7db':'#f2efd8';c.fillRect(bx,box.y+4,bw,16);c.strokeStyle=ad?'#8c4059':activeAid?'#ccaa68':'#c8b781';c.lineWidth=1;c.strokeRect(bx+.5,box.y+4.5,bw-1,15);s.text(badge,bx+3,box.y+7,9,ad?'#fffaf0':activeAid?'#83542f':'#7a7244',500,bw-5);
   }
  });
 }
 private aidLabel(kind:'hint'|'underlay'){const active=this.activeAid(kind),label=kind==='hint'?'提示':'底图';if(active)return label+' '+Math.ceil((active.expiresAt-Date.now())/1000)+'秒';if(!this.aid)return label+' 读取中';if(this.aid.newcomerProtected)return label+' 免费';const free=this.aid.freeRemaining?.[kind]??0;return label+(free>0?' 免费'+free:' 广告');}

 private drawModal(){
  const s=this.stage,w=Math.min(s.w-24,540),x=(s.w-w)/2,y=Math.max(this.platform.viewport().top+15,s.h*.1),h=s.h-y-this.platform.viewport().bottom-24;
  s.ctx.fillStyle='rgba(66,41,42,.48)';s.ctx.fillRect(0,0,s.w,s.h);s.hit({x:0,y:0,w:s.w,h:s.h},()=>{});s.panel({x,y,w,h});
  const titles:Record<Exclude<Modal,null>,string>={filters:this.route==='gallery'?'筛选图片':'筛选房间',settings:'玩家与设置',manage:'我的房间',invite:'邀请好友',tools:'拼图工具',chat:'同桌交流',completion:'拼图完成',purchase:'解锁主题图包',packPreview:this.previewPack?.title??'图包预览'};
  s.text(titles[this.modal!],x+17,y+18,20,this.colors.ink,700,w-73);s.button({x:x+w-45,y:y+12,w:30,h:30},'',()=>{this.modal=null;this.invalidate();});
  // A vector cross has the same visible size and center with browser and wx fonts.
  s.icon('close',{x:x+w-42,y:y+15,w:24,h:24},this.colors.ink);
  this.modalStart=y+59;this.modalArea={x:x+12,y:this.modalStart,w:w-24,h:h-73};let cy=this.modalStart-this.modalScroll;const left=x+20,width=w-40;
  s.clip(this.modalArea,()=>{switch(this.modal){
   case'packPreview':{
    const pack=this.previewPack,image=pack?.images[this.previewIndex];if(!pack||!image)break;
    const art={x:left,y:cy,w:width,h:Math.max(100,this.modalArea.h-112)};s.frame(art,'panel-cream');s.image(this.client.asset(image.src||image.thumbSrc),{x:art.x+6,y:art.y+6,w:art.w-12,h:art.h-12},'contain');s.ornaments(art,16);cy+=art.h+15;
    s.text(image.title,left,cy,16,this.colors.ink,700,width-65);const counter=(this.previewIndex+1)+' / '+pack.images.length;s.text(counter,left+width-s.measure(counter,13,700),cy+2,13,this.colors.muted,700);cy+=32;
    s.button({x:left,y:cy,w:(width-10)/2,h:40},'上一张',()=>this.stepPackPreview(-1),{disabled:this.previewIndex===0,fontSize:14});s.button({x:left+(width+10)/2,y:cy,w:(width-10)/2,h:40},'下一张',()=>this.stepPackPreview(1),{tone:'berry',disabled:this.previewIndex===pack.images.length-1,fontSize:14});cy+=52;break;
   }
   case'filters':{
    s.text('图片方向',left,cy,14,this.colors.ink,700);cy+=30;this.rowOptions(directions,this.direction,left,cy,width,v=>{this.direction=v;this.invalidate();});cy+=52;
    if(this.route==='lobby'){s.text('拼图片数',left,cy,14,this.colors.ink,700);cy+=30;this.rowOptions([[0,'不限'],...counts.map(n=>[n,n+'片'] as const)],this.filterCount,left,cy,width,n=>{this.filterCount=n;this.invalidate();});cy+=51;this.button(left,cy,width,(this.openOnly?'✓ ':'')+'只看可加入房间',()=>{this.openOnly=!this.openOnly;this.invalidate();});cy+=47;this.button(left,cy,width,(this.activeOnly?'✓ ':'')+'有人正在拼图',()=>{this.activeOnly=!this.activeOnly;this.invalidate();});cy+=54;}
    else{this.button(left,cy,width,this.search?'搜索：'+this.search:'搜索图片名称',()=>void this.run(async()=>{const result=await this.platform.prompt('搜索图片名称',this.search);if(result!==null)this.search=result.trim();}));cy+=51;s.text('图片分类',left,cy,14,this.colors.ink,700);cy+=30;CATEGORIES.forEach((category,index)=>{const bw=(width-12)/3;this.button(left+(index%3)*(bw+6),cy+Math.floor(index/3)*43,bw,category,()=>{this.category=category;this.invalidate();},category===this.category?'berry':'cream',34);});cy+=Math.ceil(CATEGORIES.length/3)*43+10;}
    this.button(left,cy,width,'应用筛选',()=>{this.modal=null;this.scroll=0;if(this.route==='lobby'){this.lobbySerial++;this.rooms=[];this.lobbyCursor=null;void this.loadLobby();}this.invalidate();},'berry',43);cy+=57;break;
   }
   case'settings':{
    const p=this.client.profile;s.icon('avatar',{x:left,y:cy,w:54,h:58});s.text(p?.name??'玩家',left+70,cy+6,18,this.colors.ink,700);s.text('Lv.'+(p?.level??'—')+' · '+(p?.xp??0)+'/'+(p?.xpToNext??0)+'经验',left+70,cy+33,13);cy+=77;
    this.button(left,cy,width,'修改昵称',()=>void this.run(async()=>{const value=await this.platform.prompt('昵称（1～16字）',p?.name);if(value!==null){await this.client.json('/api/mobile/profile','PATCH',{name:value.trim()},{'Content-Type':'application/json'});await this.client.refresh();this.note('昵称已保存');}}));cy+=48;
    this.button(left,cy,width,(p?.autoSupply?'✓ ':'')+'体力耗尽自动使用库存包',()=>void this.run(async()=>{await this.client.json('/api/mobile/profile','PATCH',{autoSupply:!p?.autoSupply},{'Content-Type':'application/json'});await this.client.refresh();}));cy+=47;cy=this.paragraph('只消耗已有体力包，不会自动播放广告。',left,cy,width,12)+18;
    for(const [label,action]of [['我的房间 '+(p?.ownedRooms.length??0)+'/3',()=>this.showModal('manage')],['玩法帮助',()=>this.navigate('help')],['隐私说明',()=>this.navigate('privacy')],['服务说明',()=>this.navigate('terms')]] as const){this.button(left,cy,width,label,action);cy+=48;}
    cy=this.paragraph('当前为本机游客身份。清除本机数据可能丢失进度。',left,cy+4,width,12)+10;break;
   }
   case'manage':{
    cy=this.paragraph('最多保留3个未结束的自建房间。房间无人时可关闭。',left,cy,width,13)+15;
    for(const room of this.client.profile?.ownedRooms??[]){s.panel({x:left,y:cy,w:width,h:98});s.text(room.title??'我的拼图房间',left+10,cy+13,15,this.colors.ink,700,width-20);s.text((room.players??0)+'人 · '+(room.pieces??'—')+'片',left+10,cy+36,12,this.colors.muted);this.button(left+10,cy+60,(width-26)/2,'继续拼',()=>void this.enterRoom(room.id),'berry',30);this.button(left+16+(width-26)/2,cy+60,(width-26)/2,'关闭空房',()=>void this.run(async()=>{await this.client.json('/api/rooms/'+room.id,'DELETE',{requestId:this.attempt('close:'+room.id)},{'Content-Type':'application/json'});this.attempts.delete('close:'+room.id);await this.client.refresh();}),'cream',30,(room.players??0)>0);cy+=111;}if(!this.client.profile?.ownedRooms.length){s.text('还没有自建房间',left,cy+15,14,this.colors.muted);cy+=65;}break;
   }
   case'invite':{
    s.icon('invitationArt',{x:left+width/2-46,y:cy,w:92,h:89});cy+=102;s.text('邀请好友，一起攒礼包',left,cy,20,this.colors.ink,700,width);cy+=40;cy=this.paragraph('好友接受首次邀请并完成3次有效拼合后，你可获得补满体力包。每日最多3位；新老玩家都可参与。',left,cy,width,14)+19;
    s.text('我的邀请码',left,cy,12,this.colors.muted);cy+=26;s.text(this.tasks?.invitation.code??'正在读取…',left,cy,20,this.colors.ink,700,width);cy+=40;this.button(left,cy,width,'邀请好友',()=>void this.shareInvitation(),'berry',42);cy+=56;
    cy=this.paragraph('好友任务以真实参与为准，仅打开分享界面不会计为已发出成功或发放奖励。',left,cy,width,12)+18;
    this.button(left,cy,width,this.pendingInvitation?'邀请码：'+this.pendingInvitation:'输入好友邀请码',()=>void this.run(async()=>{const value=await this.platform.prompt('输入好友邀请码',this.pendingInvitation);if(value!==null)this.pendingInvitation=value.trim();}));cy+=48;
    if(this.pendingInvitation){this.button(left,cy,width,'接受好友邀请',()=>void this.acceptInvitation(),'green',40);cy+=52;}
    if(this.tasks?.invitation.bound){s.text('已关联：'+(this.tasks.invitation.boundToName??'好友'),left,cy,13,this.colors.muted);cy+=35;}break;
   }
   case'tools':{
    const board=this.board,room=this.room;for(const [label,action]of [
     ['适配完整桌面',()=>{board?.fit();this.modal=null;this.toolsOpen=false;this.invalidate();}],
     ['放大',()=>{board?.zoom(1.25);this.invalidate();}],['缩小',()=>{board?.zoom(.8);this.invalidate();}],
     ['定位未归位拼块',()=>{board?.find();this.modal=null;this.toolsOpen=false;this.invalidate();}],
     [board?.trayOpen?'关闭碎片托盘':'打开碎片托盘 · 点选定位',()=>{if(board)board.trayOpen=!board.trayOpen;this.modal=null;this.toolsOpen=false;this.invalidate();}],
     ['整理散落拼块',()=>void this.run(async()=>{await room?.organize();this.modal=null;this.toolsOpen=false;this.note('散片已整理');})],
     [board?.showPreview?'关闭原图':'查看原图',()=>{if(board)board.showPreview=!board.showPreview;this.modal=null;this.invalidate();}],
    ] as const){this.button(left,cy,width,label,action,'cream',40);cy+=51;}break;
   }
   case'chat':{
    const room=this.room;s.text('同桌 '+(room?.snapshot.members.length??0)+'人',left,cy,15,this.colors.ink,700);cy+=29;for(const member of room?.snapshot.members??[]){s.text(member.name+' · Lv.'+((member as typeof member&{level?:number}).level??1),left,cy,13,member.color);cy+=25;}cy+=10;
    const last=this.messages.slice(-8);for(const item of last){s.text(item.name,left,cy,12,this.colors.muted,700);cy+=22;cy=this.paragraph(item.text,left+7,cy,width-14,14,this.colors.ink)+12;}if(!last.length){s.text('发一句问候吧',left,cy,14,this.colors.muted);cy+=36;}
    phrases.forEach((text,index)=>{const bw=(width-8)/2;this.button(left+(index%2)*(bw+8),cy+Math.floor(index/2)*45,bw,text,()=>void this.say(text),'cream',35);});cy+=Math.ceil(phrases.length/2)*45+10;break;
   }
   case'completion':{
    const room=this.room,result=(room?.snapshot as unknown as {mobileResult?:any})?.mobileResult,picture={x:left,y:cy,w:width,h:Math.min(width*.75,240)};
    s.frame(picture,'panel-cream');const shown=this.board?.drawCompletedPicture(s.ctx,{x:left+6,y:cy+6,w:width-12,h:picture.h-12});
    if(!shown){s.text(this.imageError?'图片加载失败':'正在加载成品…',left+12,cy+picture.h/2-20,13,this.colors.muted,500,width-24);if(this.imageError)this.button(left+12,cy+picture.h/2+4,width-24,'重新加载',()=>void this.run(async()=>{const board=this.board;if(!board)return;await board.setImage(this.roomImage);if(this.board===board){this.imageReady=true;this.imageError='';this.message='';}}),'cream',32);}
    s.ornaments(picture);cy+=picture.h+20;
    s.text('谢谢你，一起完成这幅作品',left,cy,17,this.colors.ink,700,width);cy+=37;
    if(result){s.text('我的贡献：'+result.contribution+' 次有效拼合',left,cy,14);cy+=32;for(const[kind,label,value]of [['coin','金币',result.coins??0],['fragment','碎片',result.fragments??0],['lightning','体力',result.energy??0]] as const){s.icon(kind,{x:left,y:cy,w:25,h:25});s.text(label+' +'+value,left+36,cy+4,16,this.colors.ink,700);cy+=38;}
     if(result.catalog?.qualified){cy=this.paragraph(result.catalog.newlyCollected?'这张画作已加入图鉴！':'图鉴与难度记录已更新',left,cy,width,14)+16;}
     for(const reward of result.catalog?.albumRewards??[]){cy=this.paragraph(reward.title+'：'+(reward.coins?'金币 +'+reward.coins:'专属装饰已获得'),left,cy,width,13)+6;}
    }else{cy=this.paragraph('正在同步本次收获…奖励以服务器结算为准。',left,cy,width,14)+15;}
    this.button(left,cy,width,'查看收藏',()=>this.navigate('collection'),'cream',40);cy+=51;this.button(left,cy,width,'再拼一局',()=>{this.leaveRoom();this.navigate('gallery');},'berry',42);cy+=56;break;
   }
   case'purchase':{
    const pack=this.purchase;if(!pack)break;if(pack.images[0])this.cardImage(pack.images[0].thumbSrc,{x:left,y:cy,w:width,h:Math.min(220,width*.75)});cy+=Math.min(220,width*.75)+21;s.text(pack.title,left,cy,22,this.colors.ink,700);cy+=39;cy=this.paragraph(pack.images.length+'张图片永久解锁。可免费指定本包图片创建公开房间；私人房仍使用建房券。',left,cy,width,14)+18;s.text('花费 '+pack.price+' 金币',left,cy,20,this.colors.ink,700);cy+=34;s.text('现有 '+(this.collection?.wallet.coins??0)+' 金币',left,cy,13,this.colors.muted);cy+=39;this.button(left,cy,width,(this.collection?.wallet.coins??0)<pack.price?'金币不足':'确认解锁',()=>void this.collectionAction('buy',pack.id),'berry',42,(this.collection?.wallet.coins??0)<pack.price);cy+=57;break;
   }
  }});this.modalExtent=cy-(this.modalStart-this.modalScroll)+7;const next=clamp(this.modalScroll,0,Math.max(0,this.modalExtent-this.modalArea.h));if(next!==this.modalScroll){this.modalScroll=next;this.invalidate();}
 }

 input(input:Input):boolean{
  if(!this.pointer&&this.route==='room'&&this.board&&!this.modal&&!this.toolsOpen&&(input.type==='move'||input.type==='cancel'))return this.board.input(input);
  const point=input.changed[0]??input.points[0];if(!point)return this.stage.input(input);
  if(input.type==='down'){
   if(this.pointer?.board&&this.board)return this.board.input(input);
   const board=!!this.board&&this.route==='room'&&!this.modal&&inside(this.roomArea,point.x,point.y)&&!this.toolsOpen&&!this.stage.hasHit(point.x,point.y);
   this.pointer={x:point.x,y:point.y,lastY:point.y,scroll:false,board};
   if(board)return this.board!.input(input);
   return this.stage.input(input);
  }
  if(this.pointer?.board){const handled=this.board?.input(input)??false;if(input.type==='cancel'||(input.type==='up'&&!input.points.length))this.pointer=null;return handled;}
  if(input.type==='move'&&this.pointer){const p=this.pointer,canScroll=this.modal?inside(this.modalArea,p.x,p.y):this.route!=='room'&&p.y>=this.bodyTop&&p.y<=this.bodyBottom;
   if(canScroll&&(p.scroll||Math.abs(point.y-p.y)>6)){if(!p.scroll)this.stage.input({type:'cancel',points:[],changed:input.changed});p.scroll=true;const delta=p.lastY-point.y;if(this.modal)this.modalScroll=clamp(this.modalScroll+delta,0,Math.max(0,this.modalExtent-this.modalArea.h));else{this.scroll=clamp(this.scroll+delta,0,Math.max(0,this.extent-(this.bodyBottom-this.bodyTop)));if(this.route==='lobby'&&this.lobbyCursor&&this.scroll>this.extent-(this.bodyBottom-this.bodyTop)-180)void this.loadLobby(true);}p.lastY=point.y;this.invalidate();return true;}p.lastY=point.y;
  }
  if(input.type==='up'||input.type==='cancel'){const scrolled=this.pointer?.scroll;this.pointer=null;if(scrolled)return true;}
  return this.stage.input(input);
 }
}
