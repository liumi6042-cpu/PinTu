import { h5Config } from './config';
import { mobilePost, requestId, type MobileInviteShareResult } from './mobile-api';

function storageKey(){return 'jigsaw:mobile-pending-share:'+h5Config().apiBase;}
let memoryPending:{key:string;id:string}|null=null;
let inFlight:{key:string;promise:Promise<MobileInviteShareResult>}|null=null;

/** One completed share can be retried from either the task sheet or a room. */
export function pendingShareRewardId():string|null{
 const key=storageKey();
 try{const id=sessionStorage.getItem(key)||'';if(/^[a-f0-9]{32}$/.test(id)){memoryPending={key,id};return id;}}catch{}
 return memoryPending?.key===key?memoryPending.id:null;
}
function retain(key:string,id:string){memoryPending={key,id};try{sessionStorage.setItem(key,id);}catch{}announce();}
function clear(key:string,id:string){
 if(memoryPending?.key===key&&memoryPending.id===id)memoryPending=null;
 try{if(sessionStorage.getItem(key)===id)sessionStorage.removeItem(key);}catch{}
 announce();
}
function announce(){window.dispatchEvent(new Event('mobile:share-pending'));}

/** Call only after an explicit successful system share or invitation-link copy. */
export function claimMobileShareReward():Promise<MobileInviteShareResult>{
 const key=storageKey();if(inFlight?.key===key)return inFlight.promise;
 const id=pendingShareRewardId()??requestId();retain(key,id);
 const promise=mobilePost<MobileInviteShareResult>('/api/mobile/invitations/share',{requestId:id})
  .then(result=>{clear(key,id);return result;})
  .finally(()=>{if(inFlight?.promise===promise)inFlight=null;});
 inFlight={key,promise};return promise;
}
