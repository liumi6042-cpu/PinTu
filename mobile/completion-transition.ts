import type {Rect} from './ports';
import {completionCelebration,type CelebrationScene} from './completion-celebration';
export {COMPLETION_BURST_MS} from './completion-celebration';

export const COMPLETION_SEAM_MS=900,COMPLETION_CAMERA_MS=900,COMPLETION_CELEBRATE_MS=900,COMPLETION_SWEEP_END_MS=2000,COMPLETION_BANNER_END_MS=1120,COMPLETION_BANNER_ALPHA_END_MS=1020,COMPLETION_POPUP_MS=3200;
type Camera=Readonly<{x:number;y:number;z:number}>;
const clamp=(n:number)=>Math.max(0,Math.min(1,n));
export class CompletionTransition{
 readonly start:number;readonly from:Camera|null;readonly to:Camera|null;
 private readonly centre:{x:number;y:number};private dropped=false;private celebrated=false;readonly celebration:CelebrationScene;
 constructor(start:number,from:Camera|null=null,to:Camera|null=null,rect:Rect={x:0,y:0,w:0,h:0}){
  this.start=start;this.from=from?{...from}:null;this.to=to?{...to}:null;this.centre={x:rect.w/2,y:rect.h/2};
  this.celebration=completionCelebration(start+COMPLETION_CELEBRATE_MS);
 }
 seam(now:number){const t=clamp((now-this.start)/COMPLETION_SEAM_MS);return t*t*(3-2*t);}
 camera(now:number):Camera|null{
  const a=this.from,b=this.to,c=this.centre;if(this.dropped||!a||!b)return null;
  const ax=(c.x-a.x)/a.z,ay=(c.y-a.y)/a.z,bx=(c.x-b.x)/b.z,by=(c.y-b.y)/b.z;
  if(Math.max(a.z/b.z,b.z/a.z)<=1.02&&Math.hypot((ax-bx)*b.z,(ay-by)*b.z)<4)return null;
  const t=clamp((now-this.start)/COMPLETION_CAMERA_MS);if(t===0)return {...a};if(t===1)return {...b};const e=t<.5?4*t*t*t:1-Math.pow(-2*t+2,3)/2,z=a.z*Math.pow(b.z/a.z,e);return {x:c.x-(ax+(bx-ax)*e)*z,y:c.y-(ay+(by-ay)*e)*z,z};
 }
 get cameraDropped(){return this.dropped;}
 dropCamera(){this.dropped=true;}
 celebrateDue(now:number){if(this.celebrated||now-this.start<COMPLETION_CELEBRATE_MS)return false;this.celebrated=true;return true;}
 sweep(now:number){const t=now-this.start;return t<COMPLETION_CELEBRATE_MS||t>COMPLETION_SWEEP_END_MS?null:(1-Math.cos(Math.PI*(t-COMPLETION_CELEBRATE_MS)/(COMPLETION_SWEEP_END_MS-COMPLETION_CELEBRATE_MS)))/2;}
 banner(now:number){const t=now-this.start;if(t<COMPLETION_CELEBRATE_MS)return null;const p=clamp((t-COMPLETION_CELEBRATE_MS)/(COMPLETION_BANNER_END_MS-COMPLETION_CELEBRATE_MS)),u=p-1;return {scale:p===1?1:.6+.4*(1+2.70158*u*u*u+1.70158*u*u),alpha:clamp((t-COMPLETION_CELEBRATE_MS)/(COMPLETION_BANNER_ALPHA_END_MS-COMPLETION_CELEBRATE_MS))};}
 popupDue(now:number){return now-this.start>=COMPLETION_POPUP_MS;}
}
