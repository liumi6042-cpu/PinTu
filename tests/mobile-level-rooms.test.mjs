import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {randomBytes} from 'node:crypto';
import {existsSync,mkdirSync,mkdtempSync,rmSync} from 'node:fs';
import {resolve,sep} from 'node:path';
import {createMobileService,mobileGridForPhoto} from '../server/mobile-service.mjs';
import {MOBILE_COLLECTION_CATALOG as catalog} from '../server/mobile-collection.mjs';
import {RESTORABLE_PHOTOS as photos} from '../outputs/mobile/engine.mjs';

const rid=()=>randomBytes(16).toString('hex'),owner='a'.repeat(64),peer='b'.repeat(64),pieces=[12,16,20,24,30,35],pack=catalog.packs[0];
const chapter=id=>({id,title:'章节 '+id,albumId:pack.id,pieces:[...pieces]});
const configuration=()=>({schema:'jigsaw-levels/v1',firstClearEnergy:30,chapters:[chapter('ch1'),chapter('ch2')]});
function fixture(t,options={}){
 const root=resolve('data');mkdirSync(root,{recursive:true});const dir=mkdtempSync(resolve(root,'mobile-level-rooms-test-')),databasePath=resolve(dir,'mobile.sqlite'),now=1800000000000;
 const service=createMobileService({databasePath,now:()=>now,randomInt:min=>min,levels:configuration(),...options}),db=new DatabaseSync(databasePath);
 t.after(()=>{db.close();service.close();assert.ok(dir.startsWith(root+sep));rmSync(dir,{recursive:true,force:true});});
 const call=(actor,url,body,token)=>service.handle({identity:actor,url,method:body===undefined?'GET':'POST',body,authorization:token?'Bearer '+token:undefined});
 const ok=(actor,url,body,token)=>{const result=call(actor,url,body,token);assert.ok(result.status===200||result.status===201,JSON.stringify(result));return result.data;};
 const stored=actor=>JSON.parse(db.prepare('SELECT data FROM mobile_profiles WHERE id=?').get(actor).data);
 const patch=(actor,changes)=>db.prepare('UPDATE mobile_profiles SET data=? WHERE id=?').run(JSON.stringify({...stored(actor),...changes}),actor);
 for(const actor of [owner,peer]){ok(actor,'/api/mobile/profile');patch(actor,{level:50,xp:0,totalXp:10000,energy:200,energyAt:now,firstRoomCompleted:true,firstRoomId:null,autoSupply:false,supply:{energy:0,create:0}});}
 const make=(levelId='ch1-1',actor=owner,input={})=>ok(actor,'/api/rooms',{mode:'level',levelId,requestId:rid(),...input});
 const room=ticket=>JSON.parse(db.prepare('SELECT data FROM mobile_rooms WHERE id=?').get(ticket.room.id).data);
 const patchRoom=(ticket,change)=>{const value=room(ticket);change(value);db.prepare('UPDATE mobile_rooms SET completed_at=?,closed_at=?,data=? WHERE id=?').run(value.completedAt,value.closedAt??null,JSON.stringify(value),value.id);};
 const clear=id=>db.prepare('INSERT INTO mobile_level_progress VALUES(?,?,?,?,?)').run(owner,id,'fixture-room',now,30);
 const events=kind=>db.prepare('SELECT owner,room_id,data FROM mobile_events WHERE kind=? ORDER BY id').all(kind).map(row=>({...row,data:JSON.parse(row.data)}));
 const finish=(ticket,actor=owner)=>{
  const path='/api/rooms/'+ticket.room.id,joined=actor===owner?ticket:ok(actor,path+'/join',{inviteCode:ticket.inviteCode});
  patchRoom(ticket,room=>{for(const group of room.puzzle.groups.slice(1)){group.locked=true;group.dx=0;group.dy=0;}});
  const groupId=room(ticket).puzzle.groups.find(group=>!group.locked).id;
  ok(actor,path,{type:'claim',groupId},joined.token);const result=ok(actor,path,{type:'drop',groupId,seq:1,dx:0,dy:0,requestId:rid()},joined.token);
  assert.ok(result.completedAt);return result;
 };
 return {db,service,now,call,ok,stored,patch,make,room,patchRoom,clear,events,finish};
}

