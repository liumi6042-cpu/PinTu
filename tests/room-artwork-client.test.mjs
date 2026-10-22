import test from 'node:test';
import assert from 'node:assert/strict';
import {activeRoomPhoto} from '../mobile/room-photo.ts';
import {snapshot} from '../lib/room-engine.ts';
import {roomUpdate,applyRoomUpdate} from '../lib/room-sync.ts';
import {createPuzzle} from '../lib/puzzle-engine.ts';
import editions from '../content/artwork-revisions.json' with {type:'json'};

test('room image selection prefers the room edition without changing the live gallery',()=>{
 const current={id:'seaside',title:'海边',category:'风景',src:'/new.webp',thumbSrc:'/new-thumb.webp'};
 const old={revision:'old',src:'/old.webp',thumbSrc:'/old-thumb.webp',width:1400,height:1000};
 const chosen=activeRoomPhoto({puzzle:{imageId:'seaside'},artwork:old,photo:{...current,...old}},current);
 assert.equal(chosen.src,old.src);assert.equal(current.src,'/new.webp');assert.notEqual(chosen,current);
 assert.equal(activeRoomPhoto({puzzle:{imageId:'seaside'}},current),current);
 assert.equal(activeRoomPhoto({puzzle:{imageId:'seaside'},photo:{...current,id:'other'}},current),current);
});

test('full and delta snapshots retain artwork while saved groups and seeds stay identical',()=>{
 const artwork=editions.legacy['lantern-dance-v1'];
 const room={id:'a',puzzle:createPuzzle('lantern-dance-v1',12,9,42),artwork,revision:1,createdAt:1,expiresAt:1000,completedAt:null,members:[],leases:{}};
 const full=snapshot(room,10),before=JSON.stringify(room.puzzle),delta=roomUpdate(room,11,1);
 assert.deepEqual(full.artwork,artwork);assert.deepEqual(delta.artwork,artwork);assert.equal(delta.kind,'delta');
 assert.deepEqual(applyRoomUpdate(full,delta).artwork,artwork);assert.equal(JSON.stringify(room.puzzle),before);assert.equal(full.puzzle.seed,42);
 // The API resolves old room editions; the portable snapshot helper remains data-only.
 const unversioned={...room};delete unversioned.artwork;assert.equal(snapshot(unversioned,12).artwork,undefined);assert.equal(unversioned.artwork,undefined);
});
