import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomBytes} from 'node:crypto';
import {mkdirSync,mkdtempSync,rmSync} from 'node:fs';
import {resolve} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {build} from 'esbuild';
import {createMobileService} from '../server/mobile-service.mjs';

const rid=()=>randomBytes(16).toString('hex');
const actor=name=>createHash('sha256').update(name).digest('hex');

const built=await build({stdin:{contents:'export {GameApp} from "./mobile/app";',resolveDir:process.cwd(),loader:'ts'},bundle:true,write:false,platform:'node',format:'esm'});
const {GameApp}=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'));

function setupService(t){
 mkdirSync(resolve('work'),{recursive:true});
 const dir=mkdtempSync(resolve('work/gallery-unplayed-')),databasePath=resolve(dir,'mobile.sqlite');
 const now=1800000000000;
 const service=createMobileService({databasePath,now:()=>now,randomInt:min=>min,publicTestPolicy:{privateMessages:false,customNames:false}});
 const other=new DatabaseSync(databasePath);other.exec('PRAGMA busy_timeout=5000');
 t.after(()=>{other.close();service.close();rmSync(dir,{recursive:true,force:true});});
 const call=(owner,path,body,token,method)=>service.handle({identity:owner,method:method??(body===undefined?'GET':'POST'),url:path,body:body===undefined?undefined:{requestId:rid(),...body},authorization:token?'Bearer '+token:undefined,artworkSnapshot:true});
 const plenty=owner=>other.prepare("UPDATE mobile_profiles SET data=json_set(data,'$.energy',100000) WHERE id=?").run(owner);
 const finish=(owner,ticket)=>{
  for(const group of ticket.room.puzzle.groups){
   const path='/api/rooms/'+ticket.room.id;
   assert.equal(call(owner,path,{type:'claim',groupId:group.id},ticket.token).status,200);
   assert.equal(call(owner,path,{type:'drop',groupId:group.id,dx:0,dy:0,seq:1},ticket.token).status,200);
  }
 };
 return {call,plenty,finish};
}

test('/api/mobile/gallery returns completedImageIds only for pictures the player completed',t=>{
 const f=setupService(t),a=actor('gallery-unplayed-a'),b=actor('gallery-unplayed-b');
 const before=f.call(a,'/api/mobile/gallery');
 assert.equal(before.status,200);
 assert.deepEqual(before.data.completedImageIds,[]);

 const created=f.call(a,'/api/rooms',{mode:'random',pieces:48,visibility:'public'});
 assert.equal(created.status,201);
 const imageId=created.data.room.puzzle.imageId;
 // Player B joins without contributing; only player A finishes the table.
 assert.equal(f.call(b,'/api/rooms/'+created.data.room.id+'/join',{}).status,200);
 f.plenty(a);
 f.finish(a,created.data);

 const afterA=f.call(a,'/api/mobile/gallery');
 const afterB=f.call(b,'/api/mobile/gallery');
 assert.equal(afterA.status,200);
 assert.equal(afterB.status,200);
 assert.deepEqual(afterA.data.completedImageIds,[imageId]);
 assert.deepEqual(afterB.data.completedImageIds,[]);
});

