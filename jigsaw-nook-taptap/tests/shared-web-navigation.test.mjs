import test from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';

const root=fileURLToPath(new URL('../',import.meta.url));
const bundle=await build({absWorkingDir:root,stdin:{contents:'export {GameApp} from "./mobile/app"; export {GALLERY_PHOTOS} from "./lib/puzzle-catalog";',resolveDir:root,loader:'ts'},bundle:true,write:false,format:'esm',platform:'node',target:'es2020'});
const {GameApp,GALLERY_PHOTOS}=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
function fixture(width=390,formalWeb=true){
 const texts=[],buttons=[],panels=[],opened=[],ctx=new Proxy({measureText:text=>({width:String(text).length*7})},{get:(target,key)=>key in target?target[key]:()=>{}});
 const stage={w:width,h:844,ctx,palette:{ink:'#642238',muted:'#a17878',line:'#d4a399',rose:'#c8798c'},text(value){texts.push(String(value));},button(r,label,fn,options){buttons.push({r,label,fn,options});},panel:r=>panels.push(r),icon(){},meter(){},frame(){},image(){},ornaments(){},segments(){},hit(){},clip(_r,fn){fn();},measure:text=>String(text).length*7,color:value=>value,invalidate(){}};
 const instance=Object.create(GameApp.prototype),room={id:'a'.repeat(32),title:'保留中的拼图',players:0,pieces:108};
 Object.assign(instance,{audioSettings:{levels:{music:1,effects:1},set(){}},stage,client:{cookieIdentity:formalWeb,account:{username:'player'},profile:{name:'玩家',code:'123456',level:2,xp:1,xpToNext:20,supply:{create:1},collection:{coins:42,ownedImageIds:[]},ownedRooms:[room]},config:{capabilities:{energy:false,supportedPieces:[108,300,500]}}},platform:{config:{id:'web'},viewport:()=>({width,height:844,top:0,bottom:0}),openUrl:url=>opened.push(url)},bodyTop:100,bodyBottom:800,scroll:0,extent:0,busy:false,invalidate:()=>{},modalScroll:0,social:{title:'好友',unread:0},route:'gallery',direction:'all',pieces:108,visibility:'public',category:'全部',search:'',source:'all',packId:null,selected:null,packedIds:new Set(),availableGallery:()=>[]});
 instance.client.asset=path=>path;return{instance,texts,buttons,panels,opened,room};
}
const legacyLabel=/原版|原有房间|上传|我的图片|1000|更多建房/;

test('Web creation is enabled without tickets for both local guests and cookie accounts; mobile keeps its ticket gate',()=>{
 for(const formalWeb of [false,true])for(const visibility of ['public','private']){
  const f=fixture(844,formalWeb),actions=[],created=[];f.instance.client.profile.supply.create=0;f.instance.client.profile.firstSelectionAvailable=false;f.instance.client.profile.ownedRooms=[];f.instance.selected=GALLERY_PHOTOS[0].id;f.instance.visibility=visibility;
  f.instance.drawPictureButton=(_r,label,fn,_tone,icon,_font,_size,disabled)=>actions.push({label,fn,icon,disabled});f.instance.launch=input=>created.push(input);
  f.instance.drawGallery();const create=actions.find(a=>a.label==='创建');assert.ok(create);assert.equal(create.disabled,false);create.fn();assert.equal(created.length,1);assert.equal(created[0].visibility,visibility);assert.equal(created[0].mode,'selected');assert.ok(![...f.texts,...actions.map(a=>a.label)].some(t=>/建房券|用券|首次免费/.test(t)));
 }
 const f=fixture(844,false),actions=[];f.instance.platform.config.id='wechat';f.instance.client.config.capabilities.createTickets=true;f.instance.client.profile.supply.create=0;f.instance.client.profile.firstSelectionAvailable=false;f.instance.client.profile.ownedRooms=[];f.instance.drawPictureButton=(_r,label,_fn,_tone,_icon,_font,_size,disabled)=>actions.push({label,disabled});f.instance.drawGallery();assert.equal(actions.find(a=>a.label==='暂无建房券')?.disabled,true);
});

