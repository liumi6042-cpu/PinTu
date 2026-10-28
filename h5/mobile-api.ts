import { apiFetch,gatewayConfig } from './network';
import { expandCreatedTicket, rememberCreatedTicket, takeCreatedTicket, type SeedRoomTicket } from '../lib/room-creation';
import { saveTicket, roomSessionKey, type RoomTicket } from '../lib/room-client';

export type SupplyKind = 'energy' | 'create';
export type MobileLevelClear={levelId:string;energy:number;firstClear:boolean;nextLevelId:string|null;chapterComplete:boolean};
export type MobileOwnedRoom = {id:string;title?:string;imageId?:string;pieces?:number;actualPieces?:number;placed?:number;players?:number;completed?:boolean;completedAt?:number|null;visibility?:string;inviteCode?:string;thumbSrc?:string;lastJoinedAt?:number;unavailable?:boolean};
export type MobileProfile = {
 diagnostics?:boolean;
 code?:string;
 collection?:{coins:number;fragments:number;ownedPackIds:string[];ownedImageIds:string[];equipped:{id:string;title:string;kind:string;artKey:string;color:string}|null};
 name:string; level:number; xp:number; totalXp:number; xpToNext:number; energy:number; energyCap:number; inviteCapBonus?:{count:number;maximum:number}; giftProgress:number; giftCount?:number;
 economy?:{contributionCost:number;contributionXp:number;firstRoomFree:boolean;upgradeRefill:'full'|'fixed'|'none';upgradeEnergy:number;naturalRecoveryMinutes:number};
 supply:{energy:number;create:number}; autoSupply:boolean; adEligible:boolean; ownedRooms:MobileOwnedRoom[];
 firstSelectionAvailable?:boolean; newcomer?:boolean; firstRoomId?:string|null; serverTime?:number; updatedAt?:number;
 taptap?:{provider:'taptap';bound:boolean;nickname?:string|null;diagnostics?:boolean};
 lastReward?:{id?:string;type?:string;energy?:number;amount?:number;xp?:number;levelUp?:boolean;message?:string;levelClear?:{levelId:string;energy:number;firstClear:boolean;nextLevelId:string|null};[key:string]:unknown}|null;
};
export function requestId(){return Array.from(crypto.getRandomValues(new Uint8Array(16)),x=>x.toString(16).padStart(2,'0')).join('');}
export function isMobileProfile(value:unknown):value is MobileProfile{
 const p=value as MobileProfile|undefined;
 return !!p&&Number.isFinite(p.level)&&Number.isFinite(p.energy)&&Number.isFinite(p.energyCap)&&!!p.supply&&Array.isArray(p.ownedRooms);
}
export function publishProfile(value:unknown){
 if(isMobileProfile(value))window.dispatchEvent(new CustomEvent('mobile:profile',{detail:value}));
}
let verifiedBackend:Promise<void>|undefined;let verifiedUntil=0;
export function requireMobileBackend(){
 if(!verifiedBackend||Date.now()>verifiedUntil){verifiedUntil=Date.now()+60000;verifiedBackend=gatewayConfig().then(config=>{if(config.mobileMode!=='mobile-v3-isolated')throw Error('独立手机版服务尚未连接，请使用新的测试入口');}).catch(error=>{verifiedBackend=undefined;throw error;});}
 return verifiedBackend;
}
export async function mobileJson<T>(path:string,init?:RequestInit):Promise<T>{
 await requireMobileBackend();
 const response=await apiFetch(path,{cache:'no-store',signal:AbortSignal.timeout(12000),...init});
 const data=await response.json().catch(()=>({error:'连接暂时中断，请重试'})) as Record<string,unknown>;
 publishProfile(data?.profile);publishProfile(data);
 if(!response.ok)throw Object.assign(new Error(typeof data?.error==='string'?data.error:'暂时无法完成，请重试'),{status:response.status,code:data?.code,profile:data?.profile});
 return data as T;
}
export function mobilePost<T>(path:string,body:unknown){return mobileJson<T>(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});}
export type MobileLevelStatus='locked'|'unlocked'|'cleared'|'unavailable';
export type MobileLevel={id:string;imageId:string|null;title:string|null;pieces:number;status:MobileLevelStatus;line?:string|null;timeLabel?:string|null;intro?:string|null;comic?:unknown;comicPage?:unknown;src?:string|null;thumbSrc?:string|null};
export type MobileChapter={id:string;title:string;albumId:string;coverImageId:string|null;coverSrc:string|null;status:'available'|'unavailable';levels:MobileLevel[]};
export type MobileLevelsView={chapters:MobileChapter[];current:MobileLevel|null;firstClearEnergy:number;seriesTitle?:string|null};
export type MobileRoomInput=({mode:'random'|'selected'|'daily';imageId?:string;pieces:48|108|300|500;direction?:'all'|'portrait'|'landscape'|'square'}|{mode:'level';levelId:string;pieces?:never})&{visibility?:'public'|'private';requestId?:string};
export async function createMobileRoom(input:MobileRoomInput):Promise<RoomTicket>{
 const raw=await mobilePost<RoomTicket|SeedRoomTicket>('/api/rooms',{...input,requestId:input.requestId||requestId()});
 const expanded=expandCreatedTicket(raw);const inviteCode=(raw as RoomTicket & {inviteCode?:string}).inviteCode;const ticket={...expanded,...(inviteCode?{inviteCode}:{})};rememberCreatedTicket(ticket);saveTicket(ticket);return ticket;
}
export async function joinMobileRoom(roomId:string,inviteCode?:string):Promise<RoomTicket>{
 if(!/^[a-f0-9]{32}$/.test(roomId))throw Error('房间编号无效');
 const fresh=takeCreatedTicket(roomId);if(fresh){saveTicket(fresh);return fresh;}
 const candidates=new Set<string>();
 try{const value=sessionStorage.getItem(roomSessionKey(roomId));if(value)candidates.add(value);}catch{}
 try{const value=localStorage.getItem(roomSessionKey(roomId)+':account');if(value)candidates.add(value);}catch{}
 for(const value of candidates){
  try{
   const saved=JSON.parse(value);
   if(typeof saved.token!=='string'||!/^[a-f0-9]{32}$/.test(saved.token)||typeof saved.playerId!=='string')continue;
   const room=await mobileJson<RoomTicket['room']>('/api/rooms/'+roomId,{method:'POST',headers:{Authorization:'Bearer '+saved.token,'Content-Type':'application/json'},body:JSON.stringify({type:'heartbeat',historyJoin:true,requestId:requestId()})});
   const ticket={token:saved.token,playerId:saved.playerId,room, ...((room as unknown as {inviteCode?:string}).inviteCode?{inviteCode:(room as unknown as {inviteCode:string}).inviteCode}:{})};
   saveTicket(ticket);return ticket;
  }catch(error){if([404,410].includes((error as {status?:number}).status??0))throw error;}
 }
 const ticket=await mobilePost<RoomTicket>('/api/rooms/'+roomId+'/join',{...(inviteCode?{inviteCode}:{}),requestId:requestId()});
 saveTicket(ticket);return ticket;
}

