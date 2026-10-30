import type {Platform,Input,Rect,Route,WebLinks} from './ports';
import {GameClient,type PlayerCard} from './client';
import {Stage} from './ui';
import {timeLabelFor,nodeState} from './story-timeline';
import {comicFor,comicSource,comicCloseRect,comicPageRect,comicLayout,comicTextCount,drawComicPage,drawComicText,reducedComicMotion,type Comic,type ComicPageState} from './story-comic';
import {OfflineMode,OFFLINE_REQUIRED,type OfflineInput} from './offline-mode';
import {cacheServerLevels,isNetworkFailure,preferOfflineLevelRoom} from '../lib/offline-play';
import {tapAuthorizationLayout} from './tap-authorization-layout';
import {PuzzleBoard} from './puzzle-board';
import {SocialPanel} from './social-panel';
import {TaskShareReward} from './task-share-reward';
import {contributionCopy,recoveryCopy} from './economy-copy';
import {collectionDecorationRewardHints} from './collection-copy';
import {boardThemeColors,isThemeId,landscapeRoomColors as roomColors,type ThemeId} from './theme';
import {roomRoundPath} from './room-chrome';
import {RoomClient,type RoomTicket,type RoomRequestTiming} from '../lib/room-client';
import {flushStoredSoloOutboxes} from '../lib/solo-play';
import {CursorClient} from '../lib/cursor-client';
import {CheerClient,CHEER_LABELS} from './cheer-client';
import {CHEER_EMOTES,type Cheer,type CheerEmote} from '../lib/room-realtime';
import {completionSeats,type CompletionSeat} from './completion-seats';
import {CheerEffects} from './cheer-effects';
import {drawCelebration} from './completion-celebration';
import {CompletionTransition} from './completion-transition';
import {CompletionFlow,type CompletionPhase,type CompletionPhaseEvent,type CompletionContext,type CompletionAction} from './completion-flow';
import {drawCheerIcon} from './cheer-icons';
import type {ManagedRoomRealtime} from '../lib/room-realtime';
import type {MobileContributionReceipt} from '../lib/connection-feedback';
import {GALLERY_PHOTOS,RESTORABLE_PHOTOS,CATEGORIES} from '../lib/puzzle-catalog';
import {photoGuidance} from '../lib/play-guidance';
import {customPhoto} from '../lib/custom-images';
import {activeRoomPhoto} from './room-photo';
import {ViewRequests} from './view-requests';
import {AudioSettings} from './audio-settings';
import {orientationPreferenceKey,readOrientationPreference,saveOrientationPreference,type ScreenOrientation} from './orientation-choice';
import {MOBILE_PRIVACY_VERSION,MOBILE_PRIVACY_CONSENT_KEY,MOBILE_PRIVACY_CONTACT,mobilePrivacySections,mobileTermsSections} from './privacy-policy';
import {placedCount} from '../lib/puzzle-engine';
import collectionCatalog from '../lib/mobile-collection-catalog.json';
import publicPhrases from '../config/social-phrases.json';
import type {MobileTaskView,MobileGiftOpenResult,MobileInviteShareResult,MobileRoomInput,MobileOwnedRoom,MobileLevelsView,MobileLevelClear,MobileChapter,MobileLevel} from '../h5/mobile-api';
import type {MobileCollectionView,CollectionPack,CollectionDecoration,CollectionAlbum} from '../h5/mobile-collection-api';
import type {RoomCard} from '../lib/lobby-types';
import type {AssistanceGrant} from '../lib/assistance-policy';

type Direction='all'|'portrait'|'landscape'|'square';
type PerformanceMode='smooth'|'power-saving';
type Modal='orientation'|'members'|'playerCard'|'history'|'filters'|'settings'|'manage'|'invite'|'tools'|'chat'|'social'|'completion'|'levelComic'|'purchase'|'packPreview'|'albums'|'tasks'|'coins'|'fragments'|'privacyRequests'|null;
type PrivacyRequest={requestId:string;type:'access'|'delete';status:string;createdAt:number;verificationCode:string};
type RecentPlayer={code:string;name:string;level:number;online:boolean;lastSeenAt:number;roomTitle:string;seenAt:number;requested:boolean};
type RoomListing=RoomCard&{actualPieces?:number;photo?:SharedPhoto;thumbSrc?:string;members?:{name:string;level:number;decoration?:{id?:string;artKey:string;color:string}|null}[]};
const directions:[Direction,string][]=[['all','全部'],['portrait','竖图'],['landscape','横图'],['square','方图']];
const themeOptions:[ThemeId,string][]=[['light','浅色'],['dark','夜间'],['wood','仿木']];
const counts=[48,108,300,500] as const;
const contentMaxWidth=1120;
const settingsTipKey='jigsaw:settings-tip:v1';
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
// Seats come from the server (4/6/8 by piece count); backends without maxPlayers seat 8.
const seatLimit=(room:{maxPlayers?:number}|null|undefined)=>room?.maxPlayers??8;
const VIEW_LOCK_KEY='jigsaw:room-view-lock:v1',LOCK_BUTTON_KEY='jigsaw:room-lock-button:v1';
/** Shown under 更多 so testers can tell which package they are running; bump it with every TapTap package. */
const CLIENT_PACKAGE_VERSION='v40';
function inside(r:Rect,x:number,y:number){return x>=r.x&&x<=r.x+r.w&&y>=r.y&&y<=r.y+r.h;}
function roomListKey(rooms:RoomListing[]){return JSON.stringify(rooms.map(room=>[room.id,room.title,room.imageId,room.thumbSrc??room.photo?.thumbSrc??photoMap.get(room.imageId)?.thumbSrc,room.actualPieces??room.pieces,room.placed,room.players,seatLimit(room),room.acceptingNew!==false,!!room.completed]));}
function messageListKey(messages:PublicMessage[]){return JSON.stringify(messages.map(item=>[item.id,item.name,item.text,item.playerId,item.code,item.level??0,item.sentAt??0]));}

/** One scene graph and one set of game rules for both mobile platforms. */
export class GameApp{
 route:Route='lobby';
 private routeStack:Route[]=[];
 private routeFrames:ListView[]=[];private savedRoutes=new Map<Route,ListView>();private listOwner?:string;private roomReturn:ListView|null=null;private roomReturnStack:Route[]=[];private roomReturnFrames:ListView[]=[];
 private ready=false;private destroyed=false;private busy=false;private sharing=false;private message='';private messageUntil=0;
 private startupPending:Promise<void>|null=null;private startupError='';private startupHooks=false;private startupQuery:Record<string,string>|null=null;
 private soloOutboxesFlushed=false;
 private readonly offline:OfflineMode;
 private get offlineRoom(){return this.offline?.isRoom(this.room?.ticket?.room?.id)??false;}
 private syncOffline(){if(this.ready)void this.offline?.sync(this.client,levels=>{this.levels=levels;this.levelsOwner=this.ownerKey();this.invalidate();},message=>this.note(message));}
 private enterOffline(){this.offline.active=true;this.route='chapter';this.scroll=0;this.modal=null;this.invalidate();}
 private async launchOffline(input:OfflineInput){await this.attachTicket(this.offline.createRoom(input));}
 private privacyAccepted=false;private privacyDocument:'privacy'|'terms'|null=null;private privacyRefused=false;private privacyEpoch=0;private authorizationTesting=false;private loginDialogActive=false;private authorizationNudged=false;private loginLogOpen=false;private loginLogReturnScroll=0;
 private identityHook=false;private consentPreparing=false;private consentError='';
 private privacyRequests:PrivacyRequest[]=[];private privacyRequestsLoading=false;
 private scroll=0;private extent=0;private bodyTop=100;private bodyBottom=0;private pointer:{x:number;y:number;lastY:number;scroll:boolean;board:boolean;album?:boolean;modal?:boolean;landscapeBackgroundTap?:boolean}|null=null;
 private modal:Modal=null;private modalScroll=0;private modalExtent=0;private modalArea:Rect={x:0,y:0,w:0,h:0};private modalStart=0;
 private orientationChoice:ScreenOrientation|null=null;private orientationSwitching=false;
 private orientationEntryPending:Promise<void>|null=null;private orientationEntryResolve:(()=>void)|null=null;
 private settingsTipSeen=false;private settingsTipDrawn=false;private settingsTipAnchor:Rect|null=null;
 private direction:Direction='all';private filterCount=0;private openOnly=true;private activeOnly=false;
 private rooms:RoomListing[]=[];private lobbyCursor:string|null=null;private lobbyLoading=false;private lobbyQuiet=false;private lobbySerial=0;private lobbyReload=false;
 private lobbyPieces:'all'|'small'|'large'='all';private dailyPhoto:SharedPhoto|null=null;private serverOffset=0;private listColumn:{x:number;w:number}|null=null;private lobbyMinute='';private lobbyOnline:number|null=null;private dailyFinished:number|null=null;
 private pieces:48|108|300|500=108;private selected:string|null=null;private visibility:'public'|'private'='public';private category='全部';private search='';private source:'free'|'owned'|'all'='free';private packId:string|null=null;
 private galleryIds:Set<string>|null=null;private freeGalleryIds:Set<string>|null=null;private packedIds=packed;
 private sharedPhotos:SharedPhoto[]|null=null;
 private levels:MobileLevelsView|null=null;private levelsOwner='';private levelsSerial=0;private autoLevelChecked=false;
 private chapterEntryChecked=false;private storyChapterId:string|null=null;
 private comicPage:ComicPageState|null=null;private comicRead?:Set<string>;
 private comicGesture:{id:number;x:number;y:number;lastY:number;lastAt:number;velocity:number;axis?:'x'|'y'}|null=null;
 private comicClosePress:number|null=null;
 private comicDrag=0;private comicSnap?:{started:number;offset:number};private comicHintUntil=0;private comicHintSeen=false;private comicBack?:()=>void;private storyFrame:number|null=null;
 private storyIntro:{text:string;until:number}|null=null;
 private tasks:MobileTaskView|null=null;private taskTab:'tasks'|'gifts'='tasks';private taskDetailsOpen=false;private taskWindowArea:Rect={x:0,y:0,w:0,h:0};
 private collection:MobileCollectionView|null=null;private collectionTab:'albums'|'packs'|'decorations'='albums';private albumId='';private decorationId='';private decorationOwnedOnly=false;private purchase:CollectionPack|null=null;
 private previewPack:CollectionPack|null=null;private previewIndex=-1;private previewGridScroll=0;private previewReadOnly=false;
 private room:(RoomClient&{snapshot:RoomClient['snapshot']&{levelId?:string;maxPlayers?:number;mobileResult?:{levelClear?:MobileLevelClear}}})|null=null;private board:PuzzleBoard|null=null;private detachRoom:(()=>void)|null=null;private unsubscribeRoom:(()=>void)|null=null;
 private cursor:CursorClient|null=null;private cursorVisible=false;
 private cheer:CheerClient|null=null;private readonly cheerEffects=new CheerEffects();private cheerFrame:number|null=null;
 private completionFx:CompletionTransition|null=null;private completionFxFrame:number|null=null;private completionCheerQueue:{cheer:Cheer;own:boolean;at:number}[]=[];private completionLive=false;private completionFxRect:Rect|null=null;private settleButtonRect:Rect|null=null;
 private completionHooks?:CompletionFlow;private get completionFlow(){if(!this.completionHooks){this.completionHooks=new CompletionFlow();this.completionHooks.register(context=>this.storyComicAction(context));}return this.completionHooks;}
 /** Story levels with comic data offer their page; the page opens with the split transition. */
 private hasLevelComic(levelId:string){const chapter=this.chapterForLevel(levelId),index=chapter?.levels.findIndex(level=>level.id===levelId)??-1;return !!chapter&&index>=0&&!!comicFor(chapter,index,chapter.levels[index]);}
 private storyComicAction(context:CompletionContext):CompletionAction|null{
  const levelId=(context.level?context.levelId:null)??context.levelClear?.levelId??null,chapter=this.chapterForLevel(levelId);if(!levelId||!chapter)return null;
  const index=chapter.levels.findIndex(level=>level.id===levelId);if(index<0||!comicFor(chapter,index,chapter.levels[index]))return null;
  return {label:'翻开这一页',action:()=>this.openLevelComic(levelId,{fromClear:true})};
 }
 get completionPhase():CompletionPhase{return this.completionFlow.phase;}
 onCompletionPhase(listener:(event:CompletionPhaseEvent)=>void):()=>void{return this.completionFlow.subscribe(listener);}
 openCompletionPopup():boolean{if(!this.room?.snapshot.completedAt||this.nineGridRoom)return false;if(this.completionFx)this.finishCompletionTransition();else this.showModal('completion');return true;}
 closeCompletionPopup():boolean{if(this.modal!=='completion')return false;this.showModal(null);return true;}
 registerCompletionAction(provider:(context:CompletionContext)=>CompletionAction|null):()=>void{const unregister=this.completionFlow.register(provider);this.invalidate();return()=>{unregister();this.invalidate();};}
 private completionContext():CompletionContext{const snapshot=this.room?.snapshot;return {roomId:snapshot?.id??'',level:!!snapshot?.levelId,levelId:snapshot?.levelId??null,levelClear:snapshot?.mobileResult?.levelClear??null};}
 private setCompletionPhase(phase:CompletionPhase){if(this.room&&(!this.nineGridRoom||phase==='idle'))this.completionFlow.set(phase,this.completionContext());}
 private completionSeatRects=new Map<string,Rect>();private completionAvatarRects=new Map<string,Rect>();private completionSlotRects=new Map<string,Rect>();private completionBubbleRects=new Map<string,Rect>();private completionPicture:Rect={x:0,y:0,w:0,h:0};private completionBar:Rect={x:0,y:0,w:0,h:0};
 private realtime:ManagedRoomRealtime|null=null;
 private roomPanelCollapsed=false;private roomMembersHighlight=0;private landscapeToolsOpen=false;private desktopToolsOpen=true;
 private cardCode='';private cardData:PlayerCard|null=null;private cardError='';private cardLoading=false;private cardSending=false;private cardRequestId='';private cardCache=new Map<string,{at:number;data:PlayerCard}>();private cardReturn:Modal=null;
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
  this.offline=new OfflineMode(platform);for(const photo of Object.values(this.offline.catalog?.photos??{}))photoMap.set(photo.id,photo);
  try{const consent=JSON.parse(platform.storage.get(MOBILE_PRIVACY_CONSENT_KEY)||'null');this.privacyAccepted=consent?.version===MOBILE_PRIVACY_VERSION&&consent?.necessary===true&&consent?.hongKongStorage===true;}catch{}
  try{this.settingsTipSeen=platform.storage.get(settingsTipKey)==='1';}catch{}
  this.shareReward=new TaskShareReward(platform,requestId=>client.post<MobileInviteShareResult>('/api/mobile/invitations/share',{requestId,shared:true}));
  const saved=platform.storage.get('jigsaw:shared:theme:'+platform.config.apiBase);stage.setTheme(isThemeId(saved)?saved:'light');if(platform.canvas.style)platform.canvas.style.colorScheme=stage.theme==='dark'?'dark':'light';
  this.renderMode=platform.storage.get('jigsaw:shared:performance:'+platform.config.apiBase)==='power-saving'?'power-saving':'smooth';
  this.roomPanelCollapsed=platform.storage.get('jigsaw:room-panel-collapsed:v1')==='1';
  this.desktopToolsOpen=platform.storage.get('jigsaw:desktop-tools-open:v1')!=='0';
  this.landscapeToolsOpen=platform.storage.get('jigsaw:landscape-tools-open:v1')==='1';
  try{this.lockButtonEnabled=platform.storage.get(LOCK_BUTTON_KEY)==='1';this.viewLocked=this.lockButtonEnabled&&platform.storage.get(VIEW_LOCK_KEY)==='1';}catch{}
  this.audioSettings=new AudioSettings(platform);
  this.social=new SocialPanel(client,{invalidate:()=>this.invalidate(),note:message=>this.note(message),joinRoom:(id,invite)=>this.enterRoom(id,invite),room:()=>{
   const room=this.room;if(!room||this.offlineRoom)return null;return {id:room.ticket.room.id,title:room.snapshot.title||'一起拼图',pieces:room.state.cols*room.state.rows,visibility:room.snapshot.visibility,inviteCode:(this.client.ticket as RoomTicket&{inviteCode?:string})?.inviteCode||(room.snapshot as unknown as {inviteCode?:string}).inviteCode,authorization:'Bearer '+room.ticket.token,members:room.snapshot.members.map(member=>({...member,code:(member as unknown as {code?:string}).code,level:(member as unknown as {level?:number}).level}))};
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
 private get actualOrientation():ScreenOrientation{return this.stage.w>this.stage.h?'landscape':'portrait';}
 private offerFirstOrientation():Promise<void>{
  if(this.orientationEntryPending)return this.orientationEntryPending;
  if(this.platform.config.id!=='taptap'||!this.platform.setOrientation||this.platform.orientationChoiceAvailable?.()!==true)return Promise.resolve();
  // Read once outside the tolerant preference parser: unavailable storage must skip the offer.
  try{const saved=this.platform.storage.get(orientationPreferenceKey);if(readOrientationPreference({get:()=>saved})!==null)return Promise.resolve();}catch{return Promise.resolve();}
  this.orientationChoice=this.actualOrientation;
  this.orientationEntryPending=new Promise(resolve=>{this.orientationEntryResolve=resolve;});
  this.showModal('orientation');
  return this.orientationEntryPending;
 }
 private finishOrientationOffer(){const resolve=this.orientationEntryResolve;this.orientationEntryResolve=null;this.orientationEntryPending=null;this.orientationChoice=null;resolve?.();}
 private async chooseOrientation(value:ScreenOrientation){
  if(this.modal!=='orientation'||this.orientationSwitching)return;
  if(value===this.actualOrientation){this.orientationChoice=value;saveOrientationPreference(this.platform.storage,value);this.invalidate();return;}
  this.orientationSwitching=true;this.invalidate();
  const pending=this.orientationEntryPending;
  try{await this.platform.setOrientation!(value);if(this.orientationEntryPending!==pending)return;this.orientationChoice=value;saveOrientationPreference(this.platform.storage,value);}
  catch(error){if(this.orientationEntryPending===pending){this.orientationChoice=this.actualOrientation;this.note(errorText(error));}}
  finally{this.orientationSwitching=false;this.invalidate();}
 }
 private confirmOrientation(){
  if(this.modal!=='orientation'||this.orientationSwitching)return;
  saveOrientationPreference(this.platform.storage,this.actualOrientation);
  this.finishOrientationOffer();this.showModal(null);
 }
 private async toggleOrientation(){if(!this.platform.setOrientation)return;await this.run(async()=>{if(!this.platform.setOrientation)throw Error('当前客户端不支持切换方向');const target=this.stage.w>this.stage.h?'portrait':'landscape';await this.platform.setOrientation(target);saveOrientationPreference(this.platform.storage,target);this.showModal(null);this.toolsOpen=false;this.invalidate();});}
 private async toggleFullscreen(){await this.run(async()=>{if(this.platform.config.id!=='web'||!this.platform.fullscreen?.available())return;try{await this.platform.fullscreen.toggle();this.showModal(null);this.invalidate();}catch{this.note('浏览器暂时无法切换全屏，请检查全屏权限后重试');}});}
 private toggleEffectsMute(){const key='jigsaw:shared:audio:last-effects',volume=this.audioSettings.levels.effects;if(volume>0){try{this.platform.storage.set(key,String(volume));}catch{}this.audioSettings.set('effects',0);}else{let previous=1;try{const saved=Number(this.platform.storage.get(key));if(Number.isFinite(saved)&&saved>0)previous=Math.min(1,saved);}catch{}this.audioSettings.set('effects',previous);}this.invalidate();}
 private get formalWeb(){return this.client.cookieIdentity;}
 private get needsPrivacyChoice(){return (this.platform.config.id==='taptap'||this.platform.config.id==='wechat')&&!this.privacyAccepted;}
 private get usesCreationTickets(){return this.client.config.capabilities.createTickets??(this.platform.config.id!=='web'&&!this.formalWeb);}
 private get pieceCounts(){return this.formalWeb?counts.filter(count=>(this.client.config.capabilities.supportedPieces??[108,300,500]).includes(count)):counts;}
 private webLink(key:WebPage){return this.platform.config.webLinks?.[key]??this.client.config.compatUrls?.[key]??({account:'/account',security:'/account/security',membership:'/membership',uploads:'/upload',terms:'/terms',privacy:'/privacy',feedback:'/feedback'}[key]);}
 private openWeb(key:WebPage){this.platform.openUrl?.(this.webLink(key));}
 private drawWebLinks(x:number,y:number,w:number){const s=this.stage,items:[WebPage,string][]=[['terms','用户协议'],['privacy','隐私政策'],['feedback','反馈']];items.forEach(([key,label],index)=>{const cw=w/items.length,cx=x+index*cw;s.text(label,cx+(cw-s.measure(label,10))/2,y,10,this.colors.muted);s.hit({x:cx,y:y-4,w:cw,h:22},()=>this.openWeb(key));});}
 private get finePointer(){try{return typeof matchMedia==='function'&&matchMedia('(pointer:fine)').matches;}catch{return false;}}
 private layoutFor(width:number,height:number):'desktop'|'phoneLandscape'|'phonePortrait'{const id=this.platform.config.id;if(width>=1000&&height>=600&&(id==='web'||id==='taptap'&&this.finePointer))return 'desktop';return width>height&&height<500?'phoneLandscape':'phonePortrait';}
 /** The single layout decision, from the scaled logical viewport; every screen reads it. */
 private get layout(){const v=this.platform.viewport();return this.layoutFor(v.width,v.height);}
 private get desktop(){return this.layout==='desktop';}
 private get floatingTasks(){const v=this.platform.viewport();return v.width>v.height&&v.width>=540;}
 // Primary navigation: five destinations plus settings. The puzzle room never shows it.
 private readonly navItems:readonly(readonly[Route,string,string])[]=[['chapter','故事','story'],['lobby','大厅','players'],['gallery','图库','underlay'],['collection','收藏','book'],['friends','好友','friendArt']];
 private get tabRoute(){return !this.room&&this.navItems.some(([route])=>route===this.route);}
 private get navVisible(){return this.ready&&!this.room&&(this.tabRoute||this.route==='supplies');}
 private contentOrigin={x:0,y:0};
 private openTab(route:Route){if(route===this.route){this.scroll=0;this.albumListScroll=0;this.invalidate();return;}this.navigate(route);this.routeStack=[];this.routeFrames=[];}
 private navBadge(route:Route,x:number,y:number){
  const s=this.stage;if((route==='tasks'&&(this.client.profile?.giftCount??0)>0)||(route==='chapter'&&this.availableChapters.some(chapter=>chapter.levels.some(level=>level.status==='unlocked')))){s.ctx.fillStyle=s.color('#b46177');s.ctx.fillRect(Math.round(x-4),Math.round(y-4),8,8);return;}
  const count=route==='friends'?this.social.unread+this.social.requestCount:0;if(!count)return;const label=count>99?'99+':String(count),w=Math.max(17,s.measure(label,9,700)+8);s.frame({x:x-w/2,y:y-8,w,h:17},'segment-berry-selected');s.text(label,x-s.measure(label,9,700)/2,y-6,9,this.colors.onAccent,700);
 }
 private drawTabBar(){
  const s=this.stage,v=this.platform.viewport(),y=s.h-v.bottom-64,tw=s.w/this.navItems.length;if(this.modalBlocksInput)return;
  s.ctx.fillStyle=this.colors.cream;s.ctx.fillRect(0,y,s.w,s.h-y);s.ctx.fillStyle=this.colors.line;s.ctx.fillRect(0,y,s.w,2);
  this.navItems.forEach(([route,label,icon],index)=>{const x=index*tw,selected=this.route===route;
   if(selected){s.ctx.fillStyle=s.color('#a85567');s.ctx.fillRect(Math.round(x+tw*.22),y,Math.round(tw*.56),3);}
   s.ctx.save();s.ctx.globalAlpha=selected?1:.7;s.icon(icon,{x:x+(tw-26)/2,y:y+9,w:26,h:26});s.ctx.restore();
   s.text(label,x+(tw-s.measure(label,11,700))/2,y+39,11,selected?this.colors.ink:this.colors.muted,700);this.navBadge(route,x+tw/2+15,y+11);
   s.hit({x,y,w:tw,h:s.h-y},()=>this.openTab(route));});
 }
 private drawNavRail(){
  const s=this.stage,v=this.platform.viewport(),w=64,top=v.top+6,itemH=Math.min(56,(s.h-top-v.bottom-6)/6);
  s.ctx.fillStyle=this.colors.cream;s.ctx.fillRect(0,0,w,s.h);s.ctx.fillStyle=this.colors.line;s.ctx.fillRect(w-2,0,2,s.h);
  const item=(r:Rect,label:string,icon:string,selected:boolean,action:()=>void,route?:Route)=>{if(selected)s.frame(r,'button-cream-selected');const iy=r.y+(r.h-37)/2;s.icon(icon,{x:r.x+(r.w-24)/2,y:iy,w:24,h:24});s.text(label,r.x+(r.w-s.measure(label,10,700))/2,iy+26,10,selected?this.colors.ink:this.colors.muted,700);if(route)this.navBadge(route,r.x+r.w/2+14,iy+3);s.hit(r,action);};
  this.navItems.forEach(([route,label,icon],index)=>item({x:5,y:top+index*itemH,w:w-12,h:itemH-4},label,icon,this.route===route,()=>this.openTab(route),route));
  item({x:5,y:s.h-v.bottom-itemH-2,w:w-12,h:itemH-4},'设置','tools',false,()=>this.showModal('settings'));
 }
 private get modalBlocksInput(){return this.modal!==null&&this.modal!=='tasks'&&this.modal!=='chat'||this.route==='room'&&this.roomGuideStep>0;}
 private get boardInputBlocked(){return this.modalBlocksInput||!!this.completionFx;}
 private modalContains(x:number,y:number){return this.modalBlocksInput||(this.modal==='tasks'&&inside(this.taskWindowArea,x,y))||(this.modal==='chat'&&inside(this.chatWindowArea,x,y));}
 private get energyEnabled(){return !this.offlineRoom&&!(this.offline?.active&&!this.ready)&&!this.formalWeb&&this.client.config.capabilities?.energy!==false;}
 private get shareAvailable(){return this.client.config.capabilities.shareRewards===true;}
 private get cheersEnabled(){return !this.offlineRoom&&this.client.config.capabilities.cheers!==false;}
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
  if(this.completionFx)this.animateCompletion();
  if(this.modal==='completion'&&this.cheerEffects.alive())this.animateCheers();
  const now=Date.now();let changed=false;
  if(this.messageUntil&&now>this.messageUntil){this.message='';this.messageUntil=0;changed=true;}
  const clock=this.route==='room'&&(this.toolsOpen||this.platform.config.id!=='web'&&this.layout==='phoneLandscape'&&this.landscapeToolsOpen)?(['hint','underlay'] as const).map(kind=>{const grant=this.activeAid(kind);return grant?Math.max(0,Math.ceil((grant.expiresAt-now)/1000)):0;}).join(':'):'';
  if(clock&&clock!==this.lastAidClock)changed=true;this.lastAidClock=clock;
  if(this.route==='room'&&this.room&&!this.room.connected)changed=true;
  if(this.chatBubble&&now>this.chatBubble.until){this.chatBubble=null;changed=true;}
  else if(this.chatBubble&&this.chatBubble.until-now<=1000&&this.route==='room'&&this.platform.config.id!=='web'&&this.layout==='phoneLandscape')changed=true;
  if(this.route==='lobby'){const minute=String(Math.floor(this.dailyNow()/60000));if(minute!==this.lobbyMinute){this.lobbyMinute=minute;changed=true;}}
  if(changed||this.authorizationTesting||this.platform.config.previewTestRoom&&(this.route==='room'||this.modal==='settings'))this.invalidate();
 }
 private note(message:string,permanent=false){this.message=message;this.messageUntil=permanent?Infinity:Date.now()+3000;this.invalidate();}
 private attempt(key:string){let value=this.attempts.get(key);if(!value){value=this.platform.randomId();this.attempts.set(key,value);}return value;}
 private async run(action:()=>Promise<void>){if(this.busy||this.orientationEntryPending)return;this.busy=true;this.invalidate();try{await action();}catch(error){if(this.formalWeb&&(error as {code?:string}|null)?.code==='LEGACY_ROOM_REQUIRED')this.note('这间历史房间的进度仍然保留，新版暂不支持继续拼。请先选择其他房间。');else if((error as {code?:string}|null)?.code==='PACK_LOCKED')this.note('这张图在未解锁的图包里，请先解锁图包');else this.note(errorText(error));}finally{this.busy=false;this.invalidate();}}
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
   this.cleanups.push(this.platform.onHide(()=>{this.hidden=true;this.room?.flushSoloNow();this.realtime?.setHidden(true);this.pointer=null;this.cancelChatPress();}),this.platform.onShow(query=>{this.hidden=false;this.realtime?.setHidden(false);if(!this.ready){if(Object.keys(query).length)this.startupQuery=query;void this.start();}else if(this.orientationEntryPending){if(Object.keys(query).length)this.startupQuery=query;}else{void this.client.refresh().catch(error=>{if(!this.destroyed)this.note(errorText(error));});this.syncOffline();if(!this.offlineRoom){void this.social.refresh();void this.handleQuery(query);}}this.invalidate();}));
  }
  this.startupError='';this.invalidate();
  const epoch=this.privacyEpoch;
  this.startupPending=(async()=>{
  try{await this.client.start();if(this.destroyed||this.needsPrivacyChoice||epoch!==this.privacyEpoch)return;if(this.client.profile&&!this.soloOutboxesFlushed){this.soloOutboxesFlushed=true;void flushStoredSoloOutboxes({storage:this.platform.storage,fetch:this.offline.onlineFetch(this.client.fetchLike),now:()=>Date.now(),randomId:()=>this.platform.randomId(),skipRoomId:this.room?.ticket.room.id}).catch(()=>{});}this.ready=true;this.loginDialogActive=false;this.offline.active=false;this.message='';if(this.client.tapNotice)this.note(this.client.tapNotice);this.invalidate();const query=this.startupQuery??this.platform.initialQuery;this.startupQuery=null;await this.loadInitialContent(query,epoch);this.syncOffline();}
  catch(error){if(!this.destroyed){this.startupError=errorText(error);this.invalidate();}}
  if(this.destroyed||this.needsPrivacyChoice||epoch!==this.privacyEpoch||this.timers.length)return;
  this.timers.push(setInterval(()=>{if(this.destroyed||this.hidden||!this.ready||this.offlineRoom)return;if(this.route==='lobby'&&!this.busy)void this.loadLobby(false,true);if((this.route==='tasks'||this.modal==='tasks')&&!this.busy)void this.loadTasks();if(this.route==='gallery'&&!this.busy)void this.loadGallery();if(this.route==='collection'&&!this.busy)void this.loadCollection();if(this.modal!=='social')void this.social.refresh();if(this.route==='room'&&this.modal!=='chat')void this.loadChat();},9000));
  this.timers.push(setInterval(()=>{if(this.destroyed||this.hidden||!this.ready||this.offlineRoom)return;if(this.modal==='social'||this.route==='friends'&&!this.modal)void this.social.refresh();else if(this.modal==='chat'||this.route==='room'&&this.layout==='desktop')void this.loadChat();},3000));
  this.timers.push(setInterval(()=>this.tickVisibleTime(),1000));
  this.invalidate();
  })().finally(()=>{if(epoch===this.privacyEpoch){this.startupPending=null;this.loginDialogActive=false;if(!this.destroyed)this.invalidate();}});
  return this.startupPending;
 }
 destroy(){this.destroyed=true;this.releaseComicBack();this.stopStoryFrame();this.finishOrientationOffer();this.platform.cancelShare?.();this.platform.cancelIdentity?.();this.pendingViews?.invalidate();this.cancelChatPress();this.social.destroy();this.leaveRoom();this.client.onChange=undefined;for(const timer of this.timers)clearInterval(timer);for(const cleanup of this.cleanups)cleanup();}
 private async loadInitialContent(query:Record<string,string>,epoch=this.privacyEpoch){
  if(this.destroyed||this.needsPrivacyChoice||epoch!==this.privacyEpoch)return;
  if(this.offlineRoom)return;
  await this.offerFirstOrientation();
  if(this.destroyed||this.needsPrivacyChoice||epoch!==this.privacyEpoch)return;
  query=this.startupQuery??query;this.startupQuery=null;
  const direct=/^[a-f0-9]{32}$/.test(query.room||query.roomId||'')||/^[a-zA-Z0-9-]{6,64}$/.test(query.invite||query.inviteCode||query.friend||query.ref||'');
  if(direct){this.autoLevelChecked=true;this.chapterEntryChecked=true;await this.handleQuery(query);}
  if(this.destroyed||this.needsPrivacyChoice||epoch!==this.privacyEpoch)return;
  const levels=this.loadLevels();
  // Gallery metadata must not hold up the lobby or an invited room's image.
  void this.loadGallery();
  if(this.route==='lobby'){void this.loadRoomHistory();await this.loadLobby();}
  if(!this.destroyed&&!this.needsPrivacyChoice&&epoch===this.privacyEpoch)void this.social.refresh().catch(()=>{});
  await levels;
  if(!direct&&!this.destroyed&&!this.needsPrivacyChoice&&epoch===this.privacyEpoch)await this.checkLevelEntry();
  this.invalidate();
 }
 resize(){
  const view=this.platform.viewport(),oldDesktop=this.layoutFor(this.stage.w,this.stage.h)==='desktop',newDesktop=this.layoutFor(view.width,view.height)==='desktop',rotated=(this.stage.w>this.stage.h)!==(view.width>view.height);
  this.cancelChatPress();this.clearRoomPointer();this.stage.input({type:'cancel',points:[],changed:[]});
  // A different layout needs a fresh fit; ordinary window resizing keeps the player's zoom.
  if(this.room&&(oldDesktop!==newDesktop||rotated))this.roomViewPending=true;
  this.invalidate();
 }
 private async handleQuery(query:Record<string,string>){
  if(this.orientationEntryPending)await this.orientationEntryPending;
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
  if(owner===this.listOwner)return;this.listOwner=owner;this.savedRoutes.clear();this.routeFrames=[];this.routeStack=[];this.roomReturn=null;this.roomReturnStack=[];this.roomReturnFrames=[];this.filterView=null;this.levels=null;this.levelsSerial=(this.levelsSerial??0)+1;this.autoLevelChecked=false;this.chapterEntryChecked=false;this.storyChapterId=null;
  this.restoreListView(this.defaultListView(this.route));this.taskTab='tasks';this.lobbySerial=(this.lobbySerial??0)+1;this.rooms=[];this.lobbyCursor=null;if(this.ready)void this.loadLevels().then(()=>this.checkLevelEntry());
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
 private refreshRoute(){if(this.offline?.active&&!this.ready||this.offlineRoom)return;if(this.route==='chapter')void this.loadLevels();if(this.route==='lobby'){void this.loadLevels();void this.loadLobby(false,!!this.rooms.length);if(!this.historyLoading)void this.loadRoomHistory();}if(this.route==='gallery'){void this.loadGallery();void this.loadCollection();}if(this.route==='tasks')void this.loadTasks();if(this.route==='collection')void this.loadCollection();if(this.route==='friends')void this.social.refresh();}
 private finishNavigation(){if(this.modal==='completion')this.showModal(null);else this.modal=null;this.filterView=null;this.toolsOpen=false;this.message='';if(this.route==='friends')void this.loadRecentPlayers();this.invalidate();this.refreshRoute();}
 private navigate(route:Route,context?:Partial<ListView>){
  if(this.offlineRoom||this.offline?.active&&!this.ready){this.note(OFFLINE_REQUIRED);return;}
  if(route==='supplies'&&(this.energyEnabled||this.usesCreationTickets)){this.supplyFocus=true;route='tasks';}
  if(this.formalWeb&&(route==='privacy'||route==='terms')){this.openWeb(route);return;}if(route==='tasks'&&this.floatingTasks&&this.route==='room'){this.showModal('tasks');return;}
  this.social.close();if(route!=='room')this.clearRoomPointer();const previous=this.saveListView();
  if(route!==this.route){if(route==='lobby'||route==='room'){this.routeStack=[];this.routeFrames=[];}else{this.routeStack.push(this.route);this.routeFrames.push(previous);}this.restoreListView(this.savedRoutes.get(route)??this.defaultListView(route));}
  if(context){const before=this.listViewKey();Object.assign(this,context);if(this.listViewKey()!==before){this.scroll=0;if(route==='gallery')this.selected=null;}}
  this.finishNavigation();
 }
 private back(){
  if(this.modal==='orientation'){this.confirmOrientation();return;}
  this.social.close();this.saveListView();const previous=this.routeStack.pop()??(this.room?'room':'lobby'),frame=this.routeFrames.pop(),route=previous==='room'&&!this.room?'lobby':previous;
  this.restoreListView(frame?.route===route?frame:this.savedRoutes.get(route)??this.defaultListView(route));this.finishNavigation();
 }
 private changeListView(change:()=>void){this.saveListView();const before=this.listViewKey();change();if(before!==this.listViewKey())this.scroll=0;this.invalidate();}
 private openCollection(tab:ListView['collectionTab']){this.navigate('collection',{collectionTab:tab});}
 private openPackGallery(id:string){this.navigate('gallery',{packId:id,source:'owned'});}
 private selectAlbum(id:string){this.changeListView(()=>{this.albumId=id;});}
 private exitRoom(){if(this.offlineRoom&&!this.ready){this.leaveRoom();this.roomReturn=null;this.roomReturnStack=[];this.roomReturnFrames=[];this.routeStack=[];this.routeFrames=[];this.enterOffline();return;}this.ensureListOwner();const level=this.offlineRoom?undefined:this.room?.snapshot.levelId,clear=this.room?.snapshot.mobileResult?.levelClear,complete=clear&&(clear.chapterComplete||clear.nextLevelId===null),nextLevelId=complete?clear?.nextLevelId:null,nextChapter=this.chapterForLevel(nextLevelId),target=this.roomReturn;if(nextLevelId)this.storyChapterId=nextChapter?.id??null;this.leaveRoom();this.roomReturn=null;this.routeStack=target?this.roomReturnStack:[];this.routeFrames=target?this.roomReturnFrames:[];this.roomReturnStack=[];this.roomReturnFrames=[];if(level){// Back to the story page while the played chapter still has unfinished levels, in any chapter.
const played=this.chapterForLevel(level),resume=!complete&&(played?played.levels.some(item=>item.status!=='cleared'):!!this.beginnerChapter);if(resume&&played)this.storyChapterId=played.id;this.navigate(nextLevelId||resume?'chapter':'lobby');}else if(target){this.restoreListView(target);this.finishNavigation();}else this.navigate('lobby');}
 private closeModal(){if(this.modal==='orientation'){this.confirmOrientation();return;}if(this.modal==='levelComic'){const back=this.comicPage?.returnTo;this.showModal(back&&this.room?'completion':null);return;}if(this.modal==='completion'&&(this.offlineRoom||this.room?.snapshot.levelId))this.exitRoom();else this.showModal(null);}
 private filterView:ListView|null=null;
 private finishFilters(){const changed=this.filterView&&this.listViewKey(this.filterView)!==this.listViewKey();if(changed){this.scroll=0;if(this.route==='lobby'){this.lobbySerial++;this.rooms=[];this.lobbyCursor=null;void this.loadLobby();}}this.filterView=null;}
 private clearRoomPointer(){this.cursor?.point(null);this.board?.input({type:'cancel',points:[],changed:[]});this.pointer=null;this.cursorVisible=false;}
 private showModal(modal:Modal){if(this.orientationEntryPending&&modal!=='orientation')return;if((this.offlineRoom||this.offline?.active&&!this.ready)&&modal&&!['orientation','completion','levelComic','tools','packPreview'].includes(modal)){this.note(OFFLINE_REQUIRED);return;}const previous=this.modal;if(modal!=='levelComic'){this.releaseComicBack();this.comicClosePress=null;this.comicGesture=null;this.comicPage=null;this.comicDrag=0;this.comicSnap=undefined;this.comicHintUntil=0;this.stopStoryFrame();}if(this.modal==='playerCard'&&modal!=='playerCard'){this.cardCode='';this.cardCache.clear();}this.cancelChatPress();this.stage.input({type:'cancel',points:[],changed:[]});if(modal)this.clearRoomPointer();if(this.modal==='social'&&modal!=='social')this.social.close();if(this.modal==='filters'&&modal!=='filters')this.finishFilters();if(modal==='filters'&&this.modal!=='filters')this.filterView=this.saveListView();if(this.modal==='packPreview'&&modal!=='packPreview')this.previewReadOnly=false;this.modal=modal;if(modal==='levelComic'&&previous!=='levelComic')this.comicBack=this.platform.onBack?.(()=>{if(this.modal!=='levelComic')return false;this.closeModal();return true;});this.cheer?.setActive(modal==='completion'||!!this.completionFx);if(modal!=='completion')this.stopCheers();this.modalScroll=modal==='chat'?Number.MAX_SAFE_INTEGER:0;this.modalExtent=0;if(modal==='social')this.social.open();if(modal==='chat'){this.chatSeen=this.chatCursor;void this.loadChat();}if(modal==='privacyRequests')void this.loadPrivacyRequests();if(modal==='history')void this.loadRoomHistory();if(modal==='manage')void this.client.refresh().catch(error=>this.note(errorText(error)));this.invalidate();if(modal==='invite'||modal==='tasks')void this.loadTasks();if(modal==='completion')this.setCompletionPhase('popup');else if(previous==='completion')this.setCompletionPhase('closed');}
 private get ownedRoomCount(){return (this.client.profile?.ownedRooms??[]).filter(room=>!room.completed).length;}
 private async loadRoomHistory(){
  if(this.offlineRoom||this.offline?.active&&!this.ready)return;
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
   const data=await this.client.json<{rooms:RoomListing[];nextCursor?:string|null;online?:number;dailyFinished?:number}>('/api/lobby?'+query);if(typeof data.online==='number')this.lobbyOnline=data.online;if(typeof data.dailyFinished==='number')this.dailyFinished=data.dailyFinished;if(serial!==this.lobbySerial||owner!==this.ownerKey()||this.destroyed)return;
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
 private async loadLevels(){
  if(this.offline?.active&&!this.ready)return;
  const owner=this.ownerKey(),serial=this.levelsSerial=(this.levelsSerial??0)+1;
  try{const data=await this.client.json<MobileLevelsView>('/api/levels');cacheServerLevels(this.platform.storage,data);if(this.destroyed||owner!==this.ownerKey()||serial!==this.levelsSerial)return;this.levels=data;this.levelsOwner=owner;this.invalidate();}
  catch{if(!this.destroyed&&owner===this.ownerKey()&&serial===this.levelsSerial){this.levels=null;this.invalidate();}}
 }
 /** Story selection and comic lookup share the active account/offline view. */
 private get storyView(){return this.offlineRoom||this.offline?.active&&!this.ready?this.offline.view:this.levelsOwner===this.ownerKey()?this.levels:null;}
 private get availableChapters(){return this.storyView?.chapters.filter(chapter=>chapter.status==='available')??[];}
 private selectChapter(view:MobileLevelsView|null){
  const chapters=view?.chapters.filter(chapter=>chapter.status==='available')??[];
  let chapter=chapters.find(chapter=>chapter.id===this.storyChapterId);
  if(!chapter){chapter=chapters.find(chapter=>chapter.levels.some(level=>level.id===view?.current?.id))??(!view?.current&&chapters.length&&chapters.every(chapter=>chapter.levels.every(level=>level.status==='cleared'))?chapters[chapters.length-1]:chapters[0]);this.storyChapterId=chapter?.id??null;}
  return chapter??null;
 }
 private get selectedChapter(){return this.selectChapter(this.storyView);}
 private chapterForLevel(levelId:string|null|undefined){return this.availableChapters.find(chapter=>chapter.levels.some(level=>level.id===levelId))??null;}
 private get comicChapter(){return this.chapterForLevel(this.comicPage?.levelId)??this.availableChapters.find(chapter=>chapter.id===this.comicPage?.chapterId)??null;}
 private levelPicture(level:MobileLevel){const photo=level.imageId?photoMap.get(level.imageId):undefined;return {src:photo?.src||level.src||photo?.thumbSrc||level.thumbSrc||'',thumbSrc:photo?.thumbSrc||level.thumbSrc||photo?.src||level.src||''};}
 /** A completion receipt unlocks the page immediately, before the next levels refresh. */
 private syncComicClear(chapter:MobileChapter){
  const clear=this.room?.snapshot.mobileResult?.levelClear;if(!clear)return;
  const level=chapter.levels.find(item=>item.id===clear.levelId);if(level)level.status='cleared';
  const next=this.chapterForLevel(clear.nextLevelId)?.levels.find(item=>item.id===clear.nextLevelId);if(next?.status==='locked')next.status='unlocked';
 }
 private comicReadKey(levelId:string){return this.ownerKey()+':'+levelId;}
 private comicLimit(chapter:MobileChapter){let count=0;for(const level of chapter.levels){if(level.status!=='cleared'||!comicFor(chapter,count,level))break;count++;}return count;}

 private get storyChapter(){
  if(this.levelsOwner!==this.ownerKey())return null;
  const chapter=this.levels?.chapters.find(item=>item.id==='ch1');return chapter?.status==='available'?chapter:null;
 }
 private get beginnerChapter(){const chapter=this.storyChapter;return chapter?.levels.some(level=>level.status!=='cleared')?chapter:null;}
 private chapterStorageKey(kind:'auto'){return 'jigsaw:level:'+kind+':v1:'+this.platform.config.apiBase+':'+this.ownerKey();}
 private async checkLevelEntry(){
  if(this.orientationEntryPending||this.chapterEntryChecked)return;this.chapterEntryChecked=true;
  if(await this.autoLaunchLevel())return;
  if(this.route==='lobby'&&!this.room&&!this.modal&&!this.busy&&this.beginnerChapter)this.navigate('chapter');
 }
 private async autoLaunchLevel(){
  if(this.autoLevelChecked)return;this.autoLevelChecked=true;
  if(this.route!=='lobby'||this.room||this.modal||this.busy||!this.ownerKey()||this.client.profile?.newcomer!==true||!this.beginnerChapter||this.levels?.chapters.some(chapter=>chapter.levels.some(level=>level.status==='cleared'))||this.beginnerChapter.levels.find(level=>level.id==='ch1-1')?.status!=='unlocked')return;
  try{const key=this.chapterStorageKey('auto');if(this.platform.storage.get(key)==='1')return;this.platform.storage.set(key,'1');}catch{return;}
  await this.launch({mode:'level',levelId:'ch1-1'});return true;
 }
 private changeDirection(value:Direction){if(value===this.direction)return;this.changeListView(()=>{this.direction=value;});if(this.route==='lobby'){this.lobbySerial++;this.rooms=[];this.lobbyCursor=null;void this.loadLobby();}}
 private async loadTasks(){try{await this.loadView('tasks',()=>this.client.json<MobileTaskView>('/api/mobile/tasks'),data=>{this.tasks=data;});}catch(error){if(!this.destroyed)this.note(errorText(error));}}
 private async loadCollection(){try{await this.loadView('collection',()=>this.client.json<MobileCollectionView>('/api/mobile/collection'),data=>{this.collection=data;});}catch(error){if(!this.destroyed)this.note(errorText(error));}}
 private async loadGallery(){try{await this.loadView('gallery',()=>this.client.json<{imageIds?:string[];accessibleImageIds?:string[];freeImageIds?:string[];packedImageIds:string[];photos?:SharedPhoto[];daily?:SharedPhoto|null;serverTime?:number}>('/api/mobile/gallery'),data=>{if(typeof data.serverTime==='number')this.serverOffset=data.serverTime-Date.now();if(data.daily?.id)this.dailyPhoto=data.daily;this.galleryIds=new Set(data.imageIds??data.accessibleImageIds??[]);this.packedIds=new Set(data.packedImageIds);this.freeGalleryIds=Array.isArray(data.freeImageIds)?new Set(data.freeImageIds):new Set([...this.galleryIds].filter(id=>!this.packedIds.has(id)));if(Array.isArray(data.photos)){this.sharedPhotos=data.photos.filter(photo=>!!photo&&typeof photo.id==='string'&&typeof photo.src==='string'&&typeof photo.thumbSrc==='string').map(photo=>({...photo,title:photo.title||photo.id,category:photo.category||'其他'}));for(const photo of this.sharedPhotos)photoMap.set(photo.id,photo);if(data.daily?.id)photoMap.set(data.daily.id,data.daily);}if(this.selected&&!this.galleryIds.has(this.selected))this.selected=null;});}catch(error){if(!this.destroyed)this.note(errorText(error));}}
 private availableGallery():SharedPhoto[]{if(this.sharedPhotos)return this.sharedPhotos.filter(photo=>!this.galleryIds||this.galleryIds.has(photo.id));if(!this.galleryIds)return GALLERY_PHOTOS;const baseIds=new Set(GALLERY_PHOTOS.map(photo=>photo.id));return [...GALLERY_PHOTOS,...RESTORABLE_PHOTOS.filter(photo=>!baseIds.has(photo.id))].filter(photo=>this.galleryIds!.has(photo.id));}
 private async launch(input:MobileRoomInput){
  if(this.offline?.active&&!this.ready){if(input.mode==='level')await this.run(()=>this.launchOffline({kind:'level',levelId:input.levelId!}));else this.note(OFFLINE_REQUIRED);return;}
  if(input.mode!=='level'&&!this.formalWeb&&this.ownedRoomCount>=3){this.showModal('manage');return;}
  await this.run(async()=>{
   const key='create:'+JSON.stringify(input),requestId=this.attempt(key);
   let ticket:RoomTicket;
   try{
    for(let retry=0;;retry++){
     try{ticket=await this.client.createRoom({...input,requestId});break;}
     catch(error){if(input.mode!=='level'||!isNetworkFailure(error)||retry>=2)throw error;await new Promise(resolve=>setTimeout(resolve,[800,2000][retry]));}
    }
   }catch(error){
    if(input.mode!=='level'||!isNetworkFailure(error)||!this.offline.catalog?.chapters.some(chapter=>chapter.levels.some(level=>level.id===input.levelId)))throw error;
    this.note('网络不可用，先离线拼，联网后自动同步通关');ticket=this.offline.createRoom({kind:'level',levelId:input.levelId!});
   }
   if(input.mode==='level'&&this.offline.server&&!this.offline.isRoom(ticket.room.id)&&preferOfflineLevelRoom(placedCount(ticket.room.puzzle),this.offline.server.rooms(),input.levelId!)){
    ticket=this.offline.createRoom({kind:'level',levelId:input.levelId!});this.note('继续你离线时拼的进度');
   }
   this.attempts.delete(key);await this.attachTicket(ticket);
  });
 }
 private async enterRoom(id:string,invite?:string){if(this.offlineRoom||this.offline?.active&&!this.ready){this.note(OFFLINE_REQUIRED);return;}await this.run(async()=>{const ticket=await this.client.joinRoom(id,invite);await this.attachTicket(ticket);});}
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
 private leaveRoom(){this.storyIntro=null;this.stopStoryFrame();this.clearCompletionTransition();this.cheer?.close();this.cheer=null;this.stopCheers();this.cursor?.stop();this.cursor=null;this.cursorVisible=false;this.detachRoom?.();this.unsubscribeRoom?.();this.room?.leave();this.realtime?.close();this.realtime=null;this.board?.destroy?.();this.detachRoom=null;this.unsubscribeRoom=null;this.setCompletionPhase('idle');this.room=null;this.board=null;this.aid=null;}
 private async attachTicket(ticket:RoomTicket){
  this.clearCompletionTransition();
  if(this.destroyed||this.needsPrivacyChoice||this.client.authRequired)return;
  const offline=this.offline?.isRoom(ticket.room.id)??false;
  this.social.close();
  const source=this.saveListView();if(source.route!=='room'){this.roomReturn=source;this.roomReturnStack=[...this.routeStack];this.roomReturnFrames=[...this.routeFrames];}
  this.leaveRoom();this.route='room';this.routeStack=[];this.routeFrames=[];this.scroll=0;this.modal=null;this.imageReady=false;this.roomViewPending=false;this.imageError='';this.messages=[];this.chatCursor=0;this.chatSeen=0;this.completedId='';this.chatBubble=null;this.bubbleSeen=-1;this.roomGuideStep=0;
  const realtime=offline?null:this.client.roomRealtime?.(ticket,()=>this.room?.snapshot.revision??ticket.room.revision)??null;this.realtime=realtime;
  const room=new RoomClient(ticket,{solo:offline?{enabled:()=>true,energy:()=>null}:{enabled:()=>this.client.config.capabilities.soloLocalPlay===true,storage:this.platform.storage,energy:()=>{const p=this.client.profile;if(!p)return null;return {enabled:this.client.config.capabilities.energy!==false,energy:p.energy,cap:p.energyCap,cost:p.economy?.contributionCost??1,xp:p.economy?.contributionXp??0,autoSupply:p.autoSupply===true,supplyEnergy:p.supply?.energy??0,free:p.economy?.firstRoomFree===true&&p.newcomer===true&&p.firstRoomId===ticket.room.id};}},fetch:offline?this.offline.server!.fetch:this.client.fetchLike,realtime:realtime??undefined,profile:offline?undefined:data=>{if(this.room===room)this.client.acceptRoomResponse(ticket,data);},refreshProfile:offline?undefined:async()=>{if(this.room===room)await this.client.refresh();},randomId:()=>this.platform.randomId(),hidden:()=>this.hidden,now:()=>Date.now(),performanceNow:()=>Date.now(),emit:(name,detail)=>{
   if(name==='room:rejoin-required'&&this.room===room&&!offline){this.note('正在重新连接房间，拼好的进度会保留');let tries=0;const rejoin=()=>{if(this.room!==room)return;if(this.busy&&++tries<20){setTimeout(rejoin,500);return;}void this.enterRoom(ticket.room.id);};rejoin();}
   if(name==='puzzle:successful-drop'&&this.room===room)this.board?.confirmMobileContribution(detail as MobileContributionReceipt);
   if(name==='mobile:profile')this.invalidate();
   if(name==='room:request-timing'&&this.room===room){const timing=detail as RoomRequestTiming;if(timing.action==='drop-start'){for(const key of ['drop','drop-queue','drop-total'])this.nineTimings.delete(key);}this.nineTimings.set(timing.action,timing);this.invalidate();}
   if(name==='mobile:gameplay-error')this.note((detail as {message?:string})?.message||'操作暂未完成');
   if(name==='mobile:energy-empty'){if(this.energyEnabled){this.note('体力不足，请使用礼包或补给');this.navigate('supplies');}else this.note('当前游戏规则需要重新连接，请返回大厅后再进入房间');}
  }});this.room=room;this.setCompletionPhase('idle');this.completionLive=!room.snapshot.completedAt;
  const board=new PuzzleBoard(this.platform,room.state,this.invalidate);this.board=board;if(room.snapshot.completedAt)board.completionReveal=1;board.setTheme(this.stage.theme);board.soundUrl='assets/audio/mobile-snap.wav';board.onNotice=message=>this.note(message);board.drawDecoration=(value,rect)=>this.stage.decoration(value,rect);board.selfDecoration=this.client.profile?.collection?.equipped??null;board.viewLocked=this.viewLocked;this.detachRoom=room.attach(board);
  if(!offline){const cursor=new CursorClient(ticket.room.id,ticket.token,ticket.playerId,cursors=>board.setCursors(cursors),()=>room.connected,()=>this.hidden||this.route!=='room'||this.modalBlocksInput,{retainUntilLeave:true,realtime:realtime??undefined,fetch:this.client.fetchLike,randomId:()=>this.platform.randomId(),now:()=>Date.now(),performanceNow:()=>Date.now(),subscribeVisibility:fn=>{const hide=this.platform.onHide(fn),show=this.platform.onShow(()=>fn());return()=>{hide();show();};}});this.cursor=cursor;board.onCursor=point=>cursor.point(point);cursor.start();realtime?.setHidden(this.hidden);realtime?.start();}
  this.cheer=this.cheersEnabled?new CheerClient({roomId:ticket.room.id,token:ticket.token,playerId:ticket.playerId,name:ticket.room.members.find(member=>member.id===ticket.playerId)?.name??this.client.profile?.name??'我',fetch:this.client.fetchLike,realtime,randomId:()=>{const id=this.platform.randomId().replace(/-/g,'').toLowerCase();return /^[a-f0-9]{32}$/.test(id)?id:Array.from({length:32},()=>Math.floor(Math.random()*16).toString(16)).join('');},onCheer:(cheer,own)=>this.receiveCheer(room,cheer,own)}):null;
  this.cheer?.setActive(this.modal==='completion');
  this.unsubscribeRoom=room.subscribe(()=>this.syncCompletion(room));
  const photo=activeRoomPhoto(ticket.room,photoMap.get(ticket.room.puzzle.imageId));this.roomImage=this.client.asset(ticket.room.customImage?customPhoto(ticket.room.customImage,ticket.room.id).src:photo?.src??'');
  this.beginStoryIntro((ticket.room as typeof ticket.room&{levelId?:string}).levelId);
  this.invalidate();if(this.nineGridRoom)board.setUnderlay(Date.now()+86400000);else if(!offline)void this.loadAssistance();
  try{if(!this.roomImage)throw Error('这张拼图的图片暂不可用');await board.setImage(this.roomImage);if(this.room!==room||this.board!==board)return;this.imageReady=board.imagePreparation.phase==='ready';this.roomViewPending=this.imageReady;}catch(error){if(this.room!==room||this.board!==board)return;this.imageError=errorText(error);this.note(this.imageError,true);}this.invalidate();
 }
 private syncCompletion(room:RoomClient){
  if(this.room!==room)return;const chapter=this.chapterForLevel(this.room.snapshot.levelId??this.room.snapshot.mobileResult?.levelClear?.levelId);if(chapter)this.syncComicClear(chapter);if(!room.snapshot.completedAt)this.completionLive=true;
  if(room.snapshot.completedAt&&this.completedId!==room.snapshot.id){this.completedId=room.snapshot.id;if(this.nineGridRoom)this.note('九格已拼好，可以重新摆放继续测试');else{if(this.offlineRoom){room.flushSoloNow();}else{void this.client.refresh().catch(()=>{});void this.loadCollection();}if(this.completionLive&&this.imageReady&&this.board)this.beginCompletionTransition();else{if(this.board)this.board.completionReveal=1;this.showModal('completion');}}}if(this.offlineRoom&&room.snapshot.completedAt)this.syncOffline();this.invalidate();
 }
 private clearCompletionTransition(){if(this.completionFxFrame!=null)this.platform.cancelFrame(this.completionFxFrame);this.completionFxFrame=null;this.completionFx=null;this.completionFxRect=null;this.completionCheerQueue=[];this.completionLive=false;this.settleButtonRect=null;}
 private beginCompletionTransition(){
  const board=this.board;if(!board)return;board.edgeOnly=false;board.trayOpen=false;this.clearRoomPointer();const from={...board.camera};this.fitRoom();const to={...board.camera};board.camera=from;this.completionFxRect={...board.rect};this.completionFx=new CompletionTransition(Date.now(),from,to,board.rect);this.cheer?.setActive(true);this.setCompletionPhase('transition');this.animateCompletion();
 }
 private animateCompletion(){
  if(this.completionFxFrame!==null||!this.completionFx||this.hidden||this.destroyed)return;
  this.completionFxFrame=this.platform.frame(()=>{this.completionFxFrame=null;const fx=this.completionFx,board=this.board;if(!fx||!board||this.hidden||this.destroyed)return;const now=Date.now(),r=board.rect,old=this.completionFxRect;
   if(!old||r.x!==old.x||r.y!==old.y||r.w!==old.w||r.h!==old.h){this.fitRoom();fx.dropCamera();this.completionFxRect={...r};}else{const camera=fx.camera(now);if(camera)board.camera={...camera};}
   board.completionReveal=fx.seam(now);board.completionSweep=fx.sweep(now);if(fx.celebrateDue(now))try{this.platform.playSound?.('assets/audio/mobile-coin.wav');}catch{}
   if(fx.popupDue(now)){this.finishCompletionTransition();return;}this.invalidate();this.animateCompletion();
  });
 }
 private finishCompletionTransition(){
  const fx=this.completionFx,board=this.board;if(!fx||!board)return;const now=Date.now(),camera=fx.cameraDropped?null:fx.to;if(camera)board.camera={...camera};board.completionReveal=1;board.completionSweep=null;if(this.completionFxFrame!==null)this.platform.cancelFrame(this.completionFxFrame);this.completionFxFrame=null;this.completionFx=null;this.completionFxRect=null;this.showModal('completion');for(const item of this.completionCheerQueue)if(now-item.at<2700)this.cheerEffects.receive(item.cheer,item.own,item.at);this.completionCheerQueue=[];if(this.cheerEffects.alive())this.animateCheers();
 }
 private receiveCheer(room:RoomClient,cheer:Cheer,own:boolean){if(this.room!==room)return;if(this.completionFx){this.completionCheerQueue.push({cheer,own,at:Date.now()});this.completionCheerQueue=this.completionCheerQueue.slice(-60);return;}if(this.modal!=='completion')return;this.cheerEffects.receive(cheer,own);this.animateCheers();}
 private async loadAssistance(){if(!this.room||this.offlineRoom)return;try{const room=this.room;const data=await this.client.json<typeof this.aid>('/api/rooms/'+room.ticket.room.id+'/assistance','GET',undefined,{Authorization:'Bearer '+room.ticket.token});if(this.room!==room)return;if(data){const offset=Date.now()-data.serverTime;data.grants=data.grants.map(grant=>({...grant,expiresAt:grant.expiresAt+offset}));this.aid=data;this.applyAssistance();}}catch(error){this.note(errorText(error));}}
 private activeAid(kind:'hint'|'underlay'){const grants=this.aid?.grants??[],now=Date.now();for(let i=grants.length-1;i>=0;i--)if(grants[i].kind===kind&&grants[i].expiresAt>now)return grants[i];return undefined;}
 private applyAssistance(){
  const board=this.board;if(!board)return;const underlay=this.activeAid('underlay'),hint=this.activeAid('hint');board.setUnderlay?.(underlay?.expiresAt??0);
  const activated=board.setHints?.(hint?.pieceIds??[],hint?.expiresAt??0,hint?.requestId);
  if(activated)board.locateHints(this.roomLocateInsets());this.invalidate();
 }
 private showShareFailureDiagnostic(){if(this.platform.config.id==='taptap'&&this.client.profile?.taptap?.diagnostics===true)this.platform.alert('分享诊断（仅管理员）\n'+(this.platform.shareDiagnostics?.()??'当前包未提供诊断'));}
 private async shareFromGame(input:Parameters<Platform['share']>[0]){
  if(this.offlineRoom||this.offline?.active&&!this.ready){this.note(OFFLINE_REQUIRED);return 'unavailable' as const;}
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
  if(this.offlineRoom){this.note(OFFLINE_REQUIRED);return;}
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
 private async loadChat(){if(this.offlineRoom)return;
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
  this.privacyEpoch++;this.finishOrientationOffer();this.platform.cancelIdentity?.();this.startupPending=null;this.pendingViews?.invalidate();this.lobbySerial++;this.lobbyReload=false;
  this.leaveRoom();for(const timer of this.timers)clearInterval(timer);this.timers=[];for(const off of this.cleanups)off();this.cleanups=[];this.social.close();this.client.onChange=undefined;
  this.startupHooks=false;this.identityHook=false;this.consentPreparing=false;this.ready=false;this.modal=null;this.route='lobby';this.pointer=null;this.privacyAccepted=false;this.privacyDocument=null;this.privacyRefused=true;this.loginDialogActive=false;this.scroll=0;
  try{this.platform.storage.remove(MOBILE_PRIVACY_CONSENT_KEY);}catch{}this.invalidate();
 }
 private prepareConsentButton(){
  if(this.platform.config.id!=='taptap'||!this.platform.prepareTapConsent||this.consentPreparing||this.privacyRefused)return;
  this.consentPreparing=true;this.consentError='';this.authorizationNudged=false;this.platform.setIdentityButtonVisible?.(!this.privacyDocument);
  this.platform.loginLog?.add('登录弹窗显示 · '+(this.platform.tapAuthorizationDebug?.()??''));
  this.platform.prepareTapConsent(()=>{if(this.destroyed)return;this.consentPreparing=false;this.acceptPrivacy();},error=>{if(this.destroyed)return;this.consentPreparing=false;this.consentError=errorText(error);this.invalidate();});
 }
 /** 玩家已点“同意并登录”，但TapTap登录无法完成：这次点击即为同意隐私协议，以游客身份进入，下次启动再尝试TapTap。 */
 private enterAsTapGuest(reason:string){
  if(this.destroyed||this.privacyRefused||!this.needsPrivacyChoice||this.platform.config.id!=='taptap')return;
  this.platform.loginLog?.add('转入游客模式 · '+reason);this.client.tapGuestRequested=true;this.consentPreparing=false;this.authorizationNudged=false;this.platform.cancelIdentity?.();this.acceptPrivacy();
 }
 /** 此客户端没有昵称接口（TapTap PC）：这次点击即同意协议，登录凭证在点击之后才获取，只用它绑定账号；失败再转游客。 */
 private acceptLoginOnly(){
  if(this.destroyed||this.privacyRefused||!this.needsPrivacyChoice||this.platform.config.id!=='taptap')return;
  this.platform.loginLog?.add('同意并登录 · 昵称接口不可用，改为仅登录绑定');this.consentPreparing=false;this.authorizationNudged=false;this.acceptPrivacy();
 }
 private openLoginLog(){this.loginLogReturnScroll=this.scroll;this.scroll=0;this.loginLogOpen=true;this.pointer=null;this.platform.setIdentityButtonVisible?.(false);this.invalidate();}
 private closeLoginLog(){this.loginLogOpen=false;this.scroll=this.loginLogReturnScroll;this.pointer=null;this.platform.setIdentityButtonVisible?.(true);this.invalidate();}
 private async copyLoginLog(){
  const text=['拼图小窝 登录日志 '+(this.platform.config.buildVersion??''),...(this.platform.loginLog?.lines()??[]),'当前 · '+(this.platform.tapAuthorizationDebug?.()??'')].join('\n');
  const copied=await (this.platform.copyText?.(text)??Promise.resolve(false)).catch(()=>false);this.note(copied?'登录日志已复制':'复制失败，请截图发送');
 }
 private drawLoginLog(){
  const s=this.stage,v=this.platform.viewport(),w=Math.min(640,s.w-24),x=(s.w-w)/2,top=v.top+12,bottom=s.h-v.bottom-12;
  // 面板盖住登录弹窗时，透明原生按钮不能留在上面。
  this.platform.setIdentityButtonVisible?.(false);
  s.panel({x,y:top,w,h:bottom-top});
  s.text('登录日志',x+16,top+16,19,this.colors.ink,800,w-32);
  this.bodyTop=top+54;this.bodyBottom=bottom-70;this.listArea={x:x+15,y:this.bodyTop,w:w-30,h:Math.max(30,this.bodyBottom-this.bodyTop)};this.sceneArea={...this.listArea};
  const lines=this.platform.loginLog?.lines()??[];let y=this.bodyTop-this.scroll;
  s.clip(this.listArea,()=>{if(!lines.length)y=this.paragraph('暂无记录。',x+18,y,w-36,12)+6;for(const line of lines)y=this.paragraph(line,x+18,y,w-36,11,this.colors.ink)+5;y=this.paragraph('当前 · '+(this.platform.tapAuthorizationDebug?.()??''),x+18,y+4,w-36,11)+6;});
  this.extent=y-(this.bodyTop-this.scroll);this.scroll=clamp(this.scroll,0,Math.max(0,this.extent-this.listArea.h));
  const gap=8,half=(w-32-gap)/2;
  s.button({x:x+16,y:bottom-54,w:half,h:38},'关闭',()=>this.closeLoginLog(),{fontSize:12});
  s.button({x:x+24+half,y:bottom-54,w:half,h:38},'复制',()=>void this.copyLoginLog(),{fontSize:13,tone:'berrydark'});
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
   if(combined||waiting)this.paragraph(waiting&&this.authorizationNudged?'登录按钮已重新准备，请再点一次“同意并登录”；仍无反应将以游客身份进入。':!this.needsPrivacyChoice&&!waiting?'正在登录TapTap，已有进度会保留。':this.consentError&&!this.privacyRefused?(this.platform.tapNicknameUnavailable?.()?'此客户端不支持昵称授权，点“同意并登录”直接用TapTap账号登录。':'TapTap登录暂不可用，点“同意并登录”将以游客身份进入，进度会保留。'):'同时授权TapTap昵称，用于显示玩家名称。',x+20,top+78,w-40,11);
   // 登录日志入口放在面板右上角，远离透明原生按钮所在的右下按钮。
   if(this.platform.config.id==='taptap'&&this.platform.loginLog){const label='登录日志',width=s.measure(label,11),lx=x+w-16-width,ly=top+12;s.text(label,lx,ly,11,this.colors.berry,700);s.ctx.fillStyle=this.colors.berry;s.ctx.fillRect(lx,ly+15,width,1);s.hit({x:lx-8,y:ly-8,w:width+16,h:30},()=>this.openLoginLog());}
  }
  const gap=8,half=(w-32-gap)/2,back=()=>{this.privacyDocument=null;this.scroll=0;this.platform.setIdentityButtonVisible?.(true);this.invalidate();};
  s.button({x:x+16,y:bottom-54,w:half,h:38},detail?'返回':this.needsPrivacyChoice?'暂不同意':'取消登录',()=>{if(detail){back();return;}this.privacyRefused=true;this.platform.cancelIdentity?.();this.invalidate();},{fontSize:12});
  const right={x:x+24+half,y:bottom-54,w:half,h:38};
  if(detail&&combined){s.button(right,'返回登录',back,{fontSize:13,tone:'berrydark'});return;}
  if(!detail&&(waiting||combined)){
   if(waiting){s.frame(right,'button-berrydark-normal');s.text('同意并登录',right.x+(right.w-s.measure('同意并登录',13,750))/2,right.y+11,13,this.colors.onAccent,750);
    // 原生透明按钮应先接住这次点击；画布收到说明它没对准或未就绪，重建后请玩家再点一次。
    // 第一次：在这次点击内同步重建原生按钮；第二次仍落到画布：以游客身份进入。
    s.hit(right,()=>{this.platform.loginLog?.add('画布接到“同意并登录”点击（原生按钮未接住）· '+(this.platform.tapAuthorizationDebug?.()??''));if(!this.authorizationNudged){this.authorizationNudged=true;this.platform.retryTapAuthorizationButton?.();}else this.enterAsTapGuest('原生按钮两次未接住点击');this.invalidate();});}
   else if(this.consentPreparing||!this.needsPrivacyChoice)s.button(right,'正在连接…',()=>{},{fontSize:13,tone:'berrydark',disabled:true});
   else if(this.privacyRefused)s.button(right,'重新连接',()=>{this.privacyRefused=false;this.prepareConsentButton();this.invalidate();},{fontSize:13,tone:'berrydark'});
   else s.button(right,'同意并登录',()=>{if(this.platform.tapNicknameUnavailable?.())this.acceptLoginOnly();else this.enterAsTapGuest('TapTap登录准备失败');},{fontSize:13,tone:'berrydark'});
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
  this.settingsTipAnchor=null;this.settingsTipDrawn=false;
  const s=this.stage;if(this.route==='room'){s.ctx.fillStyle=boardThemeColors(s.theme).paper;s.ctx.fillRect(0,0,s.w,s.h);}else s.background();
  if(this.loginLogOpen){this.drawLoginLog();return;}
  if(this.needsPrivacyChoice||this.loginDialogActive||this.platform.tapAuthorizationPending?.()){this.drawPrivacyChoice();return;}
  if(!this.ready&&!this.startupError&&!this.client.authRequired&&!this.offline?.active&&!this.offlineRoom){this.drawLoading();return;}
  this.sceneArea={x:0,y:0,w:s.w,h:s.h};this.listArea={...this.sceneArea};this.listColumn=null;this.albumListArea={x:0,y:0,w:0,h:0};
  this.bodyBottom=s.h-this.platform.viewport().bottom-12;
  if(this.route==='room')this.drawRoom();
  else if(this.offline?.active&&!this.ready){this.bodyTop=this.platform.viewport().top+12;this.extent=this.offline.drawPage(s,this.scroll,{paragraph:(...args)=>this.paragraph(...args),selectedChapter:view=>this.selectChapter(view),chapter:(chapter,view,height)=>{const top=this.bodyTop,bottom=this.bodyBottom,scroll=this.scroll;this.bodyTop=0;this.bodyBottom=height;this.scroll=0;this.drawChapter(chapter,view);this.bodyTop=top;this.bodyBottom=bottom;this.scroll=scroll;},asset:src=>this.client.asset(src),reconnect:()=>{this.offline.active=false;void this.start();},launch:input=>void this.run(()=>this.launchOffline(input)),invalidate:this.invalidate});this.clampListScroll();}
  else if(this.desktop){if(this.ready)this.drawDesktopShell();else s.withoutInput(()=>this.drawDesktopShell());const area=this.sceneArea;if(this.route==='collection'){const width=Math.min(contentMaxWidth+24,area.w);area.x+=(area.w-width)/2;area.w=width;this.listArea={...area};}this.contentOrigin={x:area.x,y:area.y};s.withViewport(area,()=>{this.bodyTop=12;this.bodyBottom=s.h-12;this.drawScene();});this.bodyTop+=area.y;this.bodyBottom+=area.y;this.listArea={x:this.lobbyColumn()?.x??(this.listArea.x||area.x),y:this.bodyTop,w:this.lobbyColumn()?.w??(this.listArea.w||area.w),h:Math.max(0,this.bodyBottom-this.bodyTop)};}
  else{
   const layout=this.layout,rail=this.navVisible&&layout==='phoneLandscape',bar=this.navVisible&&layout==='phonePortrait',outer={x:rail?72:0,y:0,w:s.w-(rail?72:0),h:s.h-(bar?64:0)};
   if(rail)this.drawNavRail();
   // The page draws in local coordinates beside the rail or above the tab bar; hits stay in screen space.
   const page=()=>{this.bodyBottom=s.h-this.platform.viewport().bottom-12;if(this.ready)this.drawHeader();else s.withoutInput(()=>this.drawHeader());const width=this.route==='collection'?Math.min(contentMaxWidth+24,s.w):s.w,x=(s.w-width)/2,local={x,y:0,w:width,h:s.h};this.sceneArea={...local,x:outer.x+x};this.contentOrigin={x:outer.x+x,y:0};if(x)s.withViewport(local,()=>this.drawScene());else this.drawScene();this.listArea={x:this.lobbyColumn()?.x??outer.x+x,y:this.bodyTop,w:this.lobbyColumn()?.w??width,h:Math.max(0,this.bodyBottom-this.bodyTop)};};
   if(rail||bar)s.withViewport(outer,page);else page();
   if(bar)this.drawTabBar();
  }
  this.drawSettingsTip();
  if(this.modal)this.drawModal();
  if(this.message&&Date.now()<=this.messageUntil)this.drawNotice();
  if(this.busy){const cancel=this.sharing&&!!this.platform.cancelShare,label=cancel?'等待分享 · 取消等待':'正在处理…',width=cancel?184:144,r={x:(s.w-width)/2,y:Math.max(this.platform.viewport().top+6,this.platform.config.id==='taptap'?44:0),w:width,h:28};s.panel(r,'cream');s.text(label,r.x+(width-s.measure(label,12))/2,r.y+6,12,this.colors.ink);if(cancel)s.hit(r,()=>this.platform.cancelShare?.());}
 }
 private drawScene(){if(!this.ready){this.drawLobbyStartup();return;}switch(this.route){case'lobby':this.drawLobby();break;case'chapter':this.drawChapter();break;case'gallery':this.drawGallery();break;case'tasks':this.drawTasksPage();break;case'supplies':this.drawSupplies();break;case'collection':this.drawCollection();break;case'friends':this.drawFriends();break;default:this.drawPolicy();}this.clampListScroll();}
 private drawDesktopShell(){
  const s=this.stage,p=this.client.profile,nav=200,header=84,ink=this.colors.ink;
  s.panel({x:10,y:10,w:nav-10,h:s.h-20});
  // Profile: the avatar art carries its own pixel frame.
  s.hit({x:18,y:18,w:nav-26,h:96},()=>this.showModal('settings'));
  s.icon('avatar',{x:24,y:26,w:44,h:48});s.text(p?.name??'读取玩家信息…',76,29,16,ink,800,nav-88);s.text(p?'Lv.'+p.level:'—',76,53,12,this.levelColor(p?.level??1),700,40);s.meter({x:116,y:57,w:nav-130,h:6},(p?.xp??0)/Math.max(1,p?.xpToNext??1));
  this.drawSettingsBadge({x:24,y:26,w:44,h:48});
  const cy=88;if(this.energyEnabled){s.icon('lightning',{x:24,y:cy-2,w:17,h:24});const label=p?p.energy+'/'+p.energyCap:'—/—',tw=s.measure(label,14,800);s.text(label,45,cy+2,14,ink,800,70);s.button({x:49+tw,y:cy,w:20,h:20},'',()=>this.navigate('supplies'),{tone:'gold'});s.text('+',54+tw,cy+1,16,'#fffaf0',700);}
  else{s.icon('coin',{x:24,y:cy,w:19,h:21});s.text(p?(p.collection?.coins??0):'—',47,cy+3,14,ink,800,56);s.hit({x:20,y:cy-4,w:84,h:28},()=>this.showModal('coins'));}
  s.icon('fragment',{x:112,y:cy,w:19,h:21});s.text(p?(p.collection?.fragments??0):'—',135,cy+3,14,ink,800,nav-147);s.hit({x:108,y:cy-4,w:nav-118,h:28},()=>this.showModal('fragments'));
  s.ctx.fillStyle=this.colors.line;s.ctx.fillRect(22,122,nav-34,1);
  const item=(y:number,label:string,icon:string,selected:boolean,action:()=>void,route?:Route)=>{const r={x:20,y,w:nav-30,h:48};if(selected)s.frame(r,'button-cream-selected');s.icon(icon,{x:r.x+14,y:y+12,w:24,h:24});s.text(label,r.x+48,y+16,15,ink,selected?800:700,r.w-56);if(route)this.navBadge(route,r.x+40,y+12);s.hit(r,action);};
  this.navItems.forEach(([route,label,icon],index)=>item(134+index*52,label,icon,this.route===route,()=>this.openTab(route),route));
  item(s.h-(this.formalWeb?104:72),'设置','tools',false,()=>this.showModal('settings'));
  if(this.formalWeb)this.drawWebLinks(23,s.h-38,nav-44);
  const x=nav+16,w=s.w-x-20,title=this.route==='lobby'?'大厅':this.route==='chapter'?'小窝的故事':this.route==='gallery'?'挑一幅喜欢的画':this.route==='tasks'?'每一次拼合，都有小收获':this.route==='collection'?'收藏属于你的美好':this.route==='friends'?'和朋友一起拼':this.route==='supplies'?'补给站':'慢慢拼，慢慢了解';
  if(this.route==='tasks')s.button({x,y:20,w:32,h:34},'',()=>this.back(),{icon:'back'});
  s.text(title,x+(this.route==='tasks'?44:4),25,24,ink,800,w-(this.route==='tasks'?48:this.route==='lobby'?84:8));s.text(this.pageSubtitle,x+5,58,12,this.colors.muted,500,w-8);
  if(this.route==='lobby')this.drawLobbyTasks({x:x+w-64,y:20,w:64,h:40});
  s.ctx.fillStyle=this.colors.line;s.ctx.fillRect(x,header-4,w,1);this.sceneArea={x,y:header,w,h:s.h-header-12};this.listArea={x,y:header,w,h:s.h-header-12};
 }
 private get pageSubtitle(){switch(this.route){case'lobby':{const count=this.lobbyRooms.length,online=this.lobbyOnline?' · '+this.lobbyOnline+' 位拼友在线':'';return (count?(this.lobbyCursor?count+'+':count)+' 桌正在拼':'今天，拼一会儿')+online;}case'gallery':return '选好图片和片数，就能开一桌';case'collection':return '拼完一张图就收进图集，集满有奖励';case'tasks':return '拼合攒礼包，邀请得奖励';case'friends':return '加好友、私聊、一起拼';case'supplies':return '体力与建房券';default:return '慢慢拼，慢慢了解';}}
 private friendsTab:'friends'|'messages'|'requests'='friends';private recentPlayers:RecentPlayer[]=[];
 private async loadRecentPlayers(){try{const data=await this.client.json<{players:RecentPlayer[]}>('/api/mobile/social/recent');this.recentPlayers=Array.isArray(data.players)?data.players:[];this.invalidate();}catch{}}
 private ago(at:number){const minutes=Math.max(1,Math.round((Date.now()-at)/60000));return minutes<60?minutes+' 分钟前':minutes<1440?Math.round(minutes/60)+' 小时前':Math.round(minutes/1440)+' 天前';}
 private async requestFriend(code:string){await this.run(async()=>{await this.client.post('/api/mobile/social/requests',{code,requestId:this.platform.randomId()});await this.social.refresh();await this.loadRecentPlayers();this.note('好友申请已发送');});}
 private async respondFriend(code:string,accept:boolean){await this.run(async()=>{await this.client.post('/api/mobile/social/requests/respond',{code,accept,requestId:this.platform.randomId()});await this.social.refresh();this.note(accept?'已成为好友':'已忽略申请');});}
 private openConversation(code:string){this.showModal('social');this.social.openConversation(code);}
 private drawFriends(){
  const s=this.stage,data=this.social.state,desktop=this.desktop,pad=12,w=s.w-24,ink=this.colors.ink,muted=this.colors.muted,sideW=desktop?Math.min(340,w*.36):w,listW=desktop?w-sideW-16:w;
  const friends=data?.friends??[],incoming=data?.requests.incoming??[],outgoing=data?.requests.outgoing??[],conversations=data?.conversations??[],messages=this.client.config?.capabilities?.social?.privateMessages===true||this.client.config?.capabilities?.social?.privateMessageHistory===true;
  let y=this.bodyTop-this.scroll,side=desktop?this.bodyTop-this.scroll:0;
  const row=(r:Rect)=>{s.frame(r,'button-linen-normal');};
  this.scrolled(()=>{
   const tabs:[typeof this.friendsTab,string][]=[['friends','好友 '+friends.length],...(messages?[['messages','消息'] as [typeof this.friendsTab,string]]:[]),['requests','好友申请']];
   y=this.drawChips(pad,y,Math.min(listW,360),34,tabs.map(([id,label])=>[label,this.friendsTab===id,()=>{this.friendsTab=id;this.scroll=0;this.invalidate();}] as const));
   const unread=this.social.unread,requests=incoming.length,tw=Math.min(listW,360);if(requests){const x=pad+tw-18;s.frame({x,y:y-42,w:20,h:18},'segment-berry-selected');s.text(String(Math.min(99,requests)),x+5,y-40,11,this.colors.onAccent,700);}
   if(unread&&messages){const x=pad+tw/3*2-18;s.frame({x,y:y-42,w:20,h:18},'segment-berry-selected');s.text(String(Math.min(99,unread)),x+5,y-40,11,this.colors.onAccent,700);}
   y+=14;
   if(!data){s.text('正在读取好友…',pad+8,y+12,14,muted);y+=60;}
   else if(this.friendsTab==='friends'){
    if(!friends.length){s.icon('friendArt',{x:pad+(listW-70)/2,y,w:70,h:66});const t='认识一位拼友吧';s.text(t,pad+(listW-s.measure(t,16,800))/2,y+76,16,ink,800);const h='按玩家 ID 添加，或在最近同桌里加好友';s.text(h,pad+(listW-s.measure(h,12,600))/2,y+102,12,muted,600,listW);y+=136;}
    for(const friend of friends){const r={x:pad,y,w:listW,h:72};row(r);s.icon('avatar',{x:pad+10,y:y+12,w:44,h:48});s.text(friend.name,pad+64,y+12,15,ink,800,listW-260);s.text('Lv.'+friend.level,pad+64+Math.min(listW-260,s.measure(friend.name,15,800))+8,y+15,12,muted,700);
     const room=friend.room,status=friend.online?room?'正在拼「'+room.title+'」'+(typeof room.players==='number'?' · '+room.players+'/'+seatLimit(room):''):'在大厅':friend.lastSeenAt?this.ago(friend.lastSeenAt)+'在线':'很久没上线';if(friend.online){s.ctx.fillStyle=s.color('#879864');s.ctx.fillRect(pad+50,y+52,8,8);}
     s.text(status,pad+64,y+38,12,friend.online?ink:muted,600,listW-260);let bx=pad+listW-82;s.button({x:bx,y:y+19,w:72,h:34},'私信',()=>this.openConversation(friend.code),{fontSize:13});
     if(friend.online&&room&&room.visibility!=='private'){bx-=104;s.button({x:bx,y:y+19,w:96,h:34},'加入这桌',()=>void this.enterRoom(room.id),{tone:'berry',fontSize:13,disabled:this.busy});}else if(friend.online){bx-=104;s.button({x:bx,y:y+19,w:96,h:34},'邀请来拼',()=>this.openConversation(friend.code),{tone:'berry',fontSize:13});}
     y+=80;}
   }else if(this.friendsTab==='messages'){
    if(!conversations.length){s.text('还没有私聊，点好友的“私信”开始',pad+8,y+12,14,muted,600,listW);y+=50;}
    for(const item of conversations){const r={x:pad,y,w:listW,h:66};row(r);s.icon('avatar',{x:pad+10,y:y+10,w:40,h:44});s.text(item.peer.name,pad+60,y+10,15,ink,800,listW-150);const last=item.lastMessage,text=last.kind==='room-invite'?'邀请你一起拼「'+(last.title??'拼图')+'」':last.text??'';s.text((last.mine?'我：':'')+text,pad+60,y+36,12,muted,600,listW-150);s.text(this.ago(last.sentAt),pad+listW-80,y+12,11,muted,600,70);
     if(item.unread){s.frame({x:pad+listW-36,y:y+34,w:22,h:18},'segment-berry-selected');s.text(String(Math.min(99,item.unread)),pad+listW-30,y+36,11,this.colors.onAccent,700);}s.hit(r,()=>this.openConversation(item.peer.code));y+=74;}
   }else{
    if(!incoming.length&&!outgoing.length){s.text('没有待处理的好友申请',pad+8,y+12,14,muted,600,listW);y+=50;}
    for(const peer of incoming){const r={x:pad,y,w:listW,h:66};row(r);s.icon('avatar',{x:pad+10,y:y+10,w:40,h:44});s.text(peer.name,pad+60,y+10,15,ink,800,listW-240);s.text('Lv.'+peer.level+' · 想加你为好友',pad+60,y+36,12,muted,600,listW-240);
     s.button({x:pad+listW-166,y:y+16,w:76,h:34},'接受',()=>void this.respondFriend(peer.code,true),{tone:'berry',fontSize:13,disabled:this.busy});s.button({x:pad+listW-84,y:y+16,w:74,h:34},'忽略',()=>void this.respondFriend(peer.code,false),{fontSize:13,disabled:this.busy});y+=74;}
    for(const peer of outgoing){const r={x:pad,y,w:listW,h:58};row(r);s.icon('avatar',{x:pad+10,y:y+8,w:36,h:40});s.text(peer.name,pad+56,y+10,14,ink,800,listW-150);s.text('已发送申请，等待对方确认',pad+56,y+32,12,muted,600,listW-150);y+=66;}
   }
   // 加好友 and 最近同桌: a right column on desktop, below the list on phones.
   const sx=desktop?pad+listW+16:pad;let sy=desktop?side:y+8;
   const add={x:sx,y:sy,w:sideW,h:128};s.panel(add);s.text('加好友',sx+16,sy+14,16,ink,800);s.button({x:sx+16,y:sy+42,w:sideW-32,h:38},'按玩家 ID 添加',()=>{this.showModal('social');this.social.startSearch();},{tone:'berry',icon:'plus',fontSize:14});
   const code=data?.self.code??this.client.profile?.code??'';s.text('我的 ID '+(code||'…'),sx+16,sy+94,13,muted,700,sideW-110);if(code&&this.platform.copyText){s.button({x:sx+sideW-80,y:sy+86,w:64,h:30},'复制',()=>void this.platform.copyText!(code).then(ok=>this.note(ok?'已复制玩家 ID':'复制失败')),{fontSize:12});}
   sy+=140;const recent=this.recentPlayers,rh=50+Math.max(1,recent.length)*58;s.panel({x:sx,y:sy,w:sideW,h:rh});s.text('最近同桌',sx+16,sy+14,16,ink,800);let ry=sy+46;
   if(!recent.length){s.text('一起拼过的人会出现在这里',sx+16,ry+4,12,muted,600,sideW-32);}
   for(const peer of recent){s.icon('avatar',{x:sx+14,y:ry,w:34,h:38});s.text(peer.name,sx+56,ry+2,14,ink,800,sideW-150);s.text('一起拼过「'+peer.roomTitle+'」· '+this.ago(peer.seenAt),sx+56,ry+22,11,muted,600,sideW-150);s.button({x:sx+sideW-88,y:ry+4,w:74,h:32},peer.requested?'已申请':'加好友',()=>void this.requestFriend(peer.code),{fontSize:12,disabled:peer.requested||this.busy});ry+=58;}
   sy+=rh+12;if(!desktop)y=sy;else side=sy;
  });
  this.extent=Math.max(y,desktop?side:0)+this.scroll-this.bodyTop+12;
 }
 private loadingStarted=0;private loadingShown=0;
 /** Full-screen start-up: logo, progress and rotating tips. Progress follows the real steps and eases in between. */
 private drawLoading(){
  const s=this.stage,now=Date.now(),v=this.platform.viewport(),ink=this.colors.ink,muted=this.colors.muted;if(!this.loadingStarted)this.loadingStarted=now;
  const elapsed=(now-this.loadingStarted)/1000,target=this.client.profile?.97:.7,progress=Math.max(this.loadingShown,target*(1-Math.exp(-elapsed/1.4)));this.loadingShown=progress;
  const glow=s.ctx.createRadialGradient(s.w/2,s.h*.42,0,s.w/2,s.h*.42,Math.max(s.w,s.h)*.7);glow.addColorStop(0,this.colors.cream);glow.addColorStop(1,this.colors.paper);s.ctx.fillStyle=glow;s.ctx.fillRect(0,0,s.w,s.h);
  const cx=s.w/2,size=Math.min(112,s.w*.26,s.h*.2),top=Math.max(v.top+16,s.h*.42-size-60);
  s.icon('piece',{x:cx-size/2,y:top,w:size,h:size});
  const name=this.platform.config.gameName||'拼图小窝',nameSize=Math.min(34,s.w/9);s.text(name,cx-s.measure(name,nameSize,800)/2,top+size+18,nameSize,ink,800);
  const slogan='和朋友一起拼拼拼';s.text(slogan,cx-s.measure(slogan,15,600)/2,top+size+nameSize+30,15,muted,600);
  const barW=Math.min(320,s.w-64),barY=top+size+nameSize+76;s.meter({x:cx-barW/2,y:barY,w:barW,h:10},progress);const percent=Math.round(progress*100)+'%';s.text(percent,cx-s.measure(percent,13,700)/2,barY+18,13,ink,700);
  const tips=['先把边缘拼好，框架出来就快多了','双指缩放，拖空白处可以移动桌面','拼完的图会自动收进图集','公开房免费，叫上朋友一起拼','卡住的时候，试试提示和底图','每天都有一张新的每日拼图','集齐一个图包，有金币和装饰'],tip=tips[Math.floor(elapsed/3)%tips.length];
  s.text(tip,cx-Math.min(s.w-32,s.measure(tip,13,600))/2,Math.min(s.h-v.bottom-40,barY+64),13,muted,600,s.w-32);
  setTimeout(()=>{if(!this.destroyed)this.invalidate();},120);
 }
 private drawLobbyStartup(){
  const s=this.stage,left=12,width=Math.min(1120,s.w-24),x=(s.w-width)/2,y=this.bodyTop+8;
  s.icon('piece',{x,y,w:28,h:28});s.text('拼图大厅',x+36,y+2,23,this.colors.ink,800,width-42);
  if(this.startupError||this.client.authRequired){
   const w=Math.min(440,width),cx=x+(width-w)/2,cy=y+60;this.extent=250;
   const by=this.paragraph(this.client.authRequired?'登录网站账号，即可继续使用已有进度与收藏。':this.startupError,cx+left,cy,w-24,15)+20;
   const offline=!!this.offline.catalog&&!this.formalWeb,retry=()=>void this.start();if(offline)s.button({x:cx+12,y:by,w:w-24,h:40},'离线拼图',()=>this.enterOffline(),{tone:'berry'});s.button({x:cx+12,y:by+(offline?50:0),w:w-24,h:40},'重新连接',retry,{tone:offline?'cream':'berry'});
   if(this.formalWeb){s.button({x:cx+12,y:by+50,w:w-24,h:38},'登录 / 注册',()=>this.openWeb('account'));this.drawWebLinks(cx+12,by+108,w-24);}else{let next=by+(offline?104:54);if(this.platform.config.tapAuthorizationTest){s.button({x:cx+12,y:next,w:w-24,h:40},this.authorizationTesting?'取消昵称授权测试':'重新走昵称授权',()=>void this.reauthorizeNickname(),{disabled:this.busy&&!this.authorizationTesting});next+=54;next=this.paragraph(this.platform.tapIdentityDiagnostics?.()??'昵称授权自测',cx+12,next,w-24,11)+20;}if(this.platform.config.buildVersion)s.text('版本 '+this.platform.config.buildVersion,cx+12,next,11,this.colors.muted,500,w-24);}return;
  }
  s.text('正在读取房间与玩家信息…',x,y+43,13,this.colors.muted,500,width);
  const columns=this.desktop?Math.max(3,Math.min(4,Math.floor(width/240))):s.w>=640?3:2,gap=12,cw=(width-gap*(columns-1))/columns,h=Math.min(205,cw*.72+48),top=y+79;
  for(let index=0;index<columns;index++){const cx=x+index*(cw+gap);s.panel({x:cx,y:top,w:cw,h});s.ctx.fillStyle=this.colors.line;s.ctx.globalAlpha=.22;s.ctx.fillRect(cx+10,top+10,cw-20,h-55);s.ctx.fillRect(cx+12,top+h-31,cw*.58,8);s.ctx.fillRect(cx+12,top+h-16,cw*.35,5);s.ctx.globalAlpha=1;}
  this.extent=top+h-this.bodyTop+18;
 }
 private copyInvitationCode(code:string){if(!this.platform.copyText){this.note('邀请码：'+code);return;}void this.platform.copyText(code).then(ok=>this.note(ok?'已复制邀请码 '+code:'复制失败，请手动记下邀请码 '+code));}
 /** Headers draw beside the nav rail in local coordinates, but keep the same screen right edge. */
 /** Right-edge items end left of TapTap's ••• capsule; rows are never pushed below it (portrait since v31). */
 private menuReserve(row:Rect){const view=this.platform.viewport(),menu=view.menu;return menu&&row.y<menu.y+menu.h&&menu.y<row.y+row.h?Math.max(0,view.width-menu.x+8):0;}
 // Puzzle rooms get the same visible top gap as the lobby header (inset + 12).
 private roomHeaderTop(){if(this.layout==='phoneLandscape'&&this.platform.config.id!=='web')return this.platform.viewport().top+6;return this.headerSafeTop()+(this.platform.config.id==='web'?0:12);}
 private drawSettingsBadge(avatar:Rect,offsetX=0){
  const s=this.stage,c=s.ctx,cx=avatar.x+avatar.w-9,cy=avatar.y+avatar.h-10;
  c.save();c.fillStyle=this.colors.cream;c.beginPath();c.arc(cx,cy,11,0,Math.PI*2);c.fill();c.restore();
  s.icon('tools',{x:cx-8,y:cy-8,w:16,h:16});
  if(this.route==='lobby')this.settingsTipAnchor={...avatar,x:avatar.x+offsetX};
 }
 private get canShowSettingsTip(){return !this.settingsTipSeen&&this.ready&&this.route==='lobby'&&!this.modal&&!this.orientationEntryPending&&!this.storyIntro&&!this.needsPrivacyChoice&&!this.loginDialogActive&&!this.loginLogOpen&&!this.platform.tapAuthorizationPending?.();}
 private drawSettingsTip(){
  this.settingsTipDrawn=false;const a=this.settingsTipAnchor;if(!a||!this.canShowSettingsTip)return;
  const s=this.stage,c=s.ctx,label='点头像打开设置：声音、夜间模式、画面',size=12,w=Math.min(s.w-16,s.measure(label,size,600)+24),x=clamp(a.x,8,s.w-w-8),y=a.y+a.h+12;
  const lines:string[]=[];let line='';for(const char of label){if(line&&s.measure(line+char,size,600)>w-24){lines.push(line);line='';}line+=char;}if(line)lines.push(line);
  const h=lines.length*18+18,tipX=clamp(a.x+a.w/2,x+12,x+w-12);
  c.save();c.fillStyle=this.colors.cream;c.strokeStyle=this.colors.ink;c.lineWidth=2;c.beginPath();c.moveTo(tipX-9,y+3);c.lineTo(tipX,y-10);c.lineTo(tipX+9,y+3);c.fill();c.stroke();c.restore();
  s.panel({x,y,w,h},'cream');lines.forEach((text,index)=>s.text(text,x+12,y+9+index*18,size,this.colors.ink,600,w-24));this.settingsTipDrawn=true;
 }
 private headerSafeTop(){const view=this.platform.viewport();return this.platform.config.id==='web'?view.top:view.top+2;}
 private drawHeader(){
  const s=this.stage,p=this.client.profile,safe=this.route==='lobby'||this.route==='chapter'?this.headerSafeTop():this.platform.viewport().top,top=safe+12+(this.formalWeb?23:0),wide=s.w>=640&&s.h>560,small=s.w<360,reserve=this.menuReserve({x:0,y:top,w:s.w,h:wide?74:56});
  if(this.formalWeb){s.text('测试版',13,safe+7,10,this.colors.muted);this.drawWebLinks(Math.max(75,s.w-224),safe+7,Math.min(212,s.w-87));}
  if(this.platform.config.id==='wechat'&&safe>=30)s.text(this.platform.config.gameName,14,safe-26,13,this.colors.ink,700,Math.max(100,s.w-160));
  const line=(y:number)=>{s.ctx.fillStyle=s.color('#c99586');s.ctx.fillRect(12,Math.round(y),s.w-24,1);};
  const energy=(x:number,y:number,width:number,size=16)=>{if(!this.energyEnabled){s.icon('coin',{x,y:y+7,w:24,h:26});s.text(p?(p.collection?.coins??0):'—',x+29,y+13,size,this.colors.ink,800,Math.max(24,width-30));s.hit({x:x-3,y,w:Math.max(24,width+3),h:42},()=>this.showModal('coins'));return;}const compact=width<90;if(compact)size=Math.min(size,12);s.icon('lightning',{x,y:y+(compact?7:3),w:compact?17:22,h:compact?24:31});const label=p?p.energy+'/'+p.energyCap:'—/—',tw=Math.min(s.measure(label,size,800),Math.max(24,width-(compact?40:49)));s.text(label,x+(compact?20:25),y+12,size,this.colors.ink,800,tw+1);s.frame({x:x+(compact?24:29)+tw,y:y+10,w:compact?16:19,h:21},'plus-gold-normal');s.text('+',x+(compact?27:33)+tw,y+11,17,'#fffaf0',700);s.hit({x,y,w:width,h:42},()=>this.navigate('supplies'));};
  if(this.route==='lobby'||this.route==='gallery'||this.route==='chapter'){
   let y=top;const gallery=this.route==='gallery';
   if(gallery){s.text('图库',14,y+3,small?22:24,this.colors.ink,800,s.w-150);if(this.layout==='phonePortrait')s.button({x:s.w-136-reserve,y,w:124,h:32},'随机开一桌',()=>void this.launch({mode:'random',pieces:this.pieces,visibility:'public',direction:this.direction}),{icon:'dice',fontSize:13,disabled:this.busy||!p});line(y+37);y+=43;if(this.layout==='phoneLandscape'){this.bodyTop=y;return;}}
   const h=wide?74:56,avatar=wide?64:small?43:49,playerWidth=gallery?(small?127:151):wide?174:small?96:110;
   if(!gallery)line(y);s.icon('avatar',{x:12,y:y+3,w:avatar,h:h-5});s.hit({x:12,y,w:playerWidth,h},()=>this.showModal('settings'));
   this.drawSettingsBadge({x:12,y:y+3,w:avatar,h:h-5},this.navVisible&&this.layout==='phoneLandscape'?72:0);
   const lx=12+avatar+4,lw=gallery?small?66:85:wide?92:small?42:55;
   s.text('Lv.'+(p?.level??'—'),lx,y+5,wide?23:small?14:16,this.levelColor(p?.level??0),800,lw);s.meter({x:lx,y:y+(wide?36:28),w:lw,h:8},p?p.xp/Math.max(1,p.xpToNext):0);s.text(p?p.xp+' / '+p.xpToNext:'—',lx,y+(wide?48:40),wide?12:10,this.colors.ink,500,lw+8);
   if(gallery){energy(12+playerWidth,y+5,Math.min(135,s.w-playerWidth-60),wide?20:16);s.icon('sprig',{x:s.w-45,y:y+h-39,w:30,h:28});}
   // Beside TapTap's capsule the row is short: 任务 shows its icon only and the orientation switch stays in settings/room tools.
   else{const ex=12+playerWidth+4,tight=reserve>0&&this.layout==='phonePortrait',orientation=this.platform.config.id==='taptap'&&!!this.platform.setOrientation&&!tight,taskX=s.w-(tight?40:76)-(orientation?48:0)-reserve,right=this.route==='lobby'?taskX-8:s.w-(orientation?60:50)-reserve;energy(ex,y+(h-43)/2,Math.min(220,right-ex),wide?22:small?14:16);s.icon('sprig',{x:s.w-30-reserve,y:y-14,w:18,h:18});if(this.route==='lobby')this.drawLobbyTasks({x:taskX,y:y+(h-40)/2,w:tight?34:64,h:40},tight);if(orientation)s.button({x:s.w-52-reserve,y:y+(h-40)/2,w:40,h:40},'',()=>void this.toggleOrientation(),{icon:'orientation'});}
   line(y+h);this.bodyTop=y+h+9;return;
  }
  const title=this.route==='tasks'?'任务与礼包':this.route==='friends'?'好友':this.route==='supplies'?'补给站':this.route==='collection'?'我的收藏':this.route==='privacy'||this.route==='terms'?'服务与隐私说明':'玩法与设置';
  const titleX=this.tabRoute?14:53,coinsW=this.route==='collection'?Math.max(61,s.measure(String((this.collection?.wallet??p?.collection)?.coins??0),12,700)+26):0;if(!this.tabRoute)s.button({x:12,y:top,w:32,h:34},'',()=>this.back(),{icon:'back'});s.text(title,titleX,top+6,this.route==='collection'&&small?20:23,this.colors.ink,800,(this.route==='collection'?s.w-77-coinsW-titleX:s.w-112)-reserve);
  if(this.route==='collection'){const c=this.collection?.wallet??p?.collection;const coin=String(c?.coins??0),fragment=String(c?.fragments??0),fx=s.w-67-reserve,cx=fx-Math.max(61,s.measure(coin,12,700)+26);s.icon('coin',{x:cx,y:top+7,w:20,h:22});s.text(coin,cx+23,top+11,12,this.colors.ink,700,fx-cx-25);s.icon('fragment',{x:fx,y:top+7,w:19,h:22});s.text(fragment,fx+22,top+11,12,this.colors.ink,700,42);s.hit({x:cx-5,y:top,w:fx-cx,h:37},()=>this.showModal('coins'));s.hit({x:fx-4,y:top,w:64,h:37},()=>this.showModal('fragments'));}
  else if(this.route==='supplies'){energy(Math.max(151,s.w-169-reserve),top-1,104,small?13:15);if(!this.formalWeb){s.icon('ticket',{x:s.w-58-reserve,y:top+5,w:24,h:25});s.text(p?.supply.create??0,s.w-30-reserve,top+12,13,this.colors.ink,700);}}
  else s.button({x:s.w-52-reserve,y:top+1,w:38,h:32},'设置',()=>this.showModal('settings'),{fontSize:10});
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

 private drawLobbyTasks(r:Rect,iconOnly=false){
  const s=this.stage;s.icon('gift',{x:r.x+4,y:r.y+4,w:26,h:32});if(!iconOnly)s.text('任务',r.x+34,r.y+13,13,this.colors.ink,750);this.navBadge('tasks',r.x+28,r.y+5);s.hit(r,()=>this.navigate('tasks'));
 }
 private drawLobby(){
  const s=this.stage,layout=this.layout,gap=layout==='phoneLandscape'?10:14,top=this.bodyTop,bottom=this.bodyBottom,width=Math.min(1400,s.w-24),left=(s.w-width)/2;
  if(layout==='phonePortrait'){
   // One scrolling column: hero, last room, actions, then the public rooms.
   let y=top-this.scroll;const columns=width>=520?3:2;
   this.scrolled(()=>{
    const heroH=Math.min(s.h*.45,this.heroTextHeight(false)+Math.min(width*.52,220)+16);y=this.drawDailyHero({x:left,y,w:width,h:heroH},false)+gap;
    const last=this.continueRoom;if(last){this.drawContinueRoom(last,{x:left,y,w:width,h:72});y+=72+gap;}
    this.drawLobbyActions({x:left,y,w:width,h:46});y+=46+gap+4;
    y=this.drawRoomSection(left,y,width,columns,top,bottom);
   },top,bottom);
   this.extent=y+this.scroll-top+12;return;
  }
  // Desktop and phone landscape: a fixed left column and a room list that scrolls by itself.
  const landscape=layout==='phoneLandscape',leftW=landscape?Math.min(300,width*.42):Math.min(380,width*.36),rightX=left+leftW+gap+6,rightW=left+width-rightX;
  let y=top;const last=this.continueRoom,actionH=landscape?38:46,continueH=landscape?52:76,rest=(last?continueH+gap:0)+actionH+gap,heroH=Math.max(this.heroTextHeight(landscape)+16,Math.min(landscape?bottom-top-rest:430,bottom-top-rest));
  y=this.drawDailyHero({x:left,y,w:leftW,h:heroH},landscape)+gap;
  if(last){this.drawContinueRoom(last,{x:left,y,w:leftW,h:continueH});y+=continueH+gap;}
  this.drawLobbyActions({x:left,y,w:leftW,h:actionH});
  const header=this.drawRoomHeader(rightX,top,rightW,landscape),columns=landscape?3:rightW>=900?4:3;
  this.bodyTop=header;this.listColumn={x:this.contentOrigin.x+rightX-6,w:rightW+12};
  let end=header;this.scrolled(()=>{end=this.drawRoomGrid(rightX,header-this.scroll+4,rightW,columns,header,bottom);},header,bottom);
  this.extent=end+this.scroll-header+12;
 }
 private lobbyColumn(){return this.listColumn;}
 // Offline mode draws the bundled chapter with its own levels view.
 private drawChapter(chapter=this.selectedChapter,view=this.storyView){
  if(!chapter){this.stage.text('小窝的故事',20,this.bodyTop+12,24,this.colors.ink,800,this.stage.w-40);this.stage.text('故事暂未开放，请稍后再来看看',20,this.bodyTop+54,14,this.colors.muted,600,this.stage.w-40);this.extent=0;return;}
  this.syncComicClear(chapter);
  const s=this.stage,ctx=s.ctx,portrait=this.layout==='phonePortrait',width=Math.min(1400,s.w-24),left=(s.w-width)/2,top=this.bodyTop,bottom=this.bodyBottom;
  const current=chapter.levels.find(level=>level.status==='unlocked'),cleared=chapter.levels.filter(level=>level.status==='cleared').length,total=chapter.levels.length,complete=total>0&&cleared===total,number=(view?.chapters.indexOf(chapter)??0)+1;
  const description='拼完一格，故事就往下走一格。'+(this.energyEnabled?'每格第一次拼完送 '+(view?.firstClearEnergy??0)+' 体力。':'');
  const mainLabel=complete?'从头看':current?'拼第 '+(chapter.levels.indexOf(current)+1)+' 格（'+current.pieces+' 片）':'暂未解锁';
  const mainAction=()=>{if(complete)this.openLevelComic(chapter.levels[0].id,{sequence:true});else if(current)void this.launch({mode:'level',levelId:current.id});};
  const progressWidth=portrait?width:Math.min(172,width*.26),chapterSwitch={x:left+width-progressWidth-128,y:top,w:120,h:40};
  const heading=(y:number)=>{
   const textWidth=portrait?width:chapterSwitch.x-left-12;
   s.text('小窝的故事',left,y,24,this.colors.ink,800,textWidth);
   const chapters=view?.chapters.filter(item=>item.status==='available')??[],switching=chapters.length>=2;
   s.text('第 '+number+' 章 · '+chapter.title,left,y+28,12,this.colors.muted,700,portrait&&switching?textWidth-80:textWidth);
   if(switching){
    const selected=chapters.findIndex(item=>item.id===chapter.id),x=portrait?left+width-72:chapterSwitch.x+24,sy=portrait?y+20:y+4;
    [-1,1].forEach((direction,index)=>{const r={x:x+index*40,y:sy,w:32,h:32},disabled=selected+direction<0||selected+direction>=chapters.length;
     const action=()=>{if(disabled)return;this.storyChapterId=chapters[selected+direction].id;this.scroll=0;this.invalidate();};
     s.hit(r,()=>{});ctx.save();if(disabled)ctx.globalAlpha=.35;s.button(r,index?'›':'‹',action,{disabled,fontSize:24});ctx.restore();
    });
   }
   const x=portrait?left:left+width-progressWidth,py=portrait?y+54:y;
   s.text(cleared+' / '+total+' 格',x,py,14,this.colors.ink,700,172);
   s.meter({x,y:py+23,w:progressWidth,h:6},total?cleared/total:0);
  };
  const fit=(value:string,width:number,size:number,weight=600)=>{if(s.measure(value,size,weight)<=width)return value;let text=value;while(text.length&&s.measure(text+'…',size,weight)>width)text=text.slice(0,-1);return text+'…';};
  const bubble=(line:string,r:Rect)=>{
   // Wrap at most once. Move closing punctuation with the previous character.
   const size=!portrait&&r.h<64?10:11,rowHeight=size+4,room=r.w-32,chars=[...line];let count=0;while(count<chars.length&&s.measure(chars.slice(0,count+1).join(''),size,600)<=room)count++;
   while(count>1&&count<chars.length&&/[。，、！？；：…）」』”’]/.test(chars[count]))count--;count=Math.max(1,count);
   const rows=(!portrait&&r.h<64?[line]:count<chars.length?[chars.slice(0,count).join(''),chars.slice(count).join('')]:[line]).map(row=>portrait?row:fit(row,room,size)),bw=Math.min(r.w-16,Math.max(...rows.map(row=>s.measure(row,size,600)))+18),bh=!portrait&&r.h<64?size+10:rows.length*rowHeight+10,bx=r.x+r.w-bw-8,by=r.y+r.h-bh-7;
   ctx.save();ctx.fillStyle=this.colors.cream;ctx.strokeStyle=this.colors.ink;ctx.lineWidth=2;roomRoundPath(ctx,{x:bx,y:by,w:bw,h:bh},7);ctx.fill();ctx.stroke();ctx.restore();
   rows.forEach((row,index)=>s.text(row,bx+8,by+5+index*rowHeight,size,this.colors.ink,600,bw-16));
  };
  const card=(index:number,r:Rect)=>{
   const level=chapter.levels[index],state=nodeState(level,current),done=state==='cleared',active=state==='current',src=this.levelPicture(level).src;
   ctx.save();ctx.fillStyle=done?this.colors.placeholder:this.colors.cream;ctx.fillRect(r.x,r.y,r.w,r.h);ctx.restore();
   if(src&&done)s.clip(r,()=>s.image(this.client.asset(src),r,'cover'));
   ctx.save();ctx.strokeStyle=active?'#cf9f52':done?this.colors.ink:'#b88f84';ctx.lineWidth=active?3:2;if(state==='locked')ctx.setLineDash?.([6,4]);ctx.strokeRect(r.x+1,r.y+1,r.w-2,r.h-2);ctx.restore();
   if(done){
    const badge=!portrait&&r.h<64?14:22;ctx.save();ctx.fillStyle=this.colors.ink;ctx.fillRect(r.x+3,r.y+3,badge,badge);ctx.restore();s.text(index+1,r.x+(badge===14?6:9),r.y+(badge===14?5:7),badge===14?9:12,this.colors.cream,800,badge-4);
    if(level.line&&!portrait)bubble(level.line,r);
    s.hit(r,()=>this.openLevelComic(level.id));
   }else if(active){
    const compact=!portrait&&r.h<72,size=portrait?16:compact?10:12,label=portrait?'第 '+(index+1)+' 格 · '+level.pieces+' 片':fit('第 '+(index+1)+' 格 · '+level.pieces+' 片',r.w-12,size,800),hint='拼完解锁这一页',hintSize=compact?9:11,cx=r.x+r.w/2,cy=r.y+r.h/2;
    if(!compact){ctx.save();ctx.fillStyle='#cf9f52';ctx.beginPath();ctx.moveTo(cx-5,cy-29);ctx.lineTo(cx-5,cy-15);ctx.lineTo(cx+7,cy-22);ctx.closePath();ctx.fill();ctx.restore();}
    s.text(label,cx-s.measure(label,size,800)/2,cy-(compact?12:8),size,this.colors.ink,800,r.w-12);
    const hintText=portrait?hint:fit(hint,r.w-12,hintSize);s.text(hintText,cx-s.measure(hintText,hintSize,portrait?500:600)/2,cy+(compact?5:15),hintSize,this.colors.muted,600,r.w-12);
    s.hit(r,()=>{if(!this.busy&&(this.client.profile||this.offline?.active))void this.launch({mode:'level',levelId:level.id});});
   }else{const raw=timeLabelFor(chapter,index,level)??'第 '+(index+1)+' 格',label=portrait?raw:fit(raw,r.w-40,12,700),w=s.measure(label,12,700),x=r.x+(r.w-w-28)/2;
    s.icon('lock',{x,y:r.y+(r.h-18)/2,w:18,h:18},this.colors.muted);s.text(label,x+28,r.y+(r.h-12)/2,12,this.colors.muted,700,r.w-40);
    s.hit(r,()=>this.note('先拼完前面的格子，就能解锁这里'));
   }
  };
  const node=(index:number,x:number,y:number)=>{
   const state=nodeState(chapter.levels[index],current),radius=state==='current'?13:11;
   ctx.save();ctx.lineWidth=2;ctx.strokeStyle=state==='current'?'#cf9f52':state==='cleared'?'#a85567':'#b88f84';
   if(state==='locked')ctx.setLineDash?.([3,3]);
   if(state==='current'){ctx.shadowColor='#cf9f52';ctx.shadowBlur=12;}
   ctx.beginPath();ctx.arc(x,y,radius,0,Math.PI*2);
   if(state!=='locked'){ctx.fillStyle=state==='cleared'?'#a85567':this.colors.onAccent;ctx.fill();}if(state!=='cleared')ctx.stroke();
   if(state==='cleared'){ctx.strokeStyle=this.colors.onAccent;ctx.lineWidth=2.5;ctx.beginPath();ctx.moveTo(x-5,y);ctx.lineTo(x-1,y+4);ctx.lineTo(x+6,y-4);ctx.stroke();}ctx.restore();
  };
  const track=(points:{x:number;y:number}[])=>{
   if(!points.length)return;const first=points[0],last=points[points.length-1],r=portrait?{x:first.x-3,y:first.y,w:6,h:Math.max(6,last.y-first.y)}:{x:first.x,y:first.y-3,w:Math.max(6,last.x-first.x),h:6};
   ctx.save();const gradient=ctx.createLinearGradient(first.x,first.y,last.x,last.y);
   ['#f3c7a0','#9cc9e6','#f0cf6e','#eba965','#d4776c','#3d4170'].forEach((color,index)=>gradient.addColorStop(index/5,color));
   roomRoundPath(ctx,r,3);ctx.fillStyle=gradient;ctx.fill();
   const active=current?chapter.levels.indexOf(current):complete?total-1:Math.max(0,chapter.levels.findIndex(level=>level.status!=='cleared')),point=points[active];
   if(point&&active<total-1){s.clip(r,()=>{ctx.fillStyle='rgba(251,243,232,.62)';if(portrait)ctx.fillRect(r.x,point.y,r.w,last.y-point.y);else ctx.fillRect(point.x,r.y,last.x-point.x,r.h);});}ctx.restore();
  };
  if(portrait){
   let y=top-this.scroll;const start=y;this.scrolled(()=>{
    heading(y);y+=98;
    const rows=chapter.levels.map((level,index)=>{const state=nodeState(level,current),h=state==='cleared'?92:state==='current'?128:46,r={x:left+38,y,w:width-38,h},point={x:left+14,y:y+h/2};y+=h+12;return {index,state,r,point};});
    track(rows.map(row=>row.point));
    for(const {index,state,r,point}of rows){
     const level=chapter.levels[index],label=timeLabelFor(chapter,index,level),meta=(label?label+' · ':'')+level.pieces+' 片';node(index,point.x,point.y);
     if(state==='cleared'){
      card(index,{x:r.x,y:r.y,w:116,h:76});const text={x:r.x+128,y:r.y+28,w:r.w-128,h:56};
      s.text(meta,text.x,r.y+2,12,this.colors.muted,700,text.w);if(level.line)bubble(level.line,text);
     }else{card(index,r);}
    }
    y=this.paragraph(description,left,y+6,width,13)+14;
    s.button({x:left,y,w:width,h:52},mainLabel,mainAction,{tone:'berrydark',fontSize:14,disabled:this.busy||(!this.client.profile&&!this.offline?.active)||(!current&&!complete)});y+=62;
    if(!this.offline?.active||this.ready){s.button({x:left,y,w:width,h:44},'去大厅逛逛',()=>this.navigate('lobby'),{fontSize:13});y+=56;}
   });this.extent=y-start;
  }else{
   // Alternating cards share horizontal space. Keep both rows visible without scrolling.
   this.scroll=0;this.extent=0;heading(top);
   // Reserve title/footer first. The 34px rail band includes the largest node.
   // A 36px gap between same-row cards also leaves a readable metadata slot.
   const headingBottom=top+40,railBand=34,minHeight=44,buttonH=26,stacked=bottom-headingBottom-16-42>=minHeight*2+railBand,footerTop=bottom-(stacked?42:buttonH),railTop=headingBottom+8,railBottom=footerTop-8;
   const heightLimit=Math.max(0,(railBottom-railTop-railBand)/2),widthLimit=total>1?(2*width-36*(total-1))/(total+1):width;
   // For an exceptionally small host, bounds win over the preferred 44px minimum.
   const ch=Math.min(92,heightLimit,Math.max(0,widthLimit)*92/168),cw=ch*168/92,cy=(railTop+railBottom)/2;
   const points=chapter.levels.map((_,index)=>({x:left+cw/2+(width-cw)*index/Math.max(1,total-1),y:cy}));track(points);
   chapter.levels.forEach((level,index)=>{
    const point=points[index],above=index%2===0,r={x:clamp(point.x-cw/2,left,left+width-cw),y:above?cy-railBand/2-ch:cy+railBand/2,w:cw,h:ch};card(index,r);node(index,point.x,point.y);
    const step=total>1?(width-cw)/(total-1):width,mw=Math.max(1,Math.min(80,total>1?2*step-cw-8:width,2*(point.x-left),2*(left+width-point.x))),label=timeLabelFor(chapter,index,level),size=Math.min(11,Math.max(8,mw/4)),rows=label&&ch>=44?[label,level.pieces+' 片']:[label??level.pieces+' 片'],metaH=rows.length*size+(rows.length-1)*4,my=above?cy+railBand/2+4:cy-railBand/2-4-metaH;
    rows.forEach((value,row)=>{const text=fit(value,mw,size,700);s.text(text,point.x-s.measure(text,size,700)/2,my+row*(size+4),size,this.colors.muted,700,mw);});
   });
   const showLobby=!this.offline?.active||this.ready,count=showLobby?2:1,bw=Math.min(stacked?240:132,(width-12)/2),by=bottom-buttonH,descriptionWidth=stacked?width:width-count*(bw+12),footerText=s.measure(description,10,500)<=descriptionWidth?description:'拼完一格，故事往下走一格';
   s.text(fit(footerText,descriptionWidth,10,500),left,stacked?footerTop:by+8,10,this.colors.muted,500,descriptionWidth);
   if(!this.offline?.active||this.ready)s.button({x:left+width-bw*2-12,y:by,w:bw,h:26},'去大厅逛逛',()=>this.navigate('lobby'),{fontSize:12});
   s.button({x:left+width-bw,y:by,w:bw,h:26},mainLabel,mainAction,{tone:'berrydark',fontSize:13,disabled:this.busy||(!this.client.profile&&!this.offline?.active)||(!current&&!complete)});
   return {chapterSwitch,cardSize:{w:cw,h:ch}};
  }
 }
 private preloadComicPage(comic:Comic|null){
  if(!comic?.page)return;
  const src=this.client.asset(comic.page.src),thumb=this.client.asset(comic.page.thumbSrc);this.stage.preloadComicImage(src,thumb);return {src,thumb};
 }
 /** Synchronous entry, also used by offline play. No refresh or API request. */
 openLevelComic(levelId:string,options:{sequence?:boolean;fromClear?:boolean}={}){
  const chapter=this.chapterForLevel(levelId);if(!chapter)return;this.syncComicClear(chapter);
  const index=options.sequence?0:chapter.levels.findIndex(level=>level.id===levelId),level=chapter.levels[index];
  if(!level||index<0||index>=this.comicLimit(chapter))return;
  const returnTo=this.modal==='completion'?'completion':this.modal==='levelComic'?this.comicPage?.returnTo??null:null,comic=comicFor(chapter,index,level)!;
  this.preloadComicPage(comic);
  this.stopStoryFrame();this.comicClosePress=null;this.comicGesture=null;this.comicDrag=0;this.comicSnap=undefined;this.comicHintUntil=0;
  if(!this.comicHintSeen){
   try{this.comicHintSeen=this.platform.storage.get('jigsaw:comic-hint:v1')==='1';}catch{}
   if(!this.comicHintSeen){this.comicHintUntil=Date.now()+2500;this.comicHintSeen=true;try{this.platform.storage.set('jigsaw:comic-hint:v1','1');}catch{}}
  }
  this.comicPage={chapterId:chapter.id,levelId:level.id,index,sequence:!!options.sequence,fromClear:!!options.fromClear,started:Date.now(),shown:this.comicRead?.has(this.comicReadKey(level.id))?comicTextCount(comic):0,returnTo};this.showModal('levelComic');
 }
 private releaseComicBack(){const off=this.comicBack;this.comicBack=undefined;off?.();}
 private stopStoryFrame(){if(this.storyFrame!=null)this.platform.cancelFrame?.(this.storyFrame);this.storyFrame=null;}
 private animateStory(){
  if(this.storyFrame!=null||this.destroyed||this.hidden||!this.platform.frame)return;
  this.storyFrame=this.platform.frame(()=>{this.storyFrame=null;if(this.destroyed||this.hidden)return;if(this.modal==='levelComic'||this.storyIntro)this.invalidate();});
 }
 private turnComic(index:number){
  const page=this.comicPage,chapter=this.comicChapter;if(!page||!chapter)return;
  const limit=this.comicLimit(chapter);if(index<0||index>limit||index===page.index)return;
  const ending=index===limit,level=chapter.levels[index],comic=!ending&&level?comicFor(chapter,index,level):null;
  if(!ending&&!comic)return;
  this.preloadComicPage(comic);
  this.comicPage={...page,index,levelId:ending?'':level.id,ending,fromClear:false,started:Date.now()-520,shown:comic&&this.comicRead?.has(this.comicReadKey(level.id))?comicTextCount(comic):0,turn:reducedComicMotion()?undefined:{started:Date.now(),direction:index>page.index?1:-1}};this.invalidate();
 }
 private advanceComic(all=false){
  const page=this.comicPage,chapter=this.comicChapter;if(!page||!chapter||page.ending||page.index>=this.comicLimit(chapter))return;
  const comic=comicFor(chapter,page.index,chapter.levels[page.index]);if(!comic)return;const total=comicTextCount(comic);
  if(page.shown<total){page.shown=all?total:page.shown+1;page.started=Math.min(page.started,Date.now()-(page.fromClear?1320:520));}
  if(page.shown>=total)(this.comicRead??=new Set()).add(this.comicReadKey(page.levelId));this.invalidate();
 }
 private drawLevelComic(){
  const page=this.comicPage,chapter=this.comicChapter;if(!page||!chapter)return;this.syncComicClear(chapter);const limit=this.comicLimit(chapter);
  if(page.index>limit||(!page.ending&&page.index>=limit)){this.closeModal();return;}
  const s=this.stage,c=s.ctx,view=this.platform.viewport(),area=comicPageRect(s,view,view.menu),layout=comicLayout(area,s.w>s.h),now=Date.now(),reduced=reducedComicMotion();
  this.modalArea=area;this.modalExtent=0;c.fillStyle='#3d2129';c.fillRect(0,0,s.w,s.h);
  // The story page underneath stays drawn: margins and the dot strip must swallow taps, not reach its buttons.
  s.hit({x:0,y:0,w:s.w,h:s.h},()=>{});
  if(this.comicSnap){const t=reduced?1:clamp((now-this.comicSnap.started)/150,0,1);this.comicDrag=this.comicSnap.offset*(1-t)*(1-t);if(t===1)this.comicSnap=undefined;else this.animateStory();}
  const level=chapter.levels[page.index],comic=!page.ending&&level?comicFor(chapter,page.index,level):null;
  const turn=page.turn&&!reduced?Math.max(0,1-(now-page.turn.started)/250):0;if(!turn)page.turn=undefined;
  // Clip to the capsule-free region even while the page follows a downward drag.
  s.clip(area,()=>{c.save();c.translate(turn*turn*area.w*(page.turn?.direction??1),this.comicDrag);c.globalAlpha*=Math.max(.4,1-this.comicDrag/Math.max(1,area.h)*.65);
   try{
    if(comic){
     const photo=this.levelPicture(level),pageImage=this.preloadComicPage(comic),pageSize=s.w>s.h&&pageImage?s.comicImageSize(pageImage.src,pageImage.thumb):null,usePage=!!pageSize;
     const source=comicSource(comic,s.w>s.h,usePage,{src:photo.src??'',thumb:photo.thumbSrc??''}),src=source.src?this.client.asset(source.src):'',thumb=source.thumb?this.client.asset(source.thumb):'',roomLevel=this.room?.snapshot.levelId??this.room?.snapshot.mobileResult?.levelClear?.levelId,decoded=!usePage&&roomLevel===level.id?this.board?.comicPicture:null;
     const drawing=usePage?{...comic,panels:comic.panels.map((panel,index)=>({...panel,crop:source.crops[index]}))}:comic;
     const result=drawComicPage(s,page,drawing,'',(r,crop,zoom)=>s.comicImage(src,thumb,r,crop,zoom,decoded),now,pageSize??s.comicImageSize(src,thumb,decoded),area);if(result.animating)this.animateStory();
     s.hit(area,()=>this.advanceComic());
    }else{
     c.fillStyle='#fffdf8';c.fillRect(area.x,area.y,area.w,area.h);
     const number=(this.storyView?.chapters.findIndex(item=>item.id===chapter.id)??0)+1,next=chapter.levels[limit],nextChapter=!next?this.storyView?.chapters[number]:null,crossChapter=nextChapter?.status==='available'&&nextChapter.levels[0]?.status==='unlocked'?nextChapter.levels[0]:null,playable=next?.status==='unlocked'?next:crossChapter;
     const title=playable?next?'下一页：拼完第 '+(limit+1)+' 格解锁':'本章完':'第 '+number+' 章 完',detail=playable?crossChapter?'轻点这里去第 '+(number+1)+' 章':'轻点这里去拼第 '+(limit+1)+' 格（'+playable.pieces+' 片）':'故事待续';
     const center=(text:string,y:number,size:number,weight:number)=>{size=Math.min(size,(area.w-24)/Math.max(1,[...text].length));s.text(text,area.x+(area.w-s.measure(text,size,weight))/2,y,size,'#642238',weight,area.w-24);};
     center(title,area.y+area.h/2-28,20,800);center(detail,area.y+area.h/2+16,14,700);
     if(playable)s.hit(area,()=>{if(this.busy)return;this.showModal(null);if(this.room)this.leaveRoom();void this.launch({mode:'level',levelId:playable.id});});
    }
   }finally{c.restore();}
  });
  if(turn)this.animateStory();
  const {dots}=layout,step=Math.min(16,dots.w/(limit+1)),start=dots.x+(dots.w-step*(limit+1))/2;
  c.save();c.globalAlpha*=.45;c.strokeStyle='#fff4cf';c.lineWidth=1;
  for(let index=0;index<=limit;index++){c.fillStyle=index===page.index?'#fff4cf':'#cf9f9f';c.beginPath();c.arc(start+(index+.5)*step,dots.y+7,2.5,0,Math.PI*2);if(index<limit)c.fill();else c.stroke();}c.restore();
  if(this.comicHintUntil>now){c.save();c.globalAlpha*=.45*Math.min(1,(this.comicHintUntil-now)/400);const text='左右滑动翻页 · 下滑关闭',size=Math.min(12,(area.w-24)/text.length);s.text(text,area.x+(area.w-s.measure(text,size,500))/2,area.y+area.h-30,size,'#fffdf8',500,area.w-24);c.restore();this.animateStory();}
  // Draw last, outside the animated/fading page and the first-open hint.
  const close=comicCloseRect(view),cx=close.x+close.w/2,cy=close.y+close.h/2;
  c.save();c.globalAlpha*=.55;c.fillStyle='#3d2129';c.beginPath();c.arc(cx,cy,20,0,Math.PI*2);c.fill();c.restore();
  // The button sits on the same dark backdrop, so a faint ring keeps its outline readable.
  c.save();c.strokeStyle='rgba(255,255,255,.4)';c.lineWidth=1.5;c.beginPath();c.arc(cx,cy,19.25,0,Math.PI*2);c.stroke();c.restore();
  c.save();c.strokeStyle='#ffffff';c.lineWidth=2.5;c.lineCap='round';c.beginPath();c.moveTo(cx-7,cy-7);c.lineTo(cx+7,cy+7);c.moveTo(cx+7,cy-7);c.lineTo(cx-7,cy+7);c.stroke();c.restore();
  s.hit(close,()=>this.closeModal());
 }
 private snapComicBack(){
  this.comicSnap=this.comicDrag&&!reducedComicMotion()?{started:Date.now(),offset:this.comicDrag}:undefined;
  if(!this.comicSnap)this.comicDrag=0;this.invalidate();
 }
 /** Lock the dominant axis after 16px; a drag never also becomes a tap. */
 private inputComic(input:Input){
  const point=input.changed[0]??input.points[0],now=Date.now();
  if(input.type==='down'){this.comicHintUntil=0;this.invalidate();}
  if(input.type==='cancel'||input.points.length>1){this.comicClosePress=null;this.comicGesture=null;this.snapComicBack();this.stage.input({type:'cancel',points:[],changed:[]});return true;}
  const close=comicCloseRect(this.platform.viewport());
  if(input.type==='down'&&point&&inside(close,point.x,point.y)){
   this.comicClosePress=point.id;this.comicGesture=null;this.stage.input({type:'cancel',points:[],changed:[]});return true;
  }
  if(this.comicClosePress!==null){
   if(input.type==='up'&&point?.id===this.comicClosePress){this.comicClosePress=null;if(inside(close,point.x,point.y))this.closeModal();}
   return true;
  }
  if(input.type==='down'){
   this.comicSnap=undefined;this.comicDrag=0;
   this.comicGesture=point&&inside(this.modalArea,point.x,point.y)?{id:point.id,x:point.x,y:point.y,lastY:point.y,lastAt:now,velocity:0}:null;
  }
  const gesture=this.comicGesture;
  if(gesture&&point&&point.id===gesture.id&&(input.type==='move'||input.type==='up')){
   const dx=point.x-gesture.x,dy=point.y-gesture.y;
   if(!gesture.axis&&Math.max(Math.abs(dx),Math.abs(dy))>=16)gesture.axis=Math.abs(dx)>Math.abs(dy)?'x':'y';
   if(gesture.axis){
    this.stage.input({type:'cancel',points:[],changed:[]});
    if(now>gesture.lastAt&&point.y!==gesture.lastY)gesture.velocity=(point.y-gesture.lastY)/(now-gesture.lastAt);
    else if(now-gesture.lastAt>80)gesture.velocity=0;
    if(gesture.axis==='y'){this.comicDrag=Math.max(0,dy);this.invalidate();}
    if(input.type==='up'){
     this.comicGesture=null;
     if(gesture.axis==='x'&&Math.abs(dx)>=40&&this.comicPage)this.turnComic(this.comicPage.index+(dx>0?-1:1));
     else if(gesture.axis==='y'&&(dy>=90||dy>24&&gesture.velocity>.65))this.closeModal();
     else this.snapComicBack();
    }else if(point.y!==gesture.lastY){gesture.lastY=point.y;gesture.lastAt=now;}
    return true;
   }
  }
  if(input.type==='up')this.comicGesture=null;return this.stage.input(input);
 }
 private beginStoryIntro(levelId:string|undefined){
  this.storyIntro=null;const chapter=this.chapterForLevel(levelId),index=chapter?.levels.findIndex(level=>level.id===levelId)??-1;if(!chapter||index<0)return;
  const intro=comicFor(chapter,index,chapter.levels[index])?.intro;if(intro){this.storyIntro={text:intro,until:0};this.invalidate();}
 }
 private drawStoryIntro(){
  const intro=this.storyIntro;if(!intro||!this.imageReady||this.modal)return;
  if(!intro.until)intro.until=Date.now()+2000;if(Date.now()>=intro.until){this.storyIntro=null;return;}
  const s=this.stage,r=this.roomArea;s.ctx.save();s.ctx.fillStyle='rgba(42,26,31,.48)';s.ctx.fillRect(r.x,r.y,r.w,r.h);drawComicText(s,{kind:'caption',at:'tl',text:intro.text},{x:r.x+16,y:r.y+70,w:Math.min(r.w-32,480),h:120});s.ctx.restore();this.animateStory();
 }
 private get continueRoom(){return this.historyRooms?.find(room=>!room.completed&&!room.unavailable)??null;}
 private dailyNow(){return Date.now()+this.serverOffset;}
 private get dailyLabel(){const day=new Date(this.dailyNow()+8*3600000);return '今日拼图 · '+(day.getUTCMonth()+1)+'月'+day.getUTCDate()+'日';}
 // The daily changes at Beijing midnight (the daily schedule only accepts Asia/Shanghai).
 private get dailyLeft(){const now=this.dailyNow(),next=(Math.floor((now+8*3600000)/86400000)+1)*86400000-8*3600000,minutes=Math.max(1,Math.ceil((next-now)/60000)),hours=Math.floor(minutes/60);return '还剩 '+(hours?hours+' 小时 '+minutes%60+' 分':minutes+' 分钟');}
 private heroTextHeight(compact:boolean){const photo=this.dailyPhoto,description=typeof (photo as {description?:unknown}|null)?.description==='string';return compact?8+16+20+6+34+10:10+18+28+8+(description?20:0)+40+12;}
 private launchDaily(){void this.launch({mode:'daily',pieces:108,visibility:'public'});}
 // The invite flow shares the current room, so the daily table is opened first.
 private async inviteToDaily(){await this.launch({mode:'daily',pieces:108,visibility:'public'});if(this.room)this.showModal('invite');}
 private drawDailyHero(r:Rect,compact:boolean){
  const s=this.stage,photo=this.dailyPhoto,ink=this.colors.ink,textH=this.heroTextHeight(compact),imageH=Math.max(0,r.h-textH-8),hasImage=imageH>=(compact?24:40),busy=this.busy||!this.client.profile;
  s.frame(r,'panel-cream');
  if(hasImage){const art={x:r.x+8,y:r.y+8,w:r.w-16,h:imageH};if(photo)s.image(this.client.asset(photo.src||photo.thumbSrc),art,'cover');else{s.ctx.fillStyle=this.colors.placeholder;s.ctx.fillRect(art.x,art.y,art.w,art.h);}s.hit(art,()=>{if(!busy)this.launchDaily();});}
  let y=r.y+(hasImage?imageH+8:0)+(compact?8:10);const x=r.x+14,w=r.w-28,left=this.dailyLeft,leftW=s.measure(left,11,600);
  const finished=this.dailyFinished?' · 今天已有 '+this.dailyFinished+' 人拼完':'';s.text(this.dailyLabel+finished,x,y,11,this.colors.muted,700,w-leftW-10);s.text(left,x+w-leftW,y,11,this.colors.muted,600);y+=compact?16:18;
  const title=photo?.title??'正在读取今日拼图…',size=compact?15:22;s.text(title,x,y,size,ink,800,w);y+=size+(compact?6:8);
  const description=(photo as {description?:unknown}|null)?.description;if(!compact&&typeof description==='string'&&description){s.text(description,x,y,12,this.colors.muted,500,w);y+=20;}
  const bh=compact?34:40,primary=Math.round(w*.58);
  s.button({x,y,w:primary,h:bh},'开始拼 · 108 片',()=>this.launchDaily(),{tone:'berrydark',icon:'daily',fontSize:compact?12:14,disabled:busy});
  s.button({x:x+primary+8,y,w:w-primary-8,h:bh},'叫上朋友',()=>void this.inviteToDaily(),{icon:'invite',fontSize:compact?12:14,disabled:busy});
  s.ornaments(r,compact?14:18);
  return r.y+r.h;
 }
 private drawContinueRoom(room:MobileOwnedRoom,r:Rect){
  const s=this.stage,slim=r.h<70,thumb=room.thumbSrc??(room.imageId?photoMap.get(room.imageId)?.thumbSrc:undefined),total=room.actualPieces??room.pieces??0,percent=clamp(Math.round((room.placed??0)/Math.max(1,total)*100),0,100),bw=slim?82:96;
  s.frame(r,'button-linen-normal');const th=r.h-12,tw=Math.round(th*1.25);
  if(thumb)s.image(this.client.asset(thumb),{x:r.x+6,y:r.y+6,w:tw,h:th});else{s.ctx.fillStyle=this.colors.placeholder;s.ctx.fillRect(r.x+6,r.y+6,tw,th);}
  const x=r.x+tw+14,w=r.w-tw-bw-30;
  s.text('继续上次',x,r.y+(slim?7:9),10,this.colors.muted,700);s.text(room.title??'一起拼图',x+50,r.y+(slim?6:8),slim?12:14,this.colors.ink,800,w-50);
  s.text((total||'—')+' 片'+(room.players?' · 同桌 '+room.players+' 人':''),x,r.y+(slim?23:30),11,this.colors.muted,500,w);
  s.meter({x,y:r.y+r.h-(slim?13:19),w:Math.max(20,w-34),h:slim?6:8},percent/100);s.text(percent+'%',x+w-30,r.y+r.h-(slim?16:23),10,this.colors.ink,800,32);
  s.button({x:r.x+r.w-bw-8,y:r.y+(r.h-(slim?32:36))/2,w:bw,h:slim?32:36},'回到这桌',()=>{if(!this.busy)void this.enterRoom(room.id);},{tone:'berry',fontSize:slim?11:13});
 }
 private quickJoin(){
  const open=this.rooms.filter(room=>room.players<seatLimit(room)&&room.acceptingNew!==false&&!room.completed),progress=(room:RoomListing)=>room.placed/Math.max(1,room.actualPieces??room.pieces);
  const best=open.filter(room=>progress(room)<.9).sort((a,b)=>progress(b)-progress(a))[0];
  if(best)void this.enterRoom(best.id);else void this.launch({mode:'random',pieces:this.pieces,visibility:'public',direction:this.direction});
 }
 private drawLobbyActions(r:Rect){
  const half=(r.w-10)/2,font=r.h<42?13:15,icon=r.h<42?17:21;
  this.drawPictureButton({x:r.x,y:r.y,w:half,h:r.h},'快速加入',()=>this.quickJoin(),'berry','players',font,icon,this.busy||!this.client.profile);
  this.drawPictureButton({x:r.x+half+10,y:r.y,w:half,h:r.h},'开一桌',()=>this.navigate('gallery'),'cream','create',font,icon);
 }
 private get lobbyRooms(){
  const pieces=(room:RoomListing)=>room.actualPieces??room.pieces,open=(room:RoomListing)=>room.players<seatLimit(room)&&room.acceptingNew!==false&&!room.completed;
  const rooms=this.rooms.filter(room=>this.lobbyPieces==='small'?pieces(room)<=108:this.lobbyPieces==='large'?pieces(room)>=300:true);
  return [...rooms.filter(open),...rooms.filter(room=>!open(room))];
 }
 private setLobbyChip(change:()=>void){const before=JSON.stringify([this.direction,this.filterCount,this.lobbyPieces]);change();if(JSON.stringify([this.direction,this.filterCount,this.lobbyPieces])===before)return;this.scroll=0;this.lobbySerial++;this.rooms=[];this.lobbyCursor=null;void this.loadLobby();this.invalidate();}
 private drawRoomHeader(x:number,y:number,w:number,compact:boolean){
  const s=this.stage,count=this.lobbyRooms.length,label=(this.lobbyCursor?count+'+':String(count))+' 桌在拼',size=compact?16:20,historyLabel='历史拼图',historySize=12,hw=Math.ceil(s.measure(historyLabel,historySize,750))+Math.min(19,historySize+5)+(compact?16:22);
  s.text('公开房间',x,y+2,size,this.colors.ink,800);s.text(label,x+s.measure('公开房间',size,800)+10,y+(compact?5:8),12,this.colors.muted,600);
  s.button({x:x+w-hw-2,y:y-2,w:hw,h:compact?26:30},historyLabel,()=>this.showModal('history'),{icon:'piece',fontSize:historySize});
  y+=compact?28:36;
  const more=!!this.filterCount||this.activeOnly||!this.openOnly||this.direction==='square',chips:[string,boolean,()=>void][]=[
   ['全部',this.direction==='all'&&this.lobbyPieces==='all'&&!more,()=>this.setLobbyChip(()=>{this.direction='all';this.lobbyPieces='all';this.filterCount=0;})],
   ['竖图',this.direction==='portrait',()=>this.setLobbyChip(()=>{this.direction=this.direction==='portrait'?'all':'portrait';})],
   ['横图',this.direction==='landscape',()=>this.setLobbyChip(()=>{this.direction=this.direction==='landscape'?'all':'landscape';})],
   ['≤108 片',this.lobbyPieces==='small',()=>this.setLobbyChip(()=>{this.lobbyPieces=this.lobbyPieces==='small'?'all':'small';this.filterCount=0;})],
   ['300 片+',this.lobbyPieces==='large',()=>this.setLobbyChip(()=>{this.lobbyPieces=this.lobbyPieces==='large'?'all':'large';this.filterCount=0;})],
   ['更多',more,()=>this.showModal('filters')]];
  return this.drawChips(x,y,w,compact?28:32,chips)+(compact?8:12);
 }
 private drawChips(x:number,y:number,w:number,h:number,chips:readonly(readonly[string,boolean,()=>void])[]){
  const s=this.stage,font=12,chipGap=6,natural=chips.map(([label])=>s.measure(label,font,700)+(w<360?14:22)),scale=Math.min(1,(w-chipGap*(chips.length-1))/natural.reduce((a,b)=>a+b,0));
  let cx=x;chips.forEach(([label,selected,action],index)=>{const cw=Math.floor(natural[index]*scale),r={x:cx,y,w:cw,h};s.frame(r,selected?'segment-berry-selected':'button-linen-normal');s.text(label,cx+(cw-s.measure(label,font,700))/2,y+(h-font)/2-1,font,selected?this.colors.onAccent:this.colors.ink,700,cw-4);s.hit(r,action);cx+=cw+chipGap;});
  return y+h;
 }
 private drawRoomSection(x:number,y:number,w:number,columns:number,top:number,bottom:number){return this.drawRoomGrid(x,this.drawRoomHeader(x,y,w,false),w,columns,top,bottom);}
 private drawRoomGrid(x:number,y:number,w:number,columns:number,top:number,bottom:number){
  const s=this.stage,rooms=this.lobbyRooms,gap=w>=600?14:10,cw=(w-gap*(columns-1))/columns,imageHeight=(cw-12)/1.12,ch=imageHeight+76;
  if(!rooms.length){
   if(this.lobbyBusy){s.text('正在寻找拼图桌面…',x+(w-s.measure('正在寻找拼图桌面…',15,700))/2,y+30,15,this.colors.muted,700);return y+80;}
   if(this.rooms.length||this.lobbyPieces!=='all'||this.direction!=='all'||this.filterCount){const message='没有符合条件的房间，换个筛选试试';s.text(message,x+(w-s.measure(message,14,700))/2,y+30,14,this.colors.muted,700,w);return y+80;}
   const r={x,y,w,h:Math.min(260,w*.7+60)},bw=Math.min(170,(w-46)/2),art=Math.min(84,r.h*.32);s.panel(r);
   s.icon('friendArt',{x:x+(w-art)/2,y:y+16,w:art,h:art});let cy=y+art+28;
   const title='还没有公开房，来开第一桌吧';s.text(title,x+(w-s.measure(title,16,800))/2,cy,16,this.colors.ink,800,w-24);cy+=28;
   const hint='开好后别人能在这里看到并加入；也可以把邀请发给朋友',hw=Math.min(w-32,s.measure(hint,12,500));cy+=this.stage.wrap(hint,x+(w-hw)/2,cy,hw+2,12,this.colors.muted,18)+8;
   const bx=x+(w-bw*2-12)/2,by=Math.min(cy,r.y+r.h-50);s.button({x:bx,y:by,w:bw,h:38},'随机开一桌',()=>void this.launch({mode:'random',pieces:this.pieces,visibility:'public',direction:this.direction}),{tone:'berrydark',icon:'dice',fontSize:13,disabled:this.busy||!this.client.profile});s.button({x:bx+bw+12,y:by,w:bw,h:38},'邀请朋友',()=>this.showModal('invite'),{icon:'invite',fontSize:13});
   return y+r.h+12;
  }
  rooms.forEach((room,index)=>{const cx=x+(index%columns)*(cw+gap),cy=y+Math.floor(index/columns)*(ch+gap);if(cy+ch<top||cy>bottom)return;this.drawRoomCard(room,{x:cx,y:cy,w:cw,h:ch});});
  let end=y+Math.ceil(rooms.length/columns)*(ch+gap);
  if(this.lobbyCursor){this.button(x+12,end,w-24,this.lobbyBusy?'加载中…':'加载更多',()=>void this.loadLobby(true),'cream',38,this.lobbyBusy);end+=50;}
  return end;
 }
 private drawRoomCard(room:RoomListing,r:Rect){
  const s=this.stage,{x,y:cy,w:cw,h:ch}=r,narrow=cw<170,photo=room.photo??photoMap.get(room.imageId),thumb=room.thumbSrc??photo?.thumbSrc,total=room.actualPieces??room.pieces,percent=clamp(Math.round(room.placed/Math.max(1,total)*100),0,100),art={x:x+6,y:cy+6,w:cw-12,h:ch-82};
  s.frame(r,'button-linen-normal');s.ctx.fillStyle=this.colors.cream;s.ctx.fillRect(x+6,cy+6,cw-12,ch-12);if(thumb)s.image(this.client.asset(thumb),art);
  const copyY=art.y+art.h+7;s.text(room.title,x+11,copyY,narrow?14:16,this.colors.ink,800,cw-22);const metaY=copyY+23;s.icon('piece',{x:x+11,y:metaY,w:14,h:16});s.text(total+'片',x+28,metaY+2,12,this.colors.ink,600);
  const seats=room.players+'/'+seatLimit(room),seatsW=s.measure(seats,12,700),stack=Math.min(3,room.players),stackX=x+cw-11-seatsW-4-(stack?14+stack*10:0);
  for(let i=0;i<stack;i++){const member=room.members?.[i];s.icon('avatar',{x:stackX+i*10,y:metaY-2,w:18,h:20});if(member?.decoration)s.decoration(member.decoration,{x:stackX+i*10+10,y:metaY-6,w:10,h:11});}s.text(seats,x+cw-11-seatsW,metaY+2,12,this.colors.ink,700);
  s.meter({x:x+11,y:cy+ch-16,w:cw-52,h:8},percent/100);s.text(percent+'%',x+cw-11-s.measure(percent+'%',10,800),cy+ch-19,10,this.colors.ink,800);
  if(room.players>=seatLimit(room)||room.acceptingNew===false){s.ctx.fillStyle='#6f374edb';s.ctx.fillRect(art.x,art.y+art.h-23,art.w,23);s.text(room.players>=seatLimit(room)?'已满员':'暂停加入',art.x+8,art.y+art.h-18,11,'#fff9f0',700);}
  s.hit(r,()=>{if(room.players>=seatLimit(room))this.note('房间已满，请选择其他房间');else if(room.acceptingNew===false||room.completed)this.note('房间暂不接受加入');else void this.enterRoom(room.id);});
 }
 private drawGallery(){
  const s=this.stage,layout=this.layout,portrait=layout==='phonePortrait',landscape=layout==='phoneLandscape',width=Math.min(1400,s.w-24),left=(s.w-width)/2,owned=new Set(this.client.profile?.collection?.ownedImageIds??[]);
  const pack=this.packId?(this.collection?.packs.find(p=>p.id===this.packId)??collectionCatalog.packs.find(p=>p.id===this.packId)):null;
  const panelW=portrait?0:landscape?260:340,gridW=width-(panelW?panelW+14:0);let y=this.bodyTop;
  const chipCategories=CATEGORIES.filter(c=>c!=='全部').map(c=>[c,GALLERY_PHOTOS.filter(photo=>photo.category===c).length] as const).sort((a,b)=>b[1]-a[1]).slice(0,2).map(([c])=>c);
  const view=(change:()=>void)=>this.changeListView(()=>{change();this.packId=null;this.selected=null;});
  const chips:[string,boolean,()=>void][]=[
   ['全部',this.source==='all'&&this.direction==='all'&&this.category==='全部'&&!this.search,()=>view(()=>{this.source='all';this.direction='all';this.category='全部';this.search='';})],
   ['竖图',this.direction==='portrait',()=>view(()=>{this.direction=this.direction==='portrait'?'all':'portrait';})],
   ['横图',this.direction==='landscape',()=>view(()=>{this.direction=this.direction==='landscape'?'all':'landscape';})],
   ['免费',this.source==='free',()=>view(()=>{this.source=this.source==='free'?'all':'free';})],
   ['我的图包',this.source==='owned',()=>view(()=>{this.source=this.source==='owned'?'all':'owned';})],
   ...chipCategories.map(category=>[category,this.category===category,()=>view(()=>{this.category=this.category===category?'全部':category;})] as [string,boolean,()=>void]),
   ['更多',!!this.search||this.direction==='square'||this.category!=='全部'&&!chipCategories.includes(this.category),()=>this.showModal('filters')]];
  y=this.drawChips(left,y,gridW,portrait||landscape?30:34,portrait?chips.filter(([label])=>label!==chipCategories[1]):chips)+10;
  if(pack){s.icon('book',{x:left+2,y,w:23,h:25});s.text(pack.title,left+30,y+5,13,this.colors.ink,700,gridW-130);s.text('查看所有图片',left+gridW-90,y+6,12,this.colors.muted,600);s.hit({x:left+gridW-98,y,w:98,h:30},()=>this.changeListView(()=>{this.packId=null;this.selected=null;}));y+=34;}
  const photos=this.availableGallery().filter(photo=>(this.direction==='all'||orientation(photo.id)===this.direction)&&(this.category==='全部'||this.category===photo.category)&&photo.title.includes(this.search)&&(!pack||pack.imageIds.includes(photo.id))&&(this.source==='all'||this.source==='free'&&!!this.freeGalleryIds?.has(photo.id)||this.source==='owned'&&owned.has(photo.id)));
  const selected=this.selected?photoMap.get(this.selected)??null:null,sheetH=portrait&&selected?this.createPanelHeight(true):0,v=this.platform.viewport(),bottom=s.h-v.bottom-12-(sheetH?sheetH+4:0);
  const columns=portrait?(gridW>=520?3:2):landscape?3:Math.max(2,Math.min(5,Math.floor(gridW/235))),gap=landscape?8:portrait?10:14,cw=(gridW-gap*(columns-1))/columns,imageHeight=(cw-12)/1.38,ch=imageHeight+(cw<170?56:60);
  this.bodyTop=y;this.bodyBottom=bottom;this.listColumn={x:this.contentOrigin.x+left-6,w:gridW+12};this.extent=Math.ceil(photos.length/columns)*(ch+gap)+12;
  this.scrolled(()=>{
   photos.forEach((photo,index)=>{const x=left+(index%columns)*(cw+gap),cy=y+Math.floor(index/columns)*(ch+gap)-this.scroll;if(cy+ch<y||cy>bottom)return;this.drawPhotoCard(photo,{x,y:cy,w:cw,h:ch},imageHeight,owned);});
   if(!photos.length){const message=this.source==='owned'?'收藏一个喜欢的图包':'换个条件试试';s.icon(this.source==='owned'?'book':'underlay',{x:left+gridW/2-26,y:y+20,w:52,h:52});s.text(message,left+(gridW-s.measure(message,17,800))/2,y+85,17,this.colors.ink,800);this.drawPictureButton({x:left+gridW/2-85,y:y+122,w:170,h:38},this.source==='owned'?'前往收藏':'查看全部图片',()=>{if(this.source==='owned')this.navigate('collection');else view(()=>{this.direction='all';this.category='全部';this.search='';this.source='all';});},'cream','book',13,17);this.extent=190;}
  },y,bottom);
  if(panelW){const top=this.bodyTop-(pack?34:0)-40;this.drawCreatePanel({x:left+width-panelW,y:Math.max(12,top),w:panelW,h:s.h-v.bottom-12-Math.max(12,top)},selected,owned,false);}
  else if(selected)this.drawCreatePanel({x:left-2,y:s.h-v.bottom-sheetH-4,w:width+4,h:sheetH},selected,owned,true);
 }
 private galleryPack(id:string){return this.collection?.packs.find(pack=>pack.imageIds.includes(id))??collectionCatalog.packs.find(pack=>pack.imageIds.includes(id))??null;}
 private photoTag(id:string,owned:Set<string>){if(this.freeGalleryIds?.has(id))return {label:'免费',tone:'free'};if(owned.has(id))return {label:'已拥有',tone:'owned'};const pack=this.galleryPack(id);if(pack)return {label:'图包「'+pack.title+'」',tone:'locked',price:pack.price};return {label:this.client.profile?.firstSelectionAvailable?'首次免费':'建房券',tone:'free'};}
 private drawPhotoCard(photo:SharedPhoto,r:Rect,imageHeight:number,owned:Set<string>){
  const s=this.stage,selected=this.selected===photo.id,art={x:r.x+6,y:r.y+6,w:r.w-12,h:imageHeight},tag=this.photoTag(photo.id,owned),small=r.w<170;
  s.frame(r,selected?'panel-gold':'button-linen-normal');s.ctx.fillStyle=selected?s.color('#fff3e7'):this.colors.cream;s.ctx.fillRect(r.x+6,r.y+6,r.w-12,r.h-12);s.image(this.client.asset(photo.thumbSrc),art);
  if(selected){s.frame({x:art.x+5,y:art.y+5,w:27,h:27},'segment-berry-selected');s.icon('check',{x:art.x+10,y:art.y+10,w:17,h:17},'#fff9ed');}
  const ty=art.y+art.h+7;s.text(photo.title,r.x+10,ty,small?14:15,this.colors.ink,800,r.w-20);
  const tagY=ty+(small?21:23);
  if(tag.tone==='locked'){s.icon('lock',{x:r.x+9,y:tagY,w:13,h:14},this.colors.muted);const price=String(tag.price)+' 金币',pw=s.measure(price,12,700);s.text(tag.label,r.x+25,tagY+1,12,this.colors.muted,600,r.w-pw-46);s.icon('coin',{x:r.x+r.w-pw-27,y:tagY,w:14,h:15});s.text(price,r.x+r.w-pw-10,tagY+1,12,this.colors.ink,700);}
  else{const tw=s.measure(tag.label,12,700)+12;s.ctx.fillStyle=s.color(tag.tone==='owned'?'#cc8996':'#f2d5ad');s.ctx.fillRect(r.x+10,tagY-1,tw,18);s.text(tag.label,r.x+16,tagY+1,12,tag.tone==='owned'?'#fff8ec':'#674625',700);}
  s.hit(r,()=>{this.selected=photo.id;this.invalidate();});
 }
 private createPanelHeight(sheet:boolean){const rooms=this.selected?this.rooms.filter(room=>room.imageId===this.selected).length:0;return 14+64+12+(sheet?32:58)+8+(sheet?32:58)+8+(rooms?26:0)+(this.usesCreationTickets?42:0)+46+14;}
 private drawCreatePanel(r:Rect,photo:SharedPhoto|null,owned:Set<string>,sheet:boolean){
  const s=this.stage,p=this.client.profile,ink=this.colors.ink,x=r.x+14,w=r.w-28,compact=r.w<300;
  s.frame(r,'panel-cream');s.hit(r,()=>{});let y=r.y+14;
  // Creation rules are unchanged: owned public rooms are free, otherwise the first choice or a ticket.
  const freeOwned=!!this.selected&&owned.has(this.selected)&&this.visibility==='public',freeFirst=!!p?.firstSelectionAvailable,available=(p?.supply.create??0)>0,roomCount=p?.ownedRooms.length??0;
  const lockedPack=!this.formalWeb&&photo&&this.photoTag(photo.id,owned).tone==='locked'?this.galleryPack(photo.id):null;
  const createLabel=lockedPack?'解锁图包':!this.usesCreationTickets?'开一桌':roomCount>=3?'管理房间':freeOwned||freeFirst||available?'开一桌':this.shareAvailable?'分享领建房券':'暂无建房券',createAction=()=>{if(lockedPack){const full=this.collection?.packs.find(item=>item.id===lockedPack.id);if(full)this.openPackPreview(full);else this.navigate('collection');return;}if(!this.formalWeb&&roomCount>=3){this.showModal('manage');return;}if(!this.selected){this.note('先选择一张图片');return;}if(!this.usesCreationTickets||freeOwned||freeFirst||available)void this.launch({mode:'selected',pieces:this.pieces,visibility:this.visibility,imageId:this.selected});else void this.claimSupply('create');};
  const disabled=this.busy||!p||(!lockedPack&&this.usesCreationTickets&&!freeOwned&&!freeFirst&&!available&&!this.shareAvailable&&roomCount<3);
  const thumb=compact?52:64;
  if(photo){s.frame({x,y,w:Math.round(thumb*1.3),h:thumb},'plus-cream-normal');s.image(this.client.asset(photo.thumbSrc),{x:x+3,y:y+3,w:Math.round(thumb*1.3)-6,h:thumb-6});const tx=x+thumb*1.3+10,tw=w-thumb*1.3-(sheet?44:10);s.text(photo.title,tx,y+4,compact?15:17,ink,800,tw);s.text(photo.category,tx,y+(compact?26:30),12,this.colors.muted,600,tw);
   const tag=this.photoTag(photo.id,owned),pack=tag.tone==='locked'?this.galleryPack(photo.id):null;if(pack){const label='解锁图包 ›';s.text(label,tx,y+thumb-16,12,this.colors.berry,700);s.hit({x:tx-4,y:y+thumb-22,w:s.measure(label,12,700)+8,h:24},()=>{const full=this.collection?.packs.find(item=>item.id===pack.id);if(full)this.openPackPreview(full);else this.navigate('collection');});}}
  else{s.icon('piece',{x,y:y+8,w:26,h:29});this.paragraph('点选一张喜欢的图片',x+34,y+10,w-34,13);}
  if(sheet){s.button({x:r.x+r.w-46,y:r.y+10,w:34,h:34},'',()=>{this.selected=null;this.invalidate();});s.icon('close',{x:r.x+r.w-41,y:r.y+15,w:24,h:24},ink);}
  y+=thumb+12;
  const row=(label:string,draw:(rr:Rect)=>void)=>{if(sheet){const lw=56;s.text(label,x,y+8,13,this.colors.muted,700);draw({x:x+lw,y,w:w-lw,h:32});y+=40;}else{s.text(label,x,y,13,this.colors.muted,700);draw({x,y:y+20,w,h:34});y+=66;}};
  row('片数',rr=>s.segments(rr,this.pieceCounts.map(n=>[n,String(n)] as const),this.pieces,n=>{this.pieces=n;this.invalidate();}));
  row('谁能加入',rr=>s.segments(rr,[['public','公开'],['private','私人']] as const,this.visibility,v=>{this.visibility=v;this.invalidate();}));
  const tables=this.selected?this.rooms.filter(room=>room.imageId===this.selected&&room.players<seatLimit(room)&&room.acceptingNew!==false&&!room.completed):[];
  if(tables.length){const label='这张图有 '+tables.length+' 桌公开房正在拼 · 去加入 ›';s.text(label,x,y,12,this.colors.berry,700,w);s.hit({x:x-4,y:y-6,w,h:26},()=>{const best=[...tables].sort((a,b)=>b.placed/Math.max(1,b.actualPieces??b.pieces)-a.placed/Math.max(1,a.actualPieces??a.pieces))[0];if(best)void this.enterRoom(best.id);});y+=26;}
  if(this.usesCreationTickets){const cost=freeOwned?'这张图的公开房免费':freeFirst?'首次开桌免费':'需要 1 张建房券';s.text(cost+' · 私人房或其他图用 1 张建房券',x,y,12,this.colors.ink,600,w);y+=19;const stock='建房券 '+(p?.supply.create??0)+'/3';s.text(stock,x,y,12,this.colors.muted,700);if(this.shareAvailable){const lx=x+s.measure(stock,12,700)+8,label='· 分享领取';s.text(label,lx,y,12,this.colors.berry,700);s.hit({x:lx-4,y:y-6,w:s.measure(label,12,700)+8,h:26},()=>void this.claimSupply('create','share'));}y+=23;}
  this.drawPictureButton({x,y,w,h:44},createLabel,createAction,'berrydark','players',16,19,disabled);y+=54;
  if(!sheet)this.drawPictureButton({x,y,w,h:38},'随机开一桌（公开 · 免费）',()=>void this.launch({mode:'random',pieces:this.pieces,visibility:'public',direction:this.direction}),'cream','dice',compact?12:13,16,this.busy||!p);
 }
 private drawPictureButton(r:Rect,label:string,fn:()=>void,tone='cream',icon='',fontSize=11,iconSize=16,disabled=false,selected=false){
  const s=this.stage,c=s.ctx;c.save();if(selected){s.frame(r,'button-'+tone+'-'+(disabled?'disabled':'selected'));if(!disabled)s.hit(r,fn);}else s.button(r,'',fn,{tone,disabled});const accent=tone==='berry'||tone==='berrydark'||tone==='gold',textColor=disabled?this.colors.disabled:accent?'#fffaf0':this.colors.ink,gap=label&&icon?3:0,contentWidth=s.measure(label,fontSize,750)+(icon?iconSize:0)+gap,start=r.x+(r.w-contentWidth)/2;if(icon)s.icon(icon,{x:start,y:r.y+(r.h-iconSize)/2,w:iconSize,h:iconSize},disabled?this.colors.disabled:accent?'#fffaf0':icon==='create'?this.colors.gold:undefined);if(label)s.text(label,start+(icon?iconSize+gap:0),r.y+(r.h-fontSize)/2-1,fontSize,textColor,750);c.restore();
 }
 private drawTasks(inWindow=false){
  const s=this.stage,data=this.tasks,p=this.client.profile,pad=12,w=s.w-24,columns=w>=740?2:1,gap=16,cw=(w-gap*(columns-1))/columns;let y=this.bodyTop;
  if(!this.desktop&&!inWindow){s.icon('avatar',{x:pad,y,w:40,h:43});s.text('Lv.'+(p?.level??1),pad+47,y+3,15,this.colors.ink,700);s.meter({x:pad+47,y:y+26,w:70,h:7},(p?.xp??0)/Math.max(1,p?.xpToNext??1));s.icon(this.energyEnabled?'lightning':'coin',{x:s.w-130,y:y+8,w:23,h:27});s.text(this.energyEnabled?(p?.energy??0)+'/'+(p?.energyCap??0):String(p?.collection?.coins??0),s.w-99,y+14,15,this.colors.ink,700,83);if(!this.energyEnabled)s.hit({x:s.w-134,y,w:118,h:45},()=>this.showModal('coins'));y+=55;}
  const tabW=Math.min(220,(w-8)/2),tabH=inWindow?32:38;s.button({x:pad,y,w:tabW,h:tabH},'拼图任务',()=>this.setTaskTab('tasks'),{tone:this.taskTab==='tasks'?'berry':'cream',icon:'daily',fontSize:inWindow?13:15});s.button({x:pad+tabW+8,y,w:tabW,h:tabH},'我的礼包',()=>this.setTaskTab('gifts'),{tone:this.taskTab==='gifts'?'berry':'cream',icon:'gift',fontSize:inWindow?13:15});
  if(!inWindow){const label='补给站',bw=s.measure(label,13,750)+50,wide=w>=tabW*2+8+bw+8;s.button({x:wide?pad+w-bw:pad,y:wide?y:y+tabH+8,w:bw,h:wide?tabH:32},label,()=>this.navigate('supplies'),{icon:'store',fontSize:13});if(!wide)y+=40;}
  this.bodyTop=y+tabH+(inWindow?10:15);if(!data){s.text('正在整理任务与礼包…',pad+8,this.bodyTop+25,14);this.extent=0;return;}
  let cy=this.bodyTop-this.scroll;const gifts=data.inventory.filter(gift=>gift.count>0&&this.giftVisible(gift)),giftCount=gifts.reduce((n,g)=>n+g.count,0),full=(p?.energy??0)>=(p?.energyCap??1);
  const drawGift=(gift:typeof gifts[number],r:Rect)=>{s.panel(r);const art=gift.effect==='full-energy'&&this.energyEnabled?'refillGift':gift.kind.startsWith('ten')?'pouch':gift.kind.startsWith('friend')?'goldGift':'xpChest';s.icon(art,{x:r.x+13,y:r.y+17,w:55,h:57});const title=!this.energyEnabled&&gift.effect==='full-energy'?'邀请礼包':gift.title;s.text(title+' ×'+gift.count,r.x+80,r.y+16,15,this.colors.ink,750,r.w-94);let ry=r.y+45;
   const range=(min:number,max:number)=>String(min)+(max!==min?'～'+max:'');const lines=[this.energyEnabled?(gift.effect==='full-energy'?'恢复至当前体力上限':'体力 +'+range(gift.energyMin,gift.energyMax)):'',(gift.xpMax??gift.xp)>0?'经验 +'+range(gift.xpMin??gift.xp,gift.xpMax??gift.xp):'',(gift.coinsMax??gift.coins??0)>0?'金币 +'+range(gift.coinsMin??gift.coins??0,gift.coinsMax??gift.coins??0):''].filter(Boolean);for(const line of lines){s.text(line,r.x+80,ry,12,this.colors.muted,500,r.w-94);ry+=19;}
   const blocked=this.energyEnabled&&gift.effect==='full-energy'&&full;s.button({x:r.x+12,y:r.y+r.h-45,w:r.w-24,h:34},blocked?'体力已满':gift.effect==='full-energy'&&this.energyEnabled?'使用一份':'开启一份',()=>void this.openGift(gift.kind),{tone:'berry',fontSize:12,disabled:this.busy||blocked});};
  const drawTask=(task:typeof data.tasks[number],r:Rect)=>{s.panel(r);const title=task.title||({beginner:'新手任务',sharing:'分享邀请',invitation:'邀请好友',friend:'好友默契',cooperation:'今日拼合'}[task.group]),art=task.group==='sharing'?'invitationArt':task.group==='invitation'||task.group==='friend'?'friendArt':'cooperationArt';s.icon(art,{x:r.x+12,y:r.y+17,w:53,h:55});s.text(title,r.x+77,r.y+16,16,this.colors.ink,750,r.w-92);const copy=task.group==='sharing'?'每日分享最多 '+task.target+' 次':task.group==='invitation'?'好友完成 '+data.invitation.requiredContributions+' 次有效拼合':'完成 '+task.target+' 次'+(task.group==='friend'?'好友':'')+'拼合';s.text(copy,r.x+77,r.y+45,11,this.colors.muted,500,r.w-92);
   const reward=this.energyEnabled&&task.effect==='full-energy'?'补满体力包'+(task.xp?' · 经验 +'+task.xp:'')+taskCoinsText(task.coins??0):this.rewardText(task.energy,task.xp,task.coins??0);s.text(reward,r.x+14,r.y+86,12,this.colors.ink,600,r.w-28);
   const label=Math.min(task.progress,task.target)+' / '+task.target;s.meter({x:r.x+14,y:r.y+112,w:r.w-87,h:8},task.progress/Math.max(1,task.target));s.text(label,r.x+r.w-66,r.y+108,11,this.colors.muted,700,56);
   const actionable=task.group==='sharing'||task.group==='invitation'||task.earned,action=()=>task.group==='sharing'?void this.shareInvitation():task.group==='invitation'?this.showModal('invite'):this.setTaskTab('gifts');s.button({x:r.x+12,y:r.y+r.h-45,w:r.w-24,h:33},task.group==='sharing'?'分享邀请':task.group==='invitation'?'邀请好友':task.earned?'查看已存礼包':'进行中',action,{tone:actionable?'berry':'cream',fontSize:12,disabled:this.busy||!actionable});};
  const drawGrid=<T,>(items:T[],height:number,draw:(item:T,r:Rect)=>void)=>{const base=cy;items.forEach((item,index)=>{const r={x:pad+(index%columns)*(cw+gap),y:base+Math.floor(index/columns)*(height+gap),w:cw,h:height};if(r.y+r.h>=this.bodyTop&&r.y<=this.bodyBottom)draw(item,r);});cy+=Math.ceil(items.length/columns)*(height+gap);};
  this.scrolled(()=>{if(this.taskTab==='tasks'){
   const beginner=data.tasks.filter(task=>task.group==='beginner');if(beginner.length){s.text('新手任务',pad+2,cy+3,17,this.colors.ink,750);cy+=35;drawGrid(beginner,100,(task,r)=>{s.panel(r);s.icon('coin',{x:r.x+12,y:r.y+14,w:26,h:26});s.text(task.title,r.x+47,r.y+17,14,this.colors.ink,700,r.w-137);s.text('金币 +'+(task.coins??0),r.x+r.w-85,r.y+19,12,this.colors.ink,700,73);s.meter({x:r.x+14,y:r.y+54,w:r.w-91,h:8},task.progress/task.target);s.text(task.progress+' / '+task.target,r.x+r.w-69,r.y+50,11,this.colors.muted,700,57);s.text('达成自动领取 · 每档仅一次',r.x+14,r.y+76,10,this.colors.muted,500,r.w-28);});}
   s.panel({x:pad,y:cy,w,h:85});s.text('十格小礼',pad+15,cy+15,15,this.colors.ink,750);const slotsX=pad+103,slotsW=Math.min(320,w-168),slotW=slotsW/10,slotSize=Math.min(22,Math.max(8,slotW-3));for(let i=0;i<10;i++)s.icon('piece',{x:slotsX+i*slotW+(slotW-slotSize)/2,y:cy+24-slotSize/2,w:slotSize,h:slotSize},i<data.giftProgress?this.colors.rose:this.colors.line);s.text(data.giftProgress+'/10',slotsX+slotsW+8,cy+18,12,this.colors.ink,700);const smallReward=[this.energyEnabled?'体力 +'+(data.giftMinimum??1)+'～'+data.giftMaximum:'',(data.giftXp??0)>0?'经验 +'+data.giftXp:'',(data.giftCoins??0)>0?'金币 +'+data.giftCoins:''].filter(Boolean).join(' · ');s.text('每 10 次有效拼合存入小礼'+(smallReward?'：'+smallReward:''),pad+15,cy+55,11,this.colors.muted,500,w-30);s.hit({x:pad,y:cy,w,h:85},()=>this.setTaskTab('gifts'));cy+=101;
   const featured=data.tasks.filter(t=>t.group==='sharing'||t.group==='invitation');drawGrid(featured,180,drawTask);s.text('今日任务',pad+2,cy+3,17,this.colors.ink,750);cy+=35;drawGrid(data.tasks.filter(t=>t.group==='cooperation'||t.group==='friend'),180,drawTask);
   s.button({x:pad,y:cy,w,h:39},'查看已存礼包 · '+giftCount+' 份',()=>this.setTaskTab('gifts'),{icon:'gift',fontSize:14});cy+=54;
  }else{s.text('存下的小确幸',pad+2,cy+3,19,this.colors.ink,750);s.text('礼包可积累，开启后收下本次奖励',pad+2,cy+33,12,this.colors.muted);cy+=68;if(gifts.length)drawGrid(gifts,168,drawGift);else{s.icon('xpChest',{x:s.w/2-48,y:cy+13,w:96,h:83});const message='继续拼图，收下下一份小礼';s.text(message,(s.w-s.measure(message,14))/2,cy+116,14,this.colors.muted);cy+=177;}const resumeW=Math.min(260,w);s.button({x:pad+(w-resumeW)/2,y:cy,w:resumeW,h:39},'继续拼图',()=>inWindow?this.showModal(null):this.back(),{tone:'berry',fontSize:14});cy+=54;}
  });this.extent=cy-(this.bodyTop-this.scroll)+12;
 }
 private supplyFocus=false;
 private async openAllGifts(){const gifts=(this.tasks?.inventory??[]).filter(gift=>gift.count>0&&this.giftVisible(gift)&&!(this.energyEnabled&&gift.effect==='full-energy'));for(const gift of gifts)await this.openGift(gift.kind,gift.count);}
 private drawTasksPage(){
  const s=this.stage,data=this.tasks,p=this.client.profile,pad=12,w=s.w-24,two=w>=760,gap=16,colW=two?(w-gap)/2:w,ink=this.colors.ink,muted=this.colors.muted;
  if(!data){s.text('正在整理任务与礼包…',pad+8,this.bodyTop+25,14);this.extent=0;return;}
  const columns=[pad,two?pad+colW+gap:pad];let left=this.bodyTop-this.scroll,right=two?left:0;
  const section=(column:0|1,title:string,height:number,draw:(x:number,y:number,w:number)=>void)=>{const x=columns[column],y=column===0||!two?left:right,r={x,y,w:colW,h:height};if(y+height>=this.bodyTop-20&&y<=this.bodyBottom+20){s.panel(r);s.text(title,x+16,y+14,17,ink,800,colW-32);draw(x+16,y+44,colW-32);}if(column===0||!two)left+=height+14;else right+=height+14;return y;};
  let supplyY=0;
  this.scrolled(()=>{
   // 1. 十格小礼
   section(0,'十格小礼',118,(x,y,cw)=>{const slot=Math.min(30,(cw-60)/10);for(let i=0;i<10;i++)s.icon('fragment',{x:x+i*(slot+2),y,w:slot,h:slot},i<data.giftProgress?undefined:this.colors.line);if(data.giftProgress<10){s.ctx.save();s.ctx.globalAlpha=.55;s.ctx.fillStyle=this.colors.cream;for(let i=data.giftProgress;i<10;i++)s.ctx.fillRect(x+i*(slot+2),y,slot,slot);s.ctx.restore();}
    s.text(data.giftProgress+'/10',x+10*(slot+2)+6,y+slot/2-8,15,ink,800);const left=Math.max(0,10-data.giftProgress),reward=[this.energyEnabled?'体力 +'+(data.giftMinimum??1)+'～'+data.giftMaximum:'',(data.giftXp??0)>0?'经验 +'+data.giftXp:'',(data.giftCoins??0)>0?'金币 +'+data.giftCoins:''].filter(Boolean).join(' · ');
    s.text('再拼合 '+left+' 次就能存下一份'+(reward?' · '+reward:''),x,y+slot+12,13,muted,600,cw);});
   // 2. 今日任务
   const daily=data.tasks.filter(task=>task.group==='cooperation'||task.group==='friend');
   section(0,'今日任务',44+daily.length*86+8,(x,y,cw)=>{daily.forEach((task,index)=>{const ty=y+index*86,art=task.group==='friend'?'friendArt':'cooperationArt',done=task.earned||task.progress>=task.target,copy='完成 '+task.target+' 次'+(task.group==='friend'?'好友':'')+'拼合',reward=this.energyEnabled&&task.effect==='full-energy'?'补满体力包'+(task.xp?' · 经验 +'+task.xp:''):this.rewardText(task.energy,task.xp,task.coins??0);
     s.icon(art,{x,y:ty,w:44,h:46});s.text(task.title||copy,x+54,ty+2,15,ink,800,cw-160);s.text(copy,x+54,ty+22,12,muted,600,cw-150);s.meter({x:x+54,y:ty+44,w:cw-134,h:8},task.progress/Math.max(1,task.target));s.text(Math.min(task.progress,task.target)+'/'+task.target,x+cw-74,ty+40,12,muted,700,40);
     if(done)s.text('✓ 礼包已存入',x+cw-92,ty+4,12,'#879864',800,92);s.text('奖励 '+reward,x+54,ty+58,12,done?muted:ink,700,cw-54);});});
   // 3. 新手任务
   const beginner=data.tasks.filter(task=>task.group==='beginner'),current=beginner.find(task=>task.progress<task.target)??beginner[beginner.length-1];
   if(current)section(0,'新手任务',118,(x,y,cw)=>{s.icon('coin',{x,y,w:28,h:30});s.text(current.title,x+38,y+4,15,ink,800,cw-140);s.text('金币 +'+(current.coins??0),x+cw-s.measure('金币 +'+(current.coins??0),14,800),y+5,14,ink,800);s.meter({x,y:y+40,w:cw-70,h:9},current.progress/Math.max(1,current.target));s.text(Math.min(current.progress,current.target)+' / '+current.target,x+cw-62,y+35,13,muted,700,62);s.text('达成自动领取 · 共 '+beginner.length+' 档',x,y+56,12,muted,600,cw);});
   // 4. 我的礼包
   const gifts=data.inventory.filter(gift=>gift.count>0&&this.giftVisible(gift)),full=(p?.energy??0)>=(p?.energyCap??1),giftCols=colW>=420?3:2,giftW=(colW-32-(giftCols-1)*10)/giftCols,giftRows=Math.ceil(gifts.length/giftCols);
   section(1,'我的礼包',gifts.length?44+giftRows*136+56:150,(x,y,cw)=>{
    if(!gifts.length){s.icon('xpChest',{x,y,w:56,h:48});s.text('继续拼图，收下下一份小礼',x+68,y+16,13,muted,600,cw-68);return;}
    gifts.forEach((gift,index)=>{const gx=x+(index%giftCols)*(giftW+10),gy=y+Math.floor(index/giftCols)*136,r={x:gx,y:gy,w:giftW,h:126},art=gift.effect==='full-energy'&&this.energyEnabled?'refillGift':gift.kind.startsWith('ten')?'pouch':gift.kind.startsWith('friend')?'goldGift':'xpChest',blocked=this.energyEnabled&&gift.effect==='full-energy'&&full;
     s.frame(r,'button-linen-normal');s.icon(art,{x:gx+(giftW-52)/2,y:gy+8,w:52,h:50});const title=(!this.energyEnabled&&gift.effect==='full-energy'?'邀请礼包':gift.title)+' ×'+gift.count;s.text(title,gx+(giftW-Math.min(giftW-12,s.measure(title,13,700)))/2,gy+62,13,ink,700,giftW-12);
     s.button({x:gx+8,y:gy+84,w:giftW-16,h:34},blocked?'体力已满':'开启',()=>void this.openGift(gift.kind),{tone:'berry',fontSize:13,disabled:this.busy||blocked});});
    s.button({x,y:y+giftRows*136+4,w:cw,h:38},'全部开启',()=>void this.openAllGifts(),{tone:'berrydark',fontSize:14,disabled:this.busy});});
   // 5. 补给
   const tickets=this.usesCreationTickets,energy=this.energyEnabled;
   if(tickets||energy){const rows=(tickets?1:0)+(energy?1:0);supplyY=section(1,'补给',44+rows*70+10,(x,y,cw)=>{let ry=y;
    if(energy){const stock=p?.supply.energy??0,ad=this.platform.config.id==='taptap'&&this.energyAdAvailable;s.icon('lightning',{x,y:ry,w:28,h:38});s.text('补满体力包 '+stock+'/3',x+38,ry+2,15,ink,800,cw-200);s.text('体力 '+(p?.energy??0)+'/'+(p?.energyCap??0),x+38,ry+24,12,muted,600,cw-200);
     const bw=72;let bx=x+cw-bw;s.button({x:bx,y:ry+4,w:bw,h:34},'使用',()=>void this.useEnergy(),{fontSize:13,disabled:this.busy||!p||stock===0||(p?.energy??0)>=(p?.energyCap??0)});
     if(this.shareAvailable){bx-=bw+6;s.button({x:bx,y:ry+4,w:bw,h:34},'分享领',()=>void this.claimSupply('energy','share'),{tone:'berry',fontSize:13,disabled:this.busy||stock>=3});}
     if(ad){bx-=bw+14;s.button({x:bx,y:ry+4,w:bw+8,h:34},'看广告领',()=>void this.claimSupply('energy'),{tone:'berry',fontSize:13,disabled:this.busy||stock>=3});}ry+=70;}
    if(tickets){const stock=p?.supply.create??0;s.icon('ticket',{x,y:ry,w:34,h:36});s.text('建房券 '+stock+'/3',x+44,ry+2,15,ink,800,cw-170);s.text('私人房或指定图片时使用',x+44,ry+24,12,muted,600,cw-170);
     s.button({x:x+cw-112,y:ry+4,w:112,h:34},stock>=3?'库存已满':this.shareAvailable?'分享领 1 张':'分享暂未开放',()=>void this.claimSupply('create','share'),{tone:'berry',fontSize:13,disabled:this.busy||stock>=3||!this.shareAvailable});}
   });}
   // 6. 邀请好友
   const invitation=data.invitation,invitationTask=data.tasks.find(task=>task.group==='invitation');
   section(1,'邀请好友',this.energyEnabled?292:222,(x,y,cw)=>{s.icon('invitationArt',{x,y,w:70,h:66});const copy=this.energyEnabled?'每位有效好友体力上限 +1（最多 +5），并送补满体力包'+(invitationTask?.xp?'及 '+invitationTask.xp+' 经验':'')+taskCoinsText(invitationTask?.coins??0):'好友接受邀请并完成 '+(invitation?.requiredContributions??3)+' 次有效拼合，你可获得 '+this.rewardText(0,invitationTask?.xp??0,invitationTask?.coins??0)+'，每日最多 '+(invitation?.dailyLimit??3)+' 位。';this.paragraph(copy,x+82,y,cw-82,12,muted);
    if(this.energyEnabled){this.paragraph('好友绑定邀请码并完成 '+(invitation?.requiredContributions??3)+' 次有效拼合；补满包每日最多 '+(invitation?.dailyLimit??3)+' 份。',x,y+76,cw,12,muted);s.text('已加成 '+(invitation?.capBonus??0)+'/'+(invitation?.capBonusMaximum??5),x,y+120,13,this.colors.berry,700);y+=70;}
    s.text('我的邀请码',x,y+84,12,muted,700);s.text(invitation?.code??'正在读取…',x+76,y+80,18,ink,800,cw-76);if(invitation?.code)s.hit({x:x+70,y:y+72,w:Math.min(cw-70,s.measure(invitation.code,18,800)+20),h:34},()=>this.copyInvitationCode(invitation.code));const bw=(cw-10)/2;
    s.button({x,y:y+114,w:bw,h:38},'分享邀请',()=>void this.shareInvitation(),{tone:'berry',icon:'invite',fontSize:14,disabled:this.busy});
    s.button({x:x+bw+10,y:y+114,w:bw,h:38},this.platform.copyText?'复制邀请码':'输入好友邀请码',()=>{if(this.platform.copyText&&invitation?.code)this.copyInvitationCode(invitation.code);else this.showModal('invite');},{fontSize:14});
    s.text('输入好友的邀请码 ›',x,y+160,12,this.colors.berry,700);s.hit({x:x-4,y:y+152,w:140,h:26},()=>this.showModal('invite'));});
  });
  this.extent=Math.max(left,right)+this.scroll-this.bodyTop+12;
  if(this.supplyFocus&&supplyY){this.supplyFocus=false;this.scroll=clamp(supplyY+this.scroll-this.bodyTop-8,0,Math.max(0,this.extent-(this.bodyBottom-this.bodyTop)));this.invalidate();}
 }
 private drawSupplies(){
  if(!this.energyEnabled){this.drawWebSupplies();return;}
  const s=this.stage,p=this.client.profile,pad=12,w=s.w-pad*2,landscape=s.w>650&&s.w>s.h;let y=this.bodyTop-this.scroll+4;
  this.scrolled(()=>{const cw=landscape?(w-12)/2:w,ch=218+(this.platform.config.id==='taptap'&&this.energyAdAvailable?44:0),start=y;
   for(const [index,[kind,title,description,art,smallArt]]of ([['energy','补满体力包','需要时再开启','supplyEnergy','lightning'],['create','建房券','指定图片或私人房间','supplyTicket','ticket']] as const).entries()){
    const x=pad+(landscape?index*(cw+12):0),cy=start+(landscape?0:index*(ch+12)),r={x,y:cy,w:cw,h:ch},imageW=Math.min(110,Math.floor(cw*.32)),imageR={x:x+10,y:cy+10,w:imageW,h:126};s.panel(r);s.clip(imageR,()=>{const edge=Math.max(imageR.w,imageR.h);s.icon(art,{x:imageR.x+(imageR.w-edge)/2,y:imageR.y+(imageR.h-edge)/2,w:edge,h:edge});});
    const dx=x+imageW+20,dw=cw-imageW-32,small=cw<330,stock=p?.supply[kind]??0;
    s.icon(smallArt,{x:dx,y:cy+15,w:22,h:26});s.text(title,dx+28,cy+20,small?16:19,this.colors.ink,700,dw-28);
    this.paragraph(description,dx,cy+52,dw,12,this.colors.ink);
    s.ctx.fillStyle=s.color('#f8e8d8');s.ctx.fillRect(dx,cy+103,dw,28);s.text('库存 '+stock+'/3',dx+8,cy+109,14,this.colors.ink,700,dw-16);
    const energyAd=kind==='energy'&&this.platform.config.id==='taptap'&&this.energyAdAvailable,available=energyAd?this.energyAdAvailable:this.shareAvailable;
    s.button({x:x+12,y:cy+150,w:cw-24,h:43},stock>=3?'库存已满':energyAd?'看广告领1个':this.shareAvailable?(kind==='create'?'分享领1张':'分享领1个'):'分享暂未开放',()=>void this.claimSupply(kind),{tone:'berry',fontSize:14,disabled:this.busy||stock>=3||!available});
    if(energyAd)s.button({x:x+12,y:cy+201,w:cw-24,h:36},stock>=3?'库存已满':'分享领1个',()=>void this.claimSupply('energy','share'),{fontSize:14,disabled:this.busy||stock>=3||!this.shareAvailable});
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
 private albumDetailOpen=false;private decorationFilter:'all'|'owned'|'craft'|'album'='all';
 private drawCollection(){
  const s=this.stage,data=this.collection,desktop=this.desktop,landscape=this.layout==='phoneLandscape',pad=12,w=s.w-pad*2;let y=this.bodyTop;
  const tab=this.collectionTab==='decorations'?'decorations':'albums';
  if(landscape||!(tab==='albums'&&this.albumDetailOpen&&!desktop)){
   const tabs=[['albums','图集','book'],['decorations','装饰','leaf']] as const,tw=Math.min(180,(w-8)/2);
   tabs.forEach(([id,label,icon],index)=>s.button({x:pad+index*(tw+8),y,w:tw,h:landscape?32:38},label,()=>this.changeListView(()=>{this.collectionTab=id;this.albumDetailOpen=false;}),{tone:tab===id?'berry':'linen',icon,fontSize:15}));
   if(landscape&&tab==='albums'&&this.albumDetailOpen)s.button({x:pad+tw*2+24,y,w:84,h:32},'‹ 图集',()=>{this.albumDetailOpen=false;this.scroll=0;this.albumListScroll=0;this.invalidate();},{fontSize:12});
   else if(w>tw*2+200&&!(desktop&&tab==='albums'))s.text(tab==='albums'?'拼完一张图就收进图集，集满有奖励':'装饰会在拖动拼块时展示给同桌',pad+tw*2+24,y+12,13,this.colors.muted,600,w-tw*2-30);
   y+=landscape?40:50;if(!landscape&&w<=tw*2+200&&tab==='albums'){s.text('拼完一张图就收进图集，集满有奖励',pad+2,y-4,12,this.colors.muted,600,w);y+=20;}
  }
  this.bodyTop=y;if(!data){s.text('正在翻开收藏…',pad+8,y+32,15);this.extent=0;return;}
  if(tab==='decorations'){this.drawDecorations(data);return;}
  const albums=this.orderedAlbums(data),selected=albums.find(album=>album.id===this.albumId)??albums.find(album=>this.packFor(data,album.id))??albums[0];
  if(landscape){
   if(this.albumDetailOpen&&selected){
    const leftW=w*.34,gap=12,grid={x:pad+leftW+gap,y,w:w-leftW-gap,h:this.bodyBottom-y};
    this.listColumn={x:this.contentOrigin.x+pad,w:leftW};
    let bottom=y-this.scroll;
    s.clip({x:pad,y,w:leftW,h:grid.h},()=>{
     bottom=this.drawAlbumHeader(data,selected,pad,bottom,leftW,true);
     bottom=this.drawAlbumRewards(data,selected,pad,bottom+6,leftW,true);
    });this.extent=bottom+this.scroll-y+8;
    this.albumListArea={...grid,x:grid.x+this.contentOrigin.x,y:grid.y+this.contentOrigin.y};
    this.albumListExtent=this.albumImageGridHeight(selected,grid.w,3);
    this.albumListScroll=clamp(this.albumListScroll,0,Math.max(0,this.albumListExtent-grid.h));
    s.clip(grid,()=>this.drawAlbumImages(selected,grid.x,y-this.albumListScroll,grid.w,3));
   }else{
    const columns=w>=900?4:3,gap=12,cw=(w-gap*(columns-1))/columns;let bottom=y-this.scroll;
    this.scrolled(()=>{for(let row=0;row<Math.ceil(albums.length/columns);row++){
     let rowBottom=bottom;for(let col=0;col<columns;col++){const album=albums[row*columns+col];if(album)rowBottom=Math.max(rowBottom,this.drawAlbumCard(data,album,{x:pad+col*(cw+gap),y:bottom,w:cw},false,true));}bottom=rowBottom+gap;
    }},y,this.bodyBottom);this.extent=bottom+this.scroll-y;
   }return;
  }
  if(desktop){
   const listW=Math.min(560,w*.5),detail={x:pad+listW+16,y,w:w-listW-16,h:this.bodyBottom-y};
   let ly=y-this.scroll;this.listColumn={x:this.contentOrigin.x+pad-4,w:listW+8};
   this.scrolled(()=>{for(const album of albums)ly=this.drawAlbumCard(data,album,{x:pad,y:ly,w:listW},album.id===selected?.id)+12;},y,this.bodyBottom);this.extent=ly+this.scroll-y;
   if(selected){s.panel(detail);this.albumListArea={x:this.contentOrigin.x+detail.x,y:this.contentOrigin.y+detail.y+8,w:detail.w,h:detail.h-16};let dy=detail.y+16-this.albumListScroll;const inner={x:detail.x+16,w:detail.w-32};
    s.clip({x:detail.x+4,y:detail.y+6,w:detail.w-8,h:detail.h-12},()=>{dy=this.drawAlbumDetail(data,selected,inner.x,dy,inner.w,3);});this.albumListExtent=dy+this.albumListScroll-detail.y;this.albumListScroll=clamp(this.albumListScroll,0,Math.max(0,this.albumListExtent-detail.h+16));}
   return;
  }
  let cy=y-this.scroll;
  this.scrolled(()=>{
   if(this.albumDetailOpen&&selected){s.button({x:pad,y:cy,w:84,h:34},'‹ 图集',()=>{this.albumDetailOpen=false;this.scroll=0;this.invalidate();},{fontSize:14});cy=this.drawAlbumDetail(data,selected,pad,cy+46,w,2);}
   else for(const album of albums)cy=this.drawAlbumCard(data,album,{x:pad,y:cy,w},false)+12;
  },y,this.bodyBottom);this.extent=cy+this.scroll-y+12;
 }
 private packFor(data:MobileCollectionView,albumId:string){return data.packs.find(pack=>pack.id===albumId)??null;}
 /** 日常拾光 (the album without a pack) first, then the packs in catalogue order. */
 private orderedAlbums(data:MobileCollectionView){return [...data.albums.filter(album=>!this.packFor(data,album.id)),...data.albums.filter(album=>this.packFor(data,album.id))];}
 private nextMilestoneText(data:MobileCollectionView,album:CollectionAlbum){
  const next=album.milestones.find(milestone=>!milestone.earned);if(!next)return album.total&&album.collected>=album.total?'已集齐，奖励已发放':'';
  const decoration=next.decorationId?data.decorations.find(item=>item.id===next.decorationId)?.title:'',left=Math.max(0,next.target-album.collected);
  return next.target>=album.total?'集齐送 '+next.coins+' 金币'+(decoration?'和'+decoration:''):'再拼 '+left+' 张得 '+next.coins+' 金币'+(decoration?'和'+decoration:'');
 }
 private openAlbum(id:string){this.albumId=id;this.albumDetailOpen=true;this.albumListScroll=0;if(!this.desktop)this.scroll=0;this.invalidate();}
 private drawAlbumCard(data:MobileCollectionView,album:CollectionAlbum,r:{x:number;y:number;w:number},selected:boolean,compact=false){
  const s=this.stage,pack=this.packFor(data,album.id),ink=this.colors.ink;
  if(compact){const h=164,card={...r,h};s.frame(card,selected?'panel-gold':'button-linen-normal');
   if(pack)s.image(this.client.asset(pack.coverSrc||pack.images[0]?.thumbSrc||''),{x:r.x+5,y:r.y+5,w:r.w-10,h:65},'cover');else s.icon('book',{x:r.x+12,y:r.y+12,w:46,h:46});
   s.text(album.title,r.x+10,r.y+77,15,ink,800,r.w-20);s.text('已收集 '+album.collected+'/'+album.total,r.x+10,r.y+100,12,this.colors.muted,700,r.w-20);
   s.meter({x:r.x+10,y:r.y+121,w:r.w-20,h:8},album.collected/Math.max(1,album.total));
   if(pack&&!pack.owned)s.button({x:r.x+8,y:r.y+133,w:r.w-16,h:26},pack.price+' 解锁',()=>{this.purchase=pack;this.showModal('purchase');},{icon:'coin',fontSize:12,disabled:this.busy});
   else s.text(this.nextMilestoneText(data,album),r.x+10,r.y+140,11,this.colors.muted,600,r.w-20);
   s.hit({...card,h:130},()=>this.openAlbum(album.id));return r.y+h;
  }
  if(!pack){const h=100,card={...r,h};s.frame(card,selected?'panel-gold':'button-linen-normal');s.icon('book',{x:r.x+14,y:r.y+18,w:44,h:40});s.text(album.title,r.x+68,r.y+14,17,ink,800,r.w-170);s.text('每日拼图自动收进来',r.x+68,r.y+38,12,this.colors.muted,600,r.w-170);
   const count=album.collected+' / '+album.total;s.text(count,r.x+r.w-14-s.measure(count,15,800),r.y+16,15,ink,800);s.meter({x:r.x+68,y:r.y+60,w:r.w-84,h:9},album.collected/Math.max(1,album.total));s.text(this.nextMilestoneText(data,album),r.x+68,r.y+76,12,this.colors.muted,600,r.w-84);s.hit(card,()=>this.openAlbum(album.id));return r.y+h;}
  const coverH=Math.min(170,r.w*.42),h=coverH+52,card={...r,h},cover={x:r.x+6,y:r.y+6,w:r.w-12,h:coverH},locked=!pack.owned&&album.collected===0;
  s.frame(card,selected?'panel-gold':'button-linen-normal');s.image(this.client.asset(pack.coverSrc||pack.images[0]?.thumbSrc||album.images[0]?.thumbSrc||''),cover,'cover');
  const c=s.ctx,shade=c.createLinearGradient(0,cover.y+coverH*.35,0,cover.y+coverH);shade.addColorStop(0,'#2a142000');shade.addColorStop(1,'#2a1420d9');c.fillStyle=shade;c.fillRect(cover.x,cover.y,cover.w,cover.h);
  s.text(album.title,cover.x+14,cover.y+coverH-52,20,'#fff8ec',800,cover.w-130);s.text(album.description,cover.x+14,cover.y+coverH-24,12,'#fff3e2',500,cover.w-28);
  const badge=locked?'未解锁':album.collected>=album.total?album.collected+' / '+album.total+' ✓':album.collected+' / '+album.total,bw=s.measure(badge,13,800)+18;c.fillStyle=s.color(locked?'#573b40':'#a85567');c.fillRect(cover.x+cover.w-bw-10,cover.y+10,bw,24);s.text(badge,cover.x+cover.w-bw+(-1),cover.y+15,13,'#fffaf0',800);
  const fy=r.y+coverH+16;s.text(this.nextMilestoneText(data,album),r.x+14,fy+2,13,ink,600,r.w-140);
  if(!pack.owned){s.button({x:r.x+r.w-116,y:fy-6,w:104,h:34},pack.price+' 解锁',()=>{this.purchase=pack;this.showModal('purchase');},{tone:'berrydark',icon:'coin',fontSize:13,disabled:this.busy});s.hit({x:r.x,y:r.y,w:r.w-120,h},()=>this.openAlbum(album.id));}
  else{s.text('查看 ›',r.x+r.w-60,fy+2,13,this.colors.berry,700);s.hit(card,()=>this.openAlbum(album.id));}
  return r.y+h;
 }
 private drawAlbumHeader(data:MobileCollectionView,album:CollectionAlbum,x:number,y:number,w:number,compact=false){
  const s=this.stage,ink=this.colors.ink,stack=compact||w<430,progressW=stack?w:Math.min(200,w*.38),titleW=stack?w:w-progressW-16;
  s.icon('book',{x,y,w:compact?26:36,h:compact?28:38});s.text(album.title,x+(compact?32:44),y+4,compact?16:21,ink,800,titleW-(compact?32:44));
  const descriptionY=y+(compact?32:44),descriptionH=s.wrap(album.description,x,descriptionY,titleW,compact?11:12,this.colors.muted,16);
  const py=stack?descriptionY+descriptionH+6:y+3,px=stack?x:x+w-progressW;
  s.icon('piece',{x:px,y:py,w:18,h:20});s.text('已收集 '+album.collected+'/'+album.total,px+24,py+3,compact?12:14,ink,700,progressW-24);
  // Stage.meter clamps the fraction and paints its rounded fill inside the track.
  s.meter({x:px,y:py+27,w:progressW,h:9},album.collected/Math.max(1,album.total));
  let bottom=Math.max(descriptionY+descriptionH,py+36)+12;const pack=this.packFor(data,album.id);
  if(pack&&!pack.owned){s.button({x,y:bottom,w:Math.min(w,210),h:compact?28:34},pack.price+' 金币 · 解锁图包',()=>{this.purchase=pack;this.showModal('purchase');},{icon:'coin',tone:'berrydark',fontSize:12,disabled:this.busy});bottom+=compact?34:42;}
  return bottom;
 }
 private drawAlbumRewards(data:MobileCollectionView,album:CollectionAlbum,x:number,y:number,w:number,compact=false){
  if(!album.milestones.length)return y;
  const s=this.stage,ink=this.colors.ink,final=[...album.milestones].reverse().find(m=>m.decorationId),decoration=data.decorations.find(d=>d.id===final?.decorationId),tagW=decoration?Math.min(compact?80:150,w*.38):0,h=138;
  s.panel({x,y,w,h});const left=x+22,right=x+w-tagW-26,trackW=Math.max(1,right-left),ty=y+28,total=Math.max(1,album.total,...album.milestones.map(m=>m.target));
  s.meter({x:left,y:ty,w:trackW,h:9},album.collected/total);
  for(const milestone of album.milestones){const nx=left+trackW*clamp(milestone.target/total,0,1),reached=album.collected>=milestone.target;
   s.frame({x:nx-11,y:ty-7,w:22,h:22},reached?'segment-berry-selected':'button-linen-normal');
   if(reached)s.icon('check',{x:nx-7,y:ty-3,w:14,h:14});else s.icon('lock',{x:nx-6,y:ty-2,w:12,h:14});
   s.text(milestone.target+'张',nx-s.measure(milestone.target+'张',11,700)/2,ty+22,11,ink,700);
   const reward=data.decorations.find(d=>d.id===milestone.decorationId);
   if(milestone.coins){s.icon('coin',{x:nx-9,y:ty+42,w:18,h:20});s.text(milestone.coins,nx-s.measure(String(milestone.coins),10,700)/2,ty+65,10,ink,700);}
   if(reward)s.decoration(reward,{x:nx-12,y:ty+(milestone.coins?80:43),w:24,h:26});
  }
  if(decoration){const tx=x+w-tagW;s.frame({x:tx,y:y+10,w:tagW-8,h:24},'segment-berry-selected');s.text('集齐可得',tx+5,y+16,compact?10:12,this.colors.onAccent,700,tagW-18);
   s.decoration(decoration,{x:tx+4,y:y+40,w:28,h:30});s.text(decoration.title,tx+2,y+76,compact?10:13,ink,800,tagW-10);
   s.clip({x:tx,y:y+94,w:tagW-8,h:h-98},()=>s.wrap(decoration.description,tx+2,y+96,tagW-12,10,this.colors.muted,14));
  }return y+h+12;
 }
 private albumImageGridHeight(album:CollectionAlbum,w:number,columns:number){const cw=(w-12*(columns-1))/columns;return Math.ceil(album.images.length/columns)*(cw*.72+78);}
 private drawAlbumImages(album:CollectionAlbum,x:number,y:number,w:number,columns:number){
  const s=this.stage,ink=this.colors.ink,gap=12,cw=(w-gap*(columns-1))/columns,ih=cw*.72,ch=ih+66;
  album.images.forEach((image,index)=>{const cx=x+(index%columns)*(cw+gap),cy=y+Math.floor(index/columns)*(ch+gap),r={x:cx,y:cy,w:cw,h:ch},art={x:cx+5,y:cy+5,w:cw-10,h:ih};if(cy+ch<0||cy>s.h)return;
   s.frame(r,'button-linen-normal');s.image(this.client.asset(image.thumbSrc),art,'cover');
   s.text(image.title,cx+9,cy+ih+13,12,image.collected?ink:this.colors.muted,700,cw-18);
   const pill={x:cx+8,y:cy+ih+34,w:cw-16,h:24};s.frame(pill,'button-linen-normal');s.icon(image.collected?'leaf':'lock',{x:pill.x+6,y:pill.y+4,w:15,h:16});s.text(image.collected?'已收藏':'未收集',pill.x+25,pill.y+6,11,this.colors.muted,700,pill.w-28);
   if(image.difficulties.length){const badge=String(Math.max(...image.difficulties)),bw=Math.min(art.w-8,s.measure(badge,11,700)+28);s.frame({x:art.x+art.w-bw-4,y:art.y+4,w:bw,h:22},'button-linen-normal');s.icon('piece',{x:art.x+art.w-bw,y:art.y+8,w:13,h:14});s.text(badge,art.x+art.w-bw+16,art.y+9,11,ink,700,bw-20);}
   if(!image.collected)s.hit(r,()=>this.playImage(image.id));
  });return y+this.albumImageGridHeight(album,w,columns);
 }
 private drawAlbumDetail(data:MobileCollectionView,album:CollectionAlbum,x:number,y:number,w:number,columns:number){
  y=this.drawAlbumHeader(data,album,x,y,w);
  y=this.drawAlbumImages(album,x,y+4,w,columns);
  return this.drawAlbumRewards(data,album,x,y+8,w);
 }
 private playImage(id:string){
  if(!this.availableGallery().some(photo=>photo.id===id)){this.note('这张图会出现在每日拼图里，留意大厅的今日拼图');return;}
  this.navigate('gallery',{source:'all',category:'全部',direction:'all',search:'',packId:null});this.selected=id;this.invalidate();
 }
 private drawDecorations(data:MobileCollectionView){
  // The server lists gift rewards only to owners; show the rest as locked cards from the bundled catalogue.
  const gifts:CollectionDecoration[]=collectionCatalog.rewardDecorations.filter(item=>!data.decorations.some(d=>d.id===item.id)).map(item=>({...item,kind:'cursor',source:'gift',owned:false,equipped:false}));
  const s=this.stage,pad=12,w=s.w-24,ink=this.colors.ink,filter=this.decorationFilter,all=[...data.decorations,...gifts];
  const matches=(item:CollectionDecoration)=>filter==='owned'?item.owned:filter==='craft'?!item.owned&&item.source==='craft':filter==='album'?item.source==='album':true;
  const decorations=all.filter(matches),selected=all.find(item=>item.id===this.decorationId)??all.find(item=>item.equipped)??all[0],hints=selected&&!selected.owned?collectionDecorationRewardHints(selected,data.albums):[];let y=this.bodyTop-this.scroll;
  this.scrolled(()=>{
   if(selected){const wide=w>=560,h=wide?190:280,r={x:pad,y,w,h};s.panel(r);
    const mock={x:pad+12,y:y+12,w:wide?w*.42:w-24,h:wide?h-24:120};s.ctx.fillStyle=this.colors.placeholder;s.ctx.fillRect(mock.x,mock.y,mock.w,mock.h);s.text('同桌看到的样子',mock.x+10,mock.y+8,12,this.colors.muted,700);
    const cx=mock.x+mock.w*.42,cy=mock.y+mock.h*.5;s.decoration(selected,{x:cx-34,y:cy-30,w:40,h:44});const tag={x:cx+6,y:cy+6,w:Math.min(150,mock.w*.5),h:34};s.frame(tag,'button-linen-normal');s.icon('avatar',{x:tag.x+4,y:tag.y+3,w:24,h:27});s.text(data.profile.name,tag.x+32,tag.y+4,12,ink,700,tag.w-36);s.text('Lv.'+data.profile.level,tag.x+32,tag.y+18,11,this.colors.muted,600);
    const tx=wide?mock.x+mock.w+16:pad+14,ty=wide?y+16:mock.y+mock.h+12,tw=wide?w-mock.w-40:w-28;s.text(selected.title,tx,ty,18,ink,800,tw);let dy=ty+28+s.wrap(selected.description,tx,ty+28,tw,12,ink,18);for(const hint of hints)dy+=s.wrap(hint,tx,dy,tw,12,this.colors.muted,17);
    const label=selected.equipped?'使用中':selected.owned?'使用这个装饰':selected.source==='gift'?'论坛或评论区反馈获得':selected.source==='album'?'集齐图集获得':data.wallet.fragments<selected.cost?'碎片不足 · '+data.wallet.fragments+'/'+selected.cost:'制作 · '+selected.cost+' 碎片',disabled=selected.equipped||(!selected.owned&&(selected.source!=='craft'||selected.enabled===false||data.wallet.fragments<selected.cost));
    s.button({x:tx,y:y+h-52,w:Math.min(240,tw),h:40},label,()=>void this.collectionAction(selected.owned?'equip':'craft',selected.id),{tone:'berrydark',fontSize:14,disabled:disabled||this.busy});y+=h+12;}
   const tuning=data.tuning;y=this.paragraph('碎片来自拼图：每拼合 '+(tuning?.fragmentContributionStep??10)+' 块得 1 片，拼完一张最多 '+(tuning?.completionFragmentMaximum??10)+' 片 · 现有 '+data.wallet.fragments+' 片',pad+2,y,w,12)+12;
   const chip=(value:typeof filter,label:string):[string,boolean,()=>void]=>[label,filter===value,()=>this.changeListView(()=>{this.decorationFilter=value;})];
   y=this.drawChips(pad,y,Math.min(w,440),32,[chip('all','全部 '+all.length),chip('owned','已拥有'),chip('craft','可制作'),chip('album','图集奖励')])+12;
   const columns=w>=760?4:w>=520?3:2,gap=12,cw=(w-gap*(columns-1))/columns,h=112,base=y;
   decorations.forEach((item,index)=>{const x=pad+index%columns*(cw+gap),cy=base+Math.floor(index/columns)*(h+gap),r={x,y:cy,w:cw,h};if(cy+h<this.bodyTop||cy>this.bodyBottom)return;
    s.frame(r,selected?.id===item.id?'panel-gold':'button-linen-normal');s.decoration(item,{x:x+10,y:cy+12,w:44,h:50});s.text(item.title,x+62,cy+14,14,ink,800,cw-70);
    let status=item.equipped?'使用中':item.owned?'已拥有':'',tone=item.equipped?'#a85567':'#879864';
    if(!status&&item.source==='craft'){s.icon('fragment',{x:x+62,y:cy+38,w:16,h:18});s.text(item.cost+' 碎片',x+82,cy+40,13,ink,700);}
    else if(!status&&item.source==='gift')s.wrap('论坛/评论区\n反馈获得',x+62,cy+40,cw-70,12,'#8a5a5f',17);
    else if(!status){const album=data.albums.find(a=>a.id===item.albumId);status='集齐「'+(album?.title??'图集')+'」获得';tone='#8a5a5f';if(album){s.meter({x:x+62,y:cy+64,w:cw-74,h:7},album.collected/Math.max(1,album.total));s.text(album.collected+'/'+album.total,x+62,cy+76,12,this.colors.muted,700);}}
    if(status)s.text(status,x+62,cy+40,13,tone,700,cw-70);
    s.hit(r,()=>{this.decorationId=item.id;this.scroll=0;this.invalidate();});});
   y=base+Math.ceil(decorations.length/columns)*(h+gap)+8;
  });this.extent=y-(this.bodyTop-this.scroll);
 }
 private openPackPreview(pack:CollectionPack){if(!pack.images.length)return;this.previewReadOnly=false;this.previewPack=pack;this.previewIndex=-1;this.previewGridScroll=0;this.stage.retryImages();this.showModal('packPreview');}
 private returnToPackGrid(){if(this.previewReadOnly){this.showModal(null);return;}this.previewIndex=-1;this.modalScroll=this.previewGridScroll;this.invalidate();}
 private stepPackPreview(delta:number){if(!this.previewPack)return;this.previewIndex=clamp(this.previewIndex+delta,0,this.previewPack.images.length-1);this.modalScroll=0;this.invalidate();}
 private drawPackPreview(){
  const pack=this.previewPack;if(!pack)return;
  const s=this.stage,v=this.platform.viewport(),w=Math.min(920,s.w-24),columns=w>=720?4:2,gap=w>=720?16:12,pad=20,cw=(w-pad*2-gap*(columns-1))/columns,rowH=cw+36,rows=Math.ceil(pack.images.length/columns),h=Math.min(s.h-v.top-v.bottom-28,84+Math.min(rows,3)*(rowH+gap)+94),x=(s.w-w)/2,y=v.top+(s.h-v.top-v.bottom-h)/2,footerY=y+h-(this.previewReadOnly?10:80);
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
   if(!this.previewReadOnly)s.button({x:x+20,y:y+45,w:138,h:28},'‹ 返回全部图片',()=>this.returnToPackGrid(),{fontSize:12});
   this.modalExtent=0;this.modalScroll=0;const image=pack.images[this.previewIndex],area=this.modalArea,art={x:x+20,y:area.y+2,w:w-40,h:Math.max(20,area.h-54)};
   s.frame(art,'panel-cream');s.image(this.client.asset(image.src||image.thumbSrc),{x:art.x+5,y:art.y+5,w:art.w-10,h:art.h-10},'contain');s.ornaments(art,16);
   const captionY=art.y+art.h+12;s.text(image.title,x+20,captionY,14,this.colors.ink,700,w-190);
   const counter=(this.previewIndex+1)+' / '+pack.images.length;s.text(counter,x+w-104-s.measure(counter,12,700)/2,captionY+3,12,this.colors.muted,700);
   s.button({x:x+w-167,y:captionY-4,w:31,h:28},'‹',()=>this.stepPackPreview(-1),{disabled:this.previewIndex===0,fontSize:19});s.button({x:x+w-72,y:captionY-4,w:31,h:28},'›',()=>this.stepPackPreview(1),{disabled:this.previewIndex===pack.images.length-1,fontSize:19});
  }
  if(this.previewReadOnly)return;
  s.ctx.fillStyle=this.colors.rose;s.ctx.fillRect(x+20,footerY, w-40,1);
  const buttonW=Math.min(245,w-40),buttonX=x+(w-buttonW)/2;
  s.button({x:buttonX,y:footerY+13,w:buttonW,h:36},pack.owned?'已拥有 · 去建房':pack.price+' 金币 · 解锁图包',()=>{if(pack.owned)this.openPackGallery(pack.id);else{this.purchase=pack;this.showModal('purchase');}},{tone:'berry',icon:pack.owned?'check':'coin',fontSize:14,disabled:this.busy});
  const hint=pack.owned?'随时选择喜欢的图片开拼':'永久解锁 · 免费公开建房';s.text(hint,x+(w-s.measure(hint,11))/2,footerY+58,11,this.colors.muted);
 }
 private drawPolicy(){const s=this.stage;let y=this.bodyTop-this.scroll;const sections=this.route==='privacy'||this.route==='terms'?[...mobilePrivacySections,...mobileTermsSections]:[
  ['一起拼图','拖动拼块，靠近正确位置松开即可拼合。双指缩放和平移，电脑可滚轮缩放、空格或中键平移；'+(this.platform.config.id==='web'?'“适配”可找回完整桌面。':'“定位”会闪亮标出所有未拼块，压在拼好画面上的也能找到；“更多”里可启用锁定按钮，锁定后单指只拖拼块不移动画面；原图小窗点开后可双指放大查看；“更多”里可适配完整桌面。')+'边缘筛选和整理可帮助寻找拼块。'],
  [this.energyEnabled?'体力与经验':'拼合与经验',this.energyEnabled?contributionCopy(this.client.profile)+' '+recoveryCopy(this.client.profile):'浏览器拼图不消耗体力。有效拼合可获得经验，金币和装饰按统一奖励规则结算。'],
  ['房间与收藏','随机公开房免费创建。指定图片或私人房使用建房券；已购图包可免费创建公开房。同时最多保留3个未结束的自建房间。'],
  ['邀请与礼包',this.energyEnabled?'好友首次接受邀请并完成3次有效拼合，邀请者可获得补满体力包，每日最多3位。与好友实际协作，还可积累每日任务礼包。':'与好友实际参与拼图，可以积累任务礼包；金币与经验奖励以任务页面展示为准。'],
 ];this.scrolled(()=>{for(const[title,text]of sections){s.text(title,20,y,18,this.colors.ink,700);y=this.paragraph(text,20,y+31,s.w-40,14)+24;}if(!this.formalWeb){this.button(20,y,s.w-40,'个人资料访问与删除申请',()=>this.showModal('privacyRequests'));y+=48;}this.button(20,y,s.w-40,'服务与隐私说明',()=>this.navigate('privacy'));y+=52;});this.extent=y-(this.bodyTop-this.scroll);}

 private drawRoom(){
  if(this.nineGridRoom){this.drawNineGrid();return;}
  const s=this.stage,room=this.room,board=this.board,view=this.platform.viewport(),p=this.client.profile;
  if(!room||!board){s.text('尚未加入房间',20,view.top+35,18);this.button(20,view.top+81,s.w-40,'返回大厅',()=>this.navigate('lobby'));return;}
  const visible=!this.hidden&&!this.modalBlocksInput;if(visible!==this.cursorVisible){this.cursorVisible=visible;if(visible)this.cursor?.refresh();else this.clearRoomPointer();}
  const layout=this.layout,c=s.ctx,safeBottom=s.h-view.bottom,headerTop=this.roomHeaderTop();
  if(layout==='desktop'){
   const panel=this.roomPanelCollapsed?32:300,bar=60;this.roomArea={x:0,y:bar,w:s.w-panel,h:s.h-bar};
   this.placeBoard(board,0,()=>this.desktopFit(board));
   c.fillStyle=this.colors.cream;c.fillRect(0,0,s.w,bar);c.fillStyle=this.colors.line;c.fillRect(0,bar-1,s.w,1);
   this.drawRoomTopBar({x:0,y:0,w:s.w,h:bar},'desktop');this.drawDesktopTools(this.roomArea.x+12,bar+12,safeBottom);
   if(!this.roomPanelCollapsed)this.drawRoomPanel({x:s.w-panel,y:bar,w:panel,h:s.h-bar});
   s.button({x:s.w-panel,y:bar+4,w:32,h:32},this.roomPanelCollapsed?'\u2039':'\u203a',()=>this.setRoomPanelCollapsed(!this.roomPanelCollapsed),{fontSize:22});
   this.drawRoomGift(this.roomArea.x+10,safeBottom-62,true);this.drawZoomControl(this.roomArea.x+this.roomArea.w-150,safeBottom-50);
  }else if(layout==='phoneLandscape'){
   const web=this.platform.config.id==='web',column=web?62:this.landscapeToolsOpen?72:0;this.roomArea={x:0,y:0,w:s.w-column,h:safeBottom};
   this.placeBoard(board,headerTop+58,()=>this.phoneFit(board,'height'));
   this.drawRoomTopBar({x:0,y:headerTop,w:s.w-column,h:52},'landscape');
   if(web){c.fillStyle=this.colors.cream;c.fillRect(s.w-column,0,column,s.h);c.fillStyle=this.colors.line;c.fillRect(s.w-column,0,2,s.h);this.drawToolColumn({x:s.w-column+2,y:headerTop+6,w:column-2,h:safeBottom-headerTop-6});}
   else this.drawToolColumn({x:s.w-72,y:0,w:72,h:s.h});
   if(web)this.drawRoomGift(8,safeBottom-50,false);else if(!board.previewZoomed){this.drawChatBubble(0);this.drawRoomGift(12,safeBottom-(this.landscapeChatVisible?88:50),false);this.drawBoardQuickTools(this.roomArea.x+this.roomArea.w-58,safeBottom-4);}
  }else{
   const headerBottom=headerTop+76;this.roomArea={x:0,y:headerBottom+1,w:s.w,h:Math.max(90,safeBottom-headerBottom-1)};
   this.placeBoard(board,6,()=>this.phoneFit(board,'width'));
   c.fillStyle=this.colors.cream;c.fillRect(0,0,s.w,headerBottom);c.fillStyle=this.colors.line;c.fillRect(0,headerBottom,s.w,1);
   this.drawRoomTopBar({x:0,y:headerTop,w:s.w,h:76},'portrait');
   // The large reference covers the board like a dialog; its own close button and backdrop dismiss it.
   if(!board.previewZoomed){this.drawChatBubble(headerBottom+8);this.drawRoomGift(10,safeBottom-62,true);if(!this.toolsOpen)this.drawBoardQuickTools(s.w-61,safeBottom-67);this.drawRoomTools({x:s.w-63,y:safeBottom-65,w:50,h:50},false);}
  }
  if(!this.imageReady){const preparation=board.imagePreparation??{phase:'loading',completed:0,total:0},label=preparation.phase==='preparing'?'正在准备碎片 '+preparation.completed+'/'+preparation.total+'…':preparation.phase==='loading'?'正在加载图片…':'正在铺开拼图…',r=this.roomArea,w=Math.min(r.w-36,420);s.panel({x:r.x+(r.w-w)/2,y:r.y+20,w,h:74});this.paragraph(this.imageError||label,r.x+(r.w-w)/2+12,r.y+37,w-24,14);if(this.imageError)this.button(r.x+(r.w-w)/2+7,r.y+104,w-14,'重新加载图片',()=>void this.run(()=>this.retryRoomImage(board)));}
  if(this.platform.config.previewTestRoom){
   const d=this.realtime?.diagnostics(),active=d?.previewConnected===true,available=d?.preview==='taptap-test',label=active?'平台同步已接通':'原通道 · '+String(d?.previewDetail||'当前房间未启用平台预览'),w=Math.min(this.roomArea.w-24,420),x=this.roomArea.x+12,y=this.roomArea.y+5;
   s.panel({x,y,w,h:43});s.text('联机自测 D4：'+label,x+8,y+6,10,this.colors.ink,600,w-16);
   s.text(available?'目标 '+(d.previewTargetHz??'—')+'/秒 · 实发 '+(d.platformSendRate??0)+' · 成功 '+(d.platformSucceeded??0)+' · 失败 '+(d.platformFailed??0)+' · 收 '+(d.platformReceived??0):'平台统计未启用 · 点击查看原因',x+8,y+24,9,this.colors.muted,600,w-16);
   s.hit({x,y,w,h:43},()=>this.showModal('settings'));
  }
  if(this.completionFx)this.drawCompletionTransition();this.drawSettleButton();
  if(!room.connected)this.drawReconnectBanner(room);
  this.drawStoryIntro();
  if(!this.storyIntro){if(this.roomGuideStep)this.drawRoomGuide();else if(this.imageReady&&!this.modal&&!this.roomGuideSeen()){this.roomGuideStep=1;this.invalidate();}}
 }
 private drawCompletionTransition(){
  const fx=this.completionFx,board=this.board;if(!fx||!board||this.nineGridRoom)return;const s=this.stage,c=s.ctx,now=Date.now(),p=board.pictureScreenRect(),room=this.roomArea,left=Math.max(room.x,p.x-p.w*.2),right=Math.min(room.x+room.w,p.x+p.w*1.2),top=Math.max(room.y,p.y),bottom=Math.min(room.y+room.h,p.y+p.h),area={x:left,y:top,w:right-left,h:bottom-top};
  if(area.w>0&&area.h>0){c.save();c.beginPath();c.rect(room.x,room.y,room.w,room.h);c.clip();drawCelebration(c,fx.celebration,now,{picture:p,field:{x:area.x,y:room.y,w:area.w,h:area.y+area.h-room.y},clip:room});c.restore();}
  const banner=fx.banner(now);if(!banner)return;const label='拼好啦！',w=s.measure(label,15,800)+58,h=32,x=clamp(p.x+p.w/2-w/2,room.x+8,room.x+room.w-w-8),topSafe=this.layout==='phoneLandscape'?this.roomHeaderTop()+58:room.y+10,y=Math.min(p.y+p.h/2,Math.max(topSafe,p.y-42)),scale=banner.scale,r={x:x+w*(1-scale)/2,y:y+h*(1-scale)/2,w:w*scale,h:h*scale};c.save();c.globalAlpha=banner.alpha;s.frame(r,'button-gold-normal');s.text(label,r.x+29*scale,r.y+8*scale,15*scale,this.colors.ink,800);drawCheerIcon(c,'star',{x:r.x+7*scale,y:r.y+8*scale,w:16*scale,h:16*scale});drawCheerIcon(c,'star',{x:r.x+r.w-23*scale,y:r.y+8*scale,w:16*scale,h:16*scale});c.restore();
 }
 private drawSettleButton(){
  this.settleButtonRect=null;if(!this.room?.snapshot.completedAt||this.completionFx||this.modal!==null||this.nineGridRoom||this.room.snapshot.levelId)return;const area=this.roomArea,safeBottom=this.stage.h-this.platform.viewport().bottom,x=area.x+(area.w-112)/2,y=safeBottom-(this.layout==='phoneLandscape'?12:14)-36;this.settleButtonRect={x,y,w:112,h:36};this.button(x,y,112,'查看结算',()=>this.openCompletionPopup(),'gold',36);
 }
 private roomZoomBase=1;
 private placeBoard(board:PuzzleBoard,topInset:number,fit:()=>void){
  board.phoneLandscapeRoom=this.platform.config.id!=='web'&&this.layout==='phoneLandscape';
  board.selfDecoration=this.client.profile?.collection?.equipped??null;board.previewTopInset=topInset;board.setRect(this.roomArea);
  if(this.roomViewPending){fit();this.roomZoomBase=board.camera.z;this.roomViewPending=false;}board.draw(this.stage.ctx);
 }
 private desktopFit(board:PuzzleBoard){board.fit(false,{bottom:56,left:this.desktopToolsOpen?104:72});}
 private fitRoom(){const board=this.board;if(!board)return;if(this.layout==='desktop')this.desktopFit(board);else this.phoneFit(board,this.layout==='phonePortrait'?'width':'height');this.roomZoomBase=board.camera.z;}
 /** Phones open on the whole table, with the target and loose pieces visible. */
 private phoneFit(board:PuzzleBoard,axis:'width'|'height'){
  board.openMobileView({bottom:axis==='width'?72:8});
 }
 private roomTool(kind:string){
  if(this.completionFx&&['edge','fit','locate','hint','underlay','organize'].includes(kind))return;
  const board=this.board;if(!board)return;
  if(this.offlineRoom&&['hint','underlay','chat'].includes(kind)){this.note(OFFLINE_REQUIRED);return;}
  if(kind==='edge')board.edgeOnly=!board.edgeOnly;else if(kind==='hint'||kind==='underlay'){if(!this.assistanceUnavailable(kind))void this.activateAssistance(kind);}else if(kind==='fit')this.fitRoom();else if(kind==='locate')this.locateLoose();
  else if(kind==='orientation')void this.toggleOrientation();else if(kind==='organize'&&this.soloRoom)void this.run(async()=>{await this.room?.organize();this.note('散片已整理');});else if(kind==='chat')this.showModal('chat');else if(kind==='more')this.showModal('tools');
  this.toolsOpen=false;this.invalidate();
 }
 private get soloRoom(){return this.room?.snapshot.visibility==='solo';}
 /** Outside Web the fit slot locates loose pieces; fitting the whole table stays under 更多. */
 private get roomTools(){return ([['edge','边缘','E'],['hint','提示','H'],['underlay','底图','B'],this.platform.config.id==='web'?['fit','适配','F']:['locate','定位','L'],['organize','整理','R']] as const).filter(([kind])=>kind!=='organize'||this.soloRoom);}
 private locateLoose(){
  const board=this.board;if(!board)return;
  const count=board.locateLoose(this.roomLocateInsets());
  this.note(count?'已标出 '+count+' 块未拼的拼块'+(board.edgeOnly?'（边缘筛选中）':''):board.edgeOnly?'边缘拼块都已归位，关闭边缘筛选可找其余拼块':'所有拼块都已归位');
 }
 private roomLocateInsets(){const layout=this.layout;return layout==='desktop'?{bottom:56,left:this.desktopToolsOpen?104:72}:layout==='phoneLandscape'?{top:this.roomHeaderTop()+56-this.roomArea.y,bottom:8}:{bottom:72};}
 private toolActive(kind:string){return kind==='edge'?!!this.board?.edgeOnly:kind==='locate'?!!this.board?.locating:kind==='hint'||kind==='underlay'?!!this.activeAid(kind):false;}
 private drawAidBadge(kind:string,right:number,y:number){
  if(kind!=='hint'&&kind!=='underlay')return;const s=this.stage,c=s.ctx,active=this.activeAid(kind),free=this.aid?.freeRemaining?.[kind]??0,pending=!this.aid||this.busy;
  const badge=active?Math.ceil((active.expiresAt-Date.now())/1000)+'秒':pending?'读取中':this.aid?.newcomerProtected?'新手免费':free>0?'免费'+free+'次':this.shareAvailable?'分享':'暂未开放',ad=!active&&!pending&&!this.aid?.newcomerProtected&&free===0,bw=s.measure(badge,10,600)+8,bx=right-bw;
  c.fillStyle=s.color(ad?'#ba667e':active?'#fae7b8':pending?'#eee7db':'#f2efd8');c.fillRect(bx,y,bw,16);s.text(badge,bx+4,y+2,10,ad?'#fffaf0':active?'#83542f':'#7a7244',600,bw-6);
 }
 private roomIcon(kind:string){return kind==='orientation'?'orientation':kind==='organize'?'piece':kind==='more'?'tools':kind==='chat'?'chat':kind;}
 private drawDesktopTools(x:number,y:number,safeBottom:number){
  const s=this.stage;
  if(!this.desktopToolsOpen){const toggle={x,y,w:48,h:48};this.roomToolsArea=toggle;s.frame(toggle,'button-cream-normal');s.icon('tools',{x:x+12,y:y+6,w:24,h:24});s.text('T',x+20,y+31,11,this.colors.muted,700);s.hit(toggle,()=>this.setDesktopToolsOpen(true));return;}
  const items=[...this.roomTools,['more','更多','']] as const,header=36,padding=8,available=safeBottom-80-y-header-padding,h=Math.min(66,available/items.length),r={x,y,w:80,h:header+items.length*h+padding};this.roomToolsArea=r;
  s.hit(r,()=>{});this.drawLandscapeSurface(r,10,this.colors.cream,this.colors.line,1,2);
  s.text('工具',x+10,y+12,12,this.colors.ink,700);s.button({x:x+r.w-34,y:y+4,w:28,h:28},'‹',()=>this.setDesktopToolsOpen(false),{fontSize:22});
  items.forEach(([kind,label,key],index)=>{const b={x:r.x+8,y:r.y+header+index*h,w:r.w-16,h:h-8},active=this.toolActive(kind),disabled=(kind==='hint'||kind==='underlay')&&this.assistanceUnavailable(kind);
   s.frame(b,active?'button-cream-selected':disabled?'button-cream-disabled':'button-cream-normal');s.icon(this.roomIcon(kind),{x:b.x+(b.w-26)/2,y:b.y+8,w:26,h:26});const text=label+(key?' '+key:'');s.text(label,b.x+(b.w-s.measure(text,12,700))/2,b.y+b.h-21,12,disabled?this.colors.disabled:this.colors.ink,700);if(key)s.text(key,b.x+(b.w+s.measure(text,12,700))/2-s.measure(key,11,700),b.y+b.h-20,11,this.colors.muted,700);
   this.drawAidBadge(kind,b.x+b.w+4,b.y-4);if(!disabled)s.hit(b,()=>this.roomTool(kind));});
 }
 private drawToolColumn(r:Rect){
  if(this.platform.config.id==='web'){
   const s=this.stage,items=([['edge','边缘'],['hint','提示'],['underlay','底图'],['organize','整理'],['orientation','竖屏'],['more','更多']] as const).filter(([kind])=>kind==='organize'?this.soloRoom:kind!=='orientation'||!!this.platform.setOrientation),h=Math.min(58,r.h/items.length);this.roomToolsArea={...r};
   items.forEach(([kind,label],index)=>{const b={x:r.x+5,y:r.y+index*h,w:r.w-10,h:h-5},active=this.toolActive(kind),disabled=(kind==='hint'||kind==='underlay')&&this.assistanceUnavailable(kind);
    if(active)s.frame(b,'button-cream-selected');s.icon(this.roomIcon(kind),{x:b.x+(b.w-22)/2,y:b.y+4,w:22,h:22});s.text(label,b.x+(b.w-s.measure(label,12,700))/2,b.y+b.h-17,12,disabled?this.colors.disabled:this.colors.ink,700);if(!disabled)s.hit(b,()=>this.roomTool(kind));});return;
  }
  const s=this.stage,c=s.ctx,menu=this.platform.viewport().menu;
  if(menu){const y=Math.max(r.y,menu.y+menu.h+8);r={...r,y,h:Math.max(0,r.y+r.h-y)};}
  const toggle={x:(this.landscapeToolsOpen?r.x:s.w)-48,y:this.roomHeaderTop()+57,w:36,h:36};toggle.x-=this.menuReserve(toggle);this.roomToolsArea=this.landscapeToolsOpen?{...r}:toggle;
  if(this.landscapeToolsOpen){
   c.fillStyle=roomColors.cream;c.fillRect(r.x,0,r.w,s.h);c.fillStyle=roomColors.line;c.fillRect(r.x,0,2,s.h);s.hit(r,()=>{});
   const items=([['edge','边缘'],['hint','提示'],['underlay','底图'],['locate','定位'],['organize','整理'],['orientation','横竖屏'],['more','更多']] as const).filter(([kind])=>kind==='organize'?this.soloRoom:kind!=='orientation'||!!this.platform.setOrientation),height=Math.min(58,Math.floor(r.h/items.length)),gap=Math.min(4,Math.max(0,(r.h-items.length*height)/(items.length-1))),top=r.y+(r.h-(items.length*height+(items.length-1)*gap))/2;
   items.forEach(([kind,label],index)=>{const b={x:r.x+6,y:top+index*(height+gap),w:r.w-12,h:height},badge=kind==='hint'||kind==='underlay',active=this.toolActive(kind),disabled=badge&&this.assistanceUnavailable(kind);
    if(active||s.isPressed(b))this.drawLandscapeSurface(b,8,roomColors.roseL);
    s.icon(this.roomIcon(kind),{x:b.x+(b.w-22)/2,y:b.y+Math.min(10,Math.max(0,height-39)),w:22,h:22},roomColors.ink);s.text(label,b.x+(b.w-s.measure(label,11,700))/2,b.y+Math.min(38,height-11),11,roomColors.ink,700);
    if(badge){const grant=this.activeAid(kind),free=this.aid?.freeRemaining?.[kind]??0,text=grant?Math.ceil((grant.expiresAt-Date.now())/1000)+'秒':!this.aid?'读取中':this.aid.newcomerProtected||free>0?'免费':this.shareAvailable?'分享':'暂未开放',bw=s.measure(text,8.5,700)+6;
     this.drawLandscapeSurface({x:b.x,y:b.y,w:bw,h:13},3,roomColors.goldL);s.text(text,b.x+3,b.y+2,8.5,'#7a4d10',700);
    }if(!disabled)s.hit(b,()=>this.roomTool(kind));
   });
  }
  if(this.board?.previewZoomed)return;
  this.drawLandscapeSurface(toggle,18,roomColors.card,roomColors.ink,2,2);s.icon(this.landscapeToolsOpen?'close':'tools',{x:toggle.x+8,y:toggle.y+8,w:20,h:20},roomColors.ink);s.hit(toggle,()=>this.setLandscapeToolsOpen(!this.landscapeToolsOpen));
 }
 /** Coordinates are Stage logical pixels, so the host's UI scale also scales this chrome and its hits. */
 private drawLandscapeSurface(r:Rect,radius:number,fill:string,border?:string,width=0,shadow=0){
  const c=this.stage.ctx;c.save();if(shadow){roomRoundPath(c,{...r,y:r.y+shadow},radius);c.fillStyle=border||roomColors.ink;c.fill();}
  roomRoundPath(c,r,radius);c.fillStyle=fill;c.fill();if(border){c.strokeStyle=border;c.lineWidth=width;c.stroke();}c.restore();
 }
 private drawLandscapeButton(r:Rect,label:string,action:()=>void,fill:string,size:number){
  const s=this.stage;this.drawLandscapeSurface(r,8,s.isPressed(r)?roomColors.roseL:fill,roomColors.ink,2,2);
  s.textMiddle(label,r.x+(r.w-s.measure(label,size,900))/2,r.y+r.h/2-1,size,fill===roomColors.roseD?'#ffffff':roomColors.ink,900);s.hit(r,action);
 }
 private setLandscapeToolsOpen(open:boolean){
  if(this.landscapeToolsOpen===open)return;this.clearRoomPointer();this.landscapeToolsOpen=open;this.platform.storage.set('jigsaw:landscape-tools-open:v1',open?'1':'0');this.roomViewPending=true;this.invalidate();
 }
 private setDesktopToolsOpen(open:boolean){
  if(this.desktopToolsOpen===open)return;this.clearRoomPointer();this.desktopToolsOpen=open;this.platform.storage.set('jigsaw:desktop-tools-open:v1',open?'1':'0');this.invalidate();
 }
 private roomToolsArea:Rect={x:0,y:0,w:0,h:0};private roomMembersArea:Rect={x:0,y:0,w:0,h:0};
 private get chatUnread(){return this.messages.filter(message=>message.id>this.chatSeen&&message.code!==this.client.profile?.code&&!this.social.blockedCodes.includes(message.code)).length;}
 private drawRoomTopBar(r:Rect,mode:'desktop'|'portrait'|'landscape'){
  if(mode!=='portrait')r={...r,w:Math.min(r.w,this.stage.w-this.menuReserve(r)-r.x)};
  const s=this.stage,room=this.room!,photo=activeRoomPhoto(room.snapshot,photoMap.get(room.state.imageId)),title=room.snapshot.title||photo?.title||'一起拼图',total=room.state.cols*room.state.rows,placed=placedCount(room.state),percent=Math.floor(placed/Math.max(1,total)*100),members=room.snapshot.members,kind=total+' 片 · '+(room.snapshot.visibility==='private'?'私人房':'公开房'),ink=this.colors.ink;
  const back=(x:number,y:number)=>{s.button({x,y,w:36,h:36},'',()=>this.exitRoom());s.icon('back',{x:x+7,y:y+7,w:22,h:22});};
  const avatars=(right:number,y:number,size:number)=>{const shown=members.slice(0,3),label=members.length+'/'+seatLimit(room.snapshot),lw=s.measure(label,13,700);let x=right-lw;s.text(label,x,y+(size-13)/2,13,ink,700);x-=6+(shown.length?size+(shown.length-1)*(size*.62):0);const start=x;shown.forEach((_member,index)=>s.icon('avatar',{x:x+index*size*.62,y,w:size,h:size*1.08}));return start;};
  if(mode==='desktop'){
   back(r.x+12,r.y+12);s.text(title,r.x+58,r.y+11,18,ink,800,300);s.text(kind,r.x+58,r.y+35,12,this.colors.muted,600,300);
   const count=placed+' / '+total+'  '+percent+'%',cw=s.measure(count,18,800),mid=84+(s.w-84-300)/2;s.icon('piece',{x:mid-cw/2-28,y:r.y+9,w:22,h:24});s.text(count,mid-cw/2,r.y+10,18,ink,800);s.meter({x:mid-170,y:r.y+38,w:340,h:9},placed/Math.max(1,total));
   const inviteW=118;s.button({x:r.x+r.w-inviteW-14,y:r.y+12,w:inviteW,h:36},'＋ 邀请朋友',()=>this.showModal('invite'),{tone:'berry',fontSize:14});
   const start=avatars(r.x+r.w-inviteW-28,r.y+14,28);this.roomMembersArea={x:start-6,y:r.y+6,w:r.x+r.w-start,h:48};s.hit({x:start-6,y:r.y+6,w:r.x+r.w-inviteW-22-start,h:48},()=>this.focusRoomMembers());
  }else if(mode==='portrait'){
   back(r.x+8,r.y+4);const inviteX=r.x+r.w-44-this.menuReserve({...r,h:44});s.button({x:inviteX,y:r.y+6,w:34,h:34},'',()=>this.showModal('invite'),{tone:'berry'});s.icon('plus',{x:inviteX+9,y:r.y+15,w:16,h:16},this.colors.onAccent);
   const start=avatars(inviteX-8,r.y+9,24);this.roomMembersArea={x:start-4,y:r.y+2,w:inviteX+34-start,h:42};s.hit({x:start-4,y:r.y+2,w:inviteX-start,h:42},()=>this.showModal('chat'));
   s.text(title,r.x+50,r.y+5,16,ink,800,start-r.x-58);s.text(kind,r.x+50,r.y+26,11,this.colors.muted,600,start-r.x-58);
   const line=placed+' / '+total+' · '+percent+'%',lw=s.measure(line,14,800);s.icon('piece',{x:r.x+12,y:r.y+48,w:18,h:20});s.text(line,r.x+34,r.y+50,14,ink,800);s.meter({x:r.x+44+lw,y:r.y+55,w:Math.max(20,r.w-58-lw),h:9},placed/Math.max(1,total));
  }else if(this.platform.config.id==='web'){
   const panel={x:r.x+6,y:r.y+4,w:Math.min(320,r.w*.48),h:r.h-6};s.frame(panel,'button-linen-normal');back(panel.x+5,panel.y+5);
   s.text(title,panel.x+48,panel.y+5,14,ink,800,panel.w-56);const line=placed+'/'+total+' · '+percent+'%',lw=s.measure(line,12,800);s.text(line,panel.x+48,panel.y+25,12,ink,800);s.meter({x:panel.x+56+lw,y:panel.y+29,w:Math.max(20,panel.w-66-lw),h:7},placed/Math.max(1,total));
   const right=r.x+r.w-8,inviteW=64,box={x:right-inviteW-130,y:r.y+4,w:inviteW+130,h:r.h-6};s.frame(box,'button-linen-normal');s.button({x:right-inviteW-4,y:box.y+5,w:inviteW,h:box.h-10},'邀请',()=>this.showModal('invite'),{tone:'berry',icon:'invite',fontSize:13});
   avatars(right-inviteW-12,box.y+8,24);this.roomMembersArea={...box};s.hit({x:box.x,y:box.y,w:box.w-inviteW-8,h:box.h},()=>this.showModal('chat'));
  }else{
   const size=26,step=size-7,avatarW=members.length?size+(members.length-1)*step:0,gap=8,inviteW=s.measure('＋ 邀请',13,900)+20;
   const right=r.x+r.w-12,invite={x:right-inviteW,y:r.y,w:inviteW,h:34},avatarX=invite.x-gap-avatarW;
   const count=placed+'/'+total,percentText=Math.round(placed/Math.max(1,total)*100)+'%',countW=s.measure(count,13,900),percentW=s.measure(percentText,13,900),capsuleW=24+countW+percentW+16+180;
   // Centred on the table area with the full 180px meter. At a crowded small viewport,
   // move the capsule below the first row instead of shrinking the meter or overlapping members.
   const capsule={x:r.x+r.w/2-capsuleW/2,y:r.y+2,w:capsuleW,h:25},backRect={x:r.x+12,y:r.y,w:36,h:36},textX=backRect.x+44;
   const stacked=capsule.x<textX+28||capsule.x+capsule.w+gap>avatarX;if(stacked)capsule.y=r.y+44;
   const titleRight=stacked?avatarX-gap:capsule.x-gap;
   this.drawLandscapeButton(backRect,'<',()=>this.exitRoom(),roomColors.card,20);s.text(title,textX,r.y+2,15,roomColors.ink,900,Math.max(1,titleRight-textX));s.text(total+' 片',textX,r.y+21,10.5,roomColors.muted,500,Math.max(1,titleRight-textX));
   this.drawLandscapeSurface(capsule,16,'rgba(255,250,243,.92)',roomColors.lineD,1.5);
   s.textMiddle(count,capsule.x+12,capsule.y+capsule.h/2,13,roomColors.ink,900,'0123456789');
   const meter={x:capsule.x+12+countW+8,y:capsule.y+capsule.h/2-4,w:180,h:8};this.drawLandscapeSurface(meter,4,roomColors.meterTrack);const fill=placed/Math.max(1,total);if(fill>0)this.drawLandscapeSurface({...meter,w:meter.w*fill},4,roomColors.green);
   s.textMiddle(percentText,meter.x+meter.w+8,capsule.y+capsule.h/2,13,roomColors.green,900,'0123456789');s.hit(capsule,()=>{});
   members.forEach((_member,index)=>s.icon('avatar',{x:avatarX+index*step,y:r.y+4,w:size,h:size}));
   this.roomMembersArea={x:avatarX,y:r.y,w:avatarW,h:34};s.hit(this.roomMembersArea,()=>this.showModal('chat'));this.drawLandscapeButton(invite,'＋ 邀请',()=>this.showModal('invite'),roomColors.roseD,13);
  }
 }
 private chatBubble:{message:PublicMessage;until:number}|null=null;private bubbleSeen=-1;
 private landscapeChatVisible=false;
 private viewLocked=false;private lockButtonEnabled=false;
 /** The lock is opt-in under 更多; turning the button off also unlocks the view. */
 private setLockButtonEnabled(enabled:boolean){
  this.lockButtonEnabled=enabled;try{this.platform.storage.set(LOCK_BUTTON_KEY,enabled?'1':'0');}catch{}
  if(!enabled&&this.viewLocked){this.viewLocked=false;try{this.platform.storage.set(VIEW_LOCK_KEY,'0');}catch{}if(this.board)this.board.viewLocked=false;}
  this.note(enabled?'已启用锁定按钮：在拼图区右下角，锁上后单指只拖拼块':'已关闭锁定按钮');this.invalidate();
 }
 private toggleViewLock(){
  this.viewLocked=!this.viewLocked;try{this.platform.storage.set(VIEW_LOCK_KEY,this.viewLocked?'1':'0');}catch{}
  if(this.board)this.board.viewLocked=this.viewLocked;this.clearRoomPointer();
  this.note(this.viewLocked?'画面已锁定：单指只拖拼块，双指移动和缩放':'已解锁：单指拖空白处可移动画面');this.invalidate();
 }
 /** Once enabled under 更多, phones keep the view lock one tap away, above the room tools. */
 private drawBoardQuickTools(x:number,bottom:number){
  const board=this.board,room=this.room;if(!this.lockButtonEnabled||!board||!room||this.layout==='desktop'||!this.imageReady||room.snapshot.completedAt||this.completionFx||board.previewZoomed)return;
  const s=this.stage,size=46,items=[[this.viewLocked?'lock':'unlock',this.viewLocked?'已锁定':'锁定',this.viewLocked,()=>this.toggleViewLock()]] as const;
  items.forEach(([icon,label,active,action],index)=>{const b={x,y:bottom-(index+1)*(size+8),w:size,h:size};s.frame(b,active?'button-gold-normal':'button-cream-normal');s.icon(icon,{x:b.x+(size-22)/2,y:b.y+5,w:22,h:22});s.text(label,b.x+(size-s.measure(label,10,700))/2,b.y+size-16,10,this.colors.ink,700);s.hit(b,action);});
 }
 private drawChatBubble(y:number){
  this.landscapeChatVisible=false;
  const s=this.stage,messages=this.messages.filter(message=>!this.social.blockedCodes.includes(message.code)),latest=messages[messages.length-1];
  if(latest){if(this.bubbleSeen<0)this.bubbleSeen=latest.id;else if(latest.id>this.bubbleSeen){this.bubbleSeen=latest.id;if(latest.code!==this.client.profile?.code||this.platform.config.id!=='web'&&this.layout==='phoneLandscape')this.chatBubble={message:latest,until:Date.now()+5000};}}
  const bubble=this.chatBubble;if(!bubble||Date.now()>bubble.until||this.modal)return;
  if(this.platform.config.id!=='web'&&this.layout==='phoneLandscape'){
   const c=s.ctx,name=bubble.message.name,text='：'+bubble.message.text,nameW=Math.min(s.measure(name,12,700),this.roomArea.w*.35),w=Math.min(this.roomArea.w-78,this.room?.snapshot.completedAt&&!this.completionFx?(this.roomArea.w-112)/2-20:Infinity,nameW+s.measure(text,12,500)+20),r={x:12,y:this.roomArea.h-32,w,h:20},member=this.room?.snapshot.members.find(member=>member.id===bubble.message.playerId);
   const remaining=bubble.until-Date.now();c.save();c.globalAlpha=Math.min(1,remaining/1000);this.drawLandscapeSurface(r,14,'rgba(255,250,243,.95)',roomColors.lineD,1.5);if(remaining<1000)this.invalidate();
   s.text(name,r.x+10,r.y+4,12,member?.color||roomColors.ink,700,nameW);s.text(text,r.x+10+nameW,r.y+4,12,roomColors.ink,500,w-nameW-20);c.restore();s.hit(r,()=>this.showModal('chat'));this.landscapeChatVisible=true;return;
  }
  const text=bubble.message.name+'：'+bubble.message.text,w=Math.min(s.w-24,s.measure(text,13,600)+48),r={x:(s.w-w)/2,y,w,h:32};s.frame(r,'button-linen-normal');s.icon('chat',{x:r.x+10,y:r.y+8,w:16,h:16});s.text(text,r.x+31,r.y+8,13,this.colors.ink,600,w-40);s.hit(r,()=>this.showModal('chat'));
 }
 private drawRoomGift(x:number,y:number,label:boolean){
  const s=this.stage,p=this.client.profile,giftLabel='任务 '+(p?.giftProgress??0)+'/10',reserve=label&&this.room?.snapshot.completedAt&&!this.completionFx&&this.layout==='phonePortrait',hitW=reserve?Math.min(144,(this.roomArea.w-112)/2-8-x+3):label?144:44;s.icon('gift',{x,y:y+4,w:label?44:36,h:label?46:38});if(label)s.text(giftLabel,x+46,y+20,15,this.colors.ink,700,reserve?Math.max(1,hitW-49):undefined);s.hit({x:x-3,y,w:hitW,h:52},()=>this.navigate('tasks'));
  const giftCount=p?.giftCount??0;if(giftCount>0){const text=giftCount>99?'99+':String(giftCount),badgeW=Math.max(20,s.measure(text,11,700)+8);s.panel({x:x+30,y:y-2,w:badgeW,h:19},'berry');s.text(text,x+34,y+1,11,'#fffaf0',700);}
 }
 private drawZoomControl(x:number,y:number){
  const s=this.stage,board=this.board;if(!board)return;const r={x,y,w:140,h:40},label=Math.round(board.camera.z/Math.max(.0001,this.roomZoomBase)*100)+'%';s.frame(r,'button-linen-normal');
  s.button({x:x+4,y:y+4,w:32,h:32},'−',()=>{if(!this.completionFx)board.zoom(.8);this.invalidate();},{fontSize:18});s.button({x:x+r.w-36,y:y+4,w:32,h:32},'＋',()=>{if(!this.completionFx)board.zoom(1.25);this.invalidate();},{fontSize:16});s.text(label,x+(r.w-s.measure(label,14,800))/2,y+12,14,this.colors.ink,800);
 }
 private setRoomPanelCollapsed(collapsed:boolean){
  if(this.roomPanelCollapsed===collapsed)return;this.roomPanelCollapsed=collapsed;this.platform.storage.set('jigsaw:room-panel-collapsed:v1',collapsed?'1':'0');this.roomViewPending=true;this.invalidate();
 }
 private focusRoomMembers(){
  if(this.offlineRoom){this.note(OFFLINE_REQUIRED);return;}
  this.setRoomPanelCollapsed(false);this.roomMembersHighlight=Date.now()+1600;this.invalidate();setTimeout(()=>{if(!this.destroyed)this.invalidate();},1650);
 }
 private async openPlayerCard(member:{code?:string|null;name?:string}){
  if(this.offlineRoom){this.note(OFFLINE_REQUIRED);return;}
  if(!member.code){this.note('这位玩家的名片暂不可用');return;}
  if(this.modal!=='playerCard')this.cardReturn=this.modal;
  const code=member.code,owner=this.client.profile?.code,room=this.room?.snapshot.id;
  this.cardCode=code;this.cardError='';this.cardData=null;this.cardRequestId=this.platform.randomId();this.showModal('playerCard');
  const cached=this.cardCache.get(code);if(cached&&Date.now()-cached.at<30000){this.cardData=cached.data;this.cardLoading=false;this.invalidate();return;}
  this.cardLoading=true;this.invalidate();
  try{const data=await this.client.playerCard(code,room);if(this.cardCode!==code||this.modal!=='playerCard'||this.client.profile?.code!==owner||this.room?.snapshot.id!==room)return;this.cardCache.set(code,{at:Date.now(),data});this.cardData=data;}
  catch(error){if(this.cardCode===code&&this.modal==='playerCard')this.cardError=errorText(error);}
  finally{if(this.cardCode===code&&this.modal==='playerCard'){this.cardLoading=false;this.invalidate();}}
 }
 private async requestCardFriend(){
  const data=this.cardData,code=this.cardCode;if(!data||this.cardSending||!['none','incoming'].includes(data.relationship))return;
  this.cardSending=true;this.invalidate();
  try{await this.client.post('/api/mobile/social/requests',{code,requestId:this.cardRequestId});if(this.cardCode===code&&this.cardData===data){data.relationship='outgoing';this.cardCache.set(code,{at:Date.now(),data});}this.note('好友申请已发送');}
  catch(error){this.note(errorText(error));}finally{this.cardSending=false;this.invalidate();}
 }
 private drawPlayerCard(){
  const s=this.stage,v=this.platform.viewport(),w=Math.min(360,s.w-24),h=Math.min(386,s.h-v.top-v.bottom-16),x=(s.w-w)/2,y=v.top+(s.h-v.top-v.bottom-h)/2;
  s.ctx.fillStyle=this.colors.overlay;s.ctx.fillRect(0,0,s.w,s.h);s.hit({x:0,y:0,w:s.w,h:s.h},()=>{});s.panel({x,y,w,h});
  s.text('玩家名片',x+16,y+17,19,this.colors.ink,800,w-70);s.button({x:x+w-44,y:y+10,w:30,h:30},'',()=>this.showModal(this.cardReturn),{icon:'close'});
  this.modalArea={x:x+12,y:y+50,w:w-24,h:h-62};this.modalExtent=0;
  const data=this.cardData;if(!data){s.wrap(this.cardLoading?'正在读取名片…':this.cardError||'名片暂不可用',x+22,y+78,w-44,14,this.colors.muted,22);if(!this.cardLoading)s.button({x:x+22,y:y+h-58,w:w-44,h:36},'重试',()=>void this.openPlayerCard({code:this.cardCode}),{fontSize:14});return;}
  const area=this.modalArea,contentH=data.relationship==='self'?270:322;this.modalExtent=contentH;this.modalScroll=clamp(this.modalScroll,0,Math.max(0,contentH-area.h));
  s.clip(area,()=>{let cy=area.y+8-this.modalScroll;
   s.icon('avatar',{x:x+22,y:cy,w:52,h:56});if(data.player.decoration)s.decoration(data.player.decoration,{x:x+54,y:cy+29,w:29,h:31});s.text(data.player.name,x+89,cy+6,18,this.colors.ink,800,w-109);s.icon('cardLevel',{x:x+89,y:cy+31,w:21,h:25});s.text('Lv.'+data.player.level,x+116,cy+36,14,this.colors.muted,700,w-136);cy+=76;
   const rows:[string,string,number][]=[['cardPuzzles','拼完的图片数',data.stats.completedPuzzles],['cardPacks','拥有的图包数',data.stats.ownedPacks],['cardAlbums','集齐的图集数',data.stats.completedAlbums],['piece','本局拼合数',data.stats.roomContribution]];
   for(const[icon,label,value]of rows){s.icon(icon,{x:x+24,y:cy,w:25,h:27});s.text(label,x+61,cy+7,14,this.colors.ink,600,w-131);const text=String(value);s.text(text,x+w-26-s.measure(text,16,800),cy+6,16,this.colors.ink,800);cy+=41;}
   if(data.relationship!=='self'){const disabled=this.cardSending||data.relationship==='friend'||data.relationship==='outgoing'||data.relationship==='incoming';s.button({x:x+22,y:cy+8,w:w-44,h:38},data.relationship==='friend'?'已是好友':['outgoing','incoming'].includes(data.relationship)?'已申请':this.cardSending?'正在申请…':'加好友',()=>void this.requestCardFriend(),{icon:'cardAddFriend',tone:'berry',fontSize:14,disabled});}
  });
 }
 private drawRoomPanel(r:Rect){
  const s=this.stage,room=this.room!,ink=this.colors.ink,x=r.x+12,w=r.w-24;s.ctx.fillStyle=this.colors.cream;s.ctx.fillRect(r.x,r.y,r.w,r.h);s.ctx.fillStyle=this.colors.line;s.ctx.fillRect(r.x,r.y,1,r.h);s.hit(r,()=>{});
  let y=r.y+40;const ratio=room.state.cols/Math.max(1,room.state.rows),artH=Math.min(170,Math.max(40,r.h-500),w/Math.max(.6,ratio)),art={x,y,w,h:artH};s.frame(art,'button-linen-normal');if(this.roomImage)s.image(this.roomImage,{x:x+5,y:y+5,w:w-10,h:artH-10},'contain');y+=artH+6;s.text('参考图',x,y,12,this.colors.muted,700);y+=24;
  const members=room.snapshot.members as Array<(typeof room.snapshot.members)[number]&{code?:string;level?:number;contribution?:number}>,me=this.client.profile?.code;
  const columns=r.h<680?2:1,rowW=w/columns;
  if(Date.now()<this.roomMembersHighlight)s.frame({x:x-4,y:y-4,w:w+8,h:28+Math.ceil(members.length/columns)*34},'panel-gold');
  s.text('同桌 '+members.length+' / '+seatLimit(room.snapshot),x,y,15,ink,800);y+=26;
  members.forEach((member,index)=>{const rx=x+index%columns*rowW,ry=y+Math.floor(index/columns)*34;s.icon('avatar',{x:rx,y:ry,w:26,h:28});s.text(member.name+(member.code&&member.code===me?'（我）':''),rx+34,ry+1,13,ink,700,rowW-(columns===1?90:40));s.text('Lv.'+(member.level??0)+(columns===2?' · 拼合 '+(member.contribution??0):''),rx+34,ry+17,10,this.colors.muted,600,rowW-38);if(columns===1){const placed='拼合 '+(member.contribution??0);s.text(placed,rx+rowW-18-s.measure(placed,12,700),ry+7,12,ink,700);}s.hit({x:rx,y:ry,w:rowW,h:32},()=>void this.openPlayerCard(member));});y+=Math.ceil(members.length/columns)*34;
  s.ctx.fillStyle=this.colors.line;s.ctx.fillRect(x,y+2,w,1);y+=12;s.text('聊天',x,y,15,ink,800);y+=24;
  const free=this.formalWeb,replies=[8,5,9,6],footer=8+Math.ceil(replies.length/2)*36+(free?42:0),bottom=r.y+r.h-footer,messages=this.messages.filter(message=>!this.social.blockedCodes.includes(message.code));
  this.chatSeen=this.chatCursor;const rows:PublicMessage[]=[];let used=0;for(let i=messages.length-1;i>=0&&used+40<=bottom-y;i--){rows.unshift(messages[i]);used+=40;}
  if(!rows.length)s.text('还没有消息，点下方短句打个招呼',x,y+4,12,this.colors.muted,500,w);
  let my=bottom-used-4;for(const message of rows){s.text(message.name,x,my,11,this.colors.muted,700,w);s.text(message.text,x,my+16,13,ink,600,w);my+=40;}
  let fy=bottom+4;const bw=(w-8)/2;replies.forEach((id,index)=>s.button({x:x+(index%2)*(bw+8),y:fy+Math.floor(index/2)*36,w:bw,h:30},phrases[id],()=>void this.say(id),{fontSize:12,disabled:this.busy}));fy+=Math.ceil(replies.length/2)*36;
  if(free){s.frame({x,y:fy,w,h:34},'rail-cream-normal');s.text('输入消息…',x+12,fy+10,13,this.colors.muted,500);s.hit({x,y:fy,w,h:34},()=>void this.sayText());}
 }
 private drawReconnectBanner(room:RoomClient){
  const s=this.stage,area=this.roomArea,w=Math.min(area.w-24,440),x=area.x+(area.w-w)/2,y=area.y+(this.layout==='phonePortrait'?44:this.layout==='phoneLandscape'?this.platform.viewport().top+60:10),r={x,y,w,h:58};s.panel(r);
  const t=Math.floor(Date.now()/250)%8;for(let i=0;i<8;i++){const angle=i*Math.PI/4;s.ctx.globalAlpha=i===t?1:.3;s.ctx.fillStyle=this.colors.berry;s.ctx.fillRect(Math.round(x+24+Math.cos(angle)*8)-2,Math.round(y+29+Math.sin(angle)*8)-2,4,4);}s.ctx.globalAlpha=1;
  s.text('网络断开，正在重连…',x+44,y+11,14,this.colors.ink,800,w-130);s.text('已拼好的进度都保存在桌上，不会丢',x+44,y+33,12,this.colors.muted,500,w-130);
  s.button({x:x+w-76,y:y+12,w:64,h:34},'重试',()=>{room.retryNow();this.invalidate();},{fontSize:13});
 }
 private roomGuideStep=0;
 private roomGuideSeen(){try{return this.platform.storage.get('jigsaw:room-guide:v1')==='done';}catch{return true;}}
 private finishRoomGuide(){this.roomGuideStep=0;try{this.platform.storage.set('jigsaw:room-guide:v1','done');}catch{}this.invalidate();}
 private drawRoomGuide(){
  const s=this.stage,c=s.ctx,step=this.roomGuideStep,layout=this.layout,menu={x:s.w-70,y:s.h-this.platform.viewport().bottom-72,w:64,h:64};
  const hole=step===1?this.roomArea:step===2?(layout==='phonePortrait'?menu:this.roomToolsArea):this.roomMembersArea,r={x:Math.round(hole.x),y:Math.round(hole.y),w:Math.round(hole.w),h:Math.round(hole.h)};
  c.fillStyle=this.colors.overlay;c.fillRect(0,0,s.w,r.y);c.fillRect(0,r.y+r.h,s.w,s.h-r.y-r.h);c.fillRect(0,r.y,r.x,r.h);c.fillRect(r.x+r.w,r.y,s.w-r.x-r.w,r.h);
  c.strokeStyle=s.color('#fff1d9');c.lineWidth=2;c.strokeRect(r.x+1,r.y+1,r.w-2,r.h-2);s.hit({x:0,y:0,w:s.w,h:s.h},()=>this.finishRoomGuide());
  const copy=['① 把拼块拖到拼盘里 — 拼对了会自动吸住。双指可以缩放，拖空白处可以移动桌面。','② 工具都在这里 — 边缘、提示、底图…'+(this.platform.config.id==='web'?'':' 找不到拼块就点「定位」，没拼上的块都会闪亮标出'),'③ 叫朋友一起拼 — 同桌越多越快'][step-1],w=Math.min(340,s.w-32);
  let x=Math.min(Math.max(16,r.x+r.w/2-w/2),s.w-w-16),y=step===1?r.y+Math.min(r.h*.55,r.h-150):r.y+r.h+12;if(y+140>s.h)y=Math.max(12,r.y-150);if(step===2&&layout!=='phonePortrait'&&r.x<s.w/2){x=Math.min(s.w-w-16,r.x+r.w+12);y=Math.min(r.y+40,s.h-160);}if(step===2&&layout==='phoneLandscape'){x=r.x-w-12;y=Math.min(r.y+40,s.h-160);}
  const textH=this.stage.wrap(copy,-9999,0,w-32,14,this.colors.ink,21),card={x,y,w,h:textH+70};s.panel(card);s.hit(card,()=>{});
  this.paragraph(copy,x+16,y+14,w-32,14,this.colors.ink);s.text(step+' / 3',x+16,y+card.h-38,13,this.colors.muted,700);s.button({x:x+w-110,y:y+card.h-46,w:94,h:36},step<3?'下一步':'知道了',()=>{if(step<3){this.roomGuideStep++;this.invalidate();}else this.finishRoomGuide();},{tone:'berrydark',fontSize:14});
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
  const s=this.stage,r=this.chatEntryArea,label=members+'/'+seatLimit(this.room?.snapshot),start=floating?r.x+(r.w-25-s.measure(label,14,700))/2:r.x+3;
  if(floating)s.button(r,'',()=>this.showModal('chat'));else s.hit(r,()=>this.showModal('chat'));
  s.icon('person',{x:start,y:r.y+(r.h-25)/2,w:20,h:25});s.text(label,start+25,r.y+(r.h-14)/2,14,this.colors.ink,700);
  if(unread){const x=r.x+r.w-16,y=r.y-4;s.frame({x,y,w:17,h:17},'segment-berry-selected');s.text(Math.min(99,unread),x+4,y+2,9,this.colors.onAccent,700);}
 }
 private assistanceUnavailable(kind:'hint'|'underlay'){return !this.activeAid(kind)&&!!this.aid&&!this.aid.newcomerProtected&&(this.aid.freeRemaining?.[kind]??0)<=0&&!this.shareAvailable;}
 private drawRoomToolToggle(toggle:Rect,open:boolean,change:()=>void){
  const s=this.stage,c=s.ctx;
  // The original B2 toggle is an integer-stepped circle, not a rounded rectangle.
  c.save();c.translate(toggle.x,toggle.y);c.scale(toggle.w/54,toggle.h/54);
  const circle=(points:number[],fill:string)=>{c.beginPath();for(let i=0;i<points.length;i+=2){if(i)c.lineTo(points[i],points[i+1]);else c.moveTo(points[i],points[i+1]);}c.closePath();c.fillStyle=s.color(fill);c.fill();};
  circle([18,1,36,1,36,3,42,3,42,6,48,6,48,12,51,12,51,18,53,18,53,36,51,36,51,42,48,42,48,48,42,48,42,51,36,51,36,53,18,53,18,51,12,51,12,48,6,48,6,42,3,42,3,36,1,36,1,18,3,18,3,12,6,12,6,6,12,6,12,3,18,3],'#925363');
  circle([18,3,36,3,36,5,42,5,42,8,46,8,46,12,49,12,49,18,51,18,51,36,49,36,49,42,46,42,46,46,42,46,42,49,36,49,36,51,18,51,18,49,12,49,12,46,8,46,8,42,5,42,5,36,3,36,3,18,5,18,5,12,8,12,8,8,12,8,12,5,18,5],'#e3bda4');
  circle([19,5,35,5,35,7,41,7,41,10,44,10,44,13,47,13,47,19,49,19,49,35,47,35,47,41,44,41,44,44,41,44,41,47,35,47,35,49,19,49,19,47,13,47,13,44,10,44,10,41,7,41,7,35,5,35,5,19,7,19,7,13,10,13,10,10,13,10,13,7,19,7],open?'#f4e7db':'#fff8ef');c.restore();
  const inset=toggle.w*12/50,size=toggle.w*26/50;s.icon(open?'close':'tools',{x:toggle.x+inset,y:toggle.y+inset,w:size,h:size});s.hit(toggle,change);
 }
 private drawRoomTools(toggle:Rect,landscape:boolean){
  const s=this.stage,board=this.board;if(!board)return;
  this.drawRoomToolToggle(toggle,this.toolsOpen,()=>{this.clearRoomPointer();this.toolsOpen=!this.toolsOpen;this.invalidate();});
  if(!this.toolsOpen)return;
  const width=Math.min(366,s.w-26),box={x:s.w-13-width,y:Math.max(this.roomArea.y+7,toggle.y-160),w:width,h:150};s.panel(box);s.hit(box,()=>{});
  const items:readonly(readonly[string,string])[]=[...this.roomTools.map(([kind,label])=>[kind,label] as const),...(this.platform.setOrientation?[['orientation','横屏']] as const:[])],cellW=(box.w-14)/items.length;
  items.forEach(([kind,label],index)=>{const x=box.x+7+index*cellW,cx=x+cellW/2,y=box.y+12,disabled=(kind==='hint'||kind==='underlay')&&this.assistanceUnavailable(kind);
   s.frame({x:cx-21,y:y+8,w:42,h:42},this.toolActive(kind)?'button-cream-selected':disabled?'button-cream-disabled':'button-cream-normal');s.icon(this.roomIcon(kind),{x:cx-13,y:y+16,w:26,h:26});s.text(label,cx-s.measure(label,12,700)/2,y+55,12,disabled?this.colors.disabled:this.colors.ink,700);
   this.drawAidBadge(kind,x+cellW-1,box.y+4);if(!disabled)s.hit({x,y:box.y+5,w:cellW,h:76},()=>this.roomTool(kind));});
  s.ctx.fillStyle=this.colors.line;s.ctx.fillRect(box.x+12,box.y+88,box.w-24,1);
  const members=this.room?.snapshot.members.length??0,unread=this.chatUnread,bw=(box.w-24-12)/3,by=box.y+98;
  s.button({x:box.x+12,y:by,w:bw,h:40},'',()=>this.roomTool('chat'));for(let i=0;i<Math.min(3,members);i++)s.icon('avatar',{x:box.x+20+i*11,y:by+10,w:18,h:20});s.text('同桌 '+members,box.x+24+Math.min(3,members)*11+8,by+12,13,this.colors.ink,700,bw-40);
  s.button({x:box.x+18+bw,y:by,w:bw,h:40},'聊天',()=>this.roomTool('chat'),{icon:'chat',fontSize:13});if(unread){const ux=box.x+18+bw*2-18;s.frame({x:ux,y:by-6,w:18,h:18},'segment-berry-selected');s.text(Math.min(99,unread),ux+4,by-4,10,this.colors.onAccent,700);}
  s.button({x:box.x+24+bw*2,y:by,w:bw,h:40},'更多 ›',()=>this.roomTool('more'),{fontSize:13});
 }


 private drawPublicChat(){
  const messages=this.messages.filter(message=>!this.social.blockedCodes.includes(message.code));
  const s=this.stage,view=this.platform.viewport(),landscape=s.w>s.h&&s.w>=540,w=landscape?Math.min(370,s.w*.44):s.w-24,chatTop=this.roomArea.y+12,
   h=landscape?Math.min(520,s.h-view.bottom-chatTop-12):Math.min(Math.max(380,s.h*.52),s.h-view.top-view.bottom-20),
   x=landscape?s.w-w-74:12,y=landscape?Math.max(view.top+8,chatTop):s.h-view.bottom-h-10;
  this.chatWindowArea={x,y,w,h};s.panel(this.chatWindowArea);s.hit(this.chatWindowArea,()=>{});
  s.text('同桌交流',x+15,y+17,18,this.colors.ink,800,w-180);
  s.segments({x:x+w-165,y:y+12,w:116,h:32},[['room','房间'],['friends','好友']],'room',value=>{if(value==='friends')this.showModal('social');});
  const strip=this.room?.snapshot.members??[],memberColumns=Math.max(1,Math.floor((w-110)/78)),memberWidth=78,memberBottom=84;
  strip.slice(0,memberColumns).forEach((member,index)=>{const sx=x+14+index*memberWidth,sy=y+50;s.icon('avatar',{x:sx,y:sy,w:24,h:26});s.text(member.name,sx+27,sy+1,12,this.colors.ink,700,46);s.text('Lv.'+((member as {level?:number}).level??0),sx+27,sy+16,10,this.colors.muted,600);s.hit({x:sx,y:sy,w:75,h:34},()=>void this.openPlayerCard(member));});
  s.button({x:x+w-86,y:y+50,w:72,h:30},'同桌 '+strip.length+' ›',()=>this.showModal('members'),{fontSize:12});
  s.button({x:x+w-42,y:y+12,w:29,h:31},'',()=>this.showModal(null),{icon:'close'});
  const groups=[{label:'协作',ids:[1,5,6,2,8,3,7]},{label:'鼓励',ids:[0,4,9,10,11]},{label:'表情',ids:[12,13,14,15]}],selected=groups[this.phraseGroup],columns=w>=310?3:2,
   rows=Math.ceil(selected.ids.length/columns),footerHeight=48+rows*34+(this.formalWeb?38:0),footerY=y+h-footerHeight-10,
   list={x:x+10,y:y+memberBottom+4,w:w-20,h:Math.max(24,footerY-y-memberBottom-11)};
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
 private stopCheers(){if(this.cheerFrame!==null)this.platform.cancelFrame(this.cheerFrame);this.cheerFrame=null;this.cheerEffects.clear();}
 private animateCheers(){
  if(this.cheerFrame!==null||this.hidden||this.destroyed||this.modal!=='completion')return;
  this.invalidate();this.cheerFrame=this.platform.frame(()=>{this.cheerFrame=null;if(this.modal!=='completion'||this.hidden||this.destroyed)return;const alive=this.cheerEffects.alive();this.invalidate();if(alive)this.animateCheers();});
 }
 private sendCompletionCheer(emote:CheerEmote){if(this.cheersEnabled&&this.modal==='completion'&&this.room?.snapshot.members.some(member=>member.id===this.room!.ticket.playerId&&member.lastSeen>0))this.cheer?.send(emote);}
 private completionSeats(){const snap=this.room?.snapshot;return completionSeats(snap?.members??[],(snap as typeof snap&{mobileResult?:{ranking?:Parameters<typeof completionSeats>[1]}})?.mobileResult?.ranking,this.room?.ticket.playerId??'',this.client.profile?.code,seatLimit(snap));}
 private landscapeSeatWidth(available:number){return Math.max(120,Math.min(140,(available-500)/2));}
 private completionOutsideSeats(x:number,w:number){return this.desktop&&x>=194&&this.stage.w-x-w>=194;}
 private drawCompletionSeat(seat:CompletionSeat,r:Rect,vertical=false){
  const s=this.stage,c=s.ctx,avatar=vertical?34:this.layout==='phoneLandscape'?r.w<140?30:34:50,size=vertical?34:this.layout==='phoneLandscape'?avatar:40;r={...r,y:r.y+this.cheerEffects.hop(seat.playerId)};this.completionSeatRects.set(seat.playerId,r);
  c.save();c.globalAlpha=1;s.frame(r,seat.me?'button-cream-selected':'button-linen-normal');
  if(seat.me){c.save();c.globalAlpha*=.12;c.fillStyle=this.colors.berry;c.fillRect(r.x+4,r.y+4,r.w-8,r.h-8);c.restore();}
  // The portrait me tag needs 1px more clearance at the outer avatar edge.
  const mirror=seat.column==='right',ax=vertical?r.x+(r.w-avatar)/2+(seat.me?(mirror?-1:1):0):mirror?r.x+r.w-avatar-6:r.x+6,ay=vertical?r.y+3:r.y+(r.h-avatar)/2;
  const ar={x:ax,y:ay,w:avatar,h:avatar};this.completionAvatarRects.set(seat.playerId,ar);if(!seat.present)c.globalAlpha=.45;s.icon('avatar',ar);if(seat.crown)drawCheerIcon(c,'crown',{x:ax+(avatar-24)/2,y:ay-10,w:24,h:24});
  const p=this.completionPicture,slot={x:vertical?(mirror?(p.x+p.w+r.x)/2:(r.x+r.w+p.x)/2)-size/2:mirror?r.x+6:r.x+r.w-6-size,y:ay+(avatar-size)/2,w:size,h:size};this.completionSlotRects.set(seat.playerId,slot);
  const tx=vertical?r.x+3:mirror?slot.x+size+4:ax+avatar+5,tw=vertical?r.w-6:mirror?ax-5-tx:slot.x-4-tx;
  s.text(seat.name,tx,vertical?r.y+39:r.y+12,vertical?11:12,this.colors.ink,seat.me?800:600,tw);
  s.text('拼合 '+seat.contribution,tx,vertical?r.y+56:r.y+34,vertical?10:11,this.colors.muted,600,tw);
  if(seat.me){const tag={x:mirror?r.x+r.w-17:r.x+3,y:r.y+(vertical?3:-6),w:14,h:13};c.fillStyle=this.colors.berry;c.fillRect(tag.x,tag.y,tag.w,tag.h);s.text('我',tag.x+2,tag.y+1,9,this.colors.onAccent,700);}
  c.restore();
 }
 private drawCompletionSeats(panel:Rect){
  this.completionAvatarRects.clear();this.completionSlotRects.clear();
  const seats=this.completionSeats(),landscape=this.layout==='phoneLandscape',v=this.platform.viewport() as ReturnType<Platform['viewport']>&{left?:number;right?:number},w=landscape?this.landscapeSeatWidth(this.stage.w-(v.left??0)-(v.right??0)):176,h=landscape?60:70,gap=landscape?12:16;
  for(const seat of seats){const rows=Math.ceil(seats.length/2),x=landscape?seat.column==='left'?10+(v.left??0):this.stage.w-10-(v.right??0)-w:seat.column==='left'?panel.x-18-w:panel.x+panel.w+18,y=panel.y+(panel.h-(rows*h+(rows-1)*gap))/2+seat.row*(h+gap);this.drawCompletionSeat(seat,{x,y,w,h});}
 }
 private drawCompletionPicture(r:Rect){
  const s=this.stage;this.completionPicture=r;s.frame(r,'panel-cream');const shown=this.board?.drawCompletedPicture(s.ctx,{x:r.x+6,y:r.y+6,w:r.w-12,h:r.h-12});
  const level=this.chapterForLevel(this.room?.snapshot.levelId)?.levels.find(level=>level.id===this.room?.snapshot.levelId),src=level?this.levelPicture(level).src:'';
  if(!shown&&src)s.image(this.client.asset(src),{x:r.x+6,y:r.y+6,w:r.w-12,h:r.h-12},'contain');
  if(!shown&&!src){s.text(this.imageError?'图片加载失败':'正在加载成品…',r.x+12,r.y+r.h/2-20,13,this.colors.muted,500,r.w-24);if(this.imageError)this.button(r.x+12,r.y+r.h/2+4,r.w-24,'重新加载',()=>void this.run(async()=>{const board=this.board;if(!board)return;await board.setImage(this.roomImage);if(this.board===board){this.imageReady=true;this.imageError='';this.message='';}}),'cream',32);}
  s.ornaments(r,26);
 }
 private drawCompletionBar(r:Rect){
  this.completionBar=r;const s=this.stage,vertical=this.layout==='phonePortrait',enabled=!!this.room?.snapshot.members.some(member=>member.id===this.room!.ticket.playerId&&member.lastSeen>0),gap=4,bw=(r.w-5*gap)/6;
  CHEER_EMOTES.forEach((emote,i)=>{const b={x:r.x+i*(bw+gap),y:r.y,w:bw,h:r.h};s.ctx.save();if(!enabled)s.ctx.globalAlpha=.45;s.frame(b,this.cheerEffects.pressed(emote)?'button-cream-pressed':'button-cream-normal');
   const size=vertical?24:22,label=CHEER_LABELS[emote],font=vertical?11:this.desktop?14:13,iw=16,lw=s.measure(label,font,700),horizontal=bw>=iw+lw+10;
   drawCheerIcon(s.ctx,emote,{x:vertical||!horizontal?b.x+(bw-size)/2:b.x+(bw-iw-lw-4)/2,y:vertical?b.y+5:horizontal?b.y+(b.h-size)/2:b.y+3,w:size,h:size});
   s.text(label,vertical||!horizontal?b.x+(bw-lw)/2:b.x+(bw-iw-lw-4)/2+iw+6,vertical?b.y+35:horizontal?b.y+(b.h-font)/2:b.y+26,font,this.colors.ink,700,bw-4);
   if(this.desktop)s.text(i+1,b.x+4,b.y+3,9,this.colors.muted);
   const count=this.cheerEffects.count(emote);if(count>=2){const badge='×'+count;s.ctx.fillStyle=this.colors.berry;s.ctx.fillRect(b.x+b.w-25,b.y-4,27,16);s.text(badge,b.x+b.w-23,b.y-3,10,this.colors.onAccent,700,25);}
   if(enabled)s.hit(b,()=>this.sendCompletionCheer(emote));s.ctx.restore();});
 }
 private drawCompletionContent(left:number,cy:number,width:number,landscape=false,panel?:Rect){
  if(this.offlineRoom)return this.offline.drawCompletion(this.stage,{...this.room!.ticket,room:this.room!.snapshot},left,cy,width,landscape,panel,{picture:r=>this.drawCompletionPicture(r),paragraph:(...args)=>this.paragraph(...args),launch:input=>void this.run(()=>this.launchOffline(input)),back:()=>this.exitRoom(),comic:{available:id=>this.hasLevelComic(id),open:id=>this.openLevelComic(id,{fromClear:true})}});
  const s=this.stage,room=this.room,snap=room?.snapshot as unknown as {title?:string;photo?:{title?:string};puzzle?:{imageId?:string};startedAt?:number|null;completedAt?:number|null;members?:Array<{name:string;code?:string|null;contribution?:number}>;mobileResult?:any}|undefined,result=snap?.mobileResult,ink=this.colors.ink,muted=this.colors.muted,center=(text:string,y:number,size:number,color:string,weight=700)=>s.text(text,left+Math.max(0,(width-s.measure(text,size,weight))/2),y,size,color,weight,width);
  const seats=this.completionSeats(),levelClear=result?.levelClear as import('../h5/mobile-api').MobileLevelClear|undefined,chapterComplete=levelClear&&(levelClear.chapterComplete||levelClear.nextLevelId===null),levelLandscape=landscape&&!!levelClear;
  if(!landscape&&!this.completionOutsideSeats(left-20,width+40)){this.completionAvatarRects.clear();this.completionSlotRects.clear();}
  if(landscape&&panel){const side=Math.min(240,panel.h-134,panel.w*.43);this.drawCompletionPicture({x:panel.x+16,y:panel.y+40,w:side,h:side});left=panel.x+16+side+16;width=panel.x+panel.w-16-left;
   // Short screens only lift the column when album reward lines need the room.
   cy=panel.y+Math.max(12,Math.min(42,panel.h-332+18*Math.max(0,2-(result?.catalog?.albumRewards?.length??0))));}
  else if(seats.length&&!this.completionOutsideSeats(left-20,width+40)){
   cy+=5; // Leave the first row clear of the modal heading.
   const side=width-146,rows=Math.ceil(seats.length/2),height=Math.max(side,rows*74+(rows-1)*8);this.drawCompletionPicture({x:left+73,y:cy,w:side,h:side});
   for(const seat of seats)this.drawCompletionSeat(seat,{x:seat.column==='left'?left:left+width-66,y:cy+seat.row*82,w:66,h:74},true);cy+=height+20;
  }else{const picture={x:left,y:cy,w:width,h:Math.min(width*.62,this.desktop?230:240)};this.drawCompletionPicture(picture);cy+=picture.h+20;}
  const title=(snap?.title||snap?.photo?.title||'这幅画')+'，拼好啦！';
  // A lifted landscape title shares the close button's row, so centre it in the space before the button.
  if(landscape&&panel&&cy<panel.y+36){const tw=width-28;s.text(title,left+Math.max(0,(tw-s.measure(title,17,800))/2),cy,17,ink,800,tw);}else center(title,cy,landscape?17:20,ink,800);cy+=levelLandscape?24:landscape?27:32;
  if(chapterComplete){center((this.levels?.chapters.find(chapter=>chapter.levels.some(level=>level.id===levelClear.levelId))?.title||'本章')+'完成！',cy,landscape?13:16,ink,800);cy+=landscape?18:26;}
  const pieces=room?room.state.cols*room.state.rows:0,started=snap?.startedAt,finished=snap?.completedAt,members=(snap?.members??[]).filter(member=>member.name),ranking=Array.isArray(result?.ranking)?result.ranking:null,contributors=ranking??members.filter(member=>(member.contribution??0)>0),together=contributors.length||members.length;
  const meta=[pieces?pieces+' 片':'',started&&finished&&finished>started?'用时 '+Math.max(1,Math.round((finished-started)/60000))+' 分钟':'',together?together+' 人同桌':''].filter(Boolean).join(' · ');if(meta){center(meta,cy,landscape?12:13,muted,600);cy+=levelLandscape?20:landscape?25:30;}
  if(this.cheersEnabled&&!landscape){this.drawCompletionBar({x:left,y:cy,w:width,h:this.layout==='phonePortrait'?58:46});cy+=this.layout==='phonePortrait'?72:60;}
    if(result){
     const imageId=snap?.puzzle?.imageId,album=imageId?this.collection?.albums.find(item=>item.images.some(image=>image.id===imageId)):undefined;
     const tiles:{icon:string;label:string;gold?:boolean}[]=[{icon:'coin',label:'金币 +'+(result.coins??0)},{icon:'fragment',label:'碎片 +'+(result.fragments??0)},...(this.energyEnabled&&result.energy?[{icon:'lightning',label:'体力 +'+result.energy}]:[]),...(levelClear?.firstClear&&this.energyEnabled&&levelClear.energy>0?[{icon:'lightning',label:'通关体力 +'+levelClear.energy}]:[]),...(album?[{icon:'book',label:'图集 '+album.collected+'/'+album.total}]:[]),...(landscape?[]:((result.catalog?.albumRewards??[]) as {title:string;coins?:number}[]).map(reward=>({icon:reward.coins?'coin':'leaf',label:reward.coins?'集满 +'+reward.coins:'得到装饰',gold:true})))];
     const gap=levelLandscape?6:8,columns=Math.min(tiles.length,landscape?levelClear?5:4:this.desktop||width>=420?5:4),tileH=levelLandscape?52:landscape?58:64,tw=(width-gap*(columns-1))/columns;
     const weights=levelLandscape?tiles.map(tile=>Math.max(40,s.measure(tile.label,12,700)+8)):[],total=weights.reduce((sum,value)=>sum+value,0);let tileX=left;
     tiles.forEach((tile,index)=>{const tileW=levelLandscape?(width-gap*(columns-1))*weights[index]/total:tw,r={x:levelLandscape?tileX:left+(index%columns)*(tw+gap),y:cy+Math.floor(index/columns)*(tileH+gap),w:tileW,h:tileH};tileX+=tileW+gap;s.frame(r,tile.gold?'panel-gold':'button-linen-normal');s.icon(tile.icon,{x:r.x+(tileW-26)/2,y:r.y+6,w:24,h:24});const base=levelLandscape?12:tw<84?12:13,size=Math.min(base,base*(tileW-8)/s.measure(tile.label,base,700));s.text(tile.label,r.x+Math.max(4,(tileW-s.measure(tile.label,size,700))/2),r.y+(levelLandscape?33:35),size,ink,700,tileW-8);});
     cy+=Math.ceil(tiles.length/columns)*(tileH+gap)+4;
     if(result.catalog?.newlyCollected){center('这张画作已收进图集',cy,landscape?12:13,muted,600);cy+=levelLandscape?16:landscape?18:26;}
     for(const reward of result.catalog?.albumRewards??[]){center(reward.title+'：'+(reward.coins?'金币 +'+reward.coins:'专属装饰已获得'),cy,landscape?12:13,ink,700);cy+=landscape?18:24;}
    }else{cy=this.paragraph('正在同步本次收获…奖励以服务器结算为准。',left,cy,width,14)+15;}
    cy+=landscape?2:6;const extra=this.completionFlow.action(this.completionContext()),primaryW=extra?(width-8)/2:width;if(extra){const size=Math.max(12,Math.min(16,16*(primaryW-12)/s.measure(extra.label,16,750)));s.button({x:left,y:cy,w:primaryW,h:landscape?40:46},extra.label,extra.action,{tone:extra.tone??'gold',fontSize:size});}s.button({x:extra?left+primaryW+8:left,y:cy,w:primaryW,h:landscape?40:46},levelClear?chapterComplete?levelClear.nextLevelId?'下一章':'去大厅':'下一关':'再来一桌',()=>{this.leaveRoom();if(levelClear){if(chapterComplete&&!levelClear.nextLevelId)this.navigate('lobby');else void this.launch({mode:'level',levelId:levelClear.nextLevelId!});}else this.navigate('gallery');},{tone:'berrydark',fontSize:16});cy+=landscape?46:56;
    const third=(width-16)/3,albumId=(snap?.puzzle?.imageId&&this.collection?.albums.find(item=>item.images.some(image=>image.id===snap.puzzle!.imageId))?.id)||'';
    s.button({x:left,y:cy,w:third,h:landscape?34:40},'分享成品',()=>void this.run(async()=>{const outcome=await this.shareFromGame({title:'我们拼好了「'+(snap?.title||snap?.photo?.title||'一幅画')+'」，来'+this.platform.config.gameName+'一起拼',inviteCode:this.tasks?.invitation.code});this.note(outcome==='copied'?'链接已复制，可以发给朋友':outcome==='shared'||outcome==='opened'?'已分享':outcome==='cancelled'?'本次分享已取消':'暂时无法分享');}),{fontSize:13});
    s.button({x:left+third+8,y:cy,w:third,h:landscape?34:40},'查看图集',()=>{this.leaveRoom();this.openCollection('albums');if(albumId)this.openAlbum(albumId);},{fontSize:13});
    s.button({x:left+(third+8)*2,y:cy,w:third,h:landscape?34:40},'回大厅',()=>{this.leaveRoom();this.navigate('lobby');},{fontSize:13});cy+=landscape?40:54;
  if(this.cheersEnabled&&landscape&&panel){const bar={x:panel.x+16,y:Math.max(this.completionPicture.y+this.completionPicture.h+8,cy+2),w:panel.w-32,h:44};this.drawCompletionBar(bar);const hint='点一下就能喝彩，同桌都看得到';s.text(hint,bar.x+(bar.w-s.measure(hint,11))/2,bar.y+49,11,muted,500);}
  return cy;
 }
 private drawLandscapeCompletion(){
  const s=this.stage,v=this.platform.viewport() as ReturnType<Platform['viewport']>&{left?:number;right?:number},available=s.w-(v.left??0)-(v.right??0),seatW=this.landscapeSeatWidth(available),w=Math.min(640,available-(this.completionSeats().length?2*(seatW+18):252)),panel={x:(v.left??0)+(available-w)/2,y:Math.max(8,v.top),w,h:s.h-Math.max(8,v.top)-Math.max(8,v.bottom)};
  s.ctx.fillStyle=this.colors.overlay;s.ctx.fillRect(0,0,s.w,s.h);s.hit({x:0,y:0,w:s.w,h:s.h},()=>{});s.frame(panel,'panel-cream');this.modalArea=panel;this.modalExtent=0;this.modalScroll=0;this.completionSeatRects.clear();this.drawCompletionSeats(panel);
  s.text('拼图完成',panel.x+16,panel.y+12,17,this.colors.ink,700);s.button({x:panel.x+panel.w-38,y:panel.y+7,w:28,h:28},'',()=>this.closeModal(),{icon:'close'});
  this.drawCompletionContent(panel.x+16,panel.y+40,panel.w-32,true,panel);this.drawCompletionEffects();
 }
 private drawCompletionEffects(){
  this.completionBubbleRects.clear();const fx=this.cheerEffects,now=Date.now();fx.update(now);const s=this.stage,c=s.ctx,p=this.completionPicture;
  // Cups meet above the image; only show them while its top is in the scroll viewport.
  if(fx.tea&&p.y>=this.modalArea.y){const t=(now-fx.tea.start)/1000,spread=40*(1-Math.min(1,t*2));for(const direction of [-1,1])drawCheerIcon(c,'tea',{x:p.x+p.w/2-16+direction*(16+spread),y:p.y-28-Math.sin(t*Math.PI)*8,w:32,h:32});}
  const outside=this.layout==='phoneLandscape'||this.completionOutsideSeats(this.modalArea.x-12,this.modalArea.w+24);
  const area=outside?{x:0,y:0,w:s.w,h:s.h}:this.modalArea,bubbleRect=(id:string)=>{const slot=this.completionSlotRects.get(id);if(slot)return !outside&&(slot.x+slot.w<=area.x||slot.x>=area.x+area.w||slot.y+slot.h<=area.y||slot.y>=area.y+area.h)?null:slot;return {x:clamp(p.x+p.w/2-21,area.x+2,area.x+area.w-44),y:clamp(p.y+p.h-48,area.y+2,area.y+area.h-40),w:42,h:38};};
  s.clip(area,()=>{
  const origin=(id:string)=>{const r=bubbleRect(id);return r?{x:r.x+r.w/2,y:r.y+r.h/2}:null;};
  for(const scene of fx.celebrations)drawCelebration(c,scene,now,{picture:this.completionPicture,field:this.modalArea,clip:area});
  for(const particle of fx.particles){const t=(now-particle.start)/particle.duration;c.save();const o=origin(particle.playerId),slot=this.completionSlotRects.get(particle.playerId),rise=slot?t*((outside?64:60)+particle.y*12):t*100+particle.y*20,dx=slot?outside?Math.sin(t*8)*(particle.x*2-1)*Math.max(0,slot.w/2-12):(.35*rise*(slot.x<p.x+p.w/2?1:-1)+Math.sin(t*8)*(particle.x*2-1)*4):(particle.x-.5)*60;c.globalAlpha=1-t;if(o)drawCheerIcon(c,'heart',{x:o.x-12+dx,y:o.y-12-rise,w:24,h:24});c.restore();}
  if(now<fx.starsUntil){const size=16+Math.round(8*Math.abs(Math.sin(now/95)));for(const [x,y] of [[p.x,p.y],[p.x+p.w,p.y],[p.x,p.y+p.h],[p.x+p.w,p.y+p.h]])drawCheerIcon(c,'star',{x:x-size/2,y:y-size/2,w:size,h:size});}
  for(const bubble of fx.bubbles){const target=bubbleRect(bubble.playerId),scale=fx.bubbleScale(bubble);if(!target||scale<=0)continue;const r={x:target.x+target.w/2*(1-scale),y:target.y+target.h/2*(1-scale),w:target.w*scale,h:target.h*scale};this.completionBubbleRects.set(bubble.playerId,r);
   // Stage.frame paints in physical pixels, so animate its rectangle explicitly.
   c.save();c.globalAlpha=fx.bubbleAlpha(bubble);s.clip(r,()=>{s.frame(r,'button-cream-normal');if(scale>.5){drawCheerIcon(c,bubble.emote,{x:r.x+(r.w-24*scale)/2,y:r.y+r.h/2-14*scale,w:24*scale,h:24*scale});if(bubble.count>=2){const badge={x:r.x+r.w-22*scale,y:r.y+r.h-14*scale,w:20*scale,h:12*scale};c.fillStyle=this.colors.berry;c.fillRect(badge.x,badge.y,badge.w,badge.h);s.text('×'+bubble.count,badge.x+2*scale,badge.y+scale,9*scale,this.colors.onAccent,800,16*scale);}}});c.restore();}
  // Portrait slots flank the picture's top edge, so the combo banner narrows to fit between them.
  if(fx.combo){const label=fx.combo.count+' 人一起喝彩！',cx=p.x+p.w/2,room=outside?Infinity:Math.min(Infinity,...[...this.completionSlotRects.values()].filter(r=>r.y<p.y+29&&r.y+r.h>p.y-3).map(r=>(r.x+r.w<=cx?cx-r.x-r.w:r.x-cx)-2)),w=Math.min(p.w+60,s.measure(label,14,800)+58,room*2),r={x:p.x+(p.w-w)/2,y:p.y-3,w,h:32};s.frame(r,'button-gold-normal');s.text(label,r.x+(w-s.measure(label,14,800))/2,r.y+8,14,this.colors.ink,800);for(const x of [r.x+5,r.x+w-21])drawCheerIcon(c,'star',{x,y:r.y+8,w:16,h:16});}
  });
 }
 private drawOrientationPicker(){
  const s=this.stage,v=this.platform.viewport(),w=Math.min(s.w-32,420),tileH=clamp(s.h-v.top-v.bottom-216,84,116),h=tileH+184,x=(s.w-w)/2,y=v.top+(s.h-v.top-v.bottom-h)/2,left=x+20,width=w-40,tileW=(width-12)/2,cy=y+80;
  s.ctx.fillStyle=this.colors.overlay;s.ctx.fillRect(0,0,s.w,s.h);s.hit({x:0,y:0,w:s.w,h:s.h},()=>{});s.panel({x,y,w,h});
  const centered=(label:string,top:number,size:number,color:string,weight=500)=>s.text(label,x+(w-s.measure(label,size,weight))/2,top,size,color,weight,w-40);
  this.modalArea={x,y,w,h};this.modalExtent=0;this.modalScroll=0;
  s.button({x:x+w-38,y:y+8,w:28,h:28},'',()=>this.closeModal(),{icon:'close',disabled:this.orientationSwitching});
  centered('选择屏幕方向',y+20,20,this.colors.ink,700);centered('点一下立即切换，选好后点确认',y+51,13,this.colors.muted);
  const options:readonly(readonly[ScreenOrientation,string,string])[]=[['landscape','横屏','画面更宽'],['portrait','竖屏','单手更顺']];
  options.forEach(([value,label,caption],index)=>{
   const tile={x:left+index*(tileW+12),y:cy,w:tileW,h:tileH};s.button(tile,'',()=>void this.chooseOrientation(value),{selected:this.orientationChoice===value,disabled:this.orientationSwitching});
   const c=s.ctx,on=this.orientationChoice===value,tint=on?this.colors.rose:this.colors.ink,dw=value==='landscape'?44:28,dh=value==='landscape'?28:44,dx=tile.x+(tile.w-dw)/2,dy=tile.y+(tile.h-46-dh)/2,r=5;
   // The pixel frame's selected state is subtle; a rose inner ring makes the current choice obvious.
   c.save();if(on){c.strokeStyle=this.colors.rose;c.lineWidth=3;c.strokeRect(tile.x+6.5,tile.y+6.5,tile.w-13,tile.h-13);}c.strokeStyle=tint;c.lineWidth=2;c.beginPath();c.moveTo(dx+r,dy);c.arcTo(dx+dw,dy,dx+dw,dy+dh,r);c.arcTo(dx+dw,dy+dh,dx,dy+dh,r);c.arcTo(dx,dy+dh,dx,dy,r);c.arcTo(dx,dy,dx+dw,dy,r);c.closePath();c.stroke();c.fillStyle=tint;c.beginPath();c.arc(value==='landscape'?dx+dw-5:dx+dw/2,value==='landscape'?dy+dh/2:dy+dh-5,1.5,0,Math.PI*2);c.fill();c.restore();
   s.text(label,tile.x+(tile.w-s.measure(label,16,700))/2,tile.y+tile.h-46,16,this.colors.ink,700);s.text(caption,tile.x+(tile.w-s.measure(caption,12))/2,tile.y+tile.h-26,12,this.colors.muted);
   if(on)s.icon('check',{x:tile.x+tile.w-28,y:tile.y+10,w:18,h:18},this.colors.rose);
  });
  centered('之后也能点右上角的旋转按钮随时切换',cy+tileH+12,12,this.colors.muted);s.button({x:left,y:cy+tileH+42,w:width,h:42},'确认',()=>this.confirmOrientation(),{tone:'berry',fontSize:15,disabled:this.orientationSwitching});
 }
 private drawModal(){
  if(this.modal==='orientation'){this.drawOrientationPicker();return;}
  if(this.modal==='levelComic'){this.drawLevelComic();return;}
  if(this.modal==='completion'&&this.layout==='phoneLandscape'){this.drawLandscapeCompletion();return;}
  if(this.modal==='playerCard'){this.drawPlayerCard();return;}
  if(this.modal==='history'){this.drawHistoryWindow();return;}
  if(this.modal==='tasks'){this.drawTaskWindow();return;}
  if(this.modal==='chat'){this.drawPublicChat();return;}
  if(this.modal==='packPreview'){this.drawPackPreview();return;}
  const s=this.stage,currencyHelp=this.modal==='coins'||this.modal==='fragments',v=this.platform.viewport(),w=Math.min(s.w-24,currencyHelp?440:this.modal==='completion'?560:540),x=(s.w-w)/2,h=currencyHelp?Math.min(520,s.h-v.top-v.bottom-39):s.h-Math.max(v.top+15,s.h*.1)-v.bottom-24,y=currencyHelp?v.top+15+(s.h-v.top-v.bottom-39-h)/2:Math.max(v.top+15,s.h*.1);
  s.ctx.fillStyle=this.colors.overlay;s.ctx.fillRect(0,0,s.w,s.h);s.hit({x:0,y:0,w:s.w,h:s.h},()=>{});s.panel({x,y,w,h});
  const titles:Record<Exclude<Modal,null>,string>={levelComic:'小窝的故事',orientation:'选择屏幕方向',members:'同桌玩家',playerCard:'玩家名片',privacyRequests:'个人资料申请',coins:'金币说明',fragments:'装饰碎片说明',tasks:'任务与礼包',albums:'选择相册',filters:this.route==='gallery'?'筛选图片':'筛选房间',settings:'玩家与设置',history:'历史记录',manage:this.formalWeb?'我的房间':'自己的房间',invite:'邀请好友',tools:'拼图工具',chat:'同桌交流',social:this.social.title,completion:'拼图完成',purchase:'解锁主题图包',packPreview:this.previewPack?.title??'图包预览'};
  s.text(titles[this.modal!],x+17,y+18,20,this.colors.ink,700,w-73);s.button({x:x+w-45,y:y+12,w:30,h:30},'',()=>{this.closeModal();this.invalidate();});
  // A vector cross has the same visible size and center with browser and wx fonts.
  s.icon('close',{x:x+w-42,y:y+15,w:24,h:24},this.colors.ink);
  this.modalStart=y+59;this.modalArea={x:x+12,y:this.modalStart,w:w-24,h:h-73};let cy=this.modalStart-this.modalScroll;const left=x+20,width=w-40;
  if(this.modal==='social'){this.modalExtent=0;this.modalScroll=0;this.social.render(s,this.modalArea);return;}
  if(this.modal==='completion'){this.completionSeatRects.clear();if(this.completionOutsideSeats(x,w))this.drawCompletionSeats({x,y,w,h});}
  s.clip(this.modalArea,()=>{switch(this.modal){
   case'members':{
    for(const member of this.room?.snapshot.members??[]){s.icon('avatar',{x:left,y:cy,w:30,h:32});s.text(member.name,left+42,cy+2,15,this.colors.ink,700,width-52);s.text('Lv.'+((member as {level?:number}).level??0),left+42,cy+23,12,this.colors.muted);s.hit({x:left,y:cy,w:width,h:49},()=>void this.openPlayerCard(member));cy+=57;}break;
   }
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
    const p=this.client.profile,canRename=this.formalWeb||this.client.config.capabilities.customNames===true,heading=(label:string)=>{s.text(label,left,cy,15,this.colors.ink,800);cy+=28;};
    s.icon('avatar',{x:left,y:cy,w:54,h:58});s.text(p?.name??'玩家',left+70,cy+4,18,this.colors.ink,800,width-160);if(canRename)s.button({x:left+width-74,y:cy,w:74,h:32},'改名',()=>this.formalWeb?this.openWeb('account'):void this.run(async()=>{const value=await this.platform.prompt('昵称（1～16字）',p?.name);if(value!==null){await this.client.json('/api/mobile/profile','PATCH',{name:value.trim()},{'Content-Type':'application/json'});await this.client.refresh();this.note('昵称已保存');}}),{fontSize:13});
    s.text('Lv.'+(p?.level??'—')+' · 经验 '+(p?.xp??0)+'/'+(p?.xpToNext??0)+' · 玩家 ID '+(p?.code||this.social.playerCode||'…'),left+70,cy+30,12,this.colors.muted,600,width-70);
    s.button({x:left+70,y:cy+50,w:96,h:30},'换装饰',()=>{this.showModal(null);this.openCollection('decorations');},{icon:'leaf',fontSize:12});cy+=96;
    if(!canRename)cy=this.paragraph('首测暂停自定义昵称，当前昵称与已有进度保留。',left,cy,width,12)+14;
    if(this.formalWeb){s.text(this.client.account?'已登录 · '+this.client.account.username:'网站游客进度',left,cy,12,this.colors.muted,600,width);cy+=28;for(const[label,key]of [[this.client.account?'账号管理':'登录 / 注册','account'],['账号安全与数据管理','security']] as const){this.button(left,cy,width,label,()=>this.openWeb(key));cy+=48;}}
    heading('外观');this.rowOptions(themeOptions,this.stage.theme,left,cy,width,value=>this.setTheme(value),39);cy+=56;
    if(this.platform.setUiSize){heading('界面大小');this.rowOptions([['small','小'],['auto','自动'],['large','大'],['xlarge','特大']] as const,this.platform.uiSize?.()??'auto',left,cy,width,value=>{this.platform.setUiSize?.(value);this.invalidate();},39);cy+=48;cy=this.paragraph('自动：按窗口大小放大',left,cy,width,12)+16;}
    s.text('声音',left,cy,15,this.colors.ink,750);cy+=31;
    if(this.audioSettings.hasMusic){cy=this.drawAudioLevel('music','背景音乐',left,cy,width);cy=this.paragraph('轻快的轻音乐，一首放完会先停一会儿再换下一首。调到 0% 即关闭。',left,cy,width,12)+16;}
    this.button(left,cy,width,this.audioSettings.levels.effects===0?'开启音效':'音效静音',()=>this.toggleEffectsMute(),this.audioSettings.levels.effects===0?'cream':'berry',39);cy+=51;
    cy=this.drawAudioLevel('effects','游戏音效',left,cy,width);
    cy=this.paragraph('控制拼合、金币等游戏音效，设置会自动记住。',left,cy,width,12)+18;
    s.text('画面',left,cy,15,this.colors.ink,750);cy+=28;this.rowOptions([['smooth','流畅'],['power-saving','省电']],this.performanceMode,left,cy,width,value=>this.setPerformanceMode(value),39);cy+=48;cy=this.paragraph(this.performanceMode==='power-saving'?'持续画面最高30帧，拖动流畅度略有降低。':'跟随设备正常刷新频率，优先保证拖动流畅。',left,cy,width,12)+18;
    if(this.platform.config.id==='web'||this.desktop||this.platform.config.id==='taptap'){heading('操作');if(this.desktop){cy=this.paragraph('快捷键（电脑）：E 边缘 · H 提示 · B 底图 · F 适配 · '+(this.soloRoom?'R 整理 · ':'')+'T 收起/展开工具 · 空格或中键拖动平移 · 滚轮缩放 · Esc 返回',left,cy,width,12)+12;}
     if(this.platform.config.id==='web'&&this.platform.fullscreen?.available()){this.button(left,cy,width,this.platform.fullscreen.active()?'退出全屏':'全屏',()=>void this.toggleFullscreen(),'cream',39);cy+=51;}
    if(this.platform.config.id==='taptap'){this.button(left,cy,width,this.stage.w>this.stage.h?'切换竖屏':'切换横屏',()=>void this.toggleOrientation(),'cream',39);cy+=51;}
    }
    heading('账号与记录');
    this.button(left,cy,width,(this.formalWeb?'好友':'好友与消息')+(this.social.unread?' · '+this.social.unread+' 条未读':''),()=>{if(this.room)this.showModal('social');else this.navigate('friends');},'cream',39);cy+=50;
    if(this.energyEnabled){this.button(left,cy,width,(p?.autoSupply?'✓ ':'')+'体力耗尽自动使用库存包',()=>void this.run(async()=>{await this.client.json('/api/mobile/profile','PATCH',{autoSupply:!p?.autoSupply},{'Content-Type':'application/json'});await this.client.refresh();}));cy+=47;cy=this.paragraph('只消耗已有体力包，不会自动发起分享。',left,cy,width,12)+18;}
    const policyActions=this.formalWeb?[["隐私说明",()=>this.openWeb('privacy')],["服务说明",()=>this.openWeb('terms')]] as const:[["服务与隐私说明",()=>this.navigate('privacy')]] as const;
    if(this.formalWeb){this.button(left,cy,width,'用我的图片开一桌',()=>this.openWeb('uploads'),'berry',42);cy+=52;cy=this.paragraph('上传一张图片，选好片数，开一张自己的公开拼图桌。图片只在房间有效期内保留。',left,cy,width,12)+18;}
    for(const [label,action]of [['历史拼图',()=>this.showModal('history')],['玩法帮助',()=>this.navigate('help')],...policyActions] as const){this.button(left,cy,width,label,action);cy+=48;}
    s.text('当前版本 '+CLIENT_PACKAGE_VERSION+(this.platform.config.buildVersion?' · '+this.platform.config.buildVersion:''),left,cy+4,12,this.colors.muted,600,width);cy+=30;
    if(this.formalWeb){this.button(left,cy,width,'问题反馈',()=>this.openWeb('feedback'));cy+=48;cy=this.paragraph('账号、进度与收藏会持续保存在当前网站。',left,cy+4,width,12)+10;}else{this.button(left,cy,width,'个人资料访问与删除申请',()=>this.showModal('privacyRequests'));cy+=48;cy=this.paragraph('当前为本机游客身份，尚未绑定平台账号存档。清除本机数据可能丢失进度。',left,cy+4,width,12)+10;}
    if(this.platform.config.id==='taptap'&&this.platform.loginLog){this.button(left,cy,width,'登录日志',()=>this.openLoginLog());cy+=48;}
    if(this.adTestingAllowed||this.platform.config.id==='taptap'&&this.platform.config.tapAuthorizationTest||this.platform.config.previewTestRoom||this.nineGridAvailable||this.platform.config.id==='taptap'&&p?.taptap?.diagnostics===true||this.diagnosticsAvailable){cy+=10;heading('测试与诊断');}
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
    if(this.diagnosticsAvailable){
    this.button(left,cy,width,this.performanceInfoVisible?'隐藏性能信息':'显示性能信息',()=>{this.performanceInfoVisible=!this.performanceInfoVisible;this.invalidate();});cy+=48;
    if(this.performanceInfoVisible&&this.board){const board=this.board;this.button(left,cy,width,'诊断：背景缓存'+(board.gestureCacheEnabled?'开启':'关闭'),()=>{board.setGestureCacheEnabled(!board.gestureCacheEnabled);this.invalidate();});cy+=48;}
    if(this.performanceInfoVisible&&this.platform.setTouchInputMode){this.button(left,cy,width,'诊断：输入'+(this.platform.inputDiagnostics?.().mode==='touch'?'原生触摸':'指针'),()=>{this.platform.setTouchInputMode?.(this.platform.inputDiagnostics?.().mode!=='touch');this.invalidate();});cy+=48;}
    if(this.performanceInfoVisible&&this.platform.config.id==='taptap'&&this.board&&this.onRenderProbe){this.button(left,cy,width,'一键卡顿对照（约14秒）',()=>{this.showModal(null);this.onRenderProbe?.();});cy+=48;cy=this.paragraph('测试时持续划动屏幕；期间不会移动拼片，结束后显示结果。',left,cy,width,12)+12;}
    }
    break;
   }
   case'manage':{
    {this.button(left,cy,width,'返回历史记录',()=>this.showModal('history'),'cream',36);cy+=48;}
    cy=this.paragraph(this.formalWeb?'删除只移除自创列表入口，历史记录和大家的拼图进度仍保留。':'最多保留3个未完成的自创房间入口。删除只释放名额，最近10间历史和大家的拼图进度仍保留。',left,cy,width,13)+15;
    for(const room of this.client.profile?.ownedRooms??[])cy=this.drawSavedRoom(room,left,cy,width,true);
    if(!this.client.profile?.ownedRooms.length){s.text('还没有自创房间',left,cy+15,14,this.colors.muted);cy+=65;}break;
   }
   case'invite':{
    s.icon('invitationArt',{x:left+width/2-46,y:cy,w:92,h:89});cy+=102;s.text('邀请好友，一起攒礼包',left,cy,20,this.colors.ink,700,width);cy+=40;const invitation=this.tasks?.invitation,sharingTask=this.tasks?.tasks.find(task=>task.group==='sharing'),invitationTask=this.tasks?.tasks.find(task=>task.group==='invitation');
    if(this.energyEnabled){cy=this.paragraph('每位有效好友体力上限 +1（最多 +5），并送补满体力包'+(invitationTask?.xp?'及 '+invitationTask.xp+' 经验':'')+taskCoinsText(invitationTask?.coins??0),left,cy,width,14)+12;s.text('已加成 '+(invitation?.capBonus??0)+'/'+(invitation?.capBonusMaximum??5),left,cy,14,this.colors.berry,700);cy+=30;cy=this.paragraph('好友接受首次邀请并完成'+(invitation?.requiredContributions??3)+'次有效拼合后生效。补满包每日最多'+(invitation?.dailyLimit??3)+'份；新老玩家都可参与。',left,cy,width,12)+19;}else{cy=this.paragraph('好友接受首次邀请并完成'+(invitation?.requiredContributions??3)+'次有效拼合后，任务奖励为：'+this.rewardText(0,invitationTask?.xp??0,invitationTask?.coins??0)+'。每日最多'+(invitation?.dailyLimit??3)+'位；新老玩家都可参与。',left,cy,width,14)+19;}
    if(sharingTask){cy=this.paragraph('分享邀请奖励：'+this.rewardText(sharingTask.energy,sharingTask.xp,sharingTask.coins??0)+'，每日最多 '+sharingTask.target+' 次。',left,cy,width,12)+15;}
    s.text('我的邀请码（点击复制）',left,cy,12,this.colors.muted);cy+=26;s.text(this.tasks?.invitation.code??'正在读取…',left,cy,20,this.colors.ink,700,width);{const code=this.tasks?.invitation.code;if(code)s.hit({x:left-6,y:cy-8,w:Math.min(width,s.measure(code,20,700)+24),h:38},()=>this.copyInvitationCode(code));}cy+=40;this.button(left,cy,width,'邀请好友',()=>void this.shareInvitation(),'berry',42);cy+=56;
    cy=this.paragraph('好友任务以真实参与为准，仅打开分享界面不会计为已发出成功或发放奖励。',left,cy,width,12)+18;
    this.button(left,cy,width,this.pendingInvitation?'邀请码：'+this.pendingInvitation:'输入好友邀请码',()=>void this.run(async()=>{const value=await this.platform.prompt('输入好友邀请码',this.pendingInvitation);if(value!==null)this.pendingInvitation=value.trim();}));cy+=48;
    if(this.pendingInvitation){this.button(left,cy,width,'接受好友邀请',()=>void this.acceptInvitation(),'green',40);cy+=52;}
    if(this.tasks?.invitation.bound){s.text('已关联：'+(this.tasks.invitation.boundToName??'好友'),left,cy,13,this.colors.muted);cy+=35;}break;
   }
   case'tools':{
    // The table look is changed here too, so players need not leave the board to reach settings.
    s.text('桌面外观',left,cy,15,this.colors.ink,800);cy+=28;this.rowOptions(themeOptions,this.stage.theme,left,cy,width,value=>this.setTheme(value),39);cy+=56;
    if(this.platform.config.id==='taptap'){this.button(left,cy,width,this.stage.w>this.stage.h?'切换竖屏':'切换横屏',()=>void this.toggleOrientation(),'cream',40);cy+=51;}
    if(this.platform.config.id==='web'&&this.platform.fullscreen?.available()){this.button(left,cy,width,this.platform.fullscreen.active()?'退出全屏':'进入全屏',()=>void this.toggleFullscreen(),'cream',40);cy+=51;}
    const board=this.board,room=this.room;for(const [label,action]of [
     ['适配完整桌面',()=>{board?.fit();this.modal=null;this.toolsOpen=false;this.invalidate();}],
     ['放大',()=>{if(!this.completionFx)board?.zoom(1.25);this.invalidate();}],['缩小',()=>{if(!this.completionFx)board?.zoom(.8);this.invalidate();}],
     [this.platform.config.id==='web'?'定位未归位拼块':'定位未拼块 · 全部闪亮标出',()=>{if(this.platform.config.id==='web')board?.find();else this.locateLoose();this.modal=null;this.toolsOpen=false;this.invalidate();}],
     [board?.trayOpen?'关闭碎片托盘':'打开碎片托盘 · 点选定位',()=>{if(board)board.trayOpen=!board.trayOpen;this.modal=null;this.toolsOpen=false;this.invalidate();}],
     ['整理散落拼块',()=>void this.run(async()=>{await room?.organize();this.modal=null;this.toolsOpen=false;this.note('散片已整理');})],
     [this.lockButtonEnabled?'关闭锁定按钮':'启用锁定按钮 · 锁住后单指不移动画面',()=>{this.setLockButtonEnabled(!this.lockButtonEnabled);this.modal=null;this.toolsOpen=false;this.invalidate();}],
     [board?.showPreview?'关闭原图小窗':'原图小窗 · 点小窗可放大',()=>{if(board)board.showPreview=!board.showPreview;this.modal=null;this.invalidate();}],
    ] as const){if(label==='整理散落拼块'&&!this.soloRoom)continue;this.button(left,cy,width,label,action,'cream',40);cy+=51;}
    this.button(left,cy,width,'打开设置 · 声音、画面等',()=>this.showModal('settings'),'cream',40);cy+=51;
    s.text('当前版本 '+CLIENT_PACKAGE_VERSION+(this.platform.config.buildVersion?' · '+this.platform.config.buildVersion:''),left,cy,12,this.colors.muted,600,width);cy+=28;break;
   }
   case'chat':{
    const room=this.room;s.text('同桌 '+(room?.snapshot.members.length??0)+'人',left,cy,15,this.colors.ink,700);cy+=29;for(const member of room?.snapshot.members??[]){s.text(member.name+' · Lv.'+((member as typeof member&{level?:number}).level??1),left,cy,13,member.color);cy+=25;}cy+=10;
    const last=this.messages.slice(-8);for(const item of last){s.text(item.name,left,cy,12,this.colors.muted,700);cy+=22;cy=this.paragraph(item.text,left+7,cy,width-14,14,this.colors.ink)+12;}if(!last.length){s.text('发一句问候吧',left,cy,14,this.colors.muted);cy+=36;}
    phrases.forEach((text,index)=>{const bw=(width-8)/2;this.button(left+(index%2)*(bw+8),cy+Math.floor(index/2)*45,bw,text,()=>void this.say(index),'cream',35);});cy+=Math.ceil(phrases.length/2)*45+10;break;
   }
   case'completion':{cy=this.drawCompletionContent(left,cy,width);break;}
   case'purchase':{
    const pack=this.purchase;if(!pack)break;if(pack.images[0])this.cardImage(pack.images[0].thumbSrc,{x:left,y:cy,w:width,h:Math.min(220,width*.75)});cy+=Math.min(220,width*.75)+21;s.text(pack.title,left,cy,22,this.colors.ink,700);cy+=39;cy=this.paragraph(pack.images.length+'张图片永久解锁。可免费指定本包图片创建公开房间；私人房仍使用建房券。',left,cy,width,14)+18;s.text('花费 '+pack.price+' 金币',left,cy,20,this.colors.ink,700);cy+=34;s.text('现有 '+(this.collection?.wallet.coins??0)+' 金币',left,cy,13,this.colors.muted);cy+=39;this.button(left,cy,width,(this.collection?.wallet.coins??0)<pack.price?'金币不足':'确认解锁',()=>void this.collectionAction('buy',pack.id),'berry',42,(this.collection?.wallet.coins??0)<pack.price);cy+=57;break;
   }
  }});if(this.modal==='completion')this.drawCompletionEffects();this.modalExtent=cy-(this.modalStart-this.modalScroll)+7;const next=clamp(this.modalScroll,0,Math.max(0,this.modalExtent-this.modalArea.h));if(next!==this.modalScroll){this.modalScroll=next;this.invalidate();}
 }

 input(input:Input):boolean{
  if(input.type==='down'&&this.settingsTipDrawn&&this.canShowSettingsTip){this.settingsTipSeen=true;this.settingsTipDrawn=false;try{this.platform.storage.set(settingsTipKey,'1');}catch{}this.invalidate();}
  if(this.needsPrivacyChoice||this.loginLogOpen){
   const point=input.changed[0]??input.points[0];
   if(input.type==='wheel'&&point&&inside(this.listArea,point.x,point.y)){this.scroll=clamp(this.scroll+(Number.isFinite(input.deltaY)?input.deltaY!:0),0,Math.max(0,this.extent-this.listArea.h));this.stage.input({type:'cancel',points:[],changed:[]});this.pointer=null;this.invalidate();return true;}
   if(input.type==='down'&&point)this.pointer={x:point.x,y:point.y,lastY:point.y,scroll:false,board:false};
   if(input.type==='move'&&point&&this.pointer&&inside(this.listArea,this.pointer.x,this.pointer.y)){const p=this.pointer;if(p.scroll||Math.abs(point.y-p.y)>6){p.scroll=true;this.stage.input({type:'cancel',points:[],changed:[]});this.scroll=clamp(this.scroll+p.lastY-point.y,0,Math.max(0,this.extent-this.listArea.h));p.lastY=point.y;this.invalidate();return true;}}
   if(input.type==='up'||input.type==='cancel'){const scrolled=this.pointer?.scroll;this.pointer=null;if(scrolled)return true;}return this.stage.input(input);
  }
  if(this.loginDialogActive||this.platform.tapAuthorizationPending?.())return this.stage.input(input);
  if(!this.ready&&!this.offline?.active&&!this.offlineRoom)return this.stage.input(input);
  if(input.type==='down'&&this.storyIntro){this.storyIntro=null;this.stopStoryFrame();this.invalidate();}
  const point=input.changed[0]??input.points[0];
  if(input.type==='key'){
   if(this.modal==='levelComic'&&(input.key==='ArrowLeft'||input.key==='ArrowRight')){if(input.keyDown)this.turnComic((this.comicPage?.index??0)+(input.key==='ArrowLeft'?-1:1));return true;}
   if(this.cheersEnabled&&this.modal==='completion'&&input.keyDown&&!input.repeat&&/^[1-6]$/.test(input.key??'')){this.sendCompletionCheer(CHEER_EMOTES[Number(input.key)-1]);return true;}
   if(input.key==='Escape'&&input.keyDown){if(this.modal==='packPreview'&&this.previewIndex>=0){this.returnToPackGrid();return true;}this.cancelChatPress();const handled=!this.boardInputBlocked?(this.board?.input(input)??false):false;this.pointer=null;this.stage.input({type:'cancel',points:[],changed:[]});if(this.modal){this.closeModal();return true;}if(this.toolsOpen){this.toolsOpen=false;this.invalidate();return true;}if(this.route!=='room'&&this.route!=='lobby'){this.back();return true;}return handled;}
   if(this.route==='room'&&!this.boardInputBlocked&&input.keyDown&&!input.repeat&&input.key){const key=input.key.toLowerCase();if(key==='t'&&this.layout==='desktop'){this.setDesktopToolsOpen(!this.desktopToolsOpen);return true;}const tool=({e:'edge',h:'hint',b:'underlay',f:'fit',l:'locate',r:'organize'} as Record<string,string>)[key];if(tool&&(tool!=='organize'||this.soloRoom)&&(tool!=='locate'||this.platform.config.id!=='web')){this.roomTool(tool);return true;}}
   return this.route==='room'&&!this.boardInputBlocked?this.board?.input(input)??false:false;
  }
  if(input.type==='move'&&this.platform.canvas.style&&point){this.platform.canvas.style.cursor=this.pointer?.board?'grabbing':this.stage.hasHit(point.x,point.y)?'pointer':this.route==='room'&&inside(this.roomArea,point.x,point.y)&&!this.modalBlocksInput?'grab':'default';}
  if(this.modal==='levelComic')return this.inputComic(input);
  if(this.modal==='social'){this.pointer=null;this.cancelChatPress();return this.social.input(input)||this.stage.input(input);}
  if(input.type==='wheel'){
   if(!point)return false;this.cancelChatPress();const delta=Number.isFinite(input.deltaY)?input.deltaY!:0;
   // Keep an active board gesture intact, even when it crosses a floating panel.
   if(this.pointer?.board&&!this.boardInputBlocked)return this.board?.input(input)??false;
   const onModal=this.modalContains(point.x,point.y);
   if(onModal||this.route!=='room'){this.stage.input({type:'cancel',points:[],changed:[]});this.pointer=null;}
   if(onModal){if(inside(this.modalArea,point.x,point.y)){this.modalScroll=clamp(this.modalScroll+delta,0,Math.max(0,this.modalExtent-this.modalArea.h));this.invalidate();}return true;}
   if(this.route==='room'){if(!this.boardInputBlocked&&this.board&&inside(this.roomArea,point.x,point.y)&&!this.stage.hasHit(point.x,point.y))return this.board.input(input);return false;}
   if(inside(this.albumListArea,point.x,point.y)){this.albumListScroll=clamp(this.albumListScroll+delta,0,Math.max(0,this.albumListExtent-this.albumListArea.h));this.invalidate();return true;}
   if(inside(this.listArea,point.x,point.y)){this.scroll=clamp(this.scroll+delta,0,Math.max(0,this.extent-this.listArea.h));if(this.route==='lobby'&&this.lobbyCursor&&this.scroll>this.extent-this.listArea.h-180)void this.loadLobby(true);this.invalidate();return true;}return false;
  }
  if(input.type==='cancel'||input.type==='up')this.cancelChatPress();
  if(input.type==='move'&&this.chatPress&&point&&Math.hypot(point.x-this.chatPress.x,point.y-this.chatPress.y)>6)this.cancelChatPress();
  if(this.modal==='chat'&&input.type==='down'&&point){const hit=this.chatHits.find(hit=>inside(hit.r,point.x,point.y));if(hit){this.cancelChatPress();this.chatPress={x:point.x,y:point.y,timer:setTimeout(()=>{this.stage.input({type:'cancel',points:[],changed:[point]});this.pointer=null;this.openPublicMessage(hit.message);},550)};}}
  if(!point){if(input.type==='cancel'){this.pointer=null;if(!this.boardInputBlocked)this.board?.input(input);}return this.stage.input(input);}
  if(!this.pointer&&this.route==='room'&&this.board&&!this.boardInputBlocked&&(input.type==='move'||input.type==='cancel')){if(this.stage.hasHit(point.x,point.y)&&inside(this.roomArea,point.x,point.y)){this.cursor?.point(null);return this.stage.input(input);}return this.board.input(input);}
  if(input.type==='down'){
   if(this.pointer?.board&&this.board&&!this.boardInputBlocked){this.pointer.landscapeBackgroundTap=false;return this.board.input(input);}
   const onModal=this.modalContains(point.x,point.y),board=!!this.board&&this.route==='room'&&!this.boardInputBlocked&&inside(this.roomArea,point.x,point.y)&&!this.stage.hasHit(point.x,point.y);
   if(input.pan&&!board)return true;
   this.pointer={x:point.x,y:point.y,lastY:point.y,scroll:false,board,modal:onModal,album:!onModal&&inside(this.albumListArea,point.x,point.y)};
   if(board){const handled=this.board!.input(input);this.pointer.landscapeBackgroundTap=this.platform.config.id!=='web'&&this.layout==='phoneLandscape'&&this.landscapeToolsOpen&&!input.pan&&input.points.length===1&&this.board!.backgroundTouch;return handled;}return this.stage.input(input);
  }
  if(this.pointer?.board&&!this.boardInputBlocked){const p=this.pointer;if(input.points.length>1||Math.hypot(point.x-p.x,point.y-p.y)>6)p.landscapeBackgroundTap=false;const handled=this.board?.input(input)??false;if(input.type==='cancel'||(input.type==='up'&&!input.points.length)){this.pointer=null;if(input.type==='up'&&p.landscapeBackgroundTap)this.setLandscapeToolsOpen(false);}return handled;}
  if(input.type==='move'&&this.pointer){const p=this.pointer,canScroll=p.modal?inside(this.modalArea,p.x,p.y):this.route!=='room'&&(p.album||inside(this.listArea,p.x,p.y));
   if(canScroll&&(p.scroll||Math.abs(point.y-p.y)>6)){if(!p.scroll)this.stage.input({type:'cancel',points:[],changed:input.changed});p.scroll=true;const delta=p.lastY-point.y;if(p.modal)this.modalScroll=clamp(this.modalScroll+delta,0,Math.max(0,this.modalExtent-this.modalArea.h));else if(p.album)this.albumListScroll=clamp(this.albumListScroll+delta,0,Math.max(0,this.albumListExtent-this.albumListArea.h));else{this.scroll=clamp(this.scroll+delta,0,Math.max(0,this.extent-this.listArea.h));if(this.route==='lobby'&&this.lobbyCursor&&this.scroll>this.extent-this.listArea.h-180)void this.loadLobby(true);}p.lastY=point.y;this.invalidate();return true;}p.lastY=point.y;
  }
  if(input.type==='up'||input.type==='cancel'){const scrolled=this.pointer?.scroll;this.pointer=null;if(scrolled)return true;}return this.stage.input(input);
 }
}
