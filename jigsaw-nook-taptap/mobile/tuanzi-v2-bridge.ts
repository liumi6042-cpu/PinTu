import type {Platform} from './ports';
import type {GameClient} from './client';

export type TuanziV2Summary={
 collected:number;
 total:number;
 developed:number;
 unread:number;
 isAway:boolean;
 loaded:boolean;
};

export type TuanziMainPuzzleRequest={
 photoId:string;
 title:string;
 imageSrc:string;
 pieces:number;
};

interface HostBridgeGlobal{
 loadState:()=>Promise<{ok?:boolean;state?:unknown;coins?:number;playerName?:string;owner?:string}>;
 saveState:(state:unknown)=>Promise<{ok?:boolean;coins?:number}>;
 wallet:{
  read:()=>Promise<{ok?:boolean;coins?:number;owner?:string}>;
  apply:(source:string,delta:number)=>Promise<{ok?:boolean;coins?:number;delta?:number}>;
 };
 rewardedAd:{
  watch:(adUnitId:string,placementId:string)=>Promise<'completed'|'closed'|'failed'|'unavailable'>;
 };
 host:{
  close:()=>void;
  openPuzzle:(req:TuanziMainPuzzleRequest)=>void;
 };
 reportSummary:(summary:Partial<TuanziV2Summary>)=>void;
}

function resolvePackageBase():string{
 try{
  if(typeof document==='undefined')return '';
  const scripts=Array.prototype.slice.call(document.scripts||[]) as HTMLScriptElement[];
  const current=document.currentScript as HTMLScriptElement|null;
  let source=current&&current.src?current.src:'';
  if(!source){
   for(let i=scripts.length-1;i>=0;i--){
    if(scripts[i]&&scripts[i].src){source=scripts[i].src;break;}
   }
  }
  return source?new URL('./',source).href:document.baseURI;
 }catch{
  return typeof location!=='undefined'?location.href:'';
 }
}

/**
 * Hosts the full 「团子去旅行 2.0」 storybook world inside the main game (TapTap H5 / Shared Web)
 * with live shared-coin SQLite sync, TapTap rewarded ads, and 108/300-piece China postcard PuzzleBoard handoff.
 */
export class TuanziV2Controller{
 summary:TuanziV2Summary={collected:0,total:50,developed:0,unread:0,isAway:false,loaded:false};
 private overlay:HTMLDivElement|null=null;
 private releaseBack:(()=>void)|null=null;
 private loadingSummary=false;
 private loadedOwner='';

 constructor(
  private readonly platform:Platform,
  private readonly client:GameClient,
  private readonly hooks:{
   onChange:()=>void;
   onOpenMainPuzzle:(req:TuanziMainPuzzleRequest)=>void;
   onNote:(msg:string)=>void;
   watchRewardedAd:()=>Promise<'completed'|'closed'|'failed'|'unavailable'>;
  },
 ){}

 get available():boolean{
  if(typeof document==='undefined'||typeof window==='undefined')return false;
  if(this.platform.config.id==='wechat')return false;
  return this.client.config.capabilities.tuanziTravel!==false;
 }

 get isOpen():boolean{
  return this.overlay!==null;
 }

