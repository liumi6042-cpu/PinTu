import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createMobileService} from '../server/mobile-service.mjs';
import {createMobileTuanzi,readTuanziConfiguration,beijingDay} from '../server/mobile-tuanzi.mjs';
import defaults from '../config/tuanzi-travel.json' with {type:'json'};

const rid=()=>randomBytes(16).toString('hex'),MIN=60000,HOUR=3600000;

// ---------------------------------------------------------------- module (trip rules)
function moduleFixture({pictures=['p1','p2','p3','p4','p5'],seeds}={}){
 const db=new DatabaseSync(':memory:'),granted=[];let seed=0;
 const tuanzi=createMobileTuanzi({db,cleared:()=>true,randomInt:()=>seeds?seeds[seed++%seeds.length]:seed++,
  pool:()=>pictures.map(id=>({id,title:'图 '+id,src:'/puzzles/'+id+'.webp',thumbSrc:'/puzzles/'+id+'-t.webp',width:1536,height:1024})),
  albumOf:id=>id==='p2'?{id:'paid-album',title:'付费图包',paid:true}:null,grid:()=>({cols:6,rows:4}),grantDecoration:(owner,id)=>granted.push(id),
  regions:{schema:'jigsaw-tuanzi-regions/v1',images:{p1:'water',p2:'water',p3:'street',p4:'wild'}}});
 const owner='a'.repeat(64);
 const give=fish=>db.prepare('UPDATE tuanzi_state SET fish=fish+? WHERE owner=?').run(fish,owner);
 const firstTrip=at=>{tuanzi.ensure(owner,at);tuanzi.pack(owner,{food:'onigiri'},at);tuanzi.activity(owner,at+21*MIN);};
 return {db,tuanzi,owner,give,granted,firstTrip};
}

test('the configuration validates and keeps the shop, timings and art tables',()=>{
 const cfg=readTuanziConfiguration();
 assert.deepEqual(cfg.foods.map(f=>[f.id,f.price,f.pieces]),[['onigiri',3,24],['bento',8,35],['deluxe',15,40]]);
 assert.equal(cfg.rare.length,12);assert.equal(cfg.souvenirs.length,16);assert.equal(cfg.stickers.length,6);
 assert.throws(()=>readTuanziConfiguration({...defaults,rare:defaults.rare.slice(1)}),/rare/);
 assert.throws(()=>readTuanziConfiguration({...defaults,foods:[{...defaults.foods[0],pieces:48},...defaults.foods.slice(1)]}),/food/);
});

test('first trip: leaves at once, mails 「第一次出门」 and is home after 20 minutes',()=>{
 const {tuanzi,owner}=moduleFixture(),t0=Date.parse('2026-11-01T02:00:00Z');
 const welcome=tuanzi.view(owner,t0);
 assert.equal(welcome.fish,10);assert.equal(welcome.inventory.onigiri,1);assert.equal(welcome.status,'home');
 assert.deepEqual(tuanzi.pack(owner,{food:'onigiri'},t0),{departed:true});
 const away=tuanzi.view(owner,t0+5*MIN);assert.equal(away.status,'away');assert.equal(away.trip.first,true);assert.equal(away.postcards.length,0);
 assert.equal(away.inventory.onigiri,undefined,'the food is eaten on the way');
 assert.throws(()=>tuanzi.pack(owner,{food:null},t0+6*MIN),{code:'TUANZI_AWAY'});
 const mid=tuanzi.view(owner,t0+12*MIN);assert.equal(mid.postcards.length,1);assert.equal(mid.postcards[0].title,'第一次出门');assert.equal(mid.unread,1);
 const home=tuanzi.view(owner,t0+20*MIN);assert.equal(home.status,'home');assert.equal(home.trip.returned,true);
});

