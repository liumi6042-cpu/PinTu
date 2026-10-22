import type {Platform,Input,Rect,Route,WebLinks} from './ports';
import {GameClient} from './client';
import {Stage} from './ui';
import {tapAuthorizationLayout} from './tap-authorization-layout';
import {PuzzleBoard} from './puzzle-board';
import {SocialPanel} from './social-panel';
import {TaskShareReward} from './task-share-reward';
import {contributionCopy,recoveryCopy} from './economy-copy';
import {collectionDecorationRewardHints} from './collection-copy';
import {boardThemeColors,isThemeId,type ThemeId} from './theme';
import {RoomClient,type RoomTicket,type RoomRequestTiming} from '../lib/room-client';
import {CursorClient} from '../lib/cursor-client';
import type {ManagedRoomRealtime} from '../lib/room-realtime';
import type {MobileContributionReceipt} from '../lib/connection-feedback';
import {GALLERY_PHOTOS,RESTORABLE_PHOTOS,CATEGORIES} from '../lib/puzzle-catalog';
import {photoGuidance} from '../lib/play-guidance';
import {customPhoto} from '../lib/custom-images';
import {activeRoomPhoto} from './room-photo';
import {ViewRequests} from './view-requests';
import {AudioSettings} from './audio-settings';
import {MOBILE_PRIVACY_VERSION,MOBILE_PRIVACY_CONSENT_KEY,MOBILE_PRIVACY_CONTACT,mobilePrivacySections,mobileTermsSections} from './privacy-policy';
import {placedCount} from '../lib/puzzle-engine';
import collectionCatalog from '../lib/mobile-collection-catalog.json';
import publicPhrases from '../config/social-phrases.json';
import type {MobileTaskView,MobileGiftOpenResult,MobileInviteShareResult,MobileRoomInput,MobileOwnedRoom} from '../h5/mobile-api';
import type {MobileCollectionView,CollectionPack,CollectionDecoration} from '../h5/mobile-collection-api';
import type {RoomCard} from '../lib/lobby-types';
import type {AssistanceGrant} from '../lib/assistance-policy';

type Direction='all'|'portrait'|'landscape'|'square';
type PerformanceMode='smooth'|'power-saving';
type Modal='history'|'filters'|'settings'|'manage'|'invite'|'tools'|'chat'|'social'|'completion'|'purchase'|'packPreview'|'albums'|'tasks'|'coins'|'fragments'|'privacyRequests'|null;
type PrivacyRequest={requestId:string;type:'access'|'delete';status:string;createdAt:number;verificationCode:string};
type RoomListing=RoomCard&{actualPieces?:number;photo?:SharedPhoto;thumbSrc?:string};
const directions:[Direction,string][]=[['all','全部'],['portrait','竖图'],['landscape','横图'],['square','方图']];
const counts=[48,108,300,500] as const;
const contentMaxWidth=1120;
const phrases=publicPhrases;
type PublicMessage={id:number;name:string;text:string;playerId:string;code:string;level?:number;sentAt?:number};
type SharedPhoto={id:string;title:string;src:string;thumbSrc:string;category:string;width?:number;height?:number};
type WebPage=Exclude<keyof WebLinks,'legacyLobby'|'legacyRoom'|'largePuzzles'>;
type ListView={route:Route;scroll:number;albumListScroll:number;direction:Direction;filterCount:number;openOnly:boolean;activeOnly:boolean;category:string;search:string;source:'free'|'owned'|'all';packId:string|null;selected:string|null;collectionTab:'albums'|'packs'|'decorations';albumId:string;decorationId:string;decorationOwnedOnly:boolean;taskTab:'tasks'|'gifts'};
const photoMap=new Map<string,SharedPhoto>(RESTORABLE_PHOTOS.map(photo=>[photo.id,photo]));
const packed=new Set(collectionCatalog.packs.flatMap(pack=>pack.imageIds));
function orientation(id:string):Direction{const photo=photoMap.get(id),size=photo?.width&&photo.height?photo:photoGuidance(id);return !size?'all':size.width===size.height?'square':size.width!>size.height!?'landscape':'portrait';}
function errorText(error:unknown){return error instanceof Error?error.message:'连接暂时中断，请重试';}
function taskCoinsText(min=0,max=min){return max>0?' · 金币 +'+min+(min===max?'':'～'+max):'';}
function clamp(value:number,min:number,max:number){return Math.max(min,Math.min(max,value));}
function inside(r:Rect,x:number,y:number){return x>=r.x&&x<=r.x+r.w&&y>=r.y&&y<=r.y+r.h;}
function roomListKey(rooms:RoomListing[]){return JSON.stringify(rooms.map(room=>[room.id,room.title,room.imageId,room.thumbSrc??room.photo?.thumbSrc??photoMap.get(room.imageId)?.thumbSrc,room.actualPieces??room.pieces,room.placed,room.players,room.acceptingNew!==false,!!room.completed]));}
function messageListKey(messages:PublicMessage[]){return JSON.stringify(messages.map(item=>[item.id,item.name,item.text,item.playerId,item.code,item.level??0,item.sentAt??0]));}

