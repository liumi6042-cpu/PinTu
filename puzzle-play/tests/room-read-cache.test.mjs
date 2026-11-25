import test from 'node:test';
import assert from 'node:assert/strict';
import { RoomReadCache } from '../lib/room-read-cache.ts';
import { makeRoom } from '../lib/room-engine.ts';
test('read cache freezes nested state, isolates mutable work and evicts by room and byte limits',()=>{
 const cache=new RoomReadCache(2,200),first=makeRoom('a','seaside-native-v2',108,1);cache.put(first,100);
 assert.throws(()=>{cache.get('a').puzzle.groups[0].dx=999;},TypeError);const work=structuredClone(cache.get('a'));work.puzzle.groups[0].dx=999;assert.notEqual(cache.get('a').puzzle.groups[0].dx,999);
 cache.put(makeRoom('b','seaside-native-v2',108,1),100);cache.get('a');cache.put(makeRoom('c','seaside-native-v2',108,1),100);assert.equal(cache.get('b'),undefined);assert.ok(cache.get('a'));cache.put(makeRoom('d','seaside-native-v2',108,1),150);assert.equal(cache.get('a'),undefined);assert.ok(cache.get('d'));cache.put(makeRoom('huge','seaside-native-v2',108,1),201);assert.equal(cache.get('huge'),undefined);
});
