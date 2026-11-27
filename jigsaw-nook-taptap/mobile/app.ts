import type {AdPlacementKey,Platform,Input,Rect,Route,TelemetryBridge,Viewport} from './ports';
import {GameClient,type PlayerCard} from './client';
import {Stage} from './ui';
import {comicFor,reducedComicMotion,type Comic,type ComicPageState} from './story-comic';
import {OfflineMode,OFFLINE_REQUIRED,type OfflineInput} from './offline-mode';
import {cacheServerLevels,isNetworkFailure,preferOfflineLevelRoom} from '../lib/offline-play';
import {PuzzleBoard,DRAG_SLOP} from './puzzle-board';
import {SocialPanel} from './social-panel';
import {RoomInviteQueue,InviteSeenStore,pickIncomingInvite,type IncomingInvite,type InviteJob} from './friend-invite';
import type {SocialPlayer,SocialSnapshot} from './social-types';
import {TaskShareReward} from './task-share-reward';
import {boardThemeColors,isThemeId,type ThemeId} from './theme';
import {RoomClient,type RoomTicket,type RoomRequestTiming} from '../lib/room-client';
import {flushStoredSoloOutboxes,otherPlayersPresent} from '../lib/solo-play';
import {boardVariant,type StoryVariant} from './story-variants';
import {CursorClient} from '../lib/cursor-client';
import {enrichCursorsFromMembers,type CursorMemberMeta} from '../lib/room-cursors';
import {CheerClient} from './cheer-client';
import {CHEER_EMOTES,type Cheer,type CheerEmote} from '../lib/room-realtime';
import {completionSeats,type CompletionSeat} from './completion-seats';
import {CheerEffects} from './cheer-effects';
import {CompletionTransition} from './completion-transition';
import {CompletionFlow,type CompletionPhase,type CompletionPhaseEvent,type CompletionContext,type CompletionAction} from './completion-flow';
import type {ManagedRoomRealtime} from '../lib/room-realtime';
import type {MobileContributionReceipt} from '../lib/connection-feedback';
import {GALLERY_PHOTOS,RESTORABLE_PHOTOS,CATEGORIES} from '../lib/puzzle-catalog';
import {customPhoto} from '../lib/custom-images';
import {activeRoomPhoto} from './room-photo';
import {ViewRequests} from './view-requests';
import {AudioSettings} from './audio-settings';
import {orientationPreferenceKey,readOrientationPreference,saveOrientationPreference,type ScreenOrientation} from './orientation-choice';
import {MOBILE_PRIVACY_VERSION,MOBILE_PRIVACY_CONSENT_KEY,MOBILE_PRIVACY_CONTACT} from './privacy-policy';
import {placedCount} from '../lib/puzzle-engine';
import collectionCatalog from '../lib/mobile-collection-catalog.json';
import {STREAK_SEEN_KEY,WEEKLY_GIFT_KEY,beijingDay,breathScale,completionFooter,readShownDay,readStreakSeen,streakToast,weeklyGiftAutoShow,weeklyGrantText,type RetentionSummary,type RetentionView,type WeeklyGrant} from './retention';
import type {MobileProfile,MobileTaskView,MobileGiftOpenResult,MobileInviteShareResult,MobileRoomInput,MobileOwnedRoom,MobileLevelsView,MobileLevelClear,MobileChapter,MobileLevel} from '../h5/mobile-api';
import type {MobileCollectionView,CollectionPack,CollectionAlbum} from '../h5/mobile-collection-api';
import type {AssistanceGrant} from '../lib/assistance-policy';
import {REDEEM_GROUP_HINT,REDEEM_WECHAT_HINT,CAT_PAW_WECHAT_TEXT,REDEEM_MAX_LENGTH,redeemAnswered,redeemErrorText,redeemInput,redeemSummary,type RedeemGrant} from './redeem';
import {WELCOME_ENABLED_KEY,WELCOME_STORAGE_KEY,pickWelcomeLine,readWelcomeRecord,welcomeDue,welcomeSlot,welcomeSlotKey,welcomeStart,welcomeTieIn,type WelcomeSlot,type WelcomeTieIn} from './welcome-greeting';

import {type AppHost,type Direction,type PerformanceMode,type Modal,type PrivacyRequest,type RecentPlayer,type RoomListing,type PublicMessage,type SharedPhoto,type WebPage,type ListView,directions,themeOptions,counts,contentMaxWidth,settingsTipKey,phrases,NEWER_PHRASE_ID,photoMap,packed,errorText,taskCoinsText,clamp,seatLimit,VIEW_LOCK_KEY,LOCK_BUTTON_KEY,MINIMAP_KEY,TEAMMATE_SOUND_KEY,ADMIN_DIAG_KEY,WECHAT_PACKAGE_VERSION,CHAT_BUBBLE_ARM_MS,ORGANIZE_CONFIRM_MS,inside,roomListKey,messageListKey} from './panels/shared';
import {drawSavedRoomPanel,drawHistoryGridPanel,drawHistoryPreviewPanel,drawHistoryWindowPanel,drawRedeemPanel,drawWeeklyGiftPanel,drawLoginLogPanel,drawPrivacyChoicePanel,drawPolicyPanel,drawWelcomeHeroPanel,drawWelcomeArtPanel,drawWelcomePanel,drawOrientationPickerPanel} from './panels/modals-panel';
import {drawInviteBannerPanel,drawInviteFriendsPanel,drawFriendsPanel,drawLoadingPanel,drawLobbyStartupPanel,drawLobbyPanel,drawDailyHeroPanel,drawContinueRoomPanel,drawLobbyActionsPanel,drawRoomHeaderPanel,drawChipsPanel,drawRoomGridPanel,drawRoomCardPanel,drawGalleryPanel,drawPhotoCardPanel,drawCreatePanelView,drawPictureButtonPanel} from './panels/lobby-gallery-panel';
import {drawChapterPanel,openLevelComicPanel,turnComicPanel,advanceComicPanel,drawLevelComicPanel,inputComicPanel,beginStoryIntroPanel,storyRoomVariantPanel,drawStoryIntroPanel} from './panels/story-panel';
import {drawTasksPanel,drawTasksPagePanel,drawSuppliesPanel,drawWebSuppliesPanel,drawTaskWindowPanel} from './panels/tasks-supplies-panel';
import {drawCollectionPanel,drawAlbumCardPanel,drawAlbumHeaderPanel,drawAlbumRewardsPanel,drawAlbumImagesPanel,drawAlbumDetailPanel,drawDecorationsPanel,drawPackPreviewPanel} from './panels/collection-panel';
import {drawRoomPanelView,drawDesktopToolsPanel,drawToolColumnPanel,drawLandscapeSurfacePanel,drawLandscapeButtonPanel,drawRoomTopBarPanel,drawLandscapeRoomControlsPanel,drawBoardQuickToolsPanel,drawChatBubblePanel,drawRoomGiftPanel,drawZoomControlPanel,drawPlayerCardPanel,drawRoomSidePanel,drawReconnectBannerPanel,drawRoomGuidePanel,drawNineGridPanel,drawRoomChatEntryPanel,drawRoomToolTogglePanel,drawRoomToolsPanel,drawPublicChatPanel,drawAdminDiagnosticsPanel} from './panels/room-hud-panel';
import {storyCompletionLinesPanel,drawCompletionTransitionPanel,drawSettleButtonPanel,drawCompletionSeatPanel,drawCompletionSeatsPanel,drawCompletionPicturePanel,drawCompletionBarPanel,drawCompletionContentPanel,drawLandscapeCompletionPanel,drawCompletionEffectsPanel} from './panels/completion-panel';

/** Shown under 更多 so testers can tell which package they are running; bump it with every TapTap package. */
const CLIENT_PACKAGE_VERSION='v53.32';
/** Server /api/mobile/gifts/open validates 1..20 gifts per request; larger bulk opens are split into sequential batches. */
const GIFT_OPEN_BATCH_LIMIT=20;

