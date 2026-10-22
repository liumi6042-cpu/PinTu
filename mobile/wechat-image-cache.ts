// Only immutable public puzzle images belong here. Player data, API replies,
// private uploads and packaged artwork never enter this filesystem directory.
type Host=Record<string,any>;
type Entry={url:string;file:string;size:number;used:number};
type Source={path:string;local:boolean};
type CacheOptions={maxBytes?:number;maxFiles?:number;maxFileBytes?:number;timeoutMs?:number;queueWaitMs?:number;now?:()=>number};
type DownloadWaiter={resolve:(acquired:boolean)=>void;priority:boolean;timer?:ReturnType<typeof setTimeout>};
const MIB=1024*1024,OWNED_FILE=/^[a-f0-9]{16}\.webp$/;
const assetName=/^[a-z0-9]+(?:-[a-z0-9]+)*-(?:optimized|play|thumbnail)-[a-f0-9]{12}\.webp$/;

// The full URL is also stored and checked: this hash is a filename, not an
// integrity or security claim. No browser URL/crypto globals are needed by wx.
function fileKey(value:string):string{
 let a=2166136261,b=3339675911;
 for(let i=0;i<value.length;i++){a=Math.imul(a^value.charCodeAt(i),16777619);b=Math.imul(b^value.charCodeAt(i),2246822519);}
 return (a>>>0).toString(16).padStart(8,'0')+(b>>>0).toString(16).padStart(8,'0')+'.webp';
}

export class WechatImageCache{
 private readonly wx:Host;
 private readonly directory:string;
 private readonly fs:Host|undefined;
 private readonly prefix:string;
 private readonly maxBytes:number;
 private readonly maxFiles:number;
 private readonly maxFileBytes:number;
 private readonly timeout:number;
 private readonly queueWait:number;
 private readonly now:()=>number;
 private readonly entries=new Map<string,Entry>();
 private readonly pending=new Map<string,Promise<Source|null>>();
 private readonly imageJobs=new WeakMap<HTMLImageElement,()=>void>();
 private readonly leases=new Map<string,number>();
 private ready:Promise<boolean>|undefined;
 private mutations:Promise<unknown>=Promise.resolve();
 private enabled=true;
 private activeDownloads=0;
 private readonly waiters:DownloadWaiter[]=[];

 constructor(wx:Host,assetBase:string,options:CacheOptions={}){
  this.wx=wx;
  this.prefix=assetBase.replace(/\/$/,'')+'/puzzles/';
  this.directory=typeof wx.env?.USER_DATA_PATH==='string'?wx.env.USER_DATA_PATH.replace(/\/$/,'')+'/jigsaw-public-images-v1':'';
  try{this.fs=wx.getFileSystemManager?.();}catch{}
  this.maxBytes=options.maxBytes??32*MIB;this.maxFiles=options.maxFiles??256;this.maxFileBytes=options.maxFileBytes??8*MIB;
  this.timeout=options.timeoutMs??15000;this.queueWait=options.queueWaitMs??1000;this.now=options.now??Date.now;
 }

