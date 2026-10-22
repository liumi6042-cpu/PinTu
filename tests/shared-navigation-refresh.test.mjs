import test from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';

const root=fileURLToPath(new URL('../',import.meta.url));
// Keep navigation, loading and drawing real while replacing room networking and image work.
const replacements={
 'room-client.ts':`export class RoomClient {constructor(ticket){this.ticket=ticket;this.state=ticket.room.puzzle;this.snapshot=ticket.room;this.connected=true;}attach(){return()=>this.detached=true;}subscribe(){return()=>this.unsubscribed=true;}leave(){this.left=true;}}`,
 'cursor-client.ts':`export class CursorClient {start(){}stop(){this.stopped=true;}point(){}refresh(){}}`,
 'puzzle-board.ts':`export class PuzzleBoard {constructor(platform,state){this.platform=platform;this.state=state;this.imagePreparation={phase:'loading',completed:0,total:48};}setTheme(){}input(){}setCursors(){}setRect(){}openMobileView(){}draw(){}fit(){}destroy(){this.destroyed=true;}async setImage(){if(this.platform.imageFailure)throw Error(this.platform.imageFailure);this.imagePreparation=this.platform.preparation??{phase:'ready',completed:48,total:48};}}`
};
const bundle=await build({absWorkingDir:root,stdin:{contents:'export {GameApp} from "./mobile/app";',resolveDir:root,loader:'ts'},bundle:true,write:false,format:'esm',platform:'node',target:'es2020',plugins:[{name:'room-fixtures',setup(build){build.onLoad({filter:/[\\/](?:room-client|cursor-client|puzzle-board)\.ts$/},args=>({contents:replacements[args.path.split(/[\\/]/).at(-1)],loader:'js'}));}}]});
const {GameApp}=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
const deferred=()=>{let resolve;const promise=new Promise(yes=>resolve=yes);return{promise,resolve};};
function fixture(){
 let redraws=0;const buttons=[],texts=[],ctx=new Proxy({measureText:value=>({width:String(value).length*6})},{get:(target,key)=>key in target?target[key]:()=>{}});
 const stage={w:390,h:844,theme:'light',ctx,palette:{ink:'#642238',muted:'#a17878',line:'#d4a399',rose:'#c8798c'},text:value=>texts.push(String(value)),button:(r,label,fn)=>buttons.push({r,label,fn}),icon(){},panel(){},image(){},frame(){},ornaments(){},meter(){},clip:(_r,fn)=>fn(),hit(){},decoration(){},color:value=>value,measure:value=>String(value).length*6,input(){},invalidate(){redraws++;}};
 const app=Object.create(GameApp.prototype);Object.assign(app,{stage,client:{cookieIdentity:true,account:{id:'owner-a'},profile:{code:'self',collection:{},level:1,xp:0,xpToNext:20},config:{capabilities:{energy:false}},asset:value=>value},platform:{config:{id:'web'},viewport:()=>({width:390,height:844,top:0,bottom:0}),randomId:()=> 'request',onHide:()=>()=>{},onShow:()=>()=>{}},invalidate:()=>stage.invalidate(),social:{close(){},blockedCodes:[],unread:0,requestCount:0},route:'lobby',routeStack:[],bodyTop:100,bodyBottom:800,scroll:0,extent:0,rooms:[],lobbyCursor:null,lobbySerial:0,lobbyLoading:false,lobbyReload:false,direction:'all',filterCount:0,openOnly:true,activeOnly:false,source:'free',packId:null,selected:null,category:'全部',search:'',pieces:108,collectionTab:'albums',albumId:'',albumListScroll:0,decorationId:'',decorationOwnedOnly:false,taskTab:'tasks',room:null,board:null,cursor:null,messages:[],chatCursor:0,chatSeen:0,chatLoading:false,modal:null,busy:false,destroyed:false,ready:true,hidden:false,toolsOpen:false,message:'',imageError:'',imageReady:false,loadLobby:async()=>{},loadGallery:async()=>{},loadCollection:async()=>{},loadTasks:async()=>{},loadAssistance:async()=>{}});
 return{app,stage,buttons,texts,redraws:()=>redraws};
}
const ticket=()=>({token:'token',playerId:'self',room:{id:'a'.repeat(32),title:'房间',visibility:'public',members:[],puzzle:{imageId:'photo-a',cols:8,rows:6,groups:[]},customImage:{id:'a',src:'/a.webp',thumbSrc:'/a-thumb.webp',width:800,height:600}}});
const card=(id='room-a')=>({id,title:id,imageId:'photo-a',pieces:108,players:2,placed:10,acceptingNew:true,completed:false,thumbSrc:'/a.webp'});

