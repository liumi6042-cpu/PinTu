// Address helpers with no heavy imports. The language switch runs in the browser,
// and pulling lib/seo.ts in would drag the puzzle engine along with it.
export const PUBLIC_PAGE_PATHS = ['/', '/lobby', '/gallery', '/help', '/albums', '/tasks', '/decorations'] as const;
export const zhPath = (path: string) => (path === '/' ? '/zh' : `/zh${path}`);
export const isChinesePath = (path: string) => path === '/zh' || path.startsWith('/zh/');
export const englishPath = (path: string) => (path === '/zh' ? '/' : path.replace(/^\/zh(?=\/)/, ''));
// Matches the shape of a puzzle address rather than checking the catalog, so it can
// run in the browser. lib/seo.ts has the exact check for the server and tests.
export function hasChineseAddress(path: string) {
  const canonical = isChinesePath(path) ? englishPath(path) : path;
  return (PUBLIC_PAGE_PATHS as readonly string[]).includes(canonical) || /^\/puzzle\/[a-z0-9]+(?:-[a-z0-9]+)*$/.test(canonical);
}
// Which button the language switch lights up. On a page that exists at two addresses the
// address itself is the truth — a Chinese-reading visitor on /lobby is reading English, so
// "EN" is the lit one, and pressing 中文 moves them to the Chinese address. Pages without a
// Chinese twin keep following the visitor's own choice.
export function activeLanguage(path: string, preference: 'zh' | 'en' | 'auto') {
  return hasChineseAddress(path) ? (isChinesePath(path) ? 'zh' : 'en') : preference;
}
