import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {countsForDimensions,allowedPieceCounts,supportsPieceCount,maximumPieces,preferredPieceCount,NEW_GAME_LEVELS,HIGH_PIECES_PAUSED} from '../lib/piece-policy.ts';
import {PHOTOS,RESTORABLE_PHOTOS,latestPublishedPhoto} from '../lib/puzzle-catalog.ts';
import {LEVELS,SAVED_LEVELS,createPuzzle,restartPuzzle,restorePuzzle} from '../lib/puzzle-engine.ts';
import {makeRoom,addMember,applyAction} from '../lib/room-engine.ts';
import {puzzleImageSource} from '../lib/puzzle-image-source.ts';
import {roomImagePreload} from '../lib/room-image-preload.ts';
import {randomPhoto} from '../lib/random-photo.ts';
const large='mountain-lake-reflection-hd-v3',small='emerald-river-valley-native-v2';
test('four new-game choices retain legacy grids and reject remembered paused counts',()=>{
 assert.deepEqual(LEVELS.map(l=>l.count),[108,300,500,1000,2000,5000]);
 assert.deepEqual(NEW_GAME_LEVELS.map(l=>l.count),[108,300,500,1000]);
 for(const value of [null,'1500','2000','5000','no',5000])assert.equal(preferredPieceCount(value),300);
 for(const level of NEW_GAME_LEVELS)assert.equal(preferredPieceCount(String(level.count)),level.count);
 assert.deepEqual(countsForDimensions(1774,887),[108,300,500,1000]);
 assert.deepEqual(countsForDimensions(3144,1572),[108,300,500,1000]);
 assert.deepEqual(countsForDimensions(240,240),[108]);
 assert.deepEqual(countsForDimensions(NaN,887),[]);assert.deepEqual(allowedPieceCounts('unknown'),[]);
 assert.equal(countsForDimensions(1200,750).includes(1000),true);assert.equal(countsForDimensions(1199,750).includes(1000),false,'the square-body crop still requires 30 pixels per piece');
 assert.equal(countsForDimensions(30000,15000).includes(5000),false,'large native dimensions cannot bypass the operational limit');
});
test('all editions reject paused high counts while every allowed new-game option remains playable',()=>{
 for(const id of [small,large])for(const n of [2000,5000])assert.throws(()=>makeRoom('rejected',id,n,1000),{message:HIGH_PIECES_PAUSED});
 for(const n of [1500,3000,4000])assert.throws(()=>makeRoom('retired',large,n,1000));
 for(const id of [small,large])for(const n of allowedPieceCounts(id))assert.equal(makeRoom('allowed',id,n,1000).puzzle.groups.length,n);
 assert.equal(maximumPieces(small),1000);assert.equal(maximumPieces(large),1000);
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
 for(const level of NEW_GAME_LEVELS){const pool=PHOTOS.filter(p=>supportsPieceCount(p.id,level.count));assert.equal(pool.length,30);for(let i=0;i<pool.length;i++)assert.equal(randomPhoto(pool,()=> (i+.5)/pool.length).id,pool[i].id);}
 assert.equal(PHOTOS.length,30);for(const n of [2000,5000])assert.equal(PHOTOS.filter(p=>supportsPieceCount(p.id,n)).length,0);
 assert.equal(latestPublishedPhoto('mountain-lake-reflection').id,large);assert.equal(latestPublishedPhoto('mountain-lake-reflection-native-v2').id,large);
 const previous=RESTORABLE_PHOTOS.find(p=>p.id==='mountain-lake-reflection-native-v2');
 assert.equal(previous.playSrc,'/puzzles/mountain-lake-reflection-native-v2-play-05ac2f83031a.webp');
 assert.equal(previous.src,previous.optimizedSrc,'old room IDs retain their picture and use its same-dimension efficient derivative');
});
test('smaller games, original preview and SSR select one consistent delivery; private preload remains forbidden',()=>{
 const photo=PHOTOS.find(p=>p.id===large),smallPhoto=PHOTOS.find(p=>p.id===small);
 assert.equal(puzzleImageSource(photo,300),photo.optimizedStandardSrc);assert.equal(puzzleImageSource(photo,1000),photo.optimizedStandardSrc);
 for(const n of [2000,5000])assert.equal(puzzleImageSource(photo,n),photo.optimizedSrc);
 assert.equal(puzzleImageSource(smallPhoto,300),smallPhoto.optimizedSrc);
 assert.equal(puzzleImageSource({src:'/private'},300),'/private');
 assert.equal(puzzleImageSource({src:'/legacy-play',standardSrc:'/legacy-standard'},300),'/legacy-standard');
 assert.equal(puzzleImageSource({src:'/legacy-play',standardSrc:'/legacy-standard'},5000),'/legacy-play');
 const r=makeRoom('preload',large,300,1000);r.visibility='public';assert.equal(roomImagePreload(r,PHOTOS,1001),photo.optimizedStandardSrc);
 r.visibility='private';assert.equal(roomImagePreload(r,PHOTOS,1001),null);
 const record=JSON.parse(readFileSync('content/image-provenance/'+large+'.json','utf8'));
 assert.equal(record.delivery.standard.lossless,true);assert.equal(record.delivery.standard.downsampled,true);assert.ok(record.delivery.standard.bytes<record.delivery.play.bytes*.5);
 assert.equal(record.delivery.optimized.lossless,false);assert.equal(record.delivery.compact.lossless,false);
 assert.deepEqual([record.delivery.optimized.width,record.delivery.optimized.height],[record.delivery.play.width,record.delivery.play.height]);
 assert.ok(record.delivery.compact.bytes<record.delivery.standard.bytes*.5);assert.ok(record.delivery.optimized.bytes<record.delivery.play.bytes*.5);
});
