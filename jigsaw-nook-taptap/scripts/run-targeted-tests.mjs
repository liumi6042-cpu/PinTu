import {execFileSync} from 'node:child_process';
import {existsSync,readFileSync} from 'node:fs';
import {dirname,relative,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Domain-grouped test suites matching `package.json` `test:mobile` + `test:h5`.
 * Each entry marks `ts: true` when it requires `--import ./tests/ts-register.mjs`.
 */
export const TEST_GROUPS = {
  story: [
    {file: 'tests/mobile-levels.test.mjs', ts: false},
    {file: 'tests/mobile-story-timeline.test.mjs', ts: true},
    {file: 'tests/mobile-story-chapters.test.mjs', ts: true},
    {file: 'tests/mobile-story-landscape-layout.test.mjs', ts: true},
    {file: 'tests/mobile-story-comic.test.mjs', ts: true},
    {file: 'tests/mobile-story-nav.test.mjs', ts: true},
    {file: 'tests/mobile-story-variants.test.mjs', ts: true},
  ],
  board: [
    {file: 'tests/mobile-board-mistouch.test.mjs', ts: true},
    {file: 'tests/mobile-room-mistouch-app.test.mjs', ts: true},
    {file: 'tests/mobile-room-client.test.mjs', ts: true},
    {file: 'tests/mobile-drag-cancel.test.mjs', ts: true},
    {file: 'tests/mobile-tray-drag.test.mjs', ts: true},
    {file: 'tests/mobile-tray-minimap.test.mjs', ts: true},
    {file: 'tests/mobile-tray-shuffle.test.mjs', ts: true},
    {file: 'tests/mobile-lasting-tools.test.mjs', ts: true},
    {file: 'tests/mobile-tray-lock.test.mjs', ts: true},
    {file: 'tests/mobile-tray-landscape-bottom.test.mjs', ts: true},
    {file: 'tests/mobile-tray-500-size.test.mjs', ts: true},
    {file: 'tests/mobile-room-minimap.test.mjs', ts: true},
    {file: 'tests/team-merge.test.mjs', ts: true},
    {file: 'tests/mobile-solo-local.test.mjs', ts: true},
  ],
  completion: [
    {file: 'tests/mobile-level-completion.test.mjs', ts: true},
    {file: 'tests/mobile-completion-transition.test.mjs', ts: true},
    {file: 'tests/mobile-completion-celebration.test.mjs', ts: true},
    {file: 'tests/mobile-cheer-client.test.mjs', ts: true},
    {file: 'tests/mobile-cheers-ui.test.mjs', ts: true},
    {file: 'tests/mobile-cheers.test.mjs', ts: false},
    {file: 'tests/room-realtime-cheers.test.mjs', ts: false},
  ],
  social: [
    {file: 'tests/mobile-private-messages.test.mjs', ts: false},
    {file: 'tests/mobile-lobby-social-extras.test.mjs', ts: false},
    {file: 'tests/mobile-guest-names.test.mjs', ts: false},
    {file: 'tests/mobile-friend-invite.test.mjs', ts: true},
    {file: 'tests/mobile-chat-phrases.test.mjs', ts: true},
  ],
  modals: [
    {file: 'tests/mobile-redeem-codes.test.mjs', ts: false},
    {file: 'tests/mobile-retention.test.mjs', ts: false},
    {file: 'tests/mobile-redeem-client.test.mjs', ts: true},
    {file: 'tests/mobile-retention-client.test.mjs', ts: true},
    {file: 'tests/mobile-orientation-picker.test.mjs', ts: true},
    {file: 'tests/mobile-welcome-greeting.test.mjs', ts: true},
    {file: 'tests/mobile-lobby-popup-order.test.mjs', ts: true},
    {file: 'tests/tap-orientation.test.mjs', ts: true},
  ],
  economy: [
    {file: 'tests/mobile-ad-unlock.test.mjs', ts: false},
    {file: 'tests/mobile-ad-unlock-client.test.mjs', ts: false},
    {file: 'tests/tap-rewarded.test.mjs', ts: false},
    {file: 'tests/mobile-piece-level.test.mjs', ts: false},
    {file: 'tests/mobile-tuanzi.test.mjs', ts: false},
    {file: 'tests/mobile-telemetry.test.mjs', ts: true},
    {file: 'tests/mobile-legacy-runtime.test.mjs', ts: true},
  ],
  offline: [
    {file: 'tests/mobile-offline-clears.test.mjs', ts: false},
    {file: 'tests/taptap-offline-package.test.mjs', ts: false},
    {file: 'tests/mobile-offline-play.test.mjs', ts: true},
  ],
  server: [
    {file: 'tests/mobile-service.test.mjs', ts: false},
    {file: 'tests/mobile-read-caches.test.mjs', ts: false},
    {file: 'tests/mobile-request-prune.test.mjs', ts: false},
    {file: 'tests/mobile-room-action-receipts.test.mjs', ts: false},
    {file: 'tests/mobile-solo-batch.test.mjs', ts: false},
    {file: 'tests/mobile-cheers.test.mjs', ts: false},
    {file: 'tests/room-realtime-cheers.test.mjs', ts: false},
  ],
  h5: [
    {file: 'tests/h5-gateway.test.mjs', ts: false},
    {file: 'tests/h5-ad-assistance.test.mjs', ts: false},
    {file: 'tests/h5-ads.test.mjs', ts: true},
    {file: 'tests/h5-transport.test.mjs', ts: true},
    {file: 'tests/h5-orientation.test.mjs', ts: true},
  ],
};

/** Maps changed project-relative paths to the relevant test groups. */
const PATH_RULES = [
  [/^mobile\/panels\/story-panel\.ts$|^mobile\/(?:story-|bundled-story)/, ['story']],
  [/^mobile\/panels\/completion-panel\.ts$|^mobile\/(?:completion-|cheer-)/, ['completion']],
  [/^mobile\/panels\/room-hud-panel\.ts$|^mobile\/(?:puzzle-board|room-)|^lib\/(?:room-client|puzzle-engine|cursor-client)/, ['board']],
  [/^mobile\/panels\/modals-panel\.ts$|^mobile\/(?:redeem|retention|welcome-greeting|orientation-choice|tap-orientation|privacy-policy)/, ['modals']],
  [/^mobile\/panels\/(?:collection|tasks-supplies)-panel\.ts$|^mobile\/(?:collection-copy|economy-copy|tap-rewarded|taptap-share|task-share-reward|telemetry|legacy-runtime)/, ['economy', 'modals']],
  [/^mobile\/panels\/lobby-gallery-panel\.ts$|^mobile\/(?:social-|friend-invite)/, ['social', 'modals']],
  [/^mobile\/offline-mode\.ts$|^lib\/offline-play\.ts$/, ['offline']],
  [/^mobile\/(?:app\.ts|panels\/shared\.ts|ui\.ts|client\.ts|boot\.ts|theme\.ts|ports\.ts)$/, ['story', 'board', 'completion', 'social', 'modals', 'economy']],
  [/^mobile\/(?:platform-web|platform-wechat|tap-identity|tap-preview)/, ['h5', 'modals', 'economy']],
  [/^server\/(?:h5-gateway|room-realtime)/, ['h5', 'server']],
  [/^server\//, ['server']],
  [/^h5\//, ['h5', 'server']],
  [/^config\/(?:levels|story-|social-phrases)/, ['story', 'social']],
  [/^config\//, ['server', 'economy']],
  [/^app\/account-gate\.tsx$/, ['h5']],
];

function normalizePath(rawPath) {
  let clean = rawPath.replace(/\\/g, '/').trim();
  if (clean.startsWith('jigsaw-nook-taptap/')) clean = clean.slice('jigsaw-nook-taptap/'.length);
  return clean;
}

function needsTsRegister(file) {
  const full = resolve(ROOT, file);
  if (!existsSync(full)) return false;
  try {
    const src = readFileSync(full, 'utf8');
    return /from\s+['"][^'"]+\.ts['"]/.test(src);
  } catch {
    return false;
  }
}

export function selectTestsForFiles(changedFiles) {
  const selected = new Map();
  const matchedGroups = new Set();
  const add = (entry) => {
    const existing = selected.get(entry.file);
    if (!existing || (!existing.ts && entry.ts)) selected.set(entry.file, entry);
  };

  for (const raw of changedFiles) {
    const file = normalizePath(raw);
    if (!file) continue;
    if (/^tests\/[\w.-]+\.test\.mjs$/.test(file) && existsSync(resolve(ROOT, file))) {
      const known = Object.values(TEST_GROUPS).flat().find(e => e.file === file);
      add(known ?? {file, ts: needsTsRegister(file)});
      continue;
    }
    for (const [pattern, groups] of PATH_RULES) {
      if (pattern.test(file)) {
        for (const group of groups) {
          matchedGroups.add(group);
          for (const entry of TEST_GROUPS[group] ?? []) add(entry);
        }
        break;
      }
    }
  }
  return {
    groups: [...matchedGroups],
    plain: [...selected.values()].filter(e => !e.ts).map(e => e.file),
    ts: [...selected.values()].filter(e => e.ts).map(e => e.file),
  };
}

function readGitChangedFiles(baseRef) {
  const files = new Set();
  const runGit = (args) => {
    try {
      return execFileSync('git', args, {cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore']});
    } catch {
      return '';
    }
  };
  const prefix = relative(execFileSync('git', ['rev-parse', '--show-toplevel'], {cwd: ROOT, encoding: 'utf8'}).trim(), ROOT).replace(/\\/g, '/');
  const collect = (output) => {
    for (const line of output.split(/\r?\n/)) {
      const p = line.trim();
      if (!p) continue;
      if (!prefix || p.startsWith(prefix + '/')) files.add(prefix ? p.slice(prefix.length + 1) : p);
    }
  };
  if (baseRef) {
    collect(runGit(['diff', '--name-only', `${baseRef}...HEAD`]));
  }
  collect(runGit(['diff', '--name-only']));
  collect(runGit(['diff', '--name-only', '--cached']));
  collect(runGit(['ls-files', '--others', '--exclude-standard']));
  return [...files];
}

function ensureMobileServerBuilt(dryRun) {
  if (dryRun) return;
  const required = [
    resolve(ROOT, 'outputs/mobile/engine.mjs'),
    resolve(ROOT, 'outputs/mobile/room-realtime.mjs'),
  ];
  if (required.every(existsSync)) return;
  console.log('[test:changed] 检测到 outputs/mobile 尚未构建，自动执行 build:mobile-server...');
  execFileSync(process.execPath, ['scripts/build-mobile-server.mjs'], {cwd: ROOT, stdio: 'inherit'});
}

function runSuite(plain, ts, dryRun) {
  const total = plain.length + ts.length;
  if (!total) {
    console.log('[test:changed] 未检测到需要运行的关联测试（可使用 --group=story|board|completion|social|modals|economy|offline|server|h5|all 指定）。');
    return;
  }
  console.log(`[test:changed] 选中 ${total} 个定向测试（普通 ${plain.length}，TS ${ts.length}）`);
  if (dryRun) {
    for (const f of [...plain, ...ts]) console.log('  -', f);
    return;
  }
  if (plain.length) ensureMobileServerBuilt(dryRun);
  const started = Date.now();
  if (plain.length) {
    execFileSync(process.execPath, ['--test', ...plain], {cwd: ROOT, stdio: 'inherit'});
  }
  if (ts.length) {
    execFileSync(process.execPath, ['--import', './tests/ts-register.mjs', '--test', ...ts], {cwd: ROOT, stdio: 'inherit'});
  }
  console.log(`[test:changed] 全部 ${total} 个测试文件通过，用时 ${((Date.now() - started) / 1000).toFixed(2)}s`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const groupArg = args.find(a => a.startsWith('--group='))?.slice('--group='.length);
  const baseArg = args.find(a => a.startsWith('--base='))?.slice('--base='.length);

  if (groupArg) {
    const names = groupArg === 'all' ? Object.keys(TEST_GROUPS) : groupArg.split(',').map(s => s.trim()).filter(Boolean);
    const unknown = names.filter(n => !TEST_GROUPS[n]);
    if (unknown.length) {
      console.error(`未知测试分组: ${unknown.join(', ')}。可选: ${Object.keys(TEST_GROUPS).join(', ')}, all`);
      process.exit(1);
    }
    const map = new Map();
    for (const name of names) {
      for (const entry of TEST_GROUPS[name]) {
        const cur = map.get(entry.file);
        if (!cur || (!cur.ts && entry.ts)) map.set(entry.file, entry);
      }
    }
    const entries = [...map.values()];
    runSuite(entries.filter(e => !e.ts).map(e => e.file), entries.filter(e => e.ts).map(e => e.file), dryRun);
  } else {
    const changed = readGitChangedFiles(baseArg);
    const plan = selectTestsForFiles(changed);
    if (plan.groups.length) console.log(`[test:changed] 命中分组: ${plan.groups.join(', ')}`);
    runSuite(plan.plain, plan.ts, dryRun);
  }
}