test('trips leave only after the player has been away, and every card follows the timing rules',()=>{
 for(let run=0;run<60;run++){
  const {tuanzi,owner,give,db}=moduleFixture({seeds:[run*7919+11,run*104729+3,run+5]}),t0=Date.parse('2026-11-01T01:00:00Z')+run*37*MIN;
  tuanzi.ensure(owner,t0);give(100);tuanzi.pack(owner,{food:'onigiri'},t0);tuanzi.activity(owner,t0+30*MIN);
  const food=['onigiri','bento','deluxe'][run%3];tuanzi.buy(owner,food,rid(),t0+30*MIN);tuanzi.pack(owner,{food},t0+30*MIN);
  // A short absence keeps 团子 home; a long one has it leave 15–40 minutes after the last request.
  tuanzi.activity(owner,t0+39*MIN);assert.equal(tuanzi.readState(owner).status,'home');
  const back=t0+39*MIN+20*HOUR;tuanzi.activity(owner,back);
  const trip=JSON.parse(db.prepare('SELECT trip FROM tuanzi_state WHERE owner=?').get(owner).trip);
  const departed=trip.departedAt-(t0+39*MIN);assert.ok(departed>=15*MIN&&departed<=40*MIN,'departure '+departed/MIN);
  const cfg=defaults.foods.find(f=>f.id===food),duration=trip.returnAt-trip.departedAt;
  assert.ok(duration>=cfg.hours[0]*HOUR-1&&duration<=cfg.hours[1]*HOUR+1);
  assert.ok(trip.cards.length>=cfg.cards[0]&&trip.cards.length<=cfg.cards[1]);
  const first=trip.cards[0].at,morning=(()=>{const day=Date.parse(beijingDay(trip.departedAt)+'T07:00:00+08:00');return day>trip.departedAt?day:day+24*HOUR;})();
  assert.ok(first>=trip.departedAt+HOUR-1,'first card at least an hour in');
  assert.ok(first<=Math.max(trip.departedAt+HOUR,trip.departedAt+duration*.6)+1,'first card within 60% of the trip');
  if(trip.returnAt>morning&&morning>=trip.departedAt+HOUR)assert.ok(first<=morning,'night trips mail one by 07:00 Beijing');
  for(const card of trip.cards.slice(1))assert.ok(card.at>first&&card.at<trip.returnAt);
  assert.ok(trip.cards.every(card=>card.pieces===cfg.pieces&&defaults.places[card.region].includes(card.place)&&defaults.lines[card.region].includes(card.line)));
  tuanzi.activity(owner,Math.max(back,trip.returnAt));assert.equal(tuanzi.readState(owner).status,'home','back after the trip');
 }
});

test('night trips always have a postcard waiting by 07:00 Beijing',()=>{
 for(let run=0;run<40;run++){
  const {tuanzi,owner,give,db}=moduleFixture({seeds:[run*31+7,run*977+1]}),t0=Date.parse('2026-11-01T12:00:00Z');
  tuanzi.ensure(owner,t0);give(100);tuanzi.pack(owner,{food:'onigiri'},t0);tuanzi.activity(owner,t0+30*MIN);
  tuanzi.buy(owner,'deluxe',rid(),t0+60*MIN);tuanzi.pack(owner,{food:'deluxe'},t0+60*MIN);
  tuanzi.activity(owner,t0+60*MIN+3*HOUR);// leaves around 21:15–21:40 Beijing
  const trip=JSON.parse(db.prepare('SELECT trip FROM tuanzi_state WHERE owner=?').get(owner).trip);
  assert.ok(trip.cards[0].at<=Date.parse('2026-11-01T23:00:00Z'),'card by 07:00 Beijing, got '+new Date(trip.cards[0].at).toISOString());
 }
});

test('tools pick the region, charms double rare odds or bring a souvenir, duplicates become 小鱼干',()=>{
 const {tuanzi,owner,give,db}=moduleFixture({pictures:['p1']}),t0=Date.parse('2026-11-01T02:00:00Z');
 tuanzi.ensure(owner,t0);give(200);tuanzi.pack(owner,{food:'onigiri'},t0);tuanzi.activity(owner,t0+30*MIN);
 let now=t0+30*MIN;
 const trip=()=>JSON.parse(db.prepare('SELECT trip FROM tuanzi_state WHERE owner=?').get(owner).trip);
 for(let n=0;n<3;n++){
  for(const item of ['bento','umbrella','knot'])tuanzi.buy(owner,item,rid(),now);
  tuanzi.pack(owner,{food:'bento',tool:'umbrella',charm:'knot'},now);
  now+=24*HOUR;tuanzi.activity(owner,now);
  const t=trip();assert.equal(t.region,'water');assert.ok(t.souvenir&&defaults.souvenirs.find(s=>s.id===t.souvenir).region==='water');
  now+=MIN;
 }
 const view=tuanzi.view(owner,now),gallery=view.postcards.filter(card=>card.kind==='gallery');
 assert.ok(gallery.length<=1,'the one picture arrives once');
 assert.ok(db.prepare("SELECT COUNT(*) n FROM tuanzi_fish_ledger WHERE owner=? AND source='duplicate'").get(owner).n>=1);
 assert.equal(view.souvenirs.reduce((n,s)=>n+s.count,0),3);
 const paid=view.postcards.find(card=>card.imageId==='p2');assert.equal(paid,undefined);
});

