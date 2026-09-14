import { LEVELS } from './puzzle-engine';
import { photoGuidance } from './play-guidance';

export const DEFAULT_PIECES=300;
export const PIECE_PREFERENCE_KEY='puzzle:piece-count:v1';
// A practical floor for new games, evaluated after the square-body crop.
// It is not a promise of unlimited sharp zoom or photographic native detail.
export const MIN_PIECE_PIXELS=30;
export const PIECE_RESOLUTION_ERROR='这张图片暂不支持该片数，请选择较少片数或其他图片。';
export function countsForDimensions(width:number,height:number){
 if(!Number.isFinite(width)||!Number.isFinite(height)||width<=0||height<=0)return [];
 return LEVELS.filter(level=>Math.min(width/level.cols,height/level.rows)>=(level.count===108?20:MIN_PIECE_PIXELS)).map(level=>level.count);
}
export function allowedPieceCounts(imageId:string){const image=photoGuidance(imageId);return image?countsForDimensions(image.width,image.height):[];}
export function supportsPieceCount(imageId:string,count:number){return allowedPieceCounts(imageId).includes(count);}
export function maximumPieces(imageId:string){return allowedPieceCounts(imageId).at(-1)??0;}
export function preferredPieceCount(value:unknown){const count=typeof value==='string'?Number(value):value;return LEVELS.some(level=>level.count===count)?count as number:DEFAULT_PIECES;}