/** One scene graph and one set of game rules for both mobile platforms. */
export class GameApp{
 private get host():AppHost{return this as unknown as AppHost;}
 route:Route='lobby';
 private routeStack:Route[]=[];
 private routeFrames:ListView[]=[];private savedRoutes=new Map<Route,ListView>();private listOwner?:string;private roomReturn:ListView|null=null;private roomReturnStack:Route[]=[];private roomReturnFrames:ListView[]=[];
 private ready=false;private destroyed=false;private busy=false;private sharing=false;private message='';private messageUntil=0;
 private startupPending:Promise<void>|null=null;private startupError='';private startupHooks=false;private startupQuery:Record<string,string>|null=null;
 private soloOutboxesFlushed=false;
 private readonly offline:OfflineMode;
 private get offlineRoom(){return this.offline?.isRoom(this.room?.ticket?.room?.id)??false;}
 private syncOffline(){if(this.ready)void this.offline?.sync(this.client,levels=>{this.levels=levels;this.levelsOwner=this.ownerKey();this.invalidate();},message=>this.note(message));}
 private enterOffline(){this.offline.active=true;this.initTelemetryOnce(this.client.profile);this.route='chapter';this.scroll=0;this.modal=null;this.invalidate();}
 private async launchOffline(input:OfflineInput){await this.attachTicket(this.offline.createRoom(input));}
 private privacyAccepted=false;private privacyDocument:'privacy'|'terms'|null=null;private privacyRefused=false;private privacyEpoch=0;private authorizationTesting=false;private loginDialogActive=false;private authorizationNudged=false;private loginLogOpen=false;private loginLogReturnScroll=0;
 private identityHook=false;private consentPreparing=false;private consentError='';
 private privacyRequests:PrivacyRequest[]=[];private privacyRequestsLoading=false;
 private scroll=0;private extent=0;private bodyTop=100;private bodyBottom=0;private pointer:{x:number;y:number;lastY:number;scroll:boolean;board:boolean;album?:boolean;modal?:boolean;landscapeBackgroundTap?:boolean}|null=null;
 private modal:Modal=null;private modalScroll=0;private modalExtent=0;private modalArea:Rect={x:0,y:0,w:0,h:0};private modalStart=0;
 private orientationChoice:ScreenOrientation|null=null;private orientationSwitching=false;
 // 欢迎回家: armed by a plain login, shown on the first quiet lobby frame after it.
 private welcome:{slot:WelcomeSlot;line:string;tie:WelcomeTieIn|null;openedAt:number;storyChapterId:string|null}|null=null;private welcomePending=false;private welcomeEnabled=true;private welcomeLastVisit:number|null=null;private welcomeFrame:number|null=null;
 private orientationEntryPending:Promise<void>|null=null;private orientationEntryResolve:(()=>void)|null=null;
 private settingsTipSeen=false;private settingsTipDrawn=false;private settingsTipAnchor:Rect|null=null;
 private direction:Direction='all';private filterCount=0;private openOnly=true;private activeOnly=false;private lobbyUnplayedOnly=false;
 private rooms:RoomListing[]=[];private lobbyCursor:string|null=null;private lobbyLoading=false;private lobbyQuiet=false;private lobbySerial=0;private lobbyReload=false;
 private lobbyPieces:'all'|'small'|'large'='all';private dailyPhoto:SharedPhoto|null=null;private serverOffset=0;private listColumn:{x:number;w:number}|null=null;private lobbyMinute='';private lobbyOnline:number|null=null;private dailyFinished:number|null=null;
 private pieces:48|108|300|500=108;private selected:string|null=null;private visibility:'public'|'private'='public';private category='全部';private search='';private source:'free'|'owned'|'all'='free';private unplayedOnly=false;private packId:string|null=null;
 private galleryIds:Set<string>|null=null;private freeGalleryIds:Set<string>|null=null;private completedGalleryIds:Set<string>|null=null;private packedIds=packed;
 private sharedPhotos:SharedPhoto[]|null=null;
 private levels:MobileLevelsView|null=null;private levelsOwner='';private levelsSerial=0;private autoLevelChecked=false;
 private chapterEntryChecked=false;private storyChapterId:string|null=null;
 private comicPage:ComicPageState|null=null;private comicRead?:Set<string>;
 private comicGesture:{id:number;x:number;y:number;lastY:number;lastAt:number;velocity:number;axis?:'x'|'y'}|null=null;
 private comicClosePress:number|null=null;
 private comicDrag=0;private comicSnap?:{started:number;offset:number};private comicHintUntil=0;private comicHintSeen=false;private comicBack?:()=>void;private storyFrame:number|null=null;
 private storyIntro:{text:string;until:number;ms?:number}|null=null;
 /** The 回忆变奏关 of the open story room, or null (normal play). */
 private roomVariant:StoryVariant|null=null;
 private tasks:MobileTaskView|null=null;private taskTab:'tasks'|'gifts'='tasks';private taskDetailsOpen=false;private taskWindowArea:Rect={x:0,y:0,w:0,h:0};
 private collection:MobileCollectionView|null=null;private collectionTab:'albums'|'packs'|'decorations'='albums';private albumId='';private decorationId='';private decorationOwnedOnly=false;private purchase:CollectionPack|null=null;
 private previewPack:CollectionPack|null=null;private previewIndex=-1;private previewGridScroll=0;private previewReadOnly=false;
 private room:(RoomClient&{snapshot:RoomClient['snapshot']&{levelId?:string;requestedPieces?:number;maxPlayers?:number;mobileResult?:{roomId?:string;levelClear?:MobileLevelClear;coins?:number;fragments?:number;energy?:number;doubleClaimed?:boolean;doubleBonus?:{coins:number;fragments:number};ranking?:any;catalog?:any}}})|null=null;private board:PuzzleBoard|null=null;private detachRoom:(()=>void)|null=null;private unsubscribeRoom:(()=>void)|null=null;
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
 private roomArea:Rect={x:0,y:0,w:0,h:0};private landscapeToggle:Rect|null=null;private roomImage='';private imageReady=false;private roomViewPending=false;private imageError='';private toolsOpen=false;private hidden=false;private completedId='';
 private aid:{grants:AssistanceGrant[];freeRemaining?:{hint:number;underlay:number};newcomerProtected?:boolean;serverTime:number}|null=null;
 private messages:PublicMessage[]=[];private chatCursor=0;private chatSeen=0;private chatLoading=false;private chatDraft='';
 private phraseGroup:0|1|2|3=0;
 /** The phrase list from the latest chat response; the server rejects any other text. */
 private serverPhrases:ReadonlySet<string>=new Set();
 private chatHits:Array<{r:Rect;message:PublicMessage}>=[];private chatPress:{x:number;y:number;timer:ReturnType<typeof setTimeout>}|null=null;
 private chatEntryArea:Rect={x:0,y:0,w:0,h:0};private chatWindowArea:Rect={x:0,y:0,w:0,h:0};
 private readonly social:SocialPanel;
 private readonly shareReward:TaskShareReward;
 private readonly audioSettings:AudioSettings;
 private readonly telemetry?:TelemetryBridge;private telemetryLobbyMarked=false;private telemetryFallback:ReturnType<typeof setTimeout>|null=null;
 private timers:Array<ReturnType<typeof setInterval>>=[];private cleanups:Array<()=>void>=[];private attempts=new Map<string,string>();
 private handledQueries=new Set<string>();
 // 七日礼 / 每日拼图连续天数 (server capabilities weeklyGift / dailyStreak).
 private redeemCode='';private redeemError:string|null=null;private redeemGrant:RedeemGrant|null=null;
 private retention:RetentionView|null=null;private retentionLoadedAt=0;private retentionPending:Promise<void>|null=null;private retentionPendingSince=0;private retentionNotes:Set<string>|undefined=new Set();private weeklyGrant:WeeklyGrant|null=null;private breathFrame:number|null=null;
 private historyRooms:MobileOwnedRoom[]|null=null;private historyTab:'drafts'|'finished'='drafts';private historyPreview:MobileOwnedRoom|null=null;private historyLimits={drafts:20,completed:30};private historyLoading=false;private historyError='';private historySerial=0;
 private pendingViews?:ViewRequests;private lastDataOwner='';private lastAidClock='';
 private renderMode:PerformanceMode='smooth';
 private performanceInfoEnabled=false;
 private teammateSoundEnabled=true;
 private adminDiagEnabled=false;private adminDiagExpanded=false;
 private nineTimings=new Map<string,RoomRequestTiming>();
 private roomTimings=new Map<string,RoomRequestTiming&{at:number}>();
 private get nineGridAvailable(){return this.platform.config.id==='taptap'&&this.client.profile?.taptap?.diagnostics===true||this.platform.config.id==='web'&&this.client.config.identityMode==='web-cookie'&&this.client.profile?.diagnostics===true;}
 private get adminDiagnosticsAllowed(){return this.platform.config.development===true||this.nineGridAvailable;}
 private get nineGridRoom(){return (this.room?.snapshot as (RoomTicket['room']&{diagnostic?:boolean})|undefined)?.diagnostic===true;}
 get diagnosticsAvailable(){return this.platform.config.development===true;}
 get performanceInfoVisible(){return this.diagnosticsAvailable&&this.performanceInfoEnabled;}
 set performanceInfoVisible(enabled:boolean){this.performanceInfoEnabled=enabled;}
 onRenderProbe:(()=>void)|null=null;
 get renderProbeAvailable(){return this.route==='room'&&!!this.board;}
 performanceDetails(){const board=this.board?.performanceDetails();return board?[board.gesture+' · '+board.pieces+'片 · 缓存'+(board.cache?'命中':'未使用'),'同步：'+(this.realtime?.connected?'实时连接':'请求同步'),'缓存重画 '+board.builds+' · 分配 '+board.allocations+' 次','缓冲 '+(board.bufferBytes/1048576).toFixed(1)+'MB · 触点 '+board.pointers]:['大厅'];}
 private setTeammateSoundEnabled(enabled:boolean){this.teammateSoundEnabled=enabled;if(this.board)this.board.teammateSoundEnabled=enabled;try{this.platform.storage.set(TEAMMATE_SOUND_KEY,enabled?'1':'0');}catch{}this.invalidate();}
 private setAdminDiagEnabled(enabled:boolean){this.adminDiagEnabled=enabled;if(!enabled)this.adminDiagExpanded=false;try{this.platform.storage.set(ADMIN_DIAG_KEY,enabled?'1':'0');}catch{}this.invalidate();}
 private drawAdminDiagnostics(){return drawAdminDiagnosticsPanel.call(this.host);}
 private roomDiagnosticSnapshot(){
  const room=this.room,snap=room?.snapshot,d=this.realtime?.diagnostics?.() as Record<string,any>|undefined,host=this.platform.onlineBattleDiagnostics?.();
  const wsConnected=d?.connected===true,localSolo=room?.localPlay===true,offline=this.offlineRoom===true;
  const members=snap?.members?.length??0,leases=Object.keys(snap?.leases??{}).length,cursors=this.board?.remoteCursorCount??0,rev=snap?.revision??0;
  const mode=offline?'离线':localSolo?'单人本地':'多人联机';
  const latestTiming=[...(this.roomTimings?.values()??[])].sort((a,b)=>b.at-a.at)[0];
  const rttShort=latestTiming?Math.round(latestTiming.ms)+'ms':'—';
  const hasPreview=d?.preview==='taptap-test',previewOn=d?.previewConnected===true,previewHybrid=previewOn&&d?.previewHybrid===true;
  const wsTag=offline?'离线':localSolo?'本地':wsConnected?'WS✓':'WS断';
  const previewTag=hasPreview?(previewHybrid?'混合✓':previewOn?'平台✓':'平台退'):'原通道';
  const pill=`诊断 · ${wsTag} · ${previewTag} · ${rttShort} · rev${rev} · ${members}人`;
  const fmtTiming=(key:string)=>{const t=this.roomTimings?.get(key);return t?`${Math.round(t.ms)}ms(${t.status})`:'—';};
  const img=this.stage.imageDiagnostics?.(),boardPerf=this.board?.performanceDetails?.();
  const imgText=img?`${img.entries}张/${(img.decodedBytes/1048576).toFixed(1)}MB(载入${img.loading})`:'—';
  const perfText=boardPerf?`缓冲${(boardPerf.bufferBytes/1048576).toFixed(1)}MB · 触点${boardPerf.pointers}`:'—';
  const wsLine=`通道：${wsConnected?'WS在线':'轮询/重连'}(连${d?.connections??0}/重连${d?.reconnects??0}/推${d?.roomMessages??0}/待${d?.pendingActions??0})${d?.lastError?' 错:'+String(d.lastError):''}`;
  const previewLine=hasPreview
   ?`平台：${previewHybrid?'混合接通':previewOn?'已接通':'回退'} · 绑定${d?.previewMembersReady??'—'}/${d?.previewMembersTotal??'—'} · 确认${d?.previewPeersConfirmed??0}/${d?.previewPeersExpected??0} · 发${d?.platformSendRate??0}/峰${d?.platformSendPeak??0}Hz · 成${d?.platformSucceeded??0}/败${d?.platformFailed??0} · 收${d?.platformReceived??0}`
   :`平台：${host?.managerAvailable?'宿主已就绪（当前房未启）':'未启用/非TapTap多人通道'}`;
  const lines=[
   `房间 ${(snap?.id??'—').slice(0,8)} · ${mode} · rev ${rev} · ${members}人 · 租约${leases} · 光标${cursors}`,
   wsLine,
   previewLine,
   `请求RTT：claim ${fmtTiming('claim')} · drop ${fmtTiming('drop')} · poll ${fmtTiming('poll')}${room?.pendingSoloOps?' · 队列'+room.pendingSoloOps:''}`,
   `图片缓存：${imgText} · ${perfText}`,
   `版本：${CLIENT_PACKAGE_VERSION}${this.platform.config.buildVersion?' · '+this.platform.config.buildVersion:''} · ${this.platform.config.id} · ${this.layout}`,
  ];
  const ignored=d?.previewIgnored as Record<string,number>|undefined;
  const peerList=Array.isArray(d?.platformPeerReceives)?d.platformPeerReceives as Array<{name:string;total:number;hz:number}>:[];
  const missingList=Array.isArray(d?.previewMissingBindings)?d.previewMissingBindings as string[]:[];
  const copyLines=[
   `[拼图小窝 管理员房间诊断] ${new Date().toISOString()}`,
   `roomId=${snap?.id??''} mode=${mode} rev=${rev} connected=${room?.connected} members=${members} leases=${leases} cursors=${cursors}`,
   ...lines,
   ...(d?.previewDetail?[`previewDetail=${String(d.previewDetail)}`]:[]),
   ...(hasPreview?[`previewStats=callbacks:${d?.platformCallbacks??0} recovery:${d?.previewRecoveryCount??0}${ignored?` ignored:notReady=${ignored.notReady??0},payload=${ignored.payload??0},sender=${ignored.sender??0},binding=${ignored.binding??0},dup=${ignored.duplicate??0},frame=${ignored.frame??0}`:''}`]:[]),
   ...(peerList.length?[`previewPeers=${peerList.map(p=>`${p.name}:${p.total}(${p.hz}/s)`).join(', ')}`]:[]),
   ...(missingList.length?[`previewMissing=${missingList.join(',')}`]:[]),
   ...(d?.platformLastSendError?[`platformLastSendError=${String(d.platformLastSendError)}`]:[]),
   `apiBase=${this.platform.config.apiBase}`,
  ];
  return {pill,lines,copyText:copyLines.join('\n'),wsConnected:wsConnected||localSolo||offline};
 }
 private async copyRoomDiagnostics(){
  const text=this.roomDiagnosticSnapshot().copyText;
  const copied=await this.platform.copyText?.(text).catch(()=>false);
  if(copied)this.note('已复制房间诊断信息');
  else this.platform.alert(text);
 }
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
  try{this.welcomeEnabled=platform.storage.get(WELCOME_ENABLED_KEY)!=='0';}catch{}
  try{this.lockButtonEnabled=platform.storage.get(LOCK_BUTTON_KEY)==='1';this.viewLocked=this.lockButtonEnabled&&platform.storage.get(VIEW_LOCK_KEY)==='1';}catch{}
  try{this.minimapEnabled=platform.storage.get(MINIMAP_KEY)==='1';}catch{}
  try{this.teammateSoundEnabled=platform.storage.get(TEAMMATE_SOUND_KEY)!=='0';}catch{}
  try{this.adminDiagEnabled=platform.storage.get(ADMIN_DIAG_KEY)==='1';}catch{}
  this.audioSettings=new AudioSettings(platform);
  this.telemetry=platform.createTelemetry?.();
  this.social=new SocialPanel(client,{invalidate:()=>this.invalidate(),note:message=>this.note(message),joinRoom:(id,invite)=>this.enterRoom(id,invite),room:()=>this.socialRoom(),snapshot:state=>this.socialSnapshot(state)});
  this.inviteSeen=new InviteSeenStore(platform.storage);
  this.inviteQueue=new RoomInviteQueue({send:job=>this.sendRoomInvite(job),randomId:()=>this.platform.randomId(),changed:()=>this.invalidate(),sent:job=>this.roomInviteSent(job),failed:error=>{if((error as {code?:string})?.code!=='ROOM_LEFT')this.note(errorText(error));}});
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
 /** Manual switches exist on TapTap phones only; TapTap PC keeps the upload window (players resize or maximize it). */
 private get canRotate(){return this.platform.config.id==='taptap'&&!!this.platform.setOrientation&&this.platform.tapPcHost?.()!==true;}
 private offerFirstOrientation():Promise<void>{
  if(this.orientationEntryPending)return this.orientationEntryPending;
  if(this.platform.config.id!=='taptap'||!this.platform.setOrientation||this.platform.orientationChoiceAvailable?.()!==true)return Promise.resolve();
  // Read once outside the tolerant preference parser: unavailable storage must skip the offer.
  try{const saved=this.platform.storage.get(orientationPreferenceKey);if(readOrientationPreference({get:()=>saved})!==null)return Promise.resolve();}catch{return Promise.resolve();}
  this.orientationEntryPending=new Promise(resolve=>{this.orientationEntryResolve=resolve;});
  const pending=this.orientationEntryPending,open=()=>{if(this.orientationEntryPending!==pending||this.destroyed)return;this.orientationChoice=this.actualOrientation;this.showModal('orientation');};
  // A first launch on a phone first asks for portrait (uploads are landscape); the picker then preselects wherever the screen ended up.
  const startup=this.platform.startupOrientation;if(startup)void startup.catch(()=>{}).then(open);else open();
  return pending;
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
 private async toggleOrientation(){if(!this.canRotate)return;await this.run(async()=>{if(!this.platform.setOrientation)throw Error('当前客户端不支持切换方向');const target=this.stage.w>this.stage.h?'portrait':'landscape';await this.platform.setOrientation(target);saveOrientationPreference(this.platform.storage,target);this.showModal(null);this.toolsOpen=false;this.invalidate();});}
 private async toggleFullscreen(){await this.run(async()=>{if(this.platform.config.id!=='web'||!this.platform.fullscreen?.available())return;try{await this.platform.fullscreen.toggle();this.showModal(null);this.invalidate();}catch{this.note('浏览器暂时无法切换全屏，请检查全屏权限后重试');}});}
 private toggleEffectsMute(){const key='jigsaw:shared:audio:last-effects',volume=this.audioSettings.levels.effects;if(volume>0){try{this.platform.storage.set(key,String(volume));}catch{}this.audioSettings.set('effects',0);}else{let previous=1;try{const saved=Number(this.platform.storage.get(key));if(Number.isFinite(saved)&&saved>0)previous=Math.min(1,saved);}catch{}this.audioSettings.set('effects',previous);}this.invalidate();}
 private get formalWeb(){return this.client.cookieIdentity;}
 private get needsPrivacyChoice(){return (this.platform.config.id==='taptap'||this.platform.config?.id==='wechat')&&!this.privacyAccepted;}
 private get usesCreationTickets(){return this.client.config.capabilities.createTickets??(this.platform.config.id!=='web'&&!this.formalWeb);}
 // Level still needed to open a table of this size (0 = open). The server sends the rule; 500 pieces need level 10 on TapTap.
 private pieceLevel(n:number){const p=this.client.profile,need=(p as {pieceLevels?:Record<string,number>}|null)?.pieceLevels?.[n]??(!this.formalWeb&&n>=500?10:0);return (p?.level??0)<need?need:0;}
 private get pieceCounts(){return this.formalWeb?counts.filter(count=>(this.client.config.capabilities.supportedPieces??[108,300,500]).includes(count)):counts;}
 private webLink(key:WebPage){return this.platform.config.webLinks?.[key]??this.client.config.compatUrls?.[key]??({account:'/account',security:'/account/security',membership:'/membership',uploads:'/upload',terms:'/terms',privacy:'/privacy',feedback:'/feedback'}[key]);}
 private openWeb(key:WebPage){this.platform.openUrl?.(this.webLink(key));}
 private drawWebLinks(x:number,y:number,w:number){const s=this.stage,items:[WebPage,string][]=[['terms','用户协议'],['privacy','隐私政策'],['feedback','反馈']];items.forEach(([key,label],index)=>{const cw=w/items.length,cx=x+index*cw;s.text(label,cx+(cw-s.measure(label,10))/2,y,10,this.colors.muted);s.hit({x:cx,y:y-4,w:cw,h:22},()=>this.openWeb(key));});}
 private frameViewport:Viewport|null=null;
 private currentViewport():Viewport{return this.frameViewport??this.platform.viewport();}
 private get finePointer(){try{return typeof matchMedia==='function'&&matchMedia('(pointer:fine)').matches;}catch{return false;}}
 private layoutFor(width:number,height:number):'desktop'|'phoneLandscape'|'phonePortrait'{const id=this.platform.config.id;if(width>=1000&&height>=600&&(id==='web'||id==='taptap'&&this.finePointer))return 'desktop';return width>height&&height<500?'phoneLandscape':'phonePortrait';}
 /** The single layout decision, from the scaled logical viewport; every screen reads it. */
 private get layout(){const v=this.currentViewport();return this.layoutFor(v.width,v.height);}
 private get desktop(){return this.layout==='desktop';}
 private get floatingTasks(){const v=this.currentViewport();return v.width>v.height&&v.width>=540;}
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
  const s=this.stage,v=this.currentViewport(),y=s.h-v.bottom-64,tw=s.w/this.navItems.length;if(this.modalBlocksInput)return;
  s.ctx.fillStyle=this.colors.cream;s.ctx.fillRect(0,y,s.w,s.h-y);s.ctx.fillStyle=this.colors.line;s.ctx.fillRect(0,y,s.w,2);
  this.navItems.forEach(([route,label,icon],index)=>{const x=index*tw,selected=this.route===route;
   if(selected){s.ctx.fillStyle=s.color('#a85567');s.ctx.fillRect(Math.round(x+tw*.22),y,Math.round(tw*.56),3);}
   s.ctx.save();s.ctx.globalAlpha=selected?1:.7;s.icon(icon,{x:x+(tw-26)/2,y:y+9,w:26,h:26});s.ctx.restore();
   s.text(label,x+(tw-s.measure(label,11,700))/2,y+39,11,selected?this.colors.ink:this.colors.muted,700);this.navBadge(route,x+tw/2+15,y+11);
   s.hit({x,y,w:tw,h:s.h-y},()=>this.openTab(route));});
 }
 private drawNavRail(){
  const s=this.stage,v=this.currentViewport(),w=64,top=v.top+6,itemH=Math.min(56,(s.h-top-v.bottom-6)/6);
  s.ctx.fillStyle=this.colors.cream;s.ctx.fillRect(0,0,w,s.h);s.ctx.fillStyle=this.colors.line;s.ctx.fillRect(w-2,0,2,s.h);
  const item=(r:Rect,label:string,icon:string,selected:boolean,action:()=>void,route?:Route)=>{if(selected)s.frame(r,'button-cream-selected');const iy=r.y+(r.h-37)/2;s.icon(icon,{x:r.x+(r.w-24)/2,y:iy,w:24,h:24});s.text(label,r.x+(r.w-s.measure(label,10,700))/2,iy+26,10,selected?this.colors.ink:this.colors.muted,700);if(route)this.navBadge(route,r.x+r.w/2+14,iy+3);s.hit(r,action);};
  this.navItems.forEach(([route,label,icon],index)=>item({x:5,y:top+index*itemH,w:w-12,h:itemH-4},label,icon,this.route===route,()=>this.openTab(route),route));
  item({x:5,y:s.h-v.bottom-itemH-2,w:w-12,h:itemH-4},'设置','tools',false,()=>this.showModal('settings'));
 }
 private get modalBlocksInput(){return this.modal!==null&&this.modal!=='tasks'&&this.modal!=='chat'||this.route==='room'&&this.roomGuideStep>0;}
 private get boardInputBlocked(){return this.modalBlocksInput||!!this.completionFx;}
 private modalContains(x:number,y:number){return this.modalBlocksInput||(this.modal==='tasks'&&inside(this.taskWindowArea,x,y))||(this.modal==='chat'&&inside(this.chatWindowArea,x,y));}
 private get energyEnabled(){return !this.offlineRoom&&!(this.offline?.active&&!this.ready)&&!this.formalWeb&&this.client.config.capabilities?.energy!==false;}
 /** WeChat builds name no outside group or platform (review copy). */
 private get redeemHint(){return this.platform.config?.id==='wechat'?REDEEM_WECHAT_HINT:REDEEM_GROUP_HINT;}
 private decorationText(item:{id:string;description?:string}){return this.platform.config?.id==='wechat'&&item.id==='cat-paw'?CAT_PAW_WECHAT_TEXT:item.description??'';}
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
 /** WeChat review (诱导分享): no task there asks for sharing or inviting, so those reward tasks are never listed. */
 private get inviteRewardsHidden(){return this.platform.config?.id==='wechat';}
 private platformTasks(value:MobileTaskView):MobileTaskView{return this.inviteRewardsHidden&&value?{...value,tasks:value.tasks.filter(task=>task.group!=='sharing'&&task.group!=='invitation')}:value;}
 private applyTasks(value:MobileTaskView){this.pendingViews?.invalidate();this.tasks=this.platformTasks(value);this.invalidate();}
 private applyCollection(value:MobileCollectionView){this.pendingViews?.invalidate();this.collection=value;this.invalidate();}
 private tickVisibleTime(){
  if(this.hidden||this.destroyed)return;
  if(this.completionFx)this.animateCompletion();
  if(this.modal==='completion'&&this.cheerEffects.alive())this.animateCheers();
  const now=Date.now();let changed=false;
  if(this.messageUntil&&now>this.messageUntil){this.message='';this.messageUntil=0;changed=true;}
  const clock=this.route==='room'?(['hint','underlay'] as const).map(kind=>{const grant=this.activeAid(kind);return grant?kind==='hint'&&grant.lasting?'已开启':Math.max(0,Math.ceil((grant.expiresAt-now)/1000)):0;}).join(':'):'';
  if(clock!==this.lastAidClock){this.lastAidClock=clock;changed=true;}
  if(this.route==='room'&&this.room&&!this.room.connected)changed=true;
  if(this.chatBubble&&now>this.chatBubble.until){this.chatBubble=null;changed=true;}
  if(this.inviteBanner&&now>this.inviteBanner.until){this.inviteBanner=null;changed=true;}
  else if(this.chatBubble&&this.chatBubble.until-now<=1000&&this.route==='room'&&this.platform.config.id!=='web'&&this.layout==='phoneLandscape')changed=true;
  if(this.route==='lobby'){const minute=String(Math.floor(this.dailyNow()/60000));if(minute!==this.lobbyMinute){this.lobbyMinute=minute;changed=true;}}
  // 七日礼 first; 欢迎回家 waits for it (weeklyGiftHolds).
  this.maybeWeeklyGift();this.checkStreakToast();
  if(this.welcomePending)this.maybeWelcome();
  if(this.modal==='welcome'&&this.welcome?.slot.tone==='night')changed=true;
  if(this.route==='room'&&this.adminDiagnosticsAllowed&&this.adminDiagEnabled)changed=true;
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
 private clearTelemetryFallback(){if(this.telemetryFallback!==null){clearTimeout(this.telemetryFallback);this.telemetryFallback=null;}}
 private initTelemetryOnce(profile:MobileProfile|null|undefined=this.client.profile){
  if(!this.telemetry||this.destroyed||this.needsPrivacyChoice)return;
  this.telemetry.init(profile);this.prepareRewardedAd();
  if(profile){if(!this.telemetryLobbyMarked){this.telemetryLobbyMarked=true;this.telemetry.milestone('new_user','进入大厅');}if(profile.level>=5)this.telemetry.milestone('global','达到5级');}
 }
 private checkLevelMilestone(){if((this.client.profile?.level??0)>=5)this.telemetry?.milestone('global','达到5级');}
 private storyLevelNumber(levelId:string|null|undefined):number|undefined{
  if(!levelId)return undefined;
  const chapters=this.storyView?.chapters??this.levels?.chapters??this.offline?.catalog?.chapters;
  if(!chapters)return undefined;
  const ordered=chapters.flatMap(chapter=>chapter.levels.map(level=>level.id));
  const index=ordered.indexOf(levelId);
  return index>=0?index+1:undefined;
 }
 private roomTelemetryMode(room:RoomClient,offline:boolean):string{
  const levelId=room.snapshot.levelId;
  if(offline)return levelId?'离线闯关':'离线自由拼图';
  if(levelId)return '剧情闯关';
  if(this.dailyPhoto?.id&&room.snapshot.puzzle.imageId===this.dailyPhoto.id)return '每日拼图';
  if(room.snapshot.visibility==='private'||room.snapshot.visibility==='solo')return '私人房';
  return '多人公开房';
 }
 async start(){
  if(this.destroyed)return;
  if(!this.identityHook&&this.platform.onIdentityChange){this.identityHook=true;this.cleanups.push(this.platform.onIdentityChange(()=>{if(this.destroyed)return;this.stage.input({type:'cancel',points:[],changed:[]});this.pointer=null;this.invalidate();}));}
  if(this.needsPrivacyChoice){this.prepareConsentButton();this.invalidate();return;}
  if(this.destroyed)return;if(this.startupPending)return this.startupPending;if(this.startupHooks&&this.ready)return;
  if(!this.startupHooks){
   this.startupHooks=true;
   this.client.onChange=()=>{if(this.destroyed)return;const owner=this.ownerKey();this.ensureListOwner();if(owner!==this.lastDataOwner){this.lastDataOwner=owner;this.pendingViews?.invalidate();this.historyRooms=null;this.historySerial++;this.historyLoading=false;this.historyError='';this.tasks=null;this.collection=null;this.galleryIds=null;this.freeGalleryIds=null;this.completedGalleryIds=null;this.sharedPhotos=null;this.selected=null;}if(this.formalWeb&&this.client.authRequired){this.ready=false;this.stage.input?.({type:'cancel',points:[],changed:[]});this.pointer=null;this.modal=null;this.leaveRoom();this.route='lobby';}else if(this.formalWeb&&this.room&&!this.client.ticket){this.modal=null;this.leaveRoom();this.navigate('lobby');this.note('账号已切换，请重新进入房间');}this.invalidate();};
   this.cleanups.push(this.platform.onHide(()=>{this.hidden=true;this.room?.flushSoloNow();this.room?.setHidden?.(true);this.realtime?.setHidden(true);this.pointer=null;this.cancelChatPress();}),this.platform.onShow(query=>{this.hidden=false;this.room?.setHidden?.(false);this.realtime?.setHidden(false);if(!this.ready){if(Object.keys(query).length)this.startupQuery=query;void this.start();}else if(this.orientationEntryPending){if(Object.keys(query).length)this.startupQuery=query;}else{void this.client.refresh().catch(error=>{if(!this.destroyed)this.note(errorText(error));});this.syncOffline();if(!this.offlineRoom){void this.social.refresh();void this.handleQuery(query);}}this.invalidate();}));
  }
  this.startupError='';this.invalidate();
  const epoch=this.privacyEpoch;
  this.clearTelemetryFallback();
  this.telemetryFallback=setTimeout(()=>{this.telemetryFallback=null;if(!this.destroyed&&!this.needsPrivacyChoice&&epoch===this.privacyEpoch)this.initTelemetryOnce(this.client.profile);},2500);
  this.startupPending=(async()=>{
  try{await this.client.start();this.clearTelemetryFallback();if(this.destroyed||this.needsPrivacyChoice||epoch!==this.privacyEpoch)return;this.initTelemetryOnce(this.client.profile);if(this.client.profile&&!this.soloOutboxesFlushed){this.soloOutboxesFlushed=true;void flushStoredSoloOutboxes({storage:this.platform.storage,fetch:this.offline.onlineFetch(this.client.fetchLike),now:()=>Date.now(),randomId:()=>this.platform.randomId(),skipRoomId:this.room?.ticket.room.id}).catch(()=>{});}this.ready=true;this.loginDialogActive=false;this.offline.active=false;this.message='';if(this.client.tapNotice)this.note(this.client.tapNotice);this.invalidate();const query=this.startupQuery??this.platform.initialQuery;this.startupQuery=null;await this.loadInitialContent(query,epoch);this.syncOffline();}
  catch(error){this.clearTelemetryFallback();if(!this.destroyed){if(!this.needsPrivacyChoice&&epoch===this.privacyEpoch)this.initTelemetryOnce(this.client.profile);this.startupError=errorText(error);this.invalidate();}}
  if(this.destroyed||this.needsPrivacyChoice||epoch!==this.privacyEpoch||this.timers.length)return;
  this.timers.push(setInterval(()=>{if(this.destroyed||this.hidden||!this.ready||this.offlineRoom)return;if(this.route==='lobby'&&!this.busy)void this.loadLobby(false,true);if((this.route==='tasks'||this.modal==='tasks')&&!this.busy)void this.loadTasks();if(this.route==='gallery'&&!this.busy)void this.loadGallery();if(this.route==='collection'&&!this.busy)void this.loadCollection();if(this.modal!=='social')void this.social.refresh();if(this.route==='room'&&this.modal!=='chat')void this.loadChat();},9000));
  this.timers.push(setInterval(()=>{if(this.destroyed||this.hidden||!this.ready||this.offlineRoom)return;if(this.modal==='social'||this.modal==='invite'||this.route==='friends'&&!this.modal)void this.social.refresh();else if(this.modal==='chat'||this.route==='room'&&this.layout==='desktop')void this.loadChat();},3000));
  this.timers.push(setInterval(()=>this.tickVisibleTime(),1000));
  this.invalidate();
  })().finally(()=>{this.clearTelemetryFallback();if(epoch===this.privacyEpoch){this.startupPending=null;this.loginDialogActive=false;if(!this.destroyed)this.invalidate();}});
  return this.startupPending;
 }
 destroy(){this.destroyed=true;this.clearTelemetryFallback();this.releaseComicBack();this.stopStoryFrame();this.finishOrientationOffer();this.platform.cancelShare?.();this.platform.cancelIdentity?.();this.pendingViews?.invalidate();this.cancelChatPress();this.social.destroy();this.leaveRoom();this.telemetry?.close();this.client.onChange=undefined;for(const timer of this.timers)clearInterval(timer);for(const cleanup of this.cleanups)cleanup();}
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
  if(!this.destroyed&&!this.needsPrivacyChoice&&epoch===this.privacyEpoch)void this.loadRetention(true);
  if(!direct&&!this.destroyed&&!this.needsPrivacyChoice&&epoch===this.privacyEpoch)this.armWelcome();
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
 private defaultListView(route:Route):ListView{return {route,scroll:0,albumListScroll:0,direction:'all',filterCount:0,openOnly:true,activeOnly:false,lobbyUnplayedOnly:false,category:'全部',search:'',source:'free',unplayedOnly:false,packId:null,selected:null,collectionTab:'albums',albumId:'',decorationId:'',decorationOwnedOnly:false,taskTab:'tasks'};}
 private ensureListOwner(){
  const owner=this.ownerKey();this.savedRoutes??=new Map();this.routeFrames??=[];this.routeStack??=[];
  if(this.listOwner===undefined){this.listOwner=owner;return;}
  if(owner===this.listOwner)return;this.listOwner=owner;this.savedRoutes.clear();this.routeFrames=[];this.routeStack=[];this.roomReturn=null;this.roomReturnStack=[];this.roomReturnFrames=[];this.filterView=null;this.levels=null;this.levelsSerial=(this.levelsSerial??0)+1;this.autoLevelChecked=false;this.chapterEntryChecked=false;this.storyChapterId=null;
  this.restoreListView(this.defaultListView(this.route));this.taskTab='tasks';this.lobbySerial=(this.lobbySerial??0)+1;this.rooms=[];this.lobbyCursor=null;if(this.ready)void this.loadLevels().then(()=>this.checkLevelEntry());
 }
 private captureListView():ListView{const base=this.defaultListView(this.route);for(const key of Object.keys(base) as Array<keyof ListView>){const value=this[key as keyof this];if(value!==undefined)(base as any)[key]=value;}return base;}
 private listViewKey(view=this.captureListView()){switch(view.route){case'lobby':return JSON.stringify(['lobby',view.direction,view.filterCount,view.openOnly,view.activeOnly,view.lobbyUnplayedOnly]);case'gallery':return JSON.stringify(['gallery',view.direction,view.category,view.search,view.source,view.unplayedOnly,view.packId]);case'collection':return JSON.stringify(['collection',view.collectionTab,view.collectionTab==='albums'?view.albumId:view.collectionTab==='decorations'?view.decorationOwnedOnly:'']);case'tasks':return 'tasks:'+view.taskTab;default:return view.route;}}
 private saveListView(){this.ensureListOwner();const view=this.captureListView();if(view.route!=='room')this.savedRoutes.set(view.route,view);return view;}
 private restoreListView(view:ListView){
  this.route=view.route;this.scroll=view.scroll;this.extent=0;
  if(view.route==='lobby')Object.assign(this,{direction:view.direction,filterCount:view.filterCount,openOnly:view.openOnly,activeOnly:view.activeOnly,lobbyUnplayedOnly:view.lobbyUnplayedOnly});
  if(view.route==='gallery')Object.assign(this,{direction:view.direction,category:view.category,search:view.search,source:view.source,unplayedOnly:view.unplayedOnly,packId:view.packId,selected:view.selected});
  if(view.route==='collection')Object.assign(this,{collectionTab:view.collectionTab,albumId:view.albumId,albumListScroll:view.albumListScroll,decorationId:view.decorationId,decorationOwnedOnly:view.decorationOwnedOnly});
  if(view.route==='tasks')this.taskTab=view.taskTab;
 }
 private refreshRoute(){if(this.offline?.active&&!this.ready||this.offlineRoom)return;if(this.route==='chapter')void this.loadLevels();if(this.route==='lobby'){void this.loadLevels();void this.loadLobby(false,!!this.rooms.length);if(!this.completedGalleryIds)void this.loadGallery();if(!this.historyLoading)void this.loadRoomHistory();}if(this.route==='gallery'){void this.loadGallery();void this.loadCollection();}if(this.route==='tasks')void this.loadTasks();if(this.route==='collection')void this.loadCollection();if(this.route==='friends')void this.social.refresh();}
 private finishNavigation(){if(this.modal==='completion')this.showModal(null);else this.modal=null;this.filterView=null;this.toolsOpen=false;this.message='';if(this.route==='friends')void this.loadRecentPlayers();if(this.route==='lobby'||this.route==='chapter')void this.loadRetention();this.invalidate();this.refreshRoute();}
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
 private openPackGallery(id:string){this.navigate('gallery',{packId:id,source:this.collection?.packs.find(pack=>pack.id===id)?.unlock==='ad'?'all':'owned',unplayedOnly:false});}
 private selectAlbum(id:string){this.changeListView(()=>{this.albumId=id;});}
 private exitRoom(){if(this.offlineRoom&&!this.ready){this.leaveRoom();this.roomReturn=null;this.roomReturnStack=[];this.roomReturnFrames=[];this.routeStack=[];this.routeFrames=[];this.enterOffline();return;}this.ensureListOwner();const level=this.offlineRoom?undefined:this.room?.snapshot.levelId,clear=this.room?.snapshot.mobileResult?.levelClear,complete=clear&&(clear.chapterComplete||clear.nextLevelId===null),nextLevelId=complete?clear?.nextLevelId:null,nextChapter=this.chapterForLevel(nextLevelId),target=this.roomReturn;if(nextLevelId)this.storyChapterId=nextChapter?.id??null;this.leaveRoom();this.roomReturn=null;this.routeStack=target?this.roomReturnStack:[];this.routeFrames=target?this.roomReturnFrames:[];this.roomReturnStack=[];this.roomReturnFrames=[];if(level){// Back to the story page while the played chapter still has unfinished levels, in any chapter.
const played=this.chapterForLevel(level),resume=!complete&&(played?played.levels.some(item=>item.status!=='cleared'):!!this.beginnerChapter);if(resume&&played)this.storyChapterId=played.id;this.navigate(nextLevelId||resume?'chapter':'lobby');}else if(target){this.restoreListView(target);this.finishNavigation();}else this.navigate('lobby');}
 private closeModal(){if(this.modal==='orientation'){this.confirmOrientation();return;}if(this.modal==='welcome'){this.closeWelcome();return;}if(this.modal==='levelComic'){const back=this.comicPage?.returnTo;this.showModal(back&&this.room?'completion':null);return;}if(this.modal==='completion'&&(this.offlineRoom||this.room?.snapshot.levelId))this.exitRoom();else this.showModal(null);}
 private filterView:ListView|null=null;
 private finishFilters(){const changed=this.filterView&&this.listViewKey(this.filterView)!==this.listViewKey();if(changed){this.scroll=0;if(this.route==='lobby'){const serverChanged=this.filterView!.direction!==this.direction||this.filterView!.filterCount!==this.filterCount||this.filterView!.openOnly!==this.openOnly||this.filterView!.activeOnly!==this.activeOnly;if(serverChanged){this.lobbySerial++;this.rooms=[];this.lobbyCursor=null;void this.loadLobby();}}}this.filterView=null;}
 /** Phones: a drag that starts on a control floating over the table (任务, chat bubble, tools button, landscape top bar)
  * hands the finger to the table once it travels DRAG_SLOP: the press is cancelled and the board gets the landing point,
  * so a piece under the control can still be picked up. Not inside modals, the portrait tools popup or the open landscape tools column. */
 private dragThrough(p:{x:number;y:number;board:boolean;scroll:boolean;modal?:boolean},point:{id:number;x:number;y:number},input:Input){
  const layout=this.layout;
  if(p.board||p.scroll||p.modal||this.platform.config.id==='web'||layout==='desktop'||this.route!=='room'||this.modal||!this.board||this.boardInputBlocked)return false;
  if(input.points.length!==1||!inside(this.roomArea,p.x,p.y)||Math.hypot(point.x-p.x,point.y-p.y)<DRAG_SLOP)return false;
  if(layout==='phonePortrait'&&this.toolsOpen||layout==='phoneLandscape'&&this.landscapeToolsOpen&&inside(this.roomToolsArea,p.x,p.y))return false;
  this.stage.input({type:'cancel',points:[],changed:input.changed});p.board=true;
  const origin={id:point.id,x:p.x,y:p.y};this.board.input({type:'down',points:[origin],changed:[origin]});return true;
 }
 private clearRoomPointer(){this.cursor?.point(null);this.board?.input({type:'cancel',points:[],changed:[]});this.pointer=null;this.cursorVisible=false;}
 private showModal(modal:Modal){if(this.orientationEntryPending&&modal!=='orientation')return;if(modal==='completion'&&this.modal!=='completion'){void this.loadRetention(true);if(!this.collection&&!this.offlineRoom&&this.room?.snapshot.levelId)void this.loadCollection();}if(modal!=='weeklyGift')this.weeklyGrant=null;if((this.offlineRoom||this.offline?.active&&!this.ready)&&modal&&!['orientation','completion','levelComic','tools','packPreview'].includes(modal)){this.note(OFFLINE_REQUIRED);return;}const previous=this.modal;if(modal!=='levelComic'){this.releaseComicBack();this.comicClosePress=null;this.comicGesture=null;this.comicPage=null;this.comicDrag=0;this.comicSnap=undefined;this.comicHintUntil=0;this.stopStoryFrame();}if(this.modal==='playerCard'&&modal!=='playerCard'){this.cardCode='';this.cardCache.clear();}this.cancelChatPress();this.stage.input({type:'cancel',points:[],changed:[]});if(modal)this.clearRoomPointer();if(this.modal==='social'&&modal!=='social')this.social.close();if(this.modal==='filters'&&modal!=='filters')this.finishFilters();if(modal==='filters'&&this.modal!=='filters')this.filterView=this.saveListView();if(this.modal==='packPreview'&&modal!=='packPreview')this.previewReadOnly=false;this.modal=modal;if(modal==='levelComic'&&previous!=='levelComic')this.comicBack=this.platform.onBack?.(()=>{if(this.modal!=='levelComic')return false;this.closeModal();return true;});this.cheer?.setActive(modal==='completion'||!!this.completionFx);if(modal!=='completion')this.stopCheers();this.modalScroll=modal==='chat'?Number.MAX_SAFE_INTEGER:0;this.modalExtent=0;if(modal==='social')this.social.open();if(modal==='invite'){void this.social.refresh();void this.loadRecentPlayers();}if(modal==='chat'){this.chatSeen=this.chatCursor;void this.loadChat();}if(modal==='privacyRequests')void this.loadPrivacyRequests();if(modal==='history'){if(previous!=='history'&&previous!=='manage')this.historyTab='drafts';this.historyPreview=null;void this.loadRoomHistory();}if(modal==='manage')void this.client.refresh().catch(error=>this.note(errorText(error)));this.invalidate();if(modal==='invite'||modal==='tasks')void this.loadTasks();if(modal==='completion')this.setCompletionPhase('popup');else if(previous==='completion')this.setCompletionPhase('closed');}
 private get ownRoomLimit(){return this.formalWeb?3:5;}
 private get ownedRoomCount(){return (this.client.profile?.ownedRooms??[]).filter(room=>!room.completed).length;}
 private async loadRoomHistory(){
  if(this.offlineRoom||this.offline?.active&&!this.ready)return;
  const owner=this.ownerKey(),serial=++this.historySerial;this.historyLoading=true;this.historyError='';this.invalidate();
  try{const data=await this.client.json<{rooms:MobileOwnedRoom[];limits?:{drafts:number;completed:number}}>('/api/room-history');if(owner!==this.ownerKey()||serial!==this.historySerial||this.destroyed)return;this.historyRooms=data.rooms;if(data.limits)this.historyLimits=data.limits;if(this.historyPreview)this.historyPreview=data.rooms.find(room=>room.id===this.historyPreview?.id&&room.completed)??null;}
  catch(error){if(owner===this.ownerKey()&&serial===this.historySerial&&!this.destroyed)this.historyError=errorText(error);}
  finally{if(owner===this.ownerKey()&&serial===this.historySerial&&!this.destroyed){this.historyLoading=false;this.invalidate();}}
 }
 private async removeOwnRoom(id:string){await this.run(async()=>{await this.client.post('/api/my-rooms',{action:'remove',roomId:id});await this.client.refresh();this.note('已从自创列表删除，历史记录和拼图进度保留');});}
 private drawSavedRoom(room:MobileOwnedRoom,left:number,cy:number,width:number,own:boolean){return drawSavedRoomPanel.call(this.host,room,left,cy,width,own);}
 private get historyDrafts(){return (this.historyRooms??[]).filter(room=>!room.completed);}
 private get historyFinished(){return (this.historyRooms??[]).filter(room=>room.completed).sort((a,b)=>(b.completedAt??0)-(a.completedAt??0));}
 private setHistoryTab(tab:'drafts'|'finished'){this.historyTab=tab;this.historyPreview=null;this.modalScroll=0;this.invalidate();}
 private drawHistoryGrid(rooms:MobileOwnedRoom[],left:number,top:number,width:number){return drawHistoryGridPanel.call(this.host,rooms,left,top,width);}
 private drawHistoryPreview(room:MobileOwnedRoom,left:number,top:number,width:number){return drawHistoryPreviewPanel.call(this.host,room,left,top,width);}
 private drawHistoryWindow(){return drawHistoryWindowPanel.call(this.host);}
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
 /** Where a finished story level leads: the server receipt, else the chapter order (offline rooms, or a
  * room whose receipt is missing, e.g. after the account changed during play). */
 private levelDestination():MobileLevelClear|null{
  const snap=this.room?.snapshot;if(!snap?.completedAt)return null;const clear=snap.mobileResult?.levelClear;if(clear)return clear;
  const levelId=snap.levelId;if(!levelId)return null;
  const chapters=this.offlineRoom?this.offline.view?.chapters??[]:this.availableChapters,ordered=chapters.flatMap(chapter=>chapter.levels.map(level=>level.id)),index=ordered.indexOf(levelId);if(index<0)return null;
  return {levelId,energy:0,firstClear:false,nextLevelId:ordered[index+1]??null,chapterComplete:chapters.some(chapter=>chapter.levels.at(-1)?.id===levelId)};
 }
 private levelNextLabel(clear:MobileLevelClear){return clear.chapterComplete||clear.nextLevelId===null?clear.nextLevelId?'下一章':'去大厅':'下一关';}
 private continueLevel(clear:MobileLevelClear){
  const next=clear.nextLevelId,offline=this.offlineRoom;this.leaveRoom();
  if(!next){this.navigate('lobby');return;}
  // An offline room continues offline, like its own completion card.
  if(offline)void this.run(()=>this.launchOffline({kind:'level',levelId:next}));else void this.launch({mode:'level',levelId:next});
 }
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
 /** Old backends lack the routes: nothing is requested or shown without the capability. */
 private retentionCapable(kind:'weeklyGift'|'dailyStreak'){
  const caps=this.client.config.capabilities as {weeklyGift?:boolean;dailyStreak?:boolean},profile=(this.client.profile as {capabilities?:{weeklyGift?:boolean;dailyStreak?:boolean}}|null)?.capabilities;
  return this.platform.config.id!=='web'&&(caps?.[kind]===true||profile?.[kind]===true);
 }
 private loadRetention(force=false):Promise<void>{
  if(this.destroyed||!this.client.profile)return Promise.resolve();
  if(!this.retentionCapable('weeklyGift')&&!this.retentionCapable('dailyStreak')){this.retentionNote('七日礼 · 服务器未开放');return Promise.resolve();}
  if(this.offlineRoom||this.offline?.active&&!this.ready)return Promise.resolve();
  if(this.retentionPending)return this.retentionPending;
  // A failed fetch retries after 15 s instead of waiting for the next page change.
  if(!force&&Date.now()-this.retentionLoadedAt<(this.retention?60000:15000))return Promise.resolve();
  this.retentionPendingSince=Date.now();
  // Failures stay silent on screen (no gift or streak); the 登录日志 keeps the reason.
  this.retentionPending=this.client.json<RetentionView>('/api/mobile/retention').then(data=>{
   if(data?.weeklyGift&&data?.dailyStreak){this.retention={weeklyGift:data.weeklyGift,dailyStreak:data.dailyStreak};const gift=data.weeklyGift;this.retentionNote('七日礼 · 已领'+gift.claimed+'天 · '+(gift.done?'全部领完':gift.available?'今天可领':'今天已领')+' · 连续'+data.dailyStreak.count+'天');}
   else this.retentionNote('七日礼 · 返回内容不完整');
   this.invalidate();}).catch(error=>{this.retentionNote('七日礼 · 读取失败 '+String((error as Error)?.message??error).slice(0,60));}).finally(()=>{this.retentionLoadedAt=Date.now();this.retentionPending=null;this.maybeWeeklyGift();});
  return this.retentionPending;
 }
 /** One 登录日志 line per distinct retention/greeting decision, so a device test can be read back. */
 private retentionNote(text:string){const notes=this.retentionNotes??=new Set();if(notes.has(text))return;notes.add(text);this.platform?.loginLog?.add(text);}
 /** Streak numbers between fetches come with every profile (room actions included). */
 private get dailyStreak(){
  if(!this.retentionCapable('dailyStreak'))return null;
  const view=this.retention?.dailyStreak,live=(this.client.profile as {retention?:RetentionSummary}|null)?.retention?.dailyStreak;
  if(!view&&!live)return null;const count=live?.count??view!.count,todayDone=live?.todayDone??view!.todayDone;
  return {count,todayDone,next:view&&view.count===count&&view.todayDone===todayDone?view.next:null};
 }
 /** The server's newcomer flag stays on until the very first room is finished, even after other rooms or story clears; popups only skip players with no progress at all. */
 private get brandNewPlayer(){const p=this.client.profile as {newcomer?:boolean;totalXp?:number;level?:number}|null;return p?.newcomer===true&&!(Number(p.totalXp)>0||Number(p.level)>0||this.levels?.chapters.some(chapter=>chapter.levels.some(level=>level.status==='cleared')));}
 private weeklyGiftDue(){
  const view=this.retention?.weeklyGift??null;let shown:string|null=null;try{shown=readShownDay(this.platform.storage.get(WEEKLY_GIFT_KEY));}catch{return false;}
  return weeklyGiftAutoShow({capable:this.retentionCapable('weeklyGift'),view,newcomer:this.brandNewPlayer,shownDay:shown,today:beijingDay(Date.now())});
 }
 /** Pops the 七日礼 on a quiet lobby or story page, once per Beijing day, after story 1-1 (not over the orientation picker). */
 private maybeWeeklyGift(){
  if(this.route!=='lobby'&&this.route!=='chapter'||this.room||this.modal||this.busy||!this.ready||this.hidden||this.destroyed||this.orientationEntryPending||this.offlineRoom)return;
  if(!this.retention&&this.retentionCapable('weeklyGift')){void this.loadRetention();return;}
  if(!this.weeklyGiftDue()){this.noteWeeklySkip();return;}
  try{this.platform.storage.set(WEEKLY_GIFT_KEY,JSON.stringify({shownDay:beijingDay(Date.now())}));}catch{this.retentionNote('七日礼 · 本机存储不可写，不弹出');return;}
  this.retentionNote('七日礼 · 弹出');
  this.openWeeklyGift();
 }
 private noteWeeklySkip(){
  const view=this.retention?.weeklyGift;if(!view)return;
  let shown:string|null=null;try{shown=readShownDay(this.platform.storage.get(WEEKLY_GIFT_KEY));}catch{}
  const reason=this.brandNewPlayer?'新手账号':view.done?'全部领完':!view.available?'今天已领':shown===beijingDay(Date.now())?'今天已弹过':'';
  if(reason)this.retentionNote('七日礼 · 不弹出：'+reason);
 }
 /** True while the 七日礼 may still pop or is open; later lobby greetings wait for it. */
 private weeklyGiftHolds(){
  if(!this.retentionCapable('weeklyGift'))return false;
  if(this.modal==='weeklyGift')return true;
  if(this.retentionPending&&Date.now()-this.retentionPendingSince<5000)return true;
  return this.weeklyGiftDue();
 }
 private openWeeklyGift(){this.weeklyGrant=null;this.showModal('weeklyGift');}
 private async claimWeeklyGift(){
  const key='weekly-gift-claim';
  await this.run(async()=>{
   try{
    const data=await this.client.post<RetentionView&{granted:WeeklyGrant}>('/api/mobile/retention/weekly-claim',{requestId:this.attempt(key)});this.attempts.delete(key);
    this.retention={weeklyGift:data.weeklyGift,dailyStreak:data.dailyStreak};this.retentionLoadedAt=Date.now();this.weeklyGrant=data.granted;this.note(weeklyGrantText(data.granted));
    if(data.granted.coins>0){try{this.platform.playSound?.('assets/audio/mobile-coin.wav');}catch{}}
    if(data.granted.decorationId)this.collection=null;
   }catch(error){this.attempts.delete(key);void this.loadRetention(true);throw error;}
  });
 }
 private openRedeem(){this.redeemCode='';this.redeemError=null;this.redeemGrant=null;this.showModal('redeem');}
 private async promptRedeemCode(){
  if(this.busy)return;
  const value=await this.platform.prompt('输入兑换码',this.redeemCode,{singleLine:true,maxLength:REDEEM_MAX_LENGTH,hint:this.redeemHint,placeholder:'例如 AB23CD45',confirmLabel:'兑换'});
  if(value===null||this.modal!=='redeem')return;
  this.redeemCode=redeemInput(value);this.redeemError=null;this.invalidate();
  if(this.redeemCode)await this.submitRedeem();
 }
 private async submitRedeem(){
  const code=this.redeemCode;if(!code||this.redeemGrant)return;
  const key='redeem:'+code;this.redeemError=null;
  await this.run(async()=>{
   try{
    const data=await this.client.post<{redeemed:RedeemGrant}>('/api/mobile/redeem',{code,requestId:this.attempt(key)});this.attempts.delete(key);
    // Coins, 碎片, energy and packs arrive with the reply's profile; decorations reload with the collection.
    this.redeemGrant=data.redeemed;this.collection=null;this.note(redeemSummary(data.redeemed));
    try{this.platform.playSound?.('assets/audio/mobile-coin.wav');}catch{}
   }catch(error){if(redeemAnswered(error))this.attempts.delete(key);this.redeemError=redeemErrorText(error);}
  });
 }
 private drawRedeem(){return drawRedeemPanel.call(this.host);}
 private checkStreakToast(){
  if(!this.retentionCapable('dailyStreak')||!this.ready)return;
  const live=(this.client.profile as {retention?:RetentionSummary}|null)?.retention?.dailyStreak;if(!live)return;
  const today=beijingDay(Date.now());let raw:string|null;try{raw=this.platform.storage.get(STREAK_SEEN_KEY);}catch{return;}
  const save=(value:object)=>{try{this.platform.storage.set(STREAK_SEEN_KEY,JSON.stringify(value));}catch{}};
  // First run on this device: remember the current state silently instead of replaying old awards.
  if(!raw){save({awardAt:live.lastAward?.at??0,day:live.todayDone?today:null});return;}
  const toast=streakToast(live,readStreakSeen(raw),today);if(!toast)return;
  save(toast.seen);this.note(toast.text);if(toast.text.includes('金币')){try{this.platform.playSound?.('assets/audio/mobile-coin.wav');}catch{}}
 }
 private drawWeeklyGift(){return drawWeeklyGiftPanel.call(this.host);}
 /** Daily done = merged in today's daily (server) or, on an old backend, a finished room of today's picture. */
 private dailyDoneToday(imageId?:string|null){
  const daily=this.dailyPhoto?.id;if(daily&&imageId===daily)return true;
  const streak=this.dailyStreak;if(streak)return streak.todayDone;
  return !!daily&&!!this.historyRooms?.some(room=>room.completed&&room.imageId===daily);
 }
 private completionFooterText(){
  const gift=this.retentionCapable('weeklyGift')?this.retention?.weeklyGift:null;
  if(gift?.available)return '七日礼今天还能领第 '+(gift.claimed+1)+' 天';
  return completionFooter({tomorrowDay:gift?.tomorrowDay,now:Date.now()});
 }
 /** Story clears show chapter progress, the next album reward and a teaser of the next level. */
 private storyCompletionLines(levelId:string|undefined,chapters:readonly {albumId?:string;milestones?:readonly {target:number;coins?:number;earned?:boolean}[];levels:readonly {id:string;status:string;intro?:string|null;line?:string|null}[]}[],maxChars:number):{progress:string;reward:string|null;teaser:string|null}|null{return storyCompletionLinesPanel.call(this.host,levelId,chapters,maxChars);}
 /** Breathing next-level button: redraw at ~15 fps only while that button is on screen. */
 private animateBreath(){
  if(this.breathFrame!==null||this.hidden||this.destroyed||this.modal!=='completion'||typeof this.platform.frame!=='function'||reducedComicMotion())return;
  const started=Date.now(),step=()=>{this.breathFrame=null;if(this.modal!=='completion'||this.hidden||this.destroyed)return;if(Date.now()-started<60){this.breathFrame=this.platform.frame(step);return;}this.invalidate();};
  this.breathFrame=this.platform.frame(step);
 }
 private breathButton(r:Rect,label:string,action:()=>void,fontSize=16){
  // The button keeps its rect (layout and hit area stay put); a gold ring around it breathes.
  this.stage.button(r,label,action,{tone:'berrydark',fontSize});
  const k=breathScale(Date.now(),reducedComicMotion()),c=this.stage.ctx;if(k===1||typeof c.strokeRect!=='function')return;
  const t=(k-1)/.035,pad=Math.round(2+3*t);c.save();c.globalAlpha=.25+.5*t;c.strokeStyle=this.colors.gold;c.lineWidth=2;c.strokeRect(Math.round(r.x)-pad,Math.round(r.y)-pad,Math.round(r.w)+2*pad,Math.round(r.h)+2*pad);c.restore();this.animateBreath();
 }
 private async loadTasks(){try{await this.loadView('tasks',()=>this.client.json<MobileTaskView>('/api/mobile/tasks'),data=>{this.tasks=this.platformTasks(data);});}catch(error){if(!this.destroyed)this.note(errorText(error));}}
 private async loadCollection(){try{await this.loadView('collection',()=>this.client.json<MobileCollectionView>('/api/mobile/collection'),data=>{this.collection=data;});}catch(error){if(!this.destroyed)this.note(errorText(error));}}
 private async loadGallery(){try{await this.loadView('gallery',()=>this.client.json<{imageIds?:string[];accessibleImageIds?:string[];freeImageIds?:string[];packedImageIds:string[];completedImageIds?:string[];photos?:SharedPhoto[];daily?:SharedPhoto|null;serverTime?:number}>('/api/mobile/gallery'),data=>{if(typeof data.serverTime==='number')this.serverOffset=data.serverTime-Date.now();if(data.daily?.id)this.dailyPhoto=data.daily;this.galleryIds=new Set(data.imageIds??data.accessibleImageIds??[]);this.packedIds=new Set(data.packedImageIds);this.freeGalleryIds=Array.isArray(data.freeImageIds)?new Set(data.freeImageIds):new Set([...this.galleryIds].filter(id=>!this.packedIds.has(id)));this.completedGalleryIds=Array.isArray(data.completedImageIds)?new Set(data.completedImageIds):null;if(Array.isArray(data.photos)){this.sharedPhotos=data.photos.filter(photo=>!!photo&&typeof photo.id==='string'&&typeof photo.src==='string'&&typeof photo.thumbSrc==='string').map(photo=>({...photo,title:photo.title||photo.id,category:photo.category||'其他'}));for(const photo of this.sharedPhotos)photoMap.set(photo.id,photo);if(data.daily?.id)photoMap.set(data.daily.id,data.daily);}if(this.selected&&(!this.galleryIds.has(this.selected)||this.unplayedOnly&&this.completedPhotoIds().has(this.selected)))this.selected=null;});}catch(error){if(!this.destroyed)this.note(errorText(error));}}
 private availableGallery():SharedPhoto[]{if(this.sharedPhotos)return this.sharedPhotos.filter(photo=>!this.galleryIds||this.galleryIds.has(photo.id));if(!this.galleryIds)return GALLERY_PHOTOS;const baseIds=new Set(GALLERY_PHOTOS.map(photo=>photo.id));return [...GALLERY_PHOTOS,...RESTORABLE_PHOTOS.filter(photo=>!baseIds.has(photo.id))].filter(photo=>this.galleryIds!.has(photo.id));}
 private completedPhotoIds(){
  const ids=new Set<string>(this.completedGalleryIds??[]);
  for(const album of this.collection?.albums??[])for(const image of album.images)if(image.collected)ids.add(image.id);
  return ids;
 }
 private async launch(input:MobileRoomInput){
  if(this.offline?.active&&!this.ready){if(input.mode==='level')await this.run(()=>this.launchOffline({kind:'level',levelId:input.levelId!}));else this.note(OFFLINE_REQUIRED);return;}
  if(input.mode!=='level'&&!this.formalWeb&&this.ownedRoomCount>=this.ownRoomLimit){this.showModal('manage');return;}
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
   this.attempts.delete(key);await this.attachTicket(ticket);if(this.room?.ticket.room.id===ticket.room.id)this.sendTableInvite(input);
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
 private leaveRoom(){this.telemetry?.endAttempt('quit');if(this.room)this.inviteQueue?.cancel(this.room.ticket.room.id);this.storyIntro=null;this.roomVariant=null;this.stopStoryFrame();this.clearCompletionTransition();this.cheer?.close();this.cheer=null;this.stopCheers();this.cursor?.stop();this.cursor=null;this.cursorVisible=false;this.detachRoom?.();this.unsubscribeRoom?.();this.room?.leave();this.realtime?.close();this.realtime=null;this.board?.destroy?.();this.detachRoom=null;this.unsubscribeRoom=null;this.setCompletionPhase('idle');this.room=null;this.board=null;this.aid=null;}
 private async attachTicket(ticket:RoomTicket){
  this.clearCompletionTransition();
  if(this.destroyed||this.needsPrivacyChoice||this.client.authRequired)return;
  const offline=this.offline?.isRoom(ticket.room.id)??false;
  this.social.close();
  const source=this.saveListView();if(source.route!=='room'){this.roomReturn=source;this.roomReturnStack=[...this.routeStack];this.roomReturnFrames=[...this.routeFrames];}
  this.leaveRoom();this.route='room';this.routeStack=[];this.routeFrames=[];this.scroll=0;this.modal=null;this.imageReady=false;this.roomViewPending=false;this.imageError='';this.messages=[];this.chatCursor=0;this.chatSeen=0;this.completedId='';this.chatBubble=null;this.bubbleSeen=-1;this.roomGuideStep=0;this.roomTimings?.clear();this.adminDiagExpanded=false;
  const realtime=offline?null:this.client.roomRealtime?.(ticket,()=>this.room?.snapshot.revision??ticket.room.revision,()=>{
   if(this.room===room)this.note('与 TapTap 的实时连接已断开，改用游戏服务器同步');
  })??null;this.realtime=realtime;
  const room=new RoomClient(ticket,{solo:offline?{enabled:()=>true,energy:()=>null}:{enabled:()=>this.client.config.capabilities.soloLocalPlay===true,storage:this.platform.storage,energy:()=>{const p=this.client.profile;if(!p)return null;return {enabled:this.client.config.capabilities.energy!==false,energy:p.energy,cap:p.energyCap,cost:p.economy?.contributionCost??1,xp:p.economy?.contributionXp??0,autoSupply:p.autoSupply===true,supplyEnergy:p.supply?.energy??0,free:p.economy?.firstRoomFree===true&&p.newcomer===true&&p.firstRoomId===ticket.room.id};}},fetch:offline?this.offline.server!.fetch:this.client.fetchLike,realtime:realtime??undefined,traceTimings:()=>this.adminDiagnosticsAllowed&&this.adminDiagEnabled,profile:offline?undefined:data=>{if(this.room===room)this.client.acceptRoomResponse(ticket,data);},refreshProfile:offline?undefined:async()=>{if(this.room===room)await this.client.refresh();},randomId:()=>this.platform.randomId(),hidden:()=>this.hidden,now:()=>Date.now(),performanceNow:()=>Date.now(),emit:(name,detail)=>{
   if(name==='room:local-play-error'&&this.room===room)this.platform.loginLog?.add('本地拼图出错，改为联网拼 · '+String((detail as {message?:string})?.message??'').slice(0,80));
   if(name==='room:rejoin-required'&&this.room===room&&!offline){this.note('正在重新连接房间，拼好的进度会保留');let tries=0;const rejoin=()=>{if(this.room!==room)return;if(this.busy&&++tries<20){setTimeout(rejoin,500);return;}void this.enterRoom(ticket.room.id);};rejoin();}
   if(name==='puzzle:successful-drop'&&this.room===room){this.board?.confirmMobileContribution(detail as MobileContributionReceipt);if(!this.nineGridRoom)this.telemetry?.milestone('new_user','完成首次拼合');}
   if(name==='mobile:profile')this.invalidate();
   if(name==='room:request-timing'&&this.room===room){const timing=detail as RoomRequestTiming;if(timing.action==='drop-start'){for(const key of ['drop','drop-queue','drop-total'])this.nineTimings?.delete(key);}this.nineTimings?.set(timing.action,timing);(this.roomTimings??=new Map()).set(timing.action,{...timing,at:Date.now()});this.invalidate();}
   if(name==='mobile:gameplay-error')this.note((detail as {message?:string})?.message||'操作暂未完成');
   if(name==='mobile:energy-empty'){if(this.energyEnabled){this.note('体力不足，请使用礼包或补给');this.navigate('supplies');}else this.note('当前游戏规则需要重新连接，请返回大厅后再进入房间');}
  }});this.room=room;this.setCompletionPhase('idle');this.completionLive=!room.snapshot.completedAt;
  if(!this.nineGridRoom&&!room.snapshot.completedAt){
   const levelId=room.snapshot.levelId??undefined,mode=this.roomTelemetryMode(room,offline),pieces=room.snapshot.requestedPieces??(room.snapshot.puzzle.cols*room.snapshot.puzzle.rows);
   this.telemetry?.startAttempt({levelId:levelId??room.snapshot.puzzle.imageId,levelNo:this.storyLevelNumber(levelId),mode,pieces,randomId:()=>this.platform.randomId()});
   this.telemetry?.milestone('new_user','开始首局拼图');
   if(!offline&&!levelId)this.telemetry?.milestone('global','体验多人房间');
  }
  const board=new PuzzleBoard(this.platform,room.state,this.invalidate);board.trayKey=room.snapshot.id;this.board=board;if(room.snapshot.completedAt)board.completionReveal=1;
  // 回忆变奏关: set before the room attaches, so a wind room's kept pieces are drawn where the player left them.
  this.roomVariant=this.storyRoomVariant(ticket,room);if(this.roomVariant)board.setVariant(boardVariant(this.roomVariant,ticket.room.id));board.setTheme(this.stage.theme);board.soundUrl='assets/audio/mobile-snap.wav';board.chimeUrl='assets/audio/mobile-coin.wav';board.teammateSoundEnabled=this.teammateSoundEnabled===true;{const self=room.snapshot.members.find(member=>member.id===ticket.playerId);if(self)board.selfPlayer={name:self.name,color:self.color};}board.onNotice=message=>this.note(message);board.drawDecoration=(value,rect)=>this.stage.decoration(value,rect);board.selfDecoration=this.client.profile?.collection?.equipped??null;board.viewLocked=this.viewLocked;this.detachRoom=room.attach(board);
  if(!offline){const cursor=new CursorClient(ticket.room.id,ticket.token,ticket.playerId,cursors=>board.setCursors(enrichCursorsFromMembers(cursors,room.snapshot.members as readonly CursorMemberMeta[])),()=>room.connected,()=>this.hidden||this.route!=='room'||this.modalBlocksInput,{retainUntilLeave:true,realtime:realtime??undefined,fetch:this.client.fetchLike,randomId:()=>this.platform.randomId(),now:()=>Date.now(),performanceNow:()=>Date.now(),subscribeVisibility:fn=>{const hide=this.platform.onHide(fn),show=this.platform.onShow(()=>fn());return()=>{hide();show();};}});this.cursor=cursor;board.onCursor=point=>cursor.point(point);cursor.start();realtime?.setHidden(this.hidden);realtime?.start();}
  this.cheer=this.cheersEnabled?new CheerClient({roomId:ticket.room.id,token:ticket.token,playerId:ticket.playerId,name:ticket.room.members.find(member=>member.id===ticket.playerId)?.name??this.client.profile?.name??'我',fetch:this.client.fetchLike,realtime,randomId:()=>{const id=this.platform.randomId().replace(/-/g,'').toLowerCase();return /^[a-f0-9]{32}$/.test(id)?id:Array.from({length:32},()=>Math.floor(Math.random()*16).toString(16)).join('');},onCheer:(cheer,own)=>this.receiveCheer(room,cheer,own)}):null;
  this.cheer?.setActive(this.modal==='completion');
  this.unsubscribeRoom=room.subscribe(()=>{this.syncCompletion(room);this.checkVariantCompany(room);});
  const photo=activeRoomPhoto(ticket.room,photoMap.get(ticket.room.puzzle.imageId));this.roomImage=this.client.asset(ticket.room.customImage?customPhoto(ticket.room.customImage,ticket.room.id).src:photo?.src??'');
  this.beginStoryIntro((ticket.room as typeof ticket.room&{levelId?:string}).levelId);
  this.invalidate();if(this.nineGridRoom)board.setUnderlay(Date.now()+86400000);else if(!offline)void this.loadAssistance();
  try{if(!this.roomImage)throw Error('这张拼图的图片暂不可用');await board.setImage(this.roomImage);if(this.room!==room||this.board!==board)return;this.imageReady=board.imagePreparation.phase==='ready';this.roomViewPending=this.imageReady;}catch(error){if(this.room!==room||this.board!==board)return;this.imageError=errorText(error);this.note(this.imageError,true);}this.invalidate();
 }
 private syncCompletion(room:RoomClient){
  if(this.room!==room)return;const chapter=this.chapterForLevel(this.room.snapshot.levelId??this.room.snapshot.mobileResult?.levelClear?.levelId);if(chapter)this.syncComicClear(chapter);if(!room.snapshot.completedAt)this.completionLive=true;
  if(room.snapshot.completedAt&&this.completedId!==room.snapshot.id){this.completedId=room.snapshot.id;if(this.nineGridRoom)this.note('九格已拼好，可以重新摆放继续测试');else{this.telemetry?.endAttempt('win');this.telemetry?.milestone('new_user','完成首局拼图');this.telemetry?.milestone('global','完成任意拼图');const clearedLevelId=room.snapshot.levelId??room.snapshot.mobileResult?.levelClear?.levelId;if(clearedLevelId==='ch1-1')this.telemetry?.milestone('global','通关故事1-1');if(chapter?.id==='ch1'&&(room.snapshot.mobileResult?.levelClear?.chapterComplete===true||chapter.levels.every(lv=>lv.status==='cleared'||lv.id===clearedLevelId)))this.telemetry?.milestone('global','通关第一章');if(this.offlineRoom){room.flushSoloNow();}else{void this.client.refresh().then(()=>this.checkLevelMilestone()).catch(()=>{});void this.loadCollection();void this.loadGallery();}if(this.completionLive&&this.imageReady&&this.board)this.beginCompletionTransition();else{if(this.board)this.board.completionReveal=1;this.showModal('completion');}}}if(this.offlineRoom&&room.snapshot.completedAt)this.syncOffline();this.invalidate();
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
 private normalizeAssistance(data:NonNullable<typeof this.aid>,activatedKind?:'hint'|'underlay'):NonNullable<typeof this.aid>{
  const now=Date.now(),offset=now-data.serverTime;
  const grants=data.grants.flatMap((grant:AssistanceGrant)=>{
   if(grant.kind==='underlay'){
    const {lasting,_startedAt,...rest}=grant as AssistanceGrant&{_startedAt?:unknown};
    const raw=grant.expiresAt+offset,base=typeof grant.startedAt==='number'?grant.startedAt+offset:now;
    const expiresAt=lasting?Math.min(raw,base+30000):activatedKind==='underlay'?Math.min(raw,now+30000):raw;
    return expiresAt>now?[{...rest,expiresAt}]:[];
   }
   return [{...grant,expiresAt:grant.expiresAt+offset}];
  });
  return {...data,grants};
 }
 private async loadAssistance(){if(!this.room||this.offlineRoom)return;try{const room=this.room;const data=await this.client.json<typeof this.aid>('/api/rooms/'+room.ticket.room.id+'/assistance?lasting=1','GET',undefined,{Authorization:'Bearer '+room.ticket.token});if(this.room!==room)return;if(data){this.aid=this.normalizeAssistance(data);this.applyAssistance();}}catch(error){this.note(errorText(error));}}
 private latestAid(kind:'hint'|'underlay'){const grants=this.aid?.grants??[],now=Date.now();for(let i=grants.length-1;i>=0;i--)if(grants[i].kind===kind&&grants[i].expiresAt>now)return grants[i];return undefined;}
 /** A lasting 提示 (v53.10, no countdown) ends once the board has no hinted piece left to place. */
 private activeAid(kind:'hint'|'underlay'){const grant=this.latestAid(kind);if(grant?.lasting&&kind==='hint'&&this.board&&!this.board.hintsShowing)return undefined;return grant;}
 private applyAssistance(){
  const board=this.board;if(!board)return;const underlay=this.latestAid('underlay'),hint=this.latestAid('hint');board.setUnderlay?.(underlay?underlay.expiresAt:0);
  // Lasting hints never top up with new pieces: drop the ones already placed before handing them to the board.
  const placed=hint?.lasting?new Set(board.state.groups.filter(g=>g.locked).flatMap(g=>g.pieces)):null,hintIds=(hint?.pieceIds??[]).filter(id=>!placed?.has(id));
  const activated=board.setHints?.(hintIds,hintIds.length?hint?.expiresAt??0:0,hint?.requestId);
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
 /** Watch a TapTap rewarded video; if TapTap is disconnected/unavailable, skip the ad so rewards still succeed. */
 private async watchTapTapAd(kindLabel:string,placementKey:AdPlacementKey,payload?:Record<string,unknown>):Promise<{skipped:boolean}>{
  if(!this.supplyAdAvailable)return {skipped:true};
  const unit=this.rewardedSlot().unit;if(!unit)return {skipped:true};
  let outcome:string;
  try{outcome=this.telemetry?.adEnabled?await this.telemetry.watchRewardedAd(placementKey,unit,payload):await this.platform.watchAd(unit);}catch{outcome='failed';}
  if(outcome==='completed')return {skipped:false};
  if(outcome==='closed')throw Error('广告未完整观看，本次未领取'+kindLabel);
  // 与 TapTap 断连或广告不可用/加载失败时，自动跳过广告，不影响正常获取。
  return {skipped:true};
 }
 private async activateAssistance(kind:'hint'|'underlay'){
  if(this.offlineRoom){this.note(OFFLINE_REQUIRED);return;}
  if(!this.room||!this.aid)return;if(this.activeAid(kind))return;
  await this.run(async()=>{const room=this.room!,key='aid-ad:'+room.ticket.room.id+':'+kind,headers={Authorization:'Bearer '+room.ticket.token,'Content-Type':'application/json'},path='/api/rooms/'+room.ticket.room.id+'/assistance',context='room/'+room.ticket.room.id,storageKey='jigsaw:ad:'+this.platform.config.apiBase+':'+(this.client.profile?.code??'')+':'+key;
   let pending:any=null;try{const stored=JSON.parse(this.platform.storage.get(storageKey)||'null');if(stored?.kind===kind&&stored.context===context&&stored.completed===true)pending=stored;}catch{}
   const requestId=pending?.requestId??this.attempt(key),wantLasting=kind==='hint';if(pending&&!wantLasting)delete pending.lasting;let usedAd=!!pending,data:any;
   const baseBody=wantLasting?{kind,requestId,lasting:true}:{kind,requestId};
   try{data=await this.client.json(path,'POST',pending??{...baseBody,toolAd:true},headers);}catch(error){
    if(pending&&[400,401,403,410].includes((error as{status?:number}).status??0)){this.platform.storage.remove(storageKey);this.attempts.delete(key);throw error;}
    const code=(error as{code?:string}).code;if(code!=='AD_REQUIRED'&&code!=='SHARE_REQUIRED')throw error;
    const adResult=await this.watchTapTapAd(kind==='hint'?'提示':'底图',kind==='hint'?'room_hint':'room_underlay',{room_mode:this.roomTelemetryMode(room,false),pieces:room.snapshot.requestedPieces??(room.snapshot.puzzle.cols*room.snapshot.puzzle.rows)});
    const challenge=await this.client.json<{rewardToken:string}>('/api/rewarded/challenge','POST',{kind,requestId,context,...(adResult.skipped?{adSkipped:true}:{})},headers);
    pending={kind,requestId,context,rewardToken:challenge.rewardToken,completed:true,toolAd:true,...(adResult.skipped?{adSkipped:true}:{}),...(wantLasting?{lasting:true}:{})};
    this.platform.storage.set(storageKey,JSON.stringify(pending));usedAd=true;
    data=await this.client.json(path,'POST',pending,headers);
   }
   this.platform.storage.remove(storageKey);this.attempts.delete(key);if(this.room!==room)return;this.aid=this.normalizeAssistance(data,kind);this.applyAssistance();if(usedAd)this.telemetry?.milestone('new_user','使用补给或看广告');const lasting=kind==='hint'&&this.activeAid(kind)?.lasting;this.note(kind==='hint'?(lasting?'提示已开启，拼好这几块前一直有效':'提示已开启30秒'):'底图已开启30秒');
  });
 }
 private async claimSupply(kind:'energy'|'create'){
  await this.claimSupplyAd(kind);
 }
 private get energyAdAvailable(){return this.client.config.adRewardEnabled===true&&!!this.client.config.rewardedAdUnitId;}
 /** Rewarded video pays out supplies on TapTap and, once it has its own adunit placement, on WeChat. */
 private get supplyAdAvailable(){const id=this.platform.config?.id;return (id==='taptap'||id==='wechat')&&this.energyAdAvailable;}
 /** 建房券与体力包统一通过观看 TapTap 广告获取（与 TapTap 断连时自动跳过广告）。 */
 private get ticketClaimAvailable(){return !this.formalWeb;}
 /** 分享领体力包 is once per game day (server rule from 20261105-share-energy-daily; older servers never send the flag). */
 private get shareEnergyDone(){return (this.client.profile as {shareEnergyClaimedToday?:boolean}|null)?.shareEnergyClaimedToday===true;}
 private get adTestingAllowed(){return this.platform.config.id==='taptap'&&this.client.profile?.taptap?.bound===true&&this.client.profile.taptap.diagnostics===true;}
 /** 当前画面方向对应的激励广告位；服务端未分横竖屏时沿用 rewardedAdUnitId。 */
 private rewardedSlot(){const v=typeof this.platform.viewport==='function'?this.platform.viewport():undefined,orientation:'portrait'|'landscape'=v&&v.width>v.height?'landscape':'portrait',c=this.client.config;return {orientation,unit:(orientation==='landscape'?c.rewardedAdUnitIdLandscape:c.rewardedAdUnitIdPortrait)||c.rewardedAdUnitId};}
 /** 官方做法：广告实例提前创建并预加载，点击时直接展示。重复调用只查表。 */
 private prepareRewardedAd(){if(!this.supplyAdAvailable)return;const unit=this.rewardedSlot().unit;if(!unit)return;if(this.telemetry?.adEnabled)this.telemetry.prepareAd(unit);else this.platform.prepareAd?.(unit);}
 private async testRewardedAd(){
  if(!this.adTestingAllowed)return;
  // 优先使用服务端按方向下发的广告位；暂停广告时，诊断入口使用官方H5匹配且已真机验证的广告位。
  await this.run(async()=>{const slot=this.rewardedSlot(),unit=slot.unit||'1054324',started=Date.now();let outcome:string;
   try{outcome=await this.platform.watchAd(unit);}catch{outcome='failed';}
   const result=outcome==='completed'?'已完整观看，广告测试成功':outcome==='closed'?'已提前关闭，本次未完整观看':'广告测试未成功';
   // 只验证广告链路，不申请奖励、不受补给库存影响，也不改全服广告开关。
   this.platform.alert(result+'\n广告位 '+unit+' · '+(slot.orientation==='landscape'?'横屏':'竖屏')+' · 用时 '+Math.round((Date.now()-started)/1000)+' 秒'+(outcome==='failed'||outcome==='unavailable'?'\n原因：'+(this.platform.adFailure?.()||'未知'):'')+'\n本入口仅测试观看，不发放奖励。\n'+(this.platform.adDiagnostics?.()??'未返回广告诊断'));this.note(result);
  });
 }
 private async claimSupplyAd(kind:'energy'|'create'){
  await this.run(async()=>{const profile=this.client.profile;if(!profile)throw Error('玩家信息尚未就绪，请稍后再试');
   const storageKey='jigsaw:shared:supply-ad:v1:'+this.platform.config.apiBase+':'+profile.code;let pending:any=null;try{pending=JSON.parse(this.platform.storage.get(storageKey)||'null');}catch{}
   // A video already watched is redeemed first, whichever supply it was for.
   if(!pending?.completed){const name=kind==='energy'?'体力包':'建房券';if(profile.supply[kind]>=3)throw Error('库存已满，使用后再领取');
    const adResult=await this.watchTapTapAd(name,kind==='energy'?'supply_energy':'supply_create_ticket',{supply_kind:kind});
    const requestId=this.platform.randomId(),challenge=await this.client.post<{rewardToken:string}>('/api/mobile/supply/challenge',{kind,requestId,...(adResult.skipped?{adSkipped:true}:{})},5000);
    pending={kind,requestId,rewardToken:challenge.rewardToken,completed:true,...(adResult.skipped?{adSkipped:true}:{})};
    this.platform.storage.set(storageKey,JSON.stringify(pending));
   }
   try{await this.client.post('/api/mobile/supply/redeem',pending);}catch(error){if([400,401,403,410].includes((error as{status?:number}).status??0))this.platform.storage.remove(storageKey);throw error;}this.platform.storage.remove(storageKey);await this.client.refresh();this.telemetry?.milestone('new_user','使用补给或看广告');this.note(pending.kind==='create'?'建房券已补满，可以开桌了':'体力包 +1，已存入库存');
  });
 }
 /** Completed rewarded ads advance an ad-album picture (2 watches = permanent unlock, max 2 watches / 1 picture per day).
  * A finished ad is kept in storage until the server confirms, so a dropped redeem retries without a second video. */
 private async unlockAdImage(imageId:string){
  await this.run(async()=>{const profile=this.client.profile;if(!profile)throw Error('玩家信息尚未就绪，请稍后再试');
   const storageKey='jigsaw:shared:unlock-ad:v1:'+this.platform.config.apiBase+':'+profile.code;let pending:any=null;try{pending=JSON.parse(this.platform.storage.get(storageKey)||'null');}catch{}
   if(!pending?.completed||typeof pending.imageId!=='string'){
    if(!this.energyAdAvailable)throw Error('广告暂未开放，暂时无法解锁这张图');
    const requestId=this.platform.randomId(),challenge=await this.client.post<{rewardToken:string}>('/api/mobile/collection/unlock/challenge',{imageId,requestId},5000);pending={imageId,requestId,rewardToken:challenge.rewardToken,completed:false};
    const adUnit=this.rewardedSlot().unit;let outcome:string;try{outcome=this.telemetry?.adEnabled&&adUnit?await this.telemetry.watchRewardedAd('unlock_album_image',adUnit,{image_id:imageId}):await this.platform.watchAd(adUnit);}catch{outcome='failed';}
    if(outcome!=='completed'){void this.client.post('/api/mobile/collection/unlock/cancel',pending).catch(()=>{});const reason=this.platform.adFailure?.()||'';throw Error(outcome==='closed'?'广告未完整观看，本次未计入解锁进度':'广告暂时加载不出来'+(reason?'（'+reason+'）':'')+'，请稍后再试');}
    pending.completed=true;this.platform.storage.set(storageKey,JSON.stringify(pending));
   }
   type UnlockReceipt={imageId:string;alreadyOwned?:boolean;unlocked?:boolean;progress?:number;required?:number;dailyUsed?:number;dailyLimit?:number};
   let data:MobileCollectionView&{unlocked?:UnlockReceipt};
   try{data=await this.client.post<MobileCollectionView&{unlocked?:UnlockReceipt}>('/api/mobile/collection/unlock/redeem',pending);}catch(error){if([400,401,403,409,410].includes((error as{status?:number}).status??0))this.platform.storage.remove(storageKey);throw error;}
   this.platform.storage.remove(storageKey);this.applyCollection(data);
   if(this.previewPack)this.previewPack=data.packs.find(pack=>pack.id===this.previewPack?.id)??this.previewPack;
   await this.client.refresh();void this.loadGallery();this.telemetry?.milestone('new_user','使用补给或看广告');
   const receipt=data.unlocked,title=photoMap.get(pending.imageId)?.title??data.packs.flatMap(pack=>pack.images).find(image=>image.id===pending.imageId)?.title??'这张图',resumed=pending.imageId===imageId?'':'（上次看完的广告已补发）';
   if(receipt&&receipt.unlocked===false&&!receipt.alreadyOwned){
    const progress=receipt.progress??1,required=receipt.required??2,left=Math.max(1,required-progress);
    this.note('「'+title+'」解锁进度 '+progress+'/'+required+'，再看 '+left+' 次广告即可永久解锁'+resumed);
    return;
   }
   this.telemetry?.milestone('global','解锁图包或合成装饰');
   try{this.platform.playSound?.('assets/audio/mobile-coin.wav');}catch{}
   this.note('「'+title+'」已永久解锁'+(resumed||'，可以开拼了'));
  });
 }
 /** One completed rewarded ad doubles a finished room's base completion coins & fragments once.
  * A finished ad stays in storage until /redeem succeeds, so a dropped reply never asks for a second video. */
 private async claimCompletionDouble(roomId:string){
  await this.run(async()=>{const profile=this.client.profile;if(!profile)throw Error('玩家信息尚未就绪，请稍后再试');
   const storageKey='jigsaw:shared:completion-double:v1:'+this.platform.config.apiBase+':'+profile.code+':'+roomId;let pending:any=null;try{pending=JSON.parse(this.platform.storage.get(storageKey)||'null');}catch{}
   if(!pending?.completed||pending.roomId!==roomId){
    if(!this.supplyAdAvailable)throw Error('广告暂未开放，暂时无法翻倍领取');
    const requestId=this.platform.randomId(),challenge=await this.client.post<{rewardToken:string}>('/api/mobile/completion/double/challenge',{roomId,requestId},5000);pending={roomId,requestId,rewardToken:challenge.rewardToken,completed:false};
    const adUnit=this.rewardedSlot().unit,snap=this.room?.snapshot,result=snap?.mobileResult;
    let outcome:string;try{outcome=this.telemetry?.adEnabled&&adUnit?await this.telemetry.watchRewardedAd('daily_ad_reward',adUnit,{reward_kind:'completion_double',room_id:roomId,pieces:snap?.requestedPieces??(snap?snap.puzzle.cols*snap.puzzle.rows:0),coins:result?.coins??0,fragments:result?.fragments??0}):await this.platform.watchAd(adUnit);}catch{outcome='failed';}
    if(outcome!=='completed'){void this.client.post('/api/mobile/completion/double/cancel',pending).catch(()=>{});const reason=this.platform.adFailure?.()||'';throw Error(outcome==='closed'?'广告未完整观看，本次奖励未翻倍':'广告暂时加载不出来'+(reason?'（'+reason+'）':'')+'，请稍后再试');}
    pending.completed=true;this.platform.storage.set(storageKey,JSON.stringify(pending));
   }
   type DoubleReply={doubled:{roomId:string;coins:number;fragments:number;alreadyClaimed?:boolean};completion?:{coins:number;fragments:number;doubleClaimed?:boolean;doubleBonus?:{coins:number;fragments:number}};profile?:MobileProfile};
   let data:DoubleReply;
   try{data=await this.client.post<DoubleReply>('/api/mobile/completion/double/redeem',pending);}catch(error){if([400,401,403,404,409,410].includes((error as{status?:number}).status??0))this.platform.storage.remove(storageKey);throw error;}
   this.platform.storage.remove(storageKey);
   if(this.room?.snapshot.id===roomId&&this.room.snapshot.mobileResult){
    this.room.snapshot.mobileResult={...this.room.snapshot.mobileResult,doubleClaimed:true,doubleBonus:{coins:data.doubled.coins,fragments:data.doubled.fragments}};
   }
   try{this.platform.playSound?.('assets/audio/mobile-coin.wav');}catch{}
   await this.client.refresh();if(this.collection)void this.loadCollection();
   this.telemetry?.milestone('new_user','使用补给或看广告');
   const parts=[data.doubled.coins>0?'金币 +'+data.doubled.coins:'',data.doubled.fragments>0?'碎片 +'+data.doubled.fragments:''].filter(Boolean).join('、');
   this.note(data.doubled.alreadyClaimed?'这次完图奖励已经翻倍领取过了':'双倍奖励已到账：'+(parts||'已翻倍'));
   this.invalidate();
  });
 }
 private async useEnergy(){await this.run(async()=>{const key='use-energy';await this.client.post('/api/mobile/supply/use',{kind:'energy',requestId:this.attempt(key)});this.attempts.delete(key);await this.client.refresh();this.note('体力已补满');});}
 private async openGiftRequest(kind:string,quantity:number){
  const key='gift:'+kind+':'+quantity;
  try{
   const data=await this.client.post<MobileGiftOpenResult>('/api/mobile/gifts/open',{kind,quantity,requestId:this.attempt(key)});
   this.attempts.delete(key);
   return data;
  }catch(error){
   const status=(error as {status?:number}|null)?.status??0;
   if(status>=400&&status<500)this.attempts.delete(key);
   throw error;
  }
 }
 private async openGiftItems(items:Array<{kind:string;count:number}>,showCount:boolean){
  await this.run(async()=>{
   let opened=0,energy=0,xp=0,coins=0;
   const finish=async(interrupted?:unknown)=>{
    if(coins>0){try{this.platform.playSound?.('assets/audio/mobile-coin.wav');}catch{}}
    await this.client.refresh().catch(()=>{});
    this.telemetry?.milestone('new_user','开启任务礼包');this.checkLevelMilestone();
    const reward=this.rewardText(energy,xp,coins);
    if(interrupted)this.note('已开启 '+opened+' 份礼包（'+reward+'），其余中断：'+errorText(interrupted));
    else this.note(showCount||opened>1?'已开启 '+opened+' 份礼包 · '+reward:reward);
   };
   try{
    for(const item of items){
     let remaining=Math.max(0,Math.floor(item.count));
     while(remaining>0&&!this.destroyed){
      const batch=Math.min(GIFT_OPEN_BATCH_LIMIT,remaining);
      const data=await this.openGiftRequest(item.kind,batch);
      this.applyTasks(data);
      opened+=data.opened.quantity??batch;
      energy+=data.opened.energy??0;
      xp+=data.opened.xp??0;
      coins+=data.opened.coins??0;
      remaining-=batch;
     }
    }
   }catch(error){
    if(opened>0){await finish(error);return;}
    throw error;
   }
   if(opened>0)await finish();
  });
 }
 private async openGift(kind:string,quantity=1){await this.openGiftItems([{kind,count:Math.max(1,Math.floor(quantity))}],quantity>1);}
 private async shareInvitation(){await this.run(async()=>{
  if(this.platform.config.id==='web'){const result=await this.platform.share({title:'来'+this.platform.config.gameName+'一起拼图',roomId:this.room?.ticket.room.id,inviteCode:this.tasks?.invitation.code});this.note(result==='copied'?'邀请链接已复制，可以粘贴给好友':result==='shared'?'已分享邀请链接':result==='cancelled'?'本次分享已取消':'浏览器暂不支持分享或复制，请使用邀请码');return;}
  const apply=async(data:MobileInviteShareResult)=>{this.applyTasks(data);await this.client.refresh();this.checkLevelMilestone();this.note(data.shared.alreadyRewarded?'今天的分享奖励已领完，仍可邀请好友':'分享奖励已到账：'+this.rewardText(data.shared.energy,data.shared.xp,data.shared.coins??0));};
  if(!this.shareAvailable&&this.platform.config?.id==='wechat'){const privateCode=(this.client.ticket as RoomTicket&{inviteCode?:string})?.inviteCode,result=await this.shareFromGame({title:'来'+this.platform.config.gameName+'一起拼图',roomId:this.room?.ticket.room.id,query:privateCode&&this.room?{roomInvite:privateCode}:undefined});this.note(result==='opened'||result==='shared'?'已打开分享，请选择微信好友':result==='cancelled'?'本次分享已取消':'当前环境无法分享');return;}
  if(this.shareReward.pending()){await apply(await this.shareReward.claim());return;}
  if(!this.tasks)await this.loadTasks();if(!this.tasks)throw Error('邀请码暂时无法加载');const privateCode=(this.client.ticket as RoomTicket&{inviteCode?:string})?.inviteCode;
  const result=await this.shareFromGame({title:'来'+this.platform.config.gameName+'一起拼图',roomId:this.room?.ticket.room.id,inviteCode:this.tasks.invitation.code,query:privateCode?{roomInvite:privateCode}:undefined});
  if(result==='unavailable')this.showShareFailureDiagnostic();
  try{const receipt=await this.shareReward.complete(result);if(receipt){await apply(receipt);return;}}
  catch{this.note('分享已完成，奖励结果待确认；再次点击分享即可重试领取。');return;}
  this.note(result==='opened'?'已打开分享，请选择好友；好友有效参与后会计入任务':result==='copied'?'邀请链接已复制，可以粘贴给好友':result==='shared'?'已分享邀请，奖励以实际参与规则为准':result==='cancelled'?'本次分享已取消':'当前环境无法分享，请使用邀请码');
 });}
 private async acceptInvitation(){const code=this.pendingInvitation.trim();if(!code)return;await this.run(async()=>{await this.client.post('/api/mobile/invitations/accept',{code,requestId:this.attempt('accept:'+code)});this.pendingViews?.invalidate();this.attempts.delete('accept:'+code);this.pendingInvitation='';await this.loadTasks();this.note('已关联邀请，一起完成拼图吧');});}
 /** `equip` with a null id takes the pointer decoration off (the server stores no decoration). */
 private async collectionAction(kind:'buy'|'craft'|'equip',id:string|null){await this.run(async()=>{const key=kind+':'+(id??'none');const data=await this.client.post<MobileCollectionView>('/api/mobile/collection/'+kind,{[kind==='buy'?'packId':'decorationId']:id,requestId:this.attempt(key)});this.applyCollection(data);this.attempts.delete(key);this.modal=null;await this.client.refresh();if(kind==='buy'||kind==='craft')this.telemetry?.milestone('global','解锁图包或合成装饰');if(kind==='buy')void this.loadGallery();this.note(kind==='buy'?'图包已永久解锁':kind==='craft'?'装饰已合成':id===null?'装饰已取下':'装饰已装备');});}
 private async loadChat(){if(this.offlineRoom)return;
  if(!this.room||this.chatLoading)return;this.chatLoading=true;
  try{const room=this.room,data=await this.client.json<any>('/api/rooms/'+room.ticket.room.id+'/chat?after='+this.chatCursor,'GET',undefined,{Authorization:'Bearer '+room.ticket.token});if(room!==this.room||this.destroyed)return;
   let changed=false;const incoming:PublicMessage[]=data.messages??[];
   if(Array.isArray(data.phrases)){const next=new Set<string>(data.phrases.filter((text:unknown)=>typeof text==='string'));if(next.size!==this.serverPhrases.size||[...next].some(text=>!this.serverPhrases.has(text))){this.serverPhrases=next;changed=true;}}
   if(incoming.length){const map=new Map(this.messages.map(item=>[item.id,item]));for(const item of incoming)map.set(item.id,item);const next=[...map.values()].slice(-60);if(messageListKey(next)!==messageListKey(this.messages)){this.messages=next;changed=true;}}
   this.chatCursor=data.cursor??this.chatCursor;if(this.modal==='chat'){if(this.messages.some(item=>item.id>this.chatSeen&&item.id<=this.chatCursor&&item.code!==this.client.profile?.code&&!this.social.blockedCodes.includes(item.code)))changed=true;this.chatSeen=this.chatCursor;}if(changed)this.invalidate();
  }catch(error){if(this.modal==='chat')this.note(errorText(error));}finally{this.chatLoading=false;}
 }
 private async retryRoomImage(board:PuzzleBoard){
  this.imageReady=false;this.imageError='';this.invalidate();
  try{await board.setImage(this.roomImage);if(this.board!==board)return;this.imageReady=board.imagePreparation.phase==='ready';this.message='';board.fit();}
  catch(error){if(this.board!==board)return;this.imageError=errorText(error);throw error;}
 }
 private phraseAvailable(id:number){return !!phrases[id]&&(id<NEWER_PHRASE_ID||this.serverPhrases.has(phrases[id]));}
 private async say(phraseId:number){if(!this.room||!Number.isSafeInteger(phraseId)||!this.phraseAvailable(phraseId))return;await this.run(async()=>{const room=this.room!,key='chat:'+phraseId;await this.client.json('/api/rooms/'+room.ticket.room.id+'/chat','POST',{phraseId,requestId:this.attempt(key),after:this.chatCursor},{Authorization:'Bearer '+room.ticket.token,'Content-Type':'application/json'});this.attempts.delete(key);await this.loadChat();});}
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
  const text=['拼图小窝 登录日志 '+CLIENT_PACKAGE_VERSION+(this.platform.config.buildVersion?' · '+this.platform.config.buildVersion:''),...(this.platform.loginLog?.lines()??[]),'当前 · '+(this.platform.tapAuthorizationDebug?.()??'')].join('\n');
  const copied=await (this.platform.copyText?.(text)??Promise.resolve(false)).catch(()=>false);this.note(copied?'登录日志已复制':'复制失败，请截图发送');
 }
 private drawLoginLog(){return drawLoginLogPanel.call(this.host);}
 private drawPrivacyChoice(){return drawPrivacyChoicePanel.call(this.host);}
 private async loadPrivacyRequests(){
  if(this.privacyRequestsLoading||this.client.config.capabilities.privacyRequests!==true)return;this.privacyRequestsLoading=true;this.invalidate();
  try{const result=await this.client.json<{requests:PrivacyRequest[]}>('/api/mobile/privacy-request');this.privacyRequests=result.requests;}catch(error){this.note(errorText(error));}finally{this.privacyRequestsLoading=false;this.invalidate();}
 }
 private async submitPrivacyRequest(type:'access'|'delete'){
  await this.run(async()=>{const key='privacy-request:'+type,result=await this.client.post<{request:PrivacyRequest}>('/api/mobile/privacy-request',{requestId:this.attempt(key),type});this.privacyRequests=[result.request,...this.privacyRequests.filter(row=>row.requestId!==result.request.requestId)];this.attempts.delete(key);this.note(type==='delete'?'删除申请已登记，资料尚未删除。请保留编号并邮件联系运营者。':'访问申请已登记，等待核验。请保留编号并邮件联系运营者。');this.invalidate();});
 }
 drawForRenderProbe(directPaper:boolean){const board=this.board;if(!board||!directPaper){this.draw();return;}const enabled=board.paperCacheEnabled;board.paperCacheEnabled=false;try{this.draw();}finally{board.paperCacheEnabled=enabled;}}
 draw(){
  this.frameViewport=this.platform.viewport();
  try{
  this.settingsTipAnchor=null;this.settingsTipDrawn=false;
  const s=this.stage,view=this.frameViewport;if(this.route==='room'){s.ctx.fillStyle=boardThemeColors(s.theme).paper;s.ctx.fillRect(0,0,s.w,s.h);}else s.background();
  if(this.loginLogOpen){this.drawLoginLog();return;}
  if(this.needsPrivacyChoice||this.loginDialogActive||this.platform.tapAuthorizationPending?.()){this.drawPrivacyChoice();return;}
  // Once start-up finishes the bar fills to 100% before the first scene; an error screen drops it.
  const loading=!this.ready&&!this.startupError&&!this.client.authRequired&&!this.offline?.active&&!this.offlineRoom;
  if(this.ready&&this.loadingStarted&&!this.loadingDone){this.loadingDone=Date.now();this.loadingFrom=this.loadingShown;}
  if(loading||this.loadingDone&&Date.now()-this.loadingDone<300){this.drawLoading();return;}
  this.loadingStarted=this.loadingShown=this.loadingDone=0;
  this.sceneArea={x:0,y:0,w:s.w,h:s.h};this.listArea={...this.sceneArea};this.listColumn=null;this.albumListArea={x:0,y:0,w:0,h:0};
  this.bodyBottom=s.h-view.bottom-12;
  if(this.route==='room')this.drawRoom();
  else if(this.offline?.active&&!this.ready){this.bodyTop=view.top+12;this.extent=this.offline.drawPage(s,this.scroll,{paragraph:(...args)=>this.paragraph(...args),selectedChapter:view=>this.selectChapter(view),chapter:(chapter,view,height)=>{const top=this.bodyTop,bottom=this.bodyBottom,scroll=this.scroll;this.bodyTop=0;this.bodyBottom=height;this.scroll=0;this.drawChapter(chapter,view);this.bodyTop=top;this.bodyBottom=bottom;this.scroll=scroll;},asset:src=>this.client.asset(src),reconnect:()=>{this.offline.active=false;void this.start();},launch:input=>void this.run(()=>this.launchOffline(input)),invalidate:this.invalidate});this.clampListScroll();}
  else if(this.desktop){if(this.ready)this.drawDesktopShell();else s.withoutInput(()=>this.drawDesktopShell());const area=this.sceneArea;if(this.route==='collection'){const width=Math.min(contentMaxWidth+24,area.w);area.x+=(area.w-width)/2;area.w=width;this.listArea={...area};}this.contentOrigin={x:area.x,y:area.y};s.withViewport(area,()=>{this.bodyTop=12;this.bodyBottom=s.h-12;this.drawScene();});this.bodyTop+=area.y;this.bodyBottom+=area.y;this.listArea={x:this.lobbyColumn()?.x??(this.listArea.x||area.x),y:this.bodyTop,w:this.lobbyColumn()?.w??(this.listArea.w||area.w),h:Math.max(0,this.bodyBottom-this.bodyTop)};}
  else{
   const layout=this.layout,rail=this.navVisible&&layout==='phoneLandscape',bar=this.navVisible&&layout==='phonePortrait',outer={x:rail?72:0,y:0,w:s.w-(rail?72:0),h:s.h-(bar?64:0)};
   if(rail)this.drawNavRail();
   // The page draws in local coordinates beside the rail or above the tab bar; hits stay in screen space.
   const page=()=>{this.bodyBottom=s.h-view.bottom-12;if(this.ready)this.drawHeader();else s.withoutInput(()=>this.drawHeader());const width=this.route==='collection'?Math.min(contentMaxWidth+24,s.w):s.w,x=(s.w-width)/2,local={x,y:0,w:width,h:s.h};this.sceneArea={...local,x:outer.x+x};this.contentOrigin={x:outer.x+x,y:0};if(x)s.withViewport(local,()=>this.drawScene());else this.drawScene();this.listArea={x:this.lobbyColumn()?.x??outer.x+x,y:this.bodyTop,w:this.lobbyColumn()?.w??width,h:Math.max(0,this.bodyBottom-this.bodyTop)};};
   if(rail||bar)s.withViewport(outer,page);else page();
   if(bar)this.drawTabBar();
  }
  this.drawSettingsTip();
  if(this.modal)this.drawModal();
  this.noticeBottom=0;if(this.message&&Date.now()<=this.messageUntil)this.drawNotice();
  this.drawInviteBanner();
  if(this.busy){const cancel=this.sharing&&!!this.platform.cancelShare,label=cancel?'等待分享 · 取消等待':'正在处理…',width=cancel?184:144,r={x:(s.w-width)/2,y:Math.max(view.top+6,this.platform.config.id==='taptap'?44:0),w:width,h:28};s.panel(r,'cream');s.text(label,r.x+(width-s.measure(label,12))/2,r.y+6,12,this.colors.ink);if(cancel)s.hit(r,()=>this.platform.cancelShare?.());}
  }finally{this.frameViewport=null;}
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
 private get pageSubtitle(){switch(this.route){case'lobby':{const count=this.lobbyRooms.length,online=this.lobbyOnline?' · '+this.lobbyOnline+' 位拼友在线':'';return (count?(this.lobbyCursor?count+'+':count)+' 桌正在拼':'今天，拼一会儿')+online;}case'gallery':return '选好图片和片数，就能开一桌';case'collection':return '拼完一张图就收进图集，集满有奖励';case'tasks':return (this.inviteRewardsHidden?'拼合攒礼包':'拼合攒礼包，邀请得奖励');case'friends':return '加好友、私聊、一起拼';case'supplies':return '体力与建房券';default:return '慢慢拼，慢慢了解';}}
 // 站内邀请: the room's 「＋ 邀请」 window lists game friends; invites go out as room-invite messages, one every 3.2 s.
 private inviteQueue!:RoomInviteQueue;private inviteSeen!:InviteSeenStore;private inviteNames=new Map<string,string>();
 private incomingInvite:IncomingInvite|null=null;private inviteBanner:(IncomingInvite&{until:number})|null=null;private noticeBottom=0;
 /** 「开一桌邀请TA」: the friend is invited automatically once the player's next table is open. */
 private tableInvite:{code:string;name:string;until:number}|null=null;
 private socialRoom(){
  const room=this.room;if(!room||this.offlineRoom)return null;return {id:room.ticket.room.id,title:room.snapshot.title||'一起拼图',pieces:room.state.cols*room.state.rows,visibility:room.snapshot.visibility,inviteCode:(this.client.ticket as RoomTicket&{inviteCode?:string})?.inviteCode||(room.snapshot as unknown as {inviteCode?:string}).inviteCode,authorization:'Bearer '+room.ticket.token,members:room.snapshot.members.map(member=>({...member,code:(member as unknown as {code?:string}).code,level:(member as unknown as {level?:number}).level}))};
 }
 private get roomInvitesEnabled(){const social=this.client.config?.capabilities?.social;return social?.friends!==false&&(social?.roomInvites===true||social?.privateMessages===true);}
 private get inviteFriendsAvailable(){return this.roomInvitesEnabled&&!this.offlineRoom&&!(this.offline?.active&&!this.ready)&&(!this.room||this.room.snapshot.visibility!=='solo');}
 private async sendRoomInvite(job:InviteJob){
  const room=this.socialRoom();if(!room||room.id!==job.roomId)throw Object.assign(Error('已离开房间'),{code:'ROOM_LEFT'});
  await this.client.json('/api/mobile/social/messages','POST',{peer:job.code,kind:'room-invite',roomId:room.id,...(room.inviteCode?{inviteCode:room.inviteCode}:{}),requestId:job.requestId},{Authorization:room.authorization,'Content-Type':'application/json'});
 }
 private roomInviteSent(job:InviteJob){const key=job.roomId+':'+job.code,name=this.inviteNames.get(key);if(name){this.inviteNames.delete(key);this.note('已邀请 '+name+'，等TA来一起拼');}if(!this.inviteQueue.pending)void this.social.refresh();}
 private inviteFriend(friend:SocialPlayer){const room=this.socialRoom();if(!room)return;if(room.visibility==='private'&&!room.inviteCode){this.note('当前私人房间没有可用邀请凭证');return;}this.inviteQueue.enqueue(room.id,friend.code);}
 private startTableInvite(friend:SocialPlayer){
  this.tableInvite={code:friend.code,name:friend.name,until:Date.now()+600000};if(this.modal)this.closeModal();
  if(this.route!=='gallery')this.navigate('gallery');this.note('选一张图开一桌，开好后自动邀请 '+friend.name);
 }
 private sendTableInvite(input:MobileRoomInput){
  const pending=this.tableInvite;if(!pending)return;this.tableInvite=null;if(input.mode==='level'||Date.now()>pending.until)return;
  const room=this.socialRoom();if(!room||room.visibility==='solo')return;this.inviteNames.set(room.id+':'+pending.code,pending.name);this.inviteQueue.enqueue(room.id,pending.code);
 }
 private socialSnapshot(state:SocialSnapshot){if(this.inviteBanner)return;const before=this.incomingInvite?.message.id;this.incomingInvite=pickIncomingInvite(state,this.inviteSeen.seen,this.room&&!this.offlineRoom?this.room.ticket.room.id:null);if(this.incomingInvite?.message.id!==before)this.invalidate();}
 private get inviteBannerAllowed(){return this.ready&&!this.offlineRoom&&!this.needsPrivacyChoice&&!this.loginLogOpen&&this.modal!=='levelComic'&&this.modal!=='orientation'&&this.modal!=='welcome';}
 private async joinInvite(invite:IncomingInvite){
  this.inviteBanner=null;this.invalidate();const message=invite.message;if(!message.roomId)return;
  void this.client.post('/api/mobile/social/messages/read',{peer:invite.peer.code,through:message.id,requestId:this.platform.randomId()}).then(()=>this.social.refresh()).catch(()=>{});
  if(this.room?.ticket.room.id===message.roomId){this.note('你已经在这桌了');return;}
  await this.enterRoom(message.roomId,message.inviteCode);
 }
 private drawInviteBanner(){return drawInviteBannerPanel.call(this.host);}
 private openSocialInbox(){this.showModal('social');this.social.open(this.social.unread?'messages':this.social.requestCount?'requests':'friends');}
 /** Friend messages and requests, on the room's member avatars (the room hides the tab bar that normally shows them). */
 private drawRoomFriendBadge(){
  const count=this.social.unread+this.social.requestCount,a=this.roomMembersArea;if(!count||this.offlineRoom||a.w<=0)return;
  const s=this.stage,label=count>99?'99+':String(count),w=Math.max(18,s.measure(label,10,700)+9),x=a.x-w/2+2,y=a.y-4;
  s.frame({x,y,w,h:18},'segment-berry-selected');s.text(label,x+(w-s.measure(label,10,700))/2,y+3,10,this.colors.onAccent,700);s.hit({x:x-8,y:y-6,w:w+16,h:30},()=>this.openSocialInbox());
 }
 /** Top of the 「邀请好友」 window: the game friend list (or, with no friends yet, ways to add one). Returns the next y. */
 private drawInviteFriends(left:number,cy:number,width:number){return drawInviteFriendsPanel.call(this.host,left,cy,width);}
 private friendsTab:'friends'|'messages'|'requests'='friends';private recentPlayers:RecentPlayer[]=[];
 private async loadRecentPlayers(){try{const data=await this.client.json<{players:RecentPlayer[]}>('/api/mobile/social/recent');this.recentPlayers=Array.isArray(data.players)?data.players:[];this.invalidate();}catch{}}
 private ago(at:number){const minutes=Math.max(1,Math.round((Date.now()-at)/60000));return minutes<60?minutes+' 分钟前':minutes<1440?Math.round(minutes/60)+' 小时前':Math.round(minutes/1440)+' 天前';}
 private async requestFriend(code:string){await this.run(async()=>{await this.client.post('/api/mobile/social/requests',{code,requestId:this.platform.randomId()});await this.social.refresh();await this.loadRecentPlayers();this.note('好友申请已发送');});}
 private async respondFriend(code:string,accept:boolean){await this.run(async()=>{await this.client.post('/api/mobile/social/requests/respond',{code,accept,requestId:this.platform.randomId()});await this.social.refresh();this.note(accept?'已成为好友':'已忽略申请');});}
 private openConversation(code:string){this.showModal('social');this.social.openConversation(code);}
 private drawFriends(){return drawFriendsPanel.call(this.host);}
 private loadingStarted=0;private loadingShown=0;private loadingDone=0;private loadingFrom=0;
 /** Full-screen start-up: logo, progress and rotating tips. Progress follows the real steps and eases in between. */
 private drawLoading(){return drawLoadingPanel.call(this.host);}
 private drawLobbyStartup(){return drawLobbyStartupPanel.call(this.host);}
 private copyInvitationCode(code:string){if(!this.platform.copyText){this.note('邀请码：'+code);return;}void this.platform.copyText(code).then(ok=>this.note(ok?'已复制邀请码 '+code:'复制失败，请手动记下邀请码 '+code));}
 /** Headers draw beside the nav rail in local coordinates, but keep the same screen right edge. */
 /** Right-edge items end left of TapTap's ••• capsule; rows are never pushed below it (portrait since v31). */
 private menuReserve(row:Rect){const view=this.currentViewport(),menu=view.menu;return menu&&row.y<menu.y+menu.h&&menu.y<row.y+row.h?Math.max(0,view.width-menu.x+8):0;}
 // Puzzle rooms get the same visible top gap as the lobby header (inset + 12).
 private roomHeaderTop(){if(this.layout==='phoneLandscape'&&this.platform.config.id!=='web')return this.currentViewport().top+6;return this.headerSafeTop()+(this.platform.config.id==='web'?0:12);}
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
 private headerSafeTop(){const view=this.currentViewport();return this.platform.config.id==='web'?view.top:view.top+2;}
 private drawHeader(){
  const s=this.stage,p=this.client.profile,safe=this.route==='lobby'||this.route==='chapter'?this.headerSafeTop():this.currentViewport().top,top=safe+12+(this.formalWeb?23:0),wide=s.w>=640&&s.h>560,small=s.w<360,reserve=this.menuReserve({x:0,y:top,w:s.w,h:wide?74:56});
  if(this.formalWeb){s.text('测试版',13,safe+7,10,this.colors.muted);this.drawWebLinks(Math.max(75,s.w-224),safe+7,Math.min(212,s.w-87));}
  if(this.platform.config?.id==='wechat'&&safe>=30)s.text(this.platform.config.gameName,14,safe-26,13,this.colors.ink,700,Math.max(100,s.w-160));
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
   else{const ex=12+playerWidth+4,tight=reserve>0&&this.layout==='phonePortrait',orientation=this.canRotate&&!tight,taskX=s.w-(tight?40:76)-(orientation?48:0)-reserve,right=this.route==='lobby'?taskX-8:s.w-(orientation?60:50)-reserve;energy(ex,y+(h-43)/2,Math.min(220,right-ex),wide?22:small?14:16);s.icon('sprig',{x:s.w-30-reserve,y:y-14,w:18,h:18});if(this.route==='lobby')this.drawLobbyTasks({x:taskX,y:y+(h-40)/2,w:tight?34:64,h:40},tight);if(orientation)s.button({x:s.w-52-reserve,y:y+(h-40)/2,w:40,h:40},'',()=>void this.toggleOrientation(),{icon:'orientation'});}
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
  const s=this.stage,view=this.currentViewport(),size=13,w=Math.min(s.w-24,340,Math.max(136,s.measure(this.message.replace(/\n/g,' '),size,600)+52)),textWidth=w-52,lines:string[]=[];
  let line='';for(const char of this.message){if(char==='\n'||s.measure(line+char,size,600)>textWidth){lines.push(line);line=char==='\n'?'':char;}else line+=char;}if(line)lines.push(line);
  const shown=lines.slice(0,3);if(lines.length>3){let last=shown[2];while(last&&s.measure(last+'…',size,600)>textWidth)last=last.slice(0,-1);shown[2]=last+'…';}
  const h=Math.max(35,shown.length*19+16),x=(s.w-w)/2,y=Math.max(view.top+10,this.platform.config.id==='taptap'?44:0)+(this.busy?34:0);this.noticeBottom=y+h;s.ctx.save();s.ctx.globalAlpha=.94;s.ctx.fillStyle='#573b40';s.ctx.fillRect(x,y,w,h);s.ctx.restore();
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
 private drawLobby(){return drawLobbyPanel.call(this.host);}
 private lobbyColumn(){return this.listColumn;}
 // Offline mode draws the bundled chapter with its own levels view.
 private drawChapter(chapter=this.selectedChapter,view=this.storyView){return drawChapterPanel.call(this.host,chapter,view);}
 private preloadComicPage(comic:Comic|null){
  if(!comic?.page)return;
  const src=this.client.asset(comic.page.src),thumb=this.client.asset(comic.page.thumbSrc);this.stage.preloadComicImage(src,thumb);return {src,thumb};
 }
 /** Synchronous entry, also used by offline play. No refresh or API request. */
 openLevelComic(levelId:string,options:{sequence?:boolean;fromClear?:boolean}={}){return openLevelComicPanel.call(this.host,levelId,options);}
 private releaseComicBack(){const off=this.comicBack;this.comicBack=undefined;off?.();}
 private stopStoryFrame(){if(this.storyFrame!=null)this.platform.cancelFrame?.(this.storyFrame);this.storyFrame=null;}
 private animateStory(){
  if(this.storyFrame!=null||this.destroyed||this.hidden||!this.platform.frame)return;
  this.storyFrame=this.platform.frame(()=>{this.storyFrame=null;if(this.destroyed||this.hidden)return;if(this.modal==='levelComic'||this.storyIntro)this.invalidate();});
 }
 private turnComic(index:number){return turnComicPanel.call(this.host,index);}
 private advanceComic(all=false){return advanceComicPanel.call(this.host,all);}
 private drawLevelComic(){return drawLevelComicPanel.call(this.host);}
 private snapComicBack(){
  this.comicSnap=this.comicDrag&&!reducedComicMotion()?{started:Date.now(),offset:this.comicDrag}:undefined;
  if(!this.comicSnap)this.comicDrag=0;this.invalidate();
 }
 /** Lock the dominant axis after 16px; a drag never also becomes a tap. */
 private inputComic(input:Input){return inputComicPanel.call(this.host,input);}
 private beginStoryIntro(levelId:string|undefined){return beginStoryIntroPanel.call(this.host,levelId);}
 /** The 回忆变奏关 of a story room this player has to themselves; daily, gallery and shared rooms stay normal. */
 private storyRoomVariant(ticket:RoomTicket,room:RoomClient):StoryVariant|null{return storyRoomVariantPanel.call(this.host,ticket,room);}
 /** Someone else came into this story room: the level carries on as a normal one. */
 private checkVariantCompany(room:RoomClient){
  if(this.room!==room||!this.roomVariant||!this.board||room.snapshot.completedAt||!otherPlayersPresent(room.snapshot,room.ticket.playerId))return;
  this.roomVariant=null;this.board.suspendVariant();this.note('有伙伴加入，这一关改为普通玩法');
 }
 private drawStoryIntro(){return drawStoryIntroPanel.call(this.host);}
 private get continueRoom(){return this.historyRooms?.find(room=>!room.completed&&!room.unavailable)??null;}
 private dailyNow(){return Date.now()+this.serverOffset;}
 private get dailyLabel(){const day=new Date(this.dailyNow()+8*3600000);return '今日拼图 · '+(day.getUTCMonth()+1)+'月'+day.getUTCDate()+'日';}
 // The daily changes at Beijing midnight (the daily schedule only accepts Asia/Shanghai).
 private get dailyLeft(){const now=this.dailyNow(),next=(Math.floor((now+8*3600000)/86400000)+1)*86400000-8*3600000,minutes=Math.max(1,Math.ceil((next-now)/60000)),hours=Math.floor(minutes/60);return '还剩 '+(hours?hours+' 小时 '+minutes%60+' 分':minutes+' 分钟');}
 private heroTextHeight(compact:boolean){const photo=this.dailyPhoto,description=typeof (photo as {description?:unknown}|null)?.description==='string';return compact?8+16+20+6+34+10:10+18+28+8+(description?20:0)+40+12;}
 private launchDaily(){void this.launch({mode:'daily',pieces:108,visibility:'public'});}
 // The invite flow shares the current room, so the daily table is opened first.
 private async inviteToDaily(){await this.launch({mode:'daily',pieces:108,visibility:'public'});if(this.room)this.showModal('invite');}
 private drawDailyHero(r:Rect,compact:boolean){return drawDailyHeroPanel.call(this.host,r,compact);}
 private drawContinueRoom(room:MobileOwnedRoom,r:Rect){return drawContinueRoomPanel.call(this.host,room,r);}
 private quickJoin(){
  const open=this.rooms.filter(room=>room.players<seatLimit(room)&&room.acceptingNew!==false&&!room.completed),progress=(room:RoomListing)=>room.placed/Math.max(1,room.actualPieces??room.pieces);
  const best=open.filter(room=>progress(room)<.9).sort((a,b)=>progress(b)-progress(a))[0];
  if(best)void this.enterRoom(best.id);else void this.launch({mode:'random',pieces:this.pieces,visibility:'public',direction:this.direction});
 }
 private drawLobbyActions(r:Rect){return drawLobbyActionsPanel.call(this.host,r);}
 private get lobbyRooms(){
  const pieces=(room:RoomListing)=>room.actualPieces??room.pieces,open=(room:RoomListing)=>room.players<seatLimit(room)&&room.acceptingNew!==false&&!room.completed;
  const completed=this.lobbyUnplayedOnly?this.completedPhotoIds():null;
  const rooms=this.rooms.filter(room=>(this.lobbyPieces==='small'?pieces(room)<=108:this.lobbyPieces==='large'?pieces(room)>=300:true)&&(!completed||!room.imageId||!completed.has(room.imageId)));
  return [...rooms.filter(open),...rooms.filter(room=>!open(room))];
 }
 private setLobbyChip(change:()=>void){const before=JSON.stringify([this.direction,this.filterCount,this.lobbyPieces]);change();if(JSON.stringify([this.direction,this.filterCount,this.lobbyPieces])===before)return;this.scroll=0;this.lobbySerial++;this.rooms=[];this.lobbyCursor=null;void this.loadLobby();this.invalidate();}
 private drawRoomHeader(x:number,y:number,w:number,compact:boolean){return drawRoomHeaderPanel.call(this.host,x,y,w,compact);}
 private drawChips(x:number,y:number,w:number,h:number,chips:readonly(readonly[string,boolean,()=>void])[],fill=false){return drawChipsPanel.call(this.host,x,y,w,h,chips,fill);}
 private drawRoomSection(x:number,y:number,w:number,columns:number,top:number,bottom:number){return this.drawRoomGrid(x,this.drawRoomHeader(x,y,w,false),w,columns,top,bottom);}
 private drawRoomGrid(x:number,y:number,w:number,columns:number,top:number,bottom:number){return drawRoomGridPanel.call(this.host,x,y,w,columns,top,bottom);}
 private drawRoomCard(room:RoomListing,r:Rect,completed?:Set<string>){return drawRoomCardPanel.call(this.host,room,r,completed);}
 private drawGallery(){return drawGalleryPanel.call(this.host);}
 private galleryPack(id:string){return this.collection?.packs.find(pack=>pack.imageIds.includes(id))??collectionCatalog.packs.find(pack=>pack.imageIds.includes(id))??null;}
 private photoTag(id:string,owned:Set<string>){if(this.freeGalleryIds?.has(id))return {label:'免费',tone:'free'};if(owned.has(id))return {label:'已拥有',tone:'owned'};const pack=this.galleryPack(id);if(pack&&(pack as CollectionPack).unlock==='ad'){const full=this.collection?.packs.find(item=>item.id===pack.id),img=full?.images.find(item=>item.id===id),req=img?.adRequired??full?.adRequired??2,prog=img?.adProgress??0;return {label:prog>0?'看广告解锁 '+prog+'/'+req:'看'+req+'次广告解锁',tone:'locked',ad:true,price:0};}if(pack)return {label:'图包「'+pack.title+'」',tone:'locked',price:pack.price};return {label:this.client.profile?.firstSelectionAvailable?'首次免费':'建房券',tone:'free'};}
 private drawPhotoCard(photo:SharedPhoto,r:Rect,imageHeight:number,owned:Set<string>,completed?:Set<string>){return drawPhotoCardPanel.call(this.host,photo,r,imageHeight,owned,completed);}
 private createPanelHeight(sheet:boolean){const rooms=this.selected?this.rooms.filter(room=>room.imageId===this.selected).length:0;return 14+64+12+(sheet?32:58)+8+(sheet?32:58)+8+(rooms?26:0)+(this.usesCreationTickets?42:0)+46+14;}
 private drawCreatePanel(r:Rect,photo:SharedPhoto|null,owned:Set<string>,sheet:boolean){return drawCreatePanelView.call(this.host,r,photo,owned,sheet);}
 private drawPictureButton(r:Rect,label:string,fn:()=>void,tone='cream',icon='',fontSize=11,iconSize=16,disabled=false,selected=false){return drawPictureButtonPanel.call(this.host,r,label,fn,tone,icon,fontSize,iconSize,disabled,selected);}
 private drawTasks(inWindow=false){return drawTasksPanel.call(this.host,inWindow);}
 private supplyFocus=false;
 private async openAllGifts(){
  const gifts=(this.tasks?.inventory??[]).filter(gift=>gift.count>0&&this.giftVisible(gift)&&!(this.energyEnabled&&gift.effect==='full-energy'));
  if(!gifts.length){this.note('补满体力包请按需单个开启');return;}
  await this.openGiftItems(gifts.map(gift=>({kind:gift.kind,count:gift.count})),true);
 }
 private drawTasksPage(){return drawTasksPagePanel.call(this.host);}
 private drawSupplies(){return drawSuppliesPanel.call(this.host);}
 private drawWebSupplies(){return drawWebSuppliesPanel.call(this.host);}
 private albumDetailOpen=false;private decorationFilter:'all'|'owned'|'craft'|'album'='all';
 private drawCollection(){return drawCollectionPanel.call(this.host);}
 private packFor(data:MobileCollectionView,albumId:string){return data.packs.find(pack=>pack.id===albumId)??null;}
 /** 日常拾光 (the album without a pack) first, then the packs in catalogue order. */
 private orderedAlbums(data:MobileCollectionView){return [...data.albums.filter(album=>!this.packFor(data,album.id)),...data.albums.filter(album=>this.packFor(data,album.id))];}
 private nextMilestoneText(data:MobileCollectionView,album:CollectionAlbum){
  const next=album.milestones.find(milestone=>!milestone.earned);if(!next)return album.total&&album.collected>=album.total?'已集齐，奖励已发放':'';
  const decoration=next.decorationId?data.decorations.find(item=>item.id===next.decorationId)?.title:'',left=Math.max(0,next.target-album.collected);
  return next.target>=album.total?'集齐送 '+next.coins+' 金币'+(decoration?'和'+decoration:''):'再拼 '+left+' 张得 '+next.coins+' 金币'+(decoration?'和'+decoration:'');
 }
 private openAlbum(id:string){this.albumId=id;this.albumDetailOpen=true;this.albumListScroll=0;if(!this.desktop)this.scroll=0;this.invalidate();}
 private drawAlbumCard(data:MobileCollectionView,album:CollectionAlbum,r:{x:number;y:number;w:number},selected:boolean,compact=false){return drawAlbumCardPanel.call(this.host,data,album,r,selected,compact);}
 private drawAlbumHeader(data:MobileCollectionView,album:CollectionAlbum,x:number,y:number,w:number,compact=false){return drawAlbumHeaderPanel.call(this.host,data,album,x,y,w,compact);}
 private drawAlbumRewards(data:MobileCollectionView,album:CollectionAlbum,x:number,y:number,w:number,compact=false){return drawAlbumRewardsPanel.call(this.host,data,album,x,y,w,compact);}
 private albumImageGridHeight(album:CollectionAlbum,w:number,columns:number){const cw=(w-12*(columns-1))/columns;return Math.ceil(album.images.length/columns)*(cw*.72+78);}
 private drawAlbumImages(album:CollectionAlbum,x:number,y:number,w:number,columns:number){return drawAlbumImagesPanel.call(this.host,album,x,y,w,columns);}
 private drawAlbumDetail(data:MobileCollectionView,album:CollectionAlbum,x:number,y:number,w:number,columns:number){return drawAlbumDetailPanel.call(this.host,data,album,x,y,w,columns);}
 private playImage(id:string){
  if(!this.availableGallery().some(photo=>photo.id===id)){this.note('这张图会出现在每日拼图里，留意大厅的今日拼图');return;}
  this.navigate('gallery',{source:'all',category:'全部',direction:'all',search:'',unplayedOnly:false,packId:null});this.selected=id;this.invalidate();
 }
 private drawDecorations(data:MobileCollectionView){return drawDecorationsPanel.call(this.host,data);}
 /** 治愈时光-style albums unlock picture by picture after a rewarded ad; coin packs keep the purchase modal. */
 private packOfferLabel(pack:CollectionPack){return pack.unlock==='ad'?'看广告解锁':pack.price+' 解锁';}
 private openPackOffer(pack:CollectionPack){if(pack.unlock==='ad')this.openPackPreview(pack);else{this.purchase=pack;this.showModal('purchase');}}
 private openPackPreview(pack:CollectionPack){if(!pack.images.length)return;this.previewReadOnly=false;this.previewPack=pack;this.previewIndex=-1;this.previewGridScroll=0;this.stage.retryImages();this.showModal('packPreview');}
 private returnToPackGrid(){if(this.previewReadOnly){this.showModal(null);return;}this.previewIndex=-1;this.modalScroll=this.previewGridScroll;this.invalidate();}
 private stepPackPreview(delta:number){if(!this.previewPack)return;this.previewIndex=clamp(this.previewIndex+delta,0,this.previewPack.images.length-1);this.modalScroll=0;this.invalidate();}
 private drawPackPreview(){return drawPackPreviewPanel.call(this.host);}
 private drawPolicy(){return drawPolicyPanel.call(this.host);}

 private drawRoom(){return drawRoomPanelView.call(this.host);}
 private drawCompletionTransition(){return drawCompletionTransitionPanel.call(this.host);}
 private drawSettleButton(){return drawSettleButtonPanel.call(this.host);}
 private roomZoomBase=1;
 private placeBoard(board:PuzzleBoard,topInset:number,fit:()=>void){
  board.phoneLandscapeRoom=this.platform.config.id!=='web'&&this.layout==='phoneLandscape';
  board.selfDecoration=this.client.profile?.collection?.equipped??null;board.previewTopInset=topInset;
  // The closed landscape tool toggle sits in the top-right corner, so the thumbnail starts below it.
  // Landscape keeps 锁定 under the corner tool toggle; the 原图 thumbnail then moves up, left of that column.
  const lockColumn=board.phoneLandscapeRoom&&this.lockButtonEnabled;board.previewThumbShift=lockColumn?54:0;board.minimapBelowReserve=board.phoneLandscapeRoom?60:0;
  board.previewThumbInset=board.phoneLandscapeRoom&&!this.landscapeToolsOpen&&!lockColumn?this.roomHeaderTop()+101:null;board.minimapEnabled=this.minimapEnabled&&this.layout!=='desktop';board.setRect(this.roomArea);
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
  if(kind==='edge')board.edgeOnly=!board.edgeOnly;else if(kind==='hint'||kind==='underlay'){const grant=this.activeAid(kind);if(kind==='hint'&&grant?.lasting)this.useLastingAid(kind);else if(!this.assistanceUnavailable(kind))void this.activateAssistance(kind);}else if(kind==='fit')this.fitRoom();else if(kind==='locate')this.locateLoose();
  else if(kind==='orientation')void this.toggleOrientation();else if(kind==='organize'&&this.soloRoom){
   // The first tap (or R) only arms it: the tools stay open with 整理 lit, and a second tap within 3 s reshuffles.
   if(Date.now()>this.organizeArmedUntil){this.organizeArmedUntil=Date.now()+ORGANIZE_CONFIRM_MS;this.note('再点一次「整理」，会把所有散片重新铺开');setTimeout(()=>{if(!this.destroyed)this.invalidate();},ORGANIZE_CONFIRM_MS+16);this.invalidate();return;}
   this.organizeArmedUntil=0;void this.run(async()=>{await this.room?.organize();this.note('散片已整理');});
  }else if(kind==='chat')this.showModal('chat');else if(kind==='more')this.showModal('tools');
  this.toolsOpen=false;this.invalidate();
 }
 /** Tapping an open lasting hint costs nothing and highlights its pieces again. */
 private useLastingAid(kind:'hint'){
  const board=this.board;if(!board||!this.room)return;
  if(kind==='hint'){board.locateHints(this.roomLocateInsets());this.note('提示的拼块已标出，拼好后可以再要新的提示');}
 }
 private aidBadge(kind:'hint'|'underlay'){const grant=this.activeAid(kind);return !grant?'':kind==='hint'&&grant.lasting?'已开启':Math.max(1,Math.ceil((grant.expiresAt-Date.now())/1000))+'秒';}
 private get soloRoom(){return this.room?.snapshot.visibility==='solo';}
 /** Outside Web the fit slot locates loose pieces; fitting the whole table stays under 更多. */
 private get roomTools(){return ([['edge','边缘','E'],['hint','提示','H'],['underlay','底图','B'],this.platform.config.id==='web'?['fit','适配','F']:['locate','定位','L'],['organize','整理','R']] as const).filter(([kind])=>kind!=='organize'||this.soloRoom);}
 private locateLoose(){
  const board=this.board;if(!board)return;
  const count=board.locateLoose(this.roomLocateInsets());
  this.note(count?'已标出 '+count+' 块未拼的拼块'+(board.edgeOnly?'（边缘筛选中）':''):board.edgeOnly?'边缘拼块都已归位，关闭边缘筛选可找其余拼块':'所有拼块都已归位');
 }
 private roomLocateInsets(){const layout=this.layout;return layout==='desktop'?{bottom:56,left:this.desktopToolsOpen?104:72}:layout==='phoneLandscape'?{top:this.roomHeaderTop()+56-this.roomArea.y,bottom:8}:{bottom:72};}
 private toolActive(kind:string){return kind==='organize'?Date.now()<=this.organizeArmedUntil:kind==='edge'?!!this.board?.edgeOnly:kind==='locate'?!!this.board?.locating:kind==='hint'||kind==='underlay'?!!this.activeAid(kind):false;}
 private drawAidBadge(kind:string,right:number,y:number){
  if(kind!=='hint'&&kind!=='underlay')return;const s=this.stage,c=s.ctx,active=this.activeAid(kind),free=this.aid?.freeRemaining?.[kind]??0,pending=!this.aid||this.busy;
  const badge=active?this.aidBadge(kind):pending?'读取中':this.aid?.newcomerProtected?'新手免费':free>0?'免费'+free+'次':'看广告',ad=!active&&!pending&&!this.aid?.newcomerProtected&&free===0,bw=s.measure(badge,10,600)+8,bx=right-bw;
  c.fillStyle=s.color(ad?'#ba667e':active?'#fae7b8':pending?'#eee7db':'#f2efd8');c.fillRect(bx,y,bw,16);s.text(badge,bx+4,y+2,10,ad?'#fffaf0':active?'#83542f':'#7a7244',600,bw-6);
 }
 private roomIcon(kind:string){return kind==='orientation'?'orientation':kind==='organize'?'piece':kind==='more'?'tools':kind==='chat'?'chat':kind;}
 private drawDesktopTools(x:number,y:number,safeBottom:number){return drawDesktopToolsPanel.call(this.host,x,y,safeBottom);}
 private drawToolColumn(r:Rect){return drawToolColumnPanel.call(this.host,r);}
 /** Coordinates are Stage logical pixels, so the host's UI scale also scales this chrome and its hits. */
 private drawLandscapeSurface(r:Rect,radius:number,fill:string,border?:string,width=0,shadow=0){return drawLandscapeSurfacePanel.call(this.host,r,radius,fill,border,width,shadow);}
 private drawLandscapeButton(r:Rect,label:string,action:()=>void,fill:string,size:number){return drawLandscapeButtonPanel.call(this.host,r,label,action,fill,size);}
 private setLandscapeToolsOpen(open:boolean){
  if(this.landscapeToolsOpen===open)return;this.clearRoomPointer();this.landscapeToolsOpen=open;this.platform.storage.set('jigsaw:landscape-tools-open:v1',open?'1':'0');this.roomViewPending=true;this.invalidate();
 }
 private setDesktopToolsOpen(open:boolean){
  if(this.desktopToolsOpen===open)return;this.clearRoomPointer();this.desktopToolsOpen=open;this.platform.storage.set('jigsaw:desktop-tools-open:v1',open?'1':'0');this.invalidate();
 }
 private roomToolsArea:Rect={x:0,y:0,w:0,h:0};private roomMembersArea:Rect={x:0,y:0,w:0,h:0};
 private get chatUnread(){return this.messages.filter(message=>message.id>this.chatSeen&&message.code!==this.client.profile?.code&&!this.social.blockedCodes.includes(message.code)).length;}
 private drawRoomTopBar(r:Rect,mode:'desktop'|'portrait'|'landscape'){return drawRoomTopBarPanel.call(this.host,r,mode);}
 private chatBubble:{message:PublicMessage;until:number}|null=null;private bubbleSeen=-1;private bubbleArmTimer:ReturnType<typeof setTimeout>|null=null;private organizeArmedUntil=0;
 private landscapeChatVisible=false;
 private viewLocked=false;private lockButtonEnabled=false;private minimapEnabled=false;
 /** The corner map is opt-in under 更多 and only shows while zoomed in. */
 private setMinimapEnabled(enabled:boolean){
  this.minimapEnabled=enabled;try{this.platform.storage.set(MINIMAP_KEY,enabled?'1':'0');}catch{}
  this.note(enabled?'已打开小地图：放大后左上角显示全桌，点小地图可直接跳过去':'已关闭小地图');this.invalidate();
 }
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
 /** Portrait quick tools (锁定) sit in the bottom bar between 任务 (its tap area ends at x 151) and the ⊞ button,
  * about 57% across and level with ⊞, so they never cover the table or the tray above the bar. */
 private portraitQuickSlot(width:number,safeBottom:number){return{x:Math.round(Math.max(151+12,Math.min(width*.57-23,width-63-12-46))),bottom:safeBottom-9};}
 /** Landscape phone room: the tray lies along the bottom, so the gift goes up under the corner map (or the back button)
  * and 锁定 under the corner tool toggle; the chat bubble sits above an open tray. */
 private drawLandscapeRoomControls(board:PuzzleBoard,headerTop:number,safeBottom:number){return drawLandscapeRoomControlsPanel.call(this.host,board,headerTop,safeBottom);}
 private drawBoardQuickTools(x:number,bottom:number){return drawBoardQuickToolsPanel.call(this.host,x,bottom);}
 private drawChatBubble(y:number){return drawChatBubblePanel.call(this.host,y);}
 /** The bubble's tap area arms CHAT_BUBBLE_ARM_MS after it appears (until-5000), so a bubble popping up under a finger that is
  * reaching for a piece does not open the chat; a redraw is scheduled for the moment it arms. */
 private bubbleHit(bubble:{until:number},r:Rect){
  const wait=bubble.until-5000+CHAT_BUBBLE_ARM_MS-Date.now();
  if(wait<=0){this.stage.hit(r,()=>this.showModal('chat'));return;}
  if(!this.bubbleArmTimer)this.bubbleArmTimer=setTimeout(()=>{this.bubbleArmTimer=null;if(!this.destroyed)this.invalidate();},wait+16);
 }
 private drawRoomGift(x:number,y:number,label:boolean){return drawRoomGiftPanel.call(this.host,x,y,label);}
 private drawZoomControl(x:number,y:number){return drawZoomControlPanel.call(this.host,x,y);}
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
 private drawPlayerCard(){return drawPlayerCardPanel.call(this.host);}
 private drawRoomPanel(r:Rect){return drawRoomSidePanel.call(this.host,r);}
 private drawReconnectBanner(room:RoomClient){return drawReconnectBannerPanel.call(this.host,room);}
 private roomGuideStep=0;
 private roomGuideSeen(){try{return this.platform.storage.get('jigsaw:room-guide:v1')==='done';}catch{return true;}}
 private finishRoomGuide(){this.roomGuideStep=0;try{this.platform.storage.set('jigsaw:room-guide:v1','done');}catch{}this.invalidate();}
 private drawRoomGuide(){return drawRoomGuidePanel.call(this.host);}
 private drawNineGrid(){return drawNineGridPanel.call(this.host);}
 private drawRoomChatEntry(members:number,unread:number,floating:boolean){return drawRoomChatEntryPanel.call(this.host,members,unread,floating);}
 private assistanceUnavailable(_kind:'hint'|'underlay'){return false;}
 private drawRoomToolToggle(toggle:Rect,open:boolean,change:()=>void){return drawRoomToolTogglePanel.call(this.host,toggle,open,change);}
 private drawRoomTools(toggle:Rect,landscape:boolean){return drawRoomToolsPanel.call(this.host,toggle,landscape);}


 private drawPublicChat(){return drawPublicChatPanel.call(this.host);}

 private drawTaskWindow(){return drawTaskWindowPanel.call(this.host);}
 private stopCheers(){if(this.cheerFrame!==null)this.platform.cancelFrame(this.cheerFrame);this.cheerFrame=null;this.cheerEffects.clear();}
 private animateCheers(){
  if(this.cheerFrame!==null||this.hidden||this.destroyed||this.modal!=='completion')return;
  this.invalidate();this.cheerFrame=this.platform.frame(()=>{this.cheerFrame=null;if(this.modal!=='completion'||this.hidden||this.destroyed)return;const alive=this.cheerEffects.alive();this.invalidate();if(alive)this.animateCheers();});
 }
 private sendCompletionCheer(emote:CheerEmote){if(this.cheersEnabled&&this.modal==='completion'&&this.room?.snapshot.members.some(member=>member.id===this.room!.ticket.playerId&&member.lastSeen>0))this.cheer?.send(emote);}
 private completionSeats(){const snap=this.room?.snapshot;return completionSeats(snap?.members??[],(snap as typeof snap&{mobileResult?:{ranking?:Parameters<typeof completionSeats>[1]}})?.mobileResult?.ranking,this.room?.ticket.playerId??'',this.client.profile?.code,seatLimit(snap));}
 private landscapeSeatWidth(available:number){return Math.max(120,Math.min(140,(available-500)/2));}
 private completionOutsideSeats(x:number,w:number){return this.desktop&&x>=194&&this.stage.w-x-w>=194;}
 private drawCompletionSeat(seat:CompletionSeat,r:Rect,vertical=false){return drawCompletionSeatPanel.call(this.host,seat,r,vertical);}
 private drawCompletionSeats(panel:Rect){return drawCompletionSeatsPanel.call(this.host,panel);}
 private drawCompletionPicture(r:Rect){return drawCompletionPicturePanel.call(this.host,r);}
 private drawCompletionBar(r:Rect){return drawCompletionBarPanel.call(this.host,r);}
 private drawCompletionContent(left:number,cy:number,width:number,landscape=false,panel?:Rect){return drawCompletionContentPanel.call(this.host,left,cy,width,landscape,panel);}
 private drawLandscapeCompletion(){return drawLandscapeCompletionPanel.call(this.host);}
 private drawCompletionEffects(){return drawCompletionEffectsPanel.call(this.host);}
 /** Arms the greeting after a plain login (no invite link); the lobby or story page shows it once the orientation picker and 七日礼 are done. */
 private armWelcome(){
  const skip=!this.welcomeEnabled?'设置里已关闭':this.platform.config.id!=='taptap'?'':this.brandNewPlayer?'新手账号':'';
  if(!this.welcomeEnabled||this.platform.config.id!=='taptap'||this.brandNewPlayer){if(skip)this.retentionNote('问候 · 不弹出：'+skip);return;}
  let record;try{record=readWelcomeRecord(this.platform.storage.get(WELCOME_STORAGE_KEY));}catch{this.retentionNote('问候 · 本机存储不可读');return;}
  this.welcomeLastVisit=record?.visit??null;this.welcomePending=true;this.maybeWelcome();
 }
 private maybeWelcome(){
  if(!this.welcomePending)return;
  // Players who still have story 1 left land on the chapter page at login; greet them there too.
  if(this.route!=='lobby'&&this.route!=='chapter'||this.room||this.destroyed){this.welcomePending=false;this.retentionNote('问候 · 不弹出：已进入'+(this.room?'房间':this.route));return;}
  if(this.modal||this.busy||!this.ready||this.hidden||this.weeklyGiftHolds())return;
  this.welcomePending=false;
  // 问候按设备的北京时间；dailyNow() 是为 20 点换新提前 4 小时的每日拼图时钟，不能用来说「晚上好」。
  const now=Date.now();let record;try{record=readWelcomeRecord(this.platform.storage.get(WELCOME_STORAGE_KEY));}catch{return;}
  const save=(value:object)=>{try{this.platform.storage.set(WELCOME_STORAGE_KEY,JSON.stringify(value));}catch{}};
  if(!welcomeDue(record,now)){if(record)save({...record,visit:now});this.retentionNote('问候 · 不弹出：'+(record&&record.key===welcomeSlotKey(now)?'这个时段已问候过':'距上次问候不到3小时'));return;}
  this.retentionNote('问候 · 弹出');
  const slot=welcomeSlot(now),p=this.client.profile,daily=this.dailyPhoto?.id;
  const chapter=this.availableChapters.find(item=>item.levels.some(level=>level.status==='unlocked'));
  const tie=welcomeTieIn({now,lastVisit:this.welcomeLastVisit,dailyFinished:!!daily&&!!this.historyRooms?.some(room=>room.completed&&room.imageId===daily),
   story:chapter?{title:chapter.title,left:chapter.levels.filter(level=>level.status!=='cleared').length}:null,energyFull:this.energyEnabled&&!!p&&p.energyCap>0&&p.energy>=p.energyCap});
  const line=tie?.line??pickWelcomeLine(slot,record?.line??'');
  save({at:now,key:welcomeSlotKey(now),line,visit:now});
  this.welcome={slot,line,tie,openedAt:Date.now(),storyChapterId:tie?.kind==='story'?chapter?.id??null:null};
  this.showModal('welcome');
 }
 private closeWelcome(){if(this.welcomeFrame!=null)this.platform.cancelFrame?.(this.welcomeFrame);this.welcomeFrame=null;this.welcome=null;if(this.modal==='welcome')this.showModal(null);}
 private setWelcomeEnabled(enabled:boolean){this.welcomeEnabled=enabled;try{this.platform.storage.set(WELCOME_ENABLED_KEY,enabled?'1':'0');}catch{}if(!enabled)this.welcomePending=false;this.invalidate();}
 private welcomePrimary(){
  const view=this.welcome;this.closeWelcome();
  if(view?.storyChapterId){this.storyChapterId=view.storyChapterId;this.navigate('chapter');return;}
  // The table the player already sits at, else an open daily table, else a new daily table.
  const own=this.historyRooms??this.client.profile?.ownedRooms??[],start=welcomeStart({own,rooms:this.rooms,dailyImageId:this.dailyPhoto?.id??null});
  if(start.kind==='create')this.launchDaily();else void this.enterRoom(start.roomId);
 }
 /** Today's daily picture tinted for the time of day; without the picture the tint sits on the placeholder. */
 private drawWelcomeHero(r:Rect,slot:WelcomeSlot){return drawWelcomeHeroPanel.call(this.host,r,slot);}
 /** The lobby's chibi friend art without its add-friend badge. */
 private drawWelcomeArt(r:Rect){return drawWelcomeArtPanel.call(this.host,r);}
 private drawWelcome(){return drawWelcomePanel.call(this.host);}
 private drawOrientationPicker(){return drawOrientationPickerPanel.call(this.host);}
 private drawModal(){
  if(this.modal==='orientation'){this.drawOrientationPicker();return;}
  if(this.modal==='welcome'){this.drawWelcome();return;}
  if(this.modal==='levelComic'){this.drawLevelComic();return;}
  if(this.modal==='completion'&&this.layout==='phoneLandscape'){this.drawLandscapeCompletion();return;}
  if(this.modal==='playerCard'){this.drawPlayerCard();return;}
  if(this.modal==='history'){this.drawHistoryWindow();return;}
  if(this.modal==='tasks'){this.drawTaskWindow();return;}
  if(this.modal==='weeklyGift'){this.drawWeeklyGift();return;}
  if(this.modal==='redeem'){this.drawRedeem();return;}
  if(this.modal==='chat'){this.drawPublicChat();return;}
  if(this.modal==='packPreview'){this.drawPackPreview();return;}
  const s=this.stage,currencyHelp=this.modal==='coins'||this.modal==='fragments',v=this.currentViewport(),w=Math.min(s.w-24,currencyHelp?440:this.modal==='completion'?560:540),x=(s.w-w)/2,h=currencyHelp?Math.min(520,s.h-v.top-v.bottom-39):s.h-Math.max(v.top+15,s.h*.1)-v.bottom-24,y=currencyHelp?v.top+15+(s.h-v.top-v.bottom-39-h)/2:Math.max(v.top+15,s.h*.1);
  s.ctx.fillStyle=this.colors.overlay;s.ctx.fillRect(0,0,s.w,s.h);s.hit({x:0,y:0,w:s.w,h:s.h},()=>{});s.panel({x,y,w,h});
  const titles:Record<Exclude<Modal,null>,string>={weeklyGift:'七日礼',levelComic:'小窝的故事',orientation:'选择屏幕方向',welcome:'欢迎回家',members:'同桌玩家',playerCard:'玩家名片',privacyRequests:'个人资料申请',redeem:'兑换码',coins:'金币说明',fragments:'装饰碎片说明',tasks:'任务与礼包',albums:'选择相册',filters:this.route==='gallery'?'筛选图片':'筛选房间',settings:'玩家与设置',history:'历史拼图',manage:this.formalWeb?'我的房间':'自己的房间',invite:'邀请好友',tools:'拼图工具',chat:'同桌交流',social:this.social.title,completion:'拼图完成',purchase:'解锁主题图包',packPreview:this.previewPack?.title??'图包预览'};
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
    if(this.route==='lobby'){
     s.text('拼图片数',left,cy,14,this.colors.ink,700);cy+=30;this.rowOptions([[0,'不限'],...this.pieceCounts.map(n=>[n,n+'片'] as const)],this.filterCount,left,cy,width,n=>{this.filterCount=n;if(n)this.lobbyPieces='all';this.invalidate();});cy+=51;
     this.button(left,cy,width,(this.lobbyUnplayedOnly?'✓ ':'')+'只看未拼过的图片',()=>{this.lobbyUnplayedOnly=!this.lobbyUnplayedOnly;if(this.lobbyUnplayedOnly&&!this.completedGalleryIds)void this.loadGallery();this.invalidate();},this.lobbyUnplayedOnly?'berry':'cream');cy+=47;
     this.button(left,cy,width,(this.openOnly?'✓ ':'')+'只看可加入房间',()=>{this.openOnly=!this.openOnly;this.invalidate();});cy+=47;
     this.button(left,cy,width,(this.activeOnly?'✓ ':'')+'有人正在拼图',()=>{this.activeOnly=!this.activeOnly;this.invalidate();});cy+=54;
     const dirty=this.direction!=='all'||this.filterCount!==0||this.lobbyPieces!=='all'||!this.openOnly||this.activeOnly||this.lobbyUnplayedOnly;
     if(dirty){const rw=Math.floor((width-10)*.4);this.button(left,cy,rw,'重置筛选',()=>{this.direction='all';this.filterCount=0;this.lobbyPieces='all';this.openOnly=true;this.activeOnly=false;this.lobbyUnplayedOnly=false;this.showModal(null);},'cream',43);this.button(left+rw+10,cy,width-rw-10,'应用筛选',()=>this.showModal(null),'berry',43);}
     else this.button(left,cy,width,'应用筛选',()=>this.showModal(null),'berry',43);
     cy+=57;break;
    }
    this.button(left,cy,width,(this.unplayedOnly?'✓ ':'')+'只看未拼过的图片',()=>{this.unplayedOnly=!this.unplayedOnly;if(this.unplayedOnly&&this.selected&&this.completedPhotoIds().has(this.selected))this.selected=null;this.invalidate();},this.unplayedOnly?'berry':'cream');cy+=47;
    this.button(left,cy,width,this.search?'搜索：'+this.search:'搜索图片名称',()=>void this.run(async()=>{const result=await this.platform.prompt('搜索图片名称',this.search);if(result!==null)this.search=result.trim();}));cy+=51;
    s.text('图片分类',left,cy,14,this.colors.ink,700);cy+=30;CATEGORIES.forEach((category,index)=>{const bw=(width-12)/3;this.button(left+(index%3)*(bw+6),cy+Math.floor(index/3)*43,bw,category,()=>{this.category=category;this.invalidate();},category===this.category?'berry':'cream',34);});cy+=Math.ceil(CATEGORIES.length/3)*43+10;
    const galleryDirty=this.direction!=='all'||this.category!=='全部'||!!this.search||this.unplayedOnly;
    if(galleryDirty){const rw=Math.floor((width-10)*.4);this.button(left,cy,rw,'重置筛选',()=>{this.direction='all';this.category='全部';this.search='';this.unplayedOnly=false;this.showModal(null);},'cream',43);this.button(left+rw+10,cy,width-rw-10,'应用筛选',()=>this.showModal(null),'berry',43);}
    else this.button(left,cy,width,'应用筛选',()=>this.showModal(null),'berry',43);
    cy+=57;break;
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
    cy=this.paragraph('控制拼合、金币等游戏音效，设置会自动记住。',left,cy,width,12)+14;
    this.button(left,cy,width,(this.teammateSoundEnabled?'✓ ':'')+'队友拼合音效',()=>this.setTeammateSoundEnabled(!this.teammateSoundEnabled),this.teammateSoundEnabled?'berry':'cream',39);cy+=47;
    cy=this.paragraph('默认开启，同桌其他玩家拼合时也会有轻响；如想更安静可随时关闭。',left,cy,width,12)+18;
    s.text('画面',left,cy,15,this.colors.ink,750);cy+=28;this.rowOptions([['smooth','流畅'],['power-saving','省电']],this.performanceMode,left,cy,width,value=>this.setPerformanceMode(value),39);cy+=48;cy=this.paragraph(this.performanceMode==='power-saving'?'持续画面最高30帧，拖动流畅度略有降低。':'跟随设备正常刷新频率，优先保证拖动流畅。',left,cy,width,12)+18;
    if(this.platform.config.id==='web'||this.desktop||this.platform.config.id==='taptap'){heading('操作');if(this.desktop){cy=this.paragraph('快捷键（电脑）：E 边缘 · H 提示 · B 底图 · F 适配 · '+(this.soloRoom?'R 整理 · ':'')+'T 收起/展开工具 · 空格或中键拖动平移 · 滚轮缩放 · Esc 返回',left,cy,width,12)+12;}
     if(this.platform.config.id==='web'&&this.platform.fullscreen?.available()){this.button(left,cy,width,this.platform.fullscreen.active()?'退出全屏':'全屏',()=>void this.toggleFullscreen(),'cream',39);cy+=51;}
    if(this.canRotate){this.button(left,cy,width,this.stage.w>this.stage.h?'切换竖屏':'切换横屏',()=>void this.toggleOrientation(),'cream',39);cy+=51;}
    if(this.platform.config.id==='taptap'){this.button(left,cy,width,(this.welcomeEnabled?'✓ ':'')+'进入问候',()=>this.setWelcomeEnabled(!this.welcomeEnabled),'cream',39);cy+=47;cy=this.paragraph('每天回到小窝时，按时间段打个招呼。',left,cy,width,12)+18;}
    }
    heading('账号与记录');
    this.button(left,cy,width,(this.formalWeb?'好友':'好友与消息')+(this.social.unread?' · '+this.social.unread+' 条未读':''),()=>{if(this.room)this.showModal('social');else this.navigate('friends');},'cream',39);cy+=50;
    if(!this.formalWeb){s.button({x:left,y:cy,w:width,h:39},'兑换码',()=>this.openRedeem(),{icon:'gift',fontSize:14});cy+=50;}
    if(this.energyEnabled){this.button(left,cy,width,(p?.autoSupply?'✓ ':'')+'体力耗尽自动使用库存包',()=>void this.run(async()=>{await this.client.json('/api/mobile/profile','PATCH',{autoSupply:!p?.autoSupply},{'Content-Type':'application/json'});await this.client.refresh();}));cy+=47;cy=this.paragraph('只消耗已有体力包，不会自动播放广告。',left,cy,width,12)+18;}
    const policyActions=this.formalWeb?[["隐私说明",()=>this.openWeb('privacy')],["服务说明",()=>this.openWeb('terms')]] as const:[["服务与隐私说明",()=>this.navigate('privacy')]] as const;
    if(this.formalWeb){this.button(left,cy,width,'用我的图片开一桌',()=>this.openWeb('uploads'),'berry',42);cy+=52;cy=this.paragraph('上传一张图片，选好片数，开一张自己的公开拼图桌。图片只在房间有效期内保留。',left,cy,width,12)+18;}
    for(const [label,action]of [['历史拼图',()=>this.showModal('history')],['玩法帮助',()=>this.navigate('help')],...policyActions] as const){this.button(left,cy,width,label,action);cy+=48;}
    s.text('当前版本 '+(this.platform.config?.id==='wechat'?WECHAT_PACKAGE_VERSION:CLIENT_PACKAGE_VERSION)+(this.platform.config.buildVersion?' · '+this.platform.config.buildVersion:''),left,cy+4,12,this.colors.muted,600,width);cy+=30;
    if(this.formalWeb){this.button(left,cy,width,'问题反馈',()=>this.openWeb('feedback'));cy+=48;cy=this.paragraph('账号、进度与收藏会持续保存在当前网站。',left,cy+4,width,12)+10;}else{this.button(left,cy,width,'个人资料访问与删除申请',()=>this.showModal('privacyRequests'));cy+=48;cy=this.paragraph('当前为本机游客身份，尚未绑定平台账号存档。清除本机数据可能丢失进度。',left,cy+4,width,12)+10;}
    if(this.platform.config.id==='taptap'&&this.platform.loginLog){this.button(left,cy,width,'登录日志',()=>this.openLoginLog());cy+=48;}
    if(this.adTestingAllowed||this.adminDiagnosticsAllowed||this.platform.config.id==='taptap'&&this.platform.config.tapAuthorizationTest||this.platform.config.previewTestRoom||this.nineGridAvailable||this.platform.config.id==='taptap'&&p?.taptap?.diagnostics===true||this.diagnosticsAvailable){cy+=10;heading('测试与诊断');}
    if(this.adminDiagnosticsAllowed){this.button(left,cy,width,(this.adminDiagEnabled?'✓ ':'')+'房间网络诊断浮窗',()=>this.setAdminDiagEnabled(!this.adminDiagEnabled),this.adminDiagEnabled?'berry':'cream',39);cy+=47;cy=this.paragraph('仅管理员可见：在房间顶部显示实时网络、平台通道、延迟与缓存状态胶囊，点击可展开或一键复制。',left,cy,width,12)+16;}
    if(this.adTestingAllowed){s.button({x:left,y:cy,w:width,h:40},'广告观看测试',()=>void this.testRewardedAd(),{tone:'berry',disabled:this.busy});cy+=52;cy=this.paragraph('仅当前测试账号可见，只测试展示，不发放奖励。',left,cy,width,11)+17;}
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
    {this.button(left,cy,width,'返回草稿存档',()=>this.showModal('history'),'cream',36);cy+=48;}
    cy=this.paragraph(this.formalWeb?'删除只移除自创列表入口，历史记录和大家的拼图进度仍保留。':'最多保留'+this.ownRoomLimit+'个未完成的自创房间入口。删除只释放名额，草稿存档和大家的拼图进度仍保留。',left,cy,width,13)+15;
    for(const room of this.client.profile?.ownedRooms??[])cy=this.drawSavedRoom(room,left,cy,width,true);
    if(!this.client.profile?.ownedRooms.length){s.text('还没有自创房间',left,cy+15,14,this.colors.muted);cy+=65;}break;
   }
   case'invite':{
    const wechat=this.platform.config?.id==='wechat';
    if(this.inviteFriendsAvailable){cy=this.drawInviteFriends(left,cy,width);s.ctx.fillStyle=this.colors.line;s.ctx.fillRect(left,cy,width,1);cy+=16;s.text(wechat?'分享给微信好友':'分享到微信 / QQ · 一起攒礼包',left,cy,16,this.colors.ink,800,width);cy+=32;}
    else{s.icon('invitationArt',{x:left+width/2-46,y:cy,w:92,h:89});cy+=102;s.text(wechat?'邀请微信好友一起拼':'邀请好友，一起攒礼包',left,cy,20,this.colors.ink,700,width);cy+=40;}
    // WeChat: sharing is only a way in; no reward copy, no referral code (the review build grants nothing for sharing or inviting).
    if(wechat){cy=this.paragraph(this.room?'把这一桌分享给微信好友，点开就能一起拼。':'把小窝分享给微信好友，一起来拼图。',left,cy,width,13)+16;this.button(left,cy,width,'分享给微信好友',()=>void this.shareInvitation(),'berry',42);cy+=56;break;}const invitation=this.tasks?.invitation,sharingTask=this.tasks?.tasks.find(task=>task.group==='sharing'),invitationTask=this.tasks?.tasks.find(task=>task.group==='invitation');
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
    if(this.canRotate){this.button(left,cy,width,this.stage.w>this.stage.h?'切换竖屏':'切换横屏',()=>void this.toggleOrientation(),'cream',40);cy+=51;}
    if(this.platform.config.id==='web'&&this.platform.fullscreen?.available()){this.button(left,cy,width,this.platform.fullscreen.active()?'退出全屏':'进入全屏',()=>void this.toggleFullscreen(),'cream',40);cy+=51;}
    const board=this.board,room=this.room;for(const [label,action]of [
     ['适配完整桌面',()=>{board?.fit();this.modal=null;this.toolsOpen=false;this.invalidate();}],
     ['放大',()=>{if(!this.completionFx)board?.zoom(1.25);this.invalidate();}],['缩小',()=>{if(!this.completionFx)board?.zoom(.8);this.invalidate();}],
     [this.platform.config.id==='web'?'定位未归位拼块':'定位未拼块 · 全部闪亮标出',()=>{if(this.platform.config.id==='web')board?.find();else this.locateLoose();this.modal=null;this.toolsOpen=false;this.invalidate();}],
     [board?.trayOpen?'关闭碎片托盘':'打开碎片托盘 · 点选或拖出',()=>{if(board)board.trayOpen=!board.trayOpen;this.modal=null;this.toolsOpen=false;this.invalidate();}],
     ['整理散落拼块',()=>void this.run(async()=>{await room?.organize();this.modal=null;this.toolsOpen=false;this.note('散片已整理');})],
     [this.lockButtonEnabled?'关闭锁定按钮':'启用锁定按钮 · 锁住后单指不移动画面',()=>{this.setLockButtonEnabled(!this.lockButtonEnabled);this.modal=null;this.toolsOpen=false;this.invalidate();}],
     [board?.showPreview?'关闭原图小窗':'原图小窗 · 点小窗可放大',()=>{if(board)board.showPreview=!board.showPreview;this.modal=null;this.invalidate();}],
     [this.minimapEnabled?'关闭小地图':'打开小地图 · 放大时左上角显示全桌',()=>{this.setMinimapEnabled(!this.minimapEnabled);this.modal=null;this.toolsOpen=false;this.invalidate();}],
    ] as const){if(label==='整理散落拼块'&&!this.soloRoom)continue;if(label.includes('小地图')&&this.layout==='desktop')continue;this.button(left,cy,width,label,action,'cream',40);cy+=51;}
    this.button(left,cy,width,'打开设置 · 声音、画面等',()=>this.showModal('settings'),'cream',40);cy+=51;
    s.text('当前版本 '+(this.platform.config?.id==='wechat'?WECHAT_PACKAGE_VERSION:CLIENT_PACKAGE_VERSION)+(this.platform.config.buildVersion?' · '+this.platform.config.buildVersion:''),left,cy,12,this.colors.muted,600,width);cy+=28;break;
   }
   case'chat':{
    const room=this.room;s.text('同桌 '+(room?.snapshot.members.length??0)+'人',left,cy,15,this.colors.ink,700);cy+=29;for(const member of room?.snapshot.members??[]){s.text(member.name+' · Lv.'+((member as typeof member&{level?:number}).level??1),left,cy,13,member.color);cy+=25;}cy+=10;
    const last=this.messages.slice(-8);for(const item of last){s.text(item.name,left,cy,12,this.colors.muted,700);cy+=22;cy=this.paragraph(item.text,left+7,cy,width-14,14,this.colors.ink)+12;}if(!last.length){s.text('发一句问候吧',left,cy,14,this.colors.muted);cy+=36;}
    const shown=phrases.map((text,index)=>({text,index})).filter(item=>this.phraseAvailable(item.index));
    shown.forEach(({text,index},slot)=>{const bw=(width-8)/2;this.button(left+(slot%2)*(bw+8),cy+Math.floor(slot/2)*45,bw,text,()=>void this.say(index),'cream',35);});cy+=Math.ceil(shown.length/2)*45+10;break;
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
  if(input.type==='move'&&this.platform.canvas.style&&point){const next=this.pointer?.board?'grabbing':this.stage.hasHit(point.x,point.y)?'pointer':this.route==='room'&&inside(this.roomArea,point.x,point.y)&&!this.modalBlocksInput?'grab':'default';if(this.platform.canvas.style.cursor!==next)this.platform.canvas.style.cursor=next;}
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
  if(input.type==='move'&&this.pointer&&this.dragThrough(this.pointer,point,input))return this.board!.input(input);
  if(this.pointer?.board&&!this.boardInputBlocked){const p=this.pointer;if(input.points.length>1||Math.hypot(point.x-p.x,point.y-p.y)>6)p.landscapeBackgroundTap=false;const handled=this.board?.input(input)??false;if(input.type==='cancel'||(input.type==='up'&&!input.points.length)){this.pointer=null;if(input.type==='up'&&p.landscapeBackgroundTap)this.setLandscapeToolsOpen(false);}return handled;}
  if(input.type==='move'&&this.pointer){const p=this.pointer,canScroll=p.modal?inside(this.modalArea,p.x,p.y):this.route!=='room'&&(p.album||inside(this.listArea,p.x,p.y));
   if(canScroll&&(p.scroll||Math.abs(point.y-p.y)>6)){if(!p.scroll)this.stage.input({type:'cancel',points:[],changed:input.changed});p.scroll=true;const delta=p.lastY-point.y;if(p.modal)this.modalScroll=clamp(this.modalScroll+delta,0,Math.max(0,this.modalExtent-this.modalArea.h));else if(p.album)this.albumListScroll=clamp(this.albumListScroll+delta,0,Math.max(0,this.albumListExtent-this.albumListArea.h));else{this.scroll=clamp(this.scroll+delta,0,Math.max(0,this.extent-this.listArea.h));if(this.route==='lobby'&&this.lobbyCursor&&this.scroll>this.extent-this.listArea.h-180)void this.loadLobby(true);}p.lastY=point.y;this.invalidate();return true;}p.lastY=point.y;
  }
  if(input.type==='up'||input.type==='cancel'){const scrolled=this.pointer?.scroll;this.pointer=null;if(scrolled)return true;}return this.stage.input(input);
 }
}
