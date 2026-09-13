# Public lobby and 5000-piece release

The paper entrance remains. Clicking its entry button or completing its puzzle
interaction opens the public lobby. Public tables and gallery creation remain
free and need no account. The personal page now shows public-table records.

`lib/feature-visibility.ts` controls the temporarily hidden solo and membership
entries. Old gallery mode links route to public creation. Membership and upload
pages redirect to the public lobby/records while hidden. Existing databases,
uploaded pictures, saves and room authorization have not been removed or made
public. The original backend rules still protect private and solo rooms.

New games support 108, 300, 500, 1000, 1500, 2000, 3000, 4000 and 5000 pieces.
The largest grid is exactly 100 × 50 with square bodies on a 2:1 board. Old 12
and 48-piece games remain restorable. Higher piece counts do not reset progress.

## Images and explicit resolution limit

The user selected a single continuous image, rejected four-panel collages, and
then explicitly chose to keep built-in image generation rather than use a paid
API. They accepted limited detail when zooming a 5000-piece puzzle.

Thirty new source images were generated separately using `image_gen`, without
external references. Actual native output is 1774 × 887 (1,573,538 pixels),
irrespective of larger dimensions requested in some prompts. No upscaling or
stitching was applied. The 100 × 50 board gives about 17.74 source pixels per
piece-body side. This is not a 4K image and does not provide sharp unlimited zoom.
The existing low-detail notice and per-image recommended counts remain visible.

All 30 published pictures have new `-native-v2` IDs. Their earlier counterparts
remain archived, with unchanged files and image IDs, for old rooms and progress.
The gallery and random draw contain 30 new pictures; 40 archived pictures remain
restorable. Public picture descriptions redirect old picture URLs to their new
counterparts; room URLs and stored IDs do not change.

Source generation records: `content/artwork/gallery-5000/generations.json`.
Exact prompts: `content/image-prompts/*-native-v2.txt`.
Native dimensions, SHA-256, provenance and WebP hashes:
`content/image-provenance/*-native-v2.json`.

List cards load at most 480px previews. Play loads native lossless WebP with
content-hash URLs and existing long-term caching. The 30 new play assets total
62,229,664 bytes; their thumbnails total 920,390 bytes. Neither source PNGs nor
discarded collage experiments belong in the runtime upload.

## Verification

Verify exact square grids through 5000, fresh public creation/join/drop/shuffle,
preservation of old archived saves, free assistance quotas and the bounded
dragging layer. Verify intro navigation, hidden entries, both languages, native
image/thumbnail hashes, 30 gallery items, search, and public SEO redirects.

Release packaging uses the isolated build and latest runtime archive only.
Production deployment keeps one rollback release and all player data.
