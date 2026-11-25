import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync,mkdtempSync,rmSync} from 'node:fs';
import {resolve} from 'node:path';
import {randomBytes} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {createMobileService} from '../server/mobile-service.mjs';
import {PHOTOS,photoGuidance,gridForDimensions,placedCount} from '../outputs/mobile/engine.mjs';

const rid=()=>randomBytes(16).toString('hex'),identity=()=>randomBytes(32).toString('hex');
const photo=PHOTOS.find(p=>p.galleryVisible!==false&&gridForDimensions(photoGuidance(p.id).width,photoGuidance(p.id).height,48).count===48);
function fixture(t){
 mkdirSync(resolve('work'),{recursive:true});
 const dir=mkdtempSync(resolve('work/mobile-room-action-receipts-')),databasePath=resolve(dir,'mobile.sqlite');let now=1800000000000;
 const service=createMobileService({databasePath,now:()=>now,randomInt:(_min,max)=>max-1}),db=new DatabaseSync(databasePath);
 t.after(()=>{db.close();service.close();rmSync(dir,{recursive:true,force:true});});
 const call=(actor,url,body,token)=>service.handle({identity:actor,url,method:body===undefined?'GET':'POST',body,authorization:token?'Bearer '+token:undefined});
 const ok=(...args)=>{const reply=call(...args);assert.ok([200,201].includes(reply.status),JSON.stringify(reply));return reply.data;};
 const player=()=>{const actor=identity();ok(actor,'/api/mobile/profile');const p=JSON.parse(db.prepare('SELECT data FROM mobile_profiles WHERE id=?').get(actor).data);db.prepare('UPDATE mobile_profiles SET data=? WHERE id=?').run(JSON.stringify({...p,level:50,xp:20,totalXp:12000,energy:1000,energyAt:now,firstRoomCompleted:true,autoSupply:false}),actor);return actor;};
 const room=actor=>ok(actor,'/api/rooms',{mode:'selected',imageId:photo.id,pieces:48,visibility:'public',requestId:rid()});
 const path=ticket=>'/api/rooms/'+ticket.room.id;
 const drop=(actor,ticket,groupId,requestId=rid())=>{ok(actor,path(ticket),{type:'claim',groupId},ticket.token);const input={type:'drop',groupId,dx:0,dy:0,seq:1,requestId};return {input,reply:ok(actor,path(ticket),input,ticket.token)};};
 const receipts=(actor,ticket)=>db.prepare('SELECT request_id,response FROM mobile_requests WHERE owner=? AND scope=? ORDER BY request_id').all(actor,'room-action:'+ticket.room.id);
 const rawRoom=ticket=>db.prepare('SELECT data FROM mobile_rooms WHERE id=?').get(ticket.room.id).data;
 return {db,call,ok,player,room,path,drop,receipts,rawRoom,tick:ms=>{now+=ms;}};
}
const balances=p=>({energy:p.energy,xp:p.xp,totalXp:p.totalXp,coins:p.collection.coins,giftProgress:p.giftProgress,giftCount:p.giftCount});

test('a drop keeps a small receipt and a retry returns the current room with the original contribution',t=>{
 const f=fixture(t),owner=f.player(),ticket=f.room(owner),[group]=ticket.room.puzzle.groups;
 const {input,reply}=f.drop(owner,ticket,group.id);
 assert.ok(reply.mobileContribution?.creditedXp>0,'the drop earned a contribution');
 const [row]=f.receipts(owner,ticket);
 assert.ok(row.response.length<300,'receipt is '+row.response.length+' bytes');
 assert.deepEqual(JSON.parse(row.response),{mobileContribution:reply.mobileContribution,receipt:1});
 const saved=f.rawRoom(ticket);f.tick(1000);
 const retried=f.ok(owner,f.path(ticket),input,ticket.token);
 assert.deepEqual(Object.keys(retried).sort(),Object.keys(reply).sort(),'same reply fields as the live drop');
 assert.deepEqual(retried.mobileContribution,reply.mobileContribution);
 assert.equal(retried.revision,reply.revision);assert.equal(placedCount(retried.puzzle),placedCount(reply.puzzle));
 assert.deepEqual(balances(retried.profile),balances(reply.profile),'nothing granted twice');
 assert.equal(f.rawRoom(ticket),saved,'the retry does not touch the room');
 assert.equal(f.receipts(owner,ticket).length,1);
 const conflict=f.call(owner,f.path(ticket),{...input,dx:5},ticket.token);
 assert.equal(conflict.status,409);assert.equal(conflict.data.code,'REQUEST_CONFLICT');
});

test('a late retry sees moves made after the original drop',t=>{
 const f=fixture(t),owner=f.player(),ticket=f.room(owner),[first,second]=ticket.room.puzzle.groups;
 const {input,reply}=f.drop(owner,ticket,first.id),later=f.drop(owner,ticket,second.id).reply;
 const retried=f.ok(owner,f.path(ticket)+'?since='+reply.revision,input,ticket.token);
 assert.equal(retried.revision,later.revision);
 assert.deepEqual(retried.mobileContribution,reply.mobileContribution);
 assert.deepEqual(balances(retried.profile),balances(later.profile));
});

test('receipts written before this change still replay exactly as stored',t=>{
 const f=fixture(t),owner=f.player(),ticket=f.room(owner),[group]=ticket.room.puzzle.groups;
 const {input,reply}=f.drop(owner,ticket,group.id),legacy=JSON.parse(JSON.stringify({...reply,legacyMarker:true}));
 f.db.prepare('UPDATE mobile_requests SET response=? WHERE owner=? AND request_id=?').run(JSON.stringify(legacy),owner,input.requestId);
 assert.deepEqual(f.ok(owner,f.path(ticket),input,ticket.token),legacy);
});

test('batched drops store receipts too and a retried batch reports the same contributions',t=>{
 const f=fixture(t),owner=f.player(),ticket=f.room(owner);
 const ops=ticket.room.puzzle.groups.slice(0,3).map(g=>({requestId:rid(),groupId:g.id,dx:0,dy:0}));
 const first=f.ok(owner,f.path(ticket),{type:'batch',ops,requestId:rid()},ticket.token);
 assert.equal(first.mobileContributions.length,3);
 for(const row of f.receipts(owner,ticket)){assert.ok(row.response.length<300);assert.equal(JSON.parse(row.response).receipt,1);}
 const again=f.ok(owner,f.path(ticket),{type:'batch',ops,requestId:rid()},ticket.token);
 assert.deepEqual(again.soloBatch,first.soloBatch);assert.deepEqual(again.mobileContributions,first.mobileContributions);
 assert.deepEqual(balances(again.profile),balances(first.profile));
 // A single drop retried with a batched op's fingerprint rebuilds the whole reply from its receipt.
 const single=f.ok(owner,f.path(ticket),{type:'drop',groupId:ops[0].groupId,dx:0,dy:0,seq:1,requestId:ops[0].requestId},ticket.token);
 assert.ok(single.puzzle&&single.profile);assert.deepEqual(single.mobileContribution,first.mobileContributions[0]);
});
