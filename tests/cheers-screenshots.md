# Completion cheers: manual local screenshot harness

Run from this worktree with Node 24+, the existing project dependencies, Edge,
and the rebuilt `public/fonts` / prepared mobile artwork and audio:

```powershell
node tests/cheers-screenshots.mjs
```

`PLAYWRIGHT_MODULE` optionally overrides the Codex runtime Playwright module.
`FFMPEG_PATH` optionally overrides the local Playwright FFmpeg executable used
to trim the optional recording to 6.4 seconds. Without FFmpeg the untrimmed
Playwright recording is retained and reported.

The script is manual and is not added to any npm test command. It builds the
mobile server bundle and an isolated shared TapTap Canvas client, reusing the
prepared fonts/assets. All client API, asset and game URLs point to loopback.
It prefers free port 3291, falls back to an OS-assigned port, and rejects 3211.
Every run gets a fresh `work/cheers-shots-tmp/run-*` directory containing its
own session database, mobile database, client build, raw video and report.
It neither loads `.env` nor accesses another runtime database, and deletes
nothing. The browser rejects external HTTP requests. Browser and gateway are
closed in `finally`, including on capture failure. Nothing is committed.

Rooms are created with real HTTP guest sessions, requesting the minimum 48
pieces (the actual grid fits the selected picture). Every player contributes
through real claim/drop actions; player 1 contributes the remaining groups.
Completion and rewards come from the service, with no database patches. One
contributing player leaves each multiplayer room. Remaining API players send
heartbeats before each burst so exactly one seat stays grey. Each browser
uses player 1's real session and room ticket. The 1920×1080 context uses a fine
pointer and the script asserts the actual `desktop` layout.

Multiplayer bursts send popper, heart, tea from two different players, star,
cat and clap through HTTP; player 1 clicks clap in the actual Canvas UI.
The solo client clicks clap and popper. Screenshots begin about 550 ms after
the burst; runtime state is recorded without patching rendering or effects.

