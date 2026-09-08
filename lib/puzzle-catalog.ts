import catalog from '../content/puzzle-catalog.json' with { type:'json' };

export const PHOTOS=catalog.filter(photo=>photo.origin==='project-ai-generated'&&photo.status==='published');
export const PHOTO_IDS=PHOTOS.map(photo=>photo.id);
export const CATEGORIES=['全部',...new Set(PHOTOS.map(photo=>photo.category))];
export const RETIRED_PHOTO_IDS=['skate','gold','red'];