/** One scene graph and one set of game rules for both mobile platforms. */
export class GameApp{
 route:Route='lobby';
 private routeStack:Route[]=[];
 private routeFrames:ListView[]=[];private savedRoutes=new Map<Route,ListView>();private listOwner?:string;private roomReturn:ListView|null=null;private roomReturnStack:Route[]=[];private roomReturnFrames:ListView[]=[];
 private ready=false;private destroyed=false;private busy=false;private sharing=false;private message='';private messageUntil=0;
 private startupPending:Promise<void>|null=null;private startupError='';private startupHooks=false;private startupQuery:Record<string,string>|null=null;
 private privacyAccepted=false;private privacyDocument:'privacy'|'terms'|null=null;private privacyRefused=false;private privacyEpoch=0;private authorizationTesting=false;private loginDialogActive=false;
 private identityHook=false;private consentPreparing=false;private consentError='';
 private privacyRequests:PrivacyRequest[]=[];private privacyRequestsLoading=false;
 private scroll=0;private extent=0;private bodyTop=100;private bodyBottom=0;private pointer:{x:number;y:number;lastY:number;scroll:boolean;board:boolean;album?:boolean;modal?:boolean}|null=null;
 private modal:Modal=null;private modalScroll=0;private modalExtent=0;private modalArea:Rect={x:0,y:0,w:0,h:0};private modalStart=0;
 private direction:Direction='all';private filterCount=0;private openOnly=true;private activeOnly=false;
 private rooms:RoomListing[]=[];private lobbyCursor:string|null=null;private lobbyLoading=false;private lobbyQuiet=false;private lobbySerial=0;private lobbyReload=false;
 private pieces:48|108|300|500=108;private selected:string|null=null;private visibility:'public'|'private'='public';private category='全部';private search='';private source:'free'|'owned'|'all'='free';private packId:string|null=null;
 private galleryIds:Set<string>|null=null;private freeGalleryIds:Set<string>|null=null;private packedIds=packed;
 private sharedPhotos:SharedPhoto[]|null=null;
 private tasks:MobileTaskView|null=null;private taskTab:'tasks'|'gifts'='tasks';private taskDetailsOpen=false;private taskWindowArea:Rect={x:0,y:0,w:0,h:0};
 private collection:MobileCollectionView|null=null;private collectionTab:'albums'|'packs'|'decorations'='albums';private albumId='';private decorationId='';private decorationOwnedOnly=false;private purchase:CollectionPack|null=null;
 private previewPack:CollectionPack|null=null;private previewIndex=-1;private previewGridScroll=0;
 private room:RoomClient|null=null;private board:PuzzleBoard|null=null;private detachRoom:(()=>void)|null=null;private unsubscribeRoom:(()=>void)|null=null;
 private cursor:CursorClient|null=null;private cursorVisible=false;
 private realtime:ManagedRoomRealtime|null=null;
 private roomArea:Rect={x:0,y:0,w:0,h:0};private roomImage='';private imageReady=false;private roomViewPending=false;private imageError='';private toolsOpen=false;private hidden=false;private completedId='';
 private aid:{grants:AssistanceGrant[];freeRemaining?:{hint:number;underlay:number};newcomerProtected?:boolean;serverTime:number}|null=null;
 private messages:PublicMessage[]=[];private chatCursor=0;private chatSeen=0;private chatLoading=false;private chatDraft='';
 private phraseGroup:0|1|2=0;
 private chatHits:Array<{r:Rect;message:PublicMessage}>=[];private chatPress:{x:number;y:number;timer:ReturnType<typeof setTimeout>}|null=null;
 private chatEntryArea:Rect={x:0,y:0,w:0,h:0};private chatWindowArea:Rect={x:0,y:0,w:0,h:0};
 private readonly social:SocialPanel;
 private readonly shareReward:TaskShareReward;
 private readonly audioSettings:AudioSettings;
 private timers:Array<ReturnType<typeof setInterval>>=[];private cleanups:Array<()=>void>=[];private attempts=new Map<string,string>();
 private handledQueries=new Set<string>();
 private historyRooms:MobileOwnedRoom[]|null=null;private historyLoading=false;private historyError='';private historySerial=0;
 private pendingViews?:ViewRequests;private lastDataOwner='';private lastAidClock='';
 private renderMode:PerformanceMode='smooth';
 private performanceInfoEnabled=false;
 private nineTimings=new Map<string,RoomRequestTiming>();
 private get nineGridAvailable(){return this.platform.config.id==='taptap'&&this.client.profile?.taptap?.diagnostics===true||this.platform.config.id==='web'&&this.client.config.identityMode==='web-cookie'&&this.client.profile?.diagnostics===true;}
 private get nineGridRoom(){return (this.room?.snapshot as (RoomTicket['room']&{diagnostic?:boolean})|undefined)?.diagnostic===true;}
 get diagnosticsAvailable(){return this.platform.config.development===true;}
 get performanceInfoVisible(){return this.diagnosticsAvailable&&this.performanceInfoEnabled;}
 set performanceInfoVisible(enabled:boolean){this.performanceInfoEnabled=enabled;}
 onRenderProbe:(()=>void)|null=null;
 get renderProbeAvailable(){return this.route==='room'&&!!this.board;}
 performanceDetails(){const board=this.board?.performanceDetails();return board?[board.gesture+' · '+board.pieces+'片 · 缓存'+(board.cache?'命中':'未使用'),'同步：'+(this.realtime?.connected?'实时连接':'请求同步'),'缓存重画 '+board.builds+' · 分配 '+board.allocations+' 次','缓冲 '+(board.bufferBytes/1048576).toFixed(1)+'MB · 触点 '+board.pointers]:['大厅'];}
 private sceneArea:Rect={x:0,y:0,w:0,h:0};private listArea:Rect={x:0,y:0,w:0,h:0};
 private albumListArea:Rect={x:0,y:0,w:0,h:0};private albumListScroll=0;private albumListExtent=0;
 constructor(readonly platform:Platform,readonly client:GameClient,readonly stage:Stage){
  try{const consent=JSON.parse(platform.storage.get(MOBILE_PRIVACY_CONSENT_KEY)||'null');this.privacyAccepted=consent?.version===MOBILE_PRIVACY_VERSION&&consent?.necessary===true&&consent?.hongKongStorage===true;}catch{}
  this.shareReward=new TaskShareReward(platform,requestId=>client.post<MobileInviteShareResult>('/api/mobile/invitations/share',{requestId,shared:true}));
  const saved=platform.storage.get('jigsaw:shared:theme:'+platform.config.apiBase);stage.setTheme(isThemeId(saved)?saved:'light');if(platform.canvas.style)platform.canvas.style.colorScheme=stage.theme==='dark'?'dark':'light';
  this.renderMode=platform.storage.get('jigsaw:shared:performance:'+platform.config.apiBase)==='power-saving'?'power-saving':'smooth';
  this.audioSettings=new AudioSettings(platform);
  this.social=new SocialPanel(client,{invalidate:()=>this.invalidate(),note:message=>this.note(message),joinRoom:(id,invite)=>this.enterRoom(id,invite),room:()=>{
   const room=this.room;if(!room)return null;return {id:room.ticket.room.id,title:room.snapshot.title||'一起拼图',pieces:room.state.cols*room.state.rows,visibility:room.snapshot.visibility,inviteCode:(this.client.ticket as RoomTicket&{inviteCode?:string})?.inviteCode||(room.snapshot as unknown as {inviteCode?:string}).inviteCode,authorization:'Bearer '+room.ticket.token,members:room.snapshot.members.map(member=>({...member,code:(member as unknown as {code?:string}).code,level:(member as unknown as {level?:number}).level}))};
  }});
 }
 private get colors(){return this.stage.palette;}
 private drawAudioLevel(kind:'music'|'effects',label:string,x:number,y:number,width:number){
  const s=this.stage,value=this.audioSettings.levels[kind],change=(next:number)=>{this.audioSettings.set(kind,next);this.invalidate();};
  s.text(label,x,y,14,this.colors.ink,700);s.text(Math.round(value*100)+'%',x+width-43,y,13,this.colors.muted,700,43);
  const track={x:x+45,y:y+29,w:width-90,h:32};s.frame(track,'rail-cream-normal');
  const gap=3,cell=(track.w-12-gap*9)/10;
  for(let index=0;index<10;index++){
   s.ctx.fillStyle=index<Math.round(value*10)?this.colors.berry:this.colors.placeholder;s.ctx.fillRect(track.x+6+index*(cell+gap),track.y+9,cell,14);
   s.hit({x:track.x+index*track.w/10,y:track.y-4,w:track.w/10,h:40},()=>change((index+1)/10));
  }
  s.button({x,y:y+25,w:38,h:40},'−',()=>change(value-.1),{fontSize:20,disabled:value===0});
  s.button({x:x+width-38,y:y+25,w:38,h:40},'+',()=>change(value+.1),{fontSize:20,disabled:value===1});
  return y+80;
 }
 private async toggleOrientation(){if(this.platform.config.id!=='taptap')return;await this.run(async()=>{if(!this.platform.setOrientation)throw Error('当前客户端不支持切换方向');const target=this.stage.w>this.stage.h?'portrait':'landscape';await this.platform.setOrientation(target);this.showModal(null);this.toolsOpen=false;this.invalidate();});}
 private async toggleFullscreen(){await this.run(async()=>{if(this.platform.config.id!=='web'||!this.platform.fullscreen?.available())return;try{await this.platform.fullscreen.toggle();this.showModal(null);this.invalidate();}catch{this.note('浏览器暂时无法切换全屏，请检查全屏权限后重试');}});}
 private toggleEffectsMute(){const key='jigsaw:shared:audio:last-effects',volume=this.audioSettings.levels.effects;if(volume>0){try{this.platform.storage.set(key,String(volume));}catch{}this.audioSettings.set('effects',0);}else{let previous=1;try{const saved=Number(this.platform.storage.get(key));if(Number.isFinite(saved)&&saved>0)previous=Math.min(1,saved);}catch{}this.audioSettings.set('effects',previous);}this.invalidate();}
 private get formalWeb(){return this.client.cookieIdentity;}
 private get needsPrivacyChoice(){return (this.platform.config.id==='taptap'||this.platform.config.id==='wechat')&&!this.privacyAccepted;}
 private get usesCreationTickets(){return this.client.config.capabilities.createTickets??(this.platform.config.id!=='web'&&!this.formalWeb);}
 private get pieceCounts(){return this.formalWeb?counts.filter(count=>(this.client.config.capabilities.supportedPieces??[108,300,500]).includes(count)):counts;}
 private webLink(key:WebPage){return this.platform.config.webLinks?.[key]??this.client.config.compatUrls?.[key]??({account:'/account',security:'/account/security',membership:'/membership',uploads:'/upload',terms:'/terms',privacy:'/privacy',feedback:'/feedback'}[key]);}
 private openWeb(key:WebPage){this.platform.openUrl?.(this.webLink(key));}
 private drawWebLinks(x:number,y:number,w:number){const s=this.stage,items:[WebPage,string][]=[['terms','用户协议'],['privacy','隐私政策'],['feedback','反馈']];items.forEach(([key,label],index)=>{const cw=w/items.length,cx=x+index*cw;s.text(label,cx+(cw-s.measure(label,10))/2,y,10,this.colors.muted);s.hit({x:cx,y:y-4,w:cw,h:22},()=>this.openWeb(key));});}
 private get desktop(){const v=this.platform.viewport();return this.platform.config.id==='web'&&v.width>=1000&&v.height>=600;}
 private get floatingTasks(){const v=this.platform.viewport();return v.width>v.height&&v.width>=540;}
 private get modalBlocksInput(){return this.modal!==null&&this.modal!=='tasks'&&this.modal!=='chat';}
 private modalContains(x:number,y:number){return this.modalBlocksInput||(this.modal==='tasks'&&inside(this.taskWindowArea,x,y))||(this.modal==='chat'&&inside(this.chatWindowArea,x,y));}
 private get energyEnabled(){return !this.formalWeb&&this.client.config.capabilities?.energy!==false;}
 private get shareAvailable(){return this.client.config.capabilities.shareRewards===true;}
 private rewardText(energy:number,xp:number,coins=0){return [this.energyEnabled&&energy>0?'体力 +'+energy:'',xp>0?'经验 +'+xp:'',coins>0?'金币 +'+coins:''].filter(Boolean).join(' · ')||'暂无可领取奖励';}
 private giftVisible(gift:{energyMax?:number;xp?:number;xpMax?:number;coins?:number;coinsMax?:number}){return this.energyEnabled||(gift.xpMax??gift.xp??0)>0||(gift.coinsMax??gift.coins??0)>0;}
 private setTheme(theme:ThemeId){this.stage.setTheme(theme);this.board?.setTheme(theme);if(this.platform.canvas.style)this.platform.canvas.style.colorScheme=theme==='dark'?'dark':'light';this.platform.storage.set('jigsaw:shared:theme:'+this.platform.config.apiBase,theme);this.invalidate();}
 get performanceMode():PerformanceMode{return this.renderMode??'smooth';}
 private setPerformanceMode(mode:PerformanceMode){if(this.performanceMode===mode)return;this.renderMode=mode;this.platform.storage.set('jigsaw:shared:performance:'+this.platform.config.apiBase,mode);this.invalidate();}
 private invalidate=()=>this.stage.invalidate();
 private ownerKey(){return this.client.authRequired?'':this.client.account?.id??this.client.profile?.code??'';}
 private get viewRequests(){return this.pendingViews??=new ViewRequests();}
 private loadView<T>(key:string,read:()=>Promise<T>,apply:(value:T)=>void){
  const owner=this.ownerKey();return this.viewRequests.run(key+':'+owner,read,value=>{apply(value);this.invalidate();},()=>!this.destroyed&&owner===this.ownerKey()).catch(error=>{if(!this.destroyed&&owner===this.ownerKey())throw error;});
 }
 private applyTasks(value:MobileTaskView){this.pendingViews?.invalidate();this.tasks=value;this.invalidate();}
 private applyCollection(value:MobileCollectionView){this.pendingViews?.invalidate();this.collection=value;this.invalidate();}
 private tickVisibleTime(){
  if(this.hidden||this.destroyed)return;
  const now=Date.now();let changed=false;
  if(this.messageUntil&&now>this.messageUntil){this.message='';this.messageUntil=0;changed=true;}
  const clock=this.route==='room'&&this.toolsOpen?(['hint','underlay'] as const).map(kind=>{const grant=this.activeAid(kind);return grant?Math.max(0,Math.ceil((grant.expiresAt-now)/1000)):0;}).join(':'):'';
  if(clock&&clock!==this.lastAidClock)changed=true;this.lastAidClock=clock;
  if(changed||this.authorizationTesting||this.platform.config.previewTestRoom&&(this.route==='room'||this.modal==='settings'))this.invalidate();
 }
 private note(message:string,permanent=false){this.message=message;this.messageUntil=permanent?Infinity:Date.now()+3000;this.invalidate();}
 private attempt(key:string){let value=this.attempts.get(key);if(!value){value=this.platform.randomId();this.attempts.set(key,value);}return value;}
 private async run(action:()=>Promise<void>){if(this.busy)return;this.busy=true;this.invalidate();try{await action();}catch(error){if(this.formalWeb&&(error as {code?:string}|null)?.code==='LEGACY_ROOM_REQUIRED')this.note('这间历史房间的进度仍然保留，新版暂不支持继续拼。请先选择其他房间。');else this.note(errorText(error));}finally{this.busy=false;this.invalidate();}}
 private async reauthorizeNickname(){
  if(this.platform.config.id!=='taptap'||this.platform.config.tapAuthorizationTest!==true)return;
  if(this.authorizationTesting){this.platform.cancelIdentity?.();return;}
  if(this.busy||this.room)return;
  this.authorizationTesting=true;this.loginDialogActive=true;this.showModal(null);
  try{await this.run(async()=>{try{await this.client.reauthorizeTapTap();if(!this.ready)await this.start();this.note('昵称授权与账号重连已完成，原进度保留');}catch(error){if(!this.ready)this.startupError=errorText(error);throw error;}});}
  finally{this.authorizationTesting=false;this.loginDialogActive=false;this.invalidate();}
 }
 async start(){
  if(this.destroyed)return;
  if(!this.identityHook&&this.platform.onIdentityChange){this.identityHook=true;this.cleanups.push(this.platform.onIdentityChange(()=>{if(this.destroyed)return;this.stage.input({type:'cancel',points:[],changed:[]});this.pointer=null;this.invalidate();}));}
  if(this.needsPrivacyChoice){this.prepareConsentButton();this.invalidate();return;}
  if(this.destroyed)return;if(this.startupPending)return this.startupPending;if(this.startupHooks&&this.ready)return;
  if(!this.startupHooks){
   this.startupHooks=true;
   this.client.onChange=()=>{if(this.destroyed)return;const owner=this.ownerKey();this.ensureListOwner();if(owner!==this.lastDataOwner){this.lastDataOwner=owner;this.pendingViews?.invalidate();this.historyRooms=null;this.historySerial++;this.historyLoading=false;this.historyError='';this.tasks=null;this.collection=null;this.galleryIds=null;this.freeGalleryIds=null;this.sharedPhotos=null;this.selected=null;}if(this.formalWeb&&this.client.authRequired){this.ready=false;this.stage.input?.({type:'cancel',points:[],changed:[]});this.pointer=null;this.modal=null;this.leaveRoom();this.route='lobby';}else if(this.formalWeb&&this.room&&!this.client.ticket){this.modal=null;this.leaveRoom();this.navigate('lobby');this.note('账号已切换，请重新进入房间');}this.invalidate();};
   this.cleanups.push(this.platform.onHide(()=>{this.hidden=true;this.realtime?.setHidden(true);this.pointer=null;this.cancelChatPress();}),this.platform.onShow(query=>{this.hidden=false;this.realtime?.setHidden(false);if(!this.ready){if(Object.keys(query).length)this.startupQuery=query;void this.start();}else{void this.client.refresh().catch(error=>{if(!this.destroyed)this.note(errorText(error));});void this.social.refresh();void this.handleQuery(query);}this.invalidate();}));
  }
  this.startupError='';this.invalidate();
  const epoch=this.privacyEpoch;
  this.startupPending=(async()=>{
  try{await this.client.start();if(this.destroyed||this.needsPrivacyChoice||epoch!==this.privacyEpoch)return;this.ready=true;this.message='';this.invalidate();const query=this.startupQuery??this.platform.initialQuery;this.startupQuery=null;await this.loadInitialContent(query,epoch);}
  catch(error){if(!this.destroyed){this.startupError=errorText(error);this.invalidate();}}
  if(this.destroyed||this.needsPrivacyChoice||epoch!==this.privacyEpoch||this.timers.length)return;
  this.timers.push(setInterval(()=>{if(this.destroyed||this.hidden||!this.ready)return;if(this.route==='lobby'&&!this.busy)void this.loadLobby(false,true);if((this.route==='tasks'||this.modal==='tasks')&&!this.busy)void this.loadTasks();if(this.route==='gallery'&&!this.busy)void this.loadGallery();if(this.route==='collection'&&!this.busy)void this.loadCollection();if(this.modal!=='social')void this.social.refresh();if(this.route==='room'&&this.modal!=='chat')void this.loadChat();},9000));
  this.timers.push(setInterval(()=>{if(this.destroyed||this.hidden||!this.ready)return;if(this.modal==='social')void this.social.refresh();else if(this.modal==='chat')void this.loadChat();},3000));
  this.timers.push(setInterval(()=>this.tickVisibleTime(),1000));
  this.invalidate();
  })().finally(()=>{if(epoch===this.privacyEpoch){this.startupPending=null;this.loginDialogActive=false;if(!this.destroyed)this.invalidate();}});
  return this.startupPending;
 }
 destroy(){this.destroyed=true;this.platform.cancelShare?.();this.platform.cancelIdentity?.();this.pendingViews?.invalidate();this.cancelChatPress();this.social.destroy();this.leaveRoom();this.client.onChange=undefined;for(const timer of this.timers)clearInterval(timer);for(const cleanup of this.cleanups)cleanup();}
 private async loadInitialContent(query:Record<string,string>,epoch=this.privacyEpoch){
  if(this.destroyed||this.needsPrivacyChoice||epoch!==this.privacyEpoch)return;
  const direct=/^[a-f0-9]{32}$/.test(query.room||query.roomId||'')||/^[a-zA-Z0-9-]{6,64}$/.test(query.invite||query.inviteCode||query.friend||query.ref||'');
  if(direct)await this.handleQuery(query);
  if(this.destroyed||this.needsPrivacyChoice||epoch!==this.privacyEpoch)return;
  // Gallery metadata must not hold up the lobby or an invited room's image.
  void this.loadGallery();
  if(this.route==='lobby')await this.loadLobby();
  if(!this.destroyed&&!this.needsPrivacyChoice&&epoch===this.privacyEpoch)void this.social.refresh().catch(()=>{});
 }
 resize(){
  const view=this.platform.viewport(),oldDesktop=this.platform.config.id==='web'&&this.stage.w>=1000&&this.stage.h>=600,newDesktop=this.platform.config.id==='web'&&view.width>=1000&&view.height>=600,rotated=(this.stage.w>this.stage.h)!==(view.width>view.height);
  this.cancelChatPress();this.clearRoomPointer();this.stage.input({type:'cancel',points:[],changed:[]});
  // A different layout needs a fresh fit; ordinary window resizing keeps the player's zoom.
  if(this.room&&(oldDesktop!==newDesktop||rotated))this.roomViewPending=true;
  this.invalidate();
 }
 private async handleQuery(query:Record<string,string>){
  if(!this.ready||this.destroyed)return;
  const invitation=query.invite||query.inviteCode||query.friend||query.ref;
  const room=query.room||query.roomId,key=[room??'',invitation??'',query.roomInvite??query.code??''].join(':');
  if((!room&&!invitation)||this.handledQueries.has(key))return;this.handledQueries.add(key);
  if(invitation&&/^[a-zA-Z0-9-]{6,64}$/.test(invitation)){this.pendingInvitation=invitation;this.modal='invite';await this.loadTasks();}
  if(room&&/^[a-f0-9]{32}$/.test(room)){await this.enterRoom(room,query.roomInvite||query.code);if(this.pendingInvitation)this.showModal('invite');}
 }
 private pendingInvitation='';
 private defaultListView(route:Route):ListView{return {route,scroll:0,albumListScroll:0,direction:'all',filterCount:0,openOnly:true,activeOnly:false,category:'全部',search:'',source:'free',packId:null,selected:null,collectionTab:'albums',albumId:'',decorationId:'',decorationOwnedOnly:false,taskTab:'tasks'};}
 private ensureListOwner(){
  const owner=this.ownerKey();this.savedRoutes??=new Map();this.routeFrames??=[];this.routeStack??=[];
  if(this.listOwner===undefined){this.listOwner=owner;return;}
  if(owner===this.listOwner)return;this.listOwner=owner;this.savedRoutes.clear();this.routeFrames=[];this.routeStack=[];this.roomReturn=null;this.roomReturnStack=[];this.roomReturnFrames=[];this.filterView=null;
  this.restoreListView(this.defaultListView(this.route));this.taskTab='tasks';this.lobbySerial=(this.lobbySerial??0)+1;this.rooms=[];this.lobbyCursor=null;
 }
 private captureListView():ListView{const base=this.defaultListView(this.route);for(const key of Object.keys(base) as Array<keyof ListView>){const value=this[key as keyof this];if(value!==undefined)(base as any)[key]=value;}return base;}
 private listViewKey(view=this.captureListView()){switch(view.route){case'lobby':return JSON.stringify(['lobby',view.direction,view.filterCount,view.openOnly,view.activeOnly]);case'gallery':return JSON.stringify(['gallery',view.direction,view.category,view.search,view.source,view.packId]);case'collection':return JSON.stringify(['collection',view.collectionTab,view.collectionTab==='albums'?view.albumId:view.collectionTab==='decorations'?view.decorationOwnedOnly:'']);case'tasks':return 'tasks:'+view.taskTab;default:return view.route;}}
 private saveListView(){this.ensureListOwner();const view=this.captureListView();if(view.route!=='room')this.savedRoutes.set(view.route,view);return view;}
 private restoreListView(view:ListView){
  this.route=view.route;this.scroll=view.scroll;this.extent=0;
  if(view.route==='lobby')Object.assign(this,{direction:view.direction,filterCount:view.filterCount,openOnly:view.openOnly,activeOnly:view.activeOnly});
  if(view.route==='gallery')Object.assign(this,{direction:view.direction,category:view.category,search:view.search,source:view.source,packId:view.packId,selected:view.selected});
  if(view.route==='collection')Object.assign(this,{collectionTab:view.collectionTab,albumId:view.albumId,albumListScroll:view.albumListScroll,decorationId:view.decorationId,decorationOwnedOnly:view.decorationOwnedOnly});
  if(view.route==='tasks')this.taskTab=view.taskTab;
 }
 private refreshRoute(){if(this.route==='lobby')void this.loadLobby(false,!!this.rooms.length);if(this.route==='gallery')void this.loadGallery();if(this.route==='tasks')void this.loadTasks();if(this.route==='collection')void this.loadCollection();}
 private finishNavigation(){this.modal=null;this.filterView=null;this.toolsOpen=false;this.message='';this.invalidate();this.refreshRoute();}
 private navigate(route:Route,context?:Partial<ListView>){
  if(this.formalWeb&&(route==='privacy'||route==='terms')){this.openWeb(route);return;}if(route==='tasks'&&this.floatingTasks){this.showModal('tasks');return;}
  this.social.close();if(route!=='room')this.clearRoomPointer();const previous=this.saveListView();
  if(route!==this.route){if(route==='lobby'||route==='room'){this.routeStack=[];this.routeFrames=[];}else{this.routeStack.push(this.route);this.routeFrames.push(previous);}this.restoreListView(this.savedRoutes.get(route)??this.defaultListView(route));}
  if(context){const before=this.listViewKey();Object.assign(this,context);if(this.listViewKey()!==before){this.scroll=0;if(route==='gallery')this.selected=null;}}
  this.finishNavigation();
 }
 private back(){
  this.social.close();this.saveListView();const previous=this.routeStack.pop()??(this.room?'room':'lobby'),frame=this.routeFrames.pop(),route=previous==='room'&&!this.room?'lobby':previous;
  this.restoreListView(frame?.route===route?frame:this.savedRoutes.get(route)??this.defaultListView(route));this.finishNavigation();
 }
 private changeListView(change:()=>void){this.saveListView();const before=this.listViewKey();change();if(before!==this.listViewKey())this.scroll=0;this.invalidate();}
 private openCollection(tab:ListView['collectionTab']){this.navigate('collection',{collectionTab:tab});}
 private openPackGallery(id:string){this.navigate('gallery',{packId:id,source:'owned'});}
 private selectAlbum(id:string){this.changeListView(()=>{this.albumId=id;});}
 private exitRoom(){this.ensureListOwner();const target=this.roomReturn;this.leaveRoom();this.roomReturn=null;this.routeStack=target?this.roomReturnStack:[];this.routeFrames=target?this.roomReturnFrames:[];this.roomReturnStack=[];this.roomReturnFrames=[];if(target){this.restoreListView(target);this.finishNavigation();}else this.navigate('lobby');}
 private filterView:ListView|null=null;
 private finishFilters(){const changed=this.filterView&&this.listViewKey(this.filterView)!==this.listViewKey();if(changed){this.scroll=0;if(this.route==='lobby'){this.lobbySerial++;this.rooms=[];this.lobbyCursor=null;void this.loadLobby();}}this.filterView=null;}
 private clearRoomPointer(){this.cursor?.point(null);this.board?.input({type:'cancel',points:[],changed:[]});this.pointer=null;this.cursorVisible=false;}
 private showModal(modal:Modal){this.cancelChatPress();this.stage.input({type:'cancel',points:[],changed:[]});if(modal)this.clearRoomPointer();if(this.modal==='social'&&modal!=='social')this.social.close();if(this.modal==='filters'&&modal!=='filters')this.finishFilters();if(modal==='filters'&&this.modal!=='filters')this.filterView=this.saveListView();this.modal=modal;this.modalScroll=modal==='chat'?Number.MAX_SAFE_INTEGER:0;this.modalExtent=0;if(modal==='social')this.social.open();if(modal==='chat'){this.chatSeen=this.chatCursor;void this.loadChat();}if(modal==='privacyRequests')void this.loadPrivacyRequests();if(modal==='history')void this.loadRoomHistory();if(modal==='manage')void this.client.refresh().catch(error=>this.note(errorText(error)));this.invalidate();if(modal==='invite'||modal==='tasks')void this.loadTasks();}
 private get ownedRoomCount(){return (this.client.profile?.ownedRooms??[]).filter(room=>!room.completed).length;}
 private async loadRoomHistory(){
  const owner=this.ownerKey(),serial=++this.historySerial;this.historyLoading=true;this.historyError='';this.invalidate();
  try{const data=await this.client.json<{rooms:MobileOwnedRoom[]}>('/api/room-history');if(owner!==this.ownerKey()||serial!==this.historySerial||this.destroyed)return;this.historyRooms=data.rooms.slice(0,10);}
  catch(error){if(owner===this.ownerKey()&&serial===this.historySerial&&!this.destroyed)this.historyError=errorText(error);}
  finally{if(owner===this.ownerKey()&&serial===this.historySerial&&!this.destroyed){this.historyLoading=false;this.invalidate();}}
 }
 private async removeOwnRoom(id:string){await this.run(async()=>{await this.client.post('/api/my-rooms',{action:'remove',roomId:id});await this.client.refresh();this.note('已从自创列表删除，历史记录和拼图进度保留');});}
 private drawSavedRoom(room:MobileOwnedRoom,left:number,cy:number,width:number,own:boolean){
  const s=this.stage,withDelete=own,thumb=room.thumbSrc??(room.imageId?photoMap.get(room.imageId)?.thumbSrc:undefined),textX=thumb?left+78:left+10,textWidth=width-(textX-left)-10;
  s.panel({x:left,y:cy,w:width,h:104});if(thumb)this.cardImage(thumb,{x:left+9,y:cy+10,w:58,h:46});
  s.text(room.completed?'已完成':room.title??'一起拼图',textX,cy+12,15,this.colors.ink,700,textWidth);
  const total=room.actualPieces??room.pieces??0,percent=clamp(Math.round((room.placed??0)/Math.max(1,total)*100),0,100);
  s.text(room.unavailable?'房间暂不可用':(room.players??0)+'人 · '+(total||'—')+'片 · '+(room.completed?'100':percent)+'%',textX,cy+37,12,this.colors.muted,undefined,textWidth);
  this.button(left+10,cy+65,withDelete?(width-26)/2:width-20,room.completed?'已完成':room.unavailable?'不可进入':'继续拼',()=>void this.enterRoom(room.id),'berry',30,room.completed===true||room.unavailable===true);
  if(withDelete)this.button(left+16+(width-26)/2,cy+65,(width-26)/2,'删除',()=>void this.removeOwnRoom(room.id),'cream',30);
  return cy+116;
 }
 private drawHistoryGrid(rooms:MobileOwnedRoom[],left:number,top:number,width:number){
  const s=this.stage,columns=width>=720?Math.min(4,Math.floor((width+12)/210)):width>=520?3:2,gap=12,cw=(width-gap*(columns-1))/columns,imageHeight=(cw-12)/1.12,ch=imageHeight+76;
  rooms.forEach((room,index)=>{
   const x=left+index%columns*(cw+gap),y=top+Math.floor(index/columns)*(ch+gap),art={x:x+6,y:y+6,w:cw-12,h:imageHeight};
   s.frame({x,y,w:cw,h:ch},'button-linen-normal');s.ctx.fillStyle=this.colors.cream;s.ctx.fillRect(x+6,y+6,cw-12,ch-12);
   if(room.thumbSrc)s.image(this.client.asset(room.thumbSrc),art);
   const total=room.actualPieces??room.pieces??0,percent=room.completed?100:Math.max(0,Math.min(100,Math.round((room.placed??0)/Math.max(1,total)*100))),copyY=y+imageHeight+13,small=cw<160;
   s.text(room.completed?'已完成':room.title??'一起拼图',x+10,copyY,small?13:16,this.colors.ink,800,cw-20);
   const metaY=copyY+24,font=small?10:12;s.text((total||'—')+'片',x+10,metaY,font,this.colors.muted);s.text((room.players??0)+'人',x+cw*.44,metaY,font,this.colors.muted);s.text(percent+'%',x+cw-10-s.measure(percent+'%',font,700),metaY,font,this.colors.ink,700);
   s.meter({x:x+10,y:y+ch-16,w:cw-20,h:8},percent/100);
   if(room.completed||room.unavailable){s.ctx.fillStyle='#6f374edb';s.ctx.fillRect(art.x,art.y+art.h-23,art.w,23);s.text(room.completed?'已完成':'暂不可用',art.x+8,art.y+art.h-18,11,'#fff9f0',700);}
   else s.hit({x,y,w:cw,h:ch},()=>{if(!this.busy)void this.enterRoom(room.id);});
  });
  return top+Math.ceil(rooms.length/columns)*(ch+gap);
 }
 private drawHistoryWindow(){
  const s=this.stage,v=this.platform.viewport(),w=Math.min(s.w-24,1000),x=(s.w-w)/2,y=Math.max(v.top+15,s.h*.1),h=s.h-y-v.bottom-24;
  s.ctx.fillStyle=this.colors.overlay;s.ctx.fillRect(0,0,s.w,s.h);s.hit({x:0,y:0,w:s.w,h:s.h},()=>{});s.panel({x,y,w,h});
  s.text('历史记录',x+17,y+18,20,this.colors.ink,700,w-73);s.button({x:x+w-45,y:y+12,w:30,h:30},'',()=>this.showModal(null));s.icon('close',{x:x+w-42,y:y+15,w:24,h:24},this.colors.ink);
  this.modalStart=y+59;this.modalArea={x:x+12,y:this.modalStart,w:w-24,h:h-73};let cy=this.modalStart-this.modalScroll;const left=x+20,width=w-40;
  s.clip(this.modalArea,()=>{
   cy=this.paragraph('最近加入的10个房间，点击卡片继续拼图。',left,cy,width,13)+15;
   if(this.historyLoading)cy=this.paragraph('正在读取历史记录…',left,cy,width,13)+15;
   if(this.historyError){cy=this.paragraph(this.historyError,left,cy,width,13)+12;this.button(left,cy,width,'重新读取',()=>void this.loadRoomHistory(),'cream',36);cy+=48;}
   cy=this.drawHistoryGrid(this.historyRooms??[],left,cy,width);
   if(!this.historyLoading&&!this.historyError&&!this.historyRooms?.length)cy=this.paragraph('还没有加入过房间，去大厅拼一会儿吧。',left,cy,width,14)+24;
   this.button(left,cy,width,'自己的房间',()=>this.showModal('manage'),'cream',40);cy+=52;
  });
  this.modalExtent=cy-(this.modalStart-this.modalScroll)+7;const next=Math.max(0,Math.min(this.modalScroll,Math.max(0,this.modalExtent-this.modalArea.h)));if(next!==this.modalScroll){this.modalScroll=next;this.invalidate();}
 }
 private setTaskTab(tab:'tasks'|'gifts'){this.taskTab=tab;if(this.modal==='tasks')this.modalScroll=0;else this.scroll=0;this.invalidate();}
 private openPublicMessage(message:PublicMessage){if(!message.code)return;this.showModal('social');this.social.openRoomMessage(message);}
 private cancelChatPress(){if(this.chatPress)clearTimeout(this.chatPress.timer);this.chatPress=null;}
 private async loadLobby(more=false,quiet=false){
  if(this.lobbyLoading){if(!more&&!quiet)this.lobbyReload=true;return;}this.lobbyLoading=true;this.lobbyQuiet=quiet;const serial=this.lobbySerial,owner=this.ownerKey(),showLoading=!quiet;let changed=false;if(showLoading)this.invalidate();
  try{const query='limit=16&direction='+this.direction+(this.filterCount?'&pieces='+this.filterCount:'')+(this.openOnly?'&open=1':'')+(this.activeOnly?'&active=1':'')+(more&&this.lobbyCursor?'&cursor='+encodeURIComponent(this.lobbyCursor):'');
   const data=await this.client.json<{rooms:RoomListing[];nextCursor?:string|null}>('/api/lobby?'+query);if(serial!==this.lobbySerial||owner!==this.ownerKey()||this.destroyed)return;
   if(!Array.isArray(data.rooms))throw Error('大厅数据暂不可用');
   let next:RoomListing[];
   if(more){const byId=new Map(this.rooms.map(room=>[room.id,room]));for(const room of data.rooms)byId.set(room.id,room);next=[...byId.values()];}
   else if(quiet&&this.rooms.length>16){const incoming=new Map(data.rooms.map(room=>[room.id,room]));next=this.rooms.map(room=>incoming.get(room.id)??room);const ids=new Set(next.map(room=>room.id));for(const room of data.rooms)if(!ids.has(room.id)){next.push(room);ids.add(room.id);}}
   else next=data.rooms;
   if(roomListKey(next)!==roomListKey(this.rooms)){this.rooms=next;changed=true;}
   if(!quiet||next.length<=16){const cursor=data.nextCursor??null;if(cursor!==this.lobbyCursor){this.lobbyCursor=cursor;changed=true;}}
  }catch(error){if(!quiet&&owner===this.ownerKey()&&!this.destroyed)this.note(errorText(error));}finally{this.lobbyLoading=false;this.lobbyQuiet=false;if(changed||showLoading)this.invalidate();if(this.lobbyReload&&!this.destroyed){this.lobbyReload=false;void this.loadLobby();}}
 }
 private get lobbyBusy(){return this.lobbyLoading&&!this.lobbyQuiet;}
 private changeDirection(value:Direction){if(value===this.direction)return;this.changeListView(()=>{this.direction=value;});if(this.route==='lobby'){this.lobbySerial++;this.rooms=[];this.lobbyCursor=null;void this.loadLobby();}}
 private async loadTasks(){try{await this.loadView('tasks',()=>this.client.json<MobileTaskView>('/api/mobile/tasks'),data=>{this.tasks=data;});}catch(error){if(!this.destroyed)this.note(errorText(error));}}
 private async loadCollection(){try{await this.loadView('collection',()=>this.client.json<MobileCollectionView>('/api/mobile/collection'),data=>{this.collection=data;});}catch(error){if(!this.destroyed)this.note(errorText(error));}}
 private async loadGallery(){try{await this.loadView('gallery',()=>this.client.json<{imageIds?:string[];accessibleImageIds?:string[];freeImageIds?:string[];packedImageIds:string[];photos?:SharedPhoto[];daily?:SharedPhoto|null}>('/api/mobile/gallery'),data=>{this.galleryIds=new Set(data.imageIds??data.accessibleImageIds??[]);this.packedIds=new Set(data.packedImageIds);this.freeGalleryIds=Array.isArray(data.freeImageIds)?new Set(data.freeImageIds):new Set([...this.galleryIds].filter(id=>!this.packedIds.has(id)));if(Array.isArray(data.photos)){this.sharedPhotos=data.photos.filter(photo=>!!photo&&typeof photo.id==='string'&&typeof photo.src==='string'&&typeof photo.thumbSrc==='string').map(photo=>({...photo,title:photo.title||photo.id,category:photo.category||'其他'}));for(const photo of this.sharedPhotos)photoMap.set(photo.id,photo);if(data.daily?.id)photoMap.set(data.daily.id,data.daily);}if(this.selected&&!this.galleryIds.has(this.selected))this.selected=null;});}catch(error){if(!this.destroyed)this.note(errorText(error));}}
 private availableGallery():SharedPhoto[]{if(this.sharedPhotos)return this.sharedPhotos.filter(photo=>!this.galleryIds||this.galleryIds.has(photo.id));if(!this.galleryIds)return GALLERY_PHOTOS;const baseIds=new Set(GALLERY_PHOTOS.map(photo=>photo.id));return [...GALLERY_PHOTOS,...RESTORABLE_PHOTOS.filter(photo=>!baseIds.has(photo.id))].filter(photo=>this.galleryIds!.has(photo.id));}
 private async launch(input:MobileRoomInput){
  if(!this.formalWeb&&this.ownedRoomCount>=3){this.showModal('manage');return;}
  await this.run(async()=>{const key='create:'+JSON.stringify(input),ticket=await this.client.createRoom({...input,requestId:this.attempt(key)});this.attempts.delete(key);await this.attachTicket(ticket);});
 }
 private async enterRoom(id:string,invite?:string){await this.run(async()=>{const ticket=await this.client.joinRoom(id,invite);await this.attachTicket(ticket);});}
 private async startNineGrid(){
  if(!this.nineGridAvailable)return;
  await this.run(async()=>{const ticket=await this.client.createDiagnosticRoom();this.nineTimings.clear();await this.attachTicket(ticket);});
 }
 private async testNineGridPiece(){
  if(!this.nineGridRoom||!this.board?.network)return;const room=this.room!,network=this.board.network,group=room.state.groups.find(group=>!group.locked);
  if(!group){this.note('九格已完成，点击重新摆放即可再测');return;}
  await this.run(async()=>{
   if(network.canAcquire?.(group.id)===false||!await network.acquire(group.id))throw Error('暂时不能拿起，请等待当前操作完成');
   network.move(group.id,group.dx,group.dy);await new Promise(resolve=>setTimeout(resolve,80));
   if(this.room===room)await network.drop(group.id,0,0);
  });
 }
 private leaveRoom(){this.cursor?.stop();this.cursor=null;this.cursorVisible=false;this.detachRoom?.();this.unsubscribeRoom?.();this.room?.leave();this.realtime?.close();this.realtime=null;this.board?.destroy?.();this.detachRoom=null;this.unsubscribeRoom=null;this.room=null;this.board=null;this.aid=null;}
 private async attachTicket(ticket:RoomTicket){
  if(this.destroyed||this.needsPrivacyChoice||this.client.authRequired)return;
  this.social.close();
  const source=this.saveListView();if(source.route!=='room'){this.roomReturn=source;this.roomReturnStack=[...this.routeStack];this.roomReturnFrames=[...this.routeFrames];}
  this.leaveRoom();this.route='room';this.routeStack=[];this.routeFrames=[];this.scroll=0;this.modal=null;this.imageReady=false;this.roomViewPending=false;this.imageError='';this.messages=[];this.chatCursor=0;this.chatSeen=0;this.completedId='';
  const realtime=this.client.roomRealtime?.(ticket,()=>this.room?.snapshot.revision??ticket.room.revision)??null;this.realtime=realtime;
  const room=new RoomClient(ticket,{fetch:this.client.fetchLike,realtime:realtime??undefined,profile:data=>{if(this.room===room)this.client.acceptRoomResponse(ticket,data);},refreshProfile:async()=>{if(this.room===room)await this.client.refresh();},randomId:()=>this.platform.randomId(),hidden:()=>this.hidden,now:()=>Date.now(),performanceNow:()=>Date.now(),emit:(name,detail)=>{
   if(name==='puzzle:successful-drop'&&this.room===room)this.board?.confirmMobileContribution(detail as MobileContributionReceipt);
   if(name==='mobile:profile')this.invalidate();
   if(name==='room:request-timing'&&this.room===room){const timing=detail as RoomRequestTiming;if(timing.action==='drop-start'){for(const key of ['drop','drop-queue','drop-total'])this.nineTimings.delete(key);}this.nineTimings.set(timing.action,timing);this.invalidate();}
   if(name==='mobile:gameplay-error')this.note((detail as {message?:string})?.message||'操作暂未完成');
   if(name==='mobile:energy-empty'){if(this.energyEnabled){this.note('体力不足，请使用礼包或补给');this.navigate('supplies');}else this.note('当前游戏规则需要重新连接，请返回大厅后再进入房间');}
  }});this.room=room;
  const board=new PuzzleBoard(this.platform,room.state,this.invalidate);this.board=board;board.setTheme(this.stage.theme);board.soundUrl='assets/audio/mobile-snap.wav';board.onNotice=message=>this.note(message);board.drawDecoration=(value,rect)=>this.stage.decoration(value,rect);board.selfDecoration=this.client.profile?.collection?.equipped??null;this.detachRoom=room.attach(board);
  const cursor=new CursorClient(ticket.room.id,ticket.token,ticket.playerId,cursors=>board.setCursors(cursors),()=>room.connected,()=>this.hidden||this.route!=='room'||this.modalBlocksInput,{retainUntilLeave:true,realtime:realtime??undefined,fetch:this.client.fetchLike,randomId:()=>this.platform.randomId(),now:()=>Date.now(),performanceNow:()=>Date.now(),subscribeVisibility:fn=>{const hide=this.platform.onHide(fn),show=this.platform.onShow(()=>fn());return()=>{hide();show();};}});this.cursor=cursor;board.onCursor=point=>cursor.point(point);cursor.start();realtime?.setHidden(this.hidden);realtime?.start();
  this.unsubscribeRoom=room.subscribe(()=>{if(room.snapshot.completedAt&&this.completedId!==room.snapshot.id){this.completedId=room.snapshot.id;if(this.nineGridRoom)this.note('九格已拼好，可以重新摆放继续测试');else{this.showModal('completion');void this.client.refresh().catch(()=>{});}}this.invalidate();});
  const photo=activeRoomPhoto(ticket.room,photoMap.get(ticket.room.puzzle.imageId));this.roomImage=this.client.asset(ticket.room.customImage?customPhoto(ticket.room.customImage,ticket.room.id).src:photo?.src??'');
  this.invalidate();if(this.nineGridRoom)board.setUnderlay(Date.now()+86400000);else void this.loadAssistance();
  try{if(!this.roomImage)throw Error('这张拼图的图片暂不可用');await board.setImage(this.roomImage);if(this.room!==room||this.board!==board)return;this.imageReady=board.imagePreparation.phase==='ready';this.roomViewPending=this.imageReady;}catch(error){if(this.room!==room||this.board!==board)return;this.imageError=errorText(error);this.note(this.imageError,true);}this.invalidate();
 }
 private async loadAssistance(){if(!this.room)return;try{const room=this.room;const data=await this.client.json<typeof this.aid>('/api/rooms/'+room.ticket.room.id+'/assistance','GET',undefined,{Authorization:'Bearer '+room.ticket.token});if(this.room!==room)return;if(data){const offset=Date.now()-data.serverTime;data.grants=data.grants.map(grant=>({...grant,expiresAt:grant.expiresAt+offset}));this.aid=data;this.applyAssistance();}}catch(error){this.note(errorText(error));}}
 private activeAid(kind:'hint'|'underlay'){const grants=this.aid?.grants??[],now=Date.now();for(let i=grants.length-1;i>=0;i--)if(grants[i].kind===kind&&grants[i].expiresAt>now)return grants[i];return undefined;}
 private applyAssistance(){if(!this.board)return;const underlay=this.activeAid('underlay'),hint=this.activeAid('hint');this.board.setUnderlay?.(underlay?.expiresAt??0);this.board.setHints?.(hint?.pieceIds??[],hint?.expiresAt??0);this.invalidate();}
 private showShareFailureDiagnostic(){if(this.platform.config.id==='taptap'&&this.client.profile?.taptap?.diagnostics===true)this.platform.alert('分享诊断（仅管理员）\n'+(this.platform.shareDiagnostics?.()??'当前包未提供诊断'));}
 private async shareFromGame(input:Parameters<Platform['share']>[0]){
  this.sharing=true;this.invalidate?.();try{return await this.platform.share(input);}finally{this.sharing=false;this.invalidate?.();}
 }
 private async releaseShareReservation(cancel:()=>Promise<unknown>){
  // 取消票据继续尽力提交；网络慢时最多等待0.8秒，避免用户再次被清理请求锁住。
  let timer:ReturnType<typeof setTimeout>|undefined;try{await Promise.race([Promise.resolve().then(cancel).catch(()=>{}),new Promise<void>(resolve=>{timer=setTimeout(resolve,800);})]);}finally{clearTimeout(timer);}
 }
 private async shareForReward(){
  const result=await this.shareFromGame({title:'来'+this.platform.config.gameName+'一起拼图',roomId:this.room?.ticket.room.id,inviteCode:this.tasks?.invitation.code,query:(this.client.ticket as RoomTicket&{inviteCode?:string})?.inviteCode?{roomInvite:(this.client.ticket as RoomTicket&{inviteCode:string}).inviteCode}:undefined});
  if(result==='unavailable')this.showShareFailureDiagnostic();
  if(result!=='shared')throw Error(result==='copied'?'仅复制链接不会发奖，请在分享面板选择好友或分享渠道':result==='cancelled'?'已取消分享，本次未领取奖励':'TapTap分享面板暂不可用，请从TapTap内打开新测试包后重试');
 }
 private async activateAssistance(kind:'hint'|'underlay'){
  if(!this.room||!this.aid)return;if(this.aid.grants.some(grant=>grant.kind===kind&&grant.expiresAt>Date.now()))return;
  await this.run(async()=>{const room=this.room!,key='aid-share:'+room.ticket.room.id+':'+kind,headers={Authorization:'Bearer '+room.ticket.token,'Content-Type':'application/json'},path='/api/rooms/'+room.ticket.room.id+'/assistance',context='room/'+room.ticket.room.id,storageKey='jigsaw:shared:'+this.platform.config.apiBase+':'+(this.client.profile?.code??'')+':'+key;
   let pending:any=null;try{const stored=JSON.parse(this.platform.storage.get(storageKey)||'null');if(stored?.kind===kind&&stored.context===context&&stored.completed===true)pending=stored;}catch{}
   const requestId=pending?.requestId??this.attempt(key);let data:any;
   try{data=await this.client.json(path,'POST',pending??{kind,requestId},headers);}catch(error){
    if(pending&&[400,401,403,410].includes((error as{status?:number}).status??0)){this.platform.storage.remove(storageKey);this.attempts.delete(key);throw error;}
    if((error as{code?:string}).code!=='SHARE_REQUIRED')throw error;if(!this.shareAvailable)throw Error('分享功能暂不可用，仍可正常拼图');
    const challenge=await this.client.json<{rewardToken:string}>('/api/mobile/share/challenge','POST',{kind,requestId,context},headers);
    pending={kind,requestId,context,rewardToken:challenge.rewardToken,completed:false};
    try{await this.shareForReward();}catch(failure){await this.releaseShareReservation(()=>this.client.json('/api/mobile/share/cancel','POST',pending,headers));throw failure;}
    pending.completed=true;this.platform.storage.set(storageKey,JSON.stringify(pending));data=await this.client.json(path,'POST',pending,headers);
   }
   this.platform.storage.remove(storageKey);this.attempts.delete(key);if(this.room!==room)return;const offset=Date.now()-data.serverTime;this.aid={...data,grants:data.grants.map((grant:AssistanceGrant)=>({...grant,expiresAt:grant.expiresAt+offset}))};this.applyAssistance();this.note(kind==='hint'?'提示已开启30秒':'底图已开启30秒');
  });
 }
 private async claimSupply(kind:'energy'|'create',method:'auto'|'share'='auto'){
  if(kind==='energy'&&this.platform.config.id==='taptap'&&method!=='share'&&this.energyAdAvailable){await this.claimEnergyAd();return;}
  await this.run(async()=>{const profile=this.client.profile;if(!profile)throw Error('玩家信息尚未就绪，请稍后再试');if(!this.shareAvailable)throw Error('当前平台暂未开放分享领取');
   const storageKey='jigsaw:shared:supply-share:v1:'+this.platform.config.apiBase+':'+profile.code;let pending:any=null;try{pending=JSON.parse(this.platform.storage.get(storageKey)||'null');}catch{}
   if(pending?.completed&&pending.kind!==kind)throw Error('上次分享奖励待到账，请先重试领取原来的补给');
   if(!pending?.completed){if(profile.supply[kind]>=3)throw Error('库存已满，使用后再领取');const requestId=this.platform.randomId(),context='supply',challenge=await this.client.post<{rewardToken:string}>('/api/mobile/share/challenge',{kind,requestId,context});pending={kind,requestId,context,rewardToken:challenge.rewardToken,completed:false};
    try{await this.shareForReward();}catch(failure){await this.releaseShareReservation(()=>this.client.post('/api/mobile/share/cancel',pending));throw failure;}
    pending.completed=true;this.platform.storage.set(storageKey,JSON.stringify(pending));
   }
   try{await this.client.post('/api/mobile/share/redeem',pending);}catch(error){if([400,401,403,410].includes((error as{status?:number}).status??0))this.platform.storage.remove(storageKey);throw error;}this.platform.storage.remove(storageKey);await this.client.refresh();this.note(kind==='energy'?'体力包 +1':'建房券 +1');
  });
 }
 private get energyAdAvailable(){return this.client.config.adRewardEnabled===true&&!!this.client.config.rewardedAdUnitId;}
 private get adTestingAllowed(){return this.platform.config.id==='taptap'&&this.client.profile?.taptap?.bound===true&&this.client.profile.taptap.diagnostics===true;}
 private async testRewardedAd(){
  if(!this.adTestingAllowed)return;
  // 优先使用服务端下发位；暂停广告时，诊断入口使用官方H5匹配且已真机验证的广告位。
  await this.run(async()=>{const unit=this.client.config.rewardedAdUnitId||'1054324';let outcome:string;
   try{outcome=await this.platform.watchAd(unit);}catch{outcome='failed';}
   const result=outcome==='completed'?'已完整观看，广告测试成功':outcome==='closed'?'已提前关闭，本次未完整观看':'广告测试未成功';
   // 只验证广告链路，不申请奖励、不受补给库存影响，也不改全服广告开关。
   this.platform.alert(result+'\n本入口仅测试观看，不发放奖励。\n'+(this.platform.adDiagnostics?.()??'未返回广告诊断'));this.note(result);
  });
 }
 private async testInterstitialAd(){
  if(!this.adTestingAllowed)return;
  await this.run(async()=>{const outcome=await this.platform.showInterstitialAd?.('1071588')??'unavailable',result=outcome==='closed'?'插屏广告已展示并关闭，测试成功':'插屏广告测试未成功';
   this.platform.alert(result+'\n本入口仅测试展示，不发放奖励。\n'+(this.platform.adDiagnostics?.()??'TapTap插屏接口不可用'));this.note(result);
  });
 }
 private async claimEnergyAd(){
  await this.run(async()=>{const profile=this.client.profile;if(!profile)throw Error('玩家信息尚未就绪，请稍后再试');if(!this.energyAdAvailable)throw Error('广告暂未开放，已有体力包可以正常使用');
   const storageKey='jigsaw:shared:supply-ad:v1:'+this.platform.config.apiBase+':'+profile.code;let pending:any=null;try{pending=JSON.parse(this.platform.storage.get(storageKey)||'null');}catch{}
   if(!pending?.completed){if(profile.supply.energy>=3)throw Error('库存已满，使用后再领取');const requestId=this.platform.randomId(),challenge=await this.client.post<{rewardToken:string}>('/api/mobile/supply/challenge',{kind:'energy',requestId});pending={kind:'energy',requestId,rewardToken:challenge.rewardToken,completed:false};
    let outcome:string;try{outcome=await this.platform.watchAd(this.client.config.rewardedAdUnitId);}catch{outcome='failed';}
    if(outcome!=='completed'){await this.client.post('/api/mobile/supply/cancel',pending).catch(()=>{});if(outcome!=='closed'&&this.platform.config.id==='taptap'&&this.client.profile?.taptap?.diagnostics===true)this.platform.alert('广告诊断（仅测试账号）\n'+(this.platform.adDiagnostics?.()??'未获取到平台错误'));throw Error(outcome==='closed'?'广告未完整观看，本次未领取体力包':'广告暂不可用，可点下方“分享领1个”领取');}
    pending.completed=true;this.platform.storage.set(storageKey,JSON.stringify(pending));
   }
   try{await this.client.post('/api/mobile/supply/redeem',pending);}catch(error){if([400,401,403,410].includes((error as{status?:number}).status??0))this.platform.storage.remove(storageKey);throw error;}this.platform.storage.remove(storageKey);await this.client.refresh();this.note('体力包 +1，已存入库存');
  });
 }
 private async useEnergy(){await this.run(async()=>{const key='use-energy';await this.client.post('/api/mobile/supply/use',{kind:'energy',requestId:this.attempt(key)});this.attempts.delete(key);await this.client.refresh();this.note('体力已补满');});}
 private async openGift(kind:string,quantity=1){await this.run(async()=>{const key='gift:'+kind;const data=await this.client.post<MobileGiftOpenResult>('/api/mobile/gifts/open',{kind,quantity,requestId:this.attempt(key)});this.attempts.delete(key);this.applyTasks(data);if((data.opened.coins??0)>0){try{this.platform.playSound?.('assets/audio/mobile-coin.wav');}catch{}}await this.client.refresh();this.note(this.rewardText(data.opened.energy,data.opened.xp,data.opened.coins??0));});}
 private async shareInvitation(){await this.run(async()=>{
  if(this.platform.config.id==='web'){const result=await this.platform.share({title:'来'+this.platform.config.gameName+'一起拼图',roomId:this.room?.ticket.room.id,inviteCode:this.tasks?.invitation.code});this.note(result==='copied'?'邀请链接已复制，可以粘贴给好友':result==='shared'?'已分享邀请链接':result==='cancelled'?'本次分享已取消':'浏览器暂不支持分享或复制，请使用邀请码');return;}

  const apply=async(data:MobileInviteShareResult)=>{this.applyTasks(data);await this.client.refresh();this.note(data.shared.alreadyRewarded?'今天的分享奖励已领完，仍可邀请好友':'分享奖励已到账：'+this.rewardText(data.shared.energy,data.shared.xp,data.shared.coins??0));};
  if(this.shareReward.pending()){await apply(await this.shareReward.claim());return;}
  if(!this.tasks)await this.loadTasks();if(!this.tasks)throw Error('邀请码暂时无法加载');const privateCode=(this.client.ticket as RoomTicket&{inviteCode?:string})?.inviteCode;
  const result=await this.shareFromGame({title:'来'+this.platform.config.gameName+'一起拼图',roomId:this.room?.ticket.room.id,inviteCode:this.tasks.invitation.code,query:privateCode?{roomInvite:privateCode}:undefined});
  if(result==='unavailable')this.showShareFailureDiagnostic();
  try{const receipt=await this.shareReward.complete(result);if(receipt){await apply(receipt);return;}}
  catch{this.note('分享已完成，奖励结果待确认；再次点击分享即可重试领取。');return;}
  this.note(result==='opened'?'已打开分享，请选择好友；好友有效参与后会计入任务':result==='copied'?'邀请链接已复制，可以粘贴给好友':result==='shared'?'已分享邀请，奖励以实际参与规则为准':result==='cancelled'?'本次分享已取消':'当前环境无法分享，请使用邀请码');
 });}
 private async acceptInvitation(){const code=this.pendingInvitation.trim();if(!code)return;await this.run(async()=>{await this.client.post('/api/mobile/invitations/accept',{code,requestId:this.attempt('accept:'+code)});this.pendingViews?.invalidate();this.attempts.delete('accept:'+code);this.pendingInvitation='';await this.loadTasks();this.note('已关联邀请，一起完成拼图吧');});}
 private async collectionAction(kind:'buy'|'craft'|'equip',id:string){await this.run(async()=>{const key=kind+':'+id;const data=await this.client.post<MobileCollectionView>('/api/mobile/collection/'+kind,{[kind==='buy'?'packId':'decorationId']:id,requestId:this.attempt(key)});this.applyCollection(data);this.attempts.delete(key);this.modal=null;await this.client.refresh();if(kind==='buy')void this.loadGallery();this.note(kind==='buy'?'图包已永久解锁':kind==='craft'?'装饰已合成':'装饰已装备');});}
 private async loadChat(){
  if(!this.room||this.chatLoading)return;this.chatLoading=true;
  try{const room=this.room,data=await this.client.json<any>('/api/rooms/'+room.ticket.room.id+'/chat?after='+this.chatCursor,'GET',undefined,{Authorization:'Bearer '+room.ticket.token});if(room!==this.room||this.destroyed)return;
   let changed=false;const incoming:PublicMessage[]=data.messages??[];
   if(incoming.length){const map=new Map(this.messages.map(item=>[item.id,item]));for(const item of incoming)map.set(item.id,item);const next=[...map.values()].slice(-60);if(messageListKey(next)!==messageListKey(this.messages)){this.messages=next;changed=true;}}
   this.chatCursor=data.cursor??this.chatCursor;if(this.modal==='chat'){if(this.messages.some(item=>item.id>this.chatSeen&&item.id<=this.chatCursor&&item.code!==this.client.profile?.code&&!this.social.blockedCodes.includes(item.code)))changed=true;this.chatSeen=this.chatCursor;}if(changed)this.invalidate();
  }catch(error){if(this.modal==='chat')this.note(errorText(error));}finally{this.chatLoading=false;}
 }
 private async retryRoomImage(board:PuzzleBoard){
  this.imageReady=false;this.imageError='';this.invalidate();
  try{await board.setImage(this.roomImage);if(this.board!==board)return;this.imageReady=board.imagePreparation.phase==='ready';this.message='';board.fit();}
  catch(error){if(this.board!==board)return;this.imageError=errorText(error);throw error;}
 }
 private async say(phraseId:number){if(!this.room||!Number.isSafeInteger(phraseId)||!phrases[phraseId])return;await this.run(async()=>{const room=this.room!,key='chat:'+phraseId;await this.client.json('/api/rooms/'+room.ticket.room.id+'/chat','POST',{phraseId,requestId:this.attempt(key),after:this.chatCursor},{Authorization:'Bearer '+room.ticket.token,'Content-Type':'application/json'});this.attempts.delete(key);await this.loadChat();});}
 private async sayText(){if(!this.formalWeb||!this.room)return;await this.run(async()=>{const room=this.room!,value=await this.platform.prompt('输入消息',this.chatDraft,{multiline:true,maxLength:300});if(value===null)return;const text=value.trim();this.chatDraft=text;if(!text||room!==this.room)return;if(text.length>300)throw Error('消息最多 300 字');const key='chat-text:'+room.ticket.room.id+':'+text;await this.client.json('/api/rooms/'+room.ticket.room.id+'/chat','POST',{text,requestId:this.attempt(key),after:this.chatCursor},{Authorization:'Bearer '+room.ticket.token,'Content-Type':'application/json'});this.attempts.delete(key);this.chatDraft='';await this.loadChat();});}

