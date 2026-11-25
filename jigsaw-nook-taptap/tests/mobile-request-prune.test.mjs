import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {createMobileService} from '../server/mobile-service.mjs';

const HOUR=3600000,DAY=24*HOUR;

test('room-action receipts older than a day are pruned in small batches; other receipts and recent ones stay',async()=>{
 const dir=mkdtempSync(resolve(tmpdir(),'mobile-request-prune-')),databasePath=resolve(dir,'mobile.sqlite');let now=Date.parse('2026-10-30T08:00:00Z');
 const service=createMobileService({shareRewards:false,databasePath,now:()=>now,requestPruneBatch:2,requestPruneYieldMs:0,requestPruneStartMs:DAY});
 const db=new DatabaseSync(databasePath);
 try{
  assert.ok(db.prepare("SELECT 1 FROM pragma_index_list('mobile_requests') WHERE name='mobile_requests_created'").get(),'created_at index');
  const insert=db.prepare('INSERT INTO mobile_requests VALUES(?,?,?,?,?,?)');
  for(let index=0;index<5;index++)insert.run('owner-a','room-action:room-'+index,'old-'+index,'h','{"room":{}}',now-2*DAY-index);
  insert.run('owner-a','room-action:room-1','recent','h','{"room":{}}',now-HOUR);
  insert.run('owner-a','level-offline-clears','offline','h','{}',now-3*DAY);
  insert.run('owner-b','collection-buy','buy','h','{}',now-3*DAY);
  const first=service.pruneRequests(),again=service.pruneRequests();
  assert.equal(first,again,'a running sweep is shared, not started twice');
  assert.equal(await first,5);
  assert.deepEqual(db.prepare('SELECT request_id FROM mobile_requests ORDER BY request_id').all().map(row=>row.request_id),['buy','offline','recent']);
  now+=DAY;
  assert.equal(await service.pruneRequests(),1,'the recent receipt goes once it is older than a day');
  assert.deepEqual(db.prepare('SELECT request_id FROM mobile_requests ORDER BY request_id').all().map(row=>row.request_id),['buy','offline']);
 }finally{db.close();service.close();rmSync(dir,{recursive:true,force:true});}
});

test('every sweep deletes, also after sweeps that finished within one batch',async()=>{
 // Live 20261030..20261101 stopped pruning after the first sweep that needed only one batch.
 const dir=mkdtempSync(resolve(tmpdir(),'mobile-request-prune-')),databasePath=resolve(dir,'mobile.sqlite');let now=Date.parse('2026-10-31T17:00:00Z');
 const service=createMobileService({shareRewards:false,databasePath,now:()=>now,requestPruneBatch:4,requestPruneYieldMs:0,requestPruneStartMs:DAY});
 const db=new DatabaseSync(databasePath);
 try{
  const insert=db.prepare('INSERT INTO mobile_requests VALUES(?,?,?,?,?,?)'),count=()=>db.prepare('SELECT COUNT(*) n FROM mobile_requests').get().n;
  for(const [cycle,rows] of [2,3,9,1,0,4,2].entries()){
   for(let index=0;index<rows;index++)insert.run('owner-a','room-action:room','c'+cycle+'-'+index,'h','{"room":{}}',now-DAY-1-index);
   insert.run('owner-a','room-action:room','fresh-'+cycle,'h','{"room":{}}',now);
   assert.equal(await service.pruneRequests(),rows,'sweep '+(cycle+1));
   assert.equal(count(),cycle+1,'only the fresh receipts are left after sweep '+(cycle+1));
   now+=10*60000;
  }
 }finally{db.close();service.close();rmSync(dir,{recursive:true,force:true});}
});

test('the 10-minute timer keeps pruning without anyone calling pruneRequests',async()=>{
 const dir=mkdtempSync(resolve(tmpdir(),'mobile-request-prune-')),databasePath=resolve(dir,'mobile.sqlite');const now=Date.parse('2026-10-31T17:00:00Z');
 const service=createMobileService({shareRewards:false,databasePath,now:()=>now,requestPruneBatch:2000,requestPruneYieldMs:0,requestPruneStartMs:1,requestPruneMs:20});
 const db=new DatabaseSync(databasePath),wait=ms=>new Promise(done=>setTimeout(done,ms));
 try{
  const insert=db.prepare('INSERT INTO mobile_requests VALUES(?,?,?,?,?,?)'),old=()=>db.prepare('SELECT COUNT(*) n FROM mobile_requests WHERE created_at<?').get(now-DAY).n;
  for(let round=0;round<4;round++){
   for(let index=0;index<3;index++)insert.run('owner-a','room-action:room','r'+round+'-'+index,'h','{}',now-DAY-1);
   for(let tries=0;tries<100&&old();tries++)await wait(5);
   assert.equal(old(),0,'round '+round+' was pruned by the timer');
  }
 }finally{db.close();service.close();rmSync(dir,{recursive:true,force:true});}
});
