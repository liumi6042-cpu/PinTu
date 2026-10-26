import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {CheerEffects} from '../mobile/cheer-effects.ts';

const bundled=await build({stdin:{contents:"export {GameApp} from './mobile/app.ts'",resolveDir:process.cwd(),loader:'ts'},bundle:true,write:false,format:'esm',platform:'node',logLevel:'silent'});
const {GameApp}=await import('data:text/javascript;base64,'+Buffer.from(bundled.outputFiles[0].text).toString('base64'));
const clear={levelId:'ch1-1',energy:30,firstClear:true,nextLevelId:'ch1-2',chapterComplete:false};
function fixture({width=844,height=390,levelClear=clear,energy=true,formalWeb=false}={}){
 const calls=[],events=[],created=[],measure=(value,size)=>Array.from(String(value)).reduce((sum,char)=>sum+(char.charCodeAt(0)>255?size:size*.6),0);
 const ctx=new Proxy({globalAlpha:1},{get:(target,key)=>key in target?target[key]:()=>{}});
 const stage={ctx,w:width,h:height,palette:{ink:'#222',muted:'#666',berry:'#a35',gold:'#fc5',cream:'#fff',overlay:'#0008',onAccent:'#fff'},invalidate(){},input(){},frame(r,key){calls.push({kind:'frame',r:{...r},key});},panel(r){this.frame(r,'panel-cream');},text(value,x,y,size,color,weight,maxWidth){calls.push({kind:'text',label:String(value),r:{x,y,w:measure(value,size),h:size},maxWidth});},measure,icon(key,r){calls.push({kind:'icon',key,r});},ornaments(){},button(r,label,fn){calls.push({kind:'button',r:{...r},label,fn});},hit(r,fn){calls.push({kind:'hit',r:{...r},fn});},clip(_r,fn){fn();}};
 const app=Object.create(GameApp.prototype),snapshot={title:'窗边',puzzle:{imageId:'picture'},startedAt:1,completedAt:60001,members:Array.from({length:8},(_,index)=>({id:String(index),code:String(index),name:'同桌'+index,lastSeen:100,contribution:8-index})),mobileResult:{coins:20,fragments:2,energy:5,catalog:{newlyCollected:true,albumRewards:[{title:'相册阶段奖励',coins:100},{title:'集齐相册',coins:0}]},...(levelClear?{levelClear}:{})}};
 const client={profile:{code:'0',lastReward:{levelClear:clear}},cookieIdentity:formalWeb,config:{capabilities:{energy}},createRoom:async input=>{events.push('create');created.push(input);return {room:{id:'next-room'}};}};
 Object.assign(app,{stage,client,platform:{config:{id:width>=1000?'web':'taptap'},viewport:()=>({width,height,top:0,bottom:0}),randomId:()=> 'request'},room:{ticket:{playerId:'0'},state:{cols:4,rows:3},snapshot},board:{drawCompletedPicture:()=>true},ready:true,busy:false,modal:'completion',modalScroll:0,modalExtent:0,completionSeatRects:new Map(),cheerEffects:new CheerEffects(),cheerFrame:null,collection:{albums:[{id:'album',collected:6,total:6,images:[{id:'picture'}]}]},attempts:new Map(),cancelChatPress(){},clearRoomPointer(){},invalidate(){},social:{title:''},leaveRoom(){events.push('leave');this.room=null;},navigate(route){events.push(route);},attachTicket:async ticket=>{events.push('attach');app.room=ticket;}});
 return {app,calls,events,created,draw:()=>app.drawModal(),button:label=>calls.find(call=>call.kind==='button'&&call.label===label),texts:()=>calls.filter(call=>call.kind==='text').map(call=>call.label)};
}

test('level primary action leaves then creates the configured next level in all layouts',async()=>{
 for(const [width,height]of [[390,844],[844,390],[1280,800]]){
  const f=fixture({width,height,levelClear:{...clear,nextLevelId:'ch1-4'}});f.draw();assert.equal(f.button('再来一桌'),undefined);assert.ok(f.button('下一关'));
  f.button('下一关').fn();await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(f.events,['leave','create','attach']);assert.deepEqual(f.created,[{mode:'level',levelId:'ch1-4',requestId:'request'}]);
 }
});

