import type {Platform} from './ports';

export type CachedImage={image:HTMLImageElement;loaded:boolean;failed:boolean};
type Entry=CachedImage&{url:string;state:'queued'|'loading'|'loaded'|'failed';frame:number;used:number;pinned:boolean;bytes:number;cancel?:()=>void;timer?:ReturnType<typeof setTimeout>};
type Options={maxBytes?:number;maxEntries?:number;maxLoading?:number;loadTimeoutMs?:number};
const MIB=1024*1024;

/** Decoded-image cache, separate from WeChat's bounded public-file cache. */
export class StageImageCache{
 private readonly entries=new Map<string,Entry>();
 private readonly platform:Pick<Platform,'config'|'createImage'|'setImageSource'>;private readonly changed:()=>void;
 private readonly maxBytes:number;private readonly maxEntries:number;private readonly maxLoading:number;private readonly loadTimeout:number;
 private frame=0;private serial=0;private loading=0;private pumping=false;private destroyed=false;private drawing=false;
 constructor(platform:Pick<Platform,'config'|'createImage'|'setImageSource'>,changed:()=>void,options:Options={}){
  this.platform=platform;this.changed=changed;
  this.maxBytes=Math.max(1,options.maxBytes??64*MIB);this.maxEntries=Math.max(1,options.maxEntries??96);this.maxLoading=Math.max(1,options.maxLoading??6);this.loadTimeout=Math.max(1,options.loadTimeoutMs??20_000);
 }
 beginFrame(){this.frame++;this.drawing=true;}
 use(url:string,pinned=false):CachedImage{
  let entry=this.entries.get(url);
  if(!entry){entry={url,image:this.platform.createImage(),loaded:false,failed:false,state:'queued',frame:this.frame,used:++this.serial,pinned,bytes:0};if(this.destroyed)return entry;this.entries.set(url,entry);}
  entry.frame=this.frame;entry.used=++this.serial;entry.pinned||=pinned;
  if(entry.state==='queued')this.pump();return entry;
 }
 /** Keep the complete visible working set, even when it temporarily exceeds a budget. */
 endFrame(){
  if(this.destroyed)return;this.drawing=false;
  for(const entry of this.entries.values())if(!this.protected(entry)&&(entry.state==='queued'||entry.state==='loading'))this.remove(entry);
  this.trim();this.pump();
 }
 retryFailed(){for(const entry of this.entries.values())if(entry.failed)this.remove(entry);}
 destroy(){if(this.destroyed)return;this.destroyed=true;for(const entry of this.entries.values())this.remove(entry);}
 diagnostics(){const values=[...this.entries.values()];return{entries:values.length,decodedBytes:values.reduce((n,e)=>n+e.bytes,0),loading:this.loading,queued:values.filter(e=>e.state==='queued').length,pinned:values.filter(e=>e.pinned).length,maxBytes:this.maxBytes,maxEntries:this.maxEntries,maxLoading:this.maxLoading};}
 private protected(entry:Entry){return entry.pinned||entry.frame===this.frame;}
 private current(entry:Entry){return !this.destroyed&&this.entries.get(entry.url)===entry;}
 private pump(){
  if(this.destroyed||this.pumping)return;this.pumping=true;
  try{while(this.loading<this.maxLoading){
   const next=[...this.entries.values()].filter(e=>e.state==='queued'&&this.protected(e)).sort((a,b)=>Number(b.pinned)-Number(a.pinned)||b.frame-a.frame||a.used-b.used)[0];
   if(!next)break;this.start(next);
  }}finally{this.pumping=false;}
 }
 private start(entry:Entry){
  const image=entry.image;entry.state='loading';this.loading++;
  const finish=(loaded:boolean)=>{
   if(!this.current(entry)||entry.state!=='loading')return;
   entry.state=loaded?'loaded':'failed';entry.loaded=loaded;entry.failed=!loaded;this.loading--;clearTimeout(entry.timer);entry.timer=undefined;
   if(loaded){const width=Number(image.naturalWidth||image.width||1),height=Number(image.naturalHeight||image.height||1);entry.bytes=Math.max(1,width)*Math.max(1,height)*4;}
   // A host loader may hold a local-file lease until cancelled; its release
   // must also run when loading failed or callbacks complete synchronously.
   image.onload=null;image.onerror=null;const cancel=entry.cancel;entry.cancel=undefined;try{cancel?.();}catch{}if(!loaded)this.clearSource(image);
   if(!this.drawing)this.trim();this.changed();this.pump();
  };
  image.onload=()=>finish(true);image.onerror=()=>finish(false);entry.timer=setTimeout(()=>finish(false),this.loadTimeout);
  try{
   if(this.platform.config.id!=='wechat')image.crossOrigin='anonymous';
   if(this.platform.setImageSource){const cancel=this.platform.setImageSource(image,entry.url);if(this.current(entry)&&entry.state==='loading')entry.cancel=cancel;else cancel();}
   else image.src=entry.url;
  }catch{finish(false);}
 }
 private trim(){
  let bytes=[...this.entries.values()].reduce((n,e)=>n+e.bytes,0);
  if(bytes<=this.maxBytes&&this.entries.size<=this.maxEntries)return;
  for(const entry of [...this.entries.values()].filter(e=>!this.protected(e)).sort((a,b)=>a.used-b.used)){
   if(bytes<=this.maxBytes&&this.entries.size<=this.maxEntries)break;bytes-=entry.bytes;this.remove(entry);
  }
 }
 private remove(entry:Entry){
  if(this.entries.get(entry.url)!==entry)return;this.entries.delete(entry.url);
  if(entry.state==='loading')this.loading--;clearTimeout(entry.timer);entry.timer=undefined;entry.image.onload=null;entry.image.onerror=null;
  const cancel=entry.cancel;entry.cancel=undefined;try{cancel?.();}catch{}
  // Drop the native decoded resource as well as the Map reference. Callbacks
  // captured before cancellation are guarded by entry identity above.
  this.clearSource(entry.image);
 }
 private clearSource(image:HTMLImageElement){try{if(typeof image.removeAttribute==='function')image.removeAttribute('src');else image.src='';}catch{}}
}