test('level rooms reject unknown, unavailable and locked levels through create-room replay',t=>{
 const f=fixture(t);
 for(const [levelId,status,code]of [['missing',400,'INVALID_LEVEL'],['ch1-2',403,'LEVEL_LOCKED'],['ch2-1',403,'LEVEL_LOCKED']]){
  const result=f.call(owner,'/api/rooms',{mode:'level',levelId,requestId:rid()});assert.equal(result.status,status);assert.equal(result.data.code,code);
 }
 assert.equal(f.call(owner,'/api/rooms',{mode:'level',levelId:'ch1-1'}).data.code,'REQUEST_ID_REQUIRED');
 const unavailable=fixture(t,{levels:{...configuration(),chapters:[{...chapter('ch1'),albumId:'missing-album'}]}});
 const result=unavailable.call(owner,'/api/rooms',{mode:'level',levelId:'ch1-1',requestId:rid()});assert.equal(result.status,409);assert.equal(result.data.code,'LEVEL_UNAVAILABLE');
 assert.equal(f.db.prepare('SELECT COUNT(*) n FROM mobile_rooms').get().n,0);assert.equal(f.events('level-start').length,0);
});

test('level room fields use configuration, keep tickets and starter selection, and reuse only the owner room',t=>{
 const f=fixture(t);f.patch(owner,{starterSelectionAvailable:true});
 const input={pieces:500,visibility:'invalid',requestId:rid()},ticket=f.make('ch1-1',owner,input),room=f.room(ticket),photo=photos.find(photo=>photo.id===pack.imageIds[0]);
 assert.equal(room.mobileMode,'level');assert.equal(room.mobileLevelId,'ch1-1');assert.equal(room.mobilePieces,12);assert.equal(room.visibility,'private');assert.equal(room.title,photo.title);assert.equal(room.puzzle.imageId,photo.id);
 assert.equal(f.stored(owner).supply.create,0);assert.equal(f.stored(owner).starterSelectionAvailable,true);
 assert.equal(f.make('ch1-1',owner,input).room.id,room.id);assert.equal(f.make().room.id,room.id);
 assert.notEqual(f.make('ch1-1',peer).room.id,room.id);
 assert.deepEqual(f.events('level-start').map(event=>event.data),[{levelId:'ch1-1',pieces:12},{levelId:'ch1-1',pieces:12}]);
 assert.deepEqual(f.events('room-create')[0].data,{mode:'level',pieces:12,visibility:'private'});assert.equal(f.events('room-create').length,2);
 assert.equal(f.call(peer,'/api/rooms/'+room.id+'/join',{}).data.code,'INVITE_REQUIRED');
 const changed=f.call(owner,'/api/rooms',{mode:'level',levelId:'ch1-2',...input});assert.equal(changed.data.code,'REQUEST_CONFLICT');
});

test('completed, closed and expired level rooms are not reused',t=>{
 const f=fixture(t);
 for(const change of [room=>{room.completedAt=f.now;},room=>{room.closedAt=f.now;},room=>{room.expiresAt=f.now;}]){
  const ticket=f.make();f.patchRoom(ticket,change);assert.notEqual(f.make().room.id,ticket.room.id);
 }
 assert.equal(f.events('level-start').length,4);
});

test('level rooms bypass gallery visibility and paid pack locks using existing static artwork',t=>{
 assert.ok(pack.imageIds.length>=6);for(const imageId of pack.imageIds)assert.ok(existsSync(resolve('public','.'+photos.find(photo=>photo.id===imageId).src)));
 const album={...pack,showOnPc:false,showOnMobile:false,purchasable:true,price:180,coverImageId:null};
 const f=fixture(t,{albumContent:{read:()=>({albums:[album]})}});
 assert.equal(f.ok(owner,'/api/mobile/gallery').imageIds.includes(pack.imageIds[0]),false);
 assert.equal(f.make().room.puzzle.imageId,pack.imageIds[0]);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM mobile_collection_owned WHERE owner=?').get(owner).n,0);
 album.showOnMobile=true;const gallery=f.ok(peer,'/api/mobile/gallery');assert.ok(gallery.packedImageIds.includes(pack.imageIds[0]));assert.equal(gallery.freeImageIds.includes(pack.imageIds[0]),false);
 assert.equal(f.call(peer,'/api/rooms',{mode:'selected',imageId:pack.imageIds[0],pieces:48,requestId:rid()}).data.code,'PACK_LOCKED');
 assert.equal(f.make('ch1-1',peer).room.puzzle.imageId,pack.imageIds[0]);
});

