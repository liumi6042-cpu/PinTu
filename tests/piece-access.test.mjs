import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {requiresPieceAccount,PIECE_LOGIN_REQUIRED} from '../lib/piece-access.ts';
import {checkPieceCreation} from '../lib/room-piece-access.ts';
import {accountReturnTo,accountLoginUrl,publicPuzzleReturnTo} from '../lib/account-return.ts';

test('high piece counts require an account only when creating a room',()=>{
 for(const count of [108,300]){assert.equal(requiresPieceAccount(count),false);assert.doesNotThrow(()=>checkPieceCreation(count));}
 for(const count of [500,1000,2000,5000]){assert.equal(requiresPieceAccount(count),true);assert.throws(()=>checkPieceCreation(count),{message:PIECE_LOGIN_REQUIRED,status:401});assert.doesNotThrow(()=>checkPieceCreation(count,'account'));}
 // Creation never depends on how many pieces an already-created room happens to have.
 assert.doesNotThrow(()=>checkPieceCreation(108));assert.throws(()=>checkPieceCreation(500),{status:401});
});

test('joining and playing are not gated by piece count or an account',()=>{
 const read=(relative)=>readFileSync(resolve(import.meta.dirname,relative),'utf8');
 const engine=read('../lib/room-piece-access.ts');
 assert.doesNotMatch(engine,/checkPieceAdmission/,'no admission check should remain in the piece-access engine');
 const join=read('../app/api/rooms/[id]/join/route.ts');
 assert.doesNotMatch(join,/checkPieceAdmission/,'the join route must not gate admission on piece count');
 assert.doesNotMatch(join,/requiresPieceAccount/,'the join route must not require an account for high piece counts');
 const app=read('../app/puzzle-app.tsx');
 assert.doesNotMatch(app,/requiresPieceAccount\(pieces\)/,'local play must not require an account for high piece counts');
});

test('login return preserves only validated public image/count selections',()=>{
 const path=publicPuzzleReturnTo('cel-rainy-bridge-v1',500);
 assert.equal(accountReturnTo(path),path);assert.equal(new URL(accountLoginUrl(path),'https://example.test').searchParams.get('returnTo'),path);
 for(const value of ['/gallery?mode=public&image=valid&pieces=500&next=https://evil.example','/gallery?mode=public&image=../admin&pieces=500','/gallery?mode=public&image=valid&pieces=5000','/gallery?mode=public&image=valid&pieces=500&pieces=300','/gallery?mode=private&image=valid&pieces=500'])assert.equal(accountReturnTo(value),null);
});
