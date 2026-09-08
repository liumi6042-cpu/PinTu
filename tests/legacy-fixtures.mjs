import {createPuzzle,restartPuzzle,LEVELS,SAVED_LEVELS} from '../lib/puzzle-engine.ts';
import {makeRoom} from '../lib/room-engine.ts';

// Geometry and lease regressions still exercise earlier 12/48-piece saved games.
// New-game rejection tests use the production constructors directly.
export function createFixturePuzzle(imageId,cols,rows,seed=31){
 if(LEVELS.some(level=>level.cols===cols&&level.rows===rows)||!SAVED_LEVELS.some(level=>level.cols===cols&&level.rows===rows))return createPuzzle(imageId,cols,rows,seed);
 return restartPuzzle({...createPuzzle(imageId,12,9,seed),cols,rows},seed);
}
export function makeFixtureRoom(id,imageId,count,now){
 const legacy=SAVED_LEVELS.find(level=>level.count===count);
 if(LEVELS.some(level=>level.count===count)||!legacy)return makeRoom(id,imageId,count,now);
 const room=makeRoom(id,imageId,108,now);
 room.puzzle=createFixturePuzzle(imageId,legacy.cols,legacy.rows,room.puzzle.seed);return room;
}
