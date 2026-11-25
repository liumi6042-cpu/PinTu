// Single place that knows where the project trees live.
//
// Resolution order for the Web tree:
//   1. Explicit JIGSAW_WEB_TREE override (absolute or relative to projectRoot)
//   2. Legacy dated worktree (`work/dual-managed-release-YYYYMMDD`) if present
//      (kept for compatibility with isolated test fixtures)
//   3. Unified Web mainline (`puzzle-play`)
import {existsSync, readdirSync, statSync} from 'node:fs';
import {dirname, isAbsolute, join, relative, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const WEB_TREE_PATTERN = /^dual-managed-release-\d{8}$/;

/** Default workspace root resolved relative to content-admin (portable across machines). */
export function defaultProjectRoot() {
  return resolve(dirname(fileURLToPath(import.meta.url)), '..');
}

function discoverLegacyWebTree(projectRoot) {
  const work = join(projectRoot, 'work');
  if (!existsSync(work)) return null;
  const candidates = readdirSync(work)
    .filter(name => WEB_TREE_PATTERN.test(name) && statSync(join(work, name)).isDirectory())
    .sort();
  return candidates.length ? join(work, candidates[candidates.length - 1]) : null;
}

/** Absolute path of the Web tree currently in use. */
export function webTree(projectRoot = defaultProjectRoot()) {
  const override = process.env.JIGSAW_WEB_TREE;
  if (override) return isAbsolute(override) ? override : join(projectRoot, override);
  const legacy = discoverLegacyWebTree(projectRoot);
  if (legacy) return legacy;
  const unified = join(projectRoot, 'puzzle-play');
  if (existsSync(unified)) return unified;
  throw new Error('找不到 Web 项目目录：' + unified);
}

/** POSIX-style path relative to the project, for code that validates segments. */
export function webTreeName(projectRoot = defaultProjectRoot()) {
  return relative(projectRoot, webTree(projectRoot)).split('\\').join('/');
}

export function mobileTree(projectRoot = defaultProjectRoot()) {
  return join(projectRoot, 'jigsaw-nook-taptap');
}

/** Web mainline tree (also used as baseline reference in source.mjs). */
export function pcTree(projectRoot = defaultProjectRoot()) {
  return join(projectRoot, 'puzzle-play');
}
