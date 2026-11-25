/** A short, opt-in rendering comparison. It owns no game or network state. */
export const RENDER_PROBE_PHASES=['direct','room','frozen','flat'] as const;
export type RenderProbeMode=typeof RENDER_PROBE_PHASES[number];
export type RenderProbeSample={mode:RenderProbeMode;ms:number;raf:number;input:number;timer:number;touch:number|null;pointer:number|null;js:number;longTasks:number|null;longTaskMs:number|null};
type Native={touchMoves:number;pointerMoves:number};
const PHASE_MS=3500,WARMUP_MS=500;
const labels={direct:'原背景',room:'优化背景',frozen:'暂停绘图',flat:'简单画布'};
export class RenderProbe{
 private phase=0;private started=0;private measured=0;private frames=0;private submission=0;private nativeStart:Native|undefined;private painted=false;
 private moves:number[]=[];private timers:number[]=[];private tasks:{at:number;ms:number}[]=[];
 private timer:ReturnType<typeof setInterval>|undefined;private observer:PerformanceObserver|undefined;private taskSupported=false;
 private clock:()=>number;private native:()=>Native|undefined;
 readonly samples:RenderProbeSample[]=[];finished=false;disposed=false;
 constructor(clock:()=>number,native:()=>Native|undefined){
  this.clock=clock;this.native=native;
  this.started=clock();
  this.timer=setInterval(()=>{this.timers.push(clock());if(this.timers.length>1000)this.timers.shift();},20);
  if(typeof PerformanceObserver!=='undefined'&&PerformanceObserver.supportedEntryTypes?.includes('longtask'))try{
   this.observer=new PerformanceObserver(list=>this.collectTasks(list.getEntries()));this.observer.observe({entryTypes:['longtask']});this.taskSupported=true;
  }catch{this.observer?.disconnect();this.observer=undefined;}
 }
 get mode(){return RENDER_PROBE_PHASES[this.phase];}
 get label(){return `${this.phase+1}/4 ${labels[this.mode]}`;}
 input(){if(!this.finished){this.moves.push(this.clock());if(this.moves.length>3000)this.moves.shift();}}
 private collectTasks(entries:PerformanceEntry[]){for(const e of entries){this.tasks.push({at:e.startTime,ms:e.duration});if(this.tasks.length>300)this.tasks.shift();}}
 /** Called by the existing RAF loop; no second render loop is created. */
 tick(paint:(mode:RenderProbeMode,changed:boolean)=>void){
  if(this.finished||this.disposed)return;
  const at=this.clock();let changed=!this.painted;
  if(at-this.started>=PHASE_MS){
   this.collectTasks(this.observer?.takeRecords()??[]);
   const from=this.measured||this.started+WARMUP_MS,duration=Math.max(1,at-from),rate=(n:number)=>Math.round(n*1000/duration),end=this.native();
   const tasks=this.tasks.filter(e=>e.at<at&&e.at+e.ms>from);
   this.samples.push({mode:this.mode,ms:duration,raf:rate(this.frames),input:rate(this.moves.filter(t=>t>=from&&t<at).length),timer:rate(this.timers.filter(t=>t>=from&&t<at).length),touch:end&&this.nativeStart?rate(end.touchMoves-this.nativeStart.touchMoves):null,pointer:end&&this.nativeStart?rate(end.pointerMoves-this.nativeStart.pointerMoves):null,js:this.frames?this.submission/this.frames:0,longTasks:this.taskSupported?tasks.length:null,longTaskMs:this.taskSupported?tasks.reduce((sum,t)=>sum+Math.max(0,Math.min(at,t.at+t.ms)-Math.max(from,t.at)),0):null});
   if(++this.phase===RENDER_PROBE_PHASES.length){this.phase--;this.finished=true;this.dispose();return;}
   // Reset the next window after a stall instead of inventing missed phases.
   this.started=at;this.measured=0;this.frames=0;this.submission=0;this.nativeStart=undefined;this.moves=[];this.timers=[];this.tasks=[];this.painted=false;changed=true;
  }
  const measuring=at-this.started>=WARMUP_MS;
  if(measuring&&!this.measured){this.measured=at;this.nativeStart=this.native();}
  const start=this.clock();paint(this.mode,changed);this.painted=true;
  if(measuring){this.frames++;this.submission+=Math.max(0,this.clock()-start);}
 }
 dispose(){if(this.disposed)return;this.disposed=true;if(this.timer!==undefined)clearInterval(this.timer);this.observer?.disconnect();this.timer=undefined;this.observer=undefined;}
 resultLines(){return this.samples.flatMap((s,i)=>[`${i+1}. ${labels[s.mode]}：刷新 ${s.raf} · 触摸 ${s.touch??s.input}/秒`,`计时 ${s.timer}/秒 · JS ${s.js.toFixed(1)}ms · 长任务 ${s.longTasks??'不支持'}`]);}
}
