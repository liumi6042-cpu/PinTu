import test from 'node:test';
import assert from 'node:assert/strict';
import {completionSeats} from '../mobile/completion-seats.ts';
import {CheerEffects} from '../mobile/cheer-effects.ts';
import {celebrationCount,popperCelebration,drawCelebration} from '../mobile/completion-celebration.ts';
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
test('same player/emote after merge window replaces the fading bubble with a new one',()=>{
 const {effects:fx,at}=clock();fx.receive(cheer());at(2501);fx.receive(cheer());
 assert.equal(fx.bubbles.length,1);assert.equal(fx.bubbles[0].born,2501);assert.equal(fx.bubbles[0].count,1);
 at(5200);assert.equal(fx.alive(),true);at(5201);assert.equal(fx.alive(),false);
});
test('a different emote replaces that player\'s bubble and leaves other players\' bubbles alone',()=>{
 const {effects:fx,at}=clock();fx.receive(cheer('a','popper'));fx.receive(cheer('b','heart'));at(100);fx.receive(cheer('a','clap'));
 assert.deepEqual(fx.bubbles.map(b=>b.playerId+':'+b.emote),['b:heart','a:clap']);
});
test('combo requires three distinct players in 3s; storm stays bounded and expires',()=>{
 const {effects:fx,at}=clock();fx.receive(cheer('a'));at(1000);fx.receive(cheer('a'));fx.receive(cheer('b'));assert.equal(fx.combo,null);
 at(3000);fx.receive(cheer('c'));assert.equal(fx.combo.count,3);assert.equal(fx.celebrations.length,1);assert.equal(celebrationCount(fx.celebrations[0]),59);assert.equal(fx.particles.length,0);
 at(3100);fx.receive(cheer('d'));assert.equal(fx.combo.count,4);
 for(let i=0;i<300;i++)fx.receive(cheer(String(i),'popper'));
 assert.ok(fx.particles.length<=180);assert.ok(fx.bubbles.length<=60);assert.equal(fx.celebrations.length,4);assert.ok(fx.celebrations.reduce((n,s)=>n+celebrationCount(s),0)<=400);
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
const bundled=await build({stdin:{contents:"export {GameApp} from './mobile/app.ts';export {Stage} from './mobile/ui.ts'",resolveDir:process.cwd(),loader:'ts'},bundle:true,write:false,format:'esm',platform:'node',logLevel:'silent'});
const {GameApp,Stage}=await import('data:text/javascript;base64,'+Buffer.from(bundled.outputFiles[0].text).toString('base64'));
function fixture(width=844,height=390,count=8,options={}){
 const calls=[],frames=new Map();let frameId=0,textSource='';
 const saved=[],ctx=new Proxy({globalAlpha:1,save(){saved.push({globalAlpha:this.globalAlpha,fillStyle:this.fillStyle});},restore(){Object.assign(this,saved.pop());},fillRect(x,y,w,h){calls.push(['fill',{x,y,w,h},this.fillStyle,this.globalAlpha]);},measureText(value){const size=Number(this.font?.match(/([\d.]+)px/)?.[1]??14);return {width:[...String(value)].reduce((sum,ch)=>sum+size*(ch.charCodeAt(0)<128?.55:1),0)};},fillText(value,x,y){calls.push(['text',{x,y,w:this.measureText(value).width,h:Number(this.font.match(/([\d.]+)px/)[1])},value,this.globalAlpha,textSource]);}},{get:(target,key)=>key in target?target[key]:()=>{}});
 const stage={ctx,w:width,h:height,palette:{ink:'#222',muted:'#666',berry:'#a35',gold:'#fc5',cream:'#fff',overlay:'#0008',onAccent:'#fff'},invalidate(){},input(){},frame(r,id){calls.push(['frame',{...r},id,ctx.globalAlpha]);},panel(r){this.frame(r,'panel-cream');},text(...args){textSource=String(args[0]);Stage.prototype.text.apply(this,args);},measure(text,size){ctx.font=size+'px sans-serif';return ctx.measureText(text).width;},icon(id,r){calls.push(['icon',{...r},id,ctx.globalAlpha]);},ornaments(){},button(r,label,fn){calls.push(['button',{...r},label,fn]);},hit(r,fn){calls.push(['hit',{...r},'',fn]);},clip(r,fn){ctx.save();try{fn();}finally{ctx.restore();}}};
 const app=Object.create(GameApp.prototype);app.ready=true;
 Object.assign(app,{stage,platform:{config:{id:'web'},viewport:()=>({width:stage.w,height:stage.h,top:0,bottom:0}),frame(fn){const id=++frameId;frames.set(id,fn);return id;},cancelFrame(id){frames.delete(id);}},client:{profile:{code:'0'},config:{capabilities:{energy:options.energyEnabled??true}}},room:{ticket:{playerId:'0'},state:{cols:12,rows:9},snapshot:{title:'画',puzzle:{imageId:'image'},members:Array.from({length:count},(_,i)=>member(String(i),8-i)),mobileResult:{coins:20,fragments:2,energy:options.energyEnabled?3:0,catalog:{newlyCollected:true,albumRewards:[]}}}},board:{drawCompletedPicture:()=>true},modal:'completion',modalScroll:0,modalExtent:0,completionSeatRects:new Map(),completionAvatarRects:new Map(),completionSlotRects:new Map(),completionBubbleRects:new Map(),cheerEffects:new CheerEffects(options.now??Date.now),cheerFrame:null,collection:{albums:options.album?[{id:'album',collected:1,total:8,images:[{id:'image'}]}]:[]},cancelChatPress(){},clearRoomPointer(){},invalidate(){},social:{title:'',close(){}}});
 app.room.snapshot.members.forEach((m,i)=>{m.name=['奶油泡芙小蛋糕','暖灯','云朵朵','桂花糕桂花糕','青柠','木棉','咕咕','麻薯'][i];});
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

const intersects=(a,b)=>a.x<b.x+b.w&&a.x+a.w>b.x&&a.y<b.y+b.h&&a.y+a.h>b.y;
const contains=(a,b)=>b.x>=a.x&&b.y>=a.y&&b.x+b.w<=a.x+a.w&&b.y+b.h<=a.y+a.h;
const seatLabels=(app,calls)=>{const names=new Set(app.room.snapshot.members.map(m=>m.name));return calls.filter(c=>c[0]==='text'&&(names.has(c[4])||c[4]?.startsWith('拼合 ')));};
const meTags=(app,calls)=>calls.filter(c=>c[0]==='fill'&&c[2]===app.colors.berry&&c[1].w===14&&c[1].h===13);
for(const [width,height] of [[844,390],[390,844],[1200,900],[1920,1080],[740,360],[667,375]])for(const count of [1,4,8])test(`${width}x${height}, ${count} players: slot bubbles avoid avatars, names, tags and panel content`,t=>{
 let now=0;t.mock.method(Date,'now',()=>now);const {app,calls}=fixture(width,height,count,{now:()=>now,energyEnabled:true,album:true});
 for(const [i,m] of app.room.snapshot.members.entries())for(let j=0;j<(i%2?3:1);j++)app.cheerEffects.receive(cheer(m.id,'clap'),i===0);
 now=560;app.drawModal();assert.equal(app.completionBubbleRects.size,count);assert.equal(app.completionSlotRects.size,count>1?count:0);
 const portrait=app.layout==='phonePortrait',labels=seatLabels(app,calls),tags=meTags(app,calls),obstacles=[...app.completionAvatarRects.values(),...labels.map(c=>c[1]),...tags.map(c=>c[1])],content=[app.completionBar,...calls.filter(c=>c[0]==='button'||c[0]==='frame'&&[52,58,64].includes(c[1].h)||c[0]==='text'&&(c[4]==='拼图完成'||c[4]?.includes('拼好啦')||c[4]?.includes(' 片')||c[4]==='这张画作已收进图集')).map(c=>c[1])];
 for(const [id,r] of app.completionBubbleRects){
  assert.ok(contains({x:0,y:0,w:width,h:height},r));
  if(count>1){const slot=app.completionSlotRects.get(id),seat=app.completionSeatRects.get(id),size=app.desktop?40:app.layout==='phoneLandscape'&&width<780?30:34;assert.deepEqual(r,slot);assert.equal(slot.w,size);assert.equal(slot.h,size);if(!portrait){assert.ok(contains(seat,slot));assert.ok(!intersects(slot,app.modalArea));}for(const rect of obstacles)assert.ok(!intersects(r,rect),`${id} overlaps seat content ${JSON.stringify(rect)}`);}
  for(const rect of content)assert.ok(!intersects(r,rect),`${id} overlaps panel content`);
  if(count>1&&portrait){const p=app.completionPicture,overlap=intersects(r,p)?Math.min(r.x+r.w,p.x+p.w)-Math.max(r.x,p.x):0;assert.ok(overlap<=14);}
  else if(count>1)assert.ok(!intersects(r,app.completionPicture));
 }
 if(count>1){assert.equal(tags.length,1);for(const c of obstacles.filter(r=>r!==tags[0][1]))assert.ok(!intersects(tags[0][1],c),'me tag overlaps seat content');assert.ok(calls.some(c=>c[2]==='我'));}
 if(!portrait&&count>1)for(const seat of app.completionSeats()){const r=app.completionSeatRects.get(seat.playerId),slot=app.completionSlotRects.get(seat.playerId),texts=labels.filter(c=>contains(r,c[1]));assert.equal(texts.length,2);for(const c of texts)assert.ok(seat.column==='left'?c[1].x+c[1].w<=slot.x-2:c[1].x>=slot.x+slot.w+2);if(seat.name.length>5)assert.ok(texts.find(c=>c[4]===seat.name)[2].endsWith('…'));}
 const combo=calls.find(c=>c[0]==='frame'&&c[2]==='button-gold-normal');if(count>=3)assert.ok(combo);if(combo)for(const r of app.completionBubbleRects.values())assert.ok(!intersects(combo[1],r),'combo banner overlaps a bubble');
 const badges=calls.filter(c=>c[0]==='text'&&c[2]==='×3');assert.equal(badges.length,Math.floor(count/2));for(const badge of badges)assert.ok([...app.completionBubbleRects.values()].some(r=>contains(r,badge[1])));assert.ok(!calls.some(c=>c[2]==='×1'));
});
for(const [width,height] of [[844,390],[390,844]])test(`${width}x${height}: solo bubble stays inside the picture bottom, away from metadata`,t=>{
 let now=0;t.mock.method(Date,'now',()=>now);const {app,calls}=fixture(width,height,1,{now:()=>now});app.cheerEffects.receive(cheer('0'));app.cheerEffects.receive(cheer('unseated'));now=560;app.drawModal();
 assert.equal(calls.find(c=>c[0]==='frame'&&c[2]==='panel-cream')[1].w,width===844?Math.min(640,width-252):Math.min(width-24,560));const r=app.completionBubbleRects.get('0'),p=app.completionPicture;assert.equal(r.w,42);assert.equal(r.h,38);assert.ok(contains(p,r));assert.equal(r.x+r.w/2,p.x+p.w/2);assert.equal(p.y+p.h-r.y-r.h,10);assert.deepEqual(app.completionBubbleRects.get('unseated'),r);
 const meta=calls.find(c=>c[0]==='text'&&c[2].includes(' 片'));assert.ok(meta);assert.ok(!intersects(r,meta[1]));
});
test('own button and bubble badges start at two cheers and stay inside the bubble',t=>{
 let now=0;t.mock.method(Date,'now',()=>now);const {app,calls}=fixture(844,390,1,{now:()=>now});app.cheerEffects.receive(cheer('0'),true);now=200;app.drawModal();assert.ok(!calls.some(c=>c[2]==='×1'||c[2]==='×2'));
 calls.length=0;app.cheerEffects.receive(cheer('0'),true);now=400;app.drawModal();const badges=calls.filter(c=>c[0]==='text'&&c[2]==='×2');assert.equal(badges.length,2);const bubble=app.completionBubbleRects.get('0');assert.equal(badges.filter(c=>contains(bubble,c[1])).length,1);
 const fill=calls.find(c=>c[0]==='fill'&&c[2]===app.colors.berry&&c[1].h===12);assert.ok(fill);assert.ok(contains(bubble,fill[1]));assert.equal(bubble.x+bubble.w-fill[1].x-fill[1].w,2);assert.equal(bubble.y+bubble.h-fill[1].y-fill[1].h,2);
});
test('popper uses a deterministic small celebration, expires at 1600 and preserves bubble lifetime',()=>{
 const {effects:fx,at}=clock(),other=clock();fx.receive(cheer('a','popper'));other.effects.receive(cheer('a','popper'));assert.equal(fx.particles.length,0);assert.equal(fx.celebrations.length,1);assert.deepEqual(fx.celebrations,other.effects.celebrations);assert.deepEqual(fx.celebrations[0],popperCelebration(0,1));assert.equal(fx.celebrations[0].confetti.length,28);at(1599);fx.update();assert.equal(fx.celebrations.length,1);at(1600);fx.update();assert.equal(fx.celebrations.length,0);assert.equal(fx.alive(),true);at(2700);assert.equal(fx.alive(),false);
});

test('popup draws the shared celebration inside its clip before hearts and bubbles',t=>{
 let now=0;t.mock.method(Date,'now',()=>now);const {app,calls}=fixture(844,390,8,{now:()=>now});app.drawModal();app.cheerEffects.receive(cheer('0','popper'));app.cheerEffects.receive(cheer('1','heart'));now=300;calls.length=0;app.drawCompletionEffects();const scene=app.cheerEffects.celebrations[0],expected=[],ctx={globalAlpha:1,save(){},restore(){},fillRect(...r){expected.push(r);}};drawCelebration(ctx,scene,now,{picture:app.completionPicture,field:app.modalArea,clip:{x:0,y:0,w:844,h:390}});assert.ok(expected.length);assert.deepEqual(calls.filter(c=>c[0]==='fill').slice(0,expected.length).map(c=>Object.values(c[1])),expected);assert.ok(calls.findIndex(c=>c[0]==='frame'&&c[2]==='button-cream-normal')>calls.findIndex(c=>c[0]==='fill'));assert.equal(app.stage.ctx.globalAlpha,1);
});
test('departed seats keep opaque frames and me tint while avatar, crown, name and tags fade',()=>{
 const {app,calls}=fixture();app.drawCompletionSeat({playerId:'gone',name:'已离桌',contribution:42,present:false,me:true,crown:true,column:'left',row:0},{x:10,y:20,w:176,h:70});
 assert.equal(calls.find(c=>c[0]==='frame')[3],1);assert.equal(calls.find(c=>c[0]==='icon'&&c[2]==='avatar')[3],.45);for(const label of ['已离桌','拼合 42','我'])assert.equal(calls.find(c=>c[0]==='text'&&c[2]===label)[3],.45);assert.equal(calls.find(c=>c[0]==='fill'&&c[1].w===168)[3],.12);assert.equal(app.stage.ctx.globalAlpha,1);
});
test('390x844 with eight players and four reward tiles keeps the next-table button visible at scroll zero',()=>{
 const {app,calls}=fixture(390,844,8,{energyEnabled:true,album:true});app.drawModal();const labels=['金币 +20','碎片 +2','体力 +3','图集 1/8'],tiles=labels.map(label=>calls.find(c=>c[0]==='text'&&c[2]===label));assert.ok(tiles.every(Boolean));assert.equal(new Set(tiles.map(c=>c[1].y)).size,1);assert.equal(app.modalScroll,0);
 const button=calls.find(c=>c[0]==='button'&&c[2]==='再来一桌');assert.ok(contains(app.modalArea,button[1]));assert.ok([...app.completionSeatRects.values()].every(r=>r.h===74));
});
test('portrait clips partially scrolled slot bubbles without clamping and skips fully hidden slots',t=>{
 let now=0;t.mock.method(Date,'now',()=>now);const {app}=fixture(390,844,8,{now:()=>now});for(const m of app.room.snapshot.members)app.cheerEffects.receive(cheer(m.id));now=560;
 for(const scroll of [18,80]){app.modalScroll=scroll;app.drawModal();assert.equal(app.completionSlotRects.size,8);assert.ok(app.completionBubbleRects.size>0);
  for(const [id,slot] of app.completionSlotRects)if(intersects(slot,app.modalArea))assert.deepEqual(app.completionBubbleRects.get(id),slot);else assert.ok(!app.completionBubbleRects.has(id));
  if(scroll===18){const slot=app.completionSlotRects.get('0');assert.ok(slot.y<app.modalArea.y&&slot.y+slot.h>app.modalArea.y);assert.deepEqual(app.completionBubbleRects.get('0'),slot);}else assert.ok(app.completionBubbleRects.size<8);
 }
 app.cheerEffects.clear();app.drawCompletionEffects();assert.equal(app.completionBubbleRects.size,0);
});

test('seat, avatar, slot and bubble share hop offsets and clear with a solo roster or different layout',t=>{
 let now=0;t.mock.method(Date,'now',()=>now);const {app}=fixture(1200,900,8,{now:()=>now});app.cheerEffects.receive(cheer('0'));now=560;app.drawModal();const before=[app.completionSeatRects,app.completionAvatarRects,app.completionSlotRects,app.completionBubbleRects].map(map=>({...map.get('0')}));app.cheerEffects.receive(cheer('0'));now=710;app.drawModal();for(const [i,map] of [app.completionSeatRects,app.completionAvatarRects,app.completionSlotRects,app.completionBubbleRects].entries())assert.equal(map.get('0').y-before[i].y,-4);const r=app.completionSeatRects.get('0'),a=app.completionAvatarRects.get('0');assert.equal(a.y,r.y+(r.h-a.h)/2);assert.equal(app.completionAvatarRects.size,8);
 app.stage.w=390;app.stage.h=844;app.drawModal();assert.ok([...app.completionAvatarRects.values()].every(r=>r.w===34));app.room.snapshot.members=app.room.snapshot.members.slice(0,1);app.drawModal();assert.equal(app.completionSeatRects.size,0);assert.equal(app.completionAvatarRects.size,0);assert.equal(app.completionSlotRects.size,0);
});
for(const [width,height] of [[844,390],[390,844],[1920,1080]])test(`${width}x${height}: hearts stay in the slot column or drift over the portrait picture`,t=>{
 let now=0;t.mock.method(Date,'now',()=>now);const {app,calls}=fixture(width,height,8,{now:()=>now});app.drawModal();
 const obstacles=[...app.completionAvatarRects.values(),...seatLabels(app,calls).map(c=>c[1]),...meTags(app,calls).map(c=>c[1])];
 for(const seat of app.completionSeats().filter(s=>s.column==='left'&&s.row===1||s.column==='right'&&s.row===2))for(const x of [0,.5,1])for(const y of [0,1])for(const elapsed of [0,200,400,800,1200,1500]){
  now=elapsed;calls.length=0;app.cheerEffects.particles=[{kind:'heart',playerId:seat.playerId,start:0,duration:1600,x,y,delay:0,speed:1,spin:0,color:0}];app.drawCompletionEffects();
  const pixels=calls.filter(c=>c[0]==='fill'),minX=Math.min(...pixels.map(c=>c[1].x)),minY=Math.min(...pixels.map(c=>c[1].y)),box={x:minX-4,y:minY-6,w:24,h:24},slot=app.completionSlotRects.get(seat.playerId);
  assert.ok(pixels.length>0);for(const rect of obstacles)assert.ok(!intersects(box,rect),`${seat.playerId}, t=${elapsed}: heart overlaps seat content`);
  if(app.layout!=='phonePortrait')assert.ok(box.x>=slot.x&&box.x+24<=slot.x+slot.w);
  if(!elapsed){assert.ok(Math.abs(box.x+12-slot.x-slot.w/2)<=.5);assert.ok(Math.abs(box.y+12-slot.y-slot.h/2)<=.5);}
  assert.ok(pixels.every(c=>c[3]===1-elapsed/1600));
 }
});

test('unseated hearts retain the picture-bottom origin and spread',t=>{
 t.mock.method(Date,'now',()=>400);for(const count of [1,8]){const {app,calls}=fixture(844,390,count);app.drawModal();calls.length=0;app.cheerEffects.particles=[{kind:'heart',playerId:'unseated',start:0,duration:1600,x:.75,y:.5,delay:0,speed:1,spin:0,color:0}];app.drawCompletionEffects();const p=app.completionPicture,expected=[];drawCheerIcon({save(){},restore(){},fillRect(...args){expected.push(args);}},'heart',{x:p.x+p.w/2-12+15,y:p.y+p.h-29-12-25-10,w:24,h:24});assert.deepEqual(calls.filter(c=>c[0]==='fill').map(c=>[c[1].x,c[1].y,c[1].w,c[1].h]),expected);}
});

for(const [width,height,seatW,slotS,panelW] of [[844,390,140,34,528],[740,360,120,30,464],[667,375,120,30,391]])for(const rewards of [false,true])test(`${width}x${height}: landscape ${rewards?'with':'without'} album reward lines fits without scrolling`,()=>{
 const {app,calls}=fixture(width,height,8,{energyEnabled:true,album:true});app.room.snapshot.title='海边旧灯塔的晚霞';if(rewards)app.room.snapshot.mobileResult.catalog.albumRewards=[{title:'相册阶段奖励',coins:100},{title:'集齐相册',coins:0}];app.drawModal();
 const panel=app.modalArea;assert.equal(panel.w,panelW);assert.equal(app.modalScroll,0);assert.equal(app.modalExtent,0);if(width===844)assert.ok(app.completionPicture.w>=200);
 const close=calls.find(c=>c[0]==='button'&&c[2]==='')[1],title=calls.find(c=>c[0]==='text'&&c[4]?.includes('拼好啦'))[1];assert.ok(!intersects(title,close),'title overlaps the close button');if(!rewards)assert.equal(title.y,panel.y+42);
 for(const [id,r] of app.completionSeatRects){const slot=app.completionSlotRects.get(id),avatar=app.completionAvatarRects.get(id);assert.equal(r.w,seatW);assert.equal(r.h,60);assert.equal(slot.w,slotS);assert.equal(slot.h,slotS);assert.equal(avatar.w,slotS);assert.ok(contains(r,slot));assert.ok(r.x<panel.x?r.x+r.w<=panel.x-6:r.x>=panel.x+panel.w+6);}
 for(const c of calls.filter(c=>c[0]==='button'||c[0]==='hit'&&c[1].h===44||c[0]==='text'&&!seatLabels(app,calls).includes(c)&&c[2]!=='我'))assert.ok(contains(panel,c[1]),`${c[0]} ${c[2]} outside panel ${JSON.stringify(c[1])}`);
 assert.ok(contains(panel,app.completionBar));const hint=calls.find(c=>c[2]==='点一下就能喝彩，同桌都看得到');assert.ok(hint&&contains(panel,hint[1]));
});

test('me tags occupy the outer corner and avoid avatar, crown pixels and slot in both columns',()=>{
 for(const [width,height] of [[844,390],[390,844],[1920,1080]])for(const column of ['left','right']){const {app,calls}=fixture(width,height);app.completionPicture={x:100,y:100,w:190,h:190};const vertical=height>width,r={x:column==='left'?27:297,y:100,w:vertical?66:width===844?140:176,h:vertical?74:width===844?60:70};app.drawCompletionSeat({playerId:'0',name:'奶油泡芙小蛋糕',contribution:42,present:true,me:true,crown:true,column,row:0},r,vertical);const tag=meTags(app,calls)[0][1];assert.deepEqual(tag,{x:column==='left'?r.x+3:r.x+r.w-17,y:r.y+(vertical?3:-6),w:14,h:13});for(const rect of [app.completionAvatarRects.get('0'),app.completionSlotRects.get('0'),...seatLabels(app,calls).map(c=>c[1]),...calls.filter(c=>c[0]==='fill'&&c[1].w<=2).map(c=>c[1])])assert.ok(!intersects(tag,rect));}
});
