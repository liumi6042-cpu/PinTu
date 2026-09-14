import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {countsForDimensions,allowedPieceCounts,supportsPieceCount,maximumPieces,preferredPieceCount,PIECE_RESOLUTION_ERROR} from '../lib/piece-policy.ts';
import {PHOTOS,RESTORABLE_PHOTOS,latestPublishedPhoto} from '../lib/puzzle-catalog.ts';
import {LEVELS,SAVED_LEVELS,createPuzzle,restartPuzzle,restorePuzzle} from '../lib/puzzle-engine.ts';
import {makeRoom,addMember,applyAction} from '../lib/room-engine.ts';
import {puzzleImageSource} from '../lib/puzzle-image-source.ts';
import {roomImagePreload} from '../lib/room-image-preload.ts';
import {randomPhoto} from '../lib/random-photo.ts';
const large='mountain-lake-reflection-hd-v3',small='emerald-river-valley-native-v2';
test('six clear choices, validated remembered preference and square crop resolution floor',()=>{
 assert.deepEqual(LEVELS.map(l=>l.count),[108,300,500,1000,2000,5000]);
 assert.equal(preferredPieceCount(null),300);assert.equal(preferredPieceCount('1500'),300);assert.equal(preferredPieceCount('5000'),5000);assert.equal(preferredPieceCount('no'),300);
 assert.deepEqual(countsForDimensions(1774,887),[108,300,500,1000]);
 assert.deepEqual(countsForDimensions(3144,1572),[108,300,500,1000,2000,5000]);
 assert.deepEqual(countsForDimensions(240,240),[108]);
 assert.deepEqual(countsForDimensions(NaN,887),[]);assert.deepEqual(allowedPieceCounts('unknown'),[]);
 assert.equal(countsForDimensions(1774,887).includes(2000),false,'portrait crop, not total megapixels, limits a square piece');
 assert.equal(countsForDimensions(3000,1500).includes(5000),true);assert.equal(countsForDimensions(2999,1500).includes(5000),false);
});
test('creation rejects unsupported resolution and retired counts while large editions can create all six',()=>{
 for(const n of [2000,5000])assert.throws(()=>makeRoom('rejected',small,n,1000),{message:PIECE_RESOLUTION_ERROR});
 for(const n of [1500,3000,4000])assert.throws(()=>makeRoom('retired',large,n,1000));
 for(const n of allowedPieceCounts(large))assert.equal(makeRoom('allowed',large,n,1000).puzzle.groups.length,n);
 assert.equal(maximumPieces(small),1000);assert.equal(maximumPieces(large),5000);
});
test('old low-resolution large rooms and all retired grids still restore, join, shuffle and restart',()=>{
 const now=100000,oldId='mountain-lake-reflection-native-v2';
 for(const n of [1500,2000,3000,4000,5000]){
  const level=SAVED_LEVELS.find(l=>l.count===n),state=restartPuzzle({...createPuzzle(oldId,12,9,1),cols:level.cols,rows:level.rows},1);
  state.elapsed=123;state.groups[0].locked=true;state.groups[0].dx=0;state.groups[0].dy=0;
  const room=makeRoom('old-'+n,small,108,now);room.puzzle=state;room.revision=17;
  const before=JSON.stringify(state),player=addMember(room,'player','Guest','digest',now);
  applyAction(room,player,{type:'heartbeat'},now+1);assert.equal(JSON.stringify(room.puzzle),before);
  assert.deepEqual(restorePuzzle(before,RESTORABLE_PHOTOS.map(p=>p.id)),state);
  applyAction(room,player,{type:'shuffle'},now+2);assert.equal(state.elapsed,123);assert.equal(state.imageId,oldId);assert.equal(state.groups[0].locked,true);
  const restarted=restartPuzzle(state,3);assert.equal(restarted.imageId,oldId);assert.equal(restarted.groups.length,n);
 }
});
test('filtered random pool covers all eligible pictures without selecting unavailable artwork',()=>{
 for(const level of LEVELS){const pool=PHOTOS.filter(p=>supportsPieceCount(p.id,level.count));assert.ok(pool.length);for(let i=0;i<pool.length;i++)assert.equal(randomPhoto(pool,()=> (i+.5)/pool.length).id,pool[i].id);}
 assert.equal(PHOTOS.length,30);assert.equal(PHOTOS.filter(p=>supportsPieceCount(p.id,5000)).length,3);
 assert.equal(latestPublishedPhoto('mountain-lake-reflection').id,large);assert.equal(latestPublishedPhoto('mountain-lake-reflection-native-v2').id,large);
 assert.equal(RESTORABLE_PHOTOS.find(p=>p.id==='mountain-lake-reflection-native-v2').src,'/puzzles/mountain-lake-reflection-native-v2-play-05ac2f83031a.webp');
});
test('smaller games, original preview and SSR select one consistent delivery; private preload remains forbidden',()=>{
 const photo=PHOTOS.find(p=>p.id===large),smallPhoto=PHOTOS.find(p=>p.id===small);
 assert.equal(puzzleImageSource(photo,300),photo.standardSrc);assert.equal(puzzleImageSource(photo,1000),photo.standardSrc);
 for(const n of [2000,5000])assert.equal(puzzleImageSource(photo,n),photo.src);
 assert.equal(puzzleImageSource(smallPhoto,300),smallPhoto.src);
 assert.equal(puzzleImageSource({src:'/private'},300),'/private');
 const r=makeRoom('preload',large,300,1000);r.visibility='public';assert.equal(roomImagePreload(r,PHOTOS,1001),photo.standardSrc);
 r.visibility='private';assert.equal(roomImagePreload(r,PHOTOS,1001),null);
 const record=JSON.parse(readFileSync('content/image-provenance/'+large+'.json','utf8'));
 assert.equal(record.delivery.standard.lossless,true);assert.equal(record.delivery.standard.downsampled,true);assert.ok(record.delivery.standard.bytes<record.delivery.play.bytes*.5);
});
