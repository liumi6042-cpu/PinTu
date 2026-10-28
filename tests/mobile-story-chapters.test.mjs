import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fixture,levels,tick,artwork} from './mobile-level-card-fixture.mjs';
import {build} from 'esbuild';
const bundle=await build({stdin:{contents:'export {timeLabelFor} from "./mobile/story-timeline";export {comicFor} from "./mobile/story-comic";export {OfflineMode} from "./mobile/offline-mode";',resolveDir:process.cwd(),loader:'ts'},bundle:true,write:false,format:'esm',platform:'node',logLevel:'silent'});
const {timeLabelFor,comicFor,OfflineMode}=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
import {offlineLevelsView} from '../lib/offline-play.ts';
import {buildOfflineCatalog,offlineRoomArtwork} from '../scripts/offline-catalog.mjs';

const story=JSON.parse(readFileSync(new URL('../mobile/story-comics-ch2.json',import.meta.url),'utf8'));
const overlap=(a,b)=>a.x<b.x+b.w&&b.x<a.x+a.w&&a.y<b.y+b.h&&b.y<a.y+a.h;
const inside=(a,b)=>a.x>=b.x&&a.y>=b.y&&a.x+a.w<=b.x+b.w&&a.y+a.h<=b.y+b.h;
function chapters(first=6,second=0,status='available'){
 const view=levels(first);view.chapters[0].title='奶奶的小店';view.chapters[0].albumId='shiguang-ch1';
 const ch2={...levels(second,status).chapters[0],id:'ch2',albumId:'shiguang-ch2',title:'早餐街'};
 ch2.levels=ch2.levels.map((level,index)=>({...level,id:'ch2-'+(index+1),pieces:[16,20,24,24,28,30][index],imageId:'future-ch2-'+index,src:'/future-'+index+'.webp',thumbSrc:'/future-'+index+'-thumb.webp',status:status!=='available'?'unavailable':first<6?'locked':level.status}));
 view.chapters.push(ch2);view.current=view.chapters.flatMap(chapter=>chapter.levels).find(level=>level.status==='unlocked')??null;return view;
}
function offline(f,view){f.app.ready=false;f.app.offline={active:true,view,isRoom:()=>false};}
function completion(f,clear){
 f.client.config.capabilities.cheers=false;
 f.app.room={ticket:{playerId:'self'},state:{cols:5,rows:7},snapshot:{id:'completed-room',title:'最后一格',levelId:clear.levelId,members:[],completedAt:1,mobileResult:{coins:1,fragments:1,levelClear:clear}},leave(){}};
 f.app.drawCompletionPicture=()=>{};
}
function drawComic(f){f.clear();f.app.drawLevelComic();}

for(const mode of ['online','offline'])test(`${mode}: selection follows current, all-cleared, availability and invalid selection`,()=>{
 for(const [data,want]of [[chapters(3),'ch1'],[chapters(6,0),'ch2'],[chapters(6,6),'ch2'],[chapters(6,0,'unavailable'),'ch1']]){
  const f=fixture({data});if(mode==='offline')offline(f,data);
  f.app.storyChapterId='missing';assert.equal(f.app.selectedChapter.id,want);
  assert.equal(f.app.availableChapters.length,data.chapters[1].status==='available'?2:1);
  f.app.drawChapter();if(data.chapters[1].status==='unavailable')assert.ok(!f.buttons.some(button=>['‹','›'].includes(button.label)));
 }
 const data=chapters(3);data.current=null;const f=fixture({data});if(mode==='offline')offline(f,data);assert.equal(f.app.selectedChapter.id,'ch1');
});

test('selection is in memory, resets on account change, and ch1 entry rules ignore selected ch2',async()=>{
 const f=fixture({data:chapters(0)});f.app.listOwner='owner-a';f.app.storyChapterId='ch2';assert.equal(f.app.storyChapter.id,'ch1');assert.equal(f.app.beginnerChapter.id,'ch1');
 f.app.ready=false;f.client.account={id:'other'};f.app.ensureListOwner();assert.equal(f.app.storyChapterId,null);assert.equal(f.app.selectedChapter,null);
 const fresh=fixture({data:chapters(0),newcomer:true});fresh.app.storyChapterId='ch2';await fresh.app.autoLaunchLevel();assert.equal(fresh.created[0].levelId,'ch1-1');
});

