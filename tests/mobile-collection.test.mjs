import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdirSync,mkdtempSync,rmSync} from 'node:fs';
import {resolve,sep} from 'node:path';
import {randomBytes} from 'node:crypto';
import {createMobileCollection,MOBILE_COLLECTION_CATALOG as catalog} from '../server/mobile-collection.mjs';
import {createMobileService} from '../server/mobile-service.mjs';
import {BEGINNER_TASKS} from '../server/mobile-tasks.mjs';
import {GALLERY_VISIBLE_PHOTOS,ONLINE_MS} from '../outputs/mobile/engine.mjs';

const rid=()=>randomBytes(16).toString('hex');
const identity=n=>n.repeat(64);
const completed=(imageId,pieces=48)=>({id:rid(),completedAt:1800000000000,puzzle:{imageId},mobilePieces:pieces});
function transaction(db,action){
 db.exec('BEGIN IMMEDIATE');
 try{const result=action();db.exec('COMMIT');return result;}catch(error){db.exec('ROLLBACK');throw error;}
}
function harness(){
 const workRoot=resolve('work');mkdirSync(workRoot,{recursive:true});
 const dir=mkdtempSync(resolve(workRoot,'mobile-collection-test-')),databasePath=resolve(dir,'mobile.sqlite');
 let now=1800000000000;
 const service=createMobileService({databasePath,now:()=>now,randomInt:min=>min}),fixture=new DatabaseSync(databasePath);
 const call=(actor,url,body,token,method=body===undefined?'GET':'POST')=>JSON.parse(JSON.stringify(service.handle({identity:actor,url,method,body,...(token?{authorization:'Bearer '+token}:{})})));
 const patch=(actor,updates)=>{const p=JSON.parse(fixture.prepare('SELECT data FROM mobile_profiles WHERE id=?').get(actor).data);Object.assign(p,updates);fixture.prepare('UPDATE mobile_profiles SET data=? WHERE id=?').run(JSON.stringify(p),actor);};
 return {service,fixture,call,patch,advance:ms=>{now+=ms;},close(){fixture.close();service.close();assert.ok(dir.startsWith(workRoot+sep));rmSync(dir,{recursive:true,force:true});}};
}

test('collection ledger: contributions, completion receipts, unique catalog difficulties and automatic album rewards',()=>{
 const db=new DatabaseSync(':memory:'),c=createMobileCollection({db,photos:GALLERY_VISIBLE_PHOTOS}),owner=identity('a'),pack=catalog.packs[0],now=1800000000000;
 try{
  assert.deepEqual(c.view(owner,now).wallet,{coins:0,fragments:0});
  assert.equal(c.equipped(owner),null);
  const event=rid(),roomId=rid();
  assert.equal(transaction(db,()=>c.contribution(owner,roomId,event,now)),1);
  assert.equal(transaction(db,()=>c.contribution(owner,roomId,event,now)),0);
  assert.equal(c.summary(owner).coins,1);
  const below=completed(pack.imageIds[0]);
  assert.equal(transaction(db,()=>c.complete(owner,below,2,now)).catalog.qualified,false);
  assert.equal(c.view(owner,now).albums[0].collected,0);
  const first=completed(pack.imageIds[0]);
  const award=transaction(db,()=>c.complete(owner,first,12,now));
  assert.equal(award.coins,6);assert.equal(award.fragments,1);assert.equal(award.catalog.newlyCollected,true);
  const before=c.summary(owner);
  assert.deepEqual(transaction(db,()=>c.complete(owner,first,12,now)),award);
  assert.deepEqual(c.summary(owner),before);
  const repeat=transaction(db,()=>c.complete(owner,completed(pack.imageIds[0],108),3,now));
  assert.equal(repeat.catalog.newlyCollected,false);
  assert.deepEqual(c.view(owner,now).albums[0].images[0].difficulties,[48,108]);
  assert.throws(()=>transaction(db,()=>c.craft(owner,pack.decorationId,now)),{code:'ALBUM_REQUIRED'});
  let albumAwards=[];
  for(const imageId of pack.imageIds.slice(1)){
   const result=transaction(db,()=>c.complete(owner,completed(imageId),3,now));albumAwards.push(...result.catalog.albumRewards);
  }
  assert.deepEqual(albumAwards.map(a=>[a.target,a.coins]),[[3,30],[6,60]]);
  assert.equal(c.view(owner,now).albums[0].collected,6);
  assert.ok(c.view(owner,now).albums[0].milestones.every(m=>m.earned&&m.claimed&&!m.claimable));
  assert.equal(c.view(owner,now).decorations.find(d=>d.id===pack.decorationId).owned,true);
  const repeated=transaction(db,()=>c.complete(owner,completed(pack.imageIds[5]),150,now));
  assert.equal(repeated.fragments,10);
  assert.deepEqual(repeated.catalog.albumRewards,[]);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM mobile_collection_milestones WHERE owner=?').get(owner).n,2);
  assert.equal(c.view(owner,now).packs[0].owned,false,'collection is not ownership');
  const basic=GALLERY_VISIBLE_PHOTOS.find(photo=>c.randomAllowed(owner,photo.id));
  transaction(db,()=>c.complete(owner,completed(basic.id),3,now));
  assert.equal(c.view(owner,now).albums.find(a=>a.id==='everyday-gallery').collected,1);
  assert.equal(c.randomAllowed(owner,pack.imageIds[0]),false);
  assert.equal(c.randomAllowed(owner,basic.id),true);
 }finally{db.close();}
});

