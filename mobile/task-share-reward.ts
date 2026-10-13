import type {Platform} from './ports';
import type {MobileInviteShareResult} from '../h5/mobile-api';

/** A confirmed share is one durable request, even when its response is lost. */
export class TaskShareReward{
 private readonly key:string;
 private readonly platform:Pick<Platform,'storage'|'randomId'|'config'>;
 private readonly post:(requestId:string)=>Promise<MobileInviteShareResult>;
 private inFlight:Promise<MobileInviteShareResult>|null=null;
 constructor(platform:Pick<Platform,'storage'|'randomId'|'config'>,post:(requestId:string)=>Promise<MobileInviteShareResult>){this.platform=platform;this.post=post;this.key='jigsaw:shared:pending-share:'+platform.config.apiBase;}
 pending(){const requestId=this.platform.storage.get(this.key);return requestId&&/^[a-f0-9]{32}$/.test(requestId)?requestId:null;}
 claim(){
  if(this.inFlight)return this.inFlight;
  const requestId=this.pending()??this.platform.randomId();this.platform.storage.set(this.key,requestId);
  const promise=this.post(requestId).then(result=>{if(this.pending()===requestId)this.platform.storage.remove(this.key);return result;}).finally(()=>{if(this.inFlight===promise)this.inFlight=null;});
  this.inFlight=promise;return promise;
 }
 complete(result:Awaited<ReturnType<Platform['share']>>){return result==='copied'||result==='shared'?this.claim():Promise.resolve(null);}
}
