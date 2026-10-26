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

Output: `D:\chat\拼图\ui-revamp-shots\cheers\`

- Nine `cheers-<1|4|8>p-<844x390|390x844|1920x1080>.png` images.
- `cheers-8p-844x390.webm`, 6.4 seconds, 844×390.
- `cheers-report.json`: file hashes, room completion evidence, actual layout,
  seats/presence, burst timing, bubbles, particles, combo and browser errors.
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
