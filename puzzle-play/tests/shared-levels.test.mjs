import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {SqliteD1} from '../server/sqlite.mjs';
import {DEFAULT_GAME_SETTINGS} from '../server/game-settings.mjs';
import {DEFAULT_TASK_REWARD_SETTINGS} from '../server/task-reward-settings.mjs';
import {newManagedProfile} from '../lib/managed-economy-model.mjs';

const root=fileURLToPath(new URL('../',import.meta.url)),origin='http://localhost',owner='a'.repeat(32),peer='b'.repeat(32),token='c'.repeat(64),now=1800000000000,pieces=[12,16,20,24,30,35];
globalThis.__sharedLevelsEnv={PUZZLE_LOCAL_ORIGIN:origin,PUZZLE_BETA_CAPACITY:'0'};
const built=await build({absWorkingDir:root,stdin:{contents:'export * from "./lib/shared-levels";export {sharedClientApi} from "./lib/shared-client-api";export {sharedProfile} from "./lib/shared-client-model";export {RESTORABLE_PHOTOS} from "./lib/puzzle-catalog";export {managedGalleryPhotos} from "./lib/managed-content";',resolveDir:root,loader:'ts'},bundle:true,write:false,format:'esm',platform:'node',target:'es2022',plugins:[{name:'test-platform',setup(b){b.onResolve({filter:/^cloudflare:workers$/},()=>({path:'env',namespace:'test'}));b.onLoad({filter:/.*/,namespace:'test'},()=>({contents:'export const env=globalThis.__sharedLevelsEnv;',loader:'js'}));}}]});
const api=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'));
const chapter=(id,albumId='shiguang-ch1')=>({id,title:'章节 '+id,albumId,pieces:[...pieces]});
const configuration=(chapters=[chapter('ch1'),chapter('ch2','second')])=>({schema:'jigsaw-levels/v1',firstClearEnergy:30,chapters});
function fixture(t){
 const db=new SqliteD1(':memory:',fileURLToPath(new URL('../drizzle/',import.meta.url)));
 globalThis.__sharedLevelsEnv.PUZZLE_DB=db;
 const photos=api.RESTORABLE_PHOTOS.slice(0,12).map(p=>({...p,width:1200,height:900}));
 const album=(id,images)=>({id,title:id,description:'',showOnPc:true,showOnMobile:true,purchasable:false,price:0,imageIds:images.map(p=>p.id),coverImageId:null,milestones:[]});
 const content={releaseId:'shared-levels-test',gameSettings:structuredClone(DEFAULT_GAME_SETTINGS),taskRewards:structuredClone(DEFAULT_TASK_REWARD_SETTINGS),photos,albums:{albums:[album('shiguang-ch1',photos.slice(0,6)),album('second',photos.slice(6,12))]},dailyRuntime:{select:()=>photos[0],managedImageIds:()=>new Set(),releasedImageIds:()=>new Set(),albumEntries:()=>[]}};
 globalThis.__sharedLevelsEnv.PUZZLE_CONTENT_SNAPSHOT=()=>content;
 db.sql.prepare('INSERT INTO puzzle_users VALUES(?,?,?,?,?,?)').run(owner,owner,'关卡玩家','hash','salt',Date.now());
 db.sql.prepare('INSERT INTO puzzle_sessions VALUES(?,?,?)').run(createHash('sha256').update(token).digest('hex'),owner,Date.now()+86400000);
 t.after(()=>{db.close();delete globalThis.__sharedLevelsEnv.PUZZLE_DB;delete globalThis.__sharedLevelsEnv.PUZZLE_CONTENT_SNAPSHOT;});
 const request=async(path='/api/levels',cookie='puzzle_session='+token,method='GET',body={})=>{
  const response=await api.sharedClientApi(new Request(origin+'/api/shared'+path,{method,headers:{Cookie:cookie,Origin:origin,...(method==='GET'?{}:{'Content-Type':'application/json'})},...(method==='GET'?{}:{body:JSON.stringify(body)})}),path);
  return {status:response.status,data:await response.json(),headers:response.headers};
 };
 const view=(config=configuration(),identity=owner,time=now)=>api.levelsView(identity,content,origin,time,api.readLevelConfiguration(config));
 const clear=(id,identity=owner)=>api.recordLevelClear(identity,id,'fixture-room',now);
 return {db,photos,content,request,view,clear};
}

