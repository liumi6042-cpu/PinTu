import {PHOTOS} from './puzzle-catalog';
import {dailyPuzzle,dailyPuzzleDate} from './daily-puzzle';
export const PUZZLE_SERIES=[{id:'lantern-stories',zh:'灯火里的奇遇',en:'Stories in the lantern light',pictures:['cat-lantern-market-v1','lantern-dance-v1','magic-treehouse-v1']}];
export function seriesProgress(facts:{imageId:string}[]){const done=new Set(facts.map(f=>f.imageId));return PUZZLE_SERIES.map(s=>({...s,count:s.pictures.filter(id=>done.has(id)).length,complete:s.pictures.every(id=>done.has(id))}));}
export function dailyStamps(facts:{imageId:string;completedAt:number}[]){return [...new Set(facts.filter(f=>dailyPuzzle(f.completedAt).id===f.imageId).map(f=>dailyPuzzleDate(f.completedAt)))].sort();}
export function continuationChoices(imageId:string){const index=Math.max(0,PHOTOS.findIndex(p=>p.id===imageId));return [1,2,3].map(n=>PHOTOS[(index+n)%PHOTOS.length].id).filter(id=>id!==imageId);}
export function winningPicture(choices:string[],votes:Record<string,string>){return choices.reduce((best,id)=>Object.values(votes).filter(v=>v===id).length>Object.values(votes).filter(v=>v===best).length?id:best,choices[0]);}