test('collection HTTP mutations are atomic, replay safe and enforce permanent public ownership plus private-room tickets',()=>{
 const h=harness(),a=identity('a'),b=identity('b'),pack=catalog.packs[0],craft=catalog.decorations.find(d=>d.source==='craft');
 try{
  const initial=h.call(a,'/api/mobile/collection');assert.equal(initial.status,200);assert.deepEqual(initial.data.wallet,{coins:0,fragments:0});
  const deniedBuy={packId:pack.id,requestId:rid()};
  assert.equal(h.call(a,'/api/mobile/collection/buy',deniedBuy).data.code,'COINS_INSUFFICIENT');
  assert.equal(h.call(a,'/api/mobile/collection/craft',{decorationId:craft.id,requestId:rid()}).data.code,'FRAGMENTS_INSUFFICIENT');
  assert.equal(h.fixture.prepare('SELECT COUNT(*) n FROM mobile_collection_ledger').get().n,0);
  assert.equal(h.fixture.prepare('SELECT COUNT(*) n FROM mobile_collection_owned').get().n,0);
  h.fixture.prepare("INSERT INTO mobile_collection_wallets VALUES(?,500,80,'berry-spark')").run(a);
  const bought=h.call(a,'/api/mobile/collection/buy',deniedBuy);
  assert.equal(bought.status,200);assert.equal(bought.data.wallet.coins,320);assert.equal(bought.data.profile.collection.ownedImageIds.length,6);
  assert.deepEqual(h.call(a,'/api/mobile/collection/buy',deniedBuy),bought);
  const buyAgain=h.call(a,'/api/mobile/collection/buy',{packId:pack.id,requestId:rid()});
  assert.equal(buyAgain.data.wallet.coins,320);assert.equal(buyAgain.data.purchase.alreadyOwned,true);
  assert.equal(h.call(a,'/api/mobile/collection/buy',{...deniedBuy,packId:catalog.packs[1].id}).data.code,'REQUEST_CONFLICT');
  const recipe={decorationId:craft.id,requestId:rid()},crafted=h.call(a,'/api/mobile/collection/craft',recipe);
  assert.equal(crafted.status,200);assert.equal(crafted.data.wallet.fragments,80-craft.cost);
  assert.deepEqual(h.call(a,'/api/mobile/collection/craft',recipe),crafted);
  assert.equal(h.call(a,'/api/mobile/collection/craft',{...recipe,requestId:rid()}).data.wallet.fragments,80-craft.cost);
  assert.equal(h.call(a,'/api/mobile/collection/equip',{decorationId:'rose-butterfly',requestId:rid()}).data.code,'DECORATION_NOT_OWNED');
  assert.equal(h.call(a,'/api/mobile/collection/equip',{decorationId:craft.id,requestId:rid()}).data.equipped.id,craft.id);
  const publicRoom=h.call(a,'/api/rooms',{mode:'selected',imageId:pack.imageIds[0],pieces:48,visibility:'public',requestId:rid()});
  assert.equal(publicRoom.status,201);
  assert.equal(publicRoom.data.room.members.find(m=>m.id===publicRoom.data.playerId).decoration.id,craft.id);
  assert.equal(h.call(a,'/api/mobile/profile').data.starterSelectionAvailable,false,'newcomers start without a free-selection allowance');
  assert.equal(h.call(a,'/api/mobile/profile').data.supply.create,3);
  assert.equal(h.call(b,'/api/rooms/'+publicRoom.data.room.id+'/join',{}).status,200,'nonowners can join');
  const privateInput={mode:'selected',imageId:pack.imageIds[0],pieces:48,visibility:'private',requestId:rid()};
  assert.equal(h.call(a,'/api/mobile/profile').data.supply.create,3,'the newcomer tickets are still unspent');
  assert.equal(h.call(a,'/api/rooms',privateInput).status,201,'the newcomer ticket covers the first private room');
  h.patch(a,{supply:{energy:0,create:0}});
  assert.equal(h.call(a,'/api/rooms',{...privateInput,requestId:rid()}).data.code,'CREATE_TICKET_REQUIRED');
  h.patch(a,{supply:{energy:0,create:1}});
  assert.equal(h.call(a,'/api/rooms',{...privateInput,requestId:rid()}).status,201);
  assert.equal(h.call(a,'/api/mobile/profile').data.supply.create,0);
  assert.equal(h.call(a,'/api/rooms',{mode:'selected',imageId:pack.imageIds[0],pieces:48,visibility:'public',requestId:rid()}).data.code,'ROOM_LIMIT');
  assert.equal(h.call(a,'/api/mobile/collection/equip',{decorationId:null,requestId:rid()}).data.equipped,null);
  const random=h.call(b,'/api/rooms',{mode:'random',pieces:48,visibility:'public',requestId:rid()});
  assert.equal(random.status,201);assert.ok(!catalog.packs.some(p=>p.imageIds.includes(random.data.room.puzzle.imageId)));
 }finally{h.close();}
});