test('level configuration defaults, required fields and malformed documents match the shared contract',()=>{
 assert.deepEqual(api.readLevelConfiguration(),{schema:'jigsaw-levels/v1',seriesTitle:'拾光物语',firstClearEnergy:30,chapters:[{id:'ch1',title:'开张',albumId:'shiguang-ch1',pieces,lines:['这就是奶奶的店……好旧啊。','你是……这家店的猫？','回忆碎了，就把它拼回来。','爷爷想不起来早餐店开张那天了……','是爷爷！他在笑！','拾光镇还有好多回忆在等人拼。']}]});
 const bad=[null,[],{}, {...configuration(),schema:'other'}, {...configuration(),firstClearEnergy:-1}, {...configuration(),firstClearEnergy:1.5}, {...configuration(),firstClearEnergy:'30'}, {...configuration(),firstClearEnergy:Number.MAX_SAFE_INTEGER+1}, {...configuration(),chapters:[]}, {...configuration(),chapters:{}}, {...configuration(),extra:true}];
 for(const field of ['schema','firstClearEnergy','chapters']){const input=configuration();delete input[field];bad.push(input);}
 for(const patch of [{id:''},{id:'bad/id'},{id:'A'},{id:'a'.repeat(101)},{title:' '},{title:'一'.repeat(181)},{albumId:null},{albumId:'bad/id'},{pieces:[12]},{pieces:[12,16,20,24,30,0]},{pieces:[12,16,20,24,30,-1]},{pieces:[12,16,20,24,30,1.5]},{pieces:[12,16,20,24,30,'35']},{pieces:[12,16,20,24,30,Number.MAX_SAFE_INTEGER+1]},{extra:true}])bad.push(configuration([{...chapter('ch1'),...patch}]));
 for(const field of ['id','title','albumId','pieces']){const input=chapter('ch1');delete input[field];bad.push(configuration([input]));}
 bad.push(configuration([null]),configuration([[]]),configuration([chapter('ch1'),chapter('ch1')]));
 for(const input of bad)assert.throws(()=>api.readLevelConfiguration(input),/Invalid levels configuration/);
 const input=configuration(),copy=api.readLevelConfiguration(input);input.chapters[0].pieces[0]=999;assert.equal(copy.chapters[0].pieces[0],12);
});

test('optional series title and lines validate lengths and are copied independently',()=>{
 const input={...configuration([{...chapter('ch1'),lines:['开张啦',null,'一'.repeat(40)]}]),seriesTitle:'拾光物语'},copy=api.readLevelConfiguration(input);
 assert.equal(copy.seriesTitle,'拾光物语');assert.deepEqual(copy.chapters[0].lines,input.chapters[0].lines);input.chapters[0].lines[0]='changed';assert.equal(copy.chapters[0].lines[0],'开张啦');
 for(const seriesTitle of [null,undefined,1,'',' ','一'.repeat(41)])assert.throws(()=>api.readLevelConfiguration({...configuration(),seriesTitle}),/Invalid levels configuration/);
 for(const lines of [null,undefined,'line',{},Array(7).fill(null),[''],[' '],[1],[false],[{}],['一'.repeat(41)]])assert.throws(()=>api.readLevelConfiguration(configuration([{...chapter('ch1'),lines}])),/Invalid levels configuration/);
 assert.equal(api.readLevelConfiguration({...configuration(),seriesTitle:'一'.repeat(40)}).seriesTitle.length,40);
 assert.deepEqual(api.readLevelConfiguration(configuration([{...chapter('ch1'),lines:[]}])).chapters[0].lines,[]);
});

