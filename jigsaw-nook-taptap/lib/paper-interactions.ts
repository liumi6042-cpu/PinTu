export const PAPER_PIECE_PATH='M 12 12 H 39 C 32 -1 68 -1 61 12 H 88 V 39 C 75 32 75 68 88 61 V 88 H 61 C 68 75 32 75 39 88 H 12 V 61 C -1 68 -1 32 12 39 Z';
export const clamp=(value:number,min:number,max:number)=>Math.max(min,Math.min(max,value));
export function wrapPhoto(index:number,length:number){return length>0?((index%length)+length)%length:0;}
export function reelDestination(position:number,velocity:number){return Math.round(position+clamp(velocity*200,-3,3));}
export function surpriseIndex(length:number,previous:number,random=Math.random()){
 if(length<=1)return 0;
 const valid=previous>=0&&previous<length,candidate=Math.floor(clamp(random,0,1-Number.EPSILON)*(length-(valid?1:0)));
 return valid&&candidate>=previous?candidate+1:candidate;
}
export function reducedPaperMotion(){return typeof window!=='undefined'&&window.matchMedia('(prefers-reduced-motion: reduce)').matches;}
export function paperPause(milliseconds:number,signal:AbortSignal){
 return new Promise<void>((resolve,reject)=>{
  if(signal.aborted){reject(new DOMException('已取消','AbortError'));return;}
  const abort=()=>{clearTimeout(timer);reject(new DOMException('已取消','AbortError'));};
  const timer=setTimeout(()=>{signal.removeEventListener('abort',abort);resolve();},milliseconds);
  signal.addEventListener('abort',abort,{once:true});
 });
}
