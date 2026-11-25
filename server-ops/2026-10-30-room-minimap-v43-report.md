# room-minimap — TapTap v43 (2026-10-30)

## Merge
- `git merge pieces-500-level` (117bfa0) into room-minimap (b1faa04) → merge commit **8359285** (not pushed). `work/pieces-level` untouched; play-path-timeline untouched.
- One conflict: `package.json` test:mobile list — kept both new test files (`tests/mobile-piece-level.test.mjs` + `tests/mobile-room-minimap.test.mjs`). `mobile/app.ts` merged automatically; `CLIENT_PACKAGE_VERSION` set to `'v43'`.

## Checks (logs in work/v43-logs/)
| | before merge (b1faa04) | after merge (8359285) |
|---|---|---|
| `npx tsc --noEmit` | only pre-existing vite.config.ts TS2307 | same, nothing new |
| `npm run test:mobile` | 50 / 403 (1 skipped) / 17 — 0 fail | 54 / 403 (1 skipped) / 17 — 0 fail |
No new failures; the +4 are the piece-level tests.
- `npm run test:mobile:package-assets` against the v43 package dir: exit 0.

## Package
- `node scripts/package-taptap.mjs 20261030-play-path-v43 --albums '…\release-20261028T191249564Z-6dfb71bb\albums.json' --artwork-budget-mb 42 --cache-albums <v42 json cachedAlbums + cacheSkipped>`
- **D:\chat\拼图\jigsaw-nook-taptap\work\room-minimap\releases\jigsaw-nook-taptap-20261030-play-path-v43.zip**
  - 51,418,573 bytes, sha256 `84ec2ca2b1e3a35f64f8efe55f979bbcfc9d9b655a8201b04ace22f4fa94d959`
  - 217 files, same cached albums as v41/v42; no game.json; index.html identical to v41 (same 竖屏 startup).
  - vs v41 (play-path-timeline/releases): only `jigsaw-nook/game.js` differs (963,342 → 970,912 B).
- Left in room-minimap/releases/ (not copied into play-path-timeline, which another release is using).

## Screenshots (releases/v43-shots/, script work/v43-shots.mjs, local only)
- v43-1-portrait-minimap-zoomed.png — 竖屏, 小地图 on, zoomed in, map top-left, no overlaps.
- v43-2-portrait-more-version.png — 更多 scrolled to bottom: 「当前版本 v43」 (asserted from drawn text).
- v43-3-portrait-create-500-level.png — Lv.2 create panel: 片数 48/108/300/「500·10级」, 500 greyed (asserted).
- No page/console/network errors, nothing blocked.