 private acceptPrivacy(){
  try{this.platform.storage.set(MOBILE_PRIVACY_CONSENT_KEY,JSON.stringify({version:MOBILE_PRIVACY_VERSION,necessary:true,hongKongStorage:true,acceptedAt:Date.now()}));}catch{}
  this.privacyAccepted=true;this.privacyDocument=null;this.privacyRefused=false;this.loginDialogActive=this.platform.config.id==='taptap';this.scroll=0;this.pointer=null;this.invalidate();void this.start();
 }
 private withdrawPrivacy(){
  this.privacyEpoch++;this.platform.cancelIdentity?.();this.startupPending=null;this.pendingViews?.invalidate();this.lobbySerial++;this.lobbyReload=false;
  this.leaveRoom();for(const timer of this.timers)clearInterval(timer);this.timers=[];for(const off of this.cleanups)off();this.cleanups=[];this.social.close();this.client.onChange=undefined;
  this.startupHooks=false;this.identityHook=false;this.consentPreparing=false;this.ready=false;this.modal=null;this.route='lobby';this.pointer=null;this.privacyAccepted=false;this.privacyDocument=null;this.privacyRefused=true;this.loginDialogActive=false;this.scroll=0;
  try{this.platform.storage.remove(MOBILE_PRIVACY_CONSENT_KEY);}catch{}this.invalidate();
 }
 private prepareConsentButton(){
  if(this.platform.config.id!=='taptap'||!this.platform.prepareTapConsent||this.consentPreparing||this.privacyRefused)return;
  this.consentPreparing=true;this.consentError='';this.platform.setIdentityButtonVisible?.(!this.privacyDocument);
  this.platform.prepareTapConsent(()=>{if(this.destroyed)return;this.consentPreparing=false;this.acceptPrivacy();},error=>{if(this.destroyed)return;this.consentPreparing=false;this.consentError=errorText(error);this.invalidate();});
 }
 private drawPrivacyChoice(){
  const s=this.stage,v=this.platform.viewport(),detail=this.privacyDocument!==null,entry=tapAuthorizationLayout(s.w,s.h,v.top,v.bottom),combined=this.platform.config.id==='taptap'&&!!this.platform.prepareTapConsent,waiting=this.platform.tapAuthorizationPending?.()===true;
  this.platform.setIdentityButtonVisible?.(!detail);
  const w=detail?Math.min(600,s.w-24):entry.panel.w,x=(s.w-w)/2,available=s.h-v.top-v.bottom-24,h=detail?available:entry.panel.h,top=v.top+12+(available-h)/2,bottom=top+h;
  s.panel({x,y:top,w,h});
  if(detail){
   s.text('服务与隐私协议',x+16,top+16,19,this.colors.ink,800,w-32);
   this.bodyTop=top+54;this.bodyBottom=bottom-70;this.listArea={x:x+15,y:this.bodyTop,w:w-30,h:Math.max(30,this.bodyBottom-this.bodyTop)};this.sceneArea={...this.listArea};
   const sections=[...mobilePrivacySections,...mobileTermsSections];let y=this.bodyTop-this.scroll;
   s.clip(this.listArea,()=>{for(const[title,text]of sections){s.text(title,x+18,y,14,this.colors.ink,750,w-36);y=this.paragraph(text,x+18,y+25,w-36,12)+17;}});
   this.extent=y-(this.bodyTop-this.scroll);this.scroll=clamp(this.scroll,0,Math.max(0,this.extent-this.listArea.h));
  }else{
   this.scroll=0;this.extent=0;this.bodyTop=top;this.bodyBottom=bottom;this.listArea={x,y:top,w,h:0};this.sceneArea={...this.listArea};
   const prefix='点击同意确认',size=16,prefixWidth=s.measure(prefix,size),linkWidth=s.measure('协议',size),start=x+(w-prefixWidth-linkWidth)/2,y=top+39;
   s.text(prefix,start,y,size,this.colors.ink,500);s.text('协议',start+prefixWidth,y,size,this.colors.berry,700);
   s.ctx.fillStyle=this.colors.berry;s.ctx.fillRect(start+prefixWidth,y+21,linkWidth,1);
   s.hit({x:start+prefixWidth-5,y:y-8,w:linkWidth+10,h:38},()=>{this.privacyDocument='privacy';this.scroll=0;this.platform.setIdentityButtonVisible?.(false);this.invalidate();});
   if(combined||waiting)this.paragraph(!this.needsPrivacyChoice&&!waiting?'正在登录TapTap，已有进度会保留。':this.consentError?'登录准备失败，请点重新连接。':'同时授权TapTap昵称，用于显示玩家名称。',x+20,top+78,w-40,11);
  }
  const gap=8,half=(w-32-gap)/2,back=()=>{this.privacyDocument=null;this.scroll=0;this.platform.setIdentityButtonVisible?.(true);this.invalidate();};
  s.button({x:x+16,y:bottom-54,w:half,h:38},detail?'返回':this.needsPrivacyChoice?'暂不同意':'取消登录',()=>{if(detail){back();return;}this.privacyRefused=true;this.platform.cancelIdentity?.();this.invalidate();},{fontSize:12});
  const right={x:x+24+half,y:bottom-54,w:half,h:38};
  if(detail&&combined){s.button(right,'返回登录',back,{fontSize:13,tone:'berrydark'});return;}
  if(!detail&&(waiting||combined)){
   if(waiting){s.frame(right,'button-berrydark-normal');s.text('同意并登录',right.x+(right.w-s.measure('同意并登录',13,750))/2,right.y+11,13,this.colors.onAccent,750);}
   else if(this.consentPreparing||!this.needsPrivacyChoice)s.button(right,'正在连接…',()=>{},{fontSize:13,tone:'berrydark',disabled:true});
   else s.button(right,'重新连接',()=>{this.privacyRefused=false;this.prepareConsentButton();this.invalidate();},{fontSize:13,tone:'berrydark'});
  }else s.button(right,'同意',()=>this.acceptPrivacy(),{fontSize:13,tone:'berrydark'});
 }
 private async loadPrivacyRequests(){
  if(this.privacyRequestsLoading||this.client.config.capabilities.privacyRequests!==true)return;this.privacyRequestsLoading=true;this.invalidate();
  try{const result=await this.client.json<{requests:PrivacyRequest[]}>('/api/mobile/privacy-request');this.privacyRequests=result.requests;}catch(error){this.note(errorText(error));}finally{this.privacyRequestsLoading=false;this.invalidate();}
 }
 private async submitPrivacyRequest(type:'access'|'delete'){
  await this.run(async()=>{const key='privacy-request:'+type,result=await this.client.post<{request:PrivacyRequest}>('/api/mobile/privacy-request',{requestId:this.attempt(key),type});this.privacyRequests=[result.request,...this.privacyRequests.filter(row=>row.requestId!==result.request.requestId)];this.attempts.delete(key);this.note(type==='delete'?'删除申请已登记，资料尚未删除。请保留编号并邮件联系运营者。':'访问申请已登记，等待核验。请保留编号并邮件联系运营者。');this.invalidate();});
 }
 drawForRenderProbe(directPaper:boolean){const board=this.board;if(!board||!directPaper){this.draw();return;}const enabled=board.paperCacheEnabled;board.paperCacheEnabled=false;try{this.draw();}finally{board.paperCacheEnabled=enabled;}}
 draw(){
  const s=this.stage;if(this.route==='room'){s.ctx.fillStyle=boardThemeColors(s.theme).paper;s.ctx.fillRect(0,0,s.w,s.h);}else s.background();
  if(this.needsPrivacyChoice||this.loginDialogActive||this.platform.tapAuthorizationPending?.()){this.drawPrivacyChoice();return;}
  this.sceneArea={x:0,y:0,w:s.w,h:s.h};this.listArea={...this.sceneArea};this.albumListArea={x:0,y:0,w:0,h:0};
  this.bodyBottom=s.h-this.platform.viewport().bottom-12;
  if(this.route==='room')this.drawRoom();
  else if(this.desktop){if(this.ready)this.drawDesktopShell();else s.withoutInput(()=>this.drawDesktopShell());const area=this.sceneArea;if(this.route==='collection'){const width=Math.min(contentMaxWidth+24,area.w);area.x+=(area.w-width)/2;area.w=width;this.listArea={...area};}s.withViewport(area,()=>{this.bodyTop=12;this.bodyBottom=s.h-12;this.drawScene();});this.bodyTop+=area.y;this.bodyBottom+=area.y;this.listArea={x:this.listArea.x||area.x,y:this.bodyTop,w:this.listArea.w||area.w,h:Math.max(0,this.bodyBottom-this.bodyTop)};}
  else{if(this.ready)this.drawHeader();else s.withoutInput(()=>this.drawHeader());const width=this.route==='collection'?Math.min(contentMaxWidth+24,s.w):s.w,x=(s.w-width)/2;this.sceneArea={x,y:0,w:width,h:s.h};if(x)s.withViewport(this.sceneArea,()=>this.drawScene());else this.drawScene();this.listArea={x,y:this.bodyTop,w:width,h:Math.max(0,this.bodyBottom-this.bodyTop)};}
  if(this.modal)this.drawModal();
  if(this.message&&Date.now()<=this.messageUntil)this.drawNotice();
  if(this.busy){const cancel=this.sharing&&!!this.platform.cancelShare,label=cancel?'等待分享 · 取消等待':'正在处理…',width=cancel?184:144,r={x:(s.w-width)/2,y:Math.max(this.platform.viewport().top+6,this.platform.config.id==='taptap'?44:0),w:width,h:28};s.panel(r,'cream');s.text(label,r.x+(width-s.measure(label,12))/2,r.y+6,12,this.colors.ink);if(cancel)s.hit(r,()=>this.platform.cancelShare?.());}
 }
 private drawScene(){if(!this.ready){this.drawLobbyStartup();return;}switch(this.route){case'lobby':this.drawLobby();break;case'gallery':this.drawGallery();break;case'tasks':this.drawTasks();break;case'supplies':this.drawSupplies();break;case'collection':this.drawCollection();break;default:this.drawPolicy();}this.clampListScroll();}
 private drawDesktopShell(){
  const s=this.stage,p=this.client.profile,nav=204,header=84;
  s.panel({x:12,y:12,w:nav-20,h:s.h-24});s.icon('piece',{x:29,y:32,w:30,h:33});s.text(this.platform.config.gameName,68,35,21,this.colors.ink,800,nav-86);s.text(this.formalWeb?'测试版 · 账号与进度保留':'一起拼出慢时光',30,77,this.formalWeb?10:12,this.colors.muted);
  const links:[string,string,boolean,()=>void][]=[['拼图大厅','players',this.route==='lobby',()=>this.navigate('lobby')],['挑选图片','underlay',this.route==='gallery',()=>this.navigate('gallery')],['我的相册','book',this.route==='collection'&&this.collectionTab==='albums',()=>this.openCollection('albums')],['任务与礼包','gift',this.route==='tasks',()=>this.navigate('tasks')],['主题图包','bag',this.route==='collection'&&this.collectionTab==='packs',()=>this.openCollection('packs')],['装饰收藏','leaf',this.route==='collection'&&this.collectionTab==='decorations',()=>this.openCollection('decorations')]];
  links.forEach(([label,icon,selected,action],index)=>s.button({x:25,y:122+index*53,w:nav-47,h:43},label,action,{tone:selected?'berry':'cream',icon,fontSize:15}));
  const foot=Math.max(452,s.h-125);s.button({x:25,y:foot,w:nav-47,h:37},this.formalWeb?'好友':'好友与消息',()=>this.showModal('social'),{icon:'chat',fontSize:13});s.button({x:25,y:foot+47,w:nav-47,h:37},'玩法与设置',()=>this.showModal('settings'),{icon:'tools',fontSize:13});
  if(this.formalWeb)this.drawWebLinks(23,s.h-29,nav-44);
  const x=nav+12,w=s.w-x-20,title=this.route==='lobby'?'今天，拼一会儿':this.route==='gallery'?'挑一幅喜欢的画':this.route==='tasks'?'每一次拼合，都有小收获':this.route==='collection'?'收藏属于你的美好':'慢慢拼，慢慢了解';
  s.text(title,x+8,25,24,this.colors.ink,800,w-425);s.text('每日一图 · 相册 · 与朋友一起完成',x+9,58,12,this.colors.muted,w-410);
  const ax=s.w-393;s.icon('coin',{x:ax,y:27,w:22,h:24});s.text(p?(p.collection?.coins??0):'—',ax+28,33,15,this.colors.ink,700,75);s.icon('fragment',{x:ax+108,y:28,w:21,h:24});s.text(p?(p.collection?.fragments??0):'—',ax+136,33,15,this.colors.ink,700,57);
  s.hit({x:ax-6,y:18,w:108,h:42},()=>this.showModal('coins'));s.hit({x:ax+102,y:18,w:100,h:42},()=>this.showModal('fragments'));
  s.icon('avatar',{x:s.w-182,y:20,w:42,h:46});s.text(p?.name??'读取玩家信息…',s.w-132,22,14,this.colors.ink,750,112);s.text(p?'Lv.'+p.level:'—',s.w-132,44,12,this.levelColor(p?.level??1),700);s.meter({x:s.w-82,y:48,w:58,h:7},(p?.xp??0)/Math.max(1,p?.xpToNext??1));s.hit({x:s.w-190,y:12,w:172,h:61},()=>this.showModal('settings'));
  s.ctx.fillStyle=this.colors.line;s.ctx.fillRect(x,header-4,w,1);this.sceneArea={x,y:header,w,h:s.h-header-12};this.listArea={x,y:header,w,h:s.h-header-12};
 }
 private drawLobbyStartup(){
  const s=this.stage,left=12,width=Math.min(1120,s.w-24),x=(s.w-width)/2,y=this.bodyTop+8;
  s.icon('piece',{x,y,w:28,h:28});s.text('拼图大厅',x+36,y+2,23,this.colors.ink,800,width-42);
  if(this.startupError||this.client.authRequired){
   const w=Math.min(440,width),cx=x+(width-w)/2,cy=y+60;this.extent=250;
   const by=this.paragraph(this.client.authRequired?'登录网站账号，即可继续使用已有进度与收藏。':this.startupError,cx+left,cy,w-24,15)+20;
   const retry=()=>void this.start();s.button({x:cx+12,y:by,w:w-24,h:40},'重新连接',retry,{tone:'berry'});
   if(this.formalWeb){s.button({x:cx+12,y:by+50,w:w-24,h:38},'登录 / 注册',()=>this.openWeb('account'));this.drawWebLinks(cx+12,by+108,w-24);}else{let next=by+54;if(this.platform.config.tapAuthorizationTest){s.button({x:cx+12,y:next,w:w-24,h:40},this.authorizationTesting?'取消昵称授权测试':'重新走昵称授权',()=>void this.reauthorizeNickname(),{disabled:this.busy&&!this.authorizationTesting});next+=54;next=this.paragraph(this.platform.tapIdentityDiagnostics?.()??'昵称授权自测',cx+12,next,w-24,11)+20;}if(this.platform.config.buildVersion)s.text('版本 '+this.platform.config.buildVersion,cx+12,next,11,this.colors.muted,500,w-24);}return;
  }
  s.text('正在读取房间与玩家信息…',x,y+43,13,this.colors.muted,500,width);
  const columns=this.desktop?Math.max(3,Math.min(4,Math.floor(width/240))):s.w>=640?3:2,gap=12,cw=(width-gap*(columns-1))/columns,h=Math.min(205,cw*.72+48),top=y+79;
  for(let index=0;index<columns;index++){const cx=x+index*(cw+gap);s.panel({x:cx,y:top,w:cw,h});s.ctx.fillStyle=this.colors.line;s.ctx.globalAlpha=.22;s.ctx.fillRect(cx+10,top+10,cw-20,h-55);s.ctx.fillRect(cx+12,top+h-31,cw*.58,8);s.ctx.fillRect(cx+12,top+h-16,cw*.35,5);s.ctx.globalAlpha=1;}
  this.extent=top+h-this.bodyTop+18;
 }
 private drawHeader(){
  const s=this.stage,p=this.client.profile,safe=this.platform.viewport().top,top=safe+12+(this.formalWeb?23:0),wide=s.w>=640&&s.h>560,small=s.w<360;
  if(this.formalWeb){s.text('测试版',13,safe+7,10,this.colors.muted);this.drawWebLinks(Math.max(75,s.w-224),safe+7,Math.min(212,s.w-87));}
  if(this.platform.config.id==='wechat'&&safe>=30)s.text(this.platform.config.gameName,14,safe-26,13,this.colors.ink,700,Math.max(100,s.w-160));
  const line=(y:number)=>{s.ctx.fillStyle=s.color('#c99586');s.ctx.fillRect(12,Math.round(y),s.w-24,1);};
  const energy=(x:number,y:number,width:number,size=16)=>{if(!this.energyEnabled){s.icon('coin',{x,y:y+7,w:24,h:26});s.text(p?(p.collection?.coins??0):'—',x+29,y+13,size,this.colors.ink,800,Math.max(24,width-30));s.hit({x:x-3,y,w:Math.max(24,width+3),h:42},()=>this.showModal('coins'));return;}s.icon('lightning',{x,y:y+3,w:22,h:31});const label=p?p.energy+'/'+p.energyCap:'—/—',tw=Math.min(s.measure(label,size,800),Math.max(24,width-49));s.text(label,x+25,y+12,size,this.colors.ink,800,tw+1);s.frame({x:x+29+tw,y:y+10,w:19,h:21},'plus-gold-normal');s.text('+',x+33+tw,y+11,17,'#fffaf0',700);s.hit({x,y,w:width,h:42},()=>this.navigate('supplies'));};
  if(this.route==='lobby'||this.route==='gallery'){
   let y=top;const gallery=this.route==='gallery';
   if(gallery){s.button({x:12,y,w:32,h:32},'',()=>this.back(),{icon:'back'});s.text('创建房间',53,y+3,small?22:24,this.colors.ink,800,s.w-(this.usesCreationTickets?157:65));if(this.usesCreationTickets)s.button({x:s.w-106,y,w:94,h:32},'券 '+(p?.supply.create??0),()=>this.navigate('supplies'),{tone:'linen',icon:'ticket',fontSize:12});line(y+37);y+=43;}
   const h=wide?74:56,avatar=wide?64:small?43:49,playerWidth=gallery?(small?127:151):wide?174:small?96:110;
   if(!gallery)line(y);s.icon('avatar',{x:12,y:y+3,w:avatar,h:h-5});s.hit({x:12,y,w:playerWidth,h},()=>this.showModal('settings'));
   const lx=12+avatar+4,lw=gallery?small?66:85:wide?92:small?42:55;
   s.text('Lv.'+(p?.level??'—'),lx,y+5,wide?23:small?14:16,this.levelColor(p?.level??0),800,lw);s.meter({x:lx,y:y+(wide?36:28),w:lw,h:8},p?p.xp/Math.max(1,p.xpToNext):0);s.text(p?p.xp+' / '+p.xpToNext:'—',lx,y+(wide?48:40),wide?12:10,this.colors.ink,500,lw+8);
   if(gallery){energy(12+playerWidth,y+5,Math.min(135,s.w-playerWidth-60),wide?20:16);s.icon('sprig',{x:s.w-45,y:y+h-39,w:30,h:28});}
   else{const compact=s.w<400,fontSize=wide?16:compact?10:12,padding=wide?8:small?4:7,gap=2,tw=wide?34:small?21:compact?23:27,sw=wide?44:small?26:compact?28:33;
    const taskWidth=tw+gap+s.measure('任务',fontSize,750)+padding*2,supplyWidth=sw+gap+s.measure('补给站',fontSize,750)+padding*2,supplyX=s.w-12-supplyWidth,taskX=supplyX-taskWidth,ex=12+playerWidth+4;
    energy(ex,y+(h-43)/2,taskX-ex-6,wide?22:small?14:16);
    s.ctx.fillStyle=s.color('#c99586');s.ctx.fillRect(taskX,y+7,1,h-14);s.ctx.fillRect(supplyX,y+7,1,h-14);
    const iy=y+(h-33)/2,ty=y+(h-fontSize)/2-1,taskIconX=taskX+padding,supplyIconX=supplyX+padding;
    s.icon('gift',{x:taskIconX,y:iy,w:tw,h:33});s.text('任务',taskIconX+tw+gap,ty,fontSize,this.colors.ink,750);s.hit({x:taskX,y,w:taskWidth,h},()=>this.navigate('tasks'));
    if((p?.giftCount??0)>0){s.ctx.fillStyle='#b46177';s.ctx.fillRect(taskIconX+tw-3,iy-2,13,13);s.text(Math.min(99,p?.giftCount??0),taskIconX+tw,iy-1,9,'#fff9ec',700);}
    s.icon('store',{x:supplyIconX,y:iy,w:sw,h:34});s.text('补给站',supplyIconX+sw+gap,ty,fontSize,this.colors.ink,750);s.hit({x:supplyX,y,w:supplyWidth,h},()=>this.navigate('supplies'));
    s.icon('sprig',{x:s.w-30,y:y-14,w:18,h:18});
   }
   line(y+h);this.bodyTop=y+h+9;return;
  }
  const title=this.route==='tasks'?'任务与礼包':this.route==='supplies'?'补给站':this.route==='collection'?'我的收藏':this.route==='privacy'||this.route==='terms'?'服务与隐私说明':'玩法与设置';
  s.button({x:12,y:top,w:32,h:34},'',()=>this.back(),{icon:'back'});s.text(title,53,top+6,this.route==='collection'&&small?20:23,this.colors.ink,800,this.route==='collection'?s.w-220:s.w-112);
  if(this.route==='collection'){const c=this.collection?.wallet??p?.collection;const coin=String(c?.coins??0),fragment=String(c?.fragments??0),fx=s.w-67,cx=fx-Math.max(61,s.measure(coin,12,700)+26);s.icon('coin',{x:cx,y:top+7,w:20,h:22});s.text(coin,cx+23,top+11,12,this.colors.ink,700,fx-cx-25);s.icon('fragment',{x:fx,y:top+7,w:19,h:22});s.text(fragment,fx+22,top+11,12,this.colors.ink,700,42);s.hit({x:cx-5,y:top,w:fx-cx,h:37},()=>this.showModal('coins'));s.hit({x:fx-4,y:top,w:64,h:37},()=>this.showModal('fragments'));}
  else if(this.route==='supplies'){energy(Math.max(151,s.w-169),top-1,104,small?13:15);if(!this.formalWeb){s.icon('ticket',{x:s.w-58,y:top+5,w:24,h:25});s.text(p?.supply.create??0,s.w-30,top+12,13,this.colors.ink,700);}}
  else s.button({x:s.w-52,y:top+1,w:38,h:32},'设置',()=>this.showModal('settings'),{fontSize:10});
  line(top+46);this.bodyTop=top+59;
 }