test('the windowsill dries 2 小鱼干 every 3 hours, up to two portions',()=>{
 const {tuanzi,owner}=moduleFixture(),t0=Date.parse('2026-11-01T02:00:00Z');
 tuanzi.ensure(owner,t0);
 assert.throws(()=>tuanzi.sill(owner,t0+2*HOUR),{code:'TUANZI_SILL_EMPTY'});
 assert.equal(tuanzi.view(owner,t0+3*HOUR).sill.portions,1);
 assert.equal(tuanzi.view(owner,t0+20*HOUR).sill.portions,2);
 assert.deepEqual(tuanzi.sill(owner,t0+20*HOUR),{fish:4});
 assert.throws(()=>tuanzi.sill(owner,t0+20*HOUR+MIN),{code:'TUANZI_SILL_EMPTY'});
 assert.equal(tuanzi.view(owner,t0+20*HOUR).fish,14);
});

test('story clears pay 2 小鱼干 up to five times a day; collection milestones pay once',()=>{
 const {tuanzi,owner,granted,db}=moduleFixture({pictures:Array.from({length:40},(_,n)=>'q'+n)}),t0=Date.parse('2026-11-01T02:00:00Z');
 tuanzi.ensure(owner,t0);
 for(let n=0;n<7;n++)tuanzi.levelClear(owner,'room:'+n,t0+n);
 assert.equal(tuanzi.fish(owner),10+5*2);
 tuanzi.levelClear(owner,'room:next-day',t0+24*HOUR);assert.equal(tuanzi.fish(owner),22);
 // 16 postcards: the 5-card fish and the 15-card cursor, once each
 const insert=db.prepare("INSERT INTO tuanzi_postcards(owner,card_id,kind,image_id,region,place,date,sticker,line,pieces,arrived_at) VALUES(?,?,'gallery',?,'town','车站','2026-11-01','wave','好',24,?)");
 for(let n=0;n<16;n++)insert.run(owner,'c'+n,'q'+n,t0);
 tuanzi.pack(owner,{food:'onigiri'},t0);tuanzi.view(owner,t0+30*MIN);tuanzi.view(owner,t0+31*MIN);
 assert.equal(tuanzi.fish(owner),22+20);assert.deepEqual(granted,['postman-tuanzi']);
 assert.equal(tuanzi.view(owner,t0+32*MIN).album.rewards.find(r=>r.key==='total-15').taken,true);
});

// ---------------------------------------------------------------- service
function serviceFixture(t,options={}){
 let now=Date.parse('2026-11-01T02:00:00Z');
 const dir=mkdtempSync(join(tmpdir(),'tuanzi-')),databasePath=join(dir,'mobile.sqlite');
 const make=()=>createMobileService({now:()=>now,randomInt:min=>min,databasePath,...options});
 let service=make();
 t.after(()=>{service.close();rmSync(dir,{recursive:true,force:true});});
 const owner=randomBytes(32).toString('hex');
 const call=(url,body,token,who=owner,method)=>service.handle({identity:who,url,method:method??(body===undefined?'GET':'POST'),body,authorization:token?'Bearer '+token:undefined,artworkSnapshot:true});
 const ok=(...args)=>{const r=call(...args);assert.ok([200,201].includes(r.status),JSON.stringify(r).slice(0,400));return r.data;};
 const raw=()=>new DatabaseSync(databasePath);
 const unlock=(who=owner)=>{ok('/api/mobile/profile',undefined,undefined,who);const db=raw();db.prepare("INSERT OR IGNORE INTO mobile_level_progress VALUES(?,'ch1-2','x',?,0)").run(who,now);db.close();};
 const finish=(ticket,who=owner)=>{
  const path='/api/rooms/'+ticket.room.id;let snap=ok(path,undefined,ticket.token,who);const total=snap.puzzle.cols*snap.puzzle.rows;
  for(let piece=0;piece<total;piece++){const group=snap.puzzle.groups.find(g=>g.pieces.includes(piece));if(group.locked)continue;ok(path,{type:'claim',groupId:group.id},ticket.token,who);snap=ok(path,{type:'drop',groupId:group.id,dx:0,dy:0,seq:1,requestId:rid()},ticket.token,who);}
  assert.ok(snap.completedAt,'room completed');return snap;
 };
 return {owner,call,ok,raw,unlock,finish,get service(){return service;},restart:()=>{service.close();service=make();},set:v=>{now=typeof v==='string'?Date.parse(v):v;},advance:ms=>{now+=ms;},now:()=>now};
}

