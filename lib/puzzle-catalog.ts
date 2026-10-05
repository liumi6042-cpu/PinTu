import catalog from '../content/puzzle-catalog.json' with { type:'json' };

// Two origins can be served: our own generations and images a user provided with
// a recorded right to use them. The build validator (scripts/check-image-library.mjs)
// is what actually proves each one; here we only pick what may be shown.
const PLAYABLE_ORIGINS=['project-ai-generated','user-provided'];

// Archived artwork remains available to existing saves and rooms only.
export const RESTORABLE_PHOTOS=catalog.filter(photo=>PLAYABLE_ORIGINS.includes(photo.origin)&&['published','archived'].includes(photo.status)).map(photo=>({
 ...photo,originalSrc:photo.src,src:photo.optimizedSrc??photo.playSrc,thumbSrc:photo.thumbSrc,
}));
export const RESTORABLE_PHOTO_IDS=RESTORABLE_PHOTOS.map(photo=>photo.id);
export const PHOTOS=RESTORABLE_PHOTOS.filter(photo=>photo.status==='published');
// Daily artwork remains playable and restorable, but is intentionally kept out of
// the ordinary picture library. The lobby is the only public entry point for it.
export const DAILY_PHOTOS=PHOTOS.filter(photo=>photo.dailyOnly===true);
export const GALLERY_VISIBLE_PHOTOS=PHOTOS.filter(photo=>photo.galleryVisible!==false);
export const PHOTO_IDS=PHOTOS.map(photo=>photo.id);
// Gallery order is independent of daily selection and existing room identities.
export const GALLERY_PHOTOS=[...GALLERY_VISIBLE_PHOTOS].sort((a,b)=>Date.parse(b.publishedAt!)-Date.parse(a.publishedAt!));
// True for artwork we generated ourselves; the gallery must not call a
// user-provided picture "本站 AI 生成".
export function isProjectAiGenerated(photo:{origin?:string}){return photo.origin==='project-ai-generated';}
// Follow artwork editions for public SEO links only. Never remap a saved room.
export function latestPublishedPhoto(id:string){
 const visited=new Set<string>();let current=id;
 while(!visited.has(current)){visited.add(current);const found=PHOTOS.find(photo=>photo.id===current);if(found)return found;const next=RESTORABLE_PHOTOS.find(photo=>'replaces' in photo&&photo.replaces===current);if(!next)return undefined;current=next.id;}
 return undefined;
}
// These selections seed public tables; random play uses every published photo.
export const FEATURED_PHOTO_IDS=['lemon-still-life','sleepy-cat','sailboat-bay','tulip-vase','whale-moon','orange-bicycle','seaside','alpine-village'].map(id=>id+'-native-v2');
export const FEATURED_PHOTOS=FEATURED_PHOTO_IDS.map(id=>PHOTOS.find(photo=>photo.id===id)!).filter(Boolean);
export const CATEGORIES=['全部',...new Set(GALLERY_VISIBLE_PHOTOS.map(photo=>photo.category))];
export const RETIRED_PHOTO_IDS=['skate','gold','red'];