for(const [width,height]of [[320,640],[390,844],[640,360],[844,390],[1280,800]])test(`${width}x${height}: chapter switches fit beside subtitle, consume disabled taps, reset scroll and preview locked ch2`,()=>{
 const f=fixture({width,height,data:chapters(3)}),glyphs=[],meters=[];
 f.stage.measure=(value,size=14)=>[...String(value)].reduce((n,ch)=>n+size*(/[^\x00-\x7f]/.test(ch)?1:.6),0);
 f.stage.text=(value,x,y,size=14,color,weight,max)=>{let text=String(value);while(max&&f.stage.measure(text,size)>max&&text.length>1)text=text.slice(0,-1);glyphs.push({value:String(value),r:{x,y,w:f.stage.measure(text,size),h:size}});};
 f.stage.meter=r=>meters.push(r);
 const result=f.app.drawChapter(),arrows=f.buttons.filter(button=>['‹','›'].includes(button.label));assert.equal(arrows.length,2);
 const title=glyphs.find(item=>item.value==='小窝的故事'),subtitle=glyphs.find(item=>item.value.startsWith('第 1 章')),progress=glyphs.find(item=>item.value==='3 / 6 格'),cards=f.strokes.map(item=>item.r);
 for(const {r}of arrows){assert.ok(r.w>=32&&r.h>=32);assert.ok(inside(r,{x:0,y:0,w:width,h:height}));if(result)assert.ok(inside(r,result.chapterSwitch));for(const other of [title.r,subtitle.r,progress.r,...meters,...cards])assert.ok(!overlap(r,other));assert.ok(f.hits.some(hit=>hit.r===r));}
 assert.ok(arrows[0].opts.disabled);const selected=f.app.storyChapterId;arrows[0].fn();assert.equal(f.app.storyChapterId,selected);
 f.app.scroll=200;arrows[1].fn();assert.equal(f.app.scroll,0);assert.equal(f.app.selectedChapter.id,'ch2');assert.ok(f.app.selectedChapter.levels.every(level=>level.status==='locked'));
 f.clear();glyphs.length=0;f.app.drawChapter();assert.ok(glyphs.some(item=>item.value==='第 2 章 · 早餐街'));assert.equal(f.icons.filter(item=>item.key==='lock').length,6);assert.equal(f.images.length,0);
 const back=f.buttons.find(button=>button.label==='‹'),end=f.buttons.find(button=>button.label==='›');assert.ok(end.opts.disabled);end.fn();assert.equal(f.app.selectedChapter.id,'ch2');back.fn();assert.equal(f.app.selectedChapter.id,'ch1');
 f.clear();glyphs.length=0;f.app.drawChapter();assert.ok(glyphs.some(item=>item.value==='第 1 章 · 奶奶的小店'));
});

test('bundled ch2 metadata uses ID then album, and server fields each override independently',()=>{
 for(let index=0;index<6;index++){
  for(const chapter of [{id:'ch2',albumId:'other'},{id:'renamed',albumId:'shiguang-ch2'}]){
   assert.equal(timeLabelFor(chapter,index,{}),story.levels[index].timeLabel);assert.deepEqual(comicFor(chapter,index,{}),{intro:story.levels[index].intro,panels:story.levels[index].comic.panels});
   const panels=structuredClone(story.levels[index].comic.panels);panels[0].texts[0].text='服务器';
   assert.equal(timeLabelFor(chapter,index,{timeLabel:'服务器时间'}),'服务器时间');assert.equal(comicFor(chapter,index,{intro:'服务器开场'}).intro,'服务器开场');
   assert.deepEqual(comicFor(chapter,index,{comic:{panels}}),{intro:story.levels[index].intro,panels});assert.deepEqual(comicFor(chapter,index,{comic:{panels:[]},intro:'服务器开场'}).panels,story.levels[index].comic.panels);
  }
 }
 assert.equal(timeLabelFor({id:'constructor',albumId:'unknown'},0,{}),null);assert.equal(comicFor({id:'constructor',albumId:'unknown'},0,{}),null);
 const ch1=JSON.parse(readFileSync(new URL('../mobile/story-comics-ch1.json',import.meta.url),'utf8'));assert.equal(timeLabelFor({id:'ch1',albumId:'shiguang-ch2'},0,{}),ch1.levels[0].timeLabel);
});