test('level migration preserves first clear, isolates owners and grants no energy',async t=>{
 const f=fixture(t),sql=f.db.sql;
 assert.deepEqual(sql.prepare('PRAGMA table_info(puzzle_level_progress)').all().map(row=>[row.name,row.type,row.pk]),[['owner','TEXT',1],['level_id','TEXT',2],['room_id','TEXT',0],['cleared_at','INTEGER',0],['energy','INTEGER',0]]);
 assert.equal(await f.clear('ch1-1'),true);assert.equal(await api.recordLevelClear(owner,'ch1-1','other-room',now+1),false);
 assert.deepEqual(await api.levelProgress(owner),[{level_id:'ch1-1',room_id:'fixture-room',cleared_at:now,energy:0}]);assert.deepEqual(await api.levelProgress(peer),[]);
 sql.exec('BEGIN');assert.equal(await f.clear('ch1-2'),true);sql.exec('ROLLBACK');assert.equal((await api.levelProgress(owner)).length,1);
 assert.equal(await f.clear('ch1-1',peer),true);assert.equal((await api.levelProgress(peer)).length,1);
 assert.throws(()=>sql.prepare('INSERT INTO puzzle_level_progress(owner,level_id) VALUES(NULL,?)').run('ch1-2'),/NOT NULL/);
 assert.equal(sql.prepare('SELECT COUNT(*) n FROM puzzle_managed_players').get().n,0,'clear receipts do not create or reward wallets');
});

test('sequential and cross-chapter unlocks, current and all-cleared state are per player',async t=>{
 const f=fixture(t),first=await f.view();
 assert.deepEqual(first.chapters[0].levels.map(level=>level.status),['unlocked','locked','locked','locked','locked','locked']);
 assert.ok(first.chapters[1].levels.every(level=>level.status==='locked'));assert.deepEqual(first.current,first.chapters[0].levels[0]);
 assert.equal(first.seriesTitle,null);assert.ok(first.chapters.every(ch=>ch.levels.every(level=>level.line===null)));
 assert.deepEqual(first.chapters[0].levels.map(level=>[level.id,level.imageId,level.title,level.pieces]),f.photos.slice(0,6).map((p,i)=>['ch1-'+(i+1),p.id,p.title,pieces[i]]));
 for(let n=1;n<=6;n++){await f.clear('ch1-'+n);const view=await f.view();assert.equal(view.current.id,n===6?'ch2-1':'ch1-'+(n+1));assert.equal(view.chapters[0].levels[n-1].status,'cleared');assert.equal(view.chapters[1].levels[0].status,n===6?'unlocked':'locked');}
 assert.equal((await f.view(configuration(),peer)).current.id,'ch1-1');
 for(let n=1;n<=6;n++)await f.clear('ch2-'+n);
 const complete=await f.view();assert.equal(complete.current,null);assert.ok(complete.chapters.every(ch=>ch.levels.every(level=>level.status==='cleared')));
});

test('current chooses the first unlocked level and ignores uncleared or foreign progress',async t=>{
 const f=fixture(t);await f.clear('ch1-3');await f.clear('unknown-1');await f.clear('ch1-1',peer);
 f.db.sql.prepare('INSERT INTO puzzle_level_progress VALUES(?,?,?,?,?)').run(owner,'ch1-1',null,null,0);
 const view=await f.view();assert.equal(view.current.id,'ch1-1');assert.equal(view.chapters[0].levels[1].status,'locked');assert.equal(view.chapters[0].levels[3].status,'unlocked');
});

