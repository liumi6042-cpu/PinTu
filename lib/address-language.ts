import { englishFor, t } from './i18n';
import { hasChineseAddress, isChinesePath } from './site-paths';

// Which language a page's copy is in, decided by the address alone. Kept free of React and of
// next/navigation so it can be unit-tested and called from both.
//
// A public page that exists in both languages speaks the language of the address it was reached
// at, in both directions: /lobby is English even for a visitor whose browser reads Chinese, and
// /zh/lobby is Chinese even for a visitor whose browser reads English. Mixing the two rules is
// what left a Chinese lobby carrying an English resume card and an English day's picture.
// A page with no Chinese twin follows the visitor, because forcing an address there would push a
// Chinese visitor into English.
export function addressCopy<T>(pathname: string, text: T): T {
  if (typeof text !== 'string') return text;
  if (!hasChineseAddress(pathname)) return t(text);
  return isChinesePath(pathname) ? text : englishFor(text);
}
