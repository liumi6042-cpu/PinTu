import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
const bundle=await build({entryPoints:['mobile/tap-interstitial.ts'],bundle:true,write:false,format:'esm',platform:'node'});
const {createTapInterstitial}=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
const settle=async()=>{for(let n=0;n<12;n++)await Promise.resolve();};
function fixture({showError=false,creationError=false}={}){
 const events=[],listeners={},removed=[];let creates=0,shows=0,destroys=0;
 const ad={onLoad:fn=>listeners.load=fn,onError:fn=>listeners.error=fn,onClose:fn=>listeners.close=fn,offLoad:fn=>removed.push(fn===listeners.load),offError:fn=>removed.push(fn===listeners.error),offClose:fn=>removed.push(fn===listeners.close),show:async()=>{shows++;if(showError)throw {errCode:1003,adnCode:200001};},destroy(){destroys++;}};
 const show=createTapInterstitial(()=>({createInterstitialAd(options){assert.equal(options.adUnitId,'1071588');creates++;if(creationError)throw Error('creation failed');return ad;}}),(...args)=>events.push(args),1000);
 return {show,ad,listeners,events,removed,counts:()=>({creates,shows,destroys})};
}
test('interstitial is created only on demand and waits for onLoad before showing, then close before success',async()=>{
 const f=fixture();assert.deepEqual(f.counts(),{creates:0,shows:0,destroys:0});const pending=f.show('1071588');assert.equal(f.counts().shows,0);assert.equal(await f.show('1071588'),'unavailable');f.listeners.close();assert.equal(f.counts().destroys,0);
 f.listeners.load();f.listeners.load();await settle();assert.equal(f.counts().shows,1);assert.equal(f.counts().destroys,0);f.listeners.close();assert.equal(await pending,'closed');assert.equal(f.counts().destroys,1);assert.deepEqual(f.removed,[true,true,true]);f.listeners.error({errCode:1003});assert.equal(f.events.at(-1)[0],'已展示并关闭');
 const next=f.show('1071588');f.listeners.load();await settle();f.listeners.close();assert.equal(await next,'closed');assert.equal(f.counts().creates,2);
});
test('loading, showing and creation failures are distinguished and release the instance',async()=>{
 for(const mode of ['load','show','create']){const f=fixture({showError:mode==='show',creationError:mode==='create'}),pending=f.show('1071588');if(mode==='load')f.listeners.error({errCode:1003,adnCode:200001});if(mode==='show')f.listeners.load();assert.equal(await pending,'failed');assert.equal(f.counts().destroys,mode==='create'?0:1);assert.ok(f.events.some(e=>e[0].includes(mode==='create'?'创建插屏异常':mode==='load'?'自动加载失败':'展示失败')));}
});
test('missing SDK and empty units do not create an ad',async()=>{
 const show=createTapInterstitial(()=>undefined,()=>{});assert.equal(await show('1071588'),'unavailable');const f=fixture();assert.equal(await f.show(''),'unavailable');assert.equal(f.counts().creates,0);
});
test('a missing load or close callback times out and ignores late events',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});for(const stage of ['load','close']){const f=fixture(),pending=f.show('1071588');if(stage==='close'){f.listeners.load();await settle();}t.mock.timers.tick(1000);assert.equal(await pending,'failed');const before=f.counts();f.listeners.load();f.listeners.close();assert.deepEqual(f.counts(),before);assert.ok(f.events.at(-1)[0].includes(stage==='load'?'自动加载超时':'等待关闭超时'));}
});
