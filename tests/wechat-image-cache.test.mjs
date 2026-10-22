import test from 'node:test';
import assert from 'node:assert/strict';
import {WechatImageCache} from '../mobile/wechat-image-cache.ts';

const BASE='https://jigsawnook.online/h5-mobile-v3/assets';
const ROOT='wxfile://usr/jigsaw-public-images-v1';
const url=n=>`${BASE}/puzzles/test-${n}-optimized-${String(n).padStart(12,'0')}.webp`;
const tick=()=>new Promise(resolve=>setTimeout(resolve,2));
const until=async fn=>{for(let i=0;i<300;i++){if(fn())return;await tick();}throw Error('fake host did not settle');};
function webp(size=64){const b=Buffer.alloc(size);b.write('RIFF');b.writeUInt32LE(size-8,4);b.write('WEBPVP8 ',8);return b;}
function host(options={}){
 const files=options.files??new Map(),directories=new Set(['wxfile://usr']),changes=[],downloads=[],sources=[];
 let peak=0,active=0,seq=0;
 const stats={get peak(){return peak;},get active(){return active;}};
 const missing=()=>({errMsg:'ENOENT: file not exist'});
 const fs={};
 const fsMethod=(name,action)=>fs[name]=o=>queueMicrotask(()=>{
  try{if(options.failFs?.(name,o))throw Error('storage quota or permission failure');const result=action(o);o.success?.(result??{});}catch(error){o.fail?.(error);}
 });
 fsMethod('mkdir',o=>{directories.add(o.dirPath);});
 fsMethod('access',o=>{if(!files.has(o.path)&&!directories.has(o.path))throw missing();});
 fsMethod('getFileInfo',o=>{const b=files.get(o.filePath);if(b===undefined)throw missing();return {size:Buffer.byteLength(b)};});
 fsMethod('readFile',o=>{const b=files.get(o.filePath);if(b===undefined)throw missing();if(o.encoding)return {data:b.toString()};const result=Buffer.from(b).subarray(o.position??0,(o.position??0)+(o.length??b.length));return {data:Uint8Array.from(result).buffer};});
 fsMethod('writeFile',o=>{changes.push(['write',o.filePath]);files.set(o.filePath,Buffer.from(o.data));});
 fsMethod('rename',o=>{changes.push(['rename',o.oldPath,o.newPath]);if(!files.has(o.oldPath))throw missing();files.set(o.newPath,files.get(o.oldPath));files.delete(o.oldPath);});
 fsMethod('copyFile',o=>{changes.push(['copy',o.srcPath,o.destPath]);if(!files.has(o.srcPath))throw missing();files.set(o.destPath,Buffer.from(files.get(o.srcPath)));});
 fsMethod('unlink',o=>{changes.push(['unlink',o.filePath]);if(!files.delete(o.filePath))throw missing();});
 fsMethod('readdir',o=>({files:[...files.keys()].filter(path=>path.startsWith(o.dirPath+'/')).map(path=>path.slice(o.dirPath.length+1)).filter(name=>!name.includes('/'))}));
 const wx={env:{USER_DATA_PATH:'wxfile://usr'},getFileSystemManager:()=>fs,
  createImage(){
   const image={onload:null,onerror:null,width:0,height:0,_src:''};
   Object.defineProperty(image,'src',{get(){return this._src;},set(value){
    this._src=value;sources.push(value);const expected=value;
    setTimeout(()=>{if(image._src!==expected)return;const remote=/^https:/.test(value),b=files.get(value);const valid=remote?options.remoteSuccess!==false:b&&b.toString('ascii',0,4)==='RIFF'&&b[20]!==255;
     if(valid){image.width=100;image.height=80;image.onload?.(new Event('load'));}else image.onerror?.(new Event('error'));
    },options.imageDelay??0);
   }});return image;
  },
  downloadFile(o){
   downloads.push(o.url);active++;peak=Math.max(peak,active);const n=++seq,behavior=options.response?.(o.url,n)??{};
   let headers,ended=false;const task={onHeadersReceived(fn){headers=fn;},offHeadersReceived(){headers=null;},abort(){if(ended)return;ended=true;active--;o.fail?.({errMsg:'abort'});}};
   setTimeout(()=>{
    if(ended)return;if(behavior.hang)return;
    headers?.({header:{'Content-Type':behavior.type??'image/webp',...(behavior.length?{'Content-Length':behavior.length}:{})}});
    if(ended)return;ended=true;active--;
    if(behavior.fail){o.fail?.({errMsg:'network failed'});return;}
    const path=`${options.tempPrefix??'wxfile://tmp'}/download-${n}.webp`;files.set(path,behavior.body??webp());o.success?.({statusCode:behavior.status??200,tempFilePath:path});
   },options.downloadDelay??0);return task;
  },
 };
 return {wx,files,changes,downloads,sources,stats};
}
function load(cache,h,src){
 const image=h.wx.createImage();let success=0,failure=0;
 const done=new Promise(resolve=>{image.onload=()=>{success++;resolve(true);};image.onerror=()=>{failure++;resolve(false);};});
 const cancel=cache.setImageSource(image,src);return {image,done,cancel,get success(){return success;},get failure(){return failure;}};
}
const cache=(h,options={})=>new WechatImageCache(h.wx,BASE,{timeoutMs:100,...options});
const stored=h=>[...h.files.keys()].filter(path=>path.startsWith(ROOT+'/')&&path.endsWith('.webp'));
const index=h=>JSON.parse(h.files.get(ROOT+'/index.json').toString());

