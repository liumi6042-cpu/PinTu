import {test} from 'node:test';
import assert from 'node:assert/strict';
import {defs,hatchFurniture} from '../lib/courtyard-model.mjs';
test('all unowned types are preferred, with no house styles',()=>{const owned={};const count=Object.keys(defs).length;for(let i=0;i<count;i++){const id=hatchFurniture(owned,()=>.47);assert.ok(Object.hasOwn(defs,id));assert.equal(owned[id],undefined);owned[id]=1;}assert.equal(Object.keys(owned).length,count);assert.ok(Object.hasOwn(defs,hatchFurniture(owned,()=>.99)));});
test('only missing type is awarded regardless of random value',()=>{const owned=Object.fromEntries(Object.keys(defs).filter(id=>id!=='fern').map(id=>[id,10]));for(const n of [0,.2,.8,.999])assert.equal(hatchFurniture(owned,()=>n),'fern');});
