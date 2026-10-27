import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdirSync,mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {resolve,sep} from 'node:path';
import {createMobileLevels,readLevelConfiguration} from '../server/mobile-levels.mjs';
import {createMobileCollection,MOBILE_COLLECTION_CATALOG as catalog} from '../server/mobile-collection.mjs';
import {createMobileService} from '../server/mobile-service.mjs';
import {RESTORABLE_PHOTOS as photos} from '../outputs/mobile/engine.mjs';

const owner='a'.repeat(64),peer='b'.repeat(64),now=1800000000000,pieces=[12,16,20,24,30,35];
const chapter=(id,albumId=catalog.packs[0].id)=>({id,title:'章节 '+id,albumId,pieces:[...pieces]});
const configuration=(chapters=[chapter('ch1'),chapter('ch2',catalog.packs[1].id)])=>({schema:'jigsaw-levels/v1',firstClearEnergy:30,chapters});
function fixture(t,{config=configuration(),...options}={}){
 const root=resolve('data');mkdirSync(root,{recursive:true});const dir=mkdtempSync(resolve(root,'mobile-levels-test-')),databasePath=resolve(dir,'mobile.sqlite');
 const service=createMobileService({databasePath,now:()=>now,randomInt:min=>min,levels:config,...options}),db=new DatabaseSync(databasePath);
 t.after(()=>{db.close();service.close();assert.ok(dir.startsWith(root+sep));rmSync(dir,{recursive:true,force:true});});
 const call=(identity=owner,url='/api/levels',method='GET')=>service.handle({identity,url,method});
 const view=(identity=owner)=>{const result=call(identity);assert.equal(result.status,200,JSON.stringify(result));return result.data;};
 const clear=(id,identity=owner)=>db.prepare('INSERT INTO mobile_level_progress VALUES(?,?,?,?,?)').run(identity,id,'fixture-room',now,30);
 return {service,db,call,view,clear};
}

test('levels configuration defaults and malformed documents fail during service creation',()=>{
 const defaults=readLevelConfiguration();assert.deepEqual(defaults,{schema:'jigsaw-levels/v1',seriesTitle:'拾光物语',firstClearEnergy:30,chapters:[{id:'ch1',title:'开张',albumId:'shiguang-ch1',pieces,lines:['这就是奶奶的店……好旧啊。','你是……这家店的猫？','回忆碎了，就把它拼回来。','爷爷想不起来早餐店开张那天了……','是爷爷！他在笑！','拾光镇还有好多回忆在等人拼。']}]});
 const bad=[null,[],{}, {...configuration(),schema:'other'}, {...configuration(),firstClearEnergy:-1}, {...configuration(),firstClearEnergy:1.5}, {...configuration(),firstClearEnergy:'30'}, {...configuration(),chapters:[]}, {...configuration(),chapters:{}}, {...configuration(),extra:true}];
 for(const patch of [{id:''},{id:'bad/id'},{title:' '},{albumId:null},{pieces:[12]},{pieces:[12,16,20,24,30,0]},{pieces:[12,16,20,24,30,1.5]},{pieces:[12,16,20,24,30,'35']},{pieces:[12,16,20,24,30,Number.MAX_SAFE_INTEGER+1]},{extra:true}])bad.push(configuration([{...chapter('ch1'),...patch}]));
 bad.push(configuration([chapter('ch1'),chapter('ch1')]));
 for(const levels of bad)assert.throws(()=>createMobileService({levels}),/Invalid levels configuration/);
 const input=configuration(),copy=readLevelConfiguration(input);input.chapters[0].pieces[0]=999;assert.equal(copy.chapters[0].pieces[0],12);
});

test('level progress schema, owner isolation, first-write receipt and transaction rollback',t=>{
 const db=new DatabaseSync(':memory:');t.after(()=>db.close());const collection=createMobileCollection({db,photos}),levels=createMobileLevels({db,photos,collection,configuration:configuration()});
 createMobileLevels({db,photos,collection,configuration:configuration()});
 assert.deepEqual(db.prepare('PRAGMA table_info(mobile_level_progress)').all().map(row=>[row.name,row.type,row.pk]),[['owner','TEXT',1],['level_id','TEXT',2],['room_id','TEXT',0],['cleared_at','INTEGER',0],['energy','INTEGER',0]]);
 assert.equal(levels.recordClear(owner,'ch1-1','room-a',now,30),true);
 assert.equal(levels.recordClear(owner,'ch1-1','room-b',now+1,99),false);
 assert.deepEqual(levels.progress(owner).map(row=>({...row})),[{level_id:'ch1-1',room_id:'room-a',cleared_at:now,energy:30}]);assert.deepEqual(levels.progress(peer),[]);
 db.exec('BEGIN');assert.equal(levels.recordClear(owner,'ch1-2','room-c',now,30),true);db.exec('ROLLBACK');assert.equal(levels.progress(owner).length,1);
 assert.equal(levels.recordClear(peer,'ch1-1','room-d',now,30),true);assert.equal(levels.progress(peer).length,1);
});