test('real room entry and exit restore gallery source, selection and nested return positions',async()=>{
 const {app}=fixture();app.scroll=440;app.direction='portrait';app.filterCount=108;
 app.navigate('gallery');assert.equal(app.direction,'all');app.source='free';app.selected='free-photo';app.scroll=720;
 app.openCollection('packs');app.scroll=880;app.openPackGallery('pack-a');assert.equal(app.scroll,0);app.selected='pack-photo';app.scroll=340;
 await app.attachTicket(ticket());const room=app.room,board=app.board,cursor=app.cursor;assert.equal(app.route,'room');
 app.exitRoom();assert.equal(app.route,'gallery');assert.equal(app.packId,'pack-a');assert.equal(app.source,'owned');assert.equal(app.selected,'pack-photo');assert.equal(app.scroll,340);assert.ok(room.left&&room.detached&&room.unsubscribed&&board.destroyed&&cursor.stopped);
 app.back();assert.equal(app.route,'collection');assert.equal(app.collectionTab,'packs');assert.equal(app.scroll,880);
 app.back();assert.equal(app.route,'gallery');assert.equal(app.source,'free');assert.equal(app.packId,null);assert.equal(app.selected,'free-photo');assert.equal(app.scroll,720);
 app.back();assert.equal(app.route,'lobby');assert.equal(app.direction,'portrait');assert.equal(app.filterCount,108);assert.equal(app.scroll,440);
 app.navigate('gallery');assert.equal(app.scroll,720);app.navigate('lobby');assert.equal(app.routeStack.length,0);assert.equal(app.scroll,440);
});

test('album and decoration returns keep their own selection; genuine list changes start at the top',()=>{
 const {app}=fixture();app.openCollection('albums');app.selectAlbum('album-b');app.albumListScroll=150;app.scroll=600;
 app.navigate('help');app.back();assert.equal(app.albumId,'album-b');assert.equal(app.albumListScroll,150);assert.equal(app.scroll,600);
 app.selectAlbum('album-b');assert.equal(app.scroll,600);app.selectAlbum('album-c');assert.equal(app.scroll,0);
 app.openCollection('decorations');app.decorationId='leaf';app.decorationOwnedOnly=true;app.scroll=430;app.navigate('supplies');app.back();assert.equal(app.decorationId,'leaf');assert.equal(app.decorationOwnedOnly,true);assert.equal(app.scroll,430);
 app.changeListView(()=>{app.decorationOwnedOnly=false;});assert.equal(app.scroll,0);
 app.navigate('gallery');app.scroll=210;app.changeDirection('landscape');assert.equal(app.scroll,0);app.scroll=150;app.changeDirection('landscape');assert.equal(app.scroll,150);
});

test('unchanged applied filters retain position; changed filters reset and refresh',()=>{
 const {app}=fixture();let reads=0;app.loadLobby=async()=>{reads++;};app.scroll=360;
 app.showModal('filters');app.showModal(null);assert.equal(app.scroll,360);assert.equal(reads,0);
 app.showModal('filters');app.activeOnly=true;app.showModal(null);assert.equal(app.scroll,0);assert.equal(reads,1);
});

test('account switches clear saved routes and room return state; current layout clamps updated content',async()=>{
 const {app}=fixture();app.navigate('gallery');app.source='owned';app.packId='private-pack';app.selected='private-photo';app.scroll=700;app.openCollection('albums');app.albumId='private-album';app.scroll=900;
 app.client.account={id:'owner-b'};app.navigate('gallery');assert.equal(app.source,'free');assert.equal(app.packId,null);assert.equal(app.selected,null);assert.equal(app.scroll,0);app.back();assert.equal(app.albumId,'');assert.equal(app.scroll,0);
 app.collection={};app.scroll=900;app.extent=1;app.drawCollection=()=>{app.extent=1400;};app.drawScene();assert.equal(app.scroll,700,'clamp uses the completed current layout, not the previous page extent');
 app.bodyBottom=1000;app.drawScene();assert.equal(app.scroll,500,'a taller viewport clamps the restored offset');app.drawCollection=()=>{app.extent=200;};app.drawScene();assert.equal(app.scroll,0,'content shrink remains legal');
 app.roomReturn={...app.defaultListView('gallery'),source:'owned',packId:'old-owner'};app.client.account={id:'owner-c'};app.exitRoom();assert.equal(app.route,'lobby');assert.equal(app.packId,null);
});

test('account changes reset the task window tab even when its underlying route is another list',async t=>{
 t.mock.method(globalThis,'setInterval',()=>1);const {app}=fixture();Object.assign(app,{cleanups:[],timers:[],loadInitialContent:async()=>{}});app.client.start=async()=>{};await app.start();
 app.openCollection('albums');app.platform.viewport=()=>({width:1000,height:650,top:0,bottom:0});app.navigate('tasks');app.setTaskTab('gifts');assert.equal(app.route,'collection');assert.equal(app.modal,'tasks');assert.equal(app.taskTab,'gifts');
 app.client.account={id:'owner-b'};app.client.onChange();app.navigate('tasks');assert.equal(app.route,'collection');assert.equal(app.modal,'tasks');assert.equal(app.taskTab,'tasks');
});