 private levelColor(level:number){return level>=1000?'#a34f8c':level>=500?'#4a4277':level>=300?'#ac5f82':level>=180?'#9971a7':level>=120?'#b6863c':level>=80?'#758795':level>=50?'#b16984':level>=30?'#ad843b':level>=20?'#8c6bac':level>=10?'#638ca7':level>=5?'#749866':this.colors.ink;}
 private drawNotice(){
  const s=this.stage,view=this.platform.viewport(),size=13,w=Math.min(s.w-24,340,Math.max(136,s.measure(this.message.replace(/\n/g,' '),size,600)+52)),textWidth=w-52,lines:string[]=[];
  let line='';for(const char of this.message){if(char==='\n'||s.measure(line+char,size,600)>textWidth){lines.push(line);line=char==='\n'?'':char;}else line+=char;}if(line)lines.push(line);
  const shown=lines.slice(0,3);if(lines.length>3){let last=shown[2];while(last&&s.measure(last+'…',size,600)>textWidth)last=last.slice(0,-1);shown[2]=last+'…';}
  const h=Math.max(35,shown.length*19+16),x=(s.w-w)/2,y=Math.max(view.top+10,this.platform.config.id==='taptap'?44:0)+(this.busy?34:0);s.ctx.save();s.ctx.globalAlpha=.94;s.ctx.fillStyle='#573b40';s.ctx.fillRect(x,y,w,h);s.ctx.restore();
  shown.forEach((text,index)=>s.text(text,x+12,y+9+index*19,size,'#fff8ed',600,textWidth));s.text('×',x+w-25,y+8,17,'#fff8ed',600,20);
  s.hit({x:x+w-35,y,w:35,h},()=>{this.message='';this.messageUntil=0;this.invalidate();});
 }

 private paragraph(text:string,x:number,y:number,w:number,size=14,color=this.colors.muted){this.stage.ctx.font=size+'px '+this.stage.font;let line='',cy=y;for(const char of text){if(char==='\n'||this.stage.ctx.measureText(line+char).width>w){this.stage.text(line,x,cy,size,color);line=char==='\n'?'':char;cy+=size*1.65;}else line+=char;}if(line)this.stage.text(line,x,cy,size,color);return cy+size*1.65;}
 private button(x:number,y:number,w:number,label:string,action:()=>void,tone='cream',h=38,disabled=false){this.stage.button({x,y,w,h},label,action,{tone,disabled:this.busy||disabled,fontSize:13});}
 private rowOptions<T extends string|number>(options:readonly (readonly[T,string])[],value:T,x:number,y:number,w:number,change:(value:T)=>void,h=34){this.stage.segments({x,y,w,h},options,value,change);}

 private scrolled(draw:()=>void,top=this.bodyTop,bottom=this.bodyBottom){this.stage.clip({x:0,y:top,w:this.stage.w,h:Math.max(0,bottom-top)},draw);}
 private clampListScroll(){if(this.route==='collection'&&!this.collection||this.route==='tasks'&&!this.tasks||this.route==='lobby'&&this.lobbyLoading&&!this.rooms.length)return;const next=clamp(this.scroll,0,Math.max(0,this.extent-Math.max(0,this.bodyBottom-this.bodyTop)));if(next!==this.scroll){this.scroll=next;this.invalidate();}}
 private cardImage(src:string,r:Rect){this.stage.frame(r,'panel-cream');this.stage.image(this.client.asset(src),{x:r.x+6,y:r.y+6,w:r.w-12,h:r.h-12},'cover');}

