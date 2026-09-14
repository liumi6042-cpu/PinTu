import catalog from '../content/puzzle-catalog.json' with { type:'json' };

// Archived project artwork remains available to existing saves and rooms only.
export const RESTORABLE_PHOTOS=catalog.filter(photo=>photo.origin==='project-ai-generated'&&['published','archived'].includes(photo.status)).map(photo=>({
 ...photo,originalSrc:photo.src,src:photo.playSrc,thumbSrc:photo.thumbSrc,
}));
export const RESTORABLE_PHOTO_IDS=RESTORABLE_PHOTOS.map(photo=>photo.id);
export const PHOTOS=RESTORABLE_PHOTOS.filter(photo=>photo.status==='published');
export const PHOTO_IDS=PHOTOS.map(photo=>photo.id);
// Follow artwork editions for public SEO links only. Never remap a saved room.
export function latestPublishedPhoto(id:string){
 const visited=new Set<string>();let current=id;
 while(!visited.has(current)){visited.add(current);const found=PHOTOS.find(photo=>photo.id===current);if(found)return found;const next=RESTORABLE_PHOTOS.find(photo=>'replaces' in photo&&photo.replaces===current);if(!next)return undefined;current=next.id;}
 return undefined;
}
// These selections seed public tables; random play uses every published photo.
export const FEATURED_PHOTO_IDS=['lemon-still-life','sleepy-cat','sailboat-bay','tulip-vase','whale-moon','orange-bicycle','seaside','alpine-village'].map(id=>id+'-native-v2');
export const FEATURED_PHOTOS=FEATURED_PHOTO_IDS.map(id=>PHOTOS.find(photo=>photo.id===id)!).filter(Boolean);
export const CATEGORIES=['全部',...new Set(PHOTOS.map(photo=>photo.category))];
export const RETIRED_PHOTO_IDS=['skate','gold','red'];