test('unbundled level artwork renders on cards, comic pages and completed picture, including thumb-only fallback',()=>{
 const f=fixture({data:chapters(6,6)});f.app.drawChapter();assert.equal(f.images.length,6);assert.ok(f.images.every(image=>image.src.startsWith('/future-')));
 f.app.openLevelComic('ch2-1');assert.equal(f.app.comicPage.chapterId,'ch2');drawComic(f);assert.equal(f.images.length,4);assert.ok(f.images.every(image=>image.src==='/future-0.webp'));
 f.app.levels.chapters[1].levels[0].src=null;drawComic(f);assert.ok(f.images.every(image=>image.src==='/future-0-thumb.webp'));
 f.app.room={snapshot:{levelId:'ch2-1'}};f.clear();f.app.drawCompletionPicture({x:0,y:0,w:200,h:150});assert.equal(f.images[0].src,'/future-0-thumb.webp');
});

test('local photoMap artwork retains precedence over optional server level URLs',async()=>{
 const f=fixture({data:chapters(6,6)});await artwork(f);const level=f.app.levels.chapters[0].levels[0];level.src='/override';level.thumbSrc='/override-thumb';f.app.storyChapterId='ch1';f.app.drawChapter();assert.equal(f.images[0].src,'/chapter-0.webp');
});

for(const [clear,label]of [[{nextLevelId:'ch2-1',chapterComplete:true},'下一章'],[{nextLevelId:null,chapterComplete:true},'去大厅'],[{nextLevelId:null},'去大厅'],[{nextLevelId:'ch1-4'},'下一关']])test(`completion ${JSON.stringify(clear)} offers ${label} and executes it`,async()=>{
 const f=fixture({data:chapters(6)});completion(f,{...clear,levelId:'ch1-6'});let leaves=0;f.app.leaveRoom=()=>{leaves++;f.app.room=null;};f.app.drawCompletionContent(12,40,366);
 if(label!=='下一关')assert.ok(f.texts.includes('奶奶的小店完成！'));
 f.buttons.find(button=>button.label===label).fn();await tick();assert.equal(leaves,1);if(clear.nextLevelId)assert.equal(f.created[0].levelId,clear.nextLevelId);else assert.equal(f.app.route,'lobby');
});

test('missing chapter title uses 本章完成 and completion close selects the next chapter; final and old receipts go to lobby',()=>{
 const f=fixture({data:chapters(6)});f.app.levels.chapters[0].title='';completion(f,{levelId:'ch1-6',chapterComplete:true,nextLevelId:'ch2-1'});f.app.drawCompletionContent(12,40,366);assert.ok(f.texts.includes('本章完成！'));
 f.app.leaveRoom=()=>{f.app.room=null;};f.app.route='room';f.app.exitRoom();assert.equal(f.app.route,'chapter');assert.equal(f.app.selectedChapter.id,'ch2');
 for(const clear of [{levelId:'ch2-6',chapterComplete:true,nextLevelId:null},{levelId:'ch1-6',nextLevelId:null}]){completion(f,clear);f.app.route='room';f.app.exitRoom();assert.equal(f.app.route,'lobby');}
 f.app.storyChapterId='ch1';completion(f,{levelId:'ch2-2',nextLevelId:'ch2-3'});f.app.route='room';f.app.exitRoom();assert.equal(f.app.route,'chapter','a mid-chapter ch2 clear returns to the story page');assert.equal(f.app.selectedChapter.id,'ch2');
});

