import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { resolve } from 'node:path';
import { SqliteD1 } from '../server/sqlite.mjs';
import { createPuzzle } from '../lib/puzzle-engine.ts';
import { hintPieces,makeAssistanceGrant,localAssistanceKey } from '../lib/assistance-engine.ts';
import { activeAssistance,assistanceRemaining,assistanceLimit } from '../lib/assistance-policy.ts';

const db=new SqliteD1(':memory:',resolve('drizzle'));
globalThis.assistanceTestDb=db;
registerHooks({resolve(specifier,context,next){if(specifier==='cloudflare:workers')return {url:'assistance-test:db',shortCircuit:true};return next(specifier,context);},load(url,context,next){if(url==='assistance-test:db')return {format:'module',source:'export const env={PUZZLE_DB:globalThis.assistanceTestDb};',shortCircuit:true};return next(url,context);}});
const { grantRoomAssistance,roomAssistance }=await import('../lib/assistance-store.ts');
const state=()=>createPuzzle('test',12,9,77);

test('three numbered hints choose fresh unlocked and unheld pieces without changing puzzle state',()=>{
 const s=state();s.groups[0].locked=true;const before=structuredClone(s);
 assert.deepEqual(hintPieces(s,new Set([1]),[2,3]),[4,5,6]);assert.deepEqual(s,before);
 s.groups.forEach(g=>g.locked=true);s.groups[7].locked=false;assert.deepEqual(hintPieces(s),[7]);
 s.groups[7].locked=true;assert.throws(()=>makeAssistanceGrant([],'hint','x',s,1000),/没有可提示/);
});
test('local usage survives serialization, expires by time, and resets only for a new puzzle seed',()=>{
 const s=state(),grants=[];let now=1000;
 for(let n=0;n<3;n++){const g=makeAssistanceGrant(grants,'hint',String(n),s,now);grants.push(g);assert.equal(g.pieceIds.length,3);assert.equal(g.expiresAt,now+30000);assert.equal(makeAssistanceGrant(grants,'hint','repeated',s,now),g);now+=30001;}
 const saved=JSON.parse(JSON.stringify(grants));assert.equal(assistanceRemaining(saved,'hint'),0);assert.equal(activeAssistance(saved,'hint',now),undefined);assert.throws(()=>makeAssistanceGrant(saved,'hint','fourth',s,now),/次数已用完/);
 assert.equal(makeAssistanceGrant(saved,'hint','0',s,now).expiresAt,31000,'late retry never grants another window');
 assert.notEqual(localAssistanceKey(s),localAssistanceKey({...s,seed:78}));
 const one=makeAssistanceGrant([],'underlay','first',s,1000);assert.equal(assistanceRemaining([one],'underlay'),1);const two=makeAssistanceGrant([one],'underlay','second',s,31001);assert.equal(two.expiresAt,61001);assert.throws(()=>makeAssistanceGrant([one,two],'underlay','third',s,61002),/次数已用完/);
 assert.throws(()=>makeAssistanceGrant([],'reference','removed',s,1000),/功能已移除/);assert.throws(()=>makeAssistanceGrant([{requestId:'old',kind:'reference',expiresAt:31000,pieceIds:[]}],'reference','old',s,1000),/功能已移除/);
});
test('server atomic quotas, idempotent retries, identities, leases and cleanup',async()=>{
 const now=Date.now(),room={id:'a'.repeat(32),puzzle:state(),leases:{0:{playerId:'someone',expires:now+90000,seq:0}},revision:0,expiresAt:now+86400000};
 db.sql.prepare('INSERT INTO puzzle_rooms VALUES(?,?,?,?)').run(room.id,0,JSON.stringify(room),room.expiresAt);
 const original=JSON.stringify(room),all=await Promise.all(Array.from({length:12},(_,i)=>grantRoomAssistance(room,'alice','underlay',String(i),now)));
 assert.ok(all.every(g=>g.length===1));const first=(await roomAssistance(room.id,'alice'))[0];
 assert.equal((await grantRoomAssistance(room,'alice','underlay',first.requestId,now+90000))[0].expiresAt,first.expiresAt);
 assert.equal((await grantRoomAssistance(room,'alice','underlay','new',now+90000)).length,2);await assert.rejects(grantRoomAssistance(room,'alice','underlay','third',now+120001),/次数已用完/);
 assert.equal((await grantRoomAssistance(room,'bob','underlay','bob-1',now)).length,1);
 for(let i=0;i<3;i++){const grants=await grantRoomAssistance(room,'alice','hint','hint-'+i,now+i*30001);const hint=grants.find(g=>g.requestId==='hint-'+i);assert.equal(hint.pieceIds.length,3);assert.ok(!hint.pieceIds.includes(0));}
 await assert.rejects(grantRoomAssistance(room,'alice','hint','hint-4',now+100000),/次数已用完/);
 assert.equal(JSON.stringify(room),original);assert.equal(db.sql.prepare('SELECT data FROM puzzle_rooms WHERE id=?').get(room.id).data,original);
 db.sql.prepare('DELETE FROM puzzle_rooms WHERE id=?').run(room.id);assert.equal(db.sql.prepare('SELECT COUNT(*) n FROM puzzle_assistance_grants').get().n,0);
});
test('piece bands extend existing use history and enforce every new server limit',async()=>{
 for(const [cols,rows,underlay,hints] of [[12,9,2,3],[24,12,3,5],[19,26,4,8],[38,26,6,12],[100,50,6,12]]){
  const count=cols*rows;assert.equal(assistanceLimit('underlay',count),underlay);assert.equal(assistanceLimit('hint',count),hints);
  const puzzle={...state(),cols,rows},now=Date.now(),room={id:`tier${count}`,puzzle,leases:{},revision:0,expiresAt:now+86400000};
  db.sql.prepare('INSERT INTO puzzle_rooms VALUES(?,?,?,?)').run(room.id,0,JSON.stringify(room),room.expiresAt);
  for(const [kind,limit,oldLimit] of [['underlay',underlay,2],['hint',hints,3]]){
   const prior=Array.from({length:oldLimit},(_,i)=>({requestId:`old-${kind}-${i}`,kind,expiresAt:now-100+i,pieceIds:kind==='hint'?[i*3,i*3+1,i*3+2]:[]}));
   for(const g of prior)db.sql.prepare('INSERT INTO puzzle_assistance_grants VALUES(?,?,?,?,?,?)').run(room.id,'existing',g.requestId,kind,g.expiresAt,JSON.stringify(g.pieceIds));
   assert.equal(assistanceRemaining(prior,kind,count),limit-oldLimit,'old uses are counted, not reset');
   for(let i=oldLimit;i<limit;i++){
    const results=await Promise.all(Array.from({length:6},(_,j)=>grantRoomAssistance(room,'existing',kind,`new-${kind}-${i}-${j}`,now+i*30001)));
    assert.ok(results.every(result=>result.filter(g=>g.kind===kind).length===i+1));
   }
   await assert.rejects(grantRoomAssistance(room,'existing',kind,'over-'+kind,now+(limit+1)*30001),/次数已用完/);
   const history=await roomAssistance(room.id,'existing');assert.equal(history.filter(g=>g.kind===kind).length,limit);
   assert.deepEqual(history.filter(g=>g.kind===kind&&g.requestId.startsWith('old-')),prior);
   assert.equal((await grantRoomAssistance(room,'teammate',kind,'peer-'+kind,now)).filter(g=>g.kind===kind).length,1);
  }
 }
});

test.after(()=>{db.close();delete globalThis.assistanceTestDb;});
