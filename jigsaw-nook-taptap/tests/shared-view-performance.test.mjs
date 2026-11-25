import test from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {build} from 'esbuild';

const root=fileURLToPath(new URL('../',import.meta.url));
const bundle=await build({absWorkingDir:root,stdin:{contents:'export {GameApp} from "./mobile/app";',resolveDir:root,loader:'ts'},bundle:true,write:false,format:'esm',platform:'node',target:'es2020'});
const compiled=resolve(root,'work/performance-tests/shared-view-fixture.mjs');mkdirSync(resolve(root,'work/performance-tests'),{recursive:true});writeFileSync(compiled,bundle.outputFiles[0].text);
const {GameApp}=await import(pathToFileURL(compiled).href);
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};};
function fixture(width=1000){
 const images=[],panels=[],buttons=[],text=[];let redraws=0;
 const ctx=new Proxy({measureText:value=>({width:String(value).length*6})},{get:(target,key)=>key in target?target[key]:()=>{}});
 const stage={w:width,h:650,ctx,palette:{ink:'#642238',muted:'#a17878',line:'#d4a399',rose:'#c8798c'},text:v=>text.push(String(v)),button:(r,label,fn)=>buttons.push({r,label,fn}),panel:r=>panels.push(r),icon(){},meter(){},frame(){},image:src=>images.push(src),ornaments(){},segments(){},hit(){},decoration(){},wrap:()=>20,clip:(_r,fn)=>fn(),measure:value=>String(value).length*6,color:value=>value,invalidate(){redraws++;}};
 const app=Object.create(GameApp.prototype);
 Object.assign(app,{stage,invalidate:()=>stage.invalidate(),client:{cookieIdentity:true,account:{id:'owner-a'},profile:{code:'123',collection:{}},config:{capabilities:{energy:false}},asset:path=>path},platform:{config:{id:'web'},viewport:()=>({width,height:650,top:0,bottom:0})},bodyTop:100,bodyBottom:600,scroll:0,extent:0,busy:false,hidden:false,destroyed:false,ready:true,message:'',messageUntil:0,lastAidClock:'',toolsOpen:false,route:'lobby',selected:null,aid:null,modal:null});
 return{app,images,panels,buttons,text,redraws:()=>redraws};
}
const gallery={imageIds:['picture-a'],packedImageIds:[],freeImageIds:['picture-a'],photos:[{id:'picture-a',src:'/puzzles/a.webp',thumbSrc:'/puzzles/a-thumb.webp',title:'画作',category:'其它'}]};

test('repeated page-entry and timer reads share each in-flight request; settled reads remain fresh',async()=>{
 const {app}=fixture(),pending=new Map(),calls=[];
 app.client.json=path=>{calls.push(path);const d=deferred();pending.set(path,d);return d.promise;};
 const reads=[app.loadTasks(),app.loadTasks(),app.loadCollection(),app.loadCollection(),app.loadGallery(),app.loadGallery()];
 await Promise.resolve();assert.equal(calls.length,3);
 pending.get('/api/mobile/tasks').resolve({tasks:['fresh']});pending.get('/api/mobile/collection').resolve({packs:['fresh']});pending.get('/api/mobile/gallery').resolve(gallery);await Promise.all(reads);
 assert.deepEqual(app.tasks.tasks,['fresh']);assert.deepEqual(app.collection.packs,['fresh']);assert.equal(app.sharedPhotos.length,1);
 const next=app.loadTasks();await Promise.resolve();assert.equal(calls.length,4);pending.get('/api/mobile/tasks').resolve({tasks:['newer']});await next;assert.deepEqual(app.tasks.tasks,['newer']);
});

test('a rejected read is retryable and a response from the previous account cannot overwrite the next account',async()=>{
 const {app}=fixture(),old=deferred();let calls=0;
 app.client.json=()=>{calls++;return calls===1?Promise.reject(Error('离线')):old.promise;};
 await app.loadTasks();assert.equal(app.message,'离线');
 const stale=app.loadTasks();await Promise.resolve();app.client.account={id:'owner-b'};old.resolve({privateTask:'owner-a'});await stale;assert.equal(app.tasks,undefined);
 app.client.json=async()=>({privateTask:'owner-b'});await app.loadTasks();assert.equal(app.tasks.privateTask,'owner-b');
});

test('mutation receipts invalidate pending reads so older ownership and gift balances cannot return',async()=>{
 const {app}=fixture(),collection=deferred(),tasks=deferred();
 app.client.json=path=>path.endsWith('collection')?collection.promise:tasks.promise;
 const beforeBuy=app.loadCollection(),beforeGift=app.loadTasks();await Promise.resolve();
 app.applyCollection({packs:['owned']});app.applyTasks({gifts:[],giftProgress:0});
 collection.resolve({packs:['locked']});tasks.resolve({gifts:['already-opened']});await Promise.all([beforeBuy,beforeGift]);
 assert.deepEqual(app.collection.packs,['owned']);assert.deepEqual(app.tasks.gifts,[]);
});

