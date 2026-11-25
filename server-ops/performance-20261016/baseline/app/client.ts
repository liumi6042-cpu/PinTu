import type {Platform,HttpReply,WebLinks} from './ports';
import type {MobileProfile,MobileRoomInput} from '../h5/mobile-api';
import type {RoomTicket} from '../lib/room-client';
import {expandCreatedTicket,type SeedRoomTicket} from '../lib/room-creation';

export type GameCapabilities={energy:boolean;ads:boolean;albumTarget:'pc'|'mobile-shared';supportedPieces?:number[];social?:{friends?:boolean;privateMessages?:boolean;reports?:boolean;blocking?:boolean;search?:boolean;presence?:boolean;codeFormat?:'hex12'|'digits9'}};
export type GameConfig={mobileMode?:string|null;adRewardEnabled:boolean;rewardedAdUnitId:string;identityMode:'guest-device'|'web-cookie';wechatLoginConfigured:false;capabilities:GameCapabilities;compatUrls?:WebLinks;[key:string]:unknown};
export type FetchLikeInit={method?:string;headers?:HeadersInit;body?:BodyInit|null;signal?:AbortSignal|null;cache?:string;timeout?:number};
export type FetchLikeReply={status:number;ok:boolean;headers:{get(name:string):string|null};json():Promise<any>};
const sessionPattern=/^[a-f0-9]{64}$/,roomPattern=/^[a-f0-9]{32}$/;
const profileOf=(value:any):value is MobileProfile=>!!value&&Number.isFinite(value.level)&&Number.isFinite(value.energy)&&Number.isFinite(value.energyCap)&&!!value.supply;
type StoredRoomTicket={token:string;playerId:string;ownerIdentity?:string|null};

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
 async start(){
  if(this.startPending)return this.startPending;
  this.startPending=(async()=>{const reply=await this.platform.request({url:this.platform.config.apiBase+'/config',timeout:10000});if(reply.status!==200)throw Error('游戏服务暂时无法连接');if(reply.data?.mobileMode!==(this.cookieIdentity?'web-managed-shared':'mobile-v3-isolated'))throw Error(this.cookieIdentity?'网站共享服务尚未连接':'独立手机版服务尚未连接');
   const wechat=this.platform.config.id==='wechat',web=this.platform.config.id==='web',unit=web?'':wechat?(this.platform.config.rewardedAdUnitId||''):String(reply.data.rewardedAdUnitId||this.platform.config.rewardedAdUnitId||'');
   const capabilities:GameCapabilities={energy:this.cookieIdentity?false:reply.data.capabilities?.energy!==false,ads:!web&&reply.data.capabilities?.ads!==false&&reply.data.adRewardEnabled===true&&!!unit,albumTarget:this.cookieIdentity||reply.data.capabilities?.albumTarget==='pc'?'pc':'mobile-shared',...(this.cookieIdentity?{supportedPieces:reply.data.capabilities?.supportedPieces??[108,300,500],social:reply.data.capabilities?.social??{friends:false,privateMessages:false,reports:false,blocking:false,search:false,codeFormat:'hex12'}}:{})};
   this.config={...reply.data,rewardedAdUnitId:unit,adRewardEnabled:capabilities.ads,identityMode:this.cookieIdentity?'web-cookie':'guest-device',wechatLoginConfigured:false,capabilities};
   if(this.cookieIdentity)await this.platform.restoreWebIdentity?.();
   await this.refresh();
  })().catch(error=>{this.startPending=null;throw error;});return this.startPending;
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
 async refresh(){await this.json<MobileProfile>('/api/mobile/profile');return this.profile;}
 asset(path:string){
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
 async joinRoom(id:string,inviteCode?:string){if(!roomPattern.test(id))throw Error('房间编号无效');
  if(this.cookieIdentity)await this.refresh();
  const owner=this.ownerIdentity(),candidates:StoredRoomTicket[]=[];if(this.ticket?.room.id===id)candidates.push({...this.ticket,ownerIdentity:this.ticketOwner});
  const legacy='together-puzzle:room:'+id,keys=[this.platform.storage.get(this.ticketKey(id)),...(this.cookieIdentity?[...(this.account?[this.platform.storage.get(legacy+':account')]:[]),this.platform.storage.getSession?.(legacy)]:[])];
  for(const raw of keys)try{if(raw)candidates.push(JSON.parse(raw));}catch{}
  // Legacy :account keys were also used for guest rooms. Missing ownership is
  // not proof of an account: rejoin through the server to restore its member.
  const stored=candidates.find(item=>item&&roomPattern.test(item.token)&&typeof item.playerId==='string'&&(!this.cookieIdentity||!!owner&&item.ownerIdentity===owner));
  if(stored&&roomPattern.test(stored.token)&&typeof stored.playerId==='string'){
   try{const room=await this.json<RoomTicket['room']>('/api/rooms/'+id,'POST',{type:'heartbeat',requestId:this.platform.randomId()},{Authorization:'Bearer '+stored.token,'Content-Type':'application/json'});return this.saveTicket({token:stored.token,playerId:stored.playerId,room});}
   catch(error){if(![401,403].includes((error as {status?:number}).status||0))throw error;this.platform.storage.remove(this.ticketKey(id));}
  }
  return this.saveTicket(await this.post<RoomTicket>('/api/rooms/'+id+'/join',{...(inviteCode?{inviteCode}:{}),requestId:this.platform.randomId()}));
 }
 /** Drop-in network injection for RoomClient without requiring Response or Headers in wx. */
 fetchLike=async(input:string|URL|Request,init:FetchLikeInit={}):Promise<FetchLikeReply>=>{
  const path=typeof input==='string'?input:typeof (input as Request).url==='string'?(input as Request).url:String(input);
  const prefix=this.platform.config.apiBase,normalized=path.startsWith(prefix+'/api/')?path.slice(prefix.length):path;
  if(init.signal?.aborted)throw init.signal.reason||Error('请求已取消');
  const headers:Record<string,string>={};if(init.headers){if(Array.isArray(init.headers)){for(const [key,value]of init.headers)headers[key]=value;}else if(typeof (init.headers as Headers).forEach==='function'){(init.headers as Headers).forEach((value,key)=>headers[key]=value);}else Object.assign(headers,init.headers);}
  let abort:(()=>void)|undefined;
  const operation=this.request(normalized,init.method||'GET',init.body??undefined,headers,init.timeout??6500);
  const reply=init.signal?await Promise.race([operation,new Promise<HttpReply>((_resolve,reject)=>{abort=()=>reject(init.signal?.reason||Error('请求已取消'));init.signal!.addEventListener('abort',abort,{once:true});})]).finally(()=>{if(abort)init.signal!.removeEventListener('abort',abort);}):await operation;
  return {status:reply.status,ok:reply.status>=200&&reply.status<300,headers:{get(name){const key=Object.keys(reply.headers).find(key=>key.toLowerCase()===name.toLowerCase());return key?reply.headers[key]:null;}},json:async()=>reply.data};
 };
}