test('formal Web settings, gallery and supplies expose the shared game and essential account links only',()=>{
 for(const width of [320,844]){
  const f=fixture(width);f.instance.modal='settings';f.instance.drawModal();
  for(const [label,path]of [['账号管理','/account'],['账号安全与数据管理','/account/security'],['隐私说明','/privacy'],['服务说明','/terms'],['问题反馈','/feedback']]){const button=f.buttons.find(button=>button.label===label);assert.ok(button,label);button.fn();assert.equal(f.opened.at(-1),path);}
  f.instance.drawHeader();f.instance.drawGallery();f.instance.drawWebSupplies();
  assert.equal([...f.texts,...f.buttons.map(button=>button.label)].some(label=>legacyLabel.test(label)),false);
  const membership=f.buttons.find(button=>button.label==='账号与会员');assert.ok(membership);membership.fn();assert.equal(f.opened.at(-1),'/membership');
  assert.ok(f.buttons.every(button=>button.r.w>0&&button.r.x>=0&&button.r.x+button.r.w<=width),'removed controls do not leave malformed widths');
 }
});

test('formal Web room cards continue within the shared client while mobile removes only the personal entry',()=>{
 const f=fixture();f.instance.modal='manage';let entered;f.instance.enterRoom=id=>{entered=id;};f.instance.drawModal();const resume=f.buttons.find(button=>button.label==='继续拼');assert.ok(resume);resume.fn();assert.equal(entered,f.room.id);assert.deepEqual(f.opened,[]);assert.equal(resume.r.w,(f.panels.at(-1).w-26)/2);assert.ok(f.buttons.some(button=>button.label==='删除'));assert.equal(f.buttons.some(button=>button.label==='关闭空房'||button.label==='原版管理'),false);
 const mobile=fixture(390,false);mobile.instance.modal='manage';mobile.instance.drawModal();assert.ok(mobile.buttons.some(button=>button.label==='删除'));assert.ok(!mobile.buttons.some(button=>button.label==='关闭空房'));
});

test('unsupported historical rooms explain preserved progress without navigating or modifying identity',async()=>{
 const f=fixture(),account=f.instance.client.account,profile=f.instance.client.profile;
 await f.instance.run(async()=>{throw Object.assign(Error('请用旧房间'),{code:'LEGACY_ROOM_REQUIRED',compatUrl:'/room/'+f.room.id});});
 assert.deepEqual(f.opened,[]);assert.match(f.instance.message,/进度仍然保留/);assert.match(f.instance.message,/新版暂不支持/);assert.equal(f.instance.client.account,account);assert.equal(f.instance.client.profile,profile);assert.equal(f.instance.busy,false);
 await f.instance.run(async()=>{throw Error('网络繁忙');});assert.equal(f.instance.message,'网络繁忙');
});


test('mobile history lists recent admissions, disables completed entries and links to own rooms below the list',()=>{
 const f=fixture(390,false);f.instance.modal='history';f.instance.historyLoading=false;f.instance.historyError='';
 f.instance.historyRooms=[{id:'b'.repeat(32),title:'最近加入',players:2,pieces:108},{id:'c'.repeat(32),title:'旧图片名',completed:true,pieces:48}];
 f.instance.drawModal();
 assert.ok(f.texts.includes('最近加入'));assert.ok(f.texts.includes('已完成'));assert.ok(!f.texts.includes('旧图片名'));
 assert.ok(!f.buttons.some(button=>button.label==='已完成'),'completed cards have no resume action');
 const own=f.buttons.find(button=>button.label==='自己的房间');assert.ok(own);assert.ok(own.r.y>f.instance.modalStart);
 f.instance.showModal=modal=>{f.instance.modal=modal;};own.fn();assert.equal(f.instance.modal,'manage');
});

test('mobile removal uses the personal-list endpoint and leaves cached recent history untouched',async()=>{
 const f=fixture(390,false),calls=[];f.instance.historyRooms=[f.room];f.instance.modal='manage';
 f.instance.client.post=async(path,body)=>calls.push({path,body});f.instance.client.refresh=async()=>{f.instance.client.profile.ownedRooms=[];};f.instance.note=()=>{};
 f.instance.drawModal();await f.buttons.find(button=>button.label==='删除').fn();
 await new Promise(resolve=>setImmediate(resolve));assert.deepEqual(calls,[{path:'/api/my-rooms',body:{action:'remove',roomId:f.room.id}}]);
 assert.equal(f.instance.historyRooms[0].id,f.room.id);assert.equal(f.instance.client.profile.ownedRooms.length,0);
});