 private drawLobby(){
  const s=this.stage,narrow=s.w<360,landscape=s.w>s.h,short=landscape&&s.h<=560,large=s.w>=640&&!short,margin=narrow?9:12,width=Math.min(1120,s.w-2*margin),left=(s.w-width)/2;
  let y=this.bodyTop;const titleSize=large?30:short?25:narrow?20:23,titleIcon=large?34:narrow?25:28,titleWidth=titleIcon+5+s.measure('拼图大厅',titleSize,800),collectionWidth=large?67:48,socialWidth=large?72:49,headingHeight=large?44:short?36:34;
  s.icon('piece',{x:left,y:y+(headingHeight-titleIcon)/2,w:titleIcon,h:titleIcon});s.text('拼图大厅',left+titleIcon+5,y+(headingHeight-titleSize)/2-1,titleSize,this.colors.ink,800);
  const dailyX=left+titleWidth+(narrow?4:7),dailyWidth=Math.min(large?181:short?149:narrow?117:125,width-titleWidth-collectionWidth-socialWidth-19),dailyHeight=large?38:32;
  this.drawPictureButton({x:dailyX,y:y+(headingHeight-dailyHeight)/2,w:dailyWidth,h:dailyHeight},'每日拼图',()=>void this.launch({mode:'daily',pieces:108,visibility:'public'}),'berrydark','daily',large?15:narrow?10:11,large?20:14,this.busy||!this.client.profile);
  const collectionX=left+width-collectionWidth;s.icon('book',{x:collectionX,y:y+(headingHeight-27)/2,w:25,h:27});s.text('收藏',collectionX+27,y+(headingHeight-(large?16:12))/2,large?16:12,this.colors.ink,800);s.hit({x:collectionX,y,w:collectionWidth,h:headingHeight},()=>this.navigate('collection'));
  const socialX=collectionX-socialWidth-5;s.icon('players',{x:socialX,y:y+(headingHeight-23)/2,w:21,h:23});s.text('好友',socialX+24,y+(headingHeight-(large?16:12))/2,large?16:12,this.colors.ink,800);s.hit({x:socialX,y,w:socialWidth,h:headingHeight},()=>this.showModal('social'));const unread=this.social.unread+this.social.requestCount;if(unread){s.frame({x:socialX+12,y:y-3,w:17,h:17},'segment-berry-selected');s.text(Math.min(99,unread),socialX+16,y-1,9,this.colors.onAccent,700);}
  y+=headingHeight+6;const groupGap=narrow?5:8,filterGroup=(width-groupGap)*1.18/2.18,filterButton=large?95:narrow?29:58,filterGap=narrow?5:8,controlHeight=large?40:short?36:35,railHeight=large?38:33;
  s.segments({x:left,y:y+(controlHeight-railHeight)/2,w:filterGroup-filterButton-filterGap,h:railHeight},directions.slice(0,3),this.direction,v=>this.changeDirection(v));
  this.drawPictureButton({x:left+filterGroup-filterButton,y:y+(controlHeight-railHeight)/2,w:filterButton,h:railHeight},narrow?'':'筛选',()=>this.showModal('filters'),this.filterCount||this.activeOnly||this.direction==='square'?'berry':'linen','filter',large?15:11,large?18:13);
  const actionX=left+filterGroup+groupGap,actionGap=6,actionWidth=(width-filterGroup-groupGap-actionGap)/2,actionFont=large?16:narrow?10:11;
  this.drawPictureButton({x:actionX,y,w:actionWidth,h:controlHeight},'快速加入',()=>{const room=this.rooms.find(room=>room.players<8&&room.acceptingNew!==false&&!room.completed);if(room)void this.enterRoom(room.id);else this.note('暂时没有可加入的房间，可以创建一间');},'berry','players',actionFont,narrow?12:large?22:16,this.lobbyBusy);
  this.drawPictureButton({x:actionX+actionWidth+actionGap,y,w:actionWidth,h:controlHeight},'创建房间',()=>this.navigate('gallery'),'cream','create',actionFont,narrow?12:large?22:16);
  y+=controlHeight+9;{this.drawPictureButton({x:left,y,w:width,h:34},'继续上次拼图 · 历史记录',()=>this.showModal('history'),'cream','piece',13,16);y+=43;}
  this.bodyTop=y;const columns=this.desktop?Math.max(3,Math.min(5,Math.floor(width/240))):!landscape?2:short?Math.max(2,Math.floor((width+10)/170)):s.w>=1000?4:s.w>=640?3:2,gap=large?15:10,rowGap=large?15:9,cw=(width-gap*(columns-1))/columns,imageHeight=(cw-12)/1.12,ch=imageHeight+76;
  this.extent=Math.ceil(this.rooms.length/columns)*(ch+rowGap)+(this.lobbyCursor?60:18);
  this.scrolled(()=>{this.rooms.forEach((room,index)=>{const x=left+(index%columns)*(cw+gap),cy=this.bodyTop+Math.floor(index/columns)*(ch+rowGap)-this.scroll;if(cy+ch<this.bodyTop||cy>this.bodyBottom)return;
   const photo=room.photo??photoMap.get(room.imageId),thumb=room.thumbSrc??photo?.thumbSrc,total=room.actualPieces??room.pieces,percent=clamp(Math.round(room.placed/Math.max(1,total)*100),0,100),art={x:x+6,y:cy+6,w:cw-12,h:imageHeight};s.frame({x,y:cy,w:cw,h:ch},'button-linen-normal');s.ctx.fillStyle=this.colors.cream;s.ctx.fillRect(x+6,cy+6,cw-12,ch-12);if(thumb)s.image(this.client.asset(thumb),art);
   const copyY=cy+imageHeight+13;s.text(room.title,x+11,copyY,narrow?15:16,this.colors.ink,800,cw-22);const metaY=copyY+23;s.icon('piece',{x:x+11,y:metaY,w:15,h:17});s.text(total+'片',x+29,metaY+2,12);const peopleX=x+Math.max(64,cw*.37);s.icon('person',{x:peopleX,y:metaY,w:12,h:17},'#896c63');s.text(room.players+'/8',peopleX+15,metaY+2,12);s.text(percent+'%',x+cw-32,metaY+4,10,this.colors.ink,800);
   s.meter({x:x+11,y:cy+ch-16,w:cw-22,h:8},percent/100);if(room.players>=8||room.acceptingNew===false){s.ctx.fillStyle='#6f374edb';s.ctx.fillRect(art.x,art.y+art.h-23,art.w,23);s.text(room.players>=8?'已满员':'暂停加入',art.x+8,art.y+art.h-18,11,'#fff9f0',700);}
   s.hit({x,y:cy,w:cw,h:ch},()=>{if(room.players>=8)this.note('房间已满，请选择其他房间');else if(room.acceptingNew===false||room.completed)this.note('房间暂不接受加入');else void this.enterRoom(room.id);});});
   if(!this.rooms.length){const emptyY=this.bodyTop+28;s.icon('players',{x:left+width/2-22,y:emptyY,w:44,h:44});const message=this.lobbyBusy?'正在寻找拼图桌面…':'等你开第一桌';s.text(message,left+(width-s.measure(message,17,800))/2,emptyY+57,17,this.colors.ink,800);if(!this.lobbyBusy)this.drawPictureButton({x:left+width/2-75,y:emptyY+92,w:150,h:38},'创建房间',()=>this.navigate('gallery'),'berry','create',13,18);this.extent=200;}
   if(this.lobbyCursor)this.button(left+18,this.bodyTop+this.extent-54-this.scroll,width-36,this.lobbyBusy?'加载中…':'加载更多',()=>void this.loadLobby(true),'cream',38,this.lobbyBusy);
  });
 }
 private drawGallery(){
  const s=this.stage,narrow=s.w<360,landscape=s.w>s.h,short=landscape&&s.h<=560,large=s.w>=640&&!short,margin=narrow?9:12,width=Math.min(contentMaxWidth,s.w-margin*2),left=(s.w-width)/2,controlHeight=large?38:33,controlGap=narrow?6:9,directionWidth=(width-controlGap)*(narrow?.77:.83)/2;
  let y=this.bodyTop;s.segments({x:left,y,w:directionWidth,h:controlHeight},directions.slice(0,3),this.direction,v=>{this.selected=null;this.changeDirection(v);});const countX=left+directionWidth+controlGap,pieceCounts=this.pieceCounts,countWidth=(width-directionWidth-controlGap-4*(pieceCounts.length-1))/Math.max(1,pieceCounts.length);
  pieceCounts.forEach((count,i)=>this.drawPictureButton({x:countX+i*(countWidth+4),y,w:countWidth,h:controlHeight},String(count),()=>{this.pieces=count;this.invalidate();},this.pieces===count?'berry':'linen','piece',large?16:narrow?10:11,narrow?10:large?17:12,false,this.pieces===count));
  y+=controlHeight+5;const filterWidth=large?38:27,sourceGap=6,sourceSpace=width-filterWidth-3*sourceGap,sourceSpecs=[['free','免费图库','underlay',1.1],['owned','我的图包','bag',1.05],['all','全部','tools',.7]] as const;let sourceX=left;
  for(const [value,label,icon,weight]of sourceSpecs){const sw=sourceSpace*weight/2.85;this.drawPictureButton({x:sourceX,y,w:sw,h:large?38:32},label,()=>this.changeListView(()=>{if(this.source!==value||this.packId){this.source=value;this.packId=null;this.selected=null;}}),this.source===value?'berry':'linen',icon,large?15:12,large?21:16,false,this.source===value);sourceX+=sw+sourceGap;}
  this.drawPictureButton({x:left+width-filterWidth,y,w:filterWidth,h:large?38:32},'',()=>this.showModal('filters'),this.category!=='全部'||this.search||this.direction==='square'?'berry':'linen','filter',11,15);y+=(large?38:32)+6;
  const owned=new Set(this.client.profile?.collection?.ownedImageIds??[]),pack=this.packId?(this.collection?.packs.find(p=>p.id===this.packId)??collectionCatalog.packs.find(p=>p.id===this.packId)):null;if(pack){s.icon('book',{x:left+2,y,w:23,h:25});s.text(pack.title,left+30,y+5,12,this.colors.ink,700,width-127);s.text('查看所有图包',left+width-88,y+6,11,this.colors.muted);s.hit({x:left+width-96,y,w:96,h:30},()=>this.changeListView(()=>{this.packId=null;this.selected=null;}));y+=34;}
  this.bodyTop=y;const photos=this.availableGallery().filter(photo=>(this.direction==='all'||orientation(photo.id)===this.direction)&&(this.category==='全部'||this.category===photo.category)&&photo.title.includes(this.search)&&(!pack||pack.imageIds.includes(photo.id))&&(this.source==='all'||this.source==='free'&&!!this.freeGalleryIds?.has(photo.id)||this.source==='owned'&&owned.has(photo.id))),columns=this.desktop?Math.max(3,Math.min(5,Math.floor(width/240))):!landscape?2:short?Math.max(2,Math.floor((width+10)/170)):s.w>=1000?4:s.w>=640?3:2,gap=large?15:10,rowGap=large?15:9,cw=(width-gap*(columns-1))/columns,imageHeight=(cw-12)/1.38,captionHeight=narrow?47:30,ch=imageHeight+captionHeight+12,dockHeight=short?80:131,bottom=s.h-this.platform.viewport().bottom-dockHeight-9;this.bodyBottom=bottom;this.extent=Math.ceil(photos.length/columns)*(ch+rowGap)+12;
  this.scrolled(()=>{photos.forEach((photo,index)=>{const x=left+(index%columns)*(cw+gap),cy=y+Math.floor(index/columns)*(ch+rowGap)-this.scroll;if(cy+ch<y||cy>bottom)return;const selected=this.selected===photo.id,art={x:x+6,y:cy+6,w:cw-12,h:imageHeight};s.frame({x,y:cy,w:cw,h:ch},selected?'panel-gold':'button-linen-normal');s.ctx.fillStyle=selected?s.color('#fff3e7'):this.colors.cream;s.ctx.fillRect(x+6,cy+6,cw-12,ch-12);s.image(this.client.asset(photo.thumbSrc),art);
   if(selected){s.frame({x:art.x+5,y:art.y+5,w:27,h:27},'segment-berry-selected');s.icon('check',{x:art.x+10,y:art.y+10,w:17,h:17},'#fff9ed');}
   const label=this.freeGalleryIds?.has(photo.id)?'免费':owned.has(photo.id)?'已拥有':'图包',labelWidth=label.length*10+10,labelX=x+cw-labelWidth-10,captionY=cy+imageHeight+12;s.text(photo.title,x+10,captionY,narrow?14:large?17:15,this.colors.ink,800,narrow?cw-20:Math.max(32,cw-labelWidth-28));const tagY=narrow?captionY+21:captionY-1;s.ctx.fillStyle=owned.has(photo.id)?'#cc8996':'#f2d5ad';s.ctx.fillRect(labelX,tagY,labelWidth,18);s.text(label,labelX+5,tagY+3,10,owned.has(photo.id)?'#fff8ec':'#674625',700);s.hit({x,y:cy,w:cw,h:ch},()=>{this.selected=photo.id;this.invalidate();});});if(!photos.length){const message=this.source==='owned'?'收藏一个喜欢的图包':'换个条件试试';s.icon(this.source==='owned'?'book':'underlay',{x:left+width/2-26,y:y+20,w:52,h:52});s.text(message,left+(width-s.measure(message,17,800))/2,y+85,17,this.colors.ink,800);this.drawPictureButton({x:left+width/2-85,y:y+122,w:170,h:36},this.source==='owned'?'前往主题图包':'查看全部图片',()=>{if(this.source==='owned')this.openCollection('packs');else{this.changeListView(()=>{this.direction='all';this.category='全部';this.search='';this.source='all';this.packId=null;this.selected=null;});}},'cream','book',12,17);this.extent=190;}},y,bottom);
  const dockWidth=Math.min(short?1120:700,width),dockX=(s.w-dockWidth)/2,dockY=bottom+7,dockInner=dockWidth-24,photo=this.selected?photoMap.get(this.selected):null,freeOwned=!!this.selected&&owned.has(this.selected)&&this.visibility==='public',freeFirst=!!this.client.profile?.firstSelectionAvailable,available=(this.client.profile?.supply.create??0)>0,roomCount=this.client.profile?.ownedRooms.length??0;
  s.frame({x:dockX,y:dockY,w:dockWidth,h:dockHeight},'panel-cream');const actionW=short?(dockInner-(s.w>730?355:165)-14):Math.floor((dockInner-9)/2.35),actionX=dockX+dockWidth-12-actionW,optionsW=short?158:actionX-dockX-25,optionsX=dockX+12,optionsY=dockY+10;
  const manageWidth=25,optionGap=4,optionWidth=(optionsW-manageWidth-2*optionGap)/2;this.drawPictureButton({x:optionsX,y:optionsY,w:optionWidth,h:31},'公开',()=>{this.visibility='public';this.invalidate();},this.visibility==='public'?'berry':'linen','players',11,narrow?11:13,false,this.visibility==='public');this.drawPictureButton({x:optionsX+optionWidth+optionGap,y:optionsY,w:optionWidth,h:31},'私人',()=>{this.visibility='private';this.invalidate();},this.visibility==='private'?'berry':'linen','lock',11,narrow?11:13,false,this.visibility==='private');s.text(this.formalWeb?'房间':roomCount+'/3',optionsX+optionsW-manageWidth+2,optionsY+11,10,this.colors.muted);s.hit({x:optionsX+optionsW-manageWidth,y:optionsY,w:manageWidth,h:31},()=>this.showModal('manage'));
  if(!short||s.w>730){const previewX=short?optionsX+177:optionsX,previewY=short?dockY+12:dockY+53,previewW=short?167:optionsW,thumbSize=narrow?34:short?45:48;if(photo){s.frame({x:previewX,y:previewY,w:thumbSize,h:thumbSize},'plus-cream-normal');s.image(this.client.asset(photo.thumbSrc),{x:previewX+3,y:previewY+3,w:thumbSize-6,h:thumbSize-6});s.text(photo.title,previewX+thumbSize+6,previewY+3,narrow?11:13,this.colors.ink,800,previewW-thumbSize-7);s.text(this.pieces+'片',previewX+thumbSize+6,previewY+21,10,this.colors.muted);s.text(!this.usesCreationTickets?(freeOwned?'已拥有':this.formalWeb?'按当前账号权限创建':'可直接创建'):freeOwned?'已拥有':freeFirst?'首次免费':'建房券 ×1',previewX+thumbSize+6,previewY+36,10,this.colors.muted,previewW-thumbSize-7);}else{s.icon('piece',{x:previewX,y:previewY+8,w:24,h:27});this.paragraph('点选一张喜欢的图片',previewX+29,previewY+8,previewW-31,11);}}
  s.ctx.strokeStyle=s.color('#d5ac99');s.ctx.lineWidth=1;s.ctx.beginPath();s.ctx.moveTo(actionX-8,dockY+10);s.ctx.lineTo(actionX-8,dockY+dockHeight-12);s.ctx.stroke();
  const createLabel=!this.usesCreationTickets?'创建':roomCount>=3?'管理房间':freeOwned?'创建公开房间':freeFirst?'首次免费创建':available?'用券创建房间':this.shareAvailable?'分享领建房券':'暂无建房券',createAction=()=>{if(!this.formalWeb&&roomCount>=3){this.showModal('manage');return;}if(!this.selected){this.note('先选择一张图片');return;}if(!this.usesCreationTickets||freeOwned||freeFirst||available)void this.launch({mode:'selected',pieces:this.pieces,visibility:this.visibility,imageId:this.selected});else void this.claimSupply('create');},createW=short?(actionW-6)/2:actionW,createH=short?52:49,createY=dockY+10;
  this.drawPictureButton({x:actionX,y:createY,w:createW,h:createH},createLabel,createAction,'berrydark','players',narrow?10:11,short?15:16,this.busy||!this.client.profile||(this.usesCreationTickets&&!freeOwned&&!freeFirst&&!available&&!this.shareAvailable&&roomCount<3));this.drawPictureButton({x:short?actionX+createW+6:actionX,y:short?createY:createY+createH+7,w:short?createW:actionW,h:short?createH:35},'随机公开房 · 免费',()=>void this.launch({mode:'random',pieces:this.pieces,visibility:'public',direction:this.direction}),'cream','dice',narrow?9:11,narrow?11:15,this.busy||!this.client.profile);
 }
 private drawPictureButton(r:Rect,label:string,fn:()=>void,tone='cream',icon='',fontSize=11,iconSize=16,disabled=false,selected=false){
  const s=this.stage,c=s.ctx;c.save();if(selected){s.frame(r,'button-'+tone+'-'+(disabled?'disabled':'selected'));if(!disabled)s.hit(r,fn);}else s.button(r,'',fn,{tone,disabled});const accent=tone==='berry'||tone==='berrydark'||tone==='gold',textColor=disabled?this.colors.disabled:accent?'#fffaf0':this.colors.ink,gap=label&&icon?3:0,contentWidth=s.measure(label,fontSize,750)+(icon?iconSize:0)+gap,start=r.x+(r.w-contentWidth)/2;if(icon)s.icon(icon,{x:start,y:r.y+(r.h-iconSize)/2,w:iconSize,h:iconSize},disabled?this.colors.disabled:accent?'#fffaf0':icon==='create'?this.colors.gold:undefined);if(label)s.text(label,start+(icon?iconSize+gap:0),r.y+(r.h-fontSize)/2-1,fontSize,textColor,750);c.restore();
 }
 private drawTasks(inWindow=false){
  const s=this.stage,data=this.tasks,p=this.client.profile,pad=12,w=s.w-24,columns=w>=740?2:1,gap=16,cw=(w-gap*(columns-1))/columns;let y=this.bodyTop;
  if(!this.desktop&&!inWindow){s.icon('avatar',{x:pad,y,w:40,h:43});s.text('Lv.'+(p?.level??1),pad+47,y+3,15,this.colors.ink,700);s.meter({x:pad+47,y:y+26,w:70,h:7},(p?.xp??0)/Math.max(1,p?.xpToNext??1));s.icon(this.energyEnabled?'lightning':'coin',{x:s.w-130,y:y+8,w:23,h:27});s.text(this.energyEnabled?(p?.energy??0)+'/'+(p?.energyCap??0):String(p?.collection?.coins??0),s.w-99,y+14,15,this.colors.ink,700,83);if(!this.energyEnabled)s.hit({x:s.w-134,y,w:118,h:45},()=>this.showModal('coins'));y+=55;}
  const tabW=Math.min(220,(w-8)/2),tabH=inWindow?32:38;s.button({x:pad,y,w:tabW,h:tabH},'拼图任务',()=>this.setTaskTab('tasks'),{tone:this.taskTab==='tasks'?'berry':'cream',icon:'daily',fontSize:inWindow?13:15});s.button({x:pad+tabW+8,y,w:tabW,h:tabH},'我的礼包',()=>this.setTaskTab('gifts'),{tone:this.taskTab==='gifts'?'berry':'cream',icon:'gift',fontSize:inWindow?13:15});
  this.bodyTop=y+tabH+(inWindow?10:15);if(!data){s.text('正在整理任务与礼包…',pad+8,this.bodyTop+25,14);this.extent=0;return;}
  let cy=this.bodyTop-this.scroll;const gifts=data.inventory.filter(gift=>gift.count>0&&this.giftVisible(gift)),giftCount=gifts.reduce((n,g)=>n+g.count,0),full=(p?.energy??0)>=(p?.energyCap??1);
  const drawGift=(gift:typeof gifts[number],r:Rect)=>{s.panel(r);const art=gift.effect==='full-energy'&&this.energyEnabled?'refillGift':gift.kind.startsWith('ten')?'pouch':gift.kind.startsWith('friend')?'goldGift':'xpChest';s.icon(art,{x:r.x+13,y:r.y+17,w:55,h:57});const title=!this.energyEnabled&&gift.effect==='full-energy'?'邀请礼包':gift.title;s.text(title+' ×'+gift.count,r.x+80,r.y+16,15,this.colors.ink,750,r.w-94);let ry=r.y+45;
   const range=(min:number,max:number)=>String(min)+(max!==min?'～'+max:'');const lines=[this.energyEnabled?(gift.effect==='full-energy'?'恢复至当前体力上限':'体力 +'+range(gift.energyMin,gift.energyMax)):'',(gift.xpMax??gift.xp)>0?'经验 +'+range(gift.xpMin??gift.xp,gift.xpMax??gift.xp):'',(gift.coinsMax??gift.coins??0)>0?'金币 +'+range(gift.coinsMin??gift.coins??0,gift.coinsMax??gift.coins??0):''].filter(Boolean);for(const line of lines){s.text(line,r.x+80,ry,12,this.colors.muted,500,r.w-94);ry+=19;}
   const blocked=this.energyEnabled&&gift.effect==='full-energy'&&full;s.button({x:r.x+12,y:r.y+r.h-45,w:r.w-24,h:34},blocked?'体力已满':gift.effect==='full-energy'&&this.energyEnabled?'使用一份':'开启一份',()=>void this.openGift(gift.kind),{tone:'berry',fontSize:12,disabled:this.busy||blocked});};
  const drawTask=(task:typeof data.tasks[number],r:Rect)=>{s.panel(r);const title=task.title||({beginner:'新手任务',sharing:'分享邀请',invitation:'邀请好友',friend:'好友默契',cooperation:'一起拼图'}[task.group]),art=task.group==='sharing'?'invitationArt':task.group==='invitation'||task.group==='friend'?'friendArt':'cooperationArt';s.icon(art,{x:r.x+12,y:r.y+17,w:53,h:55});s.text(title,r.x+77,r.y+16,16,this.colors.ink,750,r.w-92);const copy=task.group==='sharing'?'每日分享最多 '+task.target+' 次':task.group==='invitation'?'好友完成 '+data.invitation.requiredContributions+' 次有效拼合':'完成 '+task.target+' 次'+(task.group==='friend'?'好友':'协作')+'拼合';s.text(copy,r.x+77,r.y+45,11,this.colors.muted,500,r.w-92);
   const reward=this.energyEnabled&&task.effect==='full-energy'?'补满体力包'+(task.xp?' · 经验 +'+task.xp:'')+taskCoinsText(task.coins??0):this.rewardText(task.energy,task.xp,task.coins??0);s.text(reward,r.x+14,r.y+86,12,this.colors.ink,600,r.w-28);
   const label=Math.min(task.progress,task.target)+' / '+task.target;s.meter({x:r.x+14,y:r.y+112,w:r.w-87,h:8},task.progress/Math.max(1,task.target));s.text(label,r.x+r.w-66,r.y+108,11,this.colors.muted,700,56);
   const actionable=task.group==='sharing'||task.group==='invitation'||task.earned,action=()=>task.group==='sharing'?void this.shareInvitation():task.group==='invitation'?this.showModal('invite'):this.setTaskTab('gifts');s.button({x:r.x+12,y:r.y+r.h-45,w:r.w-24,h:33},task.group==='sharing'?'分享邀请':task.group==='invitation'?'邀请好友':task.earned?'查看已存礼包':'进行中',action,{tone:actionable?'berry':'cream',fontSize:12,disabled:this.busy||!actionable});};
  const drawGrid=<T,>(items:T[],height:number,draw:(item:T,r:Rect)=>void)=>{const base=cy;items.forEach((item,index)=>{const r={x:pad+(index%columns)*(cw+gap),y:base+Math.floor(index/columns)*(height+gap),w:cw,h:height};if(r.y+r.h>=this.bodyTop&&r.y<=this.bodyBottom)draw(item,r);});cy+=Math.ceil(items.length/columns)*(height+gap);};
  this.scrolled(()=>{if(this.taskTab==='tasks'){
   const beginner=data.tasks.filter(task=>task.group==='beginner');if(beginner.length){s.text('新手任务',pad+2,cy+3,17,this.colors.ink,750);cy+=35;drawGrid(beginner,100,(task,r)=>{s.panel(r);s.icon('coin',{x:r.x+12,y:r.y+14,w:26,h:26});s.text(task.title,r.x+47,r.y+17,14,this.colors.ink,700,r.w-137);s.text('金币 +'+(task.coins??0),r.x+r.w-85,r.y+19,12,this.colors.ink,700,73);s.meter({x:r.x+14,y:r.y+54,w:r.w-91,h:8},task.progress/task.target);s.text(task.progress+' / '+task.target,r.x+r.w-69,r.y+50,11,this.colors.muted,700,57);s.text('达成自动领取 · 每档仅一次',r.x+14,r.y+76,10,this.colors.muted,500,r.w-28);});}
   s.panel({x:pad,y:cy,w,h:85});s.text('十格小礼',pad+15,cy+15,15,this.colors.ink,750);const slotsX=pad+103,slotsW=Math.min(320,w-168),slotW=slotsW/10,slotSize=Math.min(22,Math.max(8,slotW-3));for(let i=0;i<10;i++)s.icon('piece',{x:slotsX+i*slotW+(slotW-slotSize)/2,y:cy+24-slotSize/2,w:slotSize,h:slotSize},i<data.giftProgress?this.colors.rose:this.colors.line);s.text(data.giftProgress+'/10',slotsX+slotsW+8,cy+18,12,this.colors.ink,700);const smallReward=[this.energyEnabled?'体力 +'+(data.giftMinimum??1)+'～'+data.giftMaximum:'',(data.giftXp??0)>0?'经验 +'+data.giftXp:'',(data.giftCoins??0)>0?'金币 +'+data.giftCoins:''].filter(Boolean).join(' · ');s.text('每 10 次有效拼合存入小礼'+(smallReward?'：'+smallReward:''),pad+15,cy+55,11,this.colors.muted,500,w-30);s.hit({x:pad,y:cy,w,h:85},()=>this.setTaskTab('gifts'));cy+=101;
   const featured=data.tasks.filter(t=>t.group==='sharing'||t.group==='invitation');drawGrid(featured,180,drawTask);s.text('协作与好友任务',pad+2,cy+3,17,this.colors.ink,750);cy+=35;drawGrid(data.tasks.filter(t=>t.group==='cooperation'||t.group==='friend'),180,drawTask);
   s.button({x:pad,y:cy,w,h:39},'查看已存礼包 · '+giftCount+' 份',()=>this.setTaskTab('gifts'),{icon:'gift',fontSize:14});cy+=54;
  }else{s.text('存下的小确幸',pad+2,cy+3,19,this.colors.ink,750);s.text('礼包可积累，开启后收下本次奖励',pad+2,cy+33,12,this.colors.muted);cy+=68;if(gifts.length)drawGrid(gifts,168,drawGift);else{s.icon('xpChest',{x:s.w/2-48,y:cy+13,w:96,h:83});const message='继续拼图，收下下一份小礼';s.text(message,(s.w-s.measure(message,14))/2,cy+116,14,this.colors.muted);cy+=177;}const resumeW=Math.min(260,w);s.button({x:pad+(w-resumeW)/2,y:cy,w:resumeW,h:39},'继续拼图',()=>inWindow?this.showModal(null):this.back(),{tone:'berry',fontSize:14});cy+=54;}
  });this.extent=cy-(this.bodyTop-this.scroll)+12;
 }
 private drawSupplies(){
  if(!this.energyEnabled){this.drawWebSupplies();return;}
  const s=this.stage,p=this.client.profile,pad=12,w=s.w-pad*2,landscape=s.w>650&&s.w>s.h;let y=this.bodyTop-this.scroll+4;
  this.scrolled(()=>{const cw=landscape?(w-12)/2:w,ch=(s.w<360?171:180)+(this.platform.config.id==='taptap'&&this.energyAdAvailable?44:0),start=y;
   for(const [index,[kind,title,description,art,smallArt]]of ([['energy','补满体力包','需要时再开启','supplyEnergy','lightning'],['create','建房券','指定图片或私人房间','supplyTicket','ticket']] as const).entries()){
    const x=pad+(landscape?index*(cw+12):0),cy=start+(landscape?0:index*(ch+12)),r={x,y:cy,w:cw,h:ch},imageW=Math.floor((cw-27)*.54),imageR={x:x+7,y:cy+7,w:imageW,h:ch-14};s.panel(r);s.clip(imageR,()=>{const edge=Math.max(imageR.w,imageR.h);s.icon(art,{x:imageR.x+(imageR.w-edge)/2,y:imageR.y+(imageR.h-edge)/2,w:edge,h:edge});});
    const dx=x+imageW+18,dw=cw-imageW-25,small=cw<330,stock=p?.supply[kind]??0;
    s.icon(smallArt,{x:dx,y:cy+15,w:kind==='energy'?25:31,h:35});s.text(title,dx+(kind==='energy'?27:34),cy+20,small?16:19,this.colors.ink,700,dw-(kind==='energy'?26:33));s.text(description,dx+(kind==='energy'?27:8),cy+49,small?9:10,this.colors.ink,500,dw-(kind==='energy'?25:8));
    s.ctx.fillStyle=s.color('#f8e8d8');s.ctx.fillRect(dx,cy+70,dw,27);s.text('库存',dx+Math.max(7,(dw-85)/2),cy+77,12,this.colors.muted);s.text(stock+'/3',dx+Math.max(42,(dw-85)/2+38),cy+74,18,this.colors.ink,700);s.ctx.fillStyle=s.color('#e0bbaa');s.ctx.fillRect(dx,cy+109,dw,1);
    const energyAd=kind==='energy'&&this.platform.config.id==='taptap'&&this.energyAdAvailable,available=energyAd?this.energyAdAvailable:this.shareAvailable;s.button({x:dx,y:cy+ch-(energyAd?94:54),w:dw,h:energyAd?36:43},stock>=3?'库存已满':energyAd?'看广告领1个':this.shareAvailable?(kind==='create'?'分享领1张':'分享领1个'):'分享暂未开放',()=>void this.claimSupply(kind),{tone:'berry',fontSize:small?12:14,disabled:this.busy||stock>=3||!available});if(energyAd)s.button({x:dx,y:cy+ch-50,w:dw,h:36},stock>=3?'库存已满':'分享领1个',()=>void this.claimSupply('energy','share'),{fontSize:small?12:14,disabled:this.busy||stock>=3||!this.shareAvailable});
   }y=start+(landscape?ch:2*ch+12)+12;
   s.panel({x:pad,y,w,h:40},'linen');s.icon('store',{x:pad+10,y:y+5,w:31,h:28});s.text('已购图包可免费创建公开房间。',pad+49,y+14,11,this.colors.ink,700,w-92);s.icon('sprig',{x:s.w-pad-31,y:y+11,w:22,h:20});y+=52;
   const inventory={x:pad,y,w,h:100};s.panel(inventory);s.icon('bag',{x:pad+13,y:y+11,w:17,h:18},this.colors.ink);s.text('我的库存',pad+37,y+12,18,this.colors.ink,700);s.ctx.fillStyle=s.color('#dfbdad');s.ctx.fillRect(pad+9,y+38,w-18,1);
   const slotW=(w-24)*.31,bx=pad+18+slotW*2,bw=s.w-pad-bx-11;
   for(const[index,[kind,label,art]]of ([['energy','体力包','energy'],['create','建房券','ticket']] as const).entries()){const sx=pad+12+index*slotW;s.icon(art,{x:sx,y:y+48,w:31,h:38});s.text(label,sx+35,y+47,10,this.colors.ink,700);s.ctx.fillStyle=s.color('#f8e8d8');s.ctx.fillRect(sx+35,y+64,33,21);s.text(p?.supply[kind]??0,sx+44,y+65,17,this.colors.ink,700);if(index===0){s.ctx.fillStyle=s.color('#dfbdad');s.ctx.fillRect(sx+slotW-4,y+45,1,43);}}
   this.button(bx,y+48,bw,p&&p.energy>=p.energyCap?'体力已满':'使用体力包',()=>void this.useEnergy(),'berry',42,!p||p.supply.energy===0||p.energy>=p.energyCap);y+=115;
   const note='提前准备，拼图时随用随取';s.text(note,(s.w-s.measure(note,11))/2,y,11,this.colors.muted);y+=28;
   if(!this.shareAvailable)y=this.paragraph('分享功能暂未开放，已有库存可以正常使用。',pad+7,y,w-14,11)+12;
   s.text('回去拼图  →',(s.w-80)/2,y+4,12,this.colors.muted);s.hit({x:pad,y:y-4,w,h:36},()=>this.back());y+=46;
  });this.extent=y-(this.bodyTop-this.scroll)+12;
 }
 private drawWebSupplies(){
  const s=this.stage,p=this.client.profile,w=Math.min(650,s.w-24),x=(s.w-w)/2;let y=this.bodyTop-this.scroll;
  if(this.formalWeb){this.scrolled(()=>{s.icon('coin',{x:x+12,y:y+8,w:42,h:44});s.text('我的金币 '+(p?.collection?.coins??0),x+67,y+17,22,this.colors.ink,750,w-80);y+=76;y=this.paragraph('金币、相册和已拥有内容继续保留。建房条件以当前账号与会员权限为准。',x+8,y,w-16,14)+24;s.button({x:x+8,y,w:w-16,h:40},'账号与会员',()=>this.openWeb('membership'),{fontSize:14});y+=52;});this.extent=y-(this.bodyTop-this.scroll)+12;return;}
  this.scrolled(()=>{s.panel({x,y,w,h:225});s.icon('supplyTicket',{x:x+14,y:y+22,w:140,h:140});s.text('建房券',x+166,y+24,23,this.colors.ink,750,w-183);s.text('指定图片或创建私人房间',x+167,y+64,12,this.colors.muted,500,w-184);s.text('当前库存 '+(p?.supply.create??0)+' / 3',x+167,y+100,17,this.colors.ink,750,w-184);s.button({x:x+17,y:y+169,w:w-34,h:39},(p?.supply.create??0)>=3?'库存已满':this.shareAvailable?'分享领取1张':'当前浏览器尚未开放分享领取',()=>void this.claimSupply('create'),{tone:'berry',fontSize:13,disabled:this.busy||!this.shareAvailable||(p?.supply.create??0)>=3});y+=247;y=this.paragraph('随机公开房免费创建；已拥有的图包图片，也可免费创建公开房。已有建房券可以正常使用。',x+8,y,w-16,14)+23;s.button({x:x+8,y,w:w-16,h:41},'去挑选图片',()=>this.navigate('gallery'),{icon:'underlay',fontSize:14});y+=55;});this.extent=y-(this.bodyTop-this.scroll)+12;
 }
 private drawCollection(){
  const s=this.stage,data=this.collection,pad=12,w=s.w-pad*2;let y=this.bodyTop;
  if(this.collectionTab==='decorations'&&data&&!this.desktop){s.icon('avatar',{x:pad,y,w:46,h:47});s.text('Lv.'+data.profile.level,pad+51,y+1,15,this.colors.ink,700);s.meter({x:pad+51,y:y+23,w:58,h:7},data.profile.xp/Math.max(1,data.profile.xpToNext));s.text(data.profile.xp+'/'+data.profile.xpToNext,pad+51,y+35,9,this.colors.muted);y+=56;}
  const tabs=[['albums','图鉴','underlay'],['packs','图包','piece'],['decorations','装饰','leaf']] as const,tw=(w-10)/3;
  tabs.forEach(([id,label,icon],index)=>s.button({x:pad+index*(tw+5),y,w:tw,h:39},label,()=>this.changeListView(()=>{this.collectionTab=id;}),{tone:this.collectionTab===id?'berry':'linen',icon,fontSize:16}));
  this.bodyTop=y+54;if(!data){s.text('正在翻开收藏…',pad+8,this.bodyTop+32,15);this.extent=0;return;}
  if(this.collectionTab==='albums')this.drawAlbums(data);else if(this.collectionTab==='packs')this.drawPacks(data);else this.drawDecorations(data);
 }
 private drawAlbums(data:MobileCollectionView){
  const s=this.stage;
  if(this.desktop){
   const top=this.bodyTop,left=12,navW=176,h=this.bodyBottom-top,area={x:left,y:top,w:navW,h};this.albumListExtent=data.albums.length*65+43;this.albumListScroll=clamp(this.albumListScroll,0,Math.max(0,this.albumListExtent-h));this.albumListArea={x:this.sceneArea.x+left,y:this.sceneArea.y+top,w:navW,h};
   s.panel(area);s.clip(area,()=>{s.text('我的相册 · '+data.albums.length,left+13,top+13-this.albumListScroll,15,this.colors.ink,750);data.albums.forEach((album,index)=>{const y=top+43+index*65-this.albumListScroll,selected=album.id===this.albumId||(!this.albumId&&index===0),r={x:left+7,y,w:navW-14,h:57};s.button(r,'',()=>this.selectAlbum(album.id),{tone:selected?'berry':'cream'});s.text(album.title,left+17,y+10,13,selected?this.colors.onAccent:this.colors.ink,750,navW-37);s.text(album.collected+' / '+album.total+' 张',left+17,y+32,11,selected?this.colors.onAccent:this.colors.muted,500,navW-37);});});
   const content={x:left+navW+3,y:top,w:s.w-left-navW-3,h};this.listArea={x:this.sceneArea.x+content.x,y:this.sceneArea.y+top,w:content.w,h};
   s.withViewport(content,()=>{this.bodyTop=0;this.bodyBottom=h;this.drawAlbumContents(data);});this.bodyTop+=top;this.bodyBottom+=top;return;
  }
  s.button({x:12,y:this.bodyTop,w:s.w-24,h:34},'选择相册 · '+(data.albums.find(a=>a.id===this.albumId)?.title??data.albums[0]?.title??'暂无相册'),()=>this.showModal('albums'),{icon:'book',fontSize:12});this.bodyTop+=45;this.drawAlbumContents(data);
 }
 private drawAlbumContents(data:MobileCollectionView){
  const s=this.stage,pad=12,w=s.w-24,album=data.albums.find(a=>a.id===this.albumId)??data.albums[0];if(!album){s.text('参与完成作品，点亮第一张图鉴',20,this.bodyTop+35,14);this.extent=0;return;}if(this.albumId!==album.id){this.albumId=album.id;this.scroll=0;}let y=this.bodyTop-this.scroll;
  this.scrolled(()=>{const countW=Math.min(122,w*.34),countX=s.w-pad-countW;s.icon('book',{x:pad,y:y+3,w:35,h:32});s.text(album.title,pad+42,y+1,s.w<360?19:23,this.colors.ink,700,countX-pad-50);s.hit({x:pad,y:y-3,w:countX-pad-7,h:45},()=>this.showModal('albums'));s.icon('sprig',{x:countX-25,y:y+1,w:18,h:18});s.text(album.description,pad+42,y+35,10,this.colors.muted,countX-pad-40);s.icon('fragment',{x:countX,y:y+2,w:24,h:24});s.text(album.collected+'/'+album.total,countX+31,y+2,23,this.colors.ink,700);s.meter({x:countX,y:y+36,w:countW,h:9},album.collected/Math.max(1,album.total));y+=61;
   const columns=this.desktop?Math.max(3,Math.min(4,Math.floor(s.w/200))):s.w<600?3:Math.max(4,Math.floor(s.w/145)),gap=this.desktop?14:9,cw=(w-gap*(columns-1))/columns,artH=cw*1.16,ch=artH+55,base=y;
   album.images.forEach((image,index)=>{const x=pad+(index%columns)*(cw+gap),cy=base+Math.floor(index/columns)*(ch+gap),r={x,y:cy,w:cw,h:ch};if(cy+ch<this.bodyTop||cy>this.bodyBottom)return;s.panel(r);const picture={x:x+5,y:cy+5,w:cw-10,h:artH-5};s.image(this.client.asset(image.thumbSrc),picture,'cover');if(!image.collected){s.ctx.fillStyle=s.color('rgba(232,212,196,.77)');s.ctx.fillRect(picture.x,picture.y,picture.w,picture.h);s.ctx.fillStyle='#b9848d';s.ctx.fillRect(x+cw/2-12,cy+artH/2-12,24,27);s.icon('lock',{x:x+cw/2-9,y:cy+artH/2-10,w:18,h:22},'#fff9ef');}
    s.text(image.title,x+8,cy+artH+7,s.w<360?10:12,this.colors.ink,700,cw-16);s.ctx.fillStyle=s.color(image.collected?'#efd9d6':'#f7e3d5');s.ctx.fillRect(x+8,cy+ch-24,cw-16,17);const label=image.collected?'已收藏':'未收集';s.text(label,x+(cw-s.measure(label,9))/2,cy+ch-21,9,this.colors.muted,700);
   });y=base+Math.ceil(album.images.length/columns)*(ch+gap)+5;
   if(album.milestones.length){
    const rewardColumns=Math.min(album.milestones.length,Math.max(1,Math.min(4,Math.floor((w-24)/75)))),cellW=(w-28)/rewardColumns,trackH=35+Math.ceil(album.milestones.length/rewardColumns)*88,r={x:pad,y,w,h:trackH};
    s.panel(r);s.meter({x:pad+18,y:y+18,w:w-36,h:6},album.collected/Math.max(1,album.total));
    album.milestones.forEach((milestone,index)=>{
     const cx=pad+14+(index%rewardColumns)*cellW,cy=y+35+Math.floor(index/rewardColumns)*88,reward=data.decorations.find(item=>item.id===milestone.decorationId);
     s.icon(milestone.earned?'check':'lock',{x:cx+3,y:cy,w:14,h:18},this.colors.rose);s.text(milestone.target+'张',cx+21,cy+3,11,this.colors.ink,700,cellW-25);
     if(milestone.coins>0){s.icon('coin',{x:cx+3,y:cy+24,w:17,h:18});s.text(milestone.coins,cx+24,cy+28,10,this.colors.ink,700,cellW-28);}
     if(reward){s.decoration(reward,{x:cx+3,y:cy+45,w:16,h:18});s.text(reward.title,cx+24,cy+49,9,this.colors.ink,700,cellW-28);}
     s.text(milestone.earned?'已获得':'收集可得',cx+3,cy+71,8,this.colors.muted,400,cellW-6);
    });y+=trackH+10;
    const rewards=Array.from(new Set(album.milestones.map(milestone=>milestone.decorationId).filter((id):id is string=>!!id))).map(id=>data.decorations.find(item=>item.id===id)).filter((reward):reward is CollectionDecoration=>!!reward);
    for(const reward of rewards){
     const copyW=w-90,h=Math.max(94,65+Math.ceil(reward.description.length*9/Math.max(1,copyW))*13),earned=album.milestones.some(milestone=>milestone.decorationId===reward.id&&milestone.earned),preview={x:pad,y,w,h};
     s.panel(preview);s.ctx.fillStyle=this.colors.rose;s.ctx.fillRect(pad+12,y+12,59,19);s.text(earned?'已获得':'收集可得',pad+17,y+17,9,'#fff9ed',700);s.text(reward.title,pad+12,y+39,14,this.colors.ink,700,copyW);s.wrap(reward.description,pad+12,y+62,copyW,9,this.colors.muted,13);s.decoration(reward,{x:s.w-pad-67,y:y+18,w:49,h:62});y+=h+10;
    }
   }
   y=this.paragraph('有效参与并完成作品即可收集；图鉴奖励达成后自动存入。',pad+9,y,w-18,10)+12;
  });this.extent=y-(this.bodyTop-this.scroll);
 }
 private drawPacks(data:MobileCollectionView){
  const s=this.stage,pad=12,w=s.w-24;let y=this.bodyTop-this.scroll;
  const action=(pack:CollectionPack)=>{if(pack.owned)this.openPackGallery(pack.id);else{this.purchase=pack;this.showModal('purchase');}};
  this.scrolled(()=>{const first=s.w<640?data.packs[0]:undefined;if(first){const remaining=first.images.slice(3),mainH=Math.min(210,w*.45),thumbH=remaining.length?Math.min(100,Math.max(48,(w-28)/remaining.length*.6)):0,h=100+mainH+thumbH+89,r={x:pad,y,w,h};if(y+h>=this.bodyTop&&y<=this.bodyBottom){s.panel(r);s.text(first.title,pad+14,y+17,23,this.colors.ink,700,w*.48);s.icon('underlay',{x:pad+14,y:y+48,w:15,h:15},this.colors.ink);s.text(first.images.length+'张主题图片',pad+33,y+49,11,this.colors.ink,700);s.wrap(first.description,pad+w*.55,y+23,w*.4,10,this.colors.muted,15);s.icon('sprig',{x:pad+14,y:y+68,w:19,h:18});s.text('永久解锁 · 免费公开建房',pad+37,y+72,10,this.colors.ink,700);
    const ix=pad+14,iy=y+94,iw=w-28,leftW=iw*.62,preview=(index:number,r:Rect)=>{const image=first.images[index];if(!image)return;this.cardImage(image.thumbSrc,r);s.hit(r,()=>this.openPackPreview(first));};
    preview(0,{x:ix,y:iy,w:leftW,h:mainH});first.images.slice(1,3).forEach((_image,index)=>preview(index+1,{x:ix+leftW+6,y:iy+index*(mainH/2+3),w:iw-leftW-6,h:mainH/2-3}));
    const thumbGap=7,thumbW=(iw-thumbGap*(remaining.length-1))/Math.max(1,remaining.length);remaining.forEach((_image,index)=>preview(index+3,{x:ix+index*(thumbW+thumbGap),y:iy+mainH+9,w:thumbW,h:thumbH}));
    const previewLabel='点图查看全部 '+first.images.length+' 张  ›';s.text(previewLabel,s.w/2-s.measure(previewLabel,11,700)/2,y+h-77,11,this.colors.ink,700);s.hit({x:ix,y:y+h-83,w:iw,h:27},()=>this.openPackPreview(first));
    s.button({x:s.w/2-89,y:y+h-53,w:178,h:40},first.owned?'已拥有 · 去建房':first.price+' 解锁图包',()=>action(first),{tone:'berry',icon:first.owned?'check':'coin',fontSize:15,disabled:this.busy});}y+=h+13;}
   const others=first?data.packs.slice(1):data.packs,columns=2,gap=12,cw=(w-(columns-1)*gap)/columns,cardH=80+cw*.53+71,base=y;others.forEach((pack,index)=>{const x=pad+index%columns*(cw+gap),cy=base+Math.floor(index/columns)*(cardH+13),r={x,y:cy,w:cw,h:cardH};if(cy+cardH<this.bodyTop||cy>this.bodyBottom)return;s.panel(r);s.text(pack.title,x+12,cy+15,17,this.colors.ink,700,cw-24);s.icon('underlay',{x:x+12,y:cy+42,w:12,h:12},this.colors.ink);s.text(pack.images.length+'张主题图片',x+27,cy+42,10,this.colors.ink,700,cw-38);const art={x:x+12,y:cy+64,w:cw-24,h:cw*.53};if(pack.images[0]){this.cardImage(pack.images[0].thumbSrc,art);s.hit(art,()=>this.openPackPreview(pack));}
    const label='查看全部 '+pack.images.length+' 张  ›';s.text(label,x+(cw-s.measure(label,11,700))/2,cy+cardH-70,11,this.colors.ink,700,cw-20);s.hit({x:x+8,y:cy+cardH-76,w:cw-16,h:28},()=>this.openPackPreview(pack));
    const by=cy+cardH-46,buttonW=Math.max(69,cw*.52);s.icon('coin',{x:x+10,y:by+10,w:20,h:20});s.text(pack.owned?'✓':String(pack.price),x+33,by+13,12,this.colors.ink,700);s.button({x:x+cw-buttonW-10,y:by,w:buttonW,h:35},pack.owned?'去建房':'解锁图包',()=>action(pack),{tone:'berry',fontSize:11,disabled:this.busy});});y=base+Math.ceil(others.length/columns)*(cardH+13);if(!data.packs.length){s.text('新的画作正在路上',22,y+28,16);y+=100;}
  });this.extent=y-(this.bodyTop-this.scroll)+12;
 }
 private openPackPreview(pack:CollectionPack){if(!pack.images.length)return;this.previewPack=pack;this.previewIndex=-1;this.previewGridScroll=0;this.stage.retryImages();this.showModal('packPreview');}
 private returnToPackGrid(){this.previewIndex=-1;this.modalScroll=this.previewGridScroll;this.invalidate();}
 private stepPackPreview(delta:number){if(!this.previewPack)return;this.previewIndex=clamp(this.previewIndex+delta,0,this.previewPack.images.length-1);this.modalScroll=0;this.invalidate();}
 private drawPackPreview(){
  const pack=this.previewPack;if(!pack)return;
  const s=this.stage,v=this.platform.viewport(),w=Math.min(920,s.w-24),columns=w>=720?4:2,gap=w>=720?16:12,pad=20,cw=(w-pad*2-gap*(columns-1))/columns,rowH=cw+36,rows=Math.ceil(pack.images.length/columns),h=Math.min(s.h-v.top-v.bottom-28,84+Math.min(rows,3)*(rowH+gap)+94),x=(s.w-w)/2,y=v.top+(s.h-v.top-v.bottom-h)/2,footerY=y+h-80;
  s.ctx.fillStyle=this.colors.overlay;s.ctx.fillRect(0,0,s.w,s.h);s.hit({x:0,y:0,w:s.w,h:s.h},()=>{});s.panel({x,y,w,h});
  s.text(pack.title,x+20,y+18,21,this.colors.ink,800,w-80);s.button({x:x+w-45,y:y+12,w:30,h:30},'',()=>this.showModal(null));s.icon('close',{x:x+w-42,y:y+15,w:24,h:24},this.colors.ink);
  this.modalStart=y+80;this.modalArea={x:x+14,y:this.modalStart,w:w-28,h:Math.max(20,footerY-this.modalStart-14)};
  if(this.previewIndex<0){
   s.text(pack.images.length+' 张主题图片 · 点击缩略图查看大图',x+20,y+51,w<400?11:13,this.colors.muted,500,w-40);
   this.modalExtent=rows*(rowH+gap)-gap+8;this.modalScroll=clamp(this.modalScroll,0,Math.max(0,this.modalExtent-this.modalArea.h));
   s.clip(this.modalArea,()=>{pack.images.forEach((image,index)=>{
    const cx=x+pad+index%columns*(cw+gap),cy=this.modalStart+4+Math.floor(index/columns)*(rowH+gap)-this.modalScroll;if(cy+rowH<this.modalArea.y||cy>this.modalArea.y+this.modalArea.h)return;
    const art={x:cx,y:cy,w:cw,h:cw};s.frame(art,'panel-cream');s.image(this.client.asset(image.thumbSrc||image.src),{x:cx+5,y:cy+5,w:cw-10,h:cw-10},'contain');
    s.text(image.title,cx+3,cy+cw+12,w<400?12:14,this.colors.ink,700,cw-6);
    s.hit({x:cx,y:cy,w:cw,h:rowH},()=>{this.previewGridScroll=this.modalScroll;this.previewIndex=index;this.modalScroll=0;this.stage.retryImages();this.invalidate();});
   });});
   if(this.modalExtent>this.modalArea.h){const track=this.modalArea,thumbH=Math.max(24,track.h*track.h/this.modalExtent),thumbY=track.y+(track.h-thumbH)*this.modalScroll/(this.modalExtent-track.h);s.ctx.fillStyle=this.colors.rose;s.ctx.fillRect(x+w-9,thumbY,3,thumbH);}
  }else{
   s.button({x:x+20,y:y+45,w:138,h:28},'‹ 返回全部图片',()=>this.returnToPackGrid(),{fontSize:12});
   this.modalExtent=0;this.modalScroll=0;const image=pack.images[this.previewIndex],area=this.modalArea,art={x:x+20,y:area.y+2,w:w-40,h:Math.max(20,area.h-54)};
   s.frame(art,'panel-cream');s.image(this.client.asset(image.src||image.thumbSrc),{x:art.x+5,y:art.y+5,w:art.w-10,h:art.h-10},'contain');s.ornaments(art,16);
   const captionY=art.y+art.h+12;s.text(image.title,x+20,captionY,14,this.colors.ink,700,w-190);
   const counter=(this.previewIndex+1)+' / '+pack.images.length;s.text(counter,x+w-104-s.measure(counter,12,700)/2,captionY+3,12,this.colors.muted,700);
   s.button({x:x+w-167,y:captionY-4,w:31,h:28},'‹',()=>this.stepPackPreview(-1),{disabled:this.previewIndex===0,fontSize:19});s.button({x:x+w-72,y:captionY-4,w:31,h:28},'›',()=>this.stepPackPreview(1),{disabled:this.previewIndex===pack.images.length-1,fontSize:19});
  }
  s.ctx.fillStyle=this.colors.rose;s.ctx.fillRect(x+20,footerY, w-40,1);
  const buttonW=Math.min(245,w-40),buttonX=x+(w-buttonW)/2;
  s.button({x:buttonX,y:footerY+13,w:buttonW,h:36},pack.owned?'已拥有 · 去建房':pack.price+' 金币 · 解锁图包',()=>{if(pack.owned)this.openPackGallery(pack.id);else{this.purchase=pack;this.showModal('purchase');}},{tone:'berry',icon:pack.owned?'check':'coin',fontSize:14,disabled:this.busy});
  const hint=pack.owned?'随时选择喜欢的图片开拼':'永久解锁 · 免费公开建房';s.text(hint,x+(w-s.measure(hint,11))/2,footerY+58,11,this.colors.muted);
 }
 private drawDecorations(data:MobileCollectionView){
  const s=this.stage,pad=12,w=s.w-24,decorations=data.decorations.filter(item=>!this.decorationOwnedOnly||item.owned),selected=decorations.find(item=>item.id===this.decorationId)??decorations.find(item=>item.equipped)??decorations[0],rewardHints=selected&&!selected.owned?collectionDecorationRewardHints(selected,data.albums):[];let y=this.bodyTop-this.scroll;
  this.scrolled(()=>{s.button({x:pad,y,w:67,h:34},'全部',()=>this.changeListView(()=>{this.decorationOwnedOnly=false;}),{tone:this.decorationOwnedOnly?'linen':'berry',fontSize:13});s.button({x:pad+71,y,w:78,h:34},'已拥有',()=>this.changeListView(()=>{this.decorationOwnedOnly=true;}),{tone:this.decorationOwnedOnly?'berry':'linen',fontSize:13});s.ctx.fillStyle=this.colors.line;s.ctx.fillRect(pad+164,y+17,Math.max(0,w-195),1);s.icon('sprig',{x:s.w-pad-20,y:y+7,w:19,h:18});y+=47;if(selected){const gap=12,leftW=(w-gap)*.58,rightW=w-gap-leftW,hintHeight=rewardHints.reduce((height,hint)=>height+Math.max(1,Math.ceil(hint.length*10/Math.max(1,rightW-24)))*14+8,0),h=Math.max(248,Math.min(290,leftW*1.15),hintHeight?132+selected.description.split('\n').reduce((height,line)=>height+Math.max(1,Math.ceil(line.length*10/Math.max(1,rightW-24)))*15,0)+8+hintHeight+88:0),rx=pad+leftW+gap,r={x:rx,y,w:rightW,h},preview=data.albums.flatMap(a=>a.images).find(i=>i.collected)??data.packs[0]?.images[0]??data.albums[0]?.images[0];
    if(y+h>=this.bodyTop&&y<=this.bodyBottom){const pr={x:pad,y,w:leftW,h};s.panel(pr);if(preview)s.image(this.client.asset(preview.src||preview.thumbSrc),{x:pad+5,y:y+5,w:leftW-10,h:h-10},'cover');s.ctx.save();s.ctx.strokeStyle='#fff4dd88';s.ctx.lineWidth=.65;for(let i=1;i<5;i++){s.ctx.beginPath();s.ctx.moveTo(pad+5+i*(leftW-10)/5,y+5);s.ctx.lineTo(pad+5+i*(leftW-10)/5,y+h-5);s.ctx.stroke();s.ctx.beginPath();s.ctx.moveTo(pad+5,y+5+i*(h-10)/5);s.ctx.lineTo(pad+leftW-5,y+5+i*(h-10)/5);s.ctx.stroke();}s.ctx.restore();s.panel({x:pad+8,y:y+10,w:53,h:25});s.text('◎ 预览',pad+14,y+17,10,this.colors.ink,700);s.decoration(selected,{x:pad+leftW*.4,y:y+h*.58,w:41,h:44});s.panel({x:pad+leftW*.54,y:y+h*.73,w:leftW*.41,h:38});s.icon('avatar',{x:pad+leftW*.55,y:y+h*.74,w:25,h:28});s.text(data.profile.name,pad+leftW*.55+28,y+h*.75,8,this.colors.ink,700,Math.max(26,leftW*.41-30));s.text('Lv.'+data.profile.level,pad+leftW*.55+28,y+h*.75+13,7,this.colors.ink,700);
    s.panel(r);s.text(selected.title,rx+12,y+17,16,this.colors.ink,700,rightW-24);s.decoration(selected,{x:rx+rightW/2-39,y:y+48,w:78,h:78});s.icon('create',{x:rx+12,y:y+59,w:9,h:9},this.colors.gold);s.icon('create',{x:rx+rightW-20,y:y+102,w:8,h:8},this.colors.gold);let hintY=y+132+s.wrap(selected.description,rx+12,y+132,rightW-24,10,this.colors.ink,15)+8;for(const hint of rewardHints)hintY+=s.wrap(hint,rx+12,hintY,rightW-24,10,this.colors.muted,14)+8;
    const label=selected.equipped?'✓ 已装备':selected.owned?'装备':selected.source==='album'?'图鉴奖励':data.wallet.fragments<selected.cost?'碎片不足':'合成装饰';if(!selected.owned&&selected.source==='craft'){s.text(data.wallet.fragments+'/'+selected.cost+' 碎片',rx+12,y+h-75,10,this.colors.muted);s.meter({x:rx+12,y:y+h-59,w:rightW-24,h:7},data.wallet.fragments/Math.max(1,selected.cost));}this.button(rx+10,y+h-45,rightW-20,label,()=>void this.collectionAction(selected.owned?'equip':'craft',selected.id),'berry',34,selected.equipped||(!selected.owned&&(selected.source!=='craft'||selected.enabled===false||data.wallet.fragments<selected.cost)));}y+=h+15;}
   const columns=s.w<640?2:3,gap=12,cw=(w-(columns-1)*gap)/columns,h=s.w<360?146:134,base=y;
   decorations.forEach((item,index)=>{const x=pad+index%columns*(cw+gap),cy=base+Math.floor(index/columns)*(h+13),r={x,y:cy,w:cw,h};if(cy+h<this.bodyTop||cy>this.bodyBottom)return;s.panel(r);if(selected?.id===item.id){s.ctx.fillStyle=s.color('#e8c496');s.ctx.fillRect(x+5,cy+h-5,cw-10,2);}s.decoration(item,{x:x+11,y:cy+11,w:18,h:20});s.text(item.title,x+33,cy+16,13,this.colors.ink,700,cw-40);s.decoration(item,{x:x+13,y:cy+46,w:51,h:57});const dx=x+70,dw=cw-80,label=item.equipped?'已装备':item.owned?'可装备':item.source==='album'?'图鉴奖励':'未合成';s.ctx.fillStyle=item.equipped?this.colors.rose:'#f2ddb9';s.ctx.fillRect(dx,cy+45,Math.min(47,dw),18);s.text(label,dx+4,cy+49,8,item.equipped?'#fff9ed':'#a36c2e',700,dw-4);s.wrap(item.description,dx,cy+71,dw,9,this.colors.ink,13);if(!item.owned&&item.source==='craft'){s.icon('fragment',{x:dx,y:cy+h-22,w:13,h:13});s.text(item.cost,dx+16,cy+h-20,9,this.colors.ink,700);}s.hit(r,()=>{this.decorationId=item.id;this.scroll=0;this.invalidate();});});y=base+Math.ceil(decorations.length/columns)*(h+13)+7;y=this.paragraph('装饰会在拖动拼块时展示，让一起拼图的人认出你。',pad+7,y,w-14,10)+12;
  });this.extent=y-(this.bodyTop-this.scroll);
 }
 private drawPolicy(){const s=this.stage;let y=this.bodyTop-this.scroll;const sections=this.route==='privacy'||this.route==='terms'?[...mobilePrivacySections,...mobileTermsSections]:[
  ['一起拼图','拖动拼块，靠近正确位置松开即可拼合。双指缩放和平移，电脑可滚轮缩放、空格或中键平移；“适配”可找回完整桌面。边缘筛选和整理可帮助寻找拼块。'],
  [this.energyEnabled?'体力与经验':'拼合与经验',this.energyEnabled?contributionCopy(this.client.profile)+' '+recoveryCopy(this.client.profile):'浏览器拼图不消耗体力。有效拼合可获得经验，金币和装饰按统一奖励规则结算。'],
  ['房间与收藏','随机公开房免费创建。指定图片或私人房使用建房券；已购图包可免费创建公开房。同时最多保留3个未结束的自建房间。'],
  ['邀请与礼包',this.energyEnabled?'好友首次接受邀请并完成3次有效拼合，邀请者可获得补满体力包，每日最多3位。与好友实际协作，还可积累每日任务礼包。':'与好友实际参与拼图，可以积累任务礼包；金币与经验奖励以任务页面展示为准。'],
 ];this.scrolled(()=>{for(const[title,text]of sections){s.text(title,20,y,18,this.colors.ink,700);y=this.paragraph(text,20,y+31,s.w-40,14)+24;}if(!this.formalWeb){this.button(20,y,s.w-40,'个人资料访问与删除申请',()=>this.showModal('privacyRequests'));y+=48;}this.button(20,y,s.w-40,'服务与隐私说明',()=>this.navigate('privacy'));y+=52;});this.extent=y-(this.bodyTop-this.scroll);}

