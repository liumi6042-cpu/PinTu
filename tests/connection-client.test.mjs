import test from 'node:test';
import assert from 'node:assert/strict';
import {RoomClient} from '../lib/room-client.ts';
import {makeRoom,addMember,applyAction,snapshot,RoomError} from '../lib/room-engine.ts';
import {PHOTOS} from '../lib/puzzle-catalog.ts';

test('only a confirmed local join/placement sounds, even when polling beats its response',async()=>{
 let time=Date.now(),sounds=0,failDrop=false;const flags=[];
 const room=makeRoom('a'.repeat(32),PHOTOS[0].id,108,time),me=addMember(room,'me','Me','me-token',time),other=addMember(room,'other','Other','other-token',time);
 room.puzzle.groups[0].dx=100;room.puzzle.groups[0].dy=100;room.puzzle.groups[1].dx=102;room.puzzle.groups[1].dy=100;
 const client=new RoomClient({token:'token',playerId:me.id,room:snapshot(room,time)});
 client.table={networkReady:true,cancelNetworkDrag(){},syncRemote(next,owners,protectedIds,feedback){flags.push(feedback);client.state.groups=structuredClone(next.groups);},playConnectionSound(){sounds++;}};
 client.request=async action=>{time+=10;if(action){if(action.type==='drop'&&failDrop)throw new RoomError('Test denied drop',409);applyAction(room,me,action,time);room.revision++;}const next=snapshot(room,time);if(action?.type==='drop')client.receive(next);return next;};
 assert.equal(await client.acquire(0),true);await client.drop(0,102,100);assert.equal(sounds,1,'joining two loose pieces sounds even without board placement');
 client.receive(snapshot(room,++time),true);assert.equal(sounds,1,'echo does not repeat the sound');
 applyAction(room,other,{type:'claim',groupId:2},++time);applyAction(room,other,{type:'drop',groupId:2,dx:0,dy:0,seq:1},++time);room.revision++;client.receive(snapshot(room,time));assert.equal(sounds,1,'teammate placement is silent');
 assert.equal(await client.acquire(3),true);await client.drop(3,450,370);assert.equal(sounds,1,'unconnected drops stay silent');
 assert.equal(await client.acquire(4),true);failDrop=true;await client.drop(4,0,0);assert.equal(sounds,1,'rejected drop stays silent');failDrop=false;
 client.connected=false;room.revision++;client.receive(snapshot(room,++time),true);assert.equal(flags.at(-1),false,'reconnecting does not replay earlier glows');
 client.stop();
});