test('level rooms neither consume the three-room allowance nor require an open slot',t=>{
 const f=fixture(t),level=f.make();f.clear('ch1-1');
 const make=()=>f.ok(owner,'/api/rooms',{mode:'random',pieces:48,visibility:'public',requestId:rid()});
 make();make();make();assert.equal(f.call(owner,'/api/rooms',{mode:'random',pieces:48,requestId:rid()}).data.code,'ROOM_LIMIT');
 assert.notEqual(f.make('ch1-2').room.id,level.room.id);assert.equal(f.make().room.id,level.room.id);
 assert.equal(f.stored(owner).supply.create,0);assert.equal(f.stored(owner).starterSelectionAvailable,false);
});

test('all six small grids satisfy count and pixel limits only in level mode; gallery grids stay unchanged',t=>{
 const f=fixture(t);
 for(let index=0;index<pieces.length;index++){
  const count=pieces[index],photo=photos.find(photo=>photo.id===pack.imageIds[index]),grid=mobileGridForPhoto(photo,count,'level');
  assert.ok(grid);assert.equal(grid.cols*grid.rows,grid.count);assert.ok(Math.abs(grid.count-count)<=count*.15);assert.ok(grid.pixels>=20);
  assert.equal(mobileGridForPhoto(photo,count),null);
  const ticket=f.make('ch1-'+(index+1));assert.equal(ticket.room.puzzle.cols*ticket.room.puzzle.rows,grid.count);f.clear('ch1-'+(index+1));
 }
 for(const photo of photos)for(const count of [48,108,300,500]){
  assert.deepEqual(mobileGridForPhoto(photo,count,'level'),mobileGridForPhoto(photo,count));
  const grid=mobileGridForPhoto(photo,count);if(grid){assert.ok(grid.count>=48&&grid.count<=500);assert.ok(Math.abs(grid.count-count)<=count*.15);assert.ok(grid.pixels>=(count<=108?20:30));}
 }
 assert.equal(mobileGridForPhoto({width:40,height:40},12,'level'),null);assert.equal(mobileGridForPhoto(photos[0],13,'level'),null);
 assert.equal(f.call(owner,'/api/rooms',{mode:'random',pieces:12,requestId:rid()}).data.code,'INVALID_ROOM_OPTIONS');
});

test('first clear adds 30 above the cap, replay adds none, and normal completion rewards remain',t=>{
 const f=fixture(t),ticket=f.make(),before=f.stored(owner).energy,result=f.finish(ticket),reward=result.profile.lastReward;
 assert.deepEqual(reward.levelClear,{levelId:'ch1-1',energy:30,firstClear:true,nextLevelId:'ch1-2'});
 assert.equal(result.profile.energy,before-reward.energySpent+reward.completion.energy+30);assert.ok(result.profile.energy>result.profile.energyCap);
 assert.equal(f.db.prepare('SELECT energy FROM mobile_level_progress WHERE owner=?').get(owner).energy,30);
 f.ok(owner,'/api/rooms/'+ticket.room.id,{type:'heartbeat'},ticket.token);assert.equal(f.events('level-clear').length,1);
 const replay=f.make(),replayBefore=f.stored(owner).energy;assert.notEqual(replay.room.id,ticket.room.id);
 const again=f.finish(replay),againReward=again.profile.lastReward;
 assert.deepEqual(againReward.levelClear,{levelId:'ch1-1',energy:0,firstClear:false,nextLevelId:'ch1-2'});
 assert.equal(again.profile.energy,replayBefore-againReward.energySpent+againReward.completion.energy);
 assert.equal(f.db.prepare('SELECT COUNT(*) n FROM mobile_level_progress WHERE owner=?').get(owner).n,1);
 assert.deepEqual(f.events('level-clear').map(event=>event.data),[{levelId:'ch1-1',firstClear:true,energy:30},{levelId:'ch1-1',firstClear:false,energy:0}]);
});

