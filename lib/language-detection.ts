export type Language = 'zh' | 'en';
export type LanguagePreference = Language | 'auto';
export const LANGUAGE_KEY = 'puzzle:language';
// An explicit choice also travels as a cookie: the middleware has to know it before anything
// renders, so a Chinese-reading visitor who chose Chinese is sent to the Chinese address
// instead of the English one. Not HttpOnly — this is the visitor's own switch.
export const LANGUAGE_COOKIE = 'puzzle-language';
export function writeLanguageCookie(value: Language) {
  if (typeof document === 'undefined') return;
  try { document.cookie = `${LANGUAGE_COOKIE}=${value}; path=/; max-age=31536000; SameSite=Lax`; } catch {}
}
export function clearLanguageCookie() {
  if (typeof document === 'undefined') return;
  try { document.cookie = `${LANGUAGE_COOKIE}=; path=/; max-age=0; SameSite=Lax`; } catch {}
}
export function cookieLanguage(value: string | undefined): Language | null {
  return value === 'zh' || value === 'en' ? value : null;
}

export function languagePreference(value: string | null): LanguagePreference {
  return value === 'zh' || value === 'en' ? value : 'auto';
}

export function countryLanguage(country: string | null): Language | null {
  const code = country?.trim().toUpperCase();
  if (!code || !/^[A-Z]{2}$/.test(code) || code === 'XX' || code === 'ZZ') return null;
  return ['CN', 'HK', 'MO', 'TW'].includes(code) ? 'zh' : 'en';
}

export function browserLanguage(languages: readonly string[]): Language {
  for (const value of languages) {
    const tag = value.trim().toLowerCase();
    if (/^zh(?:-|$)/.test(tag)) return 'zh';
    if (/^en(?:-|$)/.test(tag)) return 'en';
  }
  return 'en';
}

// The reverse proxy overwrites this header only for verified Cloudflare peers.
// Never accept a country or IP supplied through query parameters or raw CF headers.
export function localeResponse(request: Request, local: boolean) {
  const language = local ? null : countryLanguage(request.headers.get('x-puzzle-country'));
  return Response.json({ language, source: language ? 'ip' : 'browser' }, {
    headers: {
      'Cache-Control': 'private, no-store',
      'CDN-Cache-Control': 'no-store',
      'Cloudflare-CDN-Cache-Control': 'no-store',
      'X-Robots-Tag': 'noindex, nofollow',
    },
  });
}

export async function detectLanguage(fallback: Language, signal: AbortSignal, fetcher = fetch): Promise<Language> {
  try {
    const response = await fetcher('/api/locale', { cache: 'no-store', credentials: 'omit', signal });
    if (!response.ok) return fallback;
    const result: unknown = await response.json();
    if (!result || typeof result !== 'object' || !('source' in result) || !('language' in result)) return fallback;
    return result.source === 'ip' && (result.language === 'zh' || result.language === 'en') ? result.language : fallback;
  } catch {
    return fallback;
  }
}
