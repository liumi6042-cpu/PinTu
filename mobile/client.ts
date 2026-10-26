import type {Platform,HttpReply,WebLinks} from './ports';
import type {MobileProfile,MobileRoomInput} from '../h5/mobile-api';
import type {RoomTicket} from '../lib/room-client';
import {expandCreatedTicket,type SeedRoomTicket} from '../lib/room-creation';
import {RoomRealtime} from '../lib/room-realtime';
import {TapPreviewRealtime} from './tap-preview';
import type {TapPreviewDescriptor} from '../lib/room-preview';
import {bundledArtworkPath} from './bundled-artwork';

export type GameCapabilities={energy:boolean;ads:boolean;shareRewards?:boolean;tapMultiplayer?:boolean;albumTarget:'pc'|'mobile-shared';createTickets?:boolean;customNames?:boolean;cheers?:boolean;privacyRequests?:boolean;roomActionRevisionBody?:boolean;soloLocalPlay?:boolean;supportedPieces?:number[];social?:{friends?:boolean;privateMessages?:boolean;privateMessageHistory?:boolean;roomInvites?:boolean;reports?:boolean;blocking?:boolean;search?:boolean;presence?:boolean;codeFormat?:'hex12'|'digits9'}};
export type GameConfig={mobileMode?:string|null;adRewardEnabled:boolean;rewardedAdUnitId:string;identityMode:'guest-device'|'web-cookie';wechatLoginConfigured:false;capabilities:GameCapabilities;compatUrls?:WebLinks;realtime?:{version:number};[key:string]:unknown};
export type FetchLikeInit={method?:string;headers?:HeadersInit;body?:BodyInit|null;signal?:AbortSignal|null;cache?:string;timeout?:number};
export type FetchLikeReply={status:number;ok:boolean;headers:{get(name:string):string|null};json():Promise<any>};
const sessionPattern=/^[a-f0-9]{64}$/,roomPattern=/^[a-f0-9]{32}$/;
const profileOf=(value:any):value is MobileProfile=>!!value&&Number.isFinite(value.level)&&Number.isFinite(value.energy)&&Number.isFinite(value.energyCap)&&!!value.supply;
type StoredRoomTicket={token:string;playerId:string;ownerIdentity?:string|null};
export type PlayerCard={player:{code:string;name:string;level:number;decoration:{artKey:string;color:string}|null};stats:{completedPuzzles:number;ownedPacks:number;completedAlbums:number;roomContribution:number};relationship:'self'|'friend'|'outgoing'|'incoming'|'none'};

