import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdir,mkdtemp,readFile,writeFile,rm,readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createServer } from 'node:http';
import { createBackup,verifyBackup,restoreBackup,pruneAutomatic } from '../scripts/database-backup.mjs';
import { TokenBuckets,createGateway,routeName } from '../scripts/local-gateway.mjs';
const work=fileURLToPath(new URL('../work/infrastructure-tests/',import.meta.url));
test('online SQLite backup includes committed WAL data, restores after verification, and preserves a rescue copy',async()=>{
 await mkdir(work,{recursive:true});const root=await mkdtemp(path.join(work,'backup-')),dataRoot=path.join(root,'data');await mkdir(dataRoot);let db;
 try{db=new DatabaseSync(path.join(dataRoot,'puzzle.sqlite'));db.exec('PRAGMA journal_mode=WAL; CREATE TABLE progress (id INTEGER PRIMARY KEY,value TEXT); INSERT INTO progress VALUES (1,\'saved\');');
  const snapshot=await createBackup(root,{dataRoot});assert.equal((await verifyBackup(snapshot)).files.length,1);db.prepare('UPDATE progress SET value=?').run('newer');
  await assert.rejects(restoreBackup(root,snapshot,{dataRoot,confirm:true,isRunning:async()=>true}),/关闭/);db.close();db=null;
  const restored=await restoreBackup(root,snapshot,{dataRoot,confirm:true,isRunning:async()=>false});assert.ok(restored.emergency);db=new DatabaseSync(path.join(dataRoot,'puzzle.sqlite'));assert.equal(db.prepare('SELECT value FROM progress').get().value,'saved');db.close();db=null;
  const rescue=new DatabaseSync(path.join(restored.emergency,'puzzle.sqlite'));assert.equal(rescue.prepare('SELECT value FROM progress').get().value,'newer');rescue.close();
  const file=path.join(snapshot,'puzzle.sqlite'),bytes=await readFile(file);bytes[bytes.length-1]^=1;await writeFile(file,bytes);await assert.rejects(verifyBackup(snapshot),/校验/);
  const manifest=JSON.parse(await readFile(path.join(snapshot,'manifest.json'),'utf8'));manifest.files[0].path='../outside.sqlite';await writeFile(path.join(snapshot,'manifest.json'),JSON.stringify(manifest));await assert.rejects(verifyBackup(snapshot),/路径/);
 }finally{db?.close();assert.ok(path.relative(work,root).startsWith('backup-'));await rm(root,{recursive:true});}
});
test('automatic retention removes only verified automatic snapshots and keeps manual backups',async()=>{
 await mkdir(work,{recursive:true});const root=await mkdtemp(path.join(work,'backup-')),dataRoot=path.join(root,'data');await mkdir(dataRoot);const db=new DatabaseSync(path.join(dataRoot,'test.sqlite'));db.exec('CREATE TABLE keep_me(x)');db.close();
 try{const manual=await createBackup(root,{dataRoot});for(let i=0;i<3;i++)await createBackup(root,{dataRoot,kind:'automatic',now:new Date(100000+i*86400000)});await pruneAutomatic(root,2);assert.equal((await readdir(path.join(root,'work/backups/automatic'))).length,2);await verifyBackup(manual);}finally{assert.ok(path.relative(work,root).startsWith('backup-'));await rm(root,{recursive:true});}
});
test('token buckets recover gradually and cannot grow without a bound',()=>{const b=new TokenBuckets({maxKeys:2});assert.equal(b.take('a',2,2,0),0);assert.equal(b.take('a',2,2,0),0);assert.equal(b.take('a',2,2,0),1);assert.equal(b.take('a',2,2,500),0);b.take('b',1,1,500);assert.equal(b.take('c',1,1,500),5);assert.equal(b.buckets.size,2);assert.equal(routeName('GET','/api/rooms/'+'a'.repeat(32)),'GET /api/rooms/:id');});
test('LAN gateway preserves origin and cookies, limits bursts independently, bounds request bodies and redacts metrics',async()=>{
 let handled=0;const backend=createServer((req,res)=>{handled++;let body='';req.on('data',b=>body+=b);req.on('end',()=>{res.writeHead(req.url==='/api/fail'?503:200,{'Content-Type':'application/json','Set-Cookie':'puzzle_guest=dummy; HttpOnly'});res.end(JSON.stringify({host:req.headers.host,origin:req.headers.origin,forwarded:req.headers['x-forwarded-for'],body}));});});
 await new Promise(resolve=>backend.listen(0,'127.0.0.1',resolve));const {server,metrics}=createGateway({upstreamPort:backend.address().port});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base='http://127.0.0.1:'+server.address().port,room='/api/rooms/'+'b'.repeat(32);
 try{const r=await fetch(base+room,{method:'POST',headers:{Origin:base,'Content-Type':'application/json','X-Forwarded-For':'forged','Cookie':'puzzle_guest='+'a'.repeat(64)},body:'{"type":"heartbeat"}'});assert.equal(r.status,200);assert.ok(r.headers.get('set-cookie'));const data=await r.json();assert.equal(data.host,new URL(base).host);assert.equal(data.origin,base);assert.equal(data.forwarded,undefined);
 const responses=await Promise.all(Array.from({length:40},()=>fetch(base+room,{headers:{Authorization:'Bearer '+'c'.repeat(32)}})));const blocked=responses.find(r=>r.status===429);assert.ok(blocked);assert.ok(Number(blocked.headers.get('retry-after'))>=1);await Promise.all(responses.map(r=>r.text()));
 assert.equal((await fetch(base+room,{headers:{Authorization:'Bearer '+'d'.repeat(32)}})).status,200);
 const before=handled;assert.equal((await fetch(base+'/api/rooms',{method:'POST',body:'x'.repeat(4097)})).status,413);assert.equal(handled,before);
 assert.equal((await fetch(base+'/api/fail')).status,503);const snapshot=metrics.snapshot();assert.equal(snapshot.errors5xx,1);assert.ok(snapshot.limited>0);const serialized=JSON.stringify(snapshot);assert.ok(!serialized.includes('b'.repeat(32)));assert.ok(!serialized.includes('dummy'));assert.ok(!serialized.includes('forged'));
 }finally{await new Promise(resolve=>server.close(resolve));await new Promise(resolve=>backend.close(resolve));}
});