test('view preserves configured order, cover, series title and lines with absolute thumbnails',async t=>{
 const f=fixture(t),album=f.content.albums.albums[0];album.imageIds.reverse();album.coverImageId=album.imageIds[4];
 const config={...configuration([{...chapter('ch1'),lines:['开张啦',null,'第三格']}]),seriesTitle:'拾光物语'},view=await f.view(config);
 assert.equal(view.seriesTitle,'拾光物语');assert.deepEqual(view.chapters[0].levels.map(level=>level.line),['开张啦',null,'第三格',null,null,null]);assert.equal(view.current.line,'开张啦');
 assert.deepEqual(view.chapters[0].levels.map(level=>level.imageId),album.imageIds);assert.equal(view.chapters[0].coverImageId,album.coverImageId);
 assert.equal(view.chapters[0].coverSrc,new URL(f.photos.find(p=>p.id===album.coverImageId).thumbSrc,origin).href);
 album.coverImageId=null;assert.equal((await f.view(config)).chapters[0].coverImageId,album.imageIds[0]);
});

test('missing albums, short albums and missing photos make the whole chapter unavailable',async t=>{
 const f=fixture(t),original=structuredClone(f.content.albums.albums);
 for(const mode of ['missing','short','missing-photo']){
  f.content.albums.albums=structuredClone(original);f.content.photos=[...f.photos];const album=f.content.albums.albums[0];
  if(mode==='missing')f.content.albums.albums.shift();
  if(mode==='short')album.imageIds.pop();
  if(mode==='missing-photo')f.content.photos=f.photos.filter(p=>p.id!==album.imageIds[2]);
  await f.clear('ch1-6');const view=await f.view();assert.equal(view.chapters[0].status,'unavailable');assert.ok(view.chapters[0].levels.every(level=>level.status==='unavailable'));assert.equal(view.chapters[1].levels[0].status,'locked');assert.equal(view.current,null);
 }
});

test('a level-only album hidden on both ends still supplies the chapter but stays out of the gallery',async t=>{
 const f=fixture(t),album=f.content.albums.albums[0];album.showOnPc=false;album.showOnMobile=false;
 const view=await f.view();assert.equal(view.chapters[0].status,'available');assert.equal(view.current.id,'ch1-1');assert.deepEqual(view.chapters[0].levels.map(level=>level.imageId),album.imageIds.slice(0,6));
 assert.ok(api.managedGalleryPhotos(f.content).every(photo=>!album.imageIds.includes(photo.id)));
});

test('level availability follows effective album release timing',async t=>{
 const f=fixture(t),imageId=f.photos[5].id,release=now+1000;
 f.content.dailyRuntime.managedImageIds=()=>new Set([imageId]);f.content.dailyRuntime.releasedImageIds=time=>new Set(time>=release?[imageId]:[]);
 assert.equal((await f.view()).chapters[0].status,'unavailable');assert.equal((await f.view(configuration(),owner,release)).current.id,'ch1-1');
});

test('findLevel and destination follow configured order and chapter boundaries',async t=>{
 const f=fixture(t),config=configuration(),view=await f.view(config);
 assert.deepEqual(api.findLevel(view,'ch2-2'),view.chapters[1].levels[1]);assert.equal(api.findLevel(view,'unknown'),undefined);
 assert.deepEqual(api.destination('ch1-1'),{nextLevelId:'ch1-2',chapterComplete:false});
 assert.deepEqual(api.destination('ch1-6',config),{nextLevelId:'ch2-1',chapterComplete:true});
 assert.deepEqual(api.destination('ch2-6',config),{nextLevelId:null,chapterComplete:true});
 assert.deepEqual(api.destination('unknown',config),{nextLevelId:null,chapterComplete:false});
});

