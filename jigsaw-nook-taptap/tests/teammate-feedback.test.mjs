import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync,mkdirSync,rmSync} from 'node:fs';
import {resolve,sep} from 'node:path';
import {RoomClient} from '../lib/room-client.ts';
import {PuzzleBoard} from '../mobile/puzzle-board.ts';
import {createMobileService} from '../server/mobile-service.mjs';

const rid=()=>randomBytes(16).toString('hex'),owner='a'.repeat(64),peer='b'.repeat(64),now=1800000000000;
const paintFeedback=actor=>{const commands=[],context=new Proxy({},{get:(_target,key)=>(...args)=>commands.push({op:key,args}),set:()=>true});actor.board.drawSnapFeedback(context,Date.now()+40);return commands;};
async function fixture(t,{httpFallback=false}={}){
 mkdirSync(resolve('work'),{recursive:true});const folder=mkdtempSync(resolve('work/teammate-feedback-')),databasePath=resolve(folder,'synthetic.sqlite');
 const service=createMobileService({databasePath,now:()=>now,randomInt:min=>min}),db=new DatabaseSync(databasePath),actors=[];
 const call=(identity,path,body,token)=>service.handle({identity,url:path,method:body?'POST':'GET',body,authorization:token?'Bearer '+token:undefined,artworkSnapshot:true});
 const made=call(owner,'/api/rooms',{mode:'random',pieces:48,visibility:'public',requestId:rid()});assert.equal(made.status,201);
 const joined=call(peer,'/api/rooms/'+made.data.room.id+'/join',{});assert.equal(joined.status,200);
 const row=db.prepare('SELECT data FROM mobile_rooms WHERE id=?').get(made.data.room.id),room=JSON.parse(row.data);
 for(const group of room.puzzle.groups){group.dx=-700;group.dy=-700;}
 for(const group of room.puzzle.groups.filter(group=>group.id===0||group.id===1)){group.dx=120;group.dy=120;}
 db.prepare('UPDATE mobile_rooms SET data=? WHERE id=?').run(JSON.stringify(room),room.id);
 const until=async predicate=>{const deadline=Date.now()+2000;while(!predicate()){assert.ok(Date.now()<deadline,'room client must settle');await new Promise(resolve=>setTimeout(resolve,2));}};
 function actor(identity,admission){
  const context=service.realtime.subscribe({identity,roomId:room.id,authorization:'Bearer '+admission.token,artworkSnapshot:true}),handlers=new Set(),events=[],sounds=[],audio=[],frames=new Map();let frame=0;
  const ticket={...admission,room:structuredClone(call(identity,'/api/rooms/'+room.id,undefined,admission.token).data)};
  const stream={connected:true,actionsReady:!httpFallback,actionsDiagnosticOnly:false,pendingActionCount:0,...(!httpFallback?{sendAction:input=>Promise.resolve(service.realtime.writeAction(context,input))}:{}),subscribeRoom(fn){handlers.add(fn);return()=>handlers.delete(fn);},subscribeState(){return()=>{};}};
  const p={config:{id:'web'},createCanvas:()=>({width:1,height:1,getContext:()=>({})}),onHide:()=>()=>{},onShow:()=>()=>{},frame:fn=>{frames.set(++frame,fn);return frame;},cancelFrame:id=>frames.delete(id),playSound:url=>audio.push(url)};
  const client=new RoomClient(ticket,{realtime:stream,randomId:rid,hidden:()=>false,now:()=>now,fetch:async(path,input)=>{const result=call(identity,path,input?.body?JSON.parse(input.body):undefined,admission.token);return {ok:result.status<300,status:result.status,headers:{get:()=>null},json:async()=>result.data};},emit:(name,data)=>{events.push({name,data});if(name==='puzzle:successful-drop')board.confirmMobileContribution(data);}});
  const board=new PuzzleBoard(p,client.state,()=>{});board.soundUrl='synthetic-snap.wav';const play=board.playConnectionSound.bind(board);board.playConnectionSound=source=>{sounds.push(source);play(source);};
  const detach=client.attach(board),actor={identity,context,client,board,events,sounds,audio,detach,push(){const update=service.realtime.readRoom(context,null);for(const handler of handlers)handler(structuredClone(update));}};actors.push(actor);return actor;
 }
 const a=actor(owner,made.data),b=actor(peer,joined.data);await until(()=>a.client.snapshot.revision>=2&&b.client.snapshot.revision>=2);a.push();b.push();
 for(const actor of actors){actor.sounds.length=0;actor.audio.length=0;actor.board.flashes.length=0;actor.events.length=0;}
 t.after(()=>{for(const actor of actors){actor.detach();actor.board.destroy();service.realtime.disconnectActions(actor.context);}db.close();service.close();assert.ok(folder.startsWith(resolve('work')+sep));rmSync(folder,{recursive:true,force:true});});
 const drop=async(actor,groupId,dx,dy)=>{assert.equal(await actor.board.network.acquire(groupId),true);await actor.board.network.drop(groupId,dx,dy);};
 return {service,a,b,call,drop,until};
}

