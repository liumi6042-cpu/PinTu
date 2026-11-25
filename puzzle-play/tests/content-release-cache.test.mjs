import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {syncBuiltinESMExports} from 'node:module';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createManagedReleaseReader,readManagedRelease,contentJsonBytes,contentSha256,contentValueDigest,CONTENT_RELEASE_FILES} from '../server/content-release.mjs';

function fixture(){
 const root=fs.mkdtempSync(join(tmpdir(),'jigsaw-release-cache-'));fs.mkdirSync(join(root,'releases'));
 const publish=(releaseId,label=releaseId)=>{
  const directory=join(root,'releases',releaseId);fs.mkdirSync(directory);
  const schemas={albums:'jigsaw-albums/v1',daily:'jigsaw-daily-content/v2',gameSettings:'jigsaw-game-settings/v1',taskRewards:'jigsaw-task-rewards/v1'};
  const files=Object.entries(schemas).map(([key,schema])=>{
   const value={schema,label},bytes=contentJsonBytes({...value,configDigest:contentValueDigest(value)}),path=CONTENT_RELEASE_FILES[key];
   fs.writeFileSync(join(directory,path),bytes);return {path,bytes:bytes.length,sha256:contentSha256(bytes)};
  });
  const bytes=contentJsonBytes({schema:'jigsaw-managed-release/v1',releaseId,createdAt:'2026-10-16T00:00:00.000Z',sourceVersions:{draftId:'cache-test',draftRevision:1,gameRevision:1,taskRevision:1},files});
  fs.writeFileSync(join(directory,'manifest.json'),bytes);return {schema:'jigsaw-content-pointer/v1',releaseId,manifestSha256:contentSha256(bytes)};
 };
 return {root,publish,point:pointer=>fs.writeFileSync(join(root,'current.json'),contentJsonBytes(pointer)),close:()=>fs.rmSync(root,{recursive:true,force:true})};
}

test('unchanged version reuses one frozen typed snapshot without JSON reads; expiry revalidates',()=>{
 const f=fixture();let validations=0,clock=1000,reads=0;const original=fs.readFileSync;
 try{
  f.point(f.publish('a'));const reader=createManagedReleaseReader(f.root,{now:()=>clock,validate:release=>{validations++;return {releaseId:release.pointer.releaseId,documents:release.documents};}});
  const a=reader.read();fs.readFileSync=(...args)=>{reads++;return original(...args);};syncBuiltinESMExports();
  for(let i=0;i<20;i++)assert.equal(reader.read(),a);
  assert.equal(reads,0);assert.equal(validations,1);assert.ok(Object.isFrozen(a.documents.gameSettings));
  clock+=30000;assert.notEqual(reader.read(),a);assert.equal(validations,2);assert.ok(reads>0);
  const pure=readManagedRelease(f.root);assert.notEqual(readManagedRelease(f.root),pure,'pure preflight API always reads and validates');
 }finally{fs.readFileSync=original;syncBuiltinESMExports();f.close();}
});

test('pointer changes and rollback immediately validate a whole new snapshot',()=>{
 const f=fixture();let validations=0;
 try{
  const a=f.publish('a'),b=f.publish('b');f.point(a);const reader=createManagedReleaseReader(f.root,{validate:release=>{validations++;return release;}}),first=reader.read();
  f.point(b);assert.equal(reader.read().pointer.releaseId,'b');f.point(a);assert.equal(reader.read().pointer.releaseId,'a');assert.equal(validations,3);assert.equal(first.pointer.releaseId,'a');
 }finally{f.close();}
});

test('same-version tampering, corrupt pointer and failed replacement never reuse a successful snapshot',()=>{
 const f=fixture();
 try{
  const a=f.publish('a'),b=f.publish('b');f.point(a);const reader=createManagedReleaseReader(f.root);reader.read();
  const config=join(f.root,'releases/a/task-rewards.json'),original=fs.readFileSync(config);fs.appendFileSync(config,' ');assert.throws(()=>reader.read(),/文件校验不匹配/);
  fs.writeFileSync(config,original);assert.equal(reader.read().pointer.releaseId,'a');fs.writeFileSync(join(f.root,'current.json'),'bad');assert.throws(()=>reader.read(),/有效 JSON/);
  f.point(b);fs.unlinkSync(join(f.root,'releases/b/daily.json'));assert.throws(()=>reader.read());f.point(a);assert.equal(reader.read().pointer.releaseId,'a');
 }finally{f.close();}
});

test('a pointer changed while loading keeps that operation pinned and is never cached as its replacement',()=>{
 const f=fixture(),original=fs.readFileSync;let flipped=false;
 try{
  const a=f.publish('a'),b=f.publish('b');f.point(a);
  fs.readFileSync=function(path,...args){const bytes=original.call(this,path,...args);if(path===join(f.root,'current.json')&&!flipped){flipped=true;f.point(b);}return bytes;};syncBuiltinESMExports();
  const reader=createManagedReleaseReader(f.root);assert.equal(reader.read().pointer.releaseId,'a');assert.equal(reader.read().pointer.releaseId,'b');
 }finally{fs.readFileSync=original;syncBuiltinESMExports();f.close();}
});