 private drawRoom(){
  if(this.nineGridRoom){this.drawNineGrid();return;}
  const s=this.stage,room=this.room,board=this.board,view=this.platform.viewport(),top=view.top+5,p=this.client.profile;
  if(!room||!board){s.text('尚未加入房间',20,top+30,18);this.button(20,top+76,s.w-40,'返回大厅',()=>this.navigate('lobby'));return;}
  const visible=!this.hidden&&!this.modalBlocksInput;if(visible!==this.cursorVisible){this.cursorVisible=visible;if(visible)this.cursor?.refresh();else this.clearRoomPointer();}
  const photo=activeRoomPhoto(room.snapshot,photoMap.get(room.state.imageId)),total=room.state.cols*room.state.rows,placed=placedCount(room.state),landscape=s.w>s.h&&s.w>=540,c=s.ctx;
  const mainH=landscape?57:50,headerBottom=top+mainH+(landscape?0:42),statusW=landscape?Math.min(208,Math.round(s.w*.28)):Math.min(204,Math.round(s.w*.55));
  const inviteW=landscape?66:74,inviteX=s.w-8-inviteW,statusX=landscape?inviteX-statusW-9:s.w-8-statusW,titleW=landscape?Math.max(100,Math.min(178,s.w*.2)):Math.max(86,statusX-15);
  const title=room.snapshot.title||photo?.title||'一起拼图',brand=this.platform.config.id==='wechat',titleTextX=47,titleTextW=titleW-titleTextX+8;
  s.button({x:8,y:top+7,w:32,h:36},'',()=>this.exitRoom());s.icon('back',{x:14,y:top+14,w:20,h:22});
  if(titleTextW>155){s.icon('piece',{x:47,y:top+13,w:23,h:27});s.text(title,75,top+(brand?8:17),landscape?19:18,this.colors.ink,800,titleTextW-28);}
  else s.text(title,titleTextX,top+(brand?8:17),landscape?17:16,this.colors.ink,800,titleTextW);
  if(brand)s.text(this.platform.config.gameName,titleTextX+(titleTextW>155?28:0),top+31,9,this.colors.muted,500,titleTextW);
  else if(this.formalWeb)s.text('测试版',titleTextX,top+38,9,this.colors.muted,500,titleTextW);
  const avatarW=statusW<190?37:43,levelX=statusX+avatarW+4,levelW=statusW<190?43:49,energyX=levelX+levelW+7;
  s.icon('avatar',{x:statusX,y:top+4,w:avatarW,h:45});s.text('Lv.'+(p?.level??'—'),levelX,top+4,14,this.levelColor(p?.level??0),800,levelW);
  s.meter({x:levelX,y:top+23,w:levelW,h:8},p?p.xp/Math.max(1,p.xpToNext):0,this.colors.rose);s.text(p?p.xp+' / '+p.xpToNext:'— / —',levelX,top+35,9,this.colors.ink,500,levelW+2);
  s.hit({x:statusX,y:top,w:avatarW+levelW+4,h:mainH},()=>this.showModal('settings'));
  if(this.energyEnabled){
  c.fillStyle=this.colors.line;c.fillRect(energyX-4,top+11,1,30);s.icon('lightning',{x:energyX,y:top+12,w:19,h:28});
  const plusSize=24,plusX=statusX+statusW-plusSize,plusY=top+14,energyWidth=Math.max(28,plusX-energyX-22);s.text(p?p.energy+'/'+p.energyCap:'—/—',energyX+21,top+18,statusW<190?13:15,this.colors.ink,800,energyWidth);
  s.button({x:plusX,y:plusY,w:plusSize,h:plusSize},'',()=>this.navigate('supplies'),{tone:'gold'});s.icon('plus',{x:plusX+4,y:plusY+4,w:16,h:16},this.colors.onAccent);s.hit({x:energyX-3,y:top+4,w:statusX+statusW-energyX+3,h:43},()=>this.navigate('supplies'));
  }else{s.icon('coin',{x:energyX,y:top+16,w:21,h:23});s.text(p?.collection?.coins??0,energyX+26,top+20,14,this.colors.ink,700,statusX+statusW-energyX-27);s.hit({x:energyX-3,y:top+7,w:statusX+statusW-energyX+3,h:43},()=>this.showModal('coins'));}
  const members=room.snapshot.members.length,progressY=landscape?top+8:top+mainH+5,onlineX=inviteX-65,progressX=landscape?titleW+17:8,progressW=landscape?statusX-progressX-9:onlineX-progressX-8;
  if(!landscape){c.fillStyle=this.colors.line;c.fillRect(8,top+mainH,s.w-16,1);}
  const count=placed+'/'+total,countSize=landscape?15:17,countW=Math.min(80,s.measure(count,countSize,800));
  if(landscape){const countX=progressX+Math.max(0,(progressW-countW-26)/2);s.icon('piece',{x:countX,y:progressY-3,w:22,h:22});s.text(count,countX+26,progressY,15,this.colors.ink,800,Math.max(1,progressW-26));s.meter({x:progressX,y:progressY+23,w:Math.max(20,progressW),h:10},placed/Math.max(1,total),this.colors.rose);}
  else{s.icon('piece',{x:progressX,y:progressY+4,w:22,h:26});s.text(count,progressX+27,progressY+8,countSize,this.colors.ink,800,countW);s.meter({x:progressX+33+countW,y:progressY+12,w:Math.max(20,progressW-countW-34),h:11},placed/Math.max(1,total),this.colors.rose);}
  this.chatEntryArea=landscape?{x:s.w-102,y:headerBottom+17,w:86,h:42}:{x:onlineX-2,y:progressY,w:57,h:35};
  const unread=this.messages.filter(message=>message.id>this.chatSeen&&message.code!==this.client.profile?.code&&!this.social.blockedCodes.includes(message.code)).length;
  if(!landscape){c.fillStyle=this.colors.line;c.fillRect(onlineX-4,progressY+5,1,26);this.drawRoomChatEntry(members,unread,false);}
  s.button({x:inviteX,y:landscape?top+13:progressY,w:inviteW,h:35},'邀请',()=>this.showModal('invite'),{tone:'berry',icon:'invite',fontSize:14});
  c.fillStyle=this.colors.line;c.fillRect(0,headerBottom,s.w,1);
  const safeBottom=s.h-view.bottom;this.roomArea={x:0,y:headerBottom+1,w:s.w,h:Math.max(90,safeBottom-headerBottom-1)};this.bodyTop=this.roomArea.y;this.bodyBottom=safeBottom;
  board.selfDecoration=p?.collection?.equipped??null;board.previewTopInset=landscape?68:6;board.setRect(this.roomArea);if(this.roomViewPending){board.openMobileView({bottom:72});this.roomViewPending=false;}board.draw(c);
  if(landscape)this.drawRoomChatEntry(members,unread,true);
  if(!this.imageReady){const preparation=board.imagePreparation??{phase:'loading',completed:0,total:0},label=preparation.phase==='preparing'?'正在准备碎片 '+preparation.completed+'/'+preparation.total+'…':preparation.phase==='loading'?'正在加载图片…':'正在铺开拼图…';s.panel({x:18,y:this.roomArea.y+20,w:s.w-36,h:74});this.paragraph(this.imageError||label,30,this.roomArea.y+37,s.w-60,14);if(this.imageError)this.button(25,this.roomArea.y+104,s.w-50,'重新加载图片',()=>void this.run(()=>this.retryRoomImage(board)));}
  if(this.platform.config.previewTestRoom){
   const d=this.realtime?.diagnostics(),active=d?.previewConnected===true,available=d?.preview==='taptap-test',label=active?'平台同步已接通':'原通道 · '+String(d?.previewDetail||'当前房间未启用平台预览'),w=Math.min(s.w-24,420);
   s.panel({x:12,y:headerBottom+5,w,h:43});s.text('联机自测 D4：'+label,20,headerBottom+11,10,this.colors.ink,600,w-16);
   s.text(available?'目标 '+(d.previewTargetHz??'—')+'/秒 · 实发 '+(d.platformSendRate??0)+' · 成功 '+(d.platformSucceeded??0)+' · 失败 '+(d.platformFailed??0)+' · 收 '+(d.platformReceived??0):'平台统计未启用 · 点击查看原因',20,headerBottom+29,9,this.colors.muted,600,w-16);
   s.hit({x:12,y:headerBottom+5,w,h:43},()=>this.showModal('settings'));
  }
  if(!room.connected){s.panel({x:12,y:safeBottom-114,w:s.w-24,h:37});s.text(room.message,23,safeBottom-103,12,'#a54860',400,s.w-46);}
  const giftY=safeBottom-62,giftLabel='任务 '+(p?.giftProgress??0)+'/10';s.icon('gift',{x:13,y:giftY+4,w:44,h:46});s.text(giftLabel,59,giftY+20,15,this.colors.ink,700);s.hit({x:10,y:giftY,w:144,h:52},()=>this.navigate('tasks'));
  const giftCount=p?.giftCount??0;if(giftCount>0){const label=giftCount>99?'99+':String(giftCount),badgeW=Math.max(20,s.measure(label,10,700)+8);s.panel({x:43,y:giftY-2,w:badgeW,h:19},'berry');s.text(label,47,giftY+2,10,'#fffaf0',700);}
  this.drawRoomTools({x:s.w-63,y:safeBottom-65,w:50,h:50},landscape);
 }
 private drawNineGrid(){
  const s=this.stage,room=this.room!,board=this.board!,view=this.platform.viewport(),top=view.top+5,wide=s.w>=600&&s.w>s.h,panelW=wide?242:s.w-24,x=12;
  const time=(key:string)=>{const value=this.nineTimings.get(key);if(!value)return '—';return value.status===0?'连接失败':value.status>=400?'失败 '+value.status:value.ms>=1000?(value.ms/1000).toFixed(2)+'秒':Math.round(value.ms)+'ms';};
  s.button({x:8,y:top+3,w:34,h:34},'‹',()=>this.exitRoom(),{fontSize:24});
  s.text('九格拼合测试 · '+placedCount(room.state)+'/9',49,top+12,17,this.colors.ink,750,s.w-60);
  const mode=this.platform.networkDiagnostics?.().http,channel=mode==='browser'?'浏览器直连':mode==='native'?'TapTap宿主':'正在选择';
    s.text((this.room?.diagnosticActionsActive?'长连接操作':channel)+' · '+(this.realtime?.connected?'实时推送':'轮询同步'),x,top+51,12,this.colors.muted,600,panelW);
  s.text('拿起 '+time('claim')+'  ·  移动 '+time('move'),x,top+76,12,this.colors.ink,600,panelW);
  s.text('排队 '+time('drop-queue')+'  ·  拼合 '+time('drop'),x,top+100,12,this.colors.ink,600,panelW);
  const serverMs=this.nineTimings.get('drop')?.serverMs,server=serverMs===undefined?'—':Math.round(serverMs)+'ms';
  s.text('服务器 '+server+'  ·  松手总计 '+time('drop-total'),x,top+124,12,this.colors.ink,700,panelW);
  const gap=8,bw=(panelW-gap)/2;
  s.button({x,y:top+150,w:bw,h:37},'自动拼一片',()=>void this.testNineGridPiece(),{tone:'berry',fontSize:12,disabled:this.busy||!this.imageReady});
  s.button({x:x+bw+gap,y:top+150,w:bw,h:37},'重新摆放',()=>void this.startNineGrid(),{fontSize:12,disabled:this.busy});
  if(wide)this.paragraph('仅你的账号可用\n不扣体力，不发奖励\n碎片按1—9排列，也可手动拖动。\n测试后截图上方耗时。',x,top+202,panelW,12);
  else s.text('不扣体力、不发奖励 · 可手动拖动或自动测试',x,top+198,11,this.colors.muted,500,panelW);
  this.roomArea=wide?{x:panelW+24,y:top+45,w:s.w-panelW-24,h:Math.max(90,s.h-view.bottom-top-45)}:{x:0,y:top+220,w:s.w,h:Math.max(90,s.h-view.bottom-top-220)};
  this.bodyTop=this.roomArea.y;this.bodyBottom=this.roomArea.y+this.roomArea.h;board.previewTopInset=0;board.setRect(this.roomArea);
  if(this.roomViewPending){board.openMobileView({bottom:8});this.roomViewPending=false;}board.draw(s.ctx);
  s.ctx.save();s.ctx.beginPath();s.ctx.rect(this.roomArea.x,this.roomArea.y,this.roomArea.w,this.roomArea.h);s.ctx.clip();
  const unit=board.board.width/3;
  for(const group of room.state.groups){if(group.locked)continue;const id=group.pieces[0],p=board.worldToScreen({x:board.board.x+(id%3+.5)*unit+group.dx,y:board.board.y+(Math.floor(id/3)+.5)*unit+group.dy});s.panel({x:p.x-11,y:p.y-11,w:22,h:22});s.text(String(id+1),p.x-4,p.y-7,12,this.colors.ink,750);}
  s.ctx.restore();
  if(!this.imageReady||!room.connected){s.panel({x:this.roomArea.x+8,y:this.roomArea.y+8,w:this.roomArea.w-16,h:45});s.text(this.imageError||(!room.connected?room.message:'正在准备九格图片…'),this.roomArea.x+17,this.roomArea.y+24,12,this.colors.ink,500,this.roomArea.w-34);}
 }
 private drawRoomChatEntry(members:number,unread:number,floating:boolean){
  const s=this.stage,r=this.chatEntryArea,label=members+'/8',start=floating?r.x+(r.w-25-s.measure(label,14,700))/2:r.x+3;
  if(floating)s.button(r,'',()=>this.showModal('chat'));else s.hit(r,()=>this.showModal('chat'));
  s.icon('person',{x:start,y:r.y+(r.h-25)/2,w:20,h:25});s.text(label,start+25,r.y+(r.h-14)/2,14,this.colors.ink,700);
  if(unread){const x=r.x+r.w-16,y=r.y-4;s.frame({x,y,w:17,h:17},'segment-berry-selected');s.text(Math.min(99,unread),x+4,y+2,9,this.colors.onAccent,700);}
 }
 private assistanceUnavailable(kind:'hint'|'underlay'){return !this.activeAid(kind)&&!!this.aid&&!this.aid.newcomerProtected&&(this.aid.freeRemaining?.[kind]??0)<=0&&!this.shareAvailable;}
 private drawRoomTools(toggle:Rect,landscape:boolean){
  const s=this.stage,board=this.board;if(!board)return;const c=s.ctx;
  // The original B2 toggle is an integer-stepped circle, not a rounded rectangle.
  c.save();c.translate(toggle.x,toggle.y);c.scale(toggle.w/54,toggle.h/54);
  const circle=(points:number[],fill:string)=>{c.beginPath();for(let i=0;i<points.length;i+=2){if(i)c.lineTo(points[i],points[i+1]);else c.moveTo(points[i],points[i+1]);}c.closePath();c.fillStyle=s.color(fill);c.fill();};
  circle([18,1,36,1,36,3,42,3,42,6,48,6,48,12,51,12,51,18,53,18,53,36,51,36,51,42,48,42,48,48,42,48,42,51,36,51,36,53,18,53,18,51,12,51,12,48,6,48,6,42,3,42,3,36,1,36,1,18,3,18,3,12,6,12,6,6,12,6,12,3,18,3],'#925363');
  circle([18,3,36,3,36,5,42,5,42,8,46,8,46,12,49,12,49,18,51,18,51,36,49,36,49,42,46,42,46,46,42,46,42,49,36,49,36,51,18,51,18,49,12,49,12,46,8,46,8,42,5,42,5,36,3,36,3,18,5,18,5,12,8,12,8,8,12,8,12,5,18,5],'#e3bda4');
  circle([19,5,35,5,35,7,41,7,41,10,44,10,44,13,47,13,47,19,49,19,49,35,47,35,47,41,44,41,44,44,41,44,41,47,35,47,35,49,19,49,19,47,13,47,13,44,10,44,10,41,7,41,7,35,5,35,5,19,7,19,7,13,10,13,10,10,13,10,13,7,19,7],this.toolsOpen?'#f4e7db':'#fff8ef');c.restore();
  s.icon(this.toolsOpen?'close':'tools',{x:toggle.x+12,y:toggle.y+12,w:26,h:26});s.hit(toggle,()=>{this.clearRoomPointer();this.toolsOpen=!this.toolsOpen;this.invalidate();});
  if(!this.toolsOpen)return;
  const width=Math.min(366,s.w-26),sideways=landscape&&toggle.x-width-12>150,box={x:sideways?toggle.x-width-12:s.w-13-width,y:sideways?Math.max(this.roomArea.y+7,toggle.y-40):Math.max(this.roomArea.y+7,toggle.y-104),w:width,h:91};s.panel(box);s.hit(box,()=>{});
  const buttons:[string,string,()=>void][]=[['edge','边缘',()=>{board.edgeOnly=!board.edgeOnly;this.invalidate();}],['hint','提示',()=>void this.activateAssistance('hint')],['underlay','底图',()=>void this.activateAssistance('underlay')],['fit','适配',()=>{board.fit(false,{bottom:board.trayOpen?220:72});this.toolsOpen=false;this.invalidate();}],['tools','更多',()=>this.showModal('tools')]];
  const cellW=(box.w-14)/5;
  buttons.forEach(([icon,label,fn],index)=>{const x=box.x+7+index*cellW,y=box.y+11,cx=x+cellW/2,active=icon==='edge'?board.edgeOnly:icon==='hint'||icon==='underlay'?!!this.activeAid(icon):false;
   s.button({x:cx-19,y:y+10,w:38,h:38},'',fn,{tone:active?'berry':'cream',disabled:(icon==='hint'||icon==='underlay')&&this.assistanceUnavailable(icon)});s.icon(icon,{x:cx-13,y:y+16,w:26,h:26});s.text(label,cx-s.measure(label,12,600)/2,y+54,12,this.colors.ink,600);if(!((icon==='hint'||icon==='underlay')&&this.assistanceUnavailable(icon)))s.hit({x,y:box.y+5,w:cellW,h:79},fn);
   if(icon==='hint'||icon==='underlay'){const activeAid=this.activeAid(icon),free=this.aid?.freeRemaining?.[icon]??0,pending=!this.aid||this.busy,badge=activeAid?Math.ceil((activeAid.expiresAt-Date.now())/1000)+'秒':pending?'读取中':this.aid?.newcomerProtected?'新手免费':free>0?'免费'+free+'次':this.shareAvailable?'分享':'暂未开放',ad=!activeAid&&!pending&&!this.aid?.newcomerProtected&&free===0,bw=Math.min(cellW-2,s.measure(badge,9,500)+7),bx=cx+19-bw;
    c.fillStyle=s.color(ad?'#ba667e':activeAid?'#fae7b8':pending?'#eee7db':'#f2efd8');c.fillRect(bx,box.y+4,bw,16);c.strokeStyle=s.color(ad?'#8c4059':activeAid?'#ccaa68':'#c8b781');c.lineWidth=1;c.strokeRect(bx+.5,box.y+4.5,bw-1,15);s.text(badge,bx+3,box.y+7,9,ad?'#fffaf0':activeAid?'#83542f':'#7a7244',500,bw-5);
   }
  });
 }