test('optional seriesTitle and chapter lines validate their shape and length and are copied independently',()=>{
 const input={...configuration(),seriesTitle:'拾光物语',chapters:[{...chapter('ch1'),lines:['开张啦',null,'一'.repeat(40)]}]},copy=readLevelConfiguration(input);assert.equal(copy.seriesTitle,'拾光物语');assert.deepEqual(copy.chapters[0].lines,input.chapters[0].lines);input.chapters[0].lines[0]='changed';assert.equal(copy.chapters[0].lines[0],'开张啦');
 for(const seriesTitle of [null,undefined,1,'',' ','一'.repeat(41)])assert.throws(()=>readLevelConfiguration({...configuration(),seriesTitle}),/Invalid levels configuration/);
 for(const lines of [null,undefined,'line',{},Array(7).fill(null),[''],[' '],[1],[false],[{}],['一'.repeat(41)]])assert.throws(()=>readLevelConfiguration(configuration([{...chapter('ch1'),lines}])),/Invalid levels configuration/);
 assert.equal(readLevelConfiguration({...configuration(),seriesTitle:'一'.repeat(40)}).seriesTitle.length,40);assert.deepEqual(readLevelConfiguration(configuration([{...chapter('ch1'),lines:[]}])).chapters[0].lines,[]);
});

test('GET levels returns configured series and each line, defaulting omitted values to null',t=>{
 const f=fixture(t,{config:{...configuration([{...chapter('ch1'),lines:['开张啦',null,'第三格']}]),seriesTitle:'拾光物语'}}),view=f.view();assert.equal(view.seriesTitle,'拾光物语');assert.deepEqual(view.chapters[0].levels.map(level=>level.line),['开张啦',null,'第三格',null,null,null]);assert.equal(view.current.line,'开张啦');
 const omitted=fixture(t).view();assert.equal(omitted.seriesTitle,null);assert.ok(omitted.chapters.every(chapter=>chapter.levels.every(level=>level.line===null)));
});

test('static and managed album readers preserve order, cover, source precedence and read-only results',t=>{
 const db=new DatabaseSync(':memory:');t.after(()=>db.close());let document=null;
 const pack=catalog.packs[0],collection=createMobileCollection({db,photos,readAlbums:()=>document});
 const first=collection.albumImages(pack.id,now);assert.deepEqual(first,{imageIds:pack.imageIds,coverImageId:null});
 first.imageIds.reverse();assert.deepEqual(collection.albumImages(pack.id,now).imageIds,pack.imageIds);assert.equal(collection.albumImages('missing',now),null);
 document={albums:[{id:pack.id,imageIds:[...pack.imageIds].reverse(),coverImageId:pack.imageIds[4]}]};
 assert.deepEqual(collection.albumImages(pack.id,now),{imageIds:[...pack.imageIds].reverse(),coverImageId:pack.imageIds[4]});
 assert.equal(collection.albumImages(catalog.packs[1].id,now),null,'managed content must not fall back to a static pack');
 assert.deepEqual(collection.albumImages(pack.id,now).imageIds,[...pack.imageIds].reverse());
});

test('album reader uses managed publication timing and appends released daily images',t=>{
 const db=new DatabaseSync(':memory:');t.after(()=>db.close());const imageIds=catalog.packs[0].imageIds,release=now+1000;
 const document={albums:[{id:'managed',imageIds:imageIds.slice(0,5),coverImageId:null}]};
 const dailyContent={managedImageIds:()=>new Set([imageIds[4],imageIds[5]]),releasedImageIds:time=>new Set(time>=release?[imageIds[4],imageIds[5]]:[]),albumEntries:time=>time>=release?[{album:{id:'managed'},imageIds:[imageIds[5]]}]:[]};
 const collection=createMobileCollection({db,photos,readAlbums:()=>document,dailyContent});
 assert.deepEqual(collection.albumImages('managed',now).imageIds,imageIds.slice(0,4));assert.deepEqual(collection.albumImages('managed',release).imageIds,imageIds);
});

test('GET levels uses normal identity flow and is unavailable until the configured album is delivered',t=>{
 const f=fixture(t,{levels:undefined}),view=f.view();
 assert.equal(f.call(null).status,401);assert.equal(f.call('invalid').data.code,'IDENTITY_REQUIRED');
 assert.equal(view.firstClearEnergy,30);assert.equal(view.current,null);assert.equal(view.chapters[0].status,'unavailable');assert.equal(view.chapters[0].coverImageId,null);
 assert.ok(view.chapters[0].levels.every(level=>level.status==='unavailable'));
 assert.ok(f.db.prepare('SELECT data FROM mobile_profiles WHERE id=?').get(owner));
 assert.equal(f.db.prepare('SELECT COUNT(*) n FROM mobile_level_progress').get().n,0);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM mobile_rooms').get().n,0);
});