Output defaults to `D:\chat\拼图\ui-revamp-shots\cheers\`.
Set `CHEERS_SHOTS_DIR` to override the output directory, for example:

```powershell
$env:CHEERS_SHOTS_DIR = 'D:/chat/拼图/ui-revamp-shots/cheers-review'
node tests/cheers-screenshots.mjs
```

- Nine `cheers-<1|4|8>p-<844x390|390x844|1920x1080>.png` images.
- `cheers-8p-844x390.webm`, 6.4 seconds, 844×390.
- `cheers-report.json`: file hashes, room completion evidence, actual layout,
  seats/presence, `avatars`, `slots` (`completionSlotRects`) and final bubble
  rectangles, burst timing, bubble counts, particles, combo and browser errors.
  Geometry checks append to `problems` without throwing: `BUBBLE_OUTSIDE_STAGE`,
  `BUBBLE_INTERSECTS_AVATAR` (against every avatar), `BUBBLE_OUTSIDE_SEAT` and
  `BUBBLE_INTERSECTS_PANEL` (seated landscape/desktop senders only; solo keeps its
  picture-bottom bubble). Captures also include `modalScroll` and `pageScrolls`.
  At 844×390, `LANDSCAPE_SCROLLS` reports nonzero modal scroll or document scroll
  height/width exceeding `innerHeight`/`innerWidth`.
- `README.md`: visual review and verification notes from the completed run.

Known product behavior: reentering an already-completed room does not open
the popup from the initial snapshot. A regular heartbeat is deduped. The
harness records this and uses a real temporary, zero-contribution spectator
join/leave to trigger a metadata notification. The spectator leaves before
capture and is absent from the final seats and ranking. See
`mobile/app.ts:420` and `lib/room-client.ts:81,90–93`.

2026-10-26 validation: all nine PNG dimensions and files verified; all desktop
layouts verified; multiplayer captures have exactly one departed seat and
3/7-person combo banners. No page, console, HTTP errors or blocked external
requests. The 29 existing cheer client/UI tests and image validation passed
(82 published images, 813 old-hash derivatives). Full `tsc --noEmit` fails
because `vite.config.ts:5` imports absent `.openai/hosting.json`; excluding
only that root hosting configuration, all 368 project source files typecheck.
No product source files were changed.

2026-10-27 emote-slot implementation (`cheers-3x-1`, supersedes the avatar-overlay
placement): horizontal seats reserve an empty square at their inner end; both
text lines ellipsize within the column between avatar and slot. Portrait slots
sit between the seat and picture, centred on the avatar, overlapping the picture
edge by 13.5px at 390×844. Bubbles equal the slots after pop-in, without clamping;
fully clipped portrait slots are skipped. Slots include the seat hop and clear
alongside avatar rectangles. Solo/unseated bubbles retain their 42×38 size and
10px picture-bottom inset. Icons and ×2-or-higher badges stay inside the bubble.

The 14×13 me tag occupies the outer top corner (horizontal y−6, portrait y+3).
Only the portrait me avatar moves 1px towards the picture: a centred 34px avatar
and the specified tag would otherwise overlap by 1px. All avatars remain the
same size; the tag clears the avatar, crown pixels, text and slot. Departed tags,
avatars, crowns and text retain .45 alpha; frames and the me tint remain opaque.
Hearts rise from the slot for 1600ms: horizontal paths stay in its x-range and
rise up to 76px, while portrait paths rise up to 72px and drift .35×rise towards
the picture, with at most ±4px wobble. Solo/unseated heart paths and all existing
effect timings, confetti and seat hops are unchanged.

Final multiplayer geometry, zero safe-area insets (logical pixels):

| Stage | Seat | Avatar | Slot | Outer panel | Picture |
| --- | --- | --- | --- | --- | --- |
| 844×390 | 140×60 | 34×34 | 34×34 | 528×374 | 227.04×227.04 |
| 390×844 | 66×74 | 34×34 | 34×34 outside seat | 366×735.6 | 180×180 |
| 1920×1080 | 176×70 | 50×50 | 40×40 | 560×948 | 520×230 |
| 740×360 | 120×60 | 30×30 | 30×30 | 464×344 | 199.52×199.52 |
| 667×375 | 120×60 | 30×30 | 30×30 | 391×359 | 168.13×168.13 |

Landscape seat width is `max(120,min(140,(available−500)/2))`; the multiplayer
panel is `min(640,available−2*(seatWidth+18))`, leaving an 8px gap to each seat.
Solo retains `min(640,available−252)` (592px at 844×390). Portrait panel sizing is
unchanged; its inner modal clip is 342×662.6 at 390×844. Short landscape panels
lift the right-hand content only for album reward lines:
`panel.y+max(12,min(42,panel.h−332+18*(2−lines)))`, so without reward lines it stays
at `panel.y+42` and with two lines all actions, cheers and hint stay inside; no
scrolling is introduced. A lifted title shares the close button's row, so it is
centred in the column width minus 28px. In portrait the 「N 人一起喝彩！」 banner
narrows so it stays clear of the top-row slots. The picture keeps the specified
size formula.

`mobile-cheers-ui.test.mjs` now exercises the real `Stage.text` ellipsis logic
with deterministic glyph measurements, long names, mixed ×1/×3 bubbles, 1/4/8
players at all six listed test stages (also 1200×900), slot/content collisions,
tag/crown pixels, both heart columns at six times, hop/clear behavior, partially
scrolled portrait slots and landscape overflow with/without album rewards.
Captured 2026-10-27 with `CHEERS_SHOTS_DIR=D:/chat/拼图/ui-revamp-shots/cheers/v3`:
9 PNGs + `cheers-8p-844x390.webm`, 0 page/console/network errors; the only
`problems` entry is `COMPLETED_REENTRY` (this branch predates the reentry fix, so
the harness used its spectator join/leave). Visually reviewed: slots never cover
avatars, names, 「拼合 N」 or 「我」, and 844×390 does not scroll.

Verification for this change (Windows `.cmd` launchers avoid the PowerShell
script execution policy; no policy changes):

- `npm.cmd run test:mobile`: 14 + 71 + 16 = 101 passed, 0 failed (52 UI tests).
- `npm.cmd run check:images`: 82 published images, 813 old-hash derivatives passed.
- `npx.cmd tsc --noEmit --incremental false -p tsconfig.json`: only the allowed
  pre-existing `vite.config.ts(5,27)` TS2307 for `.openai/hosting.json`.
- `node --check tests/cheers-screenshots.mjs`: passed; capture run as above.
