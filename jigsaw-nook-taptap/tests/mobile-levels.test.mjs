import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {createHash,randomBytes} from 'node:crypto';
import {mkdirSync,mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {resolve,sep} from 'node:path';
import {createMobileLevels,readLevelConfiguration} from '../server/mobile-levels.mjs';
import {createMobileCollection,MOBILE_COLLECTION_CATALOG as catalog} from '../server/mobile-collection.mjs';
import {createMobileService} from '../server/mobile-service.mjs';
import {RESTORABLE_PHOTOS as photos} from '../outputs/mobile/engine.mjs';

const owner='a'.repeat(64),peer='b'.repeat(64),now=1800000000000,pieces=[12,16,20,24,30,35];
const chapter=(id,albumId=catalog.packs[0].id)=>({id,title:'章节 '+id,albumId,pieces:[...pieces]});
const configuration=(chapters=[chapter('ch1'),chapter('ch2',catalog.packs[1].id)])=>({schema:'jigsaw-levels/v1',firstClearEnergy:30,chapters});
function defaultAlbums(defaults){
 const used=new Set(catalog.packs.flatMap(pack=>pack.imageIds)),extra=photos.filter(photo=>!used.has(photo.id));
 return defaults.chapters.map((ch,index)=>({id:ch.albumId,imageIds:catalog.packs[index]?.imageIds??extra.slice((index-catalog.packs.length)*6,(index-catalog.packs.length+1)*6).map(photo=>photo.id)}));
}
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
 const defaults=readLevelConfiguration();assert.deepEqual({...defaults,chapters:defaults.chapters.slice(0,1)},{schema:'jigsaw-levels/v1',seriesTitle:'拾光物语',firstClearEnergy:30,chapters:[{id:'ch1',title:'奶奶的小店',albumId:'shiguang-ch1',pieces,lines:['这就是奶奶的店……好旧啊。','你是……这家店的猫？','回忆碎了，就把它拼回来。','爷爷想不起来早餐店开张那天了……','是爷爷！他在笑！','拾光镇还有好多回忆在等人拼。']}]});
 assert.equal(defaults.chapters.length,4);const {story,...breakfast}=defaults.chapters[1];
 assert.deepEqual(breakfast,{id:'ch2',title:'早餐街',albumId:'shiguang-ch2',pieces:[16,20,24,24,28,30],lines:['早餐店……飘到天上去了？','那天的包子什么味儿……想不起来喽。','团子，等等我！','这张菜谱……是奶奶的字！','奶奶也在！她在教福爷爷包包子。','奶奶的下一段回忆，在云上邮局。']});
 assert.equal(story.length,6);
 // Same timeLabel/intro/comic.panels as the bundled client copy of story-comics-ch2.json.
 assert.deepEqual(story,JSON.parse(readFileSync(new URL('../mobile/story-comics-ch2.json',import.meta.url),'utf8')).levels.map(({timeLabel,intro,comic})=>({timeLabel,intro,comic:{panels:comic.panels}})));
 assert.equal(createHash('sha256').update(JSON.stringify(story)).digest('hex'),'8e091598ca781891bad69cfcb1a92192abea786414c98d45a91f81aef394a4e0');
 const {story:postOfficeStory,...postOffice}=defaults.chapters[2],{story:aquariumStory,...aquarium}=defaults.chapters[3];
 assert.deepEqual(postOffice,{id:'ch3',title:'云上邮局',albumId:'shiguang-ch3',pieces:[24,24,35,35,35,40],lines:['这只纸鹤……是来接我们的？','欢迎来到云上邮局，咕。','这些信，都没能寄到。','收信人……是我？','奶奶写这封信的时候，我才五岁。','下一站，月光水族馆。']});
 assert.deepEqual(aquarium,{id:'ch4',title:'月光水族馆',albumId:'shiguang-ch4',pieces:[35,35,40,40,40,54],lines:['水族馆……沉在海里？','团子，别怕，有泡泡呢。','慢慢说，这里好久没人来了。','这是奶奶最早的回忆。','原来，拼图小窝是从这里开始的。','奶奶，小窝我会好好守着的。']});
 for(const chapterStory of [postOfficeStory,aquariumStory]){
  assert.equal(chapterStory.length,6);
  for(const level of chapterStory){assert.equal(typeof level.timeLabel,'string');assert.ok(level.timeLabel.trim());assert.equal(typeof level.intro,'string');assert.ok(level.intro.trim());assert.equal(level.comic.panels.length,4);}
 }
 assert.equal(createHash('sha256').update(JSON.stringify(postOfficeStory.map(({comicPage,...level})=>level))).digest('hex'),'c5b324ebb79d6e817ba166abdec032c3684b4096d5b56f4b4ade62322202e391');
 assert.equal(createHash('sha256').update(JSON.stringify(aquariumStory.map(({comicPage,...level})=>level))).digest('hex'),'600d42a0011958b525441df1d09e58677758802e22d57304b1bcba31ce2af019');
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

const storyEntry=()=>structuredClone(readLevelConfiguration().chapters[1].story[0]);
const pageEntry=()=>({src:'/puzzles/page.webp',panels:[[0,0,.5,.5],[.5,0,.5,.5],[0,.5,.5,.5],[.5,.5,.5,.5]]});
test('comicPage accepts local/https sources with optional thumbnails, deep copies, and passes through only when present',t=>{
 const story=[];
 for(const src of ['/puzzles/page.webp','https://example.test/page.webp'])for(const thumb of [false,true]){
  const comicPage={...pageEntry(),src,...(thumb?{thumbSrc:src.replace('.webp','-thumb.webp')}:{})};
  story.push({...storyEntry(),comicPage});
 }
 story.push(null,{});
 const input=configuration([{...chapter('ch1'),story}]),expected=structuredClone(story),copy=readLevelConfiguration(input);
 assert.deepEqual(copy.chapters[0].story,expected);
 input.chapters[0].story[0].comicPage.src='/changed.webp';input.chapters[0].story[0].comicPage.panels[0][0]=.1;input.chapters[0].story[0].comicPage.panels.push([0,0,1,1]);
 assert.deepEqual(copy.chapters[0].story,expected);
 const f=fixture(t,{config:copy}),view=f.view();
 view.chapters[0].levels.forEach((level,index)=>{
  assert.equal(Object.hasOwn(level,'comicPage'),index<4);
  if(index<4)assert.deepEqual(level.comicPage,expected[index].comicPage);
 });
 view.chapters[0].levels[0].comicPage.src='/changed.webp';view.chapters[0].levels[0].comicPage.panels[0][0]=.1;
 assert.deepEqual(f.view().chapters[0].levels[0].comicPage,expected[0].comicPage);
 const withPage=f.view().chapters[0].levels[0],baseline=fixture(t,{config:configuration([{...chapter('ch1'),story:[storyEntry()]}])}).view().chapters[0].levels[0];
 const {comicPage,...withoutPage}=withPage;assert.deepEqual(withoutPage,baseline);
 // Drawn pages exist for ch3/ch4 only (2026-10-29); ch1/ch2 keep their crops.
 assert.deepEqual(readLevelConfiguration().chapters.map(ch=>(ch.story??[]).filter(level=>Object.hasOwn(level??{},'comicPage')).length),[0,0,6,6]);
 assert.deepEqual(fixture(t,{config:readLevelConfiguration()}).view().chapters.map(ch=>ch.levels.filter(level=>Object.hasOwn(level,'comicPage')).length),[0,0,6,6]);
 const boundary=pageEntry();boundary.src='/'+'x'.repeat(299);boundary.panels[0]=[.50005,.50005,.5,.5];
 assert.deepEqual(readLevelConfiguration(configuration([{...chapter('ch1'),story:[{comicPage:boundary}]}])).chapters[0].story[0].comicPage,boundary);
});

test('invalid comicPage fails at startup with the levels configuration TypeError',async t=>{
 const bad=[null,undefined,[],1,'page',{}, {...pageEntry(),extra:true}];
 for(const src of [undefined,'',' ','/has space.webp','/has\nnewline.webp','http://example.test/a.webp','javascript:alert(1)','a.webp','/puzzles/../a.webp','https://example.test/../a.webp','https://','//example.test/a.webp','/\\example.test/a.webp','/'+'x'.repeat(300)])bad.push({...pageEntry(),src},{...pageEntry(),thumbSrc:src});
 const missing=pageEntry();delete missing.src;bad.push(missing);
 for(const panels of [undefined,null,{},[],pageEntry().panels.slice(0,3),[...pageEntry().panels,[0,0,1,1]]])bad.push({...pageEntry(),panels});
 for(const crop of [null,{},[0,0,1],[0,0,1,1,0],['0',0,1,1],[NaN,0,1,1],[Infinity,0,1,1],[-.1,0,1,1],[1.1,0,.1,1],[0,0,0,1],[0,0,1,0],[0,0,-1,1],[.51,0,.5,1],[0,.51,1,.5],[.5002,0,.5,1]])bad.push({...pageEntry(),panels:[crop,...pageEntry().panels.slice(1)]});
 for(const [index,comicPage]of bad.entries())await t.test(String(index),()=>assert.throws(()=>createMobileService({levels:configuration([{...chapter('ch1'),story:[{comicPage}]}])}),{name:'TypeError',message:'Invalid levels configuration'}));
});

test('story rejects malformed entries, nested shapes, crops and text bounds during startup',async t=>{
 const invalid=[['not array',()=>({})],['null array',()=>null],['too many entries',()=>Array(7).fill(null)],['string entry',()=>['story']]];
 const cases=[
  ['extra story key',s=>s.extra=true],['blank timeLabel',s=>s.timeLabel=' '],['long timeLabel',s=>s.timeLabel='时'.repeat(9)],['nonstring timeLabel',s=>s.timeLabel=1],
  ['blank intro',s=>s.intro='\n'],['long intro',s=>s.intro='文'.repeat(61)],['null intro',s=>s.intro=null],
  ['null comic',s=>s.comic=null],['extra comic key',s=>s.comic.extra=true],['missing panels',s=>delete s.comic.panels],['three panels',s=>s.comic.panels.pop()],['five panels',s=>s.comic.panels.push(s.comic.panels[0])],
  ['extra panel key',s=>s.comic.panels[0].extra=true],['missing crop',s=>delete s.comic.panels[0].crop],['three crop numbers',s=>s.comic.panels[0].crop.pop()],
  ['negative crop',s=>s.comic.panels[0].crop[0]=-.1],['crop above one',s=>s.comic.panels[0].crop[0]=1.1],['zero width',s=>s.comic.panels[0].crop[2]=0],['zero height',s=>s.comic.panels[0].crop[3]=0],
  ['overflow x',s=>s.comic.panels[0].crop=[.51,0,.5,1]],['overflow y',s=>s.comic.panels[0].crop=[0,.51,1,.5]],['outside rounding tolerance',s=>s.comic.panels[0].crop=[.5002,0,.5,1]],
  ['infinite crop',s=>s.comic.panels[0].crop[0]=Infinity],['NaN crop',s=>s.comic.panels[0].crop[0]=NaN],['string crop',s=>s.comic.panels[0].crop[0]='0'],
  ['non-array texts',s=>s.comic.panels[0].texts={}],['five texts',s=>s.comic.panels[0].texts=Array(5).fill(s.comic.panels[0].texts[0])],
  ['extra text key',s=>s.comic.panels[0].texts[0].extra=true],['invalid kind',s=>s.comic.panels[0].texts[0].kind='other'],['invalid at',s=>s.comic.panels[0].texts[0].at='center'],
  ['long text',s=>s.comic.panels[0].texts[0].text='文'.repeat(41)],['blank text',s=>s.comic.panels[0].texts[0].text=' '],['missing text',s=>delete s.comic.panels[0].texts[0].text],
 ];
 for(const [name,mutate]of cases)invalid.push([name,()=>{const entry=storyEntry();mutate(entry);return [entry];}]);
 for(const [name,make]of invalid)await t.test(name,()=>assert.throws(()=>createMobileService({levels:configuration([{...chapter('ch1'),story:make()}])}),/Invalid levels configuration/));
});

test('story accepts optional and boundary values and deep copies every mutable part',()=>{
 const entry=storyEntry();entry.timeLabel='时'.repeat(8);entry.intro='文'.repeat(60);entry.comic.panels[0].crop=[.50005,.50005,.5,.5];
 entry.comic.panels[0].texts=Array.from({length:4},()=>({kind:'say',at:'br',text:'文'.repeat(40)}));entry.comic.panels[1].texts=[];
 const story=[entry,null,{}, {timeLabel:'清晨'}, {intro:'只有旁白'}, {comic:storyEntry().comic}],input=configuration([{...chapter('ch1'),story}]),copy=readLevelConfiguration(input),expected=structuredClone(story);
 assert.deepEqual(copy.chapters[0].story,expected);
 entry.timeLabel='changed';entry.comic.panels[0].crop[0]=0;entry.comic.panels[0].texts[0].text='changed';entry.comic.panels.push({});story[1]={};story.push(null);
 assert.deepEqual(copy.chapters[0].story,expected);
 assert.deepEqual(readLevelConfiguration(configuration([{...chapter('ch1'),story:[]}])).chapters[0].story,[]);
});

test('level view appends only present story and photo fields, preserves original fields and current identity, and copies comics',t=>{
 const db=new DatabaseSync(':memory:');t.after(()=>db.close());const pack=catalog.packs[0],story=[storyEntry(),null,{}, {timeLabel:'上午'}, {intro:'旁白'}, {comic:storyEntry().comic}];
 const config=configuration([{...chapter('ch1'),lines:['开场']},{...chapter('ch2'),story}]),collection={albumImages:()=>pack};
 const levels=createMobileLevels({db,photos,collection,configuration:config}),view=levels.view(owner);
 const originalKeys=['id','imageId','title','pieces','status','line'];
 for(const [chapterIndex,ch]of view.chapters.entries())for(const [index,level]of ch.levels.entries()){
  const photo=photos.find(photo=>photo.id===pack.imageIds[index]);assert.deepEqual(Object.keys(level).slice(0,6),originalKeys);
  assert.deepEqual(Object.fromEntries(originalKeys.map(key=>[key,level[key]])),{id:ch.id+'-'+(index+1),imageId:photo.id,title:photo.title,pieces:pieces[index],status:chapterIndex===0&&index===0?'unlocked':'locked',line:chapterIndex===0&&index===0?'开场':null});
  assert.equal(level.src,photo.src);assert.equal(level.thumbSrc,photo.thumbSrc);
  for(const key of ['timeLabel','intro','comic'])assert.equal(Object.hasOwn(level,key),chapterIndex===1&&Object.hasOwn(story[index]??{},key));
 }
 assert.strictEqual(view.current,view.chapters[0].levels[0]);
 assert.equal(view.chapters[1].levels[0].comic.panels.length,4);assert.deepEqual(view.chapters[1].levels[0].comic,story[0].comic);
 view.chapters[1].levels[0].comic.panels[0].crop[0]=.1;view.chapters[1].levels[0].comic.panels[0].texts[0].text='changed';
 assert.deepEqual(levels.view(owner).chapters[1].levels[0].comic,story[0].comic);
 const noSources=photos.map(photo=>({...photo,src:null,thumbSrc:42})),without=createMobileLevels({db,photos:noSources,collection,configuration:config}).view(peer);
 assert.ok(without.chapters.every(ch=>ch.levels.every(level=>!Object.hasOwn(level,'src')&&!Object.hasOwn(level,'thumbSrc'))));
});

test('default chapter albums unlock breakfast sequentially and preserve destination contracts',t=>{
 const db=new DatabaseSync(':memory:');t.after(()=>db.close());const defaults=readLevelConfiguration(),albums=defaultAlbums(defaults),packs=new Map(albums.map(album=>[album.id,album]));
 assert.ok(albums.every(album=>album.imageIds.length===6));assert.equal(new Set(albums.flatMap(album=>album.imageIds)).size,24);
 const levels=createMobileLevels({db,photos,collection:{albumImages:id=>packs.get(id)??null}});
 assert.equal(levels.view(owner).chapters[1].levels[0].status,'locked');
 for(let n=1;n<=5;n++)levels.recordClear(owner,'ch1-'+n,'fixture',now,30);
 assert.equal(levels.view(owner).chapters[1].levels[0].status,'locked');levels.recordClear(owner,'ch1-6','fixture',now,30);
 const view=levels.view(owner);assert.equal(view.chapters[1].levels[0].status,'unlocked');assert.strictEqual(view.current,view.chapters[1].levels[0]);assert.equal(view.current.id,'ch2-1');
 assert.deepEqual(view.current.comic,defaults.chapters[1].story[0].comic);assert.equal(view.current.timeLabel,'清晨');assert.equal(view.current.intro,defaults.chapters[1].story[0].intro);
 assert.deepEqual(levels.destination('ch1-6'),{nextLevelId:'ch2-1',chapterComplete:true});assert.deepEqual(levels.destination('ch2-6'),{nextLevelId:'ch3-1',chapterComplete:true});assert.deepEqual(levels.destination('ch1-3'),{nextLevelId:'ch1-4',chapterComplete:false});
 assert.deepEqual(levels.destination('ch3-6'),{nextLevelId:'ch4-1',chapterComplete:true});assert.deepEqual(levels.destination('ch4-6'),{nextLevelId:null,chapterComplete:true});assert.deepEqual(levels.destination('ch4-5'),{nextLevelId:'ch4-6',chapterComplete:false});
 for(const [chapterIndex,nextLevelId]of [[1,'ch3-1'],[2,'ch4-1'],[3,null]]){
  for(let n=1;n<=6;n++){
   if(chapterIndex<3)assert.equal(levels.view(owner).chapters[chapterIndex+1].levels[0].status,'locked');
   levels.recordClear(owner,defaults.chapters[chapterIndex].id+'-'+n,'fixture',now,30);
  }
  const next=levels.view(owner);assert.equal(next.current?.id??null,nextLevelId);
  if(nextLevelId){assert.equal(next.chapters[chapterIndex+1].levels[0].status,'unlocked');assert.strictEqual(next.current,next.chapters[chapterIndex+1].levels[0]);}
  if(chapterIndex===1)assert.equal(next.current.timeLabel,'清晨');
 }
 assert.equal(levels.progress(owner).length,24);const complete=levels.view(owner);assert.equal(complete.current,null);assert.ok(complete.chapters.every(ch=>ch.levels.every(level=>level.status==='cleared')));
});

test('missing breakfast album leaves chapter one playable and returns no current after its completion',t=>{
 const f=fixture(t,{config:readLevelConfiguration(),albumContent:{read:()=>({albums:[{id:'shiguang-ch1',imageIds:catalog.packs[0].imageIds}]})}});
 const first=f.view();assert.equal(first.chapters[0].status,'available');assert.equal(first.current.id,'ch1-1');assert.equal(first.chapters[1].status,'unavailable');assert.ok(first.chapters[1].levels.every(level=>level.status==='unavailable'));
 for(let n=1;n<=6;n++)f.clear('ch1-'+n);const view=f.view();assert.equal(view.current,null);assert.equal(view.chapters[0].status,'available');assert.ok(view.chapters[0].levels.every(level=>level.status==='cleared'));
});

test('finishing chapter one persists and snapshots chapterComplete with breakfast as nextLevelId',t=>{
 const defaults=readLevelConfiguration(),f=fixture(t,{config:defaults,albumContent:{read:()=>({albums:defaultAlbums(defaults)})}}),rid=()=>randomBytes(16).toString('hex');
 const ok=(url,body,token)=>{const result=f.service.handle({identity:owner,url,method:body===undefined?'GET':'POST',body,authorization:token?'Bearer '+token:undefined});assert.ok([200,201].includes(result.status),JSON.stringify(result));return result.data;};
 ok('/api/mobile/profile');for(let n=1;n<=5;n++)f.clear('ch1-'+n);
 const ticket=ok('/api/rooms',{mode:'level',levelId:'ch1-6',requestId:rid()}),room=JSON.parse(f.db.prepare('SELECT data FROM mobile_rooms WHERE id=?').get(ticket.room.id).data);
 for(const group of room.puzzle.groups.slice(1)){group.locked=true;group.dx=0;group.dy=0;}
 f.db.prepare('UPDATE mobile_rooms SET data=? WHERE id=?').run(JSON.stringify(room),room.id);
 const groupId=room.puzzle.groups.find(group=>!group.locked).id,path='/api/rooms/'+room.id;ok(path,{type:'claim',groupId},ticket.token);
 const result=ok(path,{type:'drop',groupId,seq:1,dx:0,dy:0,requestId:rid()},ticket.token),expected={levelId:'ch1-6',energy:30,firstClear:true,nextLevelId:'ch2-1',chapterComplete:true};
 assert.ok(result.completedAt);assert.deepEqual(result.profile.lastReward.levelClear,expected);assert.deepEqual(result.mobileResult.levelClear,expected);
 assert.deepEqual(JSON.parse(f.db.prepare('SELECT data FROM mobile_profiles WHERE id=?').get(owner).data).lastReward.levelClear,expected);
 assert.deepEqual(ok(path,undefined,ticket.token).mobileResult.levelClear,expected);assert.equal(f.view().current.id,'ch2-1');
});

for(const [chapterIndex,nextLevelId]of [[1,'ch3-1'],[3,null]])test('finishing ch'+(chapterIndex+1)+'-6 persists and snapshots chapterComplete with nextLevelId '+nextLevelId,t=>{
 const defaults=readLevelConfiguration(),f=fixture(t,{config:defaults,albumContent:{read:()=>({albums:defaultAlbums(defaults)})}}),rid=()=>randomBytes(16).toString('hex'),levelId=defaults.chapters[chapterIndex].id+'-6';
 const ok=(url,body,token)=>{const result=f.service.handle({identity:owner,url,method:body===undefined?'GET':'POST',body,authorization:token?'Bearer '+token:undefined});assert.ok([200,201].includes(result.status),JSON.stringify(result));return result.data;};
 ok('/api/mobile/profile');
 for(let index=0;index<=chapterIndex;index++)for(let n=1;n<=(index===chapterIndex?5:6);n++)f.clear(defaults.chapters[index].id+'-'+n);
 const ticket=ok('/api/rooms',{mode:'level',levelId,requestId:rid()}),room=JSON.parse(f.db.prepare('SELECT data FROM mobile_rooms WHERE id=?').get(ticket.room.id).data);
 for(const group of room.puzzle.groups.slice(1)){group.locked=true;group.dx=0;group.dy=0;}
 f.db.prepare('UPDATE mobile_rooms SET data=? WHERE id=?').run(JSON.stringify(room),room.id);
 const groupId=room.puzzle.groups.find(group=>!group.locked).id,path='/api/rooms/'+room.id;ok(path,{type:'claim',groupId},ticket.token);
 const result=ok(path,{type:'drop',groupId,seq:1,dx:0,dy:0,requestId:rid()},ticket.token),expected={levelId,energy:30,firstClear:true,nextLevelId,chapterComplete:true};
 assert.ok(result.completedAt);assert.deepEqual(result.profile.lastReward.levelClear,expected);assert.deepEqual(result.mobileResult.levelClear,expected);
 assert.deepEqual(JSON.parse(f.db.prepare('SELECT data FROM mobile_profiles WHERE id=?').get(owner).data).lastReward.levelClear,expected);
 assert.deepEqual(ok(path,undefined,ticket.token).mobileResult.levelClear,expected);assert.equal(f.view().current?.id??null,nextLevelId);
});

test('chapters carry their album coin milestones, hidden chapter albums included, with earned flags',t=>{
 const milestones=[{id:'milestone-3',target:3,coins:30,decorationId:null},{id:'milestone-6',target:6,coins:60,decorationId:null}];
 const f=fixture(t,{config:readLevelConfiguration(),albumContent:{read:()=>({albums:[{id:'shiguang-ch1',imageIds:catalog.packs[0].imageIds,showOnMobile:false,milestones}]})}});
 assert.deepEqual(f.view().chapters[0].milestones,[{target:3,coins:30,earned:false},{target:6,coins:60,earned:false}]);
 f.db.prepare('INSERT INTO mobile_collection_milestone_rewards VALUES(?,?,?,?,?)').run(owner,'shiguang-ch1','milestone-3','{}',now);
 assert.deepEqual(f.view().chapters[0].milestones.map(m=>m.earned),[true,false]);
 assert.deepEqual(f.view().chapters[1].milestones,[]);
});
