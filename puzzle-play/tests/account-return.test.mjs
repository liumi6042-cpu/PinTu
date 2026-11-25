import test from 'node:test';
import assert from 'node:assert/strict';
import {accountReturnTo,accountLoginUrl} from '../lib/account-return.ts';

test('sign-in returns to a specific solo route or device save, never an external URL',()=>{
 for(const path of ['/personal?mode=solo','/gallery?mode=solo','/room/'+'a'.repeat(32),'/personal/images','/membership/manage']){
  assert.equal(accountReturnTo(path),path);
  assert.equal(new URL(accountLoginUrl(path),'https://example.test').searchParams.get('returnTo'),path);
 }
 const resume='/gallery?'+new URLSearchParams({resume:'together-puzzle:v1:seaside:5000'});
 assert.equal(accountReturnTo(resume),resume);
 for(const path of [null,'https://example.com','//example.com','/\\example.com','javascript:alert(1)','/room/../admin','/gallery?resume=bad','/gallery?resume=together-puzzle:v1:seaside:108&next=https://example.com','/personal?mode=solo&next=/admin'])assert.equal(accountReturnTo(path),null);
});
