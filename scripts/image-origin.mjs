// Single source of truth for which image origins may be served as puzzle artwork.
//
// Every script that walks the catalog must import from here instead of writing
// origin==='project-ai-generated' inline. Adding a new origin then means editing
// one file, not six — and it is impossible for a delivery script and the build
// validator to disagree about what "playable" means.
export const PLAYABLE_ORIGINS = ['project-ai-generated', 'user-provided'];

export function isPlayableOrigin(origin) {
  return PLAYABLE_ORIGINS.includes(origin);
}

// Statuses whose originals must be kept on disk and validated by the build.
export const RETAINED_STATUSES = ['published', 'archived'];

export function isRetained(photo) {
  return isPlayableOrigin(photo?.origin) && RETAINED_STATUSES.includes(photo?.status);
}

// Only published artwork seeds new games, the public gallery and the sitemap.
export function isPublishedPlayable(photo) {
  return isPlayableOrigin(photo?.origin) && photo?.status === 'published';
}