test('cold load persists one validated public image; next launch reads it with zero downloads',async()=>{
 const h=host(),first=load(cache(h),h,url(1));assert.equal(await first.done,true);assert.equal(h.downloads.length,1);assert.equal(stored(h).length,1);
 assert.equal(h.files.has('wxfile://tmp/download-1.webp'),false,'successful durable copy does not retain a second temp file');
 const next=host({files:h.files}),second=load(cache(next),next,url(1));assert.equal(await second.done,true);assert.equal(next.downloads.length,0);assert.equal(second.image.src,first.image.src);assert.equal(second.success,1);
});

test('DevTools http://tmp host paths are validated and persisted like native wxfile paths',async()=>{
 const h=host({tempPrefix:'http://tmp'}),a=load(cache(h),h,url(1));assert.equal(await a.done,true);assert.equal(h.downloads.length,1);assert.equal(stored(h).length,1);assert.match(a.image.src,/^wxfile:\/\/usr\/jigsaw-public-images-v1\//);
});

test('cache never saves API/private/foreign/query/packaged or unhashed image URLs',async()=>{
 const h=host(),c=cache(h),excluded=['assets/ui/icon.png',`${BASE}/puzzles/source.png`,`${BASE}/uploads/private-play-123456789012.webp`,`${BASE}/puzzles/../private-play-123456789012.webp`,url(1)+'?token=private',url(1)+'#fragment',url(1).replace('jigsawnook.online','foreign.example'),`${BASE}/api/rooms`,`${BASE}/puzzles/name-optimized-123456789012.webp/extra`];
 for(const value of excluded){assert.equal(c.eligible(value),false);const attempt=load(c,h,value);await attempt.done;}
 assert.equal(h.downloads.length,0);assert.equal(h.changes.length,0);
});

test('duplicate requests share a download and concurrent different downloads never exceed three',async()=>{
 const h=host({downloadDelay:15}),c=cache(h);const jobs=[...Array.from({length:7},(_,i)=>load(c,h,url(i+1))),load(c,h,url(2)),load(c,h,url(2))];
 assert.ok((await Promise.all(jobs.map(j=>j.done))).every(Boolean));assert.equal(h.downloads.length,7);assert.equal(h.stats.peak,3);assert.equal(stored(h).length,7);
});

test('room image receives the next download slot ahead of queued gallery thumbnails',async()=>{
 const h=host({downloadDelay:25}),c=cache(h,{timeoutMs:500,queueWaitMs:400});
 const thumbnails=Array.from({length:5},(_,i)=>load(c,h,url(i+1).replace('-optimized-','-thumbnail-')));
 await until(()=>h.downloads.length===3);const room=load(c,h,url(20));
 assert.ok((await Promise.all([...thumbnails,room].map(job=>job.done))).every(Boolean));
 assert.equal(h.downloads[3],url(20));assert.equal(h.stats.peak,3);
});

test('blocked room image queue quickly falls back without starting extra cache downloads',async()=>{
 const h=host({downloadDelay:80}),c=cache(h,{timeoutMs:500,queueWaitMs:10});
 const thumbnails=Array.from({length:5},(_,i)=>load(c,h,url(i+1).replace('-optimized-','-thumbnail-')));
 await until(()=>h.downloads.length===3);const room=load(c,h,url(20));
 assert.equal(await room.done,true);assert.equal(room.image.src,url(20),'short queue timeout uses ordinary native image loading');
 assert.equal(h.downloads.length,3,'fallback does not start a fourth cache download');
 assert.ok((await Promise.all(thumbnails.map(job=>job.done))).every(Boolean));
 assert.equal(h.downloads.length,5,'timed-out room waiter is removed permanently');assert.equal(h.stats.peak,3);
});

test('cancelled consumer never changes source or fires callbacks while shared cache download completes',async()=>{
 const h=host({downloadDelay:15}),c=cache(h),a=load(c,h,url(1)),b=load(c,h,url(1));a.cancel();
 assert.equal(await b.done,true);assert.equal(a.image.src,'');assert.equal(a.success+a.failure,0);assert.equal(h.downloads.length,1);assert.equal(stored(h).length,1);
});

test('cancelling an already assigned image suppresses its later load event',async()=>{
 const h=host({imageDelay:15}),c=cache(h),first=load(c,h,url(1));await until(()=>first.image.src!=='');first.cancel();await new Promise(resolve=>setTimeout(resolve,25));assert.equal(first.success+first.failure,0);
});

test('LRU uses both byte and file limits; recently reused files survive eviction',async()=>{
 let time=0;const h=host(),c=cache(h,{maxBytes:128,maxFiles:2,now:()=>++time});
 for(const n of [1,2,1,3])assert.equal(await load(c,h,url(n)).done,true);
 assert.deepEqual(index(h).entries.map(e=>e.url).sort(),[url(1),url(3)].sort());assert.equal(stored(h).length,2);assert.equal(h.downloads.length,3);
 const d=host(),countCache=cache(d,{maxFiles:1});await load(countCache,d,url(1)).done;await load(countCache,d,url(2)).done;assert.equal(stored(d).length,1);
});

test('missing or decoder-rejected cached file is evicted and downloaded again, with final callback only',async()=>{
 for(const damage of ['missing','size','decode']){
  const h=host(),c=cache(h);await load(c,h,url(1)).done;const path=stored(h)[0];
  if(damage==='missing')h.files.delete(path);else if(damage==='size')h.files.set(path,Buffer.from('broken'));else h.files.get(path)[20]=255;
  const result=load(c,h,url(1));assert.equal(await result.done,true,damage);assert.equal(result.success,1);assert.equal(result.failure,0);assert.equal(h.downloads.length,2,damage);assert.equal(stored(h).length,1);
 }
});

test('failed status, response type, malformed bytes, oversized or undecodable files are never cached',async()=>{
 const broken=webp();broken[20]=255;
 for(const behavior of [{status:404},{type:'text/html'},{body:Buffer.from('<html>error</html>')},{body:webp(129)},{body:broken},{fail:true}]){
  const h=host({response:()=>behavior}),c=cache(h,{maxFileBytes:128});const result=load(c,h,url(1));assert.equal(await result.done,true);assert.equal(result.image.src,url(1));assert.equal(stored(h).length,0);assert.equal(index(h).entries.length,0);
 }
});

test('storage unavailable falls back to network and a copy quota failure uses the validated temp file',async()=>{
 const unavailable=host({failFs:name=>['mkdir','access'].includes(name)}),u=load(cache(unavailable),unavailable,url(1));assert.equal(await u.done,true);assert.equal(u.image.src,url(1));assert.equal(unavailable.downloads.length,0);
 const full=host({failFs:name=>name==='copyFile'}),a=load(cache(full),full,url(1));assert.equal(await a.done,true);assert.match(a.image.src,/^wxfile:\/\/tmp/);assert.equal(stored(full).length,0);
});

test('failed eviction cannot exceed the persistent quota or remove any unrelated files',async()=>{
 let block=false;const h=host({failFs:name=>block&&name==='unlink'}),c=cache(h,{maxFiles:1});h.files.set('wxfile://usr/player-save.json',Buffer.from('private'));
 await load(c,h,url(1)).done;block=true;assert.equal(await load(c,h,url(2)).done,true);assert.equal(stored(h).length,1);assert.equal(h.files.get('wxfile://usr/player-save.json').toString(),'private');
 assert.ok(h.changes.filter(c=>c[0]==='unlink').every(c=>c[1].startsWith(ROOT+'/')||/^wxfile:\/\/tmp\/download-\d+\.webp$/.test(c[1])));
});

test('download timeout aborts and falls back, while final network errors fire once',async()=>{
 const h=host({response:()=>({hang:true}),remoteSuccess:false}),c=cache(h,{timeoutMs:25}),a=load(c,h,url(1));assert.equal(await a.done,false);assert.equal(a.failure,1);assert.equal(a.success,0);assert.equal(h.stats.active,0);assert.equal(stored(h).length,0);
});

test('tampered index paths and orphan files cannot affect other data; new cache still works',async()=>{
 const h=host();h.files.set('wxfile://usr/player-save.json',Buffer.from('private'));h.files.set(ROOT+'/index.json',Buffer.from(JSON.stringify({version:1,entries:[{url:url(1),file:'../../player-save.json',size:7,used:1}]})));h.files.set(ROOT+'/0000000000000000.webp',webp());h.files.set(ROOT+'/leave-me.txt',Buffer.from('unknown'));
 assert.equal(await load(cache(h),h,url(1)).done,true);assert.equal(stored(h).length,1);assert.equal(h.files.get('wxfile://usr/player-save.json').toString(),'private');assert.equal(h.files.get(ROOT+'/leave-me.txt').toString(),'unknown');
 assert.ok(h.changes.filter(c=>c[0]==='unlink').every(c=>/^wxfile:\/\/(?:usr\/jigsaw-public-images-v1\/[a-f0-9]{16}|tmp\/download-\d+)\.webp$/.test(c[1])));
});

test('cache operates without browser URL or crypto globals',async()=>{
 const original=Object.getOwnPropertyDescriptor(globalThis,'URL'),crypto=Object.getOwnPropertyDescriptor(globalThis,'crypto');
 try{Object.defineProperty(globalThis,'URL',{configurable:true,value:undefined});Object.defineProperty(globalThis,'crypto',{configurable:true,value:undefined});const h=host();assert.equal(await load(cache(h),h,url(1)).done,true);assert.equal(stored(h).length,1);}finally{Object.defineProperty(globalThis,'URL',original);if(crypto)Object.defineProperty(globalThis,'crypto',crypto);else delete globalThis.crypto;}
});