 private drawPublicChat(){
  const messages=this.messages.filter(message=>!this.social.blockedCodes.includes(message.code));
  const s=this.stage,view=this.platform.viewport(),landscape=s.w>s.h&&s.w>=540,w=landscape?Math.min(370,s.w*.44):s.w-24,chatTop=this.roomArea.y+12,
   h=landscape?Math.min(520,s.h-view.bottom-chatTop-12):Math.min(420,Math.max(330,s.h*.49),s.h-view.top-view.bottom-20),
   x=landscape?s.w-w-12:12,y=landscape?chatTop:s.h-view.bottom-h-10;
  this.chatWindowArea={x,y,w,h};s.panel(this.chatWindowArea);s.hit(this.chatWindowArea,()=>{});
  s.text('同桌交流',x+15,y+17,18,this.colors.ink,800,w-180);
  s.segments({x:x+w-165,y:y+12,w:116,h:32},[['room','房间'],['friends','好友']],'room',value=>{if(value==='friends')this.showModal('social');});
  s.button({x:x+w-42,y:y+12,w:29,h:31},'',()=>this.showModal(null),{icon:'close'});
  const groups=[{label:'协作',ids:[1,5,6,2,8,3,7]},{label:'鼓励',ids:[0,4,9,10,11]},{label:'表情',ids:[12,13,14,15]}],selected=groups[this.phraseGroup],columns=w>=310?3:2,
   rows=Math.ceil(selected.ids.length/columns),footerHeight=48+rows*34+(this.formalWeb?38:0),footerY=y+h-footerHeight-10,
   list={x:x+10,y:y+53,w:w-20,h:Math.max(40,footerY-y-60)};
  let messageY=0;const entries=messages.map(message=>{const lines:string[]=[];if(this.formalWeb){let line='';for(const char of message.text){if(char==='\n'||s.measure(line+char,14,650)>list.w-82){lines.push(line);line=char==='\n'?'':char;}else line+=char;}lines.push(line);}else lines.push(message.text);const h=this.formalWeb?Math.max(56,31+lines.length*21):56,entry={message,lines,y:messageY,h};messageY+=h;return entry;});
  this.modalArea=list;this.modalExtent=messageY;this.modalScroll=clamp(this.modalScroll,0,Math.max(0,this.modalExtent-list.h));this.chatHits=[];
  s.clip(list,()=>{
   if(!messages.length){s.text('还没有消息',list.x+9,list.y+16,13,this.colors.muted);s.text('点下方短句和同桌打个招呼',list.x+9,list.y+42,12,this.colors.muted,500,list.w-20);}
   for(const entry of entries){
    const {message,lines}=entry,cy=list.y+entry.y-this.modalScroll;
    if(cy+entry.h<list.y||cy>list.y+list.h)continue;
    const r={x:list.x,y:cy,w:list.w,h:entry.h-4},avatar={x:r.x+3,y:r.y+4,w:29,h:32};s.icon('avatar',avatar);
    const name=message.name+' · Lv.'+(message.level??0);s.text(name,r.x+40,r.y+2,11,this.colors.muted,700,r.w-75);
    lines.forEach((line,index)=>s.text(line,r.x+40,r.y+23+index*21,14,this.colors.ink,650,r.w-82));
    if(message.sentAt){const date=new Date(message.sentAt);s.text(String(date.getHours()).padStart(2,'0')+':'+String(date.getMinutes()).padStart(2,'0'),r.x+r.w-42,r.y+2,9,this.colors.muted);}
    const own=message.code===this.client.profile?.code;
    if(!own&&message.code){s.text('···',r.x+r.w-24,r.y+23,18,this.colors.muted,800);s.hit({x:r.x+r.w-37,y:r.y+13,w:36,h:36},()=>this.openPublicMessage(message));const visible={x:r.x,y:Math.max(list.y,r.y),w:r.w-39,h:Math.max(0,Math.min(list.y+list.h,r.y+r.h)-Math.max(list.y,r.y))};this.chatHits.push({r:visible,message});}
   }
  });
  s.ctx.fillStyle=this.colors.line;s.ctx.fillRect(x+12,footerY,w-24,1);if(w>=310)s.text(this.formalWeb?'快捷短句':'只发送预设短句',x+14,footerY+7,10,this.colors.muted);
  s.segments({x:x+w-191,y:footerY+3,w:178,h:28},groups.map((g,i)=>[i as 0|1|2,g.label] as const),this.phraseGroup,value=>{this.phraseGroup=value;this.invalidate();});
  const bw=(w-26-(columns-1)*6)/columns;
  selected.ids.forEach((id,i)=>s.button({x:x+13+(i%columns)*(bw+6),y:footerY+39+Math.floor(i/columns)*34,w:bw,h:29},phrases[id],()=>void this.say(id),{fontSize:11,tone:'cream',disabled:this.busy}));
  if(this.formalWeb)s.button({x:x+13,y:footerY+39+rows*34,w:w-26,h:30},'输入消息',()=>void this.sayText(),{fontSize:12,disabled:this.busy});
 }

