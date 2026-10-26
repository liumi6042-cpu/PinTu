import test from 'node:test';
import assert from 'node:assert/strict';
import {completionSeats} from '../mobile/completion-seats.ts';
import {CheerEffects} from '../mobile/cheer-effects.ts';
import {ICON,PAL,drawCheerIcon} from '../mobile/cheer-icons.ts';
import {build} from 'esbuild';

const member=(id,contribution=0,present=true)=>({id,code:id,name:id,contribution,lastSeen:present?100:0});
const cheer=(playerId='a',emote='clap')=>({seq:1,id:'a'.repeat(32),playerId,name:playerId,emote,at:0});
const clock=()=>{let now=0;return {effects:new CheerEffects(()=>now),at:value=>{now=value;}};};

test('seats: me first, then join order; ranking counts, columns/rows and departed members',()=>{
 const seats=completionSeats([member('a',9),member('b',3,false),member('c',1),member('d')],[{code:'b',name:'b',contribution:12}], 'c');
 assert.deepEqual(seats.map(s=>s.playerId),['c','a','b','d']);
 assert.deepEqual(seats.map(s=>[s.column,s.row]),[['left',0],['right',0],['left',1],['right',1]]);
 assert.equal(seats[2].present,false);assert.equal(seats[2].contribution,12);assert.equal(seats[2].crown,true);assert.equal(seats[0].me,true);
 assert.equal(completionSeats([member('a'),member('b')],null,'unknown','b')[0].playerId,'b');
});
test('seats: cap chooses present before departed, then contribution, preserving join order',()=>{
 const members=Array.from({length:11},(_,i)=>member(String(i),i,i<9));
 const seats=completionSeats(members,[], '4');
 assert.equal(seats.length,8);assert.ok(seats.every(s=>s.present));
 assert.deepEqual(seats.map(s=>s.playerId),['4','1','2','3','5','6','7','8']);
 assert.equal(seats.at(-1).row,3);
});
test('seats: unique positive leader only; no crown for ties, zeroes, or solo seats',()=>{
 for(const values of [[0,0],[4,4]])assert.equal(completionSeats(values.map((v,i)=>member(String(i),v)),null,'0').filter(s=>s.crown).length,0);
 assert.equal(completionSeats([member('a',1),member('b',2)],null,'a')[1].crown,true);
 assert.deepEqual(completionSeats([member('a',9)],null,'a'),[]);assert.deepEqual(completionSeats([],null,'a'),[]);
 assert.deepEqual(completionSeats([{id:'a',name:'a',lastSeen:100}],[{name:'a',contribution:9,mine:true}],'a'),[]);
});
test('ranking-only departed players stay listed when the server removes them from members',()=>{
 const seats=completionSeats([member('a',3)],[{name:'a',code:'a',contribution:3},{name:'b',code:'b',contribution:5}], 'a');
 assert.equal(seats.length,2);assert.equal(seats[1].code,'b');assert.equal(seats[1].present,false);assert.equal(seats[1].crown,true);
});
test('bubbles merge within 2.5s, refresh life, pop in, fade, then expire',()=>{
 const {effects:fx,at}=clock();fx.receive(cheer(),true);const first=fx.bubbles[0];
 assert.equal(fx.bubbleScale(first),0);assert.equal(fx.pressed('clap'),true);
 at(120);assert.equal(fx.bubbleScale(first),1);assert.ok(fx.hop('a')<0);
 at(150);assert.equal(fx.pressed('clap'),false);
 at(2500);fx.receive(cheer(),true);assert.equal(fx.bubbles.length,1);assert.equal(first.count,2);assert.equal(fx.count('clap'),2);
 at(4900);assert.equal(fx.bubbleAlpha(first),1);
 at(5050);assert.equal(fx.bubbleAlpha(first),.5);
 at(5200);assert.equal(fx.alive(),false);
});
test('same player/emote after merge window creates a new bubble',()=>{
 const {effects:fx,at}=clock();fx.receive(cheer());at(2501);fx.receive(cheer());
 assert.equal(fx.bubbles.length,2);assert.deepEqual(fx.bubbles.map(b=>b.count),[1,1]);
 at(2700);fx.update();assert.equal(fx.bubbles.length,1);at(5201);assert.equal(fx.alive(),false);
});
test('combo requires three distinct players in 3s; storm stays bounded and expires',()=>{
 const {effects:fx,at}=clock();fx.receive(cheer('a'));at(1000);fx.receive(cheer('a'));fx.receive(cheer('b'));assert.equal(fx.combo,null);
 at(3000);fx.receive(cheer('c'));assert.equal(fx.combo.count,3);assert.equal(fx.particles.length,60);
 at(3100);fx.receive(cheer('d'));assert.equal(fx.combo.count,4);
 for(let i=0;i<300;i++)fx.receive(cheer(String(i),'popper'));
 assert.ok(fx.particles.length<=180);assert.ok(fx.bubbles.length<=60);
 at(10000);assert.equal(fx.alive(),false);assert.equal(fx.hops.size,0);
 const outside=clock();outside.effects.receive(cheer('a'));outside.at(3001);outside.effects.receive(cheer('b'));outside.effects.receive(cheer('c'));assert.equal(outside.effects.combo,null);
});
test('tea needs different players within 2s; heart/star and clear have bounded lifetimes',()=>{
 const {effects:fx,at}=clock();fx.receive(cheer('a','tea'));at(900);fx.receive(cheer('a','tea'));assert.equal(fx.tea,null);
 at(2900);fx.receive(cheer('b','tea'));assert.deepEqual(fx.tea.players,['a','b']);at(3900);fx.update();assert.equal(fx.tea,null);
 fx.clear();at(0);fx.receive(cheer('a','tea'));at(2001);fx.receive(cheer('b','tea'));assert.equal(fx.tea,null);
 fx.clear();fx.receive(cheer('a','heart'));assert.equal(fx.particles.length,3);fx.receive(cheer('a','star'));assert.equal(fx.starsUntil,3201);
 at(6000);assert.equal(fx.alive(),false);fx.receive(cheer());fx.clear();assert.equal(fx.alive(),false);
});
test('icons are 16x16 and palette-valid; renderer uses integer pixel rectangles',()=>{
 for(const [id,grid] of Object.entries(ICON)){
  assert.equal(grid.length,16,id);for(const row of grid){assert.equal(row.length,16,id);for(const ch of row)assert.ok(ch==='.'||ch in PAL,`${id}: ${ch}`);}
 }
 const rects=[],ctx={save(){},restore(){},fillRect(...args){rects.push(args);}};
 drawCheerIcon(ctx,'heart',{x:1.3,y:2.4,w:38,h:35});assert.equal(ctx.imageSmoothingEnabled,false);
 assert.ok(rects.length>0);assert.ok(rects.every(r=>r.every(Number.isInteger)&&r[2]===2&&r[3]===2));
});

