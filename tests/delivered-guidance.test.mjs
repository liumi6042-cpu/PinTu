import test from 'node:test';
import assert from 'node:assert/strict';
import {mergeDeliveredGuidance} from '../server/delivered-guidance.mjs';
import {gridForDimensions} from '../lib/piece-policy.ts';

test('a newly delivered daily image can pass the existing piece-resolution policy',()=>{
 const id='album-floating-breakfast-shop-05-20261020',seed={},result=mergeDeliveredGuidance(seed,[{id,width:1024,height:1536}]);
 assert.ok(gridForDimensions(result[id].width,result[id].height,108));assert.equal(seed[id],undefined);
});
test('invalid delivered dimensions never bypass the resolution floor or overwrite valid guidance',()=>{
 const seed={valid:{width:1024,height:1536}},result=mergeDeliveredGuidance(seed,[{id:'valid',width:-1,height:512},{id:'missing',width:undefined,height:512},{id:'tiny',width:16,height:16}]);
 assert.deepEqual(result.valid,seed.valid);assert.equal(result.missing,undefined);assert.equal(gridForDimensions(result.tiny.width,result.tiny.height,108),null);
});
test('updated image dimensions preserve editorial guidance and leave the source untouched',()=>{
 const seed={existing:{width:512,height:512,complexity:3,preferredCount:300,reason:'既有说明'}},result=mergeDeliveredGuidance(seed,[{id:'existing',width:1024,height:1536}]);
 assert.deepEqual(result.existing,{...seed.existing,width:1024,height:1536});assert.equal(seed.existing.width,512);
});