test('chapter complete or missing next level shows the chapter message and returns to the lobby',()=>{
 for(const levelClear of [{...clear,levelId:'ch1-6',chapterComplete:true,nextLevelId:null},{...clear,levelId:'ch1-6',chapterComplete:true,nextLevelId:'ch2-1'},{...clear,nextLevelId:null}]){
  const f=fixture({levelClear});f.draw();assert.ok(f.texts().includes('新手章节完成！'));assert.equal(f.button('下一关'),undefined);
  f.button('去大厅').fn();assert.deepEqual(f.events,['leave','lobby']);assert.deepEqual(f.created,[]);
 }
});

test('first clear shows the lightning reward only with positive energy and an enabled energy system',()=>{
 for(const [width,height]of [[390,844],[844,390],[1280,800]])for(const [levelClear,energy,formalWeb,visible]of [[clear,true,false,true],[{...clear,firstClear:false,energy:0},true,false,false],[{...clear,firstClear:false},true,false,false],[{...clear,energy:0},true,false,false],[clear,false,false,false],[clear,true,true,false]]){
  const f=fixture({width,height,levelClear,energy,formalWeb});f.draw();const reward=f.calls.find(call=>call.label==='通关体力 +30');assert.equal(!!reward,visible);
  if(reward){assert.ok(reward.r.w<=reward.maxWidth+.01,'reward label fits its tile');const tile=f.calls.find(call=>call.kind==='frame'&&call.key==='button-linen-normal'&&call.r.x<=reward.r.x&&call.r.x+call.r.w>=reward.r.x+reward.r.w&&call.r.y<reward.r.y&&call.r.y+call.r.h>=reward.r.y+reward.r.h);assert.ok(tile);assert.ok(f.calls.some(call=>call.kind==='icon'&&call.key==='lightning'&&call.r.x>tile.r.x&&call.r.x<tile.r.x+tile.r.w));}
 }
});

test('level rewards fit all layouts with eight seats, album milestones, six cheers and the existing secondary actions',()=>{
 for(const [width,height]of [[390,844],[844,390],[1280,800]])for(const levelClear of [clear,{...clear,levelId:'ch1-6',chapterComplete:true,nextLevelId:null}]){
  const f=fixture({width,height,levelClear});f.draw();assert.equal(f.app.completionSeatRects.size,8);
  const cheers=f.calls.filter(call=>call.kind==='hit'&&call.r.y===f.app.completionBar.y&&call.r.h===f.app.completionBar.h);assert.equal(cheers.length,6);
  for(const label of ['分享成品','查看图集','回大厅'])assert.ok(f.button(label));
  for(const call of f.calls.filter(call=>call.kind==='button'||call.kind==='frame')){assert.ok(call.r.w>0&&call.r.h>0);assert.ok(call.r.x>=0&&call.r.x+call.r.w<=width+.01);}
  if(width===844){for(const label of ['下一关','去大厅','分享成品','查看图集','回大厅']){const button=f.button(label);if(button)assert.ok(button.r.y+button.r.h<=f.app.completionBar.y,label);}assert.ok(f.app.completionBar.y+f.app.completionBar.h+22<=382);}
  if(width===390)assert.ok(f.app.modalExtent>f.app.modalArea.h,'portrait content remains scrollable');
 }
});

test('ordinary rooms and helpers retain the cheers completion even with a stale profile level reward',()=>{
 for(const [width,height]of [[390,844],[844,390],[1280,800]]){
  const f=fixture({width,height,levelClear:null});f.draw();assert.ok(f.button('再来一桌'));assert.equal(f.button('下一关'),undefined);assert.equal(f.button('去大厅'),undefined);assert.ok(!f.texts().some(text=>text.includes('通关体力')||text==='新手章节完成！'));
  assert.equal(f.app.completionSeatRects.size,8);assert.equal(f.calls.filter(call=>call.kind==='hit'&&call.r.y===f.app.completionBar.y&&call.r.h===f.app.completionBar.h).length,6);
  f.button('再来一桌').fn();assert.deepEqual(f.events,['leave','gallery']);
 }
});