 eligible(url:string):boolean{return /^https:\/\//.test(this.prefix)&&url.startsWith(this.prefix)&&assetName.test(url.slice(this.prefix.length));}

 /** Captures existing callbacks; consumers must install them before this call. */
 setImageSource(image:HTMLImageElement,url:string):()=>void{
  const loaded=image.onload,failed=image.onerror;this.imageJobs.get(image)?.();
  let live=true,leased='',attempt=0,loadTimer:ReturnType<typeof setTimeout>|undefined;
  const release=()=>{if(loadTimer)clearTimeout(loadTimer);loadTimer=undefined;if(leased){const n=(this.leases.get(leased)||1)-1;if(n)this.leases.set(leased,n);else this.leases.delete(leased);leased='';}};
  let onload:((event:Event)=>void)|null=null,onerror:((event:Event|string)=>void)|null=null;
  const cancel=()=>{if(!live)return;live=false;release();if(image.onload===onload)image.onload=null;if(image.onerror===onerror)image.onerror=null;if(this.imageJobs.get(image)===cancel)this.imageJobs.delete(image);};
  const finish=(ok:boolean,event:Event|string)=>{if(!live)return;cancel();if(ok)loaded?.call(image,event as Event);else failed?.call(image,event);};
  const use=(source:Source,retry:boolean)=>{
   if(!live)return;release();const ticket=++attempt;
   if(source.local&&source.path.startsWith(this.directory+'/')){leased=source.path;this.leases.set(leased,(this.leases.get(leased)||0)+1);}
   onload=event=>{if(ticket===attempt)finish(true,event);};
   onerror=event=>{
    if(!live||ticket!==attempt)return;attempt++;release();image.onload=null;image.onerror=null;
    if(!source.local){finish(false,event);return;}
    // A file removed by the OS, or one rejected by the native decoder, must
    // never poison the next launch. Retry the immutable URL once, then allow
    // the host's ordinary network image path as a storage-independent fallback.
    void this.invalidate(url,source.path).then(()=>retry?this.resolve(url):null).then(next=>{if(live)use(next??{path:url,local:false},false);});
   };
   image.onload=onload;image.onerror=onerror;
   loadTimer=setTimeout(()=>onerror?.('image load timeout'),this.timeout);
   try{image.src=source.path;}catch{onerror('image source rejected');}
  };
  this.imageJobs.set(image,cancel);
  if(!this.eligible(url))use({path:url,local:false},false);
  else void this.resolve(url).then(source=>{if(live)use(source??{path:url,local:false},true);});
  return cancel;
 }

 private path(file:string):string{if(!OWNED_FILE.test(file))throw Error('invalid cache filename');return this.directory+'/'+file;}
 private async call(method:string,options:Host):Promise<Host>{
  return new Promise((resolve,reject)=>{
   let settled=false;const done=(error:unknown,value?:Host)=>{if(settled)return;settled=true;clearTimeout(timer);error?reject(error):resolve(value||{});};
   const timer=setTimeout(()=>done(Error('image filesystem timeout')),Math.min(this.timeout,5000));
   try{if(typeof this.fs?.[method]!=='function')throw Error('image filesystem unavailable');this.fs[method]({...options,success:(r:Host)=>done(null,r),fail:(e:unknown)=>done(e||Error(method))});}catch(e){done(e);}
  });
 }
 private serialize<T>(run:()=>Promise<T>):Promise<T>{const result=this.mutations.then(run,run);this.mutations=result.catch(()=>{});return result;}
 private async remove(file:string):Promise<boolean>{
  try{await this.call('unlink',{filePath:this.path(file)});return true;}catch{
   try{await this.call('access',{path:this.path(file)});return false;}catch(error){return /ENOENT|no such file|not exist/i.test(String((error as Host)?.errMsg??error));}
  }
 }
 private async persist():Promise<void>{
  const index=this.directory+'/index.json',temp=this.directory+'/index.tmp';
  await this.call('writeFile',{filePath:temp,data:JSON.stringify({version:1,entries:[...this.entries.values()]}),encoding:'utf8'});
  await this.call('rename',{oldPath:temp,newPath:index});
 }
 private init():Promise<boolean>{
  if(this.ready)return this.ready;
  this.ready=(async()=>{
   if(!this.directory||!this.fs||!this.wx.downloadFile||!this.wx.createImage)return false;
   try{
    try{await this.call('mkdir',{dirPath:this.directory,recursive:true});}catch{await this.call('access',{path:this.directory});}
    try{
     const info=await this.call('getFileInfo',{filePath:this.directory+'/index.json'});
     if(!Number.isSafeInteger(Number(info.size))||Number(info.size)<2||Number(info.size)>256*1024)throw Error('invalid image index size');
     const raw=JSON.parse(String((await this.call('readFile',{filePath:this.directory+'/index.json',encoding:'utf8'})).data));
     if(raw.version===1&&Array.isArray(raw.entries))for(const e of raw.entries.slice(0,512)){
      if(e&&typeof e.url==='string'&&this.eligible(e.url)&&e.file===fileKey(e.url)&&Number.isSafeInteger(e.size)&&e.size>0&&e.size<=this.maxFileBytes&&Number.isFinite(e.used))this.entries.set(e.url,{url:e.url,file:e.file,size:e.size,used:Math.min(e.used,this.now())});
     }
    }catch{this.entries.clear();}
    // Only our generated filenames inside our own directory may be removed.
    // Interrupted writes and corrupt indices cannot make cleanup escape it.
    const files=(await this.call('readdir',{dirPath:this.directory})).files;
    if(Array.isArray(files)){
     const names=new Set(files);for(const [url,e]of this.entries)if(!names.has(e.file))this.entries.delete(url);
     const retained=new Set([...this.entries.values()].map(e=>e.file));
     for(const file of files)if(typeof file==='string'&&OWNED_FILE.test(file)&&!retained.has(file)&&!await this.remove(file))throw Error('image cleanup unavailable');
    }
    if(!await this.trim(0,0))throw Error('image cache over limit');await this.persist();return true;
   }catch{this.enabled=false;return false;}
  })();return this.ready;
 }
 private async trim(extraBytes:number,extraFiles:number):Promise<boolean>{
  let bytes=[...this.entries.values()].reduce((n,e)=>n+e.size,0);
  for(const e of [...this.entries.values()].sort((a,b)=>a.used-b.used)){
   if(bytes+extraBytes<=this.maxBytes&&this.entries.size+extraFiles<=this.maxFiles)return true;
   if(this.leases.has(this.path(e.file)))continue;
   if(!await this.remove(e.file)){this.enabled=false;return false;}this.entries.delete(e.url);bytes-=e.size;
  }
  return bytes+extraBytes<=this.maxBytes&&this.entries.size+extraFiles<=this.maxFiles;
 }
 private async invalidate(url:string,path:string):Promise<void>{
  try{await this.serialize(async()=>{const e=this.entries.get(url);if(e&&this.path(e.file)===path){this.entries.delete(url);if(!await this.remove(e.file))this.enabled=false;await this.persist();}});}catch{this.enabled=false;}
 }
 private resolve(url:string):Promise<Source|null>{
  const prior=this.pending.get(url);if(prior)return prior;
  const work=(async()=>{
   if(!this.enabled||!this.eligible(url)||!await this.init())return null;
   const entry=this.entries.get(url);
   if(entry){
    try{
     const info=await this.call('getFileInfo',{filePath:this.path(entry.file)});
     if(Number(info.size)!==entry.size)throw Error('image cache size changed');
     await this.serialize(async()=>{if(this.entries.get(url)===entry){entry.used=this.now();await this.persist();}});
     return {path:this.path(entry.file),local:true};
    }catch{await this.invalidate(url,this.path(entry.file));}
   }
   return this.download(url);
  })().catch(()=>null);
  this.pending.set(url,work);void work.finally(()=>{if(this.pending.get(url)===work)this.pending.delete(url);});return work;
 }
 private acquire(url:string):Promise<boolean>{
  if(this.activeDownloads<3){this.activeDownloads++;return Promise.resolve(true);}
  return new Promise(resolve=>{
   const priority=/-(?:optimized|play)-[a-f0-9]{12}\.webp$/.test(url),waiter:DownloadWaiter={resolve,priority};
   // A room image must not sit behind thumbnails from a quickly scrolled
   // gallery. Give it the next slot, or use the native image loader after a
   // short wait. Thumbnails keep their bounded queue instead of stampeding it.
   const before=priority?this.waiters.findIndex(item=>!item.priority):-1;
   if(before<0)this.waiters.push(waiter);else this.waiters.splice(before,0,waiter);
   if(priority)waiter.timer=setTimeout(()=>{const index=this.waiters.indexOf(waiter);if(index>=0){this.waiters.splice(index,1);resolve(false);}},this.queueWait);
  });
 }
 private releaseDownload():void{const next=this.waiters.shift();if(next){if(next.timer)clearTimeout(next.timer);next.resolve(true);}else this.activeDownloads--;}
 private async download(url:string):Promise<Source|null>{
  if(!await this.acquire(url))return null;
  try{
   const temp=await this.fetch(url),size=await this.inspect(temp);
   // Decode before indexing, so a successful HTTP response containing broken
   // bytes (or an HTML error page) cannot become a persistent cache hit.
   await this.decode(temp);
   return await this.serialize(async()=>{
    const file=fileKey(url),path=this.path(file);
    const collision=[...this.entries.values()].some(e=>e.file===file&&e.url!==url);
    if(!this.enabled||collision||!await this.trim(size,1))return {path:temp,local:true};
    try{
     await this.call('copyFile',{srcPath:temp,destPath:path});
     const info=await this.call('getFileInfo',{filePath:path});if(Number(info.size)!==size)throw Error('incomplete image copy');
     this.entries.set(url,{url,file,size,used:this.now()});await this.persist();
     // Every consumer of this shared request now receives the durable copy.
     // This temp path came from our own download and passed filesystem/decode
     // checks; remove that duplicate, leaving other host temp files untouched.
     if(temp!==path)void this.call('unlink',{filePath:temp}).catch(()=>{});
     return {path,local:true};
    }catch{this.entries.delete(url);await this.remove(file);this.enabled=false;return {path:temp,local:true};}
   });
  }catch{return null;}finally{this.releaseDownload();}
 }
 private fetch(url:string):Promise<string>{
  return new Promise((resolve,reject)=>{
   let settled=false,task:Host|undefined,headers:Host={};
   const finish=(error:unknown,path?:string)=>{if(settled)return;settled=true;clearTimeout(timer);task?.offHeadersReceived?.(receive);error?reject(error):resolve(path!);};
   const receive=(r:Host)=>{
    headers=r.header||{};
    const values=Object.fromEntries(Object.entries(headers).map(([k,v])=>[k.toLowerCase(),String(v)]));
    if((values['content-type']&&!/^(?:image\/webp|application\/octet-stream)(?:;|$)/i.test(values['content-type']))||Number(values['content-length'])>this.maxFileBytes){finish(Error('invalid public image response'));task?.abort?.();}
   };
   const timer=setTimeout(()=>{finish(Error('image download timeout'));task?.abort?.();},this.timeout);
   try{
    task=this.wx.downloadFile({url,timeout:this.timeout,
     // DevTools represents its local temp filesystem as http://tmp/...;
     // native phones use wxfile paths. The filesystem read and WebP validation
     // below verify this host-returned path without assuming its URI scheme.
     success:(r:Host)=>{if(settled)return;if(r.header)receive(r);if(Number(r.statusCode)!==200||typeof r.tempFilePath!=='string'||!r.tempFilePath)finish(Error('image download failed'));else finish(null,r.tempFilePath);},
     fail:()=>finish(Error('image download failed')),
    });task?.onHeadersReceived?.(receive);
   }catch(e){finish(e);}
  });
 }
 private async inspect(path:string):Promise<number>{
  const size=Number((await this.call('getFileInfo',{filePath:path})).size);
  if(!Number.isSafeInteger(size)||size<16||size>this.maxFileBytes)throw Error('invalid image size');
  const data=(await this.call('readFile',{filePath:path,position:0,length:16})).data;
  if(!(data instanceof ArrayBuffer))throw Error('invalid image bytes');
  const b=new Uint8Array(data);
  if(b.length<16||b[0]!==82||b[1]!==73||b[2]!==70||b[3]!==70||b[8]!==87||b[9]!==69||b[10]!==66||b[11]!==80||b[12]!==86||b[13]!==80||b[14]!==56||![32,76,88].includes(b[15]))throw Error('not a WebP image');
  const declared=new DataView(data).getUint32(4,true)+8;if(declared!==size)throw Error('truncated WebP image');return size;
 }
 private decode(path:string):Promise<void>{
  return new Promise((resolve,reject)=>{
   let image:HTMLImageElement|undefined,done=false;
   const finish=(ok:boolean)=>{if(done)return;done=true;clearTimeout(timer);if(image){image.onload=null;image.onerror=null;}ok?resolve():reject(Error('invalid image decode'));};
   const timer=setTimeout(()=>finish(false),this.timeout);
   try{image=this.wx.createImage();image!.onload=()=>finish(Number(image!.width)>0&&Number(image!.height)>0);image!.onerror=()=>finish(false);image!.src=path;}catch{finish(false);}
  });
 }
}
