import { achievementById,achievementDay,awardAchievements,emptyBook,type AchievementBook,type AchievementId } from './achievements';
import { RESTORABLE_PHOTOS } from './puzzle-catalog';
import { placedCount,type PuzzleState } from './puzzle-engine';
export const LOCAL_ACHIEVEMENTS_KEY='together-puzzle:achievements:v1';
const observed=new WeakMap<PuzzleState,number>();
type Storage=Pick<globalThis.Storage,'getItem'|'setItem'>;
export function readLocalAchievements(storage:Storage):AchievementBook{
  try{
    const raw=JSON.parse(storage.getItem(LOCAL_ACHIEVEMENTS_KEY)||'null');if(!raw||!Array.isArray(raw.facts)||!Array.isArray(raw.days))return emptyBook();
    const book=emptyBook();book.facts=raw.facts.filter((f:AchievementBook['facts'][number])=>f&&typeof f.key==='string'&&RESTORABLE_PHOTOS.some(p=>p.id===f.imageId)&&Number.isInteger(f.pieces)&&f.pieces>0&&f.mode==='solo'&&Number.isFinite(f.completedAt)&&f.completedAt>0);
    book.days=[...new Set<string>(raw.days.filter((d:unknown)=>typeof d==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(d)))];
    // Recompute eligibility so malformed cached awards cannot leak into the interface.
    awardAchievements(book,Date.now());
    for(const id of Object.keys(book.earned) as AchievementId[])if(Number.isFinite(raw.earned?.[id])&&raw.earned[id]>0)book.earned[id]=raw.earned[id];
    if(achievementById(raw.equipped)&&book.earned[raw.equipped as AchievementId])book.equipped=raw.equipped;
    return book;
  }catch{return emptyBook();}
}
function announce(ids:AchievementId[]){if(typeof window!=='undefined')window.dispatchEvent(new CustomEvent('puzzle:achievements',{detail:ids}));}
export function recordLocalPuzzle(storage:Storage,state:PuzzleState,now=Date.now(),backfill=false){
  const placed=placedCount(state),rank=state.cols*state.rows-state.groups.length+placed,previous=observed.get(state);observed.set(state,rank);
  const active=!backfill&&previous!==undefined&&rank>previous,complete=placed===state.cols*state.rows;
  if(!active&&!complete)return [];
  const photo=RESTORABLE_PHOTOS.find(p=>p.id===state.imageId);if(!photo)return [];
  const book=readLocalAchievements(storage),day=achievementDay(now),key=state.imageId+':'+state.cols*state.rows;let changed=false;
  if(active&&!book.days.includes(day)){book.days.push(day);changed=true;}
  if(complete&&!book.facts.some(f=>f.key===key)){book.facts.push({key,imageId:state.imageId,pieces:state.cols*state.rows,mode:'solo',completedAt:now,category:photo.category});changed=true;}
  if(!changed)return [];
  const added=awardAchievements(book,now);storage.setItem(LOCAL_ACHIEVEMENTS_KEY,JSON.stringify(book));if(!backfill)announce(added);return added;
}
export function equipLocalAchievement(storage:Storage,id:AchievementId|null){const book=readLocalAchievements(storage);if(id&&!book.earned[id])throw new Error('请先解锁这枚徽章');book.equipped=id;storage.setItem(LOCAL_ACHIEVEMENTS_KEY,JSON.stringify(book));announce([]);}
