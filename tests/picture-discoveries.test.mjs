import test from 'node:test';
import assert from 'node:assert/strict';
import {pictureDiscoveries,discoveryPieces,DiscoveryTracker} from '../lib/picture-discoveries.ts';
const detail=pictureDiscoveries['cat-lantern-market-v1'][0];
const state=()=>({imageId:'cat-lantern-market-v1',cols:20,rows:20,groups:[]});
const group=(pieces,locked=false)=>({id:pieces[0],pieces,locked,dx:100,dy:200});
test('only a fully assembled subject triggers, loose pieces and partial groups do not',()=>{
 const s=state(),ids=discoveryPieces(detail,20,20),t=new DiscoveryTracker(s);assert.ok(ids.length>1);t.observe(s);
 s.groups=ids.map(id=>group([id]));assert.deepEqual(t.observe(s),[]);
 s.groups=[group(ids.slice(1)),group([ids[0]])];assert.deepEqual(t.observe(s),[]);
 s.groups=[group(ids)];assert.equal(t.observe(s)[0].id,detail.id);assert.deepEqual(t.observe(s),[]);
});
test('separately locked pieces also reveal the subject; a reconnect never replays old discoveries',()=>{
 const s=state(),ids=discoveryPieces(detail,20,20),t=new DiscoveryTracker(s);t.observe(s);s.groups=ids.map(id=>group([id],true));assert.equal(t.observe(s)[0].id,detail.id);
 assert.deepEqual(new DiscoveryTracker(s).observe(s),[]);
 const restored=new DiscoveryTracker(state(),[detail.id]);restored.observe(state());assert.deepEqual(restored.observe(s),[]);
});
test('crop mapping supports all piece counts and skips subjects cropped out by old boards',()=>{
 for(const n of [10,17,22,32]){const ids=discoveryPieces(detail,n,n);assert.ok(ids.length);assert.ok(ids.every(id=>id>=0&&id<n*n));}
 assert.deepEqual(discoveryPieces(pictureDiscoveries['magic-treehouse-v1'][0],20,10),[]);
 const center={...detail,box:[.4,.4,.2,.2]};assert.ok(discoveryPieces(center,20,10).length);
 assert.deepEqual(new DiscoveryTracker({imageId:'unknown',cols:20,rows:20}).observe({groups:[]}),[]);
});
