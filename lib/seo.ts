import type { Metadata } from 'next';
import { PHOTOS } from './puzzle-catalog';
import english from '../content/locales/en.json' with { type: 'json' };
export const SITE_URL = 'https://jigsawnook.online';
export const SITE_NAME = 'Jigsaw Nook';
export const englishCopy = (text: string) => (english as Record<string, string>)[text] || text;
export const puzzlePath = (id: string) => `/puzzle/${id}`;
export const PUBLIC_PAGES = {
  '/': { title: 'Free Online Jigsaw Puzzles with Friends', description: 'Play free online jigsaw puzzles at Jigsaw Nook. Join a public table with up to 8 players, or choose an original picture and 108–1,000 pieces to play in your browser.' },
  '/lobby': { title: 'Multiplayer Jigsaw Puzzles — Public Lobby', description: 'Join or create a free public jigsaw puzzle room with up to 8 players. No sign-in needed. See available tables and piece counts, then invite your friends.' },
  '/gallery': { title: 'Online Jigsaw Puzzle Gallery — 108 to 1,000 Pieces', description: 'Browse original nature, scenery and art jigsaw puzzles. Choose 108, 300, 500 or 1,000 pieces. Click a picture to start a free public puzzle with friends.' },
  '/help': { title: 'How to Play Online Jigsaw Puzzles — Help & Saves', description: 'Learn how to move and sort puzzle pieces, invite friends, save your progress and continue a puzzle at Jigsaw Nook. Get help with public tables and saved progress.' },
} as const;
export function isPublicSearchPage(path: string) {
  return Object.hasOwn(PUBLIC_PAGES, path) || PHOTOS.some(photo => puzzlePath(photo.id) === path);
}
export function publicMetadata(path: string, title: string, description: string, image = PHOTOS[0].thumbSrc): Metadata {
  const fullTitle = `${title} | ${SITE_NAME}`;
  return { title: { absolute: fullTitle }, description, alternates: { canonical: SITE_URL + path },
    robots: { index: true, follow: true, 'max-image-preview': 'large' },
    openGraph: { type: 'website', siteName: SITE_NAME, locale: 'en_US', url: SITE_URL + path, title: fullTitle, description, images: [{ url: SITE_URL + image, alt: title }] },
    twitter: { card: 'summary_large_image', title: fullTitle, description, images: [SITE_URL + image] },
  };
}
export function pageMetadata(path: keyof typeof PUBLIC_PAGES) { const page = PUBLIC_PAGES[path]; return publicMetadata(path, page.title, page.description); }
// Published project artwork only; never room IDs or private uploads.
export const searchPaths = () => [...Object.keys(PUBLIC_PAGES), ...PHOTOS.map(photo => puzzlePath(photo.id))];
export function jsonLd(value: unknown) { return JSON.stringify(value).replace(/</g, '\\u003c'); }