export type MobileGiftKind='ten-5'|'ten-6'|'ten-7'|'cooperation-10'|'cooperation-30'|'cooperation-60'|'friend-10'|'friend-30'|'invite-friend'|'invite-refill';
export type MobileTask={id:string;group:'beginner'|'cooperation'|'friend'|'invitation'|'sharing';title:string;target:number;progress:number;earned:boolean;kind:MobileGiftKind|'share-invitation'|'beginner-10'|'beginner-50'|'beginner-100';energy:number;xp:number;coins?:number;effect?:'full-energy'};
export type MobileGiftStack={kind:MobileGiftKind;title:string;count:number;energyMin:number;energyMax:number;xp:number;xpMin?:number;xpMax?:number;coins?:number;coinsMin?:number;coinsMax?:number;effect?:'full-energy'};
export type MobileTaskView={
 profile:MobileProfile;day:string;giftProgress:number;giftMaximum:number;giftMinimum?:number;giftXp?:number;giftCoins?:number;giftCount:number;
 tasks:MobileTask[];inventory:MobileGiftStack[];
 invitation:{code:string;bound:boolean;boundToName:string|null;joinedCount:number;qualifiedCount:number;capBonus?:number;capBonusMaximum?:number;todayRewarded:number;dailyLimit:number;requiredContributions:number;shareDailyLimit:number;todayShared:number};serverTime:number;
};
export type MobileGiftReceipt={kind:MobileGiftKind;quantity:number;energy:number;xp:number;coins?:number;levels:number;effect?:'full-energy'};
export type MobileGiftOpenResult=MobileTaskView & {opened:MobileGiftReceipt};
export type MobileInviteAcceptResult=MobileTaskView & {accepted:{alreadyBound:boolean;inviterName:string}};

export type MobileInviteShareResult=MobileTaskView & {shared:{energy:number;xp:number;coins?:number;levels:number;alreadyRewarded:boolean}};