test('a helper completing the room clears only the offline owner even with no owner contribution',t=>{
 const f=fixture(t),ticket=f.make(),before=f.stored(owner).energy;
 f.ok(owner,'/api/rooms/'+ticket.room.id,{type:'leave'},ticket.token);const result=f.finish(ticket,peer),profile=f.ok(owner,'/api/mobile/profile');
 assert.deepEqual(profile.lastReward.levelClear,{levelId:'ch1-1',energy:30,firstClear:true,nextLevelId:'ch1-2'});assert.equal(profile.energy,before+30);
 assert.equal(result.profile.lastReward.levelClear,undefined);assert.ok(result.profile.lastReward.completion);assert.equal(result.profile.lastReward.completion.contribution,1);
 assert.equal(f.db.prepare('SELECT COUNT(*) n FROM mobile_level_progress WHERE owner=?').get(peer).n,0);
 assert.equal(f.db.prepare('SELECT COUNT(*) n FROM mobile_settlements WHERE owner=?').get(owner).n,0);
 assert.equal(f.events('level-clear')[0].owner,owner);assert.equal(f.events('room-complete')[0].owner,peer);
});

test('next level follows configured order across chapters and ends at null',t=>{
 const f=fixture(t);
 for(const [chapterId,nextLevelId]of [['ch1','ch2-1'],['ch2',null]]){
  for(let index=1;index<6;index++)f.clear(chapterId+'-'+index);
  const ticket=f.make(chapterId+'-6');f.finish(ticket,peer);assert.equal(f.stored(owner).lastReward.levelClear.nextLevelId,nextLevelId);
 }
});

test('offline contributing owner keeps both completion and level rewards when a helper finishes',t=>{
 const f=fixture(t),ticket=f.make(),before=f.stored(owner).energy;
 f.patchRoom(ticket,room=>{room.achievements={version:1,contributors:{[owner]:{count:1,days:[]}}};});
 f.finish(ticket,peer);const profile=f.ok(owner,'/api/mobile/profile');
 assert.ok(profile.lastReward.completion);assert.equal(profile.lastReward.completion.contribution,1);assert.equal(profile.lastReward.levelClear.energy,30);
 assert.equal(profile.energy,before+profile.lastReward.completion.energy+30);assert.equal(f.stored(peer).lastReward.levelClear,undefined);
});

test('web level completion records first clear without adding energy',t=>{
 const f=fixture(t,{runtimeProfile:'web'}),ticket=f.make(),before=f.stored(owner).energy,result=f.finish(ticket);
 assert.deepEqual(result.profile.lastReward.levelClear,{levelId:'ch1-1',energy:0,firstClear:true,nextLevelId:'ch1-2'});assert.equal(result.profile.energy,before);
 assert.equal(f.db.prepare('SELECT energy FROM mobile_level_progress WHERE owner=?').get(owner).energy,0);
});

test('level creation and events share the existing request transaction',t=>{
 const f=fixture(t),input={mode:'level',levelId:'ch1-1',requestId:rid()};
 f.db.exec("CREATE TRIGGER reject_receipt BEFORE INSERT ON mobile_requests BEGIN SELECT RAISE(ABORT,'synthetic receipt failure'); END");
 assert.equal(f.call(owner,'/api/rooms',input).status,500);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM mobile_rooms').get().n,0);assert.equal(f.events('level-start').length,0);
 f.db.exec('DROP TRIGGER reject_receipt');f.ok(owner,'/api/rooms',input);assert.equal(f.events('level-start').length,1);
});

test('failed progress write rolls back completion, rewards and events together',t=>{
 const f=fixture(t),ticket=f.make(),path='/api/rooms/'+ticket.room.id;
 f.patchRoom(ticket,room=>{for(const group of room.puzzle.groups.slice(1)){group.locked=true;group.dx=0;group.dy=0;}});
 const groupId=f.room(ticket).puzzle.groups.find(group=>!group.locked).id;
 f.ok(owner,path,{type:'claim',groupId},ticket.token);const before=f.stored(owner),input={type:'drop',groupId,seq:1,dx:0,dy:0,requestId:rid()};
 f.db.exec("CREATE TRIGGER reject_progress BEFORE INSERT ON mobile_level_progress BEGIN SELECT RAISE(ABORT,'synthetic progress failure'); END");
 assert.equal(f.call(owner,path,input,ticket.token).status,500);assert.deepEqual(f.stored(owner),before);assert.equal(f.room(ticket).completedAt,null);
 assert.equal(f.db.prepare('SELECT COUNT(*) n FROM mobile_settlements').get().n,0);assert.equal(f.events('room-complete').length,0);assert.equal(f.events('level-clear').length,0);
 f.db.exec('DROP TRIGGER reject_progress');assert.equal(f.ok(owner,path,input,ticket.token).profile.lastReward.levelClear.energy,30);
});
