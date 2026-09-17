import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {countsForDimensions,allowedPieceCounts,supportsPieceCount,maximumPieces,preferredPieceCount,NEW_GAME_LEVELS,HIGH_PIECES_PAUSED,gridForDimensions,dynamicCountsForDimensions,minPixelsForCount,pieceBand,bandForGrid,bandLabel,PIECE_RESOLUTION_ERROR} from '../lib/piece-policy.ts';
import {PHOTOS,RESTORABLE_PHOTOS,latestPublishedPhoto} from '../lib/puzzle-catalog.ts';
import {LEVELS,SAVED_LEVELS,createPuzzle,createFittedPuzzle,restartPuzzle,restorePuzzle,knownGrid,fittedGrid} from '../lib/puzzle-engine.ts';
import {makeRoom,addMember,applyAction} from '../lib/room-engine.ts';
import {puzzleImageSource} from '../lib/puzzle-image-source.ts';
import {roomImagePreload} from '../lib/room-image-preload.ts';
import {randomPhoto} from '../lib/random-photo.ts';
const large='mountain-lake-reflection-hd-v3',small='emerald-river-valley-native-v2';
const published=JSON.parse(readFileSync(new URL('../content/puzzle-catalog.json',import.meta.url),'utf8')).filter(photo=>photo.origin==='project-ai-generated'&&photo.status==='published');
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
test('a fitted grid keeps a portrait upload whole instead of cropping it into a 4:3 board',()=>{
 // The real portrait that prompted this: 1122x1402 would have lost its top and
 // bottom on the fixed 4:3 board for every level.
 const w=1122,h=1402;
 for(const n of [108,300,500,1000]){
  const grid=gridForDimensions(w,h,n);
  assert.ok(grid,'a portrait upload gets a board at every level');
  assert.equal(grid.cols*grid.rows,grid.count);
  // Whole columns and rows of square pieces, each at least the pixel floor.
  assert.ok(grid.pixels>=minPixelsForCount(n),'piece bodies stay above the floor');
  assert.equal(grid.pixels,Math.min(Math.floor(w/grid.cols),Math.floor(h/grid.rows)));
  // The board ratio now tracks the picture ratio, so nothing is cropped away.
  const retained=grid.cols/grid.rows>w/h?(w/h)/(grid.cols/grid.rows):(grid.cols/grid.rows)/(w/h);
  assert.ok(retained>0.97,`portrait keeps its frame at ${n} pieces, retained ${retained}`);
  assert.ok(Math.abs(grid.count-n)<=n*0.35,'the fitted count stays near the request');
 }
 assert.equal(gridForDimensions(w,h,500).count,500,'500 lands exactly for this picture');
 // A square picture gets a square grid, so nothing is cropped at all.
 for(const [size,want] of [[1200,289],[1400,289],[1600,289]]){
  const square=gridForDimensions(size,size,300);assert.equal(square.cols,square.rows,'a square picture gets a square board');
  assert.equal(square.count,want);assert.equal(square.exact,false);
 }
 // Invalid input is refused rather than silently guessed.
 for(const bad of [[0,100,300],[100,0,300],[100,100,0],[100,100,2000],[100,100,7.5],[NaN,100,300]])assert.equal(gridForDimensions(bad[0],bad[1],bad[2]),null);
 // Below the floor there is no honest board: 200x200 cannot carry 1000 pieces.
 assert.equal(gridForDimensions(200,200,1000),null);
 assert.deepEqual(dynamicCountsForDimensions(w,h),[108,300,500,1000]);
 assert.deepEqual(dynamicCountsForDimensions(200,200),[108]);
});
test('fitted and fixed grids stay separate so restore never accepts an arbitrary board',()=>{
 assert.equal(knownGrid(20,15),true);assert.equal(fittedGrid(20,15),true);
 assert.equal(knownGrid(9,11),false,'a fitted portrait grid is not a catalog level');
 assert.equal(fittedGrid(9,11),true);assert.equal(fittedGrid(1,108),false);assert.equal(fittedGrid(0,300),false);
 // A fitted board is playable and can restart and shuffle, like a catalog one.
 const fitted=createFittedPuzzle('custom-'+'a'.repeat(32),9,11,7);
 assert.equal(fitted.cols,9);assert.equal(fitted.rows,11);assert.equal(fitted.groups.length,99);
 assert.equal(restartPuzzle(fitted,8).groups.length,99);
 // It survives a save/restore round trip, since restore reads the stored grid.
 const restored=restorePuzzle(JSON.stringify(fitted),['custom-'+'a'.repeat(32)]);
 assert.deepEqual(restored,fitted);
 // createPuzzle still refuses a fitted grid, and createFittedPuzzle refuses a level-only
 // board outside the fitted limit, so neither path can mint an arbitrary grid.
 assert.throws(()=>createPuzzle('custom-'+'a'.repeat(32),9,11),{message:'不支持的拼图片数'});
 assert.throws(()=>createFittedPuzzle('custom-'+'a'.repeat(32),50,40),{message:'不支持的拼图片数'},'2000 pieces stays above the fitted ceiling');
 assert.equal(createFittedPuzzle('custom-'+'a'.repeat(32),40,25).groups.length,1000);
 // A fitted grid with a nonsensical shape is rejected.
 assert.throws(()=>createFittedPuzzle('custom-'+'a'.repeat(32),1,300),{message:'不支持的拼图片数'});
 assert.throws(()=>createFittedPuzzle('custom-'+'a'.repeat(32),20.5,15),{message:'不支持的拼图片数'});
});
test('every published picture gains or keeps its frame under a fitted grid',()=>{
 // The catalog keeps fixed boards; this only proves the fitted helper would not
 // have cropped any of them, guarding the arithmetic against future art ratios.
 for(const photo of published){
  for(const level of NEW_GAME_LEVELS){
   const grid=gridForDimensions(photo.width,photo.height,level.count);
   if(!grid)continue;
   const ratio=photo.width/photo.height,board=grid.cols/grid.rows;
   const retained=ratio>board?board/ratio:ratio/board;
   assert.ok(retained>=0.9,`${photo.id} at ${level.count} pieces retains ${retained}`);
  }
 }
});
test('a piece-count band keeps a fitted board on the same leaderboard as its level',()=>{
 // A fixed level is its own band, so every existing result and link is unchanged.
 for(const level of SAVED_LEVELS)assert.equal(pieceBand(level.count),level.count,`${level.count} stays on its own board`);
 for(const level of SAVED_LEVELS)assert.equal(bandForGrid(level.cols,level.rows),level.count);
 // A fitted board near a level joins that level's board instead of splitting it.
 assert.equal(pieceBand(288),300);assert.equal(pieceBand(306),300);assert.equal(pieceBand(312),300);
 assert.equal(pieceBand(192),108);assert.equal(pieceBand(980),1000);
 // The border sits at the midpoint, and halfway rounds to the lower board.
 assert.equal(pieceBand(203),108);assert.equal(pieceBand(204),108);assert.equal(pieceBand(205),300);
 assert.equal(pieceBand(399),300);assert.equal(pieceBand(400),300);assert.equal(pieceBand(401),500);
 // Below the smallest level and above the largest, the nearest board still wins.
 assert.equal(pieceBand(20),12);assert.equal(pieceBand(9000),5000);
 assert.equal(pieceBand(0),null);assert.equal(pieceBand(-5),null);assert.equal(pieceBand(NaN),null);assert.equal(pieceBand(1.5),null);
 assert.equal(bandLabel(300),'300');assert.equal(bandLabel(306),'300±');assert.equal(bandLabel(NaN),'NaN');
 // Every fitted grid the portrait upload can produce lands on a real board.
 const w=1122,h=1402;
 for(const n of [108,300,500,1000]){const grid=gridForDimensions(w,h,n);assert.equal(pieceBand(grid.count),n,`a fitted ${n}-piece board reports as ${n}`);}
});
test('filtered random pool covers all eligible pictures without selecting unavailable artwork',()=>{ assert.ok(published.length>0);assert.deepEqual(PHOTOS.map(photo=>photo.id),published.map(photo=>photo.id));
 for(const level of NEW_GAME_LEVELS){const pool=PHOTOS.filter(p=>supportsPieceCount(p.id,level.count));assert.equal(pool.length,published.length);for(let i=0;i<pool.length;i++)assert.equal(randomPhoto(pool,()=> (i+.5)/pool.length).id,pool[i].id);}
 for(const n of [2000,5000])assert.equal(PHOTOS.filter(p=>supportsPieceCount(p.id,n)).length,0);
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