// Bundle the real app for Node without changing the project's JSON import contracts.
const bundled=await build({stdin:{contents:"export {GameApp} from './mobile/app.ts'",resolveDir:process.cwd(),loader:'ts'},bundle:true,write:false,format:'esm',platform:'node',logLevel:'silent'});
const {GameApp}=await import('data:text/javascript;base64,'+Buffer.from(bundled.outputFiles[0].text).toString('base64'));
function fixture(width=844,height=390,count=8){
 const calls=[],frames=new Map();let frameId=0;
 const ctx=new Proxy({globalAlpha:1},{get:(target,key)=>key in target?target[key]:()=>{}});
 const stage={ctx,w:width,h:height,palette:{ink:'#222',muted:'#666',berry:'#a35',gold:'#fc5',cream:'#fff',overlay:'#0008',onAccent:'#fff'},invalidate(){},input(){},frame(r,id){calls.push(['frame',{...r},id]);},panel(r){this.frame(r,'panel-cream');},text(text,x,y,size){calls.push(['text',{x,y,w:String(text).length*size,h:size},String(text)]);},measure(text,size){return String(text).length*size;},icon(){},ornaments(){},button(r,label,fn){calls.push(['button',{...r},label,fn]);},hit(r,fn){calls.push(['hit',{...r},'',fn]);},clip(r,fn){fn();}};
 const app=Object.create(GameApp.prototype);app.ready=true;
 Object.assign(app,{stage,platform:{config:{id:'web'},viewport:()=>({width,height,top:0,bottom:0}),frame(fn){const id=++frameId;frames.set(id,fn);return id;},cancelFrame(id){frames.delete(id);}},client:{profile:{code:'0'},config:{capabilities:{}}},room:{ticket:{playerId:'0'},state:{cols:12,rows:9},snapshot:{title:'画',members:Array.from({length:count},(_,i)=>member(String(i),8-i)),mobileResult:{coins:20,fragments:2,catalog:{newlyCollected:true,albumRewards:[]}}}},board:{drawCompletedPicture:()=>true},modal:'completion',modalScroll:0,modalExtent:0,completionSeatRects:new Map(),cheerEffects:new CheerEffects(),cheerFrame:null,collection:{albums:[]},cancelChatPress(){},clearRoomPointer(){},invalidate(){},social:{title:'',close(){}}});
 return {app,calls,frames};
}
test('844x390 landscape has eight seats, all six cheers and existing actions inside the panel',()=>{
 const {app,calls}=fixture();app.drawModal();assert.equal(app.completionSeatRects.size,8);
 assert.equal(calls.filter(c=>c[0]==='hit'&&c[1].h===44).length,6);
 for(const label of ['再来一桌','分享成品','查看图集','回大厅']){
  const button=calls.find(c=>c[0]==='button'&&c[2]===label);assert.ok(button,label);assert.ok(button[1].y+button[1].h<=382,label);
 }
 assert.ok(app.completionBar.y+app.completionBar.h+22<=382);assert.equal(app.modalScroll,0);
 assert.ok(calls.every(c=>c[0]!=='frame'||c[1].w>0&&c[1].h>0));
});
test('portrait scrolls, desktop puts seats outside, solo has neither seats nor old contribution list',()=>{
 for(const [w,h,count] of [[390,844,8],[1200,900,8],[390,844,1],[844,390,1]]){
  const {app,calls}=fixture(w,h,count);app.drawModal();assert.equal(app.completionSeatRects.size,count>1?count:0);
  assert.ok(!calls.some(c=>c[2]==='拼合贡献'));assert.ok(calls.some(c=>c[2]==='再来一桌'));
  if(w===1200)assert.ok([...app.completionSeatRects.values()].every(r=>r.x+r.w<320||r.x>880));
  if(w===390&&count===8)assert.ok(app.modalExtent>app.modalArea.h);
 }
});
test('completion keyboard, departed sender lockout, close cleanup and animation termination',()=>{
 const {app,frames}=fixture();const sends=[];app.cheer={send:emote=>sends.push(emote),setActive:value=>sends.push(value)};
 app.input({type:'key',points:[],changed:[],key:'6',keyDown:true});assert.deepEqual(sends,['cat']);
 app.room.snapshot.members[0].lastSeen=0;app.sendCompletionCheer('clap');assert.deepEqual(sends,['cat']);
 app.cheerEffects.receive(cheer());app.animateCheers();assert.equal(frames.size,1);app.animateCheers();assert.equal(frames.size,1);
 app.showModal(null);assert.equal(app.cheerEffects.alive(),false);assert.equal(frames.size,0);assert.equal(sends.at(-1),false);
});
test('animation stops after the last effect and ignores requests while closed',()=>{
 const {app,frames}=fixture(),fake=clock();app.cheerEffects=fake.effects;
 app.cheerEffects.receive(cheer());app.animateCheers();assert.equal(frames.size,1);
 fake.at(3000);const [id,tick]=frames.entries().next().value;frames.delete(id);tick();assert.equal(frames.size,0);assert.equal(app.cheerFrame,null);
 app.modal=null;app.animateCheers();assert.equal(frames.size,0);
});
test('landscape retains album reward lines without extra tile rows or offscreen actions',()=>{
 const {app,calls}=fixture();app.room.snapshot.mobileResult.catalog.albumRewards=[{title:'相册阶段奖励',coins:100},{title:'集齐相册',coins:0}];
 app.drawModal();assert.ok(calls.some(c=>c[2]==='相册阶段奖励：金币 +100'));assert.ok(calls.some(c=>c[2]==='集齐相册：专属装饰已获得'));
 assert.ok(app.completionBar.y+app.completionBar.h+22<=382);
 const action=calls.find(c=>c[0]==='button'&&c[2]==='回大厅');assert.ok(action[1].y+action[1].h<=app.completionBar.y);
});
