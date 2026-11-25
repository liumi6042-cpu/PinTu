# Puzzle opening layout

The gallery launch screen previously mixed a centered image and loading message
with the left-aligned room join form heading and piece count. Replaced that form
layout with a self-contained paper card: full-width 2:1 preview, aligned title and
piece-count capsule, and a separated loading status. Navigation remains above
the card. Small screens and short landscape viewports have dedicated spacing.
The icon only fades gently; reduced-motion preferences disable its animation.
No artificial delay, fake progress percentage, room admission, or game changes.

Application commit: `a3d4ef3b32c7006dc16f8c2b206413286f412545`.
Deployed as `20260914-03`, with `20260914-02` retained for rollback.

Validation: TypeScript and whitespace checks; isolated release build and HTTP
smoke checks including all 146 runtime assets; Linux staging creation and room
state checks. Production gallery, linked CSS and component JS, lobby and health
returned 200. Served CSS includes the layout and reduced-motion rules; served JS
includes the new card markup. The native public-room anchor is still present.
Browser inventory failed with `nodeRepl.fetch request failed`; no automated
browser screenshot or responsive visual verification is claimed.

Only the verified runtime archive was uploaded. Unchanged immutable WebP assets
remain shared across the current and rollback releases. Superseded runtime and
upload cleanup does not include shared player data, images or backups.
