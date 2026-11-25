import test from 'node:test';
import assert from 'node:assert/strict';
import {createPostcardRooms,pendingPostcards,settlePostcard} from '../lib/postcard-play.ts';

const storageOf=()=>{const map=new Map();return {map,get:k=>map.get(k)??null,set:(k,v)=>map.set(k,v),remove:k=>map.delete(k)};};
let n=0;const randomId=()=>(++n).toString(16).padStart(32,'0');
const picture={cardId:'t1-1',imageId:'tuanzi-card-misty-pier',title:'雾湖小码头',src:'/puzzles/a.webp',thumbSrc:'/puzzles/b.webp',width:1536,height:1024,cols:6,rows:4,pieces:24};

test('postcard rooms write nothing until opened, then finish once and queue one completion',async()=>{
 const storage=storageOf(),rooms=createPostcardRooms({storage,now:()=>1000,randomId});
 assert.equal(storage.map.size,0,'starting the app writes nothing');
 const ticket=rooms.open(picture);assert.ok(rooms.isRoom(ticket.room.id));assert.equal(rooms.cardOf(ticket.room.id),'t1-1');
 assert.equal(ticket.room.requestedPieces,24);assert.equal(ticket.room.photo.src,'/puzzles/a.webp');
 assert.equal(rooms.open(picture).room.id,ticket.room.id,'an unfinished room is resumed');
 const url='http://x/h5/api/rooms/'+ticket.room.id,ops=ticket.room.puzzle.groups.map(g=>({groupId:g.id,dx:0,dy:0,requestId:randomId()}));
 const reply=await (await rooms.fetch(url,{method:'POST',body:JSON.stringify({type:'batch',ops})})).json();
 assert.ok(reply.completedAt);assert.equal(reply.soloBatch.applied.length,24);
 const pending=pendingPostcards(storage);assert.equal(pending.length,1);assert.equal(pending[0].cardId,'t1-1');assert.match(pending[0].requestId,/^[a-f0-9]{32}$/);
 await rooms.fetch(url,{method:'POST',body:JSON.stringify({type:'batch',ops})});assert.equal(pendingPostcards(storage).length,1,'queued once');
 settlePostcard(storage,'t1-1');assert.equal(pendingPostcards(storage).length,0);
 await assert.rejects(rooms.fetch('http://x/h5/api/rooms/'+'f'.repeat(32)),TypeError);
 assert.throws(()=>rooms.open({...picture,cols:0}),/不能拼/);
});
