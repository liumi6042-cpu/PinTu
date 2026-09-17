import { LEVELS, SAVED_LEVELS } from './puzzle-engine';
import { photoGuidance } from './play-guidance';

export const DEFAULT_PIECES=300;
// Operational guardrail: keep legacy high-count games readable, but do not
// create new expensive rooms until the capacity policy is deliberately changed.
export const MAX_NEW_PIECES=1000;
export const NEW_GAME_LEVELS=LEVELS.filter(level=>level.count<=MAX_NEW_PIECES);
export const HIGH_PIECES_PAUSED='大于 1000 片的新拼图暂时关闭，已有房间可以继续。';
export const PIECE_PREFERENCE_KEY='puzzle:piece-count:v1';
// A practical floor for new games, evaluated after the square-body crop.
// It is not a promise of unlimited sharp zoom or photographic native detail.
export const MIN_PIECE_PIXELS=30;
export const PIECE_RESOLUTION_ERROR='这张图片暂不支持该片数，请选择较少片数或其他图片。';
export function countsForDimensions(width:number,height:number){
 if(!Number.isFinite(width)||!Number.isFinite(height)||width<=0||height<=0)return [];
 // Ask the same question the board will: can a fitted grid hold this many pieces
 // with square bodies above the pixel floor? Measuring the fixed LEVELS grids
 // instead would hide levels a portrait picture can actually play — a 1122-wide
 // photo cannot fill 40 columns at 30 pixels, yet a fitted 28x35=980 board
 // comfortably can, and the gallery would show it as unavailable.
 return NEW_GAME_LEVELS.filter(level=>gridForDimensions(width,height,level.count)).map(level=>level.count);
}
// --- Dynamic grids for member uploads -------------------------------------
// An uploaded picture keeps its own aspect ratio instead of being cropped into a
// fixed 4:3 or 2:1 board, so a portrait photo no longer loses its top and bottom.
// A grid is always whole columns and rows of square pieces: cols/rows tracks the
// picture ratio, cols*rows lands on the requested piece count, and every piece
// still keeps at least MIN_PIECE_PIXELS (20 for the 108-piece entry level).
export const DYNAMIC_GRID_MAX_PIECES=MAX_NEW_PIECES;
export function minPixelsForCount(count:number){return count<=108?20:MIN_PIECE_PIXELS;}
function gridPixels(width:number,height:number,cols:number,rows:number){
 return Math.min(Math.floor(width/cols),Math.floor(height/rows));
}
// How much of the picture a grid keeps. Cropping the long side is the whole point
// of this function: a square-piece grid can only keep the ratio cols/rows.
function retainedRatio(ratio:number,cols:number,rows:number){
 const target=cols/rows;return ratio>target?target/ratio:ratio/target;
}
// Score a candidate grid. A relative piece-count miss and the cropped share are
// both expressed as fractions, so they can be weighed against each other: keep
// the picture whole first, land near the requested count second.
const COUNT_WEIGHT=1, CROP_WEIGHT=2.6;
// How far a board may miss the requested count before we stop calling it that
// level. A fitted grid rarely lands exactly, and a few percent is invisible to
// players, but a 35 percent miss meant a small picture could advertise 1000
// pieces and hand back 650. Every catalog picture stays within 11 percent, so
// 15 keeps them all while refusing boards that are a different puzzle.
const MAX_COUNT_DEVIATION=0.15;
function gridScore(count:number,pixels:number,ratio:number,cols:number,rows:number,floor:number){
 const miss=Math.abs(cols*rows-count)/count;
 const crop=1-retainedRatio(ratio,cols,rows);
 // Leave a little headroom above the hard floor so a marginal grid does not
 // beat a much closer one purely because it has more pixels.
 const tightness=pixels<floor*1.15?(floor*1.15-pixels)/(floor*1.15):0;
 return miss*COUNT_WEIGHT+crop*CROP_WEIGHT+tightness*0.5;
}
// A grid is always whole columns and rows of square pieces. cols/rows tracks the
// picture ratio and cols*rows lands near the requested count, so an uploaded
// portrait photo is no longer squeezed through a fixed 4:3 or 2:1 board.
// `exact` is true when the requested count is met precisely.
export function gridForDimensions(width:number,height:number,count:number){
 if(!Number.isFinite(width)||!Number.isFinite(height)||width<=0||height<=0)return null;
 if(!Number.isInteger(count)||count<12||count>DYNAMIC_GRID_MAX_PIECES)return null;
 const floor=minPixelsForCount(count),ratio=width/height;
 const span=Math.ceil(Math.sqrt(count*Math.max(ratio,1/ratio)))*2+4;
 let best:{cols:number;rows:number;pixels:number;score:number}|null=null;
 for(let rows=2;rows<=span;rows++)for(let cols=2;cols<=span;cols++){
  const total=cols*rows;
  // Keep the search near the requested count: a board that misses by more than
  // MAX_COUNT_DEVIATION is a different puzzle, not a rounding of the same one.
  if(Math.abs(total-count)>count*MAX_COUNT_DEVIATION)continue;
  const pixels=gridPixels(width,height,cols,rows);
  if(pixels<floor)continue;
  const score=gridScore(count,pixels,ratio,cols,rows,floor);
  if(!best||score<best.score-1e-9)best={cols,rows,pixels,score};
 }
 return best?{cols:best.cols,rows:best.rows,count:best.cols*best.rows,pixels:best.pixels,exact:best.cols*best.rows===count}:null;
}
// Every count a dynamic board can offer for this picture, nearest grid each time.
export function dynamicCountsForDimensions(width:number,height:number){
 return NEW_GAME_LEVELS.filter(level=>gridForDimensions(width,height,level.count)).map(level=>level.count);
}
// --- Piece-count bands ----------------------------------------------------
// A fitted grid rarely lands on the requested count exactly: a portrait photo
// asked for 300 pieces may come out as 288 or 312. Leaderboards compare whole
// numbers, so an exact match would scatter one table's results across several
// near-empty boards. Results therefore record the *requested* count, and a band
// groups every count that belongs to the same game. Bands are the catalog counts
// themselves, separated by their midpoints, so legacy records keep the board they
// were always on and nothing has to be migrated.
export function pieceBand(count:number){
 const levels=SAVED_LEVELS.map(level=>level.count);
 if(!Number.isInteger(count)||count<levels[0])return null;
 let lower=levels[0];
 for(const level of levels){if(count>=level)lower=level;else break;}
 const index=levels.indexOf(lower),next=levels[index+1];
 if(next===undefined)return lower;
 // The midpoint decides the border: 1500 stays on the 1000 board, 1501 moves to
 // the 1500 one. Exactly halfway rounds down, keeping the lower, more common board.
 return count-lower<=next-count?lower:next;
}
// The board a finished game belongs to, given the grid it actually played.
export function bandForGrid(cols:number,rows:number){return pieceBand(cols*rows);}
export function bandLabel(count:number){const band=pieceBand(count);return band===null?String(count):band===count?`${count}`:`${band}±`;}
export function allowedPieceCounts(imageId:string){const image=photoGuidance(imageId);return image?countsForDimensions(image.width,image.height):[];}
export function supportsPieceCount(imageId:string,count:number){return allowedPieceCounts(imageId).includes(count);}
export function maximumPieces(imageId:string){return allowedPieceCounts(imageId).at(-1)??0;}
export function preferredPieceCount(value:unknown){const count=typeof value==='string'?Number(value):value;return NEW_GAME_LEVELS.some(level=>level.count===count)?count as number:DEFAULT_PIECES;}