test('ch2 comic keeps its chapter through turns/ending, intro and selected-chapter replay',()=>{
 const f=fixture({data:chapters(6,6)});f.app.beginStoryIntro('ch2-1');assert.equal(f.app.storyIntro.text,story.levels[0].intro);
 f.app.openLevelComic('ch2-3');assert.equal(f.app.comicChapter.id,'ch2');f.app.turnComic(6);assert.equal(f.app.comicPage.chapterId,'ch2');drawComic(f);assert.ok(f.texts.includes('第 2 章 完'));
 f.app.closeModal();f.app.storyChapterId='ch2';f.clear();f.app.drawChapter();f.buttons.find(button=>button.label==='从头看').fn();assert.equal(f.app.comicPage.levelId,'ch2-1');assert.equal(f.app.comicPage.chapterId,'ch2');
});

test('receipt unlocks across chapters and comic ending launches next chapter after leaving its room',async()=>{
 const f=fixture({data:chapters(5)});completion(f,{levelId:'ch1-6',chapterComplete:true,nextLevelId:'ch2-1'});f.app.syncComicClear(f.app.levels.chapters[0]);assert.equal(f.app.levels.chapters[0].levels[5].status,'cleared');assert.equal(f.app.levels.chapters[1].levels[0].status,'unlocked');
 f.app.openLevelComic('ch1-6');f.app.turnComic(6);drawComic(f);assert.equal(f.app.comicPage.chapterId,'ch1');assert.ok(f.texts.includes('本章完'));assert.ok(f.texts.includes('轻点这里去第 2 章'));assert.equal(f.buttons.length,0);let left=0;f.app.leaveRoom=()=>{left++;f.app.room=null;};f.hits.find(hit=>hit.r===f.app.modalArea).fn();await tick();assert.equal(f.app.modal,null);assert.equal(left,1);assert.equal(f.created[0].levelId,'ch2-1');
 const blocked=fixture({data:chapters(6)});blocked.app.levels.chapters[1].levels[0].status='locked';blocked.app.openLevelComic('ch1-6');blocked.app.turnComic(6);drawComic(blocked);assert.equal(blocked.buttons.length,0);assert.equal(blocked.hits.length,0);
});

test('story nav badge considers unlocked levels in any available chapter',()=>{
 const f=fixture({data:chapters(6)});f.app.navBadge('chapter',20,20);assert.equal(f.fills.filter(item=>item.color==='#b46177').length,1);
 f.clear();f.app.levels.chapters[1].status='unavailable';f.app.navBadge('chapter',20,20);assert.equal(f.fills.length,0);
});

function catalogFixture(){
 // Supported fixture counts keep this client test independent of C02's new grid counts.
 const view=chapters(0);view.chapters[1].levels.forEach((level,index)=>level.pieces=[16,20,24,24,28,30][index]);const photos=view.chapters.flatMap(chapter=>chapter.levels.map((level,index)=>({id:chapter.id+'-photo-'+index,title:level.id,category:'测试',status:'published',origin:'project-ai-generated',width:1536,height:1024,src:'/puzzles/'+chapter.id+'-'+index+'.webp',thumbSrc:'/puzzles/'+chapter.id+'-'+index+'-thumb.webp'})));
 const albums=view.chapters.map(chapter=>({id:chapter.albumId,title:chapter.title,showOnMobile:false,imageIds:photos.filter(photo=>photo.id.startsWith(chapter.id+'-')).map(photo=>photo.id)}));
 const levels={schema:'jigsaw-levels/v1',seriesTitle:'故事',firstClearEnergy:30,chapters:view.chapters.map(chapter=>({id:chapter.id,title:chapter.title,albumId:chapter.albumId,pieces:chapter.levels.map(level=>level.pieces)}))},mapping={};
 for(const photo of photos)for(const count of new Set(view.chapters.flatMap(chapter=>chapter.levels.map(level=>level.pieces))))for(const url of Object.values(offlineRoomArtwork(photo,count)).filter(value=>typeof value==='string'&&value.startsWith('/')))mapping[url]='bundled';
 // Keep the server view fake: C02 owns the real levels implementation/configuration.
 const fakeLevels=()=>({view:()=>({...view,chapters:view.chapters.map((chapter,ci)=>({...chapter,levels:chapter.levels.map((level,index)=>({...level,title:level.id,imageId:albums[ci].imageIds[index]}))}))})});
 return buildOfflineCatalog({levels,albums,photos,plan:{mapping}},fakeLevels);
}