test('server gameplay awards only valid contributions, rolls back empty-energy drops, and settles offline collaborators once',()=>{
 const h=harness(),a=identity('a'),b=identity('b'),watcher=identity('c'),pack=catalog.packs[0];
 try{
  // Selected images from a paid pack need the pack (PACK_LOCKED otherwise); this test is about contributions.
  h.fixture.prepare('INSERT INTO mobile_collection_owned VALUES(?,?,?,?)').run(a,'pack',pack.id,1800000000000);
  const created=h.call(a,'/api/rooms',{mode:'selected',imageId:pack.imageIds[0],pieces:48,visibility:'public',requestId:rid()});assert.equal(created.status,201);
  const ticket=created.data,path='/api/rooms/'+ticket.room.id,bt=h.call(b,path+'/join',{}).data;
  h.call(watcher,path+'/join',{});
  let current=ticket.room,successfulA=0,successfulB=0;const beginnerCoins={a:0,b:0};
  h.patch(a,{energy:0,energyAt:1800000000000,firstRoomCompleted:true});
  const initial=current.puzzle.groups.find(g=>!g.locked);
  assert.equal(h.call(a,path,{type:'claim',groupId:initial.id,requestId:rid()},ticket.token).status,200);
  const denied={type:'drop',groupId:initial.id,dx:0,dy:0,seq:1,requestId:rid()};
  assert.equal(h.call(a,path,denied,ticket.token).data.code,'ENERGY_EMPTY');
  assert.equal(h.call(a,'/api/mobile/collection').data.wallet.coins,0);
  assert.equal(h.call(a,'/api/mobile/profile').data.totalXp,0);
  h.patch(a,{energy:1000});
  let replayInput,replayResponse;
  while(current.completedAt===null){
   const actor=successfulA<3?a:b,admission=actor===a?ticket:bt,group=current.puzzle.groups.find(g=>!g.locked);
   const claim=h.call(actor,path,{type:'claim',groupId:group.id,requestId:rid()},admission.token);assert.equal(claim.status,200);
   const input={type:'drop',groupId:group.id,dx:0,dy:0,seq:1,requestId:rid()};
   const result=h.call(actor,path,input,admission.token);assert.equal(result.status,200);
   // One coin per valid contribution, plus the beginner milestone coins (10/50/100 total contributions) on the drop that reaches one.
   const total=(actor===a?successfulA:successfulB)+1,milestone=BEGINNER_TASKS.find(task=>task.target===total)?.coins??0;beginnerCoins[actor===a?'a':'b']+=milestone;
   assert.equal(result.data.mobileContribution.creditedCoins,1+milestone);
   assert.deepEqual(h.call(actor,path,input,admission.token),result,'same drop cannot award twice');
   if(actor===a){successfulA++;replayInput=input;replayResponse=result;if(successfulA===3)h.advance(ONLINE_MS+1);}else successfulB++;
   current=result.data;
  }
  assert.equal(successfulA,3);
  const ac=h.call(a,'/api/mobile/collection').data,bc=h.call(b,'/api/mobile/collection').data;
  assert.equal(ac.wallet.coins,successfulA+Math.ceil(successfulA*.5)+beginnerCoins.a);assert.equal(ac.wallet.fragments,1);
  assert.equal(bc.wallet.coins,successfulB+Math.ceil(successfulB*.5)+beginnerCoins.b);
  assert.equal(bc.wallet.fragments,Math.min(10,Math.max(1,Math.floor(successfulB/10))));
  assert.equal(ac.albums[0].images[0].collected,true,'offline contributor collects on completion');
  assert.equal(h.call(watcher,'/api/mobile/collection').data.wallet.coins,0);
  assert.equal(current.mobileResult.coins,Math.ceil(successfulB*.5));
  assert.equal(current.mobileResult.catalog.newlyCollected,true);
  assert.deepEqual(h.call(a,path,replayInput,ticket.token),replayResponse,'historical replay keeps original receipt');
  h.call(b,path,{type:'heartbeat'},bt.token);
  assert.deepEqual(h.call(a,'/api/mobile/collection').data.wallet,ac.wallet);
  assert.equal(h.fixture.prepare('SELECT COUNT(*) n FROM mobile_collection_completions').get().n,2);
  assert.equal(h.fixture.prepare('SELECT COUNT(*) n FROM mobile_collection_ledger WHERE source LIKE ?').get('contribution:%').n,successfulA+successfulB);
 }finally{h.close();}
});

