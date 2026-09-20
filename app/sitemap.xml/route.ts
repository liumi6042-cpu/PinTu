import { englishSearchPaths, zhPath, SITE_URL } from '@/lib/seo';
export function GET() {
  // Each page is listed twice, once per language, and both entries carry the same
  // hreflang set so search engines pair the two copies instead of treating the
  // Chinese pages as duplicates of the English ones.
  const urls = englishSearchPaths().map(path => {
    const english = SITE_URL + path, chinese = SITE_URL + zhPath(path);
    const alternates = `<xhtml:link rel="alternate" hreflang="en" href="${english}"/><xhtml:link rel="alternate" hreflang="zh-CN" href="${chinese}"/><xhtml:link rel="alternate" hreflang="x-default" href="${english}"/>`;
    return `<url><loc>${english}</loc>${alternates}</url><url><loc>${chinese}</loc>${alternates}</url>`;
  }).join('');
  return new Response(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">${urls}</urlset>`, {
    headers: { 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': 'public, max-age=3600' },
  });
}