test('quiet unchanged lobby reads preserve references and do not redraw; displayed changes and pagination do',async()=>{
 const {app,redraws}=fixture();delete app.loadLobby;const rooms=[card()];app.rooms=rooms;app.lobbyCursor='next';let response={rooms:[{...card(),elapsed:999,serverTime:200}],nextCursor:'next'};app.client.json=async()=>response;
 await app.loadLobby(false,true);assert.equal(app.rooms,rooms);assert.equal(redraws(),0);assert.equal(app.lobbyLoading,false);
 for(const update of [{players:3},{placed:11},{title:'新标题'},{acceptingNew:false},{thumbSrc:'/b.webp'}]){response={rooms:[{...app.rooms[0],...update}],nextCursor:'next'};const before=redraws();await app.loadLobby(false,true);assert.equal(redraws(),before+1);}
 response={rooms:[{...app.rooms[0]}],nextCursor:null};await app.loadLobby(false,true);assert.equal(app.lobbyCursor,null);
 app.lobbyCursor='next';response={rooms:[card('room-b')],nextCursor:'later'};await app.loadLobby(true);assert.equal(app.rooms.length,2);assert.equal(app.lobbyCursor,'later');assert.equal(app.lobbyLoading,false);
 const many=Array.from({length:32},(_,i)=>card(String(i)));app.rooms=many;response={rooms:many.slice(0,16).map(room=>({...room,serverTime:500})),nextCursor:'other'};const before=redraws();await app.loadLobby(false,true);assert.equal(app.rooms,many);assert.equal(app.lobbyCursor,'later');assert.equal(redraws(),before);
});

test('lobby loading and errors clear visibly, and obsolete account responses cannot overwrite lists',async()=>{
 const {app,redraws}=fixture();delete app.loadLobby;const pending=deferred();app.client.json=()=>pending.promise;
 const loading=app.loadLobby();assert.equal(app.lobbyBusy,true);assert.equal(redraws(),1);pending.resolve({rooms:[]});await loading;assert.equal(app.lobbyBusy,false);assert.equal(redraws(),2);
 app.client.json=async()=>{throw Error('离线');};await app.loadLobby();assert.equal(app.message,'离线');assert.equal(app.lobbyLoading,false);
 const old=deferred();app.client.json=()=>old.promise;const stale=app.loadLobby(false,true);app.client.account={id:'other'};old.resolve({rooms:[card('private')]});await stale;assert.deepEqual(app.rooms,[]);assert.equal(app.lobbyLoading,false);
});

test('empty chat and duplicate messages skip rebuilding and drawing while real changes remain visible',async()=>{
 const {app,redraws}=fixture();app.room={ticket:{room:{id:'room'},token:'token'}};const original=[{id:1,name:'玩家',text:'你好',code:'other',playerId:'other',level:2,sentAt:100}];app.messages=original;app.chatCursor=1;app.chatSeen=1;let response={messages:[],cursor:2};app.client.json=async()=>response;
 await app.loadChat();assert.equal(app.messages,original);assert.equal(app.chatCursor,2);assert.equal(app.chatLoading,false);assert.equal(redraws(),0);
 response={messages:[{...original[0],serverTime:900}],cursor:2};await app.loadChat();assert.equal(app.messages,original);assert.equal(redraws(),0);
 response={messages:[{...original[0],text:'更新'}],cursor:2};await app.loadChat();assert.equal(app.messages[0].text,'更新');assert.equal(redraws(),1);
 response={messages:[{id:3,name:'朋友',text:'来了',code:'friend',playerId:'friend'}],cursor:3};await app.loadChat();assert.equal(app.messages.length,2);assert.equal(redraws(),2);
 app.modal='chat';response={messages:[],cursor:3};await app.loadChat();assert.equal(app.chatSeen,3);assert.equal(redraws(),3,'reading existing unread messages still updates the badge');await app.loadChat();assert.equal(redraws(),3);
 app.client.json=async()=>{throw Error('聊天离线');};await app.loadChat();assert.equal(app.message,'聊天离线');assert.equal(app.chatLoading,false);
});

test('image preparation shows actual phase and a failed retry remains retryable',async()=>{
 const {app,buttons,texts}=fixture();app.platform.preparation={phase:'preparing',completed:12,total:48};await app.attachTicket(ticket());assert.equal(app.imageReady,false);app.drawRoom();assert.ok(texts.some(text=>text.includes('正在准备碎片 12/48')));
 app.board.imagePreparation={phase:'loading',completed:0,total:48};texts.length=0;app.drawRoom();assert.ok(texts.some(text=>text.includes('正在加载图片')));
 app.platform.imageFailure='图片再次失败';app.imageError='第一次失败';await app.run(()=>app.retryRoomImage(app.board));assert.equal(app.imageError,'图片再次失败');assert.equal(app.imageReady,false);buttons.length=0;app.drawRoom();assert.ok(buttons.some(button=>button.label==='重新加载图片'));
 delete app.platform.imageFailure;app.platform.preparation={phase:'ready',completed:48,total:48};await app.run(()=>app.retryRoomImage(app.board));assert.equal(app.imageError,'');assert.equal(app.imageReady,true);
});
