import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createMobileService} from '../server/mobile-service.mjs';

function fixture(t){
 let now=Date.parse('2026-11-28T10:00:00Z');
 const dir=mkdtempSync(join(tmpdir(),'tuanzi-v2-')),databasePath=join(dir,'mobile.sqlite');
 const make=()=>createMobileService({now:()=>now,randomInt:min=>min,databasePath});
 let service=make();
 t.after(()=>{service.close();rmSync(dir,{recursive:true,force:true});});
 const owner=randomBytes(32).toString('hex');
 const callAs=(identity,url,body,method)=>service.handle({identity,url,method:method??(body===undefined?'GET':'POST'),body,artworkSnapshot:true});
 const okAs=(identity,url,body,method)=>{const r=callAs(identity,url,body,method);assert.ok([200,201].includes(r.status),JSON.stringify(r).slice(0,300));return r.data;};
 const call=(url,body,method)=>callAs(owner,url,body,method);
 const ok=(url,body,method)=>okAs(owner,url,body,method);
 return {owner,call,ok,callAs,okAs,newPlayer:()=>randomBytes(32).toString('hex'),restart:()=>{service.close();service=make();},advance:ms=>{now+=ms;}};
}

test('Tuanzi 2.0 state persists across restarts and shares main-game collection wallet coins idempotently',t=>{
 const f=fixture(t);
 const profile=f.ok('/api/mobile/profile');
 assert.equal(profile.capabilities.tuanziTravel,true);

 const init=f.ok('/api/mobile/tuanzi-v2/state');
 assert.equal(init.ok,true);
 assert.equal(init.state,null);
 assert.equal(init.coins,profile.collection.coins);

 // Earn coins from postcard puzzle -> reflects immediately in main-game profile.collection.coins
 const earn1=f.ok('/api/mobile/tuanzi-v2/wallet',{source:'puzzle:cn-hangzhou:24',delta:50});
 assert.equal(earn1.coins,init.coins+50);
 assert.equal(earn1.applied,50);
 assert.equal(earn1.profile.collection.coins,init.coins+50);

 // Replaying the exact same ledger source is idempotent (applied=0, balance unchanged)
 const replay=f.ok('/api/mobile/tuanzi-v2/wallet',{source:'puzzle:cn-hangzhou:24',delta:50});
 assert.equal(replay.coins,init.coins+50);
 assert.equal(replay.applied,0);

 // Spending coins deducts from the exact same main-game wallet
 const spend=f.ok('/api/mobile/tuanzi-v2/wallet',{source:'shop:bento:1',delta:-30});
 assert.equal(spend.coins,init.coins+20);
 assert.equal(spend.applied,-30);

 // Overspending returns 409 COINS_INSUFFICIENT
 const short=f.call('/api/mobile/tuanzi-v2/wallet',{source:'gacha:overspend',delta:-500});
 assert.equal(short.status,409);
 assert.equal(short.data.code,'COINS_INSUFFICIENT');

 // Syncing Tuanzi 2.0 state survives a full server restart
 const saved=f.ok('/api/mobile/tuanzi-v2/sync',{state:{version:4,sceneOverride:'sunset-veranda',chinaCollected:['cn-hangzhou','cn-lhasa']}});
 assert.equal(saved.ok,true);
 f.restart();
 const reloaded=f.ok('/api/mobile/tuanzi-v2/state');
 assert.deepEqual(reloaded.state,{version:4,sceneOverride:'sunset-veranda',chinaCollected:['cn-hangzhou','cn-lhasa']});
 assert.equal(reloaded.coins,init.coins+20);
});

