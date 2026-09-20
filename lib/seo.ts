import type { Metadata } from 'next';
import { PHOTOS } from './puzzle-catalog';
import { maximumPieces } from './piece-policy';
import english from '../content/locales/en.json' with { type: 'json' };
import { englishPath,isChinesePath,zhPath } from './site-paths';
export { englishPath,isChinesePath,zhPath };
export const SITE_URL = 'https://jigsawnook.online';
export const SITE_NAME = 'Jigsaw Nook';
export const ZH_SITE_NAME = '一起拼图';
export const englishCopy = (text: string) => (english as Record<string, string>)[text] || text;
export const puzzlePath = (id: string) => `/puzzle/${id}`;
export const PUBLIC_PAGES = {
  '/': { title: 'Free Online Jigsaw Puzzles with Friends', description: 'Play free online jigsaw puzzles at Jigsaw Nook. Join a public table with up to 8 players, or choose an original picture and 108–1,000 pieces to play in your browser.' },
  '/lobby': { title: 'Multiplayer Jigsaw Puzzles — Public Lobby', description: 'Join a free public jigsaw puzzle room with up to 8 players. Any piece count can be joined as a guest; only creating a puzzle of 500 pieces or more needs a free account.' },
  '/gallery': { title: 'Online Jigsaw Puzzle Gallery — 108 to 1,000 Pieces', description: 'Browse original nature, scenery and art jigsaw puzzles. Choose 108, 300, 500 or 1,000 pieces. Click a picture to start a free public puzzle with friends.' },
  '/help': { title: 'How to Play Online Jigsaw Puzzles — Help & Saves', description: 'Learn how to move and sort puzzle pieces, invite friends, save your progress and continue a puzzle at Jigsaw Nook. Get help with public tables and saved progress.' },
} as const;
// Chinese pages live under /zh and are written for Chinese search engines rather than
// translated from the English copy: the phrasing follows what people actually type,
// and the numbers match the board the site really offers.
export const ZH_PUBLIC_PAGES: Record<keyof typeof PUBLIC_PAGES, { title: string; description: string }> = {
  '/': { title: '免费在线拼图 — 和朋友一起拼', description: '在「一起拼图」免费玩在线拼图。加入最多 8 人的公开拼图桌，或从原创画面里挑一张，选 108–1,000 片，打开浏览器就能开始。' },
  '/lobby': { title: '多人拼图大厅 — 公开房间随时加入', description: '加入免费的公开拼图房间，最多 8 人一起拼。任何片数都可以游客身份加入；只有创建 500 片以上的拼图才需要免费账号。' },
  '/gallery': { title: '在线拼图图库 — 108 到 1,000 片', description: '浏览自然、风景与艺术类原创画面，可选 108、300、500 或 1,000 片。点一张图就能开一桌，和朋友一起拼。' },
  '/help': { title: '在线拼图怎么玩 — 玩法与存档说明', description: '了解怎么移动和整理拼块、邀请朋友、保存进度，以及如何继续一局没拼完的拼图，还有公开拼图桌的常见问题。' },
};
export function isPublicSearchPage(path: string) {
  const canonical = isChinesePath(path) ? englishPath(path) : path;
  return Object.hasOwn(PUBLIC_PAGES, canonical) || PHOTOS.some(photo => puzzlePath(photo.id) === canonical);
}
export const hasChineseVersion = (path: string) => isPublicSearchPage(zhPath(path));
function alternateLanguages(path: string, canonical: string) {
  // Only public pages are paired; both directions point at the same pair so the
  // English and Chinese copies declare each other rather than themselves alone.
  const english2 = isChinesePath(canonical) ? englishPath(canonical) : canonical;
  return { en: SITE_URL + english2, 'zh-CN': SITE_URL + zhPath(english2), 'x-default': SITE_URL + english2 };
}
export function publicMetadata(path: string, title: string, description: string, image = PHOTOS[0].thumbSrc, siteName = SITE_NAME): Metadata {
  const fullTitle = `${title} | ${siteName}`, chinese = isChinesePath(path);
  return { title: { absolute: fullTitle }, description, alternates: { canonical: SITE_URL + path, languages: alternateLanguages(path, path) },
    robots: { index: true, follow: true, 'max-image-preview': 'large' },
    openGraph: { type: 'website', siteName, locale: chinese ? 'zh_CN' : 'en_US', url: SITE_URL + path, title: fullTitle, description, images: [{ url: SITE_URL + image, alt: title }] },
    twitter: { card: 'summary_large_image', title: fullTitle, description, images: [SITE_URL + image] },
  };
}
export function pageMetadata(path: keyof typeof PUBLIC_PAGES) { const page = PUBLIC_PAGES[path]; return publicMetadata(path, page.title, page.description); }
// The Chinese title leads with the artwork name — that is the only part of the page
// that is unique to this picture — and the generic phrase follows it.
export function zhPuzzleMetadata(photo: { id: string; title: string; subtitle: string; thumbSrc: string }) {
  const pieces = maximumPieces(photo.id).toLocaleString('zh-CN');
  return publicMetadata(zhPath(puzzlePath(photo.id)), `${photo.title} — 免费在线拼图`, `${photo.subtitle} 在浏览器里直接拼这张图，最高可选 ${pieces} 片，也可以开一桌和朋友一起拼。`, photo.thumbSrc, ZH_SITE_NAME);
}
export function zhPageMetadata(path: keyof typeof ZH_PUBLIC_PAGES) { const page = ZH_PUBLIC_PAGES[path]; return publicMetadata(zhPath(path), page.title, page.description, PHOTOS[0].thumbSrc, ZH_SITE_NAME); }
// Published project artwork only; never room IDs or private uploads.
export const englishSearchPaths = () => [...Object.keys(PUBLIC_PAGES), ...PHOTOS.map(photo => puzzlePath(photo.id))];
export const searchPaths = () => { const paths = englishSearchPaths(); return [...paths, ...paths.map(zhPath)]; };
export function jsonLd(value: unknown) { return JSON.stringify(value).replace(/</g, '\\u003c'); }
