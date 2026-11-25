# Conversation shown beside the puzzle

The user requested dialogue directly on the side of the playing screen. Room
chat now starts expanded as a narrow translucent sidebar with messages and its
composer visible. The separate toggle appears only after manual collapse.
Initial display never focuses the input or opens a mobile keyboard; deliberate
reopening retains keyboard focus handling. The message list scrolls separately.
Small-screen dimensions and visual-viewport keyboard adjustments are retained.
No chat schema, API, identity, message retention or puzzle-state changes.

Application commit `cd2f3a08a55c4de66706de34791bb88d0368f862` deployed as
`20260914-05`, retaining `20260914-04` for rollback. TypeScript, release build,
Windows/Linux isolated chat HTTP checks and all 146 runtime assets passed.
Production served the new JS with the initial expanded state and the 284-pixel
translucent sidebar CSS. Chat authorization, no-store/noindex and health checks
passed. No messages were sent into real players' rooms. Browser screenshot
verification remains unavailable as recorded in the original chat delivery.

Removed only superseded runtime `20260914-03` and the verified upload archive;
retained current and one rollback release with shared immutable image assets.
Player data, messages and backups remain. Help now describes direct sidebar
display; IndexNow submission acceptance does not mean search indexing.