function galleryFixture({layout='phonePortrait',completedGalleryIds=null,collection=null,ownedImageIds=[]}={}){
 const photos=[
  {id:'p-free-done',title:'已完成免费图',src:'/img/1.webp',thumbSrc:'/img/1-t.webp',category:'风景',width:800,height:600},
  {id:'p-free-new',title:'未拼免费图',src:'/img/2.webp',thumbSrc:'/img/2-t.webp',category:'风景',width:600,height:800},
  {id:'p-owned-done',title:'已完成图包图',src:'/img/3.webp',thumbSrc:'/img/3-t.webp',category:'治愈',width:800,height:600},
  {id:'p-owned-new',title:'未拼图包图',src:'/img/4.webp',thumbSrc:'/img/4-t.webp',category:'治愈',width:800,height:600},
 ];
 const app=Object.create(GameApp.prototype);
 const state={chips:[],drawnPhotos:[],emptyText:'',emptyButton:'',emptyAction:null,navigated:null,modalOpened:null,invalidated:0};
 Object.defineProperty(app,'layout',{value:layout,configurable:true});
 Object.defineProperty(app,'colors',{value:{ink:'#3b2820',muted:'#7a6458',cream:'#fff8ee',onAccent:'#fff9f0',berry:'#a94763',overlay:'rgba(0,0,0,.4)'},configurable:true});
 Object.assign(app,{
  route:'gallery',
  scroll:0,
  extent:0,
  modalScroll:0,
  bodyTop:80,
  bodyBottom:600,
  contentOrigin:{x:0,y:0},
  direction:'all',
  category:'全部',
  search:'',
  source:'free',
  unplayedOnly:false,
  packId:null,
  selected:null,
  sharedPhotos:photos,
  galleryIds:new Set(photos.map(p=>p.id)),
  freeGalleryIds:new Set(['p-free-done','p-free-new']),
  completedGalleryIds:completedGalleryIds?new Set(completedGalleryIds):null,
  collection,
  social:{title:'好友'},
  platform:{viewport:()=>({width:layout==='phonePortrait'?390:1280,height:layout==='phonePortrait'?844:720,top:0,bottom:0})},
  client:{profile:{code:'123456789',collection:{ownedImageIds}},asset:src=>src},
  stage:{
   w:layout==='phonePortrait'?390:1280,
   h:layout==='phonePortrait'?844:720,
   ctx:{fillStyle:'',fillRect(){}},
   measure:text=>String(text).length*10,
   icon(){},
   text(value){if(typeof value==='string'&&['这里的图片你都拼过啦','收藏一个喜欢的图包','换个条件试试'].includes(value))state.emptyText=value;},
   hit(){},
   frame(){},
   image(){},
   clip(_r,fn){fn();},
   color:c=>c,
  },
  ownerKey:()=>'owner-1',
  invalidate(){state.invalidated++;},
  showModal(name){state.modalOpened=name;},
  navigate(route,context){state.navigated={route,context};if(context)Object.assign(app,context);},
  scrolled(fn){fn();},
  drawChips(_x,y,_w,h,chips){state.chips=chips.map(([label,selected,action])=>({label,selected,action}));return y+h;},
  drawPhotoCard(photo){state.drawnPhotos.push(photo.id);},
  drawPictureButton(_r,label,action){state.emptyButton=label;state.emptyAction=action;},
  drawCreatePanel(){},
  createPanelHeight:()=>240,
 });
 const render=()=>{
  state.chips=[];state.drawnPhotos=[];state.emptyText='';state.emptyButton='';state.emptyAction=null;app.bodyTop=80;
  app.drawGallery();
  return state;
 };
 return {app,state,render};
}

test('gallery Scheme B 5-chip bar keeps 未拼过 orthogonal to source, shows filter count, and resets cleanly',()=>{
 const {app,render}=galleryFixture({
  layout:'phonePortrait',
  completedGalleryIds:['p-free-done'],
  collection:{
   albums:[{id:'owned-pack',title:'测试图包',images:[{id:'p-owned-done',collected:true},{id:'p-owned-new',collected:false}]}],
   packs:[{id:'owned-pack',title:'测试图包',imageIds:['p-owned-done','p-owned-new']}],
  },
  ownedImageIds:['p-owned-done','p-owned-new'],
 });

 // Portrait bar stays uncluttered at 5 chips: 全部 / 免费 / 我的图包 / 未拼过 / 筛选.
 let view=render();
 assert.deepEqual(view.chips.map(c=>c.label),['全部','免费','我的图包','未拼过','筛选']);
 assert.deepEqual(view.drawnPhotos,['p-free-done','p-free-new']);

 // Selecting a completed image and enabling 未拼过 hides it, clears selection, and shows ✓ 未拼过.
 app.selected='p-free-done';
 view.chips.find(c=>c.label==='未拼过').action();
 assert.equal(app.unplayedOnly,true);
 assert.equal(app.selected,null);
 view=render();
 assert.equal(view.chips.find(c=>c.label==='✓ 未拼过').selected,true);
 assert.deepEqual(view.drawnPhotos,['p-free-new']);

 // Switching to 我的图包 keeps 未拼过 active and also honours collection.albums collected fallback.
 view.chips.find(c=>c.label==='我的图包').action();
 view=render();
 assert.equal(app.source,'owned');
 assert.equal(app.unplayedOnly,true);
 assert.deepEqual(view.drawnPhotos,['p-owned-new']);

 // Clicking 全部 switches source to all while keeping ✓ 未拼过 active (independent overlay toggle).
 view.chips.find(c=>c.label==='全部').action();
 view=render();
 assert.equal(app.source,'all');
 assert.equal(app.unplayedOnly,true);
 assert.equal(view.chips.find(c=>c.label==='全部').selected,true);
 assert.deepEqual(view.drawnPhotos,['p-free-new','p-owned-new']);

 // Active direction/category/search filters surface a count badge on 筛选.
 app.direction='portrait';
 app.category='风景';
 view=render();
 assert.equal(view.chips.at(-1).label,'筛选·2');
 assert.equal(view.chips.at(-1).selected,true);
 app.direction='all';app.category='全部';

 // Toggling ✓ 未拼过 while viewing a specific pack keeps packId intact.
 app.packId='owned-pack';
 view=render();
 view.chips.find(c=>c.label==='✓ 未拼过').action();
 assert.equal(app.unplayedOnly,false);
 assert.equal(app.packId,'owned-pack');
 view=render();
 assert.deepEqual(view.drawnPhotos,['p-owned-done','p-owned-new']);
});

