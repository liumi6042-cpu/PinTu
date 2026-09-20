// Address helpers with no heavy imports. The language switch runs in the browser,
// and pulling lib/seo.ts in would drag the puzzle engine along with it.
export const PUBLIC_PAGE_PATHS = ['/', '/lobby', '/gallery', '/help'] as const;
export const zhPath = (path: string) => (path === '/' ? '/zh' : `/zh${path}`);
export const isChinesePath = (path: string) => path === '/zh' || path.startsWith('/zh/');
export const englishPath = (path: string) => (path === '/zh' ? '/' : path.replace(/^\/zh(?=\/)/, ''));
// Matches the shape of a puzzle address rather than checking the catalog, so it can
// run in the browser. lib/seo.ts has the exact check for the server and tests.
export function hasChineseAddress(path: string) {
  const canonical = isChinesePath(path) ? englishPath(path) : path;
  return (PUBLIC_PAGE_PATHS as readonly string[]).includes(canonical) || /^\/puzzle\/[a-z0-9]+(?:-[a-z0-9]+)*$/.test(canonical);
}