test('GET levels uses player cookies, returns the shared shape and never creates rooms or progress',async t=>{
 const f=fixture(t),response=await f.request('/api/levels','');assert.equal(response.status,200,JSON.stringify(response.data));
 assert.match(response.headers.get('set-cookie'),/^puzzle_guest=[a-f0-9]{64};/);assert.match(response.headers.get('cache-control'),/no-store/);
 const view=response.data;assert.deepEqual(Object.keys(view).sort(),['chapters','current','firstClearEnergy','seriesTitle']);assert.equal(view.seriesTitle,'拾光物语');assert.equal(view.firstClearEnergy,30);
 assert.deepEqual(Object.keys(view.chapters[0]).sort(),['albumId','coverImageId','coverSrc','id','levels','status','title']);
 assert.deepEqual(Object.keys(view.current).sort(),['id','imageId','line','pieces','status','title']);assert.equal(view.current.id,'ch1-1');assert.equal(view.current.line,'这就是奶奶的店……好旧啊。');assert.ok(view.chapters[0].coverSrc.startsWith(origin+'/'));
 const cookie=response.headers.get('set-cookie').split(';')[0];assert.deepEqual((await f.request('/api/levels',cookie)).data,view);
 assert.equal((await f.request('/api/mobile/profile',cookie)).data.newcomer,true);
 for(const table of ['puzzle_level_progress','puzzle_rooms'])assert.equal(f.db.sql.prepare('SELECT COUNT(*) n FROM '+table).get().n,0);
});

test('newcomer becomes false for owned rooms, managed room history or any level progress',async t=>{
 const f=fixture(t),profile=()=>f.request('/api/mobile/profile');assert.equal((await profile()).data.newcomer,true);
 const made=await f.request('/api/levels');assert.equal(made.status,200);assert.equal((await profile()).data.newcomer,true,'viewing levels does not consume newcomer status');
 const response=await api.sharedClientApi(new Request(origin+'/api/shared/api/rooms',{method:'POST',headers:{Cookie:'puzzle_session='+token,Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({imageId:f.photos[0].id,pieces:108,visibility:'public'})}),'/api/rooms');
 const created=await response.json();assert.equal(response.status,201,JSON.stringify(created));assert.equal((await profile()).data.newcomer,false);
 f.db.sql.prepare('DELETE FROM puzzle_rooms').run();
 const row=f.db.sql.prepare('SELECT data FROM puzzle_managed_players WHERE owner=?').get(owner),state=JSON.parse(row.data);state.rooms={};
 const save=()=>f.db.sql.prepare('UPDATE puzzle_managed_players SET data=? WHERE owner=?').run(JSON.stringify(state),owner);save();assert.equal((await profile()).data.newcomer,true);
 state.rooms.old={};save();assert.equal((await profile()).data.newcomer,false);state.rooms={};save();
 f.db.sql.prepare('INSERT INTO puzzle_level_progress(owner,level_id) VALUES(?,?)').run(owner,'ch1-1');assert.equal((await profile()).data.newcomer,false,'even an uncleared progress record counts');
 assert.deepEqual(await api.levelProgress(peer),[]);
});

test('newcomer profile remains false after a managed action refresh',async t=>{
 const f=fixture(t),state=newManagedProfile();
 state.gifts['ten:1']={id:'ten:1',source:'ten:1',kind:'ten-grid',title:'旧礼包',coins:13,xp:5,createdAt:Date.now(),openedAt:null};
 f.db.sql.prepare('INSERT INTO puzzle_managed_players(owner,data,updated_at) VALUES(?,?,?)').run(owner,JSON.stringify(state),Date.now());
 await f.clear('ch1-1');
 assert.equal((await f.request('/api/mobile/profile')).data.newcomer,false);
 const opened=await f.request('/api/mobile/gifts/open',undefined,'POST',{kind:'ten:1'});assert.equal(opened.status,200,JSON.stringify(opened.data));assert.equal(opened.data.profile.newcomer,false);assert.equal(opened.data.opened.coins,13);
 assert.equal((await f.request('/api/mobile/collection')).data.profile.newcomer,false);
 assert.equal(api.sharedProfile({}, {},null,[],{},[{level_id:'ch1-1'}]).newcomer,false);
});
