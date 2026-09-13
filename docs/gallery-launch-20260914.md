# Gallery cleanup and faster creation

The gallery cards retain the picture, title, category and description. The
difficulty/recommendation row, advice, per-picture resolution warning and extra
advice link were removed at the user's request. The shared piece selector remains.
Picture titles link naturally to their existing public introduction pages, so
search engines can still discover every picture without an extra advice row.

An initial public-network sample took 3646 ms for guest setup, followed by
4267 ms to create a 5000-piece room and receive 451447 bytes. These are individual
network observations, not a universal loading-time guarantee. The old client
waited for both requests before navigation, then requested the snapshot again.

Creation now sends the existing browser identity secret with the room request.
The server preserves any existing account or guest cookie and establishes a
missing guest cookie in that response. The same identity, admission, membership,
capacity, origin and request-size checks apply. Returning to an existing room
continues to use server-verified admission; storage tickets alone are not trusted.

New clients request `seed-v1`: a freshly created puzzle sends its grid and seed
instead of thousands of individual positions. The browser reconstructs exactly
the same scatter using the shared deterministic algorithm. This representation
is only used by creation; existing rooms still return authoritative snapshots
or deltas. Changes to that initialization algorithm must bump the protocol version.
Old clients receive the unchanged full response. A single authenticated creation
response may be reused in memory for 15 seconds, once, to open that same room.
Effect replay shares the in-flight admission promise instead of joining twice.

Clicking a picture immediately shows its thumbnail, name, piece count and opening
status. The original image downloads in parallel as before; errors return to the
gallery with the original choices and error message. Public play no longer scans
and validates unrelated old local solo saves during gallery initialization.

Verification covers identical reconstruction at every supported count and edge
seed values, one-request creation/entry, expiration and legacy admission,
creation failure, full-response compatibility, actual HTTP identity preservation
and private/solo rejection. Build smoke checks retain all public picture links
and confirm removed advice markup is absent. Browser control has been timing out;
network measurements do not establish device FPS or a visual interaction result.

## Deployment and results

Released as `20260914-01`, application commit
`d4de18e05d58590741a8468b52ba3b14f2c6b4fb`. TypeScript, 33 targeted regression
tests and the isolated runtime build passed. HTTP checks on Windows and Linux
confirmed matching 5000-piece positions, cookie preservation, legacy responses,
and identity/private/solo restrictions. All 146 runtime assets were verified.

Public HTTPS checks confirmed 30 clean cards and 30 title links, plus the 34-page
SEO checks. A fresh 5000-piece creation response was 652 bytes and took 1102 ms in
this sample; 108 pieces returned 650 bytes in 2435 ms. These timings only cover
creation and vary with the network; route loading and image download are separate.
The compact payload is more than 99% smaller than the previous full creation
response. Public test rooms were left without placing pieces.

The current and rollback releases share 140 identical immutable WebP files by
hard link, reusing 154757350 bytes. The older release and verified upload archive
were removed; only current `20260914-01` and rollback `20260913-06` remain.
The site directory measured 254279680 bytes after cleanup. Player data and backups
were retained. IndexNow accepted the changed gallery URL (HTTP 200); indexing is
not implied. Browser inspection still timed out, so visual interaction has not
been falsely marked as verified.
