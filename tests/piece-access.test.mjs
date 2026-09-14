import test from 'node:test';
import assert from 'node:assert/strict';
import {requiresPieceAccount,PIECE_LOGIN_REQUIRED} from '../lib/piece-access.ts';
import {checkPieceCreation,checkPieceAdmission} from '../lib/room-piece-access.ts';
import {createPuzzle} from '../lib/puzzle-engine.ts';
import {accountReturnTo,accountLoginUrl,publicPuzzleReturnTo} from '../lib/account-return.ts';
test('high counts require an account for creation and first admission while existing identities survive',()=>{
 for(const count of [108,300]){assert.equal(requiresPieceAccount(count),false);assert.doesNotThrow(()=>checkPieceCreation(count));}
 for(const count of [500,1000,2000,5000]){assert.throws(()=>checkPieceCreation(count),{message:PIECE_LOGIN_REQUIRED,status:401});assert.doesNotThrow(()=>checkPieceCreation(count,'account'));}
 const room={puzzle:createPuzzle('test',25,20,1),members:[],ownerId:'guest:owner',admitted:{'guest:returning':true},participants:{'guest:contributor':'Friend'}};
 const before=JSON.stringify(room);assert.throws(()=>checkPieceAdmission(room,undefined,'guest:new'),{status:401});assert.throws(()=>checkPieceAdmission(room,undefined),{status:401});
 for(const identity of ['guest:owner','guest:returning','guest:contributor'])assert.doesNotThrow(()=>checkPieceAdmission(room,undefined,identity));
 assert.doesNotThrow(()=>checkPieceAdmission({...room,members:[{guestId:'guest:old-member'}]},undefined,'guest:old-member'));
 assert.doesNotThrow(()=>checkPieceAdmission(room,'free-account','free-account'));assert.equal(JSON.stringify(room),before);
});
test('login return preserves only validated public image/count selections',()=>{
 const path=publicPuzzleReturnTo('cel-rainy-bridge-v1',500);
 assert.equal(accountReturnTo(path),path);assert.equal(new URL(accountLoginUrl(path),'https://example.test').searchParams.get('returnTo'),path);
 for(const value of ['/gallery?mode=public&image=valid&pieces=500&next=https://evil.example','/gallery?mode=public&image=../admin&pieces=500','/gallery?mode=public&image=valid&pieces=5000','/gallery?mode=public&image=valid&pieces=500&pieces=300','/gallery?mode=private&image=valid&pieces=500'])assert.equal(accountReturnTo(value),null);
});