 private drawTaskWindow(){
  const s=this.stage,v=this.platform.viewport(),w=Math.min(380,s.w-24),bottom=s.h-v.bottom-12,minY=this.route==='room'?this.roomArea.y+8:v.top+12,h=Math.min(560,Math.max(120,bottom-minY)),x=12,y=bottom-h;
  this.taskWindowArea={x,y,w,h};s.panel(this.taskWindowArea);s.hit(this.taskWindowArea,()=>{});
  s.text('任务与礼包',x+16,y+15,18,this.colors.ink,750,w-75);s.button({x:x+w-43,y:y+9,w:30,h:30},'',()=>this.showModal(null));s.icon('close',{x:x+w-40,y:y+12,w:24,h:24},this.colors.ink);
  const area={x:x+8,y:y+46,w:w-16,h:h-58},saved={scroll:this.scroll,extent:this.extent,bodyTop:this.bodyTop,bodyBottom:this.bodyBottom};
  // Reuse task cards while keeping their scroll separate from the page behind the window.
  try{s.withViewport(area,()=>{this.scroll=this.modalScroll;this.extent=this.modalExtent;this.bodyTop=6;this.bodyBottom=s.h-8;this.drawTasks(true);this.scroll=clamp(this.scroll,0,Math.max(0,this.extent-(this.bodyBottom-this.bodyTop)));this.modalScroll=this.scroll;this.modalExtent=this.extent;this.modalArea={x:area.x,y:area.y+this.bodyTop,w:area.w,h:Math.max(0,this.bodyBottom-this.bodyTop)};});}
  finally{Object.assign(this,saved);}
 }
 private drawModal(){
  if(this.modal==='history'){this.drawHistoryWindow();return;}
  if(this.modal==='tasks'){this.drawTaskWindow();return;}
  if(this.modal==='chat'){this.drawPublicChat();return;}
  if(this.modal==='packPreview'){this.drawPackPreview();return;}
  const s=this.stage,currencyHelp=this.modal==='coins'||this.modal==='fragments',v=this.platform.viewport(),w=Math.min(s.w-24,currencyHelp?440:540),x=(s.w-w)/2,h=currencyHelp?Math.min(520,s.h-v.top-v.bottom-39):s.h-Math.max(v.top+15,s.h*.1)-v.bottom-24,y=currencyHelp?v.top+15+(s.h-v.top-v.bottom-39-h)/2:Math.max(v.top+15,s.h*.1);
  s.ctx.fillStyle=this.colors.overlay;s.ctx.fillRect(0,0,s.w,s.h);s.hit({x:0,y:0,w:s.w,h:s.h},()=>{});s.panel({x,y,w,h});
  const titles:Record<Exclude<Modal,null>,string>={privacyRequests:'个人资料申请',coins:'金币说明',fragments:'装饰碎片说明',tasks:'任务与礼包',albums:'选择相册',filters:this.route==='gallery'?'筛选图片':'筛选房间',settings:'玩家与设置',history:'历史记录',manage:this.formalWeb?'我的房间':'自己的房间',invite:'邀请好友',tools:'拼图工具',chat:'同桌交流',social:this.social.title,completion:'拼图完成',purchase:'解锁主题图包',packPreview:this.previewPack?.title??'图包预览'};
  s.text(titles[this.modal!],x+17,y+18,20,this.colors.ink,700,w-73);s.button({x:x+w-45,y:y+12,w:30,h:30},'',()=>{this.showModal(null);this.invalidate();});
  // A vector cross has the same visible size and center with browser and wx fonts.
  s.icon('close',{x:x+w-42,y:y+15,w:24,h:24},this.colors.ink);
  this.modalStart=y+59;this.modalArea={x:x+12,y:this.modalStart,w:w-24,h:h-73};let cy=this.modalStart-this.modalScroll;const left=x+20,width=w-40;
  if(this.modal==='social'){this.modalExtent=0;this.modalScroll=0;this.social.render(s,this.modalArea);return;}
  s.clip(this.modalArea,()=>{switch(this.modal){
   case'privacyRequests':{
    cy=this.paragraph('联系 '+MOBILE_PRIVACY_CONTACT+'。申请登记后需核验本人，不会立即删除资料，也不会要求你发送登录令牌或身份证照片。',left,cy,width,12)+16;
    if(this.client.config.capabilities.privacyRequests===true){
     this.button(left,cy,width,'申请访问我的资料',()=>void this.submitPrivacyRequest('access'),'cream',38,this.busy);cy+=48;
     this.button(left,cy,width,'登记删除资料申请',()=>void this.submitPrivacyRequest('delete'),'linen',38,this.busy);cy+=48;
     if(this.privacyRequestsLoading){cy=this.paragraph('正在读取申请…',left,cy,width,12)+15;}
     for(const row of this.privacyRequests){const status=row.status==='pending'?'待核验':row.status==='in_review'?'核验处理中':row.status==='completed'?'已记录处理结果':row.status==='cancelled'?'已取消':'待联系核实';s.text((row.type==='delete'?'删除':'访问')+'申请 · '+status,left,cy,14,this.colors.ink,750,width);cy+=26;cy=this.paragraph('申请编号：'+row.requestId+'\n核验编号：'+row.verificationCode,left,cy,width,11)+11;cy=this.paragraph('请邮件提供上述编号。登记或处理中均不表示已删除。',left,cy,width,11)+20;}
     if(!this.privacyRequests.length&&!this.privacyRequestsLoading){cy=this.paragraph('暂无申请记录。你也可以直接邮件联系运营者。',left,cy,width,12)+16;}
    }else cy=this.paragraph('当前连接版本尚未开放游戏内申请登记，请通过上述邮箱联系运营者。',left,cy,width,13)+18;
    this.button(left,cy,width,'撤回同意并断开游戏',()=>this.withdrawPrivacy(),'linen',38);cy+=50;break;
   }
   case'coins':case'fragments':{
    const coins=this.modal==='coins',wallet=this.route==='collection'?(this.collection?.wallet??this.client.profile?.collection):this.client.profile?.collection;
    s.icon(coins?'coin':'fragment',{x:left,y:cy+3,w:36,h:38});s.text('当前拥有',left+49,cy+1,12,this.colors.muted);s.text(wallet?.[this.modal]??0,left+49,cy+23,23,this.colors.ink,800,width-49);cy+=65;
    s.text('有什么用',left,cy,15,this.colors.ink,750);cy=this.paragraph(coins?'用于永久解锁主题图包。':'用于合成标注碎片价格的装饰。',left,cy+27,width,14)+19;
    s.text('怎么获得',left,cy,15,this.colors.ink,750);cy+=28;
    const sources=coins?['有效拼合：符合奖励条件的拼合可获得金币。','完成拼图：整幅完成后，按本局有效贡献结算。','任务与礼包：完成含金币奖励的任务、开启对应礼包。','相册收集：达成含金币奖励的相册阶段目标。']:['参与有效拼合，整幅拼图完成后按个人贡献结算。','不必由你放下最后一块；仅加入房间而未有效拼合，不计贡献奖励。'];
    for(const text of sources){cy=this.paragraph('· '+text,left,cy,width,14,this.colors.ink)+10;}
    cy=this.paragraph(coins?'具体数量以任务、图鉴及完成结算页为准。':'图鉴专属装饰需达成对应相册目标，不能用碎片替代。具体数量以完成结算页为准。',left,cy+3,width,12)+18;
    this.button(left,cy,width,'知道了',()=>this.showModal(null),'berry',38);cy+=50;break;
   }
   case'albums':{
    for(const album of this.collection?.albums??[]){s.button({x:left,y:cy,w:width,h:51},album.title+' · '+album.collected+'/'+album.total,()=>{this.selectAlbum(album.id);this.showModal(null);},{tone:album.id===this.albumId?'berry':'cream',icon:'book',fontSize:14});cy+=62;}break;
   }
   case'filters':{
    s.text('图片方向',left,cy,14,this.colors.ink,700);cy+=30;this.rowOptions(directions,this.direction,left,cy,width,v=>{this.direction=v;this.invalidate();});cy+=52;
    if(this.route==='lobby'){s.text('拼图片数',left,cy,14,this.colors.ink,700);cy+=30;this.rowOptions([[0,'不限'],...this.pieceCounts.map(n=>[n,n+'片'] as const)],this.filterCount,left,cy,width,n=>{this.filterCount=n;this.invalidate();});cy+=51;this.button(left,cy,width,(this.openOnly?'✓ ':'')+'只看可加入房间',()=>{this.openOnly=!this.openOnly;this.invalidate();});cy+=47;this.button(left,cy,width,(this.activeOnly?'✓ ':'')+'有人正在拼图',()=>{this.activeOnly=!this.activeOnly;this.invalidate();});cy+=54;}
    else{this.button(left,cy,width,this.search?'搜索：'+this.search:'搜索图片名称',()=>void this.run(async()=>{const result=await this.platform.prompt('搜索图片名称',this.search);if(result!==null)this.search=result.trim();}));cy+=51;s.text('图片分类',left,cy,14,this.colors.ink,700);cy+=30;CATEGORIES.forEach((category,index)=>{const bw=(width-12)/3;this.button(left+(index%3)*(bw+6),cy+Math.floor(index/3)*43,bw,category,()=>{this.category=category;this.invalidate();},category===this.category?'berry':'cream',34);});cy+=Math.ceil(CATEGORIES.length/3)*43+10;}
    this.button(left,cy,width,'应用筛选',()=>this.showModal(null),'berry',43);cy+=57;break;
   }
   case'settings':{
    const p=this.client.profile;s.icon('avatar',{x:left,y:cy,w:54,h:58});s.text(p?.name??'玩家',left+70,cy+6,18,this.colors.ink,700);s.text('Lv.'+(p?.level??'—')+' · '+(p?.xp??0)+'/'+(p?.xpToNext??0)+'经验',left+70,cy+33,13);cy+=77;
    if(this.formalWeb){s.text(this.client.account?'已登录 · '+this.client.account.username:'网站游客进度',left,cy,12,this.colors.muted,600,width);cy+=28;for(const[label,key]of [[this.client.account?'账号管理':'登录 / 注册','account'],['账号安全与数据管理','security']] as const){this.button(left,cy,width,label,()=>this.openWeb(key));cy+=48;}}
    s.text('玩家 ID '+(p?.code||this.social.playerCode||'正在读取…'),left,cy,13,this.colors.muted,600,width);cy+=32;
    if(this.adTestingAllowed){s.button({x:left,y:cy,w:width,h:40},'广告观看测试',()=>void this.testRewardedAd(),{tone:'berry',disabled:this.busy});cy+=52;s.button({x:left,y:cy,w:width,h:40},'插屏广告测试',()=>void this.testInterstitialAd(),{tone:'berry',disabled:this.busy});cy+=52;cy=this.paragraph('仅当前测试账号可见，只测试展示，不发放奖励。',left,cy,width,11)+17;}
    if(this.platform.config.id==='taptap'&&this.platform.config.tapAuthorizationTest){s.button({x:left,y:cy,w:width,h:40},this.authorizationTesting?'取消昵称授权测试':'重新走昵称授权',()=>void this.reauthorizeNickname(),{tone:'berry',disabled:!!this.room||this.busy&&!this.authorizationTesting});cy+=52;cy=this.paragraph((this.room?'请回大厅后进行授权自测。':this.platform.tapIdentityDiagnostics?.()??'仅当前自测包开放，不清除账号和进度。')+'\n版本 '+(this.platform.config.buildVersion??'自测'),left,cy,width,11)+17;}
    if(this.platform.config.previewTestRoom){
     const d=this.realtime?.diagnostics(),host=this.platform.onlineBattleDiagnostics?.(),available=d?.preview==='taptap-test';
     s.text('独立联机自测 D4 · 数据不计入正式服',left,cy,12,this.colors.ink,700,width);cy+=27;
     s.text('本机发送频率（每秒上限）',left,cy,12,this.colors.ink,700,width);cy+=26;
     if(available)this.rowOptions([[4,'4 次'],[10,'10 次'],[15,'15 次']],Number(d?.previewTargetHz??10),left,cy,width,hz=>{this.realtime?.setPreviewSendHz?.(hz);this.invalidate();},35);else s.text('当前房间未启用平台预览，切档不生效',left,cy,11,this.colors.muted,600,width);cy+=47;
     const peers=Array.isArray(d?.platformPeerReceives)?d.platformPeerReceives:[];
     cy=this.paragraph('通道：'+(d?.previewConnected?'TapTap平台同步':'原服务器同步')+' · 已确认 '+(d?.previewPeersConfirmed??0)+' / '+(d?.previewPeersExpected??'—')+' 位拼友\n统计 '+(d?.previewStatsSeconds??0)+' 秒 · 最近1秒发送 '+(d?.platformSendRate??0)+' / 峰值 '+(d?.platformSendPeak??0)+'\n尝试 '+(d?.platformSent??'—')+' · 成功 '+(d?.platformSucceeded??'—')+' · 失败 '+(d?.platformFailed??'—')+'\n其中拖动 '+(d?.platformDragSent??0)+' · 接收 '+(d?.platformReceived??0)+(d?.platformSendPending?' · 等待发送回调':'')+'\n本机平台入房：'+(d?.previewSessionJoined?'已加入':'未就绪')+' · 成员绑定 '+(d?.previewMembersReady??'—')+'/'+(d?.previewMembersTotal??'—')+(Array.isArray(d?.previewMissingBindings)&&d.previewMissingBindings.length?'\n等待绑定：'+d.previewMissingBindings.join('、'):'')+'\n宿主回调 '+(d?.platformCallbacks??'—')+' · 有效消息 '+(d?.platformReceived??'—')+(d?.previewIgnored?'\n忽略：未就绪 '+(d.previewIgnored as any).notReady+' / 格式 '+(d.previewIgnored as any).payload+' / 发送者 '+(d.previewIgnored as any).sender+' / 绑定 '+(d.previewIgnored as any).binding+' / 重复 '+(d.previewIgnored as any).duplicate+' / 内容 '+(d.previewIgnored as any).frame:'')+peers.map(peer=>'\n来自 '+String(peer.name)+'：'+peer.hz+'/秒 · 共 '+peer.total).join('')+'\n步骤：'+String(d?.previewDetail||'尚未初始化')+(d?.platformLastSendError?'\n最后发送失败：'+String(d.platformLastSendError):'')+(d?.previewRecoveryCount?'\n自动重连：'+String(d.previewRecoveryCount)+' 次':'')+'\n多人接口：'+(host?.managerAvailable?'已提供':'未提供')+'\n基础库：'+(host?.tapSDKVersion??'宿主未返回')+'（要求 2.7.0+）\nTapTap版本：'+(host?.clientVersion??'宿主未返回')+(d?.previewError?'\n状态码：'+String(d.previewError):'')+(d?.previewEventShape?'\n接收结构：'+String(d.previewEventShape):'')+(d?.previewResponse?'\n返回结构：'+String(d.previewResponse):''),left,cy,width,12)+14;
     if(available){this.button(left,cy,width,'清零统计（不会重新连接）',()=>{this.realtime?.resetPreviewStats?.();this.invalidate();},'cream',35);cy+=47;}
     this.button(left,cy,width,'重新进入测试房',()=>{const test=this.platform.config.previewTestRoom!;void this.enterRoom(test.id,test.inviteCode);},'cream',35);cy+=47;
     cy=this.paragraph('切档保留累计统计，只影响本机。显示原通道时档位未生效；先确认平台同步已接通，再比较频率。成功只代表平台接受发送，需对照其他两机接收数。',left,cy,width,11)+18;
    }
    if(this.nineGridAvailable){this.button(left,cy,width,'专用：九格拼合测试',()=>void this.startNineGrid(),'berry',42);cy+=54;}
    if(this.platform.config.id==='taptap'&&p?.taptap?.diagnostics===true){s.text('分享诊断（仅管理员）',left,cy,14,this.colors.ink,700);cy+=26;cy=this.paragraph(this.platform.shareDiagnostics?.()??'尚未尝试分享',left,cy,width,12)+18;}
    if(this.platform.config.id==='taptap'){this.button(left,cy,width,this.stage.w>this.stage.h?'切换竖屏':'切换横屏',()=>void this.toggleOrientation(),'cream',39);cy+=51;}
    s.text('外观',left,cy,15,this.colors.ink,750);cy+=28;this.rowOptions([['light','浅色'],['dark','深色'],['wood','仿木']],this.stage.theme,left,cy,width,value=>this.setTheme(value),39);cy+=56;
    s.text('声音',left,cy,15,this.colors.ink,750);cy+=31;
    this.button(left,cy,width,this.audioSettings.levels.effects===0?'开启音效':'音效静音',()=>this.toggleEffectsMute(),this.audioSettings.levels.effects===0?'cream':'berry',39);cy+=51;
    cy=this.drawAudioLevel('effects','游戏音效',left,cy,width);
    cy=this.paragraph('控制拼合、金币等游戏音效，设置会自动记住。',left,cy,width,12)+18;
    s.text('性能',left,cy,15,this.colors.ink,750);cy+=28;this.rowOptions([['smooth','流畅'],['power-saving','省电']],this.performanceMode,left,cy,width,value=>this.setPerformanceMode(value),39);cy+=48;cy=this.paragraph(this.performanceMode==='power-saving'?'持续画面最高30帧，拖动流畅度略有降低。':'跟随设备正常刷新频率，优先保证拖动流畅。',left,cy,width,12)+18;
    if(this.diagnosticsAvailable){
    this.button(left,cy,width,this.performanceInfoVisible?'隐藏性能信息':'显示性能信息',()=>{this.performanceInfoVisible=!this.performanceInfoVisible;this.invalidate();});cy+=48;
    if(this.performanceInfoVisible&&this.board){const board=this.board;this.button(left,cy,width,'诊断：背景缓存'+(board.gestureCacheEnabled?'开启':'关闭'),()=>{board.setGestureCacheEnabled(!board.gestureCacheEnabled);this.invalidate();});cy+=48;}
    if(this.performanceInfoVisible&&this.platform.setTouchInputMode){this.button(left,cy,width,'诊断：输入'+(this.platform.inputDiagnostics?.().mode==='touch'?'原生触摸':'指针'),()=>{this.platform.setTouchInputMode?.(this.platform.inputDiagnostics?.().mode!=='touch');this.invalidate();});cy+=48;}
    if(this.performanceInfoVisible&&this.platform.config.id==='taptap'&&this.board&&this.onRenderProbe){this.button(left,cy,width,'一键卡顿对照（约14秒）',()=>{this.showModal(null);this.onRenderProbe?.();});cy+=48;cy=this.paragraph('测试时持续划动屏幕；期间不会移动拼片，结束后显示结果。',left,cy,width,12)+12;}
    }
    this.button(left,cy,width,(this.formalWeb?'好友':'好友与消息')+(this.social.unread?' · '+this.social.unread+' 条未读':''),()=>this.showModal('social'),'cream',39);cy+=50;
    if(this.formalWeb||this.client.config.capabilities.customNames===true){this.button(left,cy,width,'修改昵称',()=>this.formalWeb?this.openWeb('account'):void this.run(async()=>{const value=await this.platform.prompt('昵称（1～16字）',p?.name);if(value!==null){await this.client.json('/api/mobile/profile','PATCH',{name:value.trim()},{'Content-Type':'application/json'});await this.client.refresh();this.note('昵称已保存');}}));cy+=48;}else cy=this.paragraph('首测暂停自定义昵称，当前昵称与已有进度保留。',left,cy,width,12)+18;
    if(this.energyEnabled){this.button(left,cy,width,(p?.autoSupply?'✓ ':'')+'体力耗尽自动使用库存包',()=>void this.run(async()=>{await this.client.json('/api/mobile/profile','PATCH',{autoSupply:!p?.autoSupply},{'Content-Type':'application/json'});await this.client.refresh();}));cy+=47;cy=this.paragraph('只消耗已有体力包，不会自动发起分享。',left,cy,width,12)+18;}
    const policyActions=this.formalWeb?[["隐私说明",()=>this.openWeb('privacy')],["服务说明",()=>this.openWeb('terms')]] as const:[["服务与隐私说明",()=>this.navigate('privacy')]] as const;
    if(this.formalWeb){this.button(left,cy,width,'用我的图片开一桌',()=>this.openWeb('uploads'),'berry',42);cy+=52;cy=this.paragraph('上传一张图片，选好片数，开一张自己的公开拼图桌。图片只在房间有效期内保留。',left,cy,width,12)+18;}
    for(const [label,action]of [['历史记录',()=>this.showModal('history')],['玩法帮助',()=>this.navigate('help')],...policyActions] as const){this.button(left,cy,width,label,action);cy+=48;}
    if(this.formalWeb){this.button(left,cy,width,'问题反馈',()=>this.openWeb('feedback'));cy+=48;cy=this.paragraph('账号、进度与收藏会持续保存在当前网站。',left,cy+4,width,12)+10;}else{this.button(left,cy,width,'个人资料访问与删除申请',()=>this.showModal('privacyRequests'));cy+=48;cy=this.paragraph('当前为本机游客身份，尚未绑定平台账号存档。清除本机数据可能丢失进度。',left,cy+4,width,12)+10;}break;
   }
   case'manage':{
    {this.button(left,cy,width,'返回历史记录',()=>this.showModal('history'),'cream',36);cy+=48;}
    cy=this.paragraph(this.formalWeb?'删除只移除自创列表入口，历史记录和大家的拼图进度仍保留。':'最多保留3个未完成的自创房间入口。删除只释放名额，最近10间历史和大家的拼图进度仍保留。',left,cy,width,13)+15;
    for(const room of this.client.profile?.ownedRooms??[])cy=this.drawSavedRoom(room,left,cy,width,true);
    if(!this.client.profile?.ownedRooms.length){s.text('还没有自创房间',left,cy+15,14,this.colors.muted);cy+=65;}break;
   }
   case'invite':{
    s.icon('invitationArt',{x:left+width/2-46,y:cy,w:92,h:89});cy+=102;s.text('邀请好友，一起攒礼包',left,cy,20,this.colors.ink,700,width);cy+=40;const invitation=this.tasks?.invitation,sharingTask=this.tasks?.tasks.find(task=>task.group==='sharing'),invitationTask=this.tasks?.tasks.find(task=>task.group==='invitation');cy=this.paragraph('好友接受首次邀请并完成'+(invitation?.requiredContributions??3)+'次有效拼合后，'+(this.energyEnabled?'可获得补满体力包'+(invitationTask?.xp?'及 '+invitationTask.xp+' 经验':'')+taskCoinsText(invitationTask?.coins??0):'任务奖励为：'+this.rewardText(0,invitationTask?.xp??0,invitationTask?.coins??0))+'。每日最多'+(invitation?.dailyLimit??3)+'位；新老玩家都可参与。',left,cy,width,14)+19;if(sharingTask){cy=this.paragraph('分享邀请奖励：'+this.rewardText(sharingTask.energy,sharingTask.xp,sharingTask.coins??0)+'，每日最多 '+sharingTask.target+' 次。',left,cy,width,12)+15;}
    s.text('我的邀请码',left,cy,12,this.colors.muted);cy+=26;s.text(this.tasks?.invitation.code??'正在读取…',left,cy,20,this.colors.ink,700,width);cy+=40;this.button(left,cy,width,'邀请好友',()=>void this.shareInvitation(),'berry',42);cy+=56;
    cy=this.paragraph('好友任务以真实参与为准，仅打开分享界面不会计为已发出成功或发放奖励。',left,cy,width,12)+18;
    this.button(left,cy,width,this.pendingInvitation?'邀请码：'+this.pendingInvitation:'输入好友邀请码',()=>void this.run(async()=>{const value=await this.platform.prompt('输入好友邀请码',this.pendingInvitation);if(value!==null)this.pendingInvitation=value.trim();}));cy+=48;
    if(this.pendingInvitation){this.button(left,cy,width,'接受好友邀请',()=>void this.acceptInvitation(),'green',40);cy+=52;}
    if(this.tasks?.invitation.bound){s.text('已关联：'+(this.tasks.invitation.boundToName??'好友'),left,cy,13,this.colors.muted);cy+=35;}break;
   }
   case'tools':{
    if(this.platform.config.id==='taptap'){this.button(left,cy,width,this.stage.w>this.stage.h?'切换竖屏':'切换横屏',()=>void this.toggleOrientation(),'cream',40);cy+=51;}
    if(this.platform.config.id==='web'&&this.platform.fullscreen?.available()){this.button(left,cy,width,this.platform.fullscreen.active()?'退出全屏':'进入全屏',()=>void this.toggleFullscreen(),'cream',40);cy+=51;}
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
    phrases.forEach((text,index)=>{const bw=(width-8)/2;this.button(left+(index%2)*(bw+8),cy+Math.floor(index/2)*45,bw,text,()=>void this.say(index),'cream',35);});cy+=Math.ceil(phrases.length/2)*45+10;break;
   }
   case'completion':{
    const room=this.room,result=(room?.snapshot as unknown as {mobileResult?:any})?.mobileResult,picture={x:left,y:cy,w:width,h:Math.min(width*.75,240)};
    s.frame(picture,'panel-cream');const shown=this.board?.drawCompletedPicture(s.ctx,{x:left+6,y:cy+6,w:width-12,h:picture.h-12});
    if(!shown){s.text(this.imageError?'图片加载失败':'正在加载成品…',left+12,cy+picture.h/2-20,13,this.colors.muted,500,width-24);if(this.imageError)this.button(left+12,cy+picture.h/2+4,width-24,'重新加载',()=>void this.run(async()=>{const board=this.board;if(!board)return;await board.setImage(this.roomImage);if(this.board===board){this.imageReady=true;this.imageError='';this.message='';}}),'cream',32);}
    s.ornaments(picture);cy+=picture.h+20;
    s.text('谢谢你，一起完成这幅作品',left,cy,17,this.colors.ink,700,width);cy+=37;
    if(result){s.text('我的贡献：'+result.contribution+' 次有效拼合',left,cy,14);cy+=32;for(const[kind,label,value]of [['coin','金币',result.coins??0],['fragment','碎片',result.fragments??0],['lightning','体力',result.energy??0]] as const){if(kind==='lightning'&&!this.energyEnabled)continue;s.icon(kind,{x:left,y:cy,w:25,h:25});s.text(label+' +'+value,left+36,cy+4,16,this.colors.ink,700);cy+=38;}
     if(result.catalog?.qualified){cy=this.paragraph(result.catalog.newlyCollected?'这张画作已加入图鉴！':'图鉴与难度记录已更新',left,cy,width,14)+16;}
     for(const reward of result.catalog?.albumRewards??[]){cy=this.paragraph(reward.title+'：'+(reward.coins?'金币 +'+reward.coins:'专属装饰已获得'),left,cy,width,13)+6;}
    }else{cy=this.paragraph('正在同步本次收获…奖励以服务器结算为准。',left,cy,width,14)+15;}
    this.button(left,cy,width,'查看收藏',()=>this.navigate('collection'),'cream',40);cy+=51;this.button(left,cy,width,'再拼一局',()=>{this.leaveRoom();this.navigate('gallery');},'berrydark',42);cy+=56;break;
   }
   case'purchase':{
    const pack=this.purchase;if(!pack)break;if(pack.images[0])this.cardImage(pack.images[0].thumbSrc,{x:left,y:cy,w:width,h:Math.min(220,width*.75)});cy+=Math.min(220,width*.75)+21;s.text(pack.title,left,cy,22,this.colors.ink,700);cy+=39;cy=this.paragraph(pack.images.length+'张图片永久解锁。可免费指定本包图片创建公开房间；私人房仍使用建房券。',left,cy,width,14)+18;s.text('花费 '+pack.price+' 金币',left,cy,20,this.colors.ink,700);cy+=34;s.text('现有 '+(this.collection?.wallet.coins??0)+' 金币',left,cy,13,this.colors.muted);cy+=39;this.button(left,cy,width,(this.collection?.wallet.coins??0)<pack.price?'金币不足':'确认解锁',()=>void this.collectionAction('buy',pack.id),'berry',42,(this.collection?.wallet.coins??0)<pack.price);cy+=57;break;
   }
  }});this.modalExtent=cy-(this.modalStart-this.modalScroll)+7;const next=clamp(this.modalScroll,0,Math.max(0,this.modalExtent-this.modalArea.h));if(next!==this.modalScroll){this.modalScroll=next;this.invalidate();}
 }

 input(input:Input):boolean{
  if(this.needsPrivacyChoice){
   const point=input.changed[0]??input.points[0];
   if(input.type==='wheel'&&point&&inside(this.listArea,point.x,point.y)){this.scroll=clamp(this.scroll+(Number.isFinite(input.deltaY)?input.deltaY!:0),0,Math.max(0,this.extent-this.listArea.h));this.stage.input({type:'cancel',points:[],changed:[]});this.pointer=null;this.invalidate();return true;}
   if(input.type==='down'&&point)this.pointer={x:point.x,y:point.y,lastY:point.y,scroll:false,board:false};
   if(input.type==='move'&&point&&this.pointer&&inside(this.listArea,this.pointer.x,this.pointer.y)){const p=this.pointer;if(p.scroll||Math.abs(point.y-p.y)>6){p.scroll=true;this.stage.input({type:'cancel',points:[],changed:[]});this.scroll=clamp(this.scroll+p.lastY-point.y,0,Math.max(0,this.extent-this.listArea.h));p.lastY=point.y;this.invalidate();return true;}}
   if(input.type==='up'||input.type==='cancel'){const scrolled=this.pointer?.scroll;this.pointer=null;if(scrolled)return true;}return this.stage.input(input);
  }
  if(this.loginDialogActive||this.platform.tapAuthorizationPending?.())return this.stage.input(input);
  if(!this.ready)return this.stage.input(input);
  const point=input.changed[0]??input.points[0];
  if(input.type==='key'){
   if(input.key==='Escape'&&input.keyDown){if(this.modal==='packPreview'&&this.previewIndex>=0){this.returnToPackGrid();return true;}this.cancelChatPress();const handled=this.board?.input(input)??false;this.pointer=null;this.stage.input({type:'cancel',points:[],changed:[]});if(this.modal){this.showModal(null);return true;}if(this.toolsOpen){this.toolsOpen=false;this.invalidate();return true;}return handled;}
   return this.route==='room'&&!this.modalBlocksInput?this.board?.input(input)??false:false;
  }
  if(input.type==='move'&&this.platform.canvas.style&&point){this.platform.canvas.style.cursor=this.pointer?.board?'grabbing':this.stage.hasHit(point.x,point.y)?'pointer':this.route==='room'&&inside(this.roomArea,point.x,point.y)&&!this.modalBlocksInput?'grab':'default';}
  if(this.modal==='social'){this.pointer=null;this.cancelChatPress();return this.social.input(input)||this.stage.input(input);}
  if(input.type==='wheel'){
   if(!point)return false;this.cancelChatPress();const delta=Number.isFinite(input.deltaY)?input.deltaY!:0;
   // Keep an active board gesture intact, even when it crosses a floating panel.
   if(this.pointer?.board)return this.board?.input(input)??false;
   const onModal=this.modalContains(point.x,point.y);
   if(onModal||this.route!=='room'){this.stage.input({type:'cancel',points:[],changed:[]});this.pointer=null;}
   if(onModal){if(inside(this.modalArea,point.x,point.y)){this.modalScroll=clamp(this.modalScroll+delta,0,Math.max(0,this.modalExtent-this.modalArea.h));this.invalidate();}return true;}
   if(this.route==='room'){if(this.board&&inside(this.roomArea,point.x,point.y)&&!this.stage.hasHit(point.x,point.y))return this.board.input(input);return false;}
   if(inside(this.albumListArea,point.x,point.y)){this.albumListScroll=clamp(this.albumListScroll+delta,0,Math.max(0,this.albumListExtent-this.albumListArea.h));this.invalidate();return true;}
   if(inside(this.listArea,point.x,point.y)){this.scroll=clamp(this.scroll+delta,0,Math.max(0,this.extent-this.listArea.h));if(this.route==='lobby'&&this.lobbyCursor&&this.scroll>this.extent-this.listArea.h-180)void this.loadLobby(true);this.invalidate();return true;}return false;
  }
  if(input.type==='cancel'||input.type==='up')this.cancelChatPress();
  if(input.type==='move'&&this.chatPress&&point&&Math.hypot(point.x-this.chatPress.x,point.y-this.chatPress.y)>6)this.cancelChatPress();
  if(this.modal==='chat'&&input.type==='down'&&point){const hit=this.chatHits.find(hit=>inside(hit.r,point.x,point.y));if(hit){this.cancelChatPress();this.chatPress={x:point.x,y:point.y,timer:setTimeout(()=>{this.stage.input({type:'cancel',points:[],changed:[point]});this.pointer=null;this.openPublicMessage(hit.message);},550)};}}
  if(!point){if(input.type==='cancel'){this.pointer=null;this.board?.input(input);}return this.stage.input(input);}
  if(!this.pointer&&this.route==='room'&&this.board&&!this.modalBlocksInput&&(input.type==='move'||input.type==='cancel')){if(this.stage.hasHit(point.x,point.y)&&inside(this.roomArea,point.x,point.y)){this.cursor?.point(null);return this.stage.input(input);}return this.board.input(input);}
  if(input.type==='down'){
   if(this.pointer?.board&&this.board)return this.board.input(input);
   const onModal=this.modalContains(point.x,point.y),board=!!this.board&&this.route==='room'&&!this.modalBlocksInput&&inside(this.roomArea,point.x,point.y)&&!this.stage.hasHit(point.x,point.y);
   if(input.pan&&!board)return true;
   this.pointer={x:point.x,y:point.y,lastY:point.y,scroll:false,board,modal:onModal,album:!onModal&&inside(this.albumListArea,point.x,point.y)};
   if(board)return this.board!.input(input);return this.stage.input(input);
  }
  if(this.pointer?.board){const handled=this.board?.input(input)??false;if(input.type==='cancel'||(input.type==='up'&&!input.points.length))this.pointer=null;return handled;}
  if(input.type==='move'&&this.pointer){const p=this.pointer,canScroll=p.modal?inside(this.modalArea,p.x,p.y):this.route!=='room'&&(p.album||inside(this.listArea,p.x,p.y));
   if(canScroll&&(p.scroll||Math.abs(point.y-p.y)>6)){if(!p.scroll)this.stage.input({type:'cancel',points:[],changed:input.changed});p.scroll=true;const delta=p.lastY-point.y;if(p.modal)this.modalScroll=clamp(this.modalScroll+delta,0,Math.max(0,this.modalExtent-this.modalArea.h));else if(p.album)this.albumListScroll=clamp(this.albumListScroll+delta,0,Math.max(0,this.albumListExtent-this.albumListArea.h));else{this.scroll=clamp(this.scroll+delta,0,Math.max(0,this.extent-this.listArea.h));if(this.route==='lobby'&&this.lobbyCursor&&this.scroll>this.extent-this.listArea.h-180)void this.loadLobby(true);}p.lastY=point.y;this.invalidate();return true;}p.lastY=point.y;
  }
  if(input.type==='up'||input.type==='cancel'){const scrolled=this.pointer?.scroll;this.pointer=null;if(scrolled)return true;}return this.stage.input(input);
 }
}