test('capability flag, kill switch and the 1-2 lock; nothing is written before the nook opens',t=>{
 const f=serviceFixture(t);
 assert.equal(f.ok('/api/mobile/profile').capabilities.tuanziTravel,true);
 assert.deepEqual(f.ok('/api/mobile/tuanzi').locked,true);
 const locked=f.call('/api/mobile/tuanzi/buy',{requestId:rid(),itemId:'onigiri'});assert.equal(locked.status,403);assert.equal(locked.data.code,'TUANZI_LOCKED');
 const db=f.raw();assert.equal(db.prepare('SELECT COUNT(*) n FROM tuanzi_state').get().n,0);assert.equal(db.prepare('SELECT COUNT(*) n FROM tuanzi_fish_ledger').get().n,0);db.close();
 const off=serviceFixture(t,{tuanzi:false});
 assert.equal(off.ok('/api/mobile/profile').capabilities.tuanziTravel,false);
 const disabled=off.call('/api/mobile/tuanzi');assert.equal(disabled.status,503);assert.equal(disabled.data.code,'TUANZI_DISABLED');
 process.env.MOBILE_TUANZI='false';try{const env=serviceFixture(t);assert.equal(env.ok('/api/mobile/profile').capabilities.tuanziTravel,false);}finally{delete process.env.MOBILE_TUANZI;}
});

test('welcome gift once, shop with request ids: replay, conflict, short of 小鱼干',t=>{
 const f=serviceFixture(t);f.unlock();
 const first=f.ok('/api/mobile/tuanzi');assert.equal(first.fish,10);assert.equal(first.inventory.onigiri,1);assert.ok(first.welcome.at);
 assert.equal(f.ok('/api/mobile/tuanzi').fish,10,'the welcome gift is given once');
 const input={requestId:rid(),itemId:'bento'},bought=f.ok('/api/mobile/tuanzi/buy',input);
 assert.equal(bought.fish,2);assert.equal(bought.inventory.bento,1);assert.deepEqual(bought.bought,{itemId:'bento',price:8});
 assert.deepEqual(f.ok('/api/mobile/tuanzi/buy',input),bought,'a retried purchase replays without charging again');
 const conflict=f.call('/api/mobile/tuanzi/buy',{...input,itemId:'onigiri'});assert.equal(conflict.status,409);assert.equal(conflict.data.code,'REQUEST_CONFLICT');
 const short=f.call('/api/mobile/tuanzi/buy',{requestId:rid(),itemId:'deluxe'});assert.equal(short.status,409);assert.equal(short.data.code,'TUANZI_FISH_SHORT');
 const missing=f.call('/api/mobile/tuanzi/buy',{itemId:'onigiri'});assert.equal(missing.status,400);assert.equal(missing.data.code,'REQUEST_ID_REQUIRED');
 const unknown=f.call('/api/mobile/tuanzi/buy',{requestId:rid(),itemId:'cake'});assert.equal(unknown.status,400);assert.equal(unknown.data.code,'TUANZI_ITEM_INVALID');
 const bad=f.call('/api/mobile/tuanzi/pack',{requestId:rid(),food:'cake'});assert.equal(bad.status,400);assert.equal(bad.data.code,'TUANZI_PACK_INVALID');
 const none=f.call('/api/mobile/tuanzi/pack',{requestId:rid(),food:'deluxe'});assert.equal(none.status,409);assert.equal(none.data.code,'TUANZI_ITEM_MISSING');
 const db=f.raw();assert.equal(db.prepare('SELECT SUM(amount) s FROM tuanzi_fish_ledger WHERE owner=?').get(f.owner).s,2);db.close();
});