test('legacy completed rooms receive no retroactive collection rewards',()=>{
 const db=new DatabaseSync(':memory:'),room=completed(catalog.packs[0].imageIds[0]),owner=identity('a');
 try{
  db.exec('CREATE TABLE mobile_rooms(id TEXT PRIMARY KEY,completed_at INTEGER)');
  db.prepare('INSERT INTO mobile_rooms VALUES(?,?)').run(room.id,room.completedAt);
  const c=createMobileCollection({db,photos:GALLERY_VISIBLE_PHOTOS});
  assert.equal(transaction(db,()=>c.complete(owner,room,100,room.completedAt+1)),null);
  assert.deepEqual(c.view(owner,room.completedAt).wallet,{coins:0,fragments:0});
  assert.equal(c.view(owner,room.completedAt).albums[0].collected,0);
  const fresh=completed(room.puzzle.imageId);
  const earned=transaction(db,()=>c.complete(owner,fresh,3,room.completedAt+1));
  assert.equal(earned.coins,2);
  db.prepare('INSERT INTO mobile_rooms VALUES(?,?)').run(fresh.id,fresh.completedAt);
  const restarted=createMobileCollection({db,photos:GALLERY_VISIBLE_PHOTOS});
  assert.deepEqual(restarted.complete(owner,fresh,3,room.completedAt+1),earned);
  assert.equal(restarted.summary(owner).coins,2);
 }finally{db.close();}
});

