# Public room entry navigation

The user reported that public-lobby room cards stopped opening after the recent
release. Diagnostics against an existing public 108-piece room confirmed HTTP
200 for its HTML, RSC response, guest initialization, join, and leave. The room
still had 38 placed pieces. No puzzle actions or resets were performed. Browser
control continued to time out, so a specific client exception was not observed.

Public room cards now use native anchors instead of framework Link navigation.
This lets the browser open the verified room URL without depending on the SPA
transition. The existing full-room guard, original-image preload and accessible
link label remain. It does not prefetch all rooms. Creation still uses the compact
creation response and fresh in-memory ticket; server admission is unchanged.

This is a targeted recovery for the reported click failure, not a claim that an
unobserved browser exception was identified.

Deployed application commit `d2e1eca526590ab156983a076d265af654052ea0` as
`20260914-02`. TypeScript, whitespace checks, the isolated release smoke check,
and all 146 runtime assets passed. Linux staging confirmed compact creation of
5,000-piece rooms still returns 652 bytes, with a matching full heartbeat state.

After deployment, public lobby HTML and its new `public-lobby-61lEZyHc.js` bundle
returned HTTP 200. The served bundle renders the room card as an `a` element with
`href: /room/<id>`. Existing-room HTML, RSC, guest admission, join and leave also
returned HTTP 200; the observed room retained its 38 placed pieces. No puzzle
move, shuffle, or reset was issued. These are HTTP and artifact checks, not a
claim of a successful automated browser click; browser control was unavailable.

Retained `20260914-01` as rollback and removed only the verified upload archive
and superseded `20260913-06` runtime. The current and rollback releases share
140 unchanged immutable images (154,757,350 bytes). Measured site disk usage
after cleanup: 254,259,200 bytes. Player data, uploaded images and backups remain.
