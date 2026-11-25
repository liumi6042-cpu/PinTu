import {existsSync, lstatSync, realpathSync} from 'node:fs';
import {isAbsolute, join, relative, resolve, sep} from 'node:path';

/**
 * Resolve the puzzles/ or artwork/ directory for a repository.
 * Order:
 *   1. Local repo path (`public/puzzles` or `content/artwork`) when present — keeps
 *      deployed server bundles and isolated unit-test fixtures self-contained.
 *   2. Explicit `JIGSAW_MEDIA_ROOT` environment override.
 *   3. Workspace-level shared sibling `../media-store/<kind>`.
 */
export function resolveMediaDir(repoRoot, kind) {
  if (kind !== 'puzzles' && kind !== 'artwork') throw new Error('Unsupported media kind: ' + kind);
  const root = realpathSync(resolve(repoRoot));
  const local = kind === 'puzzles' ? join(root, 'public', 'puzzles') : join(root, 'content', 'artwork');
  if (existsSync(local)) {
    if (lstatSync(local).isSymbolicLink()) throw new Error('Asset paths cannot contain symbolic links: ' + local);
    return realpathSync(local);
  }

  const envRoot = process.env.JIGSAW_MEDIA_ROOT;
  if (envRoot) {
    const base = isAbsolute(envRoot) ? envRoot : resolve(root, envRoot);
    const candidate = join(base, kind);
    if (existsSync(candidate) && !lstatSync(candidate).isSymbolicLink()) return realpathSync(candidate);
  }

  const sibling = resolve(root, '..', 'media-store', kind);
  if (existsSync(sibling) && !lstatSync(sibling).isSymbolicLink()) return realpathSync(sibling);
  return local;
}

/** Validate a relative file path inside a base directory without traversing symlinks. */
export function safeMediaFile(baseDir, relPath) {
  if (typeof relPath !== 'string' || !relPath || relPath.includes('\\') || relPath.includes(':') || relPath.startsWith('/')
    || relPath.split('/').some(part => !part || part === '.' || part === '..')) {
    throw new Error('Unsafe relative media path: ' + relPath);
  }
  const root = realpathSync(resolve(baseDir));
  const target = resolve(root, relPath);
  const part = relative(root, target);
  if (!part || part === '..' || part.startsWith('..' + sep) || isAbsolute(part)) {
    throw new Error('Media path escaped base directory: ' + relPath);
  }
  let cursor = root;
  for (const segment of part.split(sep)) {
    cursor = join(cursor, segment);
    if (lstatSync(cursor).isSymbolicLink()) throw new Error('Media path contains symlink or junction: ' + relPath);
  }
  const real = realpathSync(target);
  if (!lstatSync(real).isFile()) throw new Error('Media target is not a regular file: ' + relPath);
  return real;
}

/** Resolve a repo-relative path, routing `public/puzzles/*` and `content/artwork/*` to shared media-store when detached. */
export function resolveRepoOrMediaFile(repoRoot, repoRelPath) {
  const norm = String(repoRelPath).replace(/^\/+/, '');
  if (norm.startsWith('public/puzzles/')) {
    return safeMediaFile(resolveMediaDir(repoRoot, 'puzzles'), norm.slice('public/puzzles/'.length));
  }
  if (norm.startsWith('content/artwork/')) {
    return safeMediaFile(resolveMediaDir(repoRoot, 'artwork'), norm.slice('content/artwork/'.length));
  }
  return safeMediaFile(repoRoot, norm);
}