/** Shared content API; no browser globals or platform SDK imports. */
export class GameClient{
 readonly platform:Platform;
 profile:MobileProfile|null=null;
 account:{id:string;username:string;name:string}|null=null;
 authRequired=false;
 config:GameConfig={adRewardEnabled:false,rewardedAdUnitId:'',identityMode:'guest-device',wechatLoginConfigured:false,capabilities:{energy:true,ads:false,albumTarget:'mobile-shared'}};
 ticket:RoomTicket|null=null;
 private ticketOwner:string|null=null;
 onChange?:()=>void;
 private token:string|null=null;
 private sessionPending:Promise<string>|null=null;
 private startPending:Promise<void>|null=null;
 private starting=false;
 /** TapTap could not be confirmed this launch: the stored session plays as a guest, and a later launch binds TapTap to that same session. */
 tapGuest=false;
 /** Set by the login dialog when the player agreed but TapTap login cannot complete. */
 tapGuestRequested=false;
 tapNotice='';
 constructor(platform:Platform){this.platform=platform;}
 get cookieIdentity(){return this.platform.config.id==='web'&&this.platform.config.identityMode==='web-cookie';}
 private sessionKey(){return 'jigsaw:h5-session:'+this.platform.config.apiBase;}
 private async session(){
  if(this.token)return this.token;
  if(this.sessionPending)return this.sessionPending;
  this.sessionPending=(async()=>{const stored=this.platform.storage.get(this.sessionKey());if(stored&&sessionPattern.test(stored))return this.token=stored;
   const reply=await this.platform.request({url:this.platform.config.apiBase+'/session',method:'POST',headers:{'Content-Type':'application/json'},body:'{}',timeout:12000});
   if(reply.status<200||reply.status>=300||!sessionPattern.test(reply.data?.token||''))throw Error('暂时无法建立玩家连接，请重试');
   const token=String(reply.data.token);this.platform.storage.set(this.sessionKey(),token);this.token=token;return token;
  })().finally(()=>{this.sessionPending=null;});
  return this.sessionPending;
 }
 async start(forceAuthorization=false){
  if(this.startPending)return this.startPending;
  this.starting=true;
  this.startPending=(async()=>{
   const loadConfig=()=>this.platform.request({url:this.platform.config.apiBase+'/config',timeout:10000});
   // Public configuration can load while the native identity bridge warms up.
   // Catch early transport failures: the native request API may appear with login.
   const configPending=this.platform.config.id==='taptap'?loadConfig().then(reply=>({reply}),()=>({reply:null})):null;
   const taptap=this.platform.config.id==='taptap',log=(text:string)=>this.platform.loginLog?.add(text);
   let tapIdentity:Awaited<ReturnType<NonNullable<Platform['tapTapIdentity']>>>=null,guestReason='';
   if(taptap){
    if(this.tapGuestRequested&&!forceAuthorization)guestReason='登录弹窗中选择继续';
    // 玩家要求：TapTap身份拿不到时直接以游客进入，不再卡在重新连接。自测重授权仍严格失败。
    else try{tapIdentity=await this.requireTapTapIdentity(forceAuthorization);}catch(error){if(forceAuthorization)throw error;guestReason=String((error as {code?:string}).code??'TAPTAP_IDENTITY_REQUIRED');}
   }
   const reply=configPending?(await configPending).reply??await loadConfig():await loadConfig();if(reply.status!==200)throw Error('游戏服务暂时无法连接');if(reply.data?.mobileMode!==(this.cookieIdentity?'web-managed-shared':'mobile-v3-isolated'))throw Error(this.cookieIdentity?'网站共享服务尚未连接':'独立手机版服务尚未连接');
   const wechat=this.platform.config.id==='wechat',web=this.platform.config.id==='web',unit=web?'':wechat?(this.platform.config.rewardedAdUnitId||''):String(reply.data.rewardedAdUnitId||this.platform.config.rewardedAdUnitId||'');
   const capabilities:GameCapabilities={energy:this.cookieIdentity?false:reply.data.capabilities?.energy!==false,shareRewards:!web&&reply.data.capabilities?.shareRewards===true,ads:!web&&reply.data.capabilities?.ads!==false&&reply.data.adRewardEnabled===true&&!!unit,albumTarget:this.cookieIdentity||reply.data.capabilities?.albumTarget==='pc'?'pc':'mobile-shared',createTickets:this.cookieIdentity?false:reply.data.capabilities?.createTickets??!web,
    tapMultiplayer:!web&&reply.data.capabilities?.tapMultiplayer===true,
    customNames:this.cookieIdentity?reply.data.capabilities?.customNames!==false:reply.data.capabilities?.customNames===true,
    cheers:this.cookieIdentity?reply.data.capabilities?.cheers===true:reply.data.capabilities?.cheers!==false,
    privacyRequests:!this.cookieIdentity&&reply.data.capabilities?.privacyRequests===true,
    roomActionRevisionBody:!this.cookieIdentity&&reply.data.capabilities?.roomActionRevisionBody===true,
    soloLocalPlay:!this.cookieIdentity&&reply.data.capabilities?.soloLocalPlay===true,
    social:this.cookieIdentity?reply.data.capabilities?.social??{friends:false,privateMessages:false,reports:false,blocking:false,search:false,codeFormat:'hex12'}:{friends:true,privateMessageHistory:true,roomInvites:true,reports:true,blocking:true,search:true,presence:true,codeFormat:'digits9',...reply.data.capabilities?.social,privateMessages:reply.data.capabilities?.social?.privateMessages===true},
    ...(this.cookieIdentity?{supportedPieces:reply.data.capabilities?.supportedPieces??[108,300,500]}:{})};
   this.config={...reply.data,rewardedAdUnitId:unit,adRewardEnabled:capabilities.ads,identityMode:this.platform.config.id==='taptap'?'taptap':this.cookieIdentity?'web-cookie':'guest-device',wechatLoginConfigured:false,capabilities};
   if(this.cookieIdentity){await this.platform.restoreWebIdentity?.();await this.refresh();}
   else if(taptap){
    // Bind before reading a profile when TapTap answered, so the session maps to the platform account first.
    // Otherwise the same stored session plays as a guest; the server keeps that progress and a later launch binds it.
    await this.session();let bound=false,conflict=false;
    if(tapIdentity){
     // Without a nickname the server keeps an existing account's name, and a new account keeps the guest's random name.
     const loginOnly=tapIdentity.nicknameUnavailable===true&&!tapIdentity.nickname;if(loginOnly)log('昵称接口不可用 → 仅用登录凭证绑定');
     try{await this.json('/api/taptap/bind','POST',loginOnly?{code:tapIdentity.code}:{code:tapIdentity.code,nickname:tapIdentity.nickname},{'Content-Type':'application/json'});bound=true;log(loginOnly?'TapTap仅登录绑定成功':'TapTap绑定成功');}
     catch(error){if(forceAuthorization)throw error;const detail=error as {status?:number;code?:string};conflict=detail.code==='TAPTAP_ACCOUNT_CONFLICT';guestReason='绑定失败 '+(detail.status??'网络')+(detail.code?' '+detail.code:'');log('TapTap绑定失败 · '+(detail.status??'网络')+(detail.code?' · '+detail.code:''));}
    }
    if(!bound)await this.refresh();
    // A session bound on an earlier launch already resolves to the TapTap account on the server.
    this.tapGuest=!bound&&this.profile?.taptap?.bound!==true;
    this.tapNotice=this.tapGuest?(conflict?'该TapTap账号已有其他进度，本次继续以游客身份游玩，进度会保留':'TapTap登录暂时不可用，已用游客身份进入，进度会保留'):'';
    if(!bound)log(this.tapGuest?'游客模式进入 · '+guestReason:'TapTap未确认，但本机会话已绑定账号 · '+guestReason);
   }else await this.refresh();
  })().catch(error=>{this.startPending=null;throw error;}).finally(()=>{this.starting=false;});return this.startPending;
 }
 async reauthorizeTapTap(){
  if(this.platform.config.id!=='taptap'||this.platform.config.tapAuthorizationTest!==true)throw Error('当前包未开放昵称授权自测');
  if(this.starting)throw Error('上一轮登录仍在处理中，请稍后再试');
  // 沿用已有session和平台账号映射，不清理存档，不建立新游客。
  this.startPending=null;await this.start(true);
 }
 private async requireTapTapIdentity(forceAuthorization=false){
  let identity:Awaited<ReturnType<NonNullable<Platform['tapTapIdentity']>>>|null=null;
  try{identity=await this.platform.tapTapIdentity?.(forceAuthorization?{forceAuthorization:true}:undefined)??null;}
  catch(error){throw Object.assign(Error(error instanceof Error?error.message:'TapTap账号信息读取失败，请从TapTap内重新打开后重试'),{code:'TAPTAP_IDENTITY_REQUIRED'});}
  if(!identity?.code)throw Object.assign(Error('未获取到TapTap账号信息，请确认从TapTap App内打开此自测包后重试'),{code:'TAPTAP_IDENTITY_REQUIRED'});
  if(!identity.nickname&&identity.nicknameUnavailable!==true)throw Object.assign(Error('TapTap登录成功，但未返回公开昵称；请检查TapTap用户信息权限后重试'),{code:'TAPTAP_NICKNAME_REQUIRED'});
  return identity;
 }
 private applyProfile(value:any){const profile=profileOf(value?.profile)?value.profile:profileOf(value?.mobileProfile)?value.mobileProfile:profileOf(value)?value:null;if(!profile)return;
  if(this.profile?.serverTime&&profile.serverTime&&profile.serverTime<this.profile.serverTime)return;const previous=this.ownerIdentity();this.profile=profile;this.authRequired=false;if(this.cookieIdentity){this.account=value?.account??(profile as MobileProfile&{account?:GameClient['account']}).account??null;if(value?.compatUrls)this.config.compatUrls=value.compatUrls;if(previous&&previous!==this.ownerIdentity()){this.ticket=null;this.ticketOwner=null;}}this.onChange?.();
 }
 private expire(){this.token=null;this.ticket=null;this.platform.storage.remove(this.sessionKey());}
 private async request(path:string,method:string,body:unknown,headers:Record<string,string>,timeout=12000){
  if(!/^\/api\/[a-zA-Z0-9/_-]+(?:\?[^#]*)?$/.test(path))throw Error('请求地址无效');
  const identityHeaders:Record<string,string>=this.cookieIdentity?{}:{'X-Jigsaw-H5-Session':await this.session()};
  const reply=await this.platform.request({url:this.platform.config.apiBase+path,method,headers:{...headers,...identityHeaders,'X-Jigsaw-Artwork-Snapshot':'1'},body,timeout});
  if(this.cookieIdentity&&reply.status===401&&(path==='/api/mobile/profile'||reply.data?.code==='IDENTITY_REQUIRED')){this.profile=null;this.account=null;this.ticket=null;this.authRequired=true;this.startPending=null;this.onChange?.();}
  const expired=Object.entries(reply.headers).some(([key,value])=>key.toLowerCase()==='x-jigsaw-h5-session-expired'&&value==='1');
  if(expired){this.expire();throw Object.assign(Error('玩家连接已过期，请重新连接'),{status:401,code:'IDENTITY_REQUIRED'});}
  this.applyProfile(reply.data);return reply;
 }
 async json<T>(path:string,method='GET',body?:unknown,headers:Record<string,string>={}):Promise<T>{const reply=await this.request(path,method,body,headers);if(reply.status<200||reply.status>=300)throw Object.assign(Error(typeof reply.data?.error==='string'?reply.data.error:'暂时无法完成，请重试'),{status:reply.status,code:reply.data?.code,profile:reply.data?.profile,compatUrl:reply.data?.compatUrl});return reply.data as T;}
 post<T>(path:string,body:unknown){return this.json<T>(path,'POST',body,{'Content-Type':'application/json'});}
 playerCard(code:string,room?:string){return this.json<PlayerCard>('/api/mobile/players/'+encodeURIComponent(code)+'/card'+(room?'?room='+encodeURIComponent(room):''));}
 async refresh(){await this.json<MobileProfile>('/api/mobile/profile');return this.profile;}
 /** Accept only responses from the currently admitted room and account. */
 acceptRoomResponse(ticket:RoomTicket,value:unknown){
  if(this.authRequired||this.ticket?.room.id!==ticket.room.id||this.ticket.token!==ticket.token||this.ticketOwner!==this.ownerIdentity())return;
  this.applyProfile(value);
 }
 roomRealtime(ticket:RoomTicket,revision:()=>number){
  if(this.config.realtime?.version!==1||!this.platform.openSocket)return null;
  const base=this.platform.config.apiBase.replace(/\/$/,''),url=base.replace(/^https:/,'wss:').replace(/^http:/,'ws:')+'/realtime',owner=this.ownerIdentity();
  const authority=new RoomRealtime({url,openSocket:(url,handlers)=>this.platform.openSocket!(url,handlers),credentials:async()=>{
   const session=this.cookieIdentity?undefined:await this.session();
   if(this.authRequired||this.ticket?.room.id!==ticket.room.id||this.ticket.token!==ticket.token||owner!==this.ownerIdentity())throw Error('room-identity-changed');
   return {roomId:ticket.room.id,token:ticket.token,...(session?{session}:{}),since:revision()};
  }});
  const preview=(ticket.room as RoomTicket['room']&{tapPreview?:TapPreviewDescriptor}).tapPreview;
  if(this.platform.config.id!=='taptap'||preview?.version!==1||typeof preview.testOnly!=='boolean'||!this.platform.onlineBattleManager)return authority;
  return new TapPreviewRealtime({authority,manager:()=>this.platform.onlineBattleManager!(),room:ticket.room,playerId:ticket.playerId,randomId:()=>this.platform.randomId(),sendHz:this.platform.config.previewTestRoom||preview.testOnly===false?10:undefined,request:body=>this.json('/api/rooms/'+ticket.room.id+'/tap-preview','POST',body,{Authorization:'Bearer '+ticket.token,'Content-Type':'application/json'})});
 }
 asset(path:string){
  const bundled=bundledArtworkPath(path,this.platform.config);if(bundled)return bundled;
  if(!path)return '';if(/^https?:\/\//i.test(path))return path;if(path.startsWith('//'))throw Error('素材地址无效');
  const relative=path.replace(/^\/+/,''),apiBase=this.platform.config.apiBase.replace(/\/$/,'');
  // The CDN contains public catalog pictures only; authenticated/private routes
  // and other origin resources must not accidentally move to public storage.
  if(/^puzzles\/[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(relative))return this.platform.config.assetBase.replace(/\/$/,'')+'/'+relative;
  if(this.cookieIdentity)return new URL('/'+relative,apiBase).href;
  return apiBase+(relative.startsWith('api/')?'/':'/assets/')+relative;
 }
 private ticketKey(id:string){return 'jigsaw:shared-room:'+this.platform.config.apiBase+':'+id;}
 private ownerIdentity(){return this.cookieIdentity?(this.account?'account:'+this.account.id:this.profile?'guest:'+(this.profile.code||'anonymous'):null):null;}
 private saveTicket(ticket:RoomTicket){if(!roomPattern.test(ticket?.room?.id)||!roomPattern.test(ticket?.token)||!ticket?.playerId)throw Error('房间凭证无效');this.ticket=ticket;this.ticketOwner=this.ownerIdentity();const saved=JSON.stringify({token:ticket.token,playerId:ticket.playerId,...(this.cookieIdentity?{ownerIdentity:this.ticketOwner}:{})});this.platform.storage.set(this.ticketKey(ticket.room.id),saved);if(this.cookieIdentity){const legacy='together-puzzle:room:'+ticket.room.id;this.platform.storage.setSession?.(legacy,saved);if(this.account)this.platform.storage.set(legacy+':account',saved);}this.onChange?.();return ticket;}
 async createRoom(input:MobileRoomInput){if(this.cookieIdentity)await this.refresh();const raw=await this.post<RoomTicket|SeedRoomTicket>('/api/rooms',{...input,requestId:input.requestId||this.platform.randomId()});const ticket=expandCreatedTicket(raw);return this.saveTicket({...ticket,...('inviteCode'in raw?{inviteCode:raw.inviteCode}:{})});}
 async createDiagnosticRoom(){
  const allowed=this.platform.config.id==='taptap'&&this.profile?.taptap?.diagnostics===true||this.platform.config.id==='web'&&this.cookieIdentity&&this.profile?.diagnostics===true;
  if(!allowed)throw Error('该测试入口仅对指定账号开放');
  return this.saveTicket(await this.post<RoomTicket>('/api/mobile/diagnostics/room',{requestId:this.platform.randomId()}));
 }
 async joinRoom(id:string,inviteCode?:string){if(!roomPattern.test(id))throw Error('房间编号无效');
  if(this.cookieIdentity)await this.refresh();
  const owner=this.ownerIdentity(),candidates:StoredRoomTicket[]=[];if(this.ticket?.room.id===id)candidates.push({...this.ticket,ownerIdentity:this.ticketOwner});
  const legacy='together-puzzle:room:'+id,keys=[this.platform.storage.get(this.ticketKey(id)),...(this.cookieIdentity?[...(this.account?[this.platform.storage.get(legacy+':account')]:[]),this.platform.storage.getSession?.(legacy)]:[])];
  for(const raw of keys)try{if(raw)candidates.push(JSON.parse(raw));}catch{}
  // Legacy :account keys were also used for guest rooms. Missing ownership is
  // not proof of an account: rejoin through the server to restore its member.
  const stored=candidates.find(item=>item&&roomPattern.test(item.token)&&typeof item.playerId==='string'&&(!this.cookieIdentity||!!owner&&item.ownerIdentity===owner));
  if(stored&&roomPattern.test(stored.token)&&typeof stored.playerId==='string'){
   try{const room=await this.json<RoomTicket['room']>('/api/rooms/'+id,'POST',{type:'heartbeat',historyJoin:true,requestId:this.platform.randomId()},{Authorization:'Bearer '+stored.token,'Content-Type':'application/json'});return this.saveTicket({token:stored.token,playerId:stored.playerId,room});}
   catch(error){if(![401,403].includes((error as {status?:number}).status||0))throw error;this.platform.storage.remove(this.ticketKey(id));}
  }
  return this.saveTicket(await this.post<RoomTicket>('/api/rooms/'+id+'/join',{...(inviteCode?{inviteCode}:{}),requestId:this.platform.randomId()}));
 }
 /** Drop-in network injection for RoomClient without requiring Response or Headers in wx. */
 fetchLike=async(input:string|URL|Request,init:FetchLikeInit={}):Promise<FetchLikeReply>=>{
  const path=typeof input==='string'?input:typeof (input as Request).url==='string'?(input as Request).url:String(input);
  const prefix=this.platform.config.apiBase;let normalized=path.startsWith(prefix+'/api/')?path.slice(prefix.length):path,body=init.body??undefined;
  // A changing query string defeats the browser's per-URL CORS preflight cache.
  // New mobile servers accept the same revision in the POST body; old servers
  // and formal Web keep their established URL protocol.
  const versioned=/^(\/api\/rooms\/[a-f0-9]{32})\?since=(\d+)$/.exec(normalized);
  if(!this.cookieIdentity&&this.config.capabilities.roomActionRevisionBody===true&&init.method?.toUpperCase()==='POST'&&versioned&&typeof body==='string'){
   const since=Number(versioned[2]);let action;try{action=JSON.parse(body);}catch{}
   if(Number.isSafeInteger(since)&&action&&typeof action==='object'&&!Array.isArray(action)){normalized=versioned[1];body=JSON.stringify({...action,since});}
  }
  if(init.signal?.aborted)throw init.signal.reason||Error('请求已取消');
  const headers:Record<string,string>={};if(init.headers){if(Array.isArray(init.headers)){for(const [key,value]of init.headers)headers[key]=value;}else if(typeof (init.headers as Headers).forEach==='function'){(init.headers as Headers).forEach((value,key)=>headers[key]=value);}else Object.assign(headers,init.headers);}
  let abort:(()=>void)|undefined;
  const operation=this.request(normalized,init.method||'GET',body,headers,init.timeout??6500);
  const reply=init.signal?await Promise.race([operation,new Promise<HttpReply>((_resolve,reject)=>{abort=()=>reject(init.signal?.reason||Error('请求已取消'));init.signal!.addEventListener('abort',abort,{once:true});})]).finally(()=>{if(abort)init.signal!.removeEventListener('abort',abort);}):await operation;
  return {status:reply.status,ok:reply.status>=200&&reply.status<300,headers:{get(name){const key=Object.keys(reply.headers).find(key=>key.toLowerCase()===name.toLowerCase());return key?reply.headers[key]:null;}},json:async()=>reply.data};
 };
}
