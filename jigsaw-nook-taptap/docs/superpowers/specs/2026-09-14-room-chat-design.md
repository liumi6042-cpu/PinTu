# Room text chat

The user selected chat within each multiplayer puzzle room. Reuse authenticated
room membership for both guests and accounts. No lobby-wide feed or solo chat.

Independent migration 0011, store, endpoint, client and React panel. Messages do
not enter puzzle snapshots, revisions, leases, clocks, progress or achievements.
GET after an integer message cursor returns at most 100 messages; POST uses a
client request ID for safe retries and server-authoritative author information.
The server checks membership, active seating, cookie identity and room access.
Plain text only, 300 Unicode code points, 2 seconds between sends and at most
20 sends per minute per identity. Bound room history to 100 messages with an
insert trigger; room deletion cascades to chat. Existing backups follow their
normal retention. No new third-party service or credentials.

The floating button opens a nonmodal panel within the fullscreen game. It starts
closed, indicates unread messages, never plays a sound and does not cover the
entire board. Typing, IME composition, scrolling and Escape remain inside the
panel. Failures keep the draft for retry. Per-room browser blocking hides another
player's messages with a clear reset action; it does not ban them from the game.
Messages and names render as text; no HTML, images, file upload or active links.
English and Chinese UI, both table themes and mobile sizing are included.

Use a separate bounded client state, polling every 2.5 seconds while open and
12 seconds while closed. Pause polling in background tabs; resume on visibility
or reconnection and respect retry delays. New messages update only the chat
component. No subscription to piece positions and no new canvas render loop.

Verify normalization and limits, concurrent sends and retries, room isolation,
cookie binding, private-room access, deletion cascade, bounded history and
unchanged puzzle state. Exercise the actual HTTP endpoints using isolated test
data. Build the minimal release and verify migration, assets and health before
deployment. Production room data must remain untouched by chat testing.