test('gallery photo card and lobby room card render 已拼 corner badge for completed images (including unowned joined rooms)',()=>{
 const {app}=galleryFixture({
  layout:'phonePortrait',
  completedGalleryIds:['p-free-done','p-locked-done'],
  ownedImageIds:[],
 });
 const texts=[];
 app.stage.text=value=>texts.push(String(value));
 app.stage.meter=()=>{};
 app.stage.icon=()=>{};
 app.stage.decoration=()=>{};

 // Gallery card: completed unowned/locked photo still displays 已拼; unplayed photo does not.
 const cardProto=GameApp.prototype.drawPhotoCard;
 cardProto.call(app,{id:'p-locked-done',title:'蹭房拼完的图包图',src:'/a.webp',thumbSrc:'/a-t.webp',category:'治愈'},{x:0,y:0,w:170,h:180},120,new Set());
 assert.ok(texts.includes('已拼'),'completed gallery card renders 已拼 badge');
 texts.length=0;
 cardProto.call(app,{id:'p-free-new',title:'未拼免费图',src:'/b.webp',thumbSrc:'/b-t.webp',category:'风景'},{x:0,y:0,w:170,h:180},120,new Set());
 assert.equal(texts.includes('已拼'),false,'unplayed gallery card omits 已拼 badge');

 // Lobby room card: completed image room displays 已拼; unplayed image room does not.
 const roomCardProto=GameApp.prototype.drawRoomCard;
 texts.length=0;
 roomCardProto.call(app,{id:'r1',title:'蹭过的房间',imageId:'p-locked-done',pieces:108,placed:20,players:2,acceptingNew:true,completed:false},{x:0,y:0,w:170,h:210});
 assert.ok(texts.includes('已拼'),'completed lobby room card renders 已拼 badge');
 texts.length=0;
 roomCardProto.call(app,{id:'r2',title:'新图房间',imageId:'p-free-new',pieces:108,placed:20,players:2,acceptingNew:true,completed:false},{x:0,y:0,w:170,h:210});
 assert.equal(texts.includes('已拼'),false,'unplayed lobby room card omits 已拼 badge');
});

test('lobby 5-chip bar and filter modal support 未拼过 filtering and one-tap reset without wiping loaded rooms',()=>{
 const {app}=galleryFixture({layout:'phonePortrait',completedGalleryIds:['img-done']});
 const chips=[],modalButtons=[];
 let loadLobbyCalls=0;
 Object.assign(app,{
  route:'lobby',
  lobbyPieces:'all',
  lobbyUnplayedOnly:false,
  openOnly:true,
  activeOnly:false,
  filterCount:0,
  direction:'all',
  lobbyCursor:null,
  lobbyLoading:false,
  lobbyQuiet:false,
  rooms:[
   {id:'r-done',title:'拼过的图',imageId:'img-done',pieces:108,placed:10,players:1,acceptingNew:true,completed:false},
   {id:'r-new',title:'没拼过的图',imageId:'img-new',pieces:300,placed:5,players:2,acceptingNew:true,completed:false},
  ],
  stage:{...app.stage,button(){}},
  drawChips(_x,y,_w,h,list){chips.length=0;chips.push(...list.map(([label,selected,action])=>({label,selected,action})));return y+h;},
  loadLobby(){loadLobbyCalls++;},
  button(_x,_y,_w,label,action){modalButtons.push({label,action});},
  rowOptions(){},
  modalHeader(){},
  stagePanel(){},
 });
 app.stage.panel=()=>{};

 app.drawRoomHeader(12,80,366,false);
 assert.deepEqual(chips.map(c=>c.label),['全部','≤108片','300片+','未拼过','筛选']);
 assert.deepEqual(app.lobbyRooms.map(r=>r.id),['r-done','r-new']);

 // Toggle 未拼过 chip on lobby: filters out completed room immediately with zero server reload.
 chips.find(c=>c.label==='未拼过').action();
 assert.equal(app.lobbyUnplayedOnly,true);
 assert.equal(loadLobbyCalls,0);
 assert.deepEqual(app.lobbyRooms.map(r=>r.id),['r-new']);
 app.drawRoomHeader(12,80,366,false);
 assert.equal(chips.find(c=>c.label==='✓ 未拼过').selected,true);

 // Direction filter surfaces count badge on 筛选 and modal exposes 只看未拼过的图片 + 重置筛选.
 app.direction='portrait';
 app.drawRoomHeader(12,80,366,false);
 assert.equal(chips.at(-1).label,'筛选·1');
 assert.equal(chips.at(-1).selected,true);

 app.modal='filters';
 app.filterView=app.captureListView();
 modalButtons.length=0;
 app.drawModal();
 assert.ok(modalButtons.some(b=>b.label==='✓ 只看未拼过的图片'),'lobby filter modal shows active unplayed toggle');
 const resetBtn=modalButtons.find(b=>b.label==='重置筛选');
 assert.ok(resetBtn,'lobby filter modal offers 重置筛选 when filters are active');
 resetBtn.action();
 assert.equal(app.direction,'all');
 assert.equal(app.lobbyUnplayedOnly,false);
 assert.deepEqual(app.lobbyRooms.map(r=>r.id),['r-done','r-new']);
});