test('sequential unlocks, cross-chapter gate, current and all-cleared state are per player',t=>{
 const f=fixture(t),first=f.view(),pack=catalog.packs[0];
 assert.deepEqual(first.chapters[0].levels.map(level=>level.status),['unlocked','locked','locked','locked','locked','locked']);
 assert.ok(first.chapters[1].levels.every(level=>level.status==='locked'));assert.deepEqual(first.current,first.chapters[0].levels[0]);
 assert.equal(first.chapters[0].coverImageId,pack.imageIds[0]);assert.equal(first.chapters[0].coverSrc,photos.find(photo=>photo.id===pack.imageIds[0]).thumbSrc);
 assert.deepEqual(first.chapters[0].levels.map(level=>[level.id,level.imageId,level.title,level.pieces]),pack.imageIds.map((id,index)=>['ch1-'+(index+1),id,photos.find(photo=>photo.id===id).title,pieces[index]]));
 for(let n=1;n<=6;n++){
  f.clear('ch1-'+n);const view=f.view();assert.equal(view.current.id,n===6?'ch2-1':'ch1-'+(n+1));assert.equal(view.chapters[0].levels[n-1].status,'cleared');
  assert.equal(view.chapters[1].levels[0].status,n===6?'unlocked':'locked');
 }
 assert.equal(f.view(peer).current.id,'ch1-1');
 for(let n=1;n<=6;n++)f.clear('ch2-'+n);
 const complete=f.view();assert.equal(complete.current,null);assert.ok(complete.chapters.every(ch=>ch.levels.every(level=>level.status==='cleared')));
 assert.equal(f.db.prepare('SELECT COUNT(*) n FROM mobile_events').get().n,0,'reading does not start or clear levels');
});

test('current selects the first unlocked uncleared level and ignores uncleared or foreign progress',t=>{
 const f=fixture(t);f.clear('ch1-3');f.clear('unknown-1');f.clear('ch1-1',peer);
 f.db.prepare('INSERT INTO mobile_level_progress VALUES(?,?,?,?,?)').run(owner,'ch1-1',null,null,0);
 const view=f.view();assert.equal(view.current.id,'ch1-1');assert.equal(view.chapters[0].levels[1].status,'locked');assert.equal(view.chapters[0].levels[3].status,'unlocked');
});

test('managed albums supply image titles and covers regardless of gallery visibility and purchase',t=>{
 const pack=catalog.packs[0],imageIds=[...pack.imageIds].reverse();let document={albums:[{id:'managed',imageIds,coverImageId:imageIds[4],showOnPc:false,showOnMobile:false,purchasable:true,price:180}]};
 const f=fixture(t,{config:configuration([chapter('ch1','managed')]),albumContent:{read:()=>document}}),view=f.view();
 assert.equal(view.current.imageId,imageIds[0]);assert.equal(view.current.title,photos.find(photo=>photo.id===imageIds[0]).title);
 assert.equal(view.chapters[0].coverImageId,imageIds[4]);assert.equal(view.chapters[0].coverSrc,photos.find(photo=>photo.id===imageIds[4]).thumbSrc);
 document={albums:[{...document.albums[0],coverImageId:null}]};assert.equal(f.view().chapters[0].coverImageId,imageIds[0]);
 document={albums:[]};assert.equal(f.view().chapters[0].status,'unavailable');
});

test('missing albums, short albums and missing photos mark whole chapters unavailable without skipping',t=>{
 const imageIds=catalog.packs[0].imageIds;
 for(const album of [null,{id:'missing',imageIds:imageIds.slice(0,5)},{id:'missing',imageIds:[imageIds[0],'no-such-photo',...imageIds.slice(2)]}]){
  const albums=[...(album?[album]:[]),{id:'next',imageIds}];
  const f=fixture(t,{config:configuration([chapter('ch1','missing'),chapter('ch2','next')]),albumContent:{read:()=>({albums})}});
  f.clear('ch1-6');const view=f.view();assert.equal(view.chapters[0].status,'unavailable');assert.ok(view.chapters[0].levels.every(level=>level.status==='unavailable'));
  assert.equal(view.chapters[1].levels[0].status,'locked');assert.equal(view.current,null);
  if(album?.imageIds.includes('no-such-photo')){assert.equal(view.chapters[0].levels[1].imageId,'no-such-photo');assert.equal(view.chapters[0].levels[1].title,null);assert.equal(view.chapters[0].levels[2].imageId,imageIds[2]);}
 }
});

test('all three server packages include the levels module and default configuration',()=>{
 for(const name of ['package-h5-server','package-mobile-backend','package-mobile-upgrade']){
  const script=readFileSync(new URL('../scripts/'+name+'.mjs',import.meta.url),'utf8');
  for(const path of ['server/mobile-levels.mjs','config/levels.json'])assert.ok(script.includes("'"+path+"'"),name+' missing '+path);
 }
});