test('two real clients show a teammate merge and placement with one sound each, no repeated movement/push feedback or teammate XP',async t=>{
 const f=await fixture(t),before=f.call(owner,'/api/mobile/profile').data;
 await f.drop(f.b,0,120,120);f.a.push();
 assert.equal(f.a.board.flashes.length,1);assert.equal(f.a.board.flashes[0].local,false);assert.equal(f.a.board.flashes[0].xp,undefined);assert.deepEqual(f.a.sounds,['teammate']);assert.equal(f.a.audio.length,1);
 const painted=paintFeedback(f.a);assert.ok(painted.some(command=>command.op==='stroke'),'the actual canvas feedback painter emits the teammate outline');assert.equal(painted.some(command=>command.op==='fillText'&&/XP/.test(command.args[0])),false);assert.equal(painted.some(command=>command.op==='arc'),false,'teammate feedback keeps the quieter outline style');
 f.a.push();f.a.push();assert.equal(f.a.board.flashes.length,1);assert.equal(f.a.audio.length,1,'echoed pushes are silent');
 const flashes=f.a.board.flashes.length;await f.drop(f.b,0,200,200);f.a.push();assert.equal(f.a.board.flashes.length,flashes);assert.equal(f.a.audio.length,1,'ordinary group movement is silent');
 await f.drop(f.b,0,0,0);f.a.push();assert.equal(f.a.board.flashes.length,2);assert.equal(f.a.board.flashes.at(-1).local,false);assert.equal(f.a.board.flashes.at(-1).xp,undefined);assert.deepEqual(f.a.sounds,['teammate','teammate']);assert.equal(f.a.audio.length,2);
 f.a.push();assert.equal(f.a.audio.length,2);assert.equal(f.a.events.filter(event=>event.name==='puzzle:successful-drop').length,0,'a teammate push never emits an own reward');
 const after=f.call(owner,'/api/mobile/profile').data;assert.equal(after.totalXp,before.totalXp);assert.equal(after.energy,before.energy);assert.equal(after.collection.coins,before.collection.coins);
 assert.equal(f.b.sounds.filter(source=>source==='local').length,2,'the successful actor hears exactly one local sound for each success');assert.equal(f.b.sounds.filter(source=>source==='teammate').length,0,'own ACKs are not also classified as teammate sounds');
});

test('a local claim ACK carrying a teammate merge must play its teammate sound once before the duplicate push',async t=>{
 const f=await fixture(t);await f.drop(f.b,0,120,120);
 assert.equal(f.a.audio.length,0,'withhold the teammate push so the claim ACK is its first update');
 assert.equal(await f.a.board.network.acquire(2),true);
 assert.equal(f.a.board.flashes.length,1);assert.equal(f.a.board.flashes[0].local,false);assert.equal(f.a.board.flashes[0].xp,undefined);
 assert.deepEqual(f.a.sounds,['teammate'],'ACK snapshots must not swallow an unrelated teammate success');
 f.a.push();f.a.push();assert.equal(f.a.audio.length,1,'the later state push must not replay the ACK-carried teammate sound');
 assert.equal(f.a.events.filter(event=>event.name==='puzzle:successful-drop').length,0);f.a.board.network.release(2);await f.until(()=>!f.a.client.snapshot.leases[2]);
});

for(const httpFallback of [false,true])test(`${httpFallback?'HTTP fallback':'ordinary WS'} own nonconnecting drop ACK preserves an unrelated teammate sound without local XP or double sound`,async t=>{
 const f=await fixture(t,{httpFallback});assert.equal(await f.a.board.network.acquire(2),true);await f.drop(f.b,0,120,120);
 assert.equal(f.a.audio.length,0);await f.a.board.network.drop(2,400,400);
 assert.deepEqual(f.a.sounds,['teammate']);assert.equal(f.a.board.flashes.length,1);assert.equal(f.a.board.flashes[0].local,false);assert.equal(f.a.board.flashes[0].xp,undefined);assert.equal(f.a.events.filter(event=>event.name==='puzzle:successful-drop').length,0);
 f.a.push();assert.equal(f.a.audio.length,1);
});