test('destroyed views ignore late data and errors',async()=>{
 const {app}=fixture(),pending=deferred();app.client.json=()=>pending.promise;
 const read=app.loadGallery();await Promise.resolve();app.destroyed=true;pending.reject(Error('late network error'));await read;
 assert.equal(app.message,'');assert.equal(app.sharedPhotos,undefined);
});

test('closing during initial loading never registers timers or shows late errors',async t=>{
 let timersCreated=0;t.mock.method(globalThis,'setInterval',()=>{timersCreated++;return 1;});
 for(const reject of [false,true]){
  const {app}=fixture(),loading=deferred(),entered=deferred();
  Object.assign(app,{cleanups:[],timers:[],leaveRoom(){},cancelChatPress(){},social:{destroy(){}},loadInitialContent(){entered.resolve();return loading.promise;}});
  app.client.start=async()=>{};app.platform.onHide=app.platform.onShow=()=>()=>{};app.platform.initialQuery={};
  const startup=app.start();await entered.promise;app.destroy();
  if(reject)loading.reject(Error('late startup error'));else loading.resolve();await startup;
  assert.equal(app.timers.length,0);assert.equal(app.message,'');
 }
 assert.equal(timersCreated,0);
});

test('the initial lobby is usable before gallery metadata or social refresh completes',async()=>{
 const {app}=fixture(),gallery=deferred(),social=deferred(),calls=[];
 app.loadGallery=()=>{calls.push('gallery');return gallery.promise;};app.loadLobby=async()=>{calls.push('lobby');};app.social={refresh:()=>{calls.push('social');return social.promise;}};
 await app.loadInitialContent({});assert.deepEqual(calls,['gallery','lobby','social']);
 gallery.resolve();social.resolve();
});

test('an invitation enters its selected room before unrelated gallery or lobby work',async()=>{
 const {app}=fixture(),join=deferred(),calls=[];
 app.handleQuery=async query=>{calls.push(['join',query.room]);await join.promise;app.route='room';};
 app.loadGallery=async()=>{calls.push('gallery');};app.loadLobby=async()=>{calls.push('lobby');};app.social={refresh:async()=>{calls.push('social');}};
 const startup=app.loadInitialContent({room:'a'.repeat(32)});await Promise.resolve();assert.deepEqual(calls,[['join','a'.repeat(32)]]);
 join.resolve();await startup;assert.deepEqual(calls,[['join','a'.repeat(32)],'gallery','social']);
});

test('the one-second timer does not dirty an idle room; visible expiry and countdowns still redraw',t=>{
 t.mock.timers.enable({apis:['Date'],now:10000});const {app,redraws}=fixture();app.route='room';
 for(let i=0;i<30;i++){t.mock.timers.tick(1000);app.tickVisibleTime();}assert.equal(redraws(),0);
 app.message='已保存';app.messageUntil=Date.now()+1000;t.mock.timers.tick(1001);app.tickVisibleTime();assert.equal(redraws(),1);assert.equal(app.message,'');
 app.toolsOpen=true;app.aid={grants:[{kind:'hint',expiresAt:Date.now()+5000}]};app.tickVisibleTime();const before=redraws();app.tickVisibleTime();assert.equal(redraws(),before);
 t.mock.timers.tick(1000);app.tickVisibleTime();assert.equal(redraws(),before+1);app.toolsOpen=false;app.tickVisibleTime();const closed=redraws();t.mock.timers.tick(1000);app.tickVisibleTime();assert.equal(redraws(),closed);
});

const pack=i=>({id:'pack-'+i,title:'图包'+i,description:'简介',images:[{id:'image-'+i,src:'/full/'+i,thumbSrc:'/thumb/'+i}],price:10,owned:false});
test('pack cards outside the viewport do not request images, while visible cards remain interactive',()=>{
 const {app,images,buttons}=fixture();const packs=Array.from({length:100},(_,i)=>pack(i));app.drawPacks({packs});
 assert.ok(images.length>0&&images.length<8,'only visible rows load');assert.ok(buttons.some(b=>b.label==='解锁图包'));const top=images.slice();images.length=0;app.scroll=3000;app.drawPacks({packs});
 assert.ok(images.length>0&&images.length<8);assert.ok(images.every(src=>!top.includes(src)));assert.ok(app.extent>10000);
});

test('the narrow featured pack also skips its hidden image without changing list extent',()=>{
 const {app,images}=fixture(390);const packs=Array.from({length:40},(_,i)=>pack(i));app.scroll=2000;app.drawPacks({packs});
 assert.ok(!images.includes('/thumb/0'));assert.ok(images.length>0);assert.ok(app.extent>2000);
});

test('scrolling decorations past the preview does not reload the full preview photo',()=>{
 const {app,images}=fixture(),decorations=Array.from({length:80},(_,i)=>({id:'decoration-'+i,title:'装饰'+i,description:'介绍',artKey:'leaf',color:'#abc',source:'craft',cost:30,owned:false,equipped:false}));
 app.scroll=1800;app.drawDecorations({decorations,albums:[],packs:[pack(1)],profile:{name:'玩家',level:1},wallet:{fragments:0}});
 assert.deepEqual(images,[]);assert.ok(app.extent>1800);
});