test('gallery shows friendly empty state when every visible image is completed, including owned packs',()=>{
 const {app,render}=galleryFixture({
  layout:'desktop',
  completedGalleryIds:['p-owned-done','p-owned-new'],
  ownedImageIds:['p-owned-done','p-owned-new'],
 });
 app.source='owned';
 app.unplayedOnly=true;
 const view=render();
 assert.deepEqual(view.drawnPhotos,[]);
 assert.equal(view.emptyText,'这里的图片你都拼过啦');
 assert.equal(view.emptyButton,'查看全部图片');
 view.emptyAction();
 assert.equal(app.unplayedOnly,false);
 assert.equal(app.source,'all');

 // When player owns zero packs, 我的图包 still invites them to collection.
 const emptyOwned=galleryFixture({layout:'desktop',completedGalleryIds:[],ownedImageIds:[]});
 emptyOwned.app.source='owned';
 emptyOwned.app.unplayedOnly=true;
 const emptyView=emptyOwned.render();
 assert.equal(emptyView.emptyText,'收藏一个喜欢的图包');
 assert.equal(emptyView.emptyButton,'前往收藏');
});

test('loadGallery parses completedImageIds, playImage and openPackGallery clear unplayedOnly, and filters modal toggles it',async()=>{
 const {app}=galleryFixture({layout:'desktop'});
 app.unplayedOnly=true;
 app.selected='p-free-done';
 app.loadView=async(_key,fetchFn,apply)=>apply(await fetchFn());
 app.client.json=async()=>({
  imageIds:['p-free-done','p-free-new'],
  freeImageIds:['p-free-done','p-free-new'],
  packedImageIds:[],
  completedImageIds:['p-free-done'],
 });
 await app.loadGallery();
 assert.deepEqual([...app.completedGalleryIds],['p-free-done']);
 assert.equal(app.selected,null,'loadGallery clears a completed selection when unplayedOnly is active');

 // playImage and openPackGallery clear unplayedOnly so jumped-to pictures are never hidden.
 app.unplayedOnly=true;
 app.playImage('p-free-done');
 assert.equal(app.unplayedOnly,false);
 app.unplayedOnly=true;
 app.openPackGallery('owned-pack');
 assert.equal(app.unplayedOnly,false);

 // Gallery filter modal exposes the 只看未拼过的图片 toggle and flips unplayedOnly.
 const modalButtons=[];
 app.modal='filters';
 app.route='gallery';
 app.unplayedOnly=false;
 app.button=(_x,_y,_w,label,action)=>modalButtons.push({label,action});
 app.rowOptions=()=>{};
 app.modalHeader=()=>{};
 app.stage.panel=()=>{};
 app.stage.button=()=>{};
 app.drawModal();
 const toggle=modalButtons.find(b=>b.label==='只看未拼过的图片');
 assert.ok(toggle,'filters modal should include 只看未拼过的图片');
 toggle.action();
 assert.equal(app.unplayedOnly,true);
});