 resolveAssetUrl(relPath:string):string{
  if(!relPath)return '';
  if(/^https?:\/\//i.test(relPath))return relPath;
  const base=resolvePackageBase();
  const clean=relPath.replace(/^\.\//,'');
  const prefixed=clean.indexOf('tuanzi-v2/')===0?clean:'tuanzi-v2/'+clean;
  try{return new URL(prefixed,base).href;}catch{return '/'+prefixed;}
 }

 entryUrl(screen?:string):string{
  const base=resolvePackageBase();
  const query='?embed=1'+(screen?'&screen='+encodeURIComponent(screen):'');
  try{return new URL('tuanzi-v2/index.html'+query,base).href;}catch{return '/tuanzi-v2/index.html'+query;}
 }

 async refreshSummary(ownerKey:string,force=false):Promise<void>{
  if(!this.available||this.loadingSummary)return;
  if(!force&&this.summary.loaded&&this.loadedOwner===ownerKey)return;
  this.loadingSummary=true;
  try{
   const data=await this.client.json<{ok?:boolean;state?:any;coins?:number}>('/api/mobile/tuanzi-v2/state');
   this.loadedOwner=ownerKey;
   if(data&&data.state&&Array.isArray(data.state.postcards)){
    const cards=data.state.postcards as Array<{templateId?:string;read?:boolean;developed?:boolean}>;
    const chinaSet=new Set<string>();
    const devSet=new Set<string>();
    let unread=0;
    for(const c of cards){
     if(c&&!c.read)unread++;
     if(c&&typeof c.templateId==='string'&&c.templateId.indexOf('cn-')===0){
      chinaSet.add(c.templateId);
      if(c.developed)devSet.add(c.templateId);
     }
    }
    const letters=Array.isArray(data.state.letters)?data.state.letters as Array<{read?:boolean}>:[];
    for(const l of letters)if(l&&!l.read)unread++;
    this.summary={collected:chinaSet.size,total:50,developed:devSet.size,unread,isAway:Boolean(data.state.trip),loaded:true};
   }else{
    this.summary={collected:0,total:50,developed:0,unread:0,isAway:false,loaded:true};
   }
   this.hooks.onChange();
  }catch{
   // Silently keep default summary if server hasn't upgraded yet.
  }finally{
   this.loadingSummary=false;
  }
 }

 open(screen?:string):boolean{
  if(!this.available||this.overlay)return false;
  const hostWindow=window as unknown as {__JIGSAW_TUANZI_BRIDGE__?:HostBridgeGlobal};
  hostWindow.__JIGSAW_TUANZI_BRIDGE__={
   loadState:async()=>{
    const data=await this.client.json<{ok?:boolean;state?:unknown;coins?:number;playerName?:string}>('/api/mobile/tuanzi-v2/state');
    return {...data,owner:this.client.profile?.code||'player'};
   },
   saveState:async(state:unknown)=>{
    return await this.client.post<{ok?:boolean;coins?:number}>('/api/mobile/tuanzi-v2/sync',{state});
   },
   wallet:{
    read:async()=>{
     const data=await this.client.json<{ok?:boolean;coins?:number}>('/api/mobile/tuanzi-v2/state');
     return {ok:true,coins:data.coins,owner:this.client.profile?.code||'player'};
    },
    apply:async(source:string,delta:number)=>{
     const data=await this.client.post<{ok?:boolean;coins?:number;delta?:number}>('/api/mobile/tuanzi-v2/wallet',{source,delta});
     this.hooks.onChange();
     return data;
    },
   },
   rewardedAd:{
    watch:async()=>await this.hooks.watchRewardedAd(),
   },
   host:{
    close:()=>this.close(),
    openPuzzle:(req:TuanziMainPuzzleRequest)=>{
     this.close();
     this.hooks.onOpenMainPuzzle(req);
    },
   },
   reportSummary:(partial:Partial<TuanziV2Summary>)=>{
    this.summary={...this.summary,...partial,loaded:true};
    this.hooks.onChange();
   },
  };

  const container=document.createElement('div');
  container.id='tuanzi-v2-overlay';
  container.setAttribute('role','dialog');
  container.setAttribute('aria-label','团子的小窝 · 华夏行记');
  container.style.cssText='position:fixed;inset:0;z-index:9999;background:#1c120c;display:flex;align-items:center;justify-content:center;touch-action:auto;';

  const frame=document.createElement('iframe');
  frame.src=this.entryUrl(screen);
  frame.title='团子去旅行 2.0';
  frame.setAttribute('allow','autoplay');
  frame.style.cssText='width:100%;height:100%;border:0;display:block;background:#1c120c;';
  container.appendChild(frame);
  document.body.appendChild(container);
  this.overlay=container;

  if(this.platform.onBack){
   try{
    this.releaseBack=this.platform.onBack(()=>{
     this.close();
     return true;
    });
   }catch{}
  }
  this.hooks.onChange();
  return true;
 }

 close(){
  if(this.releaseBack){
   try{this.releaseBack();}catch{}
   this.releaseBack=null;
  }
  if(this.overlay){
   this.overlay.remove();
   this.overlay=null;
  }
  void this.client.refresh().catch(()=>{});
  this.hooks.onChange();
 }

 destroy(){
  this.close();
  try{
   const hostWindow=window as unknown as {__JIGSAW_TUANZI_BRIDGE__?:HostBridgeGlobal};
   if(hostWindow.__JIGSAW_TUANZI_BRIDGE__)delete hostWindow.__JIGSAW_TUANZI_BRIDGE__;
  }catch{}
 }
}
