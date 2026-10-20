// Single place that knows where the three trees live.
//
// The Web tree is a dated git worktree (`work/dual-managed-release-YYYYMMDD`)
// created per release, so a hard-coded name turns one rotation into a pile of
// ERR_MODULE_NOT_FOUND. Resolve it here instead: explicit override first, then
// the newest directory that matches the release pattern.
import {existsSync, readdirSync, statSync} from 'node:fs';
import {isAbsolute, join, relative} from 'node:path';

const WEB_TREE_PATTERN = /^dual-managed-release-\d{8}$/;

function discoverWebTree(projectRoot) {
  const work = join(projectRoot, 'work');
  if (!existsSync(work)) return null;
  const candidates = readdirSync(work)
    .filter(name => WEB_TREE_PATTERN.test(name) && statSync(join(work, name)).isDirectory())
    .sort();
  return candidates.length ? join(work, candidates[candidates.length - 1]) : null;
}

/** Absolute path of the Web release worktree currently in use. */
export function webTree(projectRoot) {
  const override = process.env.JIGSAW_WEB_TREE;
  if (override) return isAbsolute(override) ? override : join(projectRoot, override);
  const found = discoverWebTree(projectRoot);
  if (!found) throw new Error('找不到 Web 发布工作树：' + join(projectRoot, 'work/dual-managed-release-YYYYMMDD'));
  return found;
}

/** POSIX-style path relative to the project, for code that validates segments. */
export function webTreeName(projectRoot) {
  return relative(projectRoot, webTree(projectRoot)).split('\\').join('/');
}

export function mobileTree(projectRoot) {
  return join(projectRoot, 'jigsaw-nook-taptap');
}

/** Retired PC baseline; read-only reference, never a delivery target. */
export function pcTree(projectRoot) {
  return join(projectRoot, 'puzzle-play');
}
