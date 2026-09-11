import { searchPaths, SITE_URL } from '@/lib/seo';
export function GET() {
  const urls = searchPaths().map(path => `<url><loc>${SITE_URL}${path}</loc></url>`).join('');
  return new Response(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls}</urlset>`, {
    headers: { 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': 'public, max-age=3600' },
  });
}