test('first trip, lazy departure while away, postcards arrive and are read and finished once',t=>{
 const f=serviceFixture(t);f.unlock();f.ok('/api/mobile/tuanzi');
 const packed=f.ok('/api/mobile/tuanzi/pack',{requestId:rid(),food:'onigiri'});assert.equal(packed.packed.departed,true);assert.equal(packed.status,'away');
 f.advance(21*60000);let view=f.ok('/api/mobile/tuanzi');assert.equal(view.status,'home');assert.equal(view.unread,1);
 const special=view.postcards[0];assert.equal(special.kind,'special');assert.equal(special.roomable,false);
 view=f.ok('/api/mobile/tuanzi/postcards/read',{requestId:rid(),cardIds:[special.id]});assert.equal(view.unread,0);
 const done={requestId:rid(),elapsedMs:90000};
 view=f.ok('/api/mobile/tuanzi/postcards/'+special.id+'/complete',done);assert.deepEqual(view.completed,{cardId:special.id,fish:2});assert.equal(view.fish,12);
 assert.equal(f.ok('/api/mobile/tuanzi/postcards/'+special.id+'/complete',{requestId:rid(),elapsedMs:1}).completed.fish,0,'+2 once per card');
 assert.equal(f.ok('/api/mobile/tuanzi/postcards/'+special.id+'/complete',done).fish,12,'replayed');
 const missing=f.call('/api/mobile/tuanzi/postcards/nope/complete',{requestId:rid(),elapsedMs:1});assert.equal(missing.status,404);assert.equal(missing.data.code,'TUANZI_CARD_NOT_FOUND');
 // second trip: packed, then the player stays (requests every few minutes) — 团子 waits; then they leave for 8 hours
 f.ok('/api/mobile/tuanzi/buy',{requestId:rid(),itemId:'onigiri'});f.ok('/api/mobile/tuanzi/pack',{requestId:rid(),food:'onigiri'});
 for(let n=0;n<5;n++){f.advance(5*60000);assert.equal(f.ok('/api/mobile/profile')&&f.ok('/api/mobile/tuanzi').status,'home');}
 f.advance(8*3600000);view=f.ok('/api/mobile/tuanzi');
 assert.equal(view.status,'home');assert.equal(view.trip.returned,true);assert.equal(view.trips,2);
 const gallery=view.postcards.find(card=>card.kind==='gallery');assert.ok(gallery,'a gallery postcard came');
 assert.ok(gallery.src&&gallery.cols*gallery.rows>=20&&gallery.pieces===24&&gallery.roomable===true);
 const db=f.raw(),trip=JSON.parse(db.prepare('SELECT trip FROM tuanzi_state WHERE owner=?').get(f.owner).trip);db.close();
 assert.ok(trip.departedAt>=f.now()-8*3600000-25*60000+15*60000-60000&&trip.departedAt<f.now()-7*3600000,'left 15–40 min after the last request');
});

