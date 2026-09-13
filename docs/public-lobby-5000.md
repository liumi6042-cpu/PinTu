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

## Completed release verification (2026-09-14 Asia/Shanghai)

Deployed commit `64acd206f23c3b3244e457085872c3d46bbd34f1` as
`20260913-06` on the existing Ubuntu host. TypeScript and the isolated release
build passed. The regression run passed 154 tests, with zero failures and one
skipped test. Separate isolated Node HTTP checks verified exact 5000-piece
creation, two guest players, snapping, and shuffle protection of held pieces.

The Linux preflight and live service verified all 146 runtime assets. Public
HTTPS checks verified all 60 new play/thumbnail URLs with one-year immutable
caching, six sampled file hashes, all 30 legacy picture redirects and the three
hidden feature redirects. All 34 public pages passed English SSR, unique titles,
canonical/Open Graph links, gallery links, robots and sitemap checks; private
routes remain noindex. IndexNow accepted the 34 changed canonical public URLs
with HTTP 200; that is receipt of the notification, not proof of indexing.

After successful deployment, only release `20260913-05` was retained for
rollback. The older `20260913-04` and verified upload archive were removed.
The site directory measured 365,834,240 bytes (about 349 MiB), including retained
runtime releases and shared data. Raw PNGs and withdrawn collages were not
uploaded. Locally, 90 discarded collage PNG/WebP artifacts were removed, freeing
592,264,079 bytes; their small generation notes were kept.

The earlier puzzle-opening preloads, bounded drag layer and approved crisp
double-click sound are present in the deployed build. Browser control repeatedly
timed out, so actual browser drag smoothness, mobile layout and perceived sound
comfort are still unverified in this run. API and rendering regression checks
must not be described as a device FPS or listening test. Payment integration
remains intentionally deferred by the user.

Local verification evidence is under ignored `work/public-5000/`; the production
deployment manifest is in `releases/20260913-06/deployment.json` on the host.
