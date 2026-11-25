// Single place that knows where the project trees live.
//
// Resolution order for the Web tree:
//   1. Explicit JIGSAW_WEB_TREE override (absolute or relative to projectRoot)
//   2. Legacy dated worktree (`work/dual-managed-release-YYYYMMDD`) if present
//      (kept for compatibility with isolated test fixtures)
//   3. Unified Web mainline (`puzzle-play`)
import {existsSync, lstatSync, readdirSync, realpathSync, statSync} from 'node:fs';
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

/** Shared non-Git media store root (`<projectRoot>/media-store` or `JIGSAW_MEDIA_ROOT`). */
export function mediaRoot(projectRoot = defaultProjectRoot()) {
  const override = process.env.JIGSAW_MEDIA_ROOT;
  if (override) return isAbsolute(override) ? override : join(projectRoot, override);
  return join(projectRoot, 'media-store');
}

/** Resolve puzzles directory: local `<repoRoot>/public/puzzles` if present (test fixtures / legacy), else shared `media-store/puzzles`. */
export function mediaPuzzlesDir(projectRoot = defaultProjectRoot(), repoRoot = null) {
  if (repoRoot) {
    const local = join(repoRoot, 'public', 'puzzles');
    if (existsSync(local)) {
      if (lstatSync(local).isSymbolicLink()) throw Object.assign(new Error('素材路径包含符号链接，拒绝读取。'), {status: 409});
      return realpathSync(local);
    }
  }
  const shared = join(mediaRoot(projectRoot), 'puzzles');
  if (existsSync(shared)) {
    if (lstatSync(shared).isSymbolicLink()) throw Object.assign(new Error('共享图库路径包含符号链接，拒绝读取。'), {status: 409});
    return realpathSync(shared);
  }
  return repoRoot ? join(repoRoot, 'public', 'puzzles') : shared;
}

/** Resolve artwork directory: local `<repoRoot>/content/artwork` if present, else shared `media-store/artwork`. */
export function mediaArtworkDir(projectRoot = defaultProjectRoot(), repoRoot = null) {
  if (repoRoot) {
    const local = join(repoRoot, 'content', 'artwork');
    if (existsSync(local)) {
      if (lstatSync(local).isSymbolicLink()) throw Object.assign(new Error('素材路径包含符号链接，拒绝读取。'), {status: 409});
      return realpathSync(local);
    }
  }
  const shared = join(mediaRoot(projectRoot), 'artwork');
  if (existsSync(shared)) {
    if (lstatSync(shared).isSymbolicLink()) throw Object.assign(new Error('共享图库路径包含符号链接，拒绝读取。'), {status: 409});
    return realpathSync(shared);
  }
  return repoRoot ? join(repoRoot, 'content', 'artwork') : shared;
}
