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