test('postcard room: private, free of energy, outside the room limit; finishing pays the card and helpers',t=>{
 const f=serviceFixture(t);f.unlock();f.ok('/api/mobile/tuanzi');
 f.ok('/api/mobile/tuanzi/pack',{requestId:rid(),food:'onigiri'});f.advance(21*60000);f.ok('/api/mobile/tuanzi');
 f.ok('/api/mobile/tuanzi/buy',{requestId:rid(),itemId:'onigiri'});f.ok('/api/mobile/tuanzi/pack',{requestId:rid(),food:'onigiri'});
 f.advance(8*3600000);const card=f.ok('/api/mobile/tuanzi').postcards.find(c=>c.kind==='gallery');
 const special=f.call('/api/mobile/tuanzi/postcards/first-trip/room',{requestId:rid()});assert.equal(special.status,409);assert.equal(special.data.code,'TUANZI_CARD_SOLO');
 const ticket=f.ok('/api/mobile/tuanzi/postcards/'+card.id+'/room',{requestId:rid()});
 assert.equal(ticket.room.visibility,'private');assert.ok(ticket.inviteCode);assert.equal(ticket.room.requestedPieces,24);
 const again=f.ok('/api/mobile/tuanzi/postcards/'+card.id+'/room',{requestId:rid()});assert.equal(again.room.id,ticket.room.id,'one open room per card');
 const lobby=f.ok('/api/lobby');assert.ok(!lobby.rooms.some(room=>room.id===ticket.room.id));
 for(let n=0;n<5;n++)f.ok('/api/rooms',{mode:'random',pieces:48,visibility:'public',requestId:rid()});
 const sixth=f.call('/api/rooms',{mode:'random',pieces:48,visibility:'public',requestId:rid()});assert.equal(sixth.status,409);assert.equal(sixth.data.code,'ROOM_LIMIT','five public rooms still fit beside the postcard room');
 // a friend joins by invite and helps; nobody spends energy
 const friend=randomBytes(32).toString('hex');f.unlock(friend);f.ok('/api/mobile/tuanzi',undefined,undefined,friend);
 const joined=f.ok('/api/rooms/'+ticket.room.id+'/join',{inviteCode:ticket.inviteCode},undefined,friend);
 const energy=f.ok('/api/mobile/profile').energy,friendEnergy=f.ok('/api/mobile/profile',undefined,undefined,friend).energy;
 const path='/api/rooms/'+ticket.room.id;let snap=f.ok(path,undefined,joined.token,friend);
 const group=snap.puzzle.groups.find(g=>!g.locked);f.ok(path,{type:'claim',groupId:group.id},joined.token,friend);f.ok(path,{type:'drop',groupId:group.id,dx:0,dy:0,seq:1,requestId:rid()},joined.token,friend);
 f.finish(ticket);
 // contributions may level a player up (and refill), but nothing is spent and the completion pool pays no energy
 assert.ok(f.ok('/api/mobile/profile').energy>=energy,'no energy spent');
 assert.ok(f.ok('/api/mobile/profile',undefined,undefined,friend).energy>=friendEnergy);
 {const db=f.raw();assert.deepEqual(db.prepare('SELECT DISTINCT energy FROM mobile_settlements WHERE room_id=?').all(ticket.room.id).map(r=>r.energy),[0]);db.close();}
 const after=f.ok('/api/mobile/tuanzi');assert.equal(after.postcards.find(c=>c.id===card.id).completed,true);
 const db=f.raw();
 assert.equal(db.prepare("SELECT amount FROM tuanzi_fish_ledger WHERE owner=? AND request_id=?").get(f.owner,'postcard:'+card.id).amount,2);
 assert.equal(db.prepare("SELECT amount FROM tuanzi_fish_ledger WHERE owner=? AND request_id=?").get(friend,'postcard-room:'+ticket.room.id).amount,2);
 db.close();
});

test('completion fish for nook owners only: daily 4, rooms by size; old-package players are untouched',t=>{
 const f=serviceFixture(t);f.unlock();f.ok('/api/mobile/tuanzi');
 const outsider=randomBytes(32).toString('hex');f.ok('/api/mobile/profile',undefined,undefined,outsider);
 const daily=f.ok('/api/rooms',{mode:'daily',pieces:108,visibility:'public',requestId:rid()});
 const joined=f.ok('/api/rooms/'+daily.room.id+'/join',{},undefined,outsider),path='/api/rooms/'+daily.room.id;
 let snap=f.ok(path,undefined,joined.token,outsider);const group=snap.puzzle.groups.find(g=>!g.locked);
 f.ok(path,{type:'claim',groupId:group.id},joined.token,outsider);f.ok(path,{type:'drop',groupId:group.id,dx:0,dy:0,seq:1,requestId:rid()},joined.token,outsider);
 f.finish(daily);
 const db=f.raw();
 assert.equal(db.prepare("SELECT amount FROM tuanzi_fish_ledger WHERE owner=? AND source='daily'").get(f.owner).amount,4);
 for(const table of ['tuanzi_state','tuanzi_fish_ledger','tuanzi_items','tuanzi_postcards','tuanzi_souvenirs'])assert.equal(db.prepare(`SELECT COUNT(*) n FROM ${table} WHERE owner=?`).get(outsider).n,0,table);
 db.close();
 assert.equal(f.ok('/api/mobile/tuanzi').fish,14);
});

test('tables are created idempotently; a restarted service keeps the nook',t=>{
 const f=serviceFixture(t);f.unlock();f.ok('/api/mobile/tuanzi');f.ok('/api/mobile/tuanzi/buy',{requestId:rid(),itemId:'onigiri'});
 f.restart();f.restart();
 const view=f.ok('/api/mobile/tuanzi');assert.equal(view.fish,7);assert.equal(view.inventory.onigiri,2);
});
