import test from 'node:test';
import assert from 'node:assert/strict';
import {StageImageCache} from '../mobile/image-cache.ts';

function fixture(options={}){
 const jobs=[],images=[];let changes=0,active=0,peak=0;
 const platform={config:{id:'wechat'},createImage(){const image={width:0,height:0,src:'',onload:null,onerror:null};images.push(image);return image;},setImageSource(image,url){
  const loaded=image.onload,failed=image.onerror,job={image,url,cancelled:false,settled:false,loaded,failed};jobs.push(job);active++;peak=Math.max(peak,active);
  job.finish=(ok=true,width=100,height=100)=>{if(!job.settled){job.settled=true;active--;}image.width=width;image.height=height;(ok?loaded:failed)?.();};
  return()=>{job.cancelled=true;if(!job.settled){job.settled=true;active--;}};
 }};
 const cache=new StageImageCache(platform,()=>changes++,options),frame=urls=>{cache.beginFrame();for(const item of urls)cache.use(typeof item==='string'?item:item.url,!!item.pinned);cache.endFrame();};
 return{cache,frame,jobs,images,get changes(){return changes;},get active(){return active;},get peak(){return peak;},finish(url,ok=true,width=100,height=100){const job=jobs.findLast(j=>j.url===url);assert.ok(job,url+' requested');job.finish(ok,width,height);return job;}};
}

test('decoded byte budget evicts the least recently used image while preserving UI atlases',()=>{
 const f=fixture({maxBytes:120_000,maxEntries:4});
 f.frame([{url:'ui',pinned:true},'a','b']);f.finish('ui');f.finish('a');f.finish('b');
 f.frame(['a']);f.frame(['c']);f.finish('c');
 assert.equal(f.cache.diagnostics().decodedBytes,120_000);assert.equal(f.jobs.find(j=>j.url==='b').image.src,'');
 const oldA=f.jobs.find(j=>j.url==='a');f.frame(['a']);assert.equal(f.jobs.filter(j=>j.url==='a').length,1);assert.equal(oldA.image.width,100);
 f.frame(['b']);assert.equal(f.jobs.filter(j=>j.url==='b').length,2);assert.equal(f.jobs.filter(j=>j.url==='ui').length,1);
 f.cache.destroy();assert.equal(f.active,0);
});

test('the whole visible working set can exceed the budget without eviction loops',()=>{
 const f=fixture({maxBytes:40_000,maxEntries:1});f.frame(['a','b']);f.finish('a');f.finish('b');
 assert.equal(f.cache.diagnostics().entries,2);f.frame(['a','b']);assert.equal(f.jobs.length,2);
 f.frame(['b']);assert.equal(f.cache.diagnostics().entries,1);assert.equal(f.jobs[0].image.src,'');
 f.cache.destroy();
});

test('loading is capped and leaving old thumbnails frees a slot for the new visible preview',()=>{
 const f=fixture({maxLoading:2,maxEntries:3});f.frame(['old-a','old-b','old-c','old-d']);assert.equal(f.jobs.length,2);assert.equal(f.cache.diagnostics().queued,2);
 const stale=f.jobs[0].loaded;f.frame(['current-preview']);assert.equal(f.jobs.filter(j=>j.url==='current-preview').length,1);assert.equal(f.jobs.some(j=>j.url==='old-c'||j.url==='old-d'),false);assert.ok(f.jobs.slice(0,2).every(j=>j.cancelled));
 const before=f.changes;stale();assert.equal(f.changes,before);assert.equal(f.cache.diagnostics().loading,1);assert.equal(f.cache.diagnostics().entries,1);assert.ok(f.peak<=2);
 f.finish('current-preview');assert.equal(f.active,0);f.cache.destroy();
});

test('failed entries require explicit retry and stale callbacks cannot revive them',()=>{
 const f=fixture();f.frame(['retry']);const first=f.finish('retry',false);assert.equal(f.changes,1);
 f.frame(['retry']);assert.equal(f.jobs.length,1);f.cache.retryFailed();f.frame(['retry']);assert.equal(f.jobs.length,2);
 first.loaded();assert.equal(f.changes,1);assert.equal(f.cache.diagnostics().loading,1);f.finish('retry');assert.equal(f.changes,2);f.cache.destroy();
});

test('success and failure both advance the visible queue without duplicate requests',()=>{
 const f=fixture({maxLoading:1});f.frame(['a','b','c']);assert.equal(f.jobs.length,1);
 f.finish('a',false);assert.deepEqual(f.jobs.map(j=>j.url),['a','b']);f.frame(['a','b','c']);assert.equal(f.jobs.length,2);
 f.finish('b');assert.deepEqual(f.jobs.map(j=>j.url),['a','b','c']);f.finish('c');assert.equal(f.active,0);assert.equal(f.cache.diagnostics().queued,0);f.cache.destroy();
});

test('a stalled native request times out, releases its lease and advances the queue',async()=>{
 const f=fixture({maxLoading:1,loadTimeoutMs:8});f.frame(['stalled','next']);const old=f.jobs[0];
 await new Promise(resolve=>setTimeout(resolve,12));assert.equal(old.cancelled,true);assert.equal(old.image.src,'');assert.deepEqual(f.jobs.map(j=>j.url),['stalled','next']);
 const changes=f.changes;old.loaded();assert.equal(f.changes,changes);f.finish('next');f.cache.destroy();
});

test('repeated list browsing remains bounded and destroy detaches callbacks and native sources',()=>{
 const f=fixture({maxBytes:160_000,maxEntries:4,maxLoading:2});
 for(let page=0;page<100;page++){
  f.frame(['page-'+page+'a','page-'+page+'b']);f.finish('page-'+page+'a');f.finish('page-'+page+'b');
  const stats=f.cache.diagnostics();assert.ok(stats.entries<=4);assert.ok(stats.decodedBytes<=160_000);assert.ok(stats.loading<=2);
 }
 f.frame(['pending']);const pending=f.jobs.findLast(j=>j.url==='pending'),before=f.changes;f.cache.destroy();pending.loaded();pending.failed();
 assert.equal(f.changes,before);assert.equal(f.active,0);assert.equal(f.cache.diagnostics().entries,0);assert.ok(f.images.every(i=>i.onload===null&&i.onerror===null&&i.src===''));
});

test('synchronous host completion still releases its cancellation lease exactly once',()=>{
 let released=0,changed=0;const platform={config:{id:'wechat'},createImage:()=>({width:10,height:20,onload:null,onerror:null,src:''}),setImageSource(image){image.onload();return()=>released++;}};
 const cache=new StageImageCache(platform,()=>changed++);cache.beginFrame();assert.equal(cache.use('sync').loaded,true);cache.endFrame();assert.equal(released,1);assert.equal(changed,1);assert.equal(cache.diagnostics().loading,0);cache.destroy();assert.equal(released,1);
});

test('a raw browser image source is cleared and late native callbacks are ignored',()=>{
 let changed=0;const created=[],platform={config:{id:'web'},createImage(){const image={width:20,height:10,src:'',onload:null,onerror:null,removeAttribute(name){assert.equal(name,'src');this.src='';}};created.push(image);return image;}};
 const cache=new StageImageCache(platform,()=>changed++);cache.beginFrame();cache.use('a');cache.endFrame();const callback=created[0].onload;assert.equal(created[0].crossOrigin,'anonymous');cache.beginFrame();cache.endFrame();callback();assert.equal(changed,0);assert.equal(created[0].src,'');assert.equal(cache.diagnostics().entries,0);cache.destroy();
});
