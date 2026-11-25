# Offline package compatibility acceptance (off-06 A + B)

Latest run: 2026-10-27 22:38:42–22:39:32 Asia/Shanghai, exit **0**. Both parts passed locally.

Harness: [tests/offline-backcompat-browser.mjs](../tests/offline-backcompat-browser.mjs).
Full evidence, including every request/response status, aborted URL, WebSocket attempt, package game.js SHA-256, content inputs, pending-clear before/after strings, and screenshot paths: [report.json](../work/offline-play-logs/backcompat/report.json).

| Backend / package | Startup and lobby | Private room | Story level 1 |
| --- | --- | --- | --- |
| New / v9 | Passed with guest bootstrap described below | 49 successful API claim/drop pairs; completion popup | Not supported by v9 |
| New / v17 | Passed | 49 successful API claim/drop pairs; completion popup | 12 successful drops; first-clear stamina +30 visible |
| New / v18 control | Passed; offlineLevelClears=true | 49 successful API claim/drop pairs; completion popup | 12 successful drops; first-clear stamina +30 visible |
| Staged live version / v18 | Passed | 49 drops through the actual package RoomClient | 12 drops through the actual package RoomClient; first-clear stamina +30 visible |

The requested 48-piece private rooms use the server's fitted 49-piece grid; the level uses its configured 12-piece grid. Levels are completed before private rooms to retain fresh-guest first-room protection and use ordinary economy rules. No stamina or server result is mocked.

## v9 identity boundary

The v9 game.js declares privacy version `2026-10-17.2`. The harness reads this from that package and injects consent plus a session created by the local `/h5/session` API. This historical package still unconditionally requires the native TapTap bridge, even with a valid session. Its desktop startup limitation is captured in `v9-00-native-bridge.png` (and the earlier diagnostic `v9-failure.png`).

To test backend compatibility, the harness temporarily sets the runtime platform ID to `h5` while calling the **existing v9 guest startup branch**, then restores `taptap` before calling app.start and before all gameplay. No package files, client methods, responses, or product source are changed. Thus v9 guest/backend/room compatibility passed; actual native TapTap authentication was not exercised.

## Network findings

- HTTP >=400: **none**, across all four scenarios, including helper API requests.
- Page errors / console errors: **none**.
- Aborted HTTP URLs: **none**. All browser HTTP requests were fulfilled from package files or fetched from a loopback backend.
- Realtime was **blocked**, not routed. Every blocked WebSocket URL was `wss://jigsawnook.online/h5-mobile-v3/realtime`; attempts were v9=3, v17=5, v18=9, forward=9. Every attempt is retained in report.json. No WebSocket connected externally.
- Successful ordinary room HTTP polling responses: v9=4, v17=4, v18=11, forward=6.
- No `/api/levels/offline-clears` request occurred in any scenario.

The browser uses one catch-all HTTP route plus a catch-all WebSocket route, blocks service workers, disables background networking, and maps nonlocal DNS names to NOTFOUND. Backend subprocesses use a socket/fetch loopback guard and a loopback-only upstream. No production URL is fetched. New backend port: 10030; staged-live backend port: 10092. Only harness-owned child processes were stopped.

Both backends loaded local content release `release-20261027T103623768Z-0250800c`, with the four content-admin configuration paths resolved explicitly from the main repository's sibling content-admin directory. Session/mobile databases and daily appearances were created only under this worktree's unique temporary run directory, which was removed on exit. Existing databases were not opened. Shared build artifacts were reused without rebuilding; package folders and the staged live release were read-only inputs.

## Part B: current live-version backend

Exact staged release: `work/play-path/work/mobile-backend-releases/20261027-chapter-name` relative to the main repository. Its `/h5/config` capability object was:

```json
{
  "energy": true,
  "ads": false,
  "shareRewards": true,
  "tapMultiplayer": false,
  "albumTarget": "mobile-shared",
  "createTickets": true,
  "customNames": false,
  "cheers": true,
  "privacyRequests": true,
  "roomActionRevisionBody": true,
  "social": {
    "friends": true,
    "privateMessages": false,
    "privateMessageHistory": true,
    "roomInvites": true,
    "reports": true,
    "blocking": true,
    "search": true,
    "presence": true,
    "codeFormat": "digits9"
  }
}
```

Both `soloLocalPlay` and `offlineLevelClears` are absent. Observed room action types were `heartbeat`, `leave`, `claim`, `drop` (counts 3, 3, 61, 61). All **122 client claim/drop responses were HTTP 200**; **zero batch POSTs** occurred. The RoomClient reported localPlay=false.

A pending ch1-2 clear was generated using the real `lib/offline-play.ts` recordOfflineClear function and copied into device localStorage at `jigsaw:offline-clears:v1`. After reload and a further app.start reconnect, its serialized value was byte-for-byte unchanged, no offline-clears request occurred, and app.message was empty. The captured chapter UI had no visible error note.

These checks support shipping v18 before the new backend for the tested startup, lobby, private solo room, online story, and queued-clear behavior. This is a local staged-version compatibility result, not a production deployment or native TapTap login test.

## Screenshots

All files are under [work/offline-play-logs/backcompat](../work/offline-play-logs/backcompat/):

- `v9-00-native-bridge.png`
- `v9-01-lobby.png`
- `v9-02-room.png`
- `v9-03-complete.png`
- `v17-01-lobby.png`
- `v17-02-room.png`
- `v17-03-complete.png`
- `v17-04-level.png`
- `v18-01-lobby.png`
- `v18-02-room.png`
- `v18-03-complete.png`
- `v18-04-level.png`
- `fwd-01-lobby.png`
- `fwd-02-room-complete.png`
- `fwd-03-level.png`
- `fwd-04-queued.png`

The v9 portrait completion, forward level reward, and forward queued-clear screenshots were visually inspected. Earlier diagnostic `v9-failure.png` is retained separately from the final run's screenshot inventory.

## Reproduce and validation

```powershell
node tests/offline-backcompat-browser.mjs
node tests/offline-backcompat-browser.mjs --backward
node tests/offline-backcompat-browser.mjs --forward
```

Optional package/release overrides: `--v9 PATH --v17 PATH --control PATH --live PATH`. `BACKCOMPAT_SHOTS_DIR` may select another output subdirectory inside this worktree. The harness is manual and is not added to npm test. Every run obtains fresh OS-assigned ports, fresh guest identities and fresh databases, with no shared-output rebuild or broad process cleanup.

- Manual browser acceptance: **passed**, both parts; focused mobile/room checks are the scenarios above.
- `node --check tests/offline-backcompat-browser.mjs`: **passed**.
- `node scripts/check-image-library.mjs`: **passed**, 82 published images and 813 legacy hash derivatives; [log](../work/offline-play-logs/backcompat-images.log).
- `node node_modules/typescript/bin/tsc --noEmit --incremental false`: **blocked by an existing missing input**: `vite.config.ts(5,27): TS2307 Cannot find module './.openai/hosting.json' or its corresponding type declarations`. No product/configuration files were changed to hide this failure.

Only the manual harness and this report were added to tracked-source locations. No product code changes and no commit.
