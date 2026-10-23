import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdirSync,mkdtempSync,rmSync} from 'node:fs';
import {resolve} from 'node:path';
import {randomBytes} from 'node:crypto';
import {createMobileService} from '../server/mobile-service.mjs';

const rid=()=>randomBytes(16).toString('hex'),actor=n=>n.repeat(64);
function setup(){
 mkdirSync(resolve('work'),{recursive:true});const dir=mkdtempSync(resolve('work/mobile-player-card-')),databasePath=resolve(dir,'mobile.sqlite');
 let now=1800000000000;
 const service=createMobileService({databasePath,now:()=>now,randomInt:min=>min}),db=new DatabaseSync(databasePath);
 const call=(owner,url,body)=>service.handle({identity:owner,url,method:body===undefined?'GET':'POST',body:body===undefined?undefined:{requestId:rid(),...body}});
 const code=owner=>call(owner,'/api/mobile/profile').data.code;
 const card=(owner,peer,room='')=>call(owner,'/api/mobile/players/'+peer+'/card'+(room?'?room='+room:''));
 const snapshot=()=>({tables:db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map(({name})=>[name,db.prepare('SELECT * FROM "'+name+'"').all()]),changes:db.prepare('SELECT changes() n').get().n,version:db.prepare('PRAGMA data_version').get().data_version});
 return {db,call,code,card,snapshot,advance:()=>now+=70000,close(){db.close();service.close();rmSync(dir,{recursive:true,force:true});}};
}

test('player card reads unique collected pictures, owned packs, completed albums and admitted room contribution without writes',()=>{
 const f=setup(),a=actor('a'),b=actor('b'),outsider=actor('c');
 try{
  f.code(a);const bc=f.code(b),collection=f.call(b,'/api/mobile/collection').data,album=collection.albums[0];
  assert.ok(album.images.length);
  for(const image of album.images)f.db.prepare('INSERT INTO mobile_collection_artworks VALUES(?,?,?,?)').run(b,image.id,48,1800000000000);
  f.db.prepare('INSERT INTO mobile_collection_artworks VALUES(?,?,?,?)').run(b,album.images[0].id,96,1800000000000);
  f.db.prepare('INSERT INTO mobile_collection_owned VALUES(?,?,?,?)').run(b,'pack',album.id,1800000000000);
  const p=JSON.parse(f.db.prepare('SELECT data FROM mobile_profiles WHERE id=?').get(b).data);p.level=8;p.name='名片玩家';f.db.prepare('UPDATE mobile_profiles SET data=? WHERE id=?').run(JSON.stringify(p),b);
  const created=f.call(a,'/api/rooms',{mode:'random',pieces:48,visibility:'public'});assert.equal(created.status,201);
  const roomId=created.data.room.id,row=f.db.prepare('SELECT data FROM mobile_rooms WHERE id=?').get(roomId),room=JSON.parse(row.data);
  room.achievements??={contributors:{}};room.achievements.contributors[b]={count:17,days:[]};f.db.prepare('UPDATE mobile_rooms SET data=? WHERE id=?').run(JSON.stringify(room),roomId);
  f.advance();const before=f.snapshot(),result=f.card(a,bc,roomId);assert.equal(result.status,200);
  assert.deepEqual(result.data.player,{code:bc,name:'名片玩家',level:8,decoration:null});
  assert.deepEqual(result.data.stats,{completedPuzzles:album.images.length,ownedPacks:1,completedAlbums:1,roomContribution:17});
  assert.equal(result.data.relationship,'none');assert.deepEqual(f.snapshot(),before);
  assert.equal(f.card(outsider,bc,roomId).data.stats.roomContribution,0);assert.deepEqual(f.snapshot(),before);
  assert.equal(f.card(a,bc).data.stats.roomContribution,0);
  assert.equal(f.card(a,'000000000').status,400);assert.equal(f.card(a,'999999999').status,404);
  // An orphan social code must never allocate a missing profile.
  f.db.prepare('INSERT INTO mobile_social_players VALUES(?,?,?)').run(actor('d'),'123456789',0);const orphanBefore=f.snapshot();
  assert.equal(f.card(a,'123456789').status,404);assert.deepEqual(f.snapshot(),orphanBefore);
 }finally{f.close();}
});

test('player card relationships, bidirectional privacy and read rate limiting',()=>{
 const f=setup(),a=actor('a'),b=actor('b');
 try{
  const ac=f.code(a),bc=f.code(b);
  assert.equal(f.card(a,ac).data.relationship,'self');assert.equal(f.card(a,bc).data.relationship,'none');
  assert.equal(f.call(a,'/api/mobile/social/requests',{code:bc}).status,200);
  assert.equal(f.card(a,bc).data.relationship,'outgoing');assert.equal(f.card(b,ac).data.relationship,'incoming');
  assert.equal(f.call(b,'/api/mobile/social/requests/respond',{code:ac,accept:true}).status,200);
  assert.equal(f.card(a,bc).data.relationship,'friend');
  assert.equal(f.call(a,'/api/mobile/social/block',{code:bc}).status,200);
  const before=f.snapshot();assert.equal(f.card(a,bc).data.code,'PLAYER_BLOCKED');assert.equal(f.card(b,ac).data.code,'PLAYER_BLOCKED');assert.deepEqual(f.snapshot(),before);
  f.advance();let last;for(let i=0;i<61;i++)last=f.card(a,ac);
  assert.equal(last.status,429);assert.equal(last.data.code,'SEARCH_RATE_LIMIT');assert.deepEqual(f.snapshot(),before);
  f.advance();assert.equal(f.card(a,ac).status,200);assert.deepEqual(f.snapshot(),before);
 }finally{f.close();}
});