test('Developed Tuanzi postcards unlock exclusively in owner gallery, allow free public rooms, let guests join, and carry obtainment hints',t=>{
 const f=fixture(t);
 const guest=f.newPlayer();
 const reqId=()=>randomBytes(16).toString('hex');

 // Before developing any postcard: neither owner nor guest sees Tuanzi postcards in gallery
 const galBefore=f.ok('/api/mobile/gallery');
 assert.deepEqual(galBefore.tuanziImageIds,[]);
 assert.ok(!galBefore.imageIds.includes('tuanzi-cn-hangzhou'));

 // Undeveloped postcard (received only, developed:false) does NOT unlock in gallery yet
 f.ok('/api/mobile/tuanzi-v2/sync',{state:{version:4,postcards:[{uid:'pc-1',templateId:'cn-hangzhou',developed:false}]}});
 assert.deepEqual(f.ok('/api/mobile/gallery').tuanziImageIds,[]);

 // Owner develops cn-hangzhou (24-piece completed) -> unlocks in owner gallery ONLY
 const synced=f.ok('/api/mobile/tuanzi-v2/sync',{state:{version:4,postcards:[{uid:'pc-1',templateId:'cn-hangzhou',developed:true}],unlockedMainGallery:['cn-hangzhou']}});
 assert.deepEqual(synced.unlockedImageIds,['tuanzi-cn-hangzhou']);

 const ownerGallery=f.ok('/api/mobile/gallery');
 assert.deepEqual(ownerGallery.tuanziImageIds,['tuanzi-cn-hangzhou']);
 assert.ok(ownerGallery.imageIds.includes('tuanzi-cn-hangzhou'));
 const hangzhouPhoto=ownerGallery.photos.find(p=>p.id==='tuanzi-cn-hangzhou');
 assert.ok(hangzhouPhoto);
 assert.equal(hangzhouPhoto.src,'/tuanzi-v2/assets/postcards/cn-hangzhou.webp');
 assert.match(hangzhouPhoto.tuanziOrigin,/团子去旅行/);

 // Guest does NOT see tuanzi-cn-hangzhou in their gallery and CANNOT create a room with it
 const guestGallery=f.okAs(guest,'/api/mobile/gallery');
 assert.deepEqual(guestGallery.tuanziImageIds,[]);
 assert.ok(!guestGallery.imageIds.includes('tuanzi-cn-hangzhou'));
 const blocked=f.callAs(guest,'/api/rooms',{mode:'selected',imageId:'tuanzi-cn-hangzhou',pieces:108,visibility:'public',requestId:reqId()});
 assert.equal(blocked.status,403);
 assert.equal(blocked.data.code,'TUANZI_POSTCARD_LOCKED');
 assert.match(blocked.data.error,/团子去旅行/);

 // Owner creates a FREE public 108-piece room (does not spend creation ticket or starter free choice!)
 const beforeProfile=f.ok('/api/mobile/profile');
 const created=f.ok('/api/rooms',{mode:'selected',imageId:'tuanzi-cn-hangzhou',pieces:108,visibility:'public',requestId:reqId()});
 assert.equal(created.room.puzzle.imageId,'tuanzi-cn-hangzhou');
 assert.equal(created.room.photo.src,'/tuanzi-v2/assets/postcards/cn-hangzhou.webp');
 assert.match(created.room.tuanziOrigin,/团子去旅行/);
 const afterProfile=f.ok('/api/mobile/profile');
 assert.equal(afterProfile.supply.create,beforeProfile.supply.create);
 assert.equal(afterProfile.starterSelectionAvailable,beforeProfile.starterSelectionAvailable);

 // Owner can also create 48 and 300 piece public rooms cleanly
 const created48=f.ok('/api/rooms',{mode:'selected',imageId:'tuanzi-cn-hangzhou',pieces:48,visibility:'public',requestId:reqId()});
 assert.equal(created48.room.requestedPieces,48);
 assert.ok(created48.room.puzzle.cols*created48.room.puzzle.rows>=48&&created48.room.puzzle.cols*created48.room.puzzle.rows<=56);
 const created300=f.ok('/api/rooms',{mode:'selected',imageId:'tuanzi-cn-hangzhou',pieces:300,visibility:'public',requestId:reqId()});
 assert.equal(created300.room.requestedPieces,300);
 assert.ok(created300.room.puzzle.cols*created300.room.puzzle.rows>=280);

 // Guest sees the owner's public Tuanzi room in Lobby with thumbnail & obtainment hint, and CAN join it!
 const lobby=f.okAs(guest,'/api/lobby?limit=16');
 const listed=lobby.rooms.find(r=>r.id===created.room.id);
 assert.ok(listed,'owner public Tuanzi room should appear in public lobby');
 assert.equal(listed.thumbSrc,'/tuanzi-v2/assets/postcards/cn-hangzhou.webp');
 assert.match(listed.tuanziOrigin,/团子去旅行/);

 const joined=f.okAs(guest,'/api/rooms/'+created.room.id+'/join',{requestId:reqId()});
 assert.equal(joined.room.id,created.room.id);
 assert.equal(joined.room.photo.src,'/tuanzi-v2/assets/postcards/cn-hangzhou.webp');
 assert.match(joined.room.tuanziOrigin,/团子去旅行/);

 // Random room creation NEVER selects a Tuanzi postcard
 const randomRoom=f.ok('/api/rooms',{mode:'random',pieces:48,visibility:'public',requestId:reqId()});
 assert.ok(!randomRoom.room.puzzle.imageId.startsWith('tuanzi-'));

 // Unlocked gallery persists across server restart
 f.restart();
 assert.deepEqual(f.ok('/api/mobile/gallery').tuanziImageIds,['tuanzi-cn-hangzhou']);
});