test('offline catalog carries six ch2 levels, uses the same default selection and renders just one switchable chapter',()=>{
 const catalog=catalogFixture(),storage={get:()=>null,set(){}},initial=offlineLevelsView(catalog,null,storage);assert.equal(initial.chapters[1].levels.length,6);assert.equal(initial.chapters[1].levels[0].status,'locked');
 for(const [cached,expected]of [[null,'ch1'],[chapters(6),'ch2'],[chapters(6,6),'ch2']]){
  const view=offlineLevelsView(catalog,cached,storage),f=fixture();offline(f,view);assert.equal(f.app.selectedChapter.id,expected);
 }
 const f=fixture({width:844,height:390});let serial=0;f.platform.randomId=()=>(++serial).toString(16).padStart(32,'0');f.platform.config.offlineCatalog=catalog;const mode=new OfflineMode(f.platform);mode.active=true;f.app.offline=mode;f.app.ready=false;
 const drawn=[];f.stage.withViewport=(_r,draw)=>draw();
 const actions={paragraph:(_text,_x,y)=>y+20,selectedChapter:view=>f.app.selectChapter(view),chapter:(chapter,view,height)=>{drawn.push(chapter.id);const top=f.app.bodyTop,bottom=f.app.bodyBottom;f.app.bodyTop=0;f.app.bodyBottom=height;f.app.drawChapter(chapter,view);f.app.bodyTop=top;f.app.bodyBottom=bottom;},asset:src=>src,reconnect(){},launch(){},invalidate(){}};
 mode.drawPage(f.stage,0,actions);assert.deepEqual(drawn,['ch1']);f.buttons.find(button=>button.label==='›').fn();drawn.length=0;f.clear();mode.drawPage(f.stage,0,actions);assert.deepEqual(drawn,['ch2']);assert.ok(f.texts.includes('第 2 章 · 早餐街'));
 f.app.openLevelComic('ch1-1');assert.equal(f.app.modal,null); // offline locked pages remain private
});

test('offline comic/intro use the matching chapter and offline completion distinguishes next level from next chapter',()=>{
 const f=fixture(),view=chapters(6,6);offline(f,view);f.app.beginStoryIntro('ch2-1');assert.equal(f.app.storyIntro.text,story.levels[0].intro);f.app.openLevelComic('ch2-1');assert.equal(f.app.comicPage.chapterId,'ch2');f.app.turnComic(6);drawComic(f);assert.ok(f.texts.includes('第 2 章 完'));
 const mode=Object.create(OfflineMode.prototype);Object.defineProperty(mode,'view',{get:()=>view});
 for(const [levelId,label]of [['ch1-5','下一关'],['ch1-6','下一章'],['ch2-6',null]]){
  f.clear();let launched;mode.drawCompletion(f.stage,{room:{levelId}},12,20,366,false,undefined,{picture(){},paragraph:(_text,_x,y)=>y+20,launch:input=>{launched=input;},back(){}});
  if(label){const button=f.buttons.find(button=>button.label===label);assert.ok(button);button.fn();assert.equal(launched.levelId,levelId==='ch1-6'?'ch2-1':'ch1-6');}else assert.ok(!f.buttons.some(button=>['下一章','下一关'].includes(button.label)));
 }
});
