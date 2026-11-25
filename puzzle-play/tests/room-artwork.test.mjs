import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';
import {readFileSync} from 'node:fs';
import {runtimeAssets,CONTENT_RUNTIME_FILES} from '../scripts/release-files.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
const built=await build({absWorkingDir:root,stdin:{contents:'export * from "./lib/room-artwork";export {snapshot} from "./lib/room-engine";export {roomUpdate,applyRoomUpdate} from "./lib/room-sync";export {roomImagePreload} from "./lib/room-image-preload";',resolveDir:root,loader:'ts'},bundle:true,write:false,format:'esm',platform:'node',target:'es2022'});
const api=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'));
const registry=JSON.parse(readFileSync(new URL('../content/artwork-revisions.json',import.meta.url))),catalog=JSON.parse(readFileSync(new URL('../content/puzzle-catalog.json',import.meta.url)));
const id='lantern-market',legacy=registry.legacy[id],upgraded=registry.versions[id].find(item=>item.revision!==legacy.revision),photo={...catalog.find(p=>p.id===id),...upgraded,optimizedSrc:upgraded.src};
const room=(artwork)=>({id:'artwork-room',artwork,visibility:'public',puzzle:{version:1,layout:'square',imageId:id,cols:12,rows:9,seed:31,elapsed:0,groups:[{id:0,pieces:[0],dx:20,dy:30,locked:false}]},revision:0,createdAt:1000,expiresAt:20000,completedAt:null,startedAt:null,members:[],leases:{}});

test('a historic room keeps its old drawing after the live catalog changes, without mutating its puzzle',()=>{
 const old=room(),before=JSON.stringify(old);
 assert.deepEqual(api.resolveRoomArtwork(old,[photo]),legacy);
 assert.equal(api.roomArtworkPhoto(old,[photo]).src,legacy.src);
 assert.equal(api.roomArtworkPhoto(old,[photo]).optimizedSrc,legacy.src);
 assert.equal(api.roomImagePreload(old,[photo],2000),legacy.src);
 assert.equal(JSON.stringify(old),before);
 assert.deepEqual(api.currentRoomArtwork(photo,108),upgraded);
 assert.deepEqual(api.currentRoomArtwork(photo,108,true),legacy);
});

test('full snapshots and no-change deltas preserve the exact room version and existing groups',()=>{
 for(const artwork of [undefined,upgraded]){
  const source=room(artwork),before=JSON.stringify(source),snapshot=api.snapshot(source,2000),delta=api.roomUpdate(source,2100,0);
  assert.deepEqual(snapshot.artwork,artwork??legacy);assert.equal(delta.kind,'delta');assert.deepEqual(delta.artwork,snapshot.artwork);
  const applied=api.applyRoomUpdate(snapshot,delta);assert.deepEqual(applied.artwork,snapshot.artwork);assert.equal(applied.puzzle.groups,snapshot.puzzle.groups);
  assert.equal(JSON.stringify(source),before);
 }
});

test('room URLs, revisions and dimensions must exactly match the trusted image inventory',()=>{
 for(const edited of [{...upgraded,src:'https://untrusted.example/image.webp'},{...upgraded,src:'/api/user-images/private'},{...upgraded,revision:'a'.repeat(64)},{...upgraded,width:1},{...upgraded,thumbSrc:legacy.thumbSrc}]){
  assert.equal(api.trustedRoomArtwork(id,edited),undefined);
  assert.throws(()=>api.resolveRoomArtwork(room(edited),[photo]),/房间图片版本/);
 }
 assert.equal(api.trustedRoomArtwork('other-image',upgraded),undefined);
 assert.deepEqual(api.currentRoomArtwork({...photo,src:'https://untrusted.example',optimizedSrc:undefined},108),upgraded,'active delivery ignores client-like URL overrides');
 assert.throws(()=>api.currentRoomArtwork({id:'not-registered',src:'https://untrusted.example'},108),/交付登记/);
 assert.throws(()=>api.checkArtworkClient(room(upgraded),new Headers()),e=>e.status===409&&e.code==='ARTWORK_CLIENT_UPDATE_REQUIRED');
 assert.doesNotThrow(()=>api.checkArtworkClient(room(upgraded),new Headers({'X-Jigsaw-Artwork-Snapshot':'1'})));
 assert.doesNotThrow(()=>api.checkArtworkClient(room(),new Headers()));
});

test('release files retain old room images while selecting the new current catalog drawing',()=>{
 const urls=runtimeAssets([{...photo,playSrc:`/puzzles/${id}-play-0123456789ab.webp`}],{static:[]});
 for(const path of [legacy.src,legacy.thumbSrc,upgraded.src,upgraded.thumbSrc])assert.ok(urls.includes(path),path);
 assert.ok(CONTENT_RUNTIME_FILES.includes('content/artwork-revisions.json'));
 const base=catalog.find(p=>p.id===id),overlayUrls=runtimeAssets([base],{static:[]});
 assert.ok(overlayUrls.includes(upgraded.src),'the unchanged source catalog still packages the active overlay');
 assert.ok(overlayUrls.includes(upgraded.thumbSrc));
});

test('the active overlay changes only drawing delivery fields and leaves catalog objects unchanged',()=>{
 const source=catalog.find(p=>p.id===id),before=JSON.stringify(source),overlaid=api.activeArtworkPhoto(source);
 assert.equal(overlaid.id,source.id);assert.equal(overlaid.src,upgraded.src);assert.equal(overlaid.thumbSrc,upgraded.thumbSrc);assert.equal(overlaid.revision,upgraded.revision);assert.equal(overlaid.width,upgraded.width);
 assert.equal(overlaid.title,source.title);assert.equal(overlaid.status,source.status);assert.equal(overlaid.publishedAt,source.publishedAt);assert.equal(JSON.stringify(source),before);
 assert.deepEqual(api.currentRoomArtwork(source,108),upgraded,'new rooms select active artwork while catalog remains the old baseline');
 assert.deepEqual(api.currentRoomArtwork(source,108,true),legacy,'old clients stay on the legacy drawing');
});
