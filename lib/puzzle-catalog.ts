import catalog from '../content/puzzle-catalog.json' with { type:'json' };

export const PHOTOS=catalog.filter(photo=>photo.origin==='project-ai-generated'&&photo.status==='published');
export const PHOTO_IDS=PHOTOS.map(photo=>photo.id);
// Eight familiar selections stay on the reel; the full collection lives in the gallery.
export const FEATURED_PHOTO_IDS=['blossom-canal','coral-garden','cat-library','alpine-village','seaside','skate-garden','amber-cabinet','vermilion-garden'];
export const FEATURED_PHOTOS=FEATURED_PHOTO_IDS.map(id=>PHOTOS.find(photo=>photo.id===id)!).filter(Boolean);
export const CATEGORIES=['全部',...new Set(PHOTOS.map(photo=>photo.category))];
export const RETIRED_PHOTO_IDS=['skate','gold','red'];
