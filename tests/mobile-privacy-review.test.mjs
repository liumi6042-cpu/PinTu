import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {createHash} from 'node:crypto';
import {existsSync,mkdirSync,mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {createMobilePrivacy} from '../server/mobile-privacy.mjs';
import {mobilePrivacyReview} from '../scripts/mobile-privacy-review.mjs';

const requestId='1'.repeat(32),owner='a'.repeat(64),code='B'.repeat(20);
const digest=path=>createHash('sha256').update(readFileSync(path)).digest('hex');
function fixture(){
 const root=resolve('work');mkdirSync(root,{recursive:true});const directory=mkdtempSync(resolve(root,'privacy-review-test-'));
 assert.ok(directory.startsWith(root+'\\'));
 const path=resolve(directory,'mobile.sqlite'),db=new DatabaseSync(path);createMobilePrivacy({db});
 db.prepare('INSERT INTO mobile_privacy_requests VALUES(?,?,?,?,?,?,?)').run(requestId,owner,'delete',code,'pending',1,1);
 db.prepare('INSERT INTO mobile_privacy_requests VALUES(?,?,?,?,?,?,?)').run('2'.repeat(32),'c'.repeat(64),'access','D'.repeat(20),'in_review',2,3);
 db.prepare('INSERT INTO mobile_privacy_requests VALUES(?,?,?,?,?,?,?)').run('3'.repeat(32),'e'.repeat(64),'delete','F'.repeat(20),'fulfilled',3,4);
 db.exec('CREATE TABLE mobile_profiles(id TEXT PRIMARY KEY,data TEXT); CREATE TABLE mobile_private_messages(sender TEXT,recipient TEXT,data TEXT);');
 db.prepare('INSERT INTO mobile_profiles VALUES(?,?)').run(owner,JSON.stringify({secret:'SESSION_NEVER_PRINT',name:'昵称不输出'}));
 db.prepare('INSERT INTO mobile_private_messages VALUES(?,?,?)').run(owner,'unrelated','PRIVATE_BODY_NEVER_PRINT');
 db.prepare('INSERT INTO mobile_private_messages VALUES(?,?,?)').run('unrelated','unrelated','not owner');db.close();
 return {path,directory,cleanup:()=>rmSync(directory,{recursive:true,force:true})};
}

test('list exposes only pending review metadata and review exposes only association counts without changing the database',()=>{
 const f=fixture();try{
  const before=digest(f.path),list=mobilePrivacyReview(['--db',f.path,'list']);
  assert.equal(list.ok,true);assert.equal(list.requests.length,2);
  assert.deepEqual(Object.keys(list.requests[0]),['requestId','type','status','createdAt','updatedAt']);
  assert.ok(!JSON.stringify(list).includes(owner));assert.ok(!JSON.stringify(list).includes(code));
  const result=mobilePrivacyReview(['review','--db',f.path,'--request-id',requestId,'--verification-code',code.toLowerCase()]);
  assert.equal(result.matched,true);assert.equal(result.counts.mobile_profiles,1);assert.equal(result.counts.mobile_private_messages,1);assert.equal(result.counts.mobile_friends,null);
  assert.deepEqual(Object.keys(result),['ok','matched','counts']);
  for(const sensitive of [owner,code,'SESSION_NEVER_PRINT','PRIVATE_BODY_NEVER_PRINT'])assert.ok(!JSON.stringify(result).includes(sensitive));
  assert.equal(digest(f.path),before);
 }finally{f.cleanup();}
});

test('CLI requires an existing absolute database path and returns a generic mismatch without creating a new database',()=>{
 const f=fixture();try{
  const missing=resolve(f.directory,'must-not-create.sqlite');
  const nonexistent=spawnSync(process.execPath,['scripts/mobile-privacy-review.mjs','--db',missing,'list'],{cwd:resolve('.'),encoding:'utf8'});
  assert.equal(nonexistent.status,1);assert.equal(JSON.parse(nonexistent.stdout).ok,false);assert.equal(existsSync(missing),false);
  assert.equal(mobilePrivacyReview(['list','--db','relative.sqlite']).ok,false);
  const wrong=mobilePrivacyReview(['review','--db',f.path,'--request-id',requestId,'--verification-code','0'.repeat(20)]);
  const malformed=mobilePrivacyReview(['review','--db',f.path,'--request-id','invalid','--verification-code',code]);
  assert.deepEqual(wrong,malformed);
  const before=digest(f.path),successful=spawnSync(process.execPath,['scripts/mobile-privacy-review.mjs','list','--db',f.path],{cwd:resolve('.'),encoding:'utf8'});
  assert.equal(successful.status,0);assert.equal(JSON.parse(successful.stdout).requests.length,2);assert.equal(digest(f.path),before);
 }finally{f.cleanup();}
});
