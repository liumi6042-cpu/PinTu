import { NextResponse,type NextRequest } from 'next/server';
import { settings } from './lib/site-settings';
import { securityLimit } from './lib/account-security';
import { isPublicSearchPage } from './lib/seo';
import { cookieLanguage,LANGUAGE_COOKIE } from './lib/language-detection';
import { ENTRANCE_BYPASS, ENTRANCE_COOKIE, isEntrancePath, languageRedirect, skipsEntrance } from './lib/entrance-preference';

export async function middleware(request:NextRequest) {
  const s=settings(),local=!!s.PUZZLE_LOCAL_ORIGIN;
  let response:NextResponse;
  // A visitor who picked a language reaches the address that speaks it, whatever entry they
  // typed: choosing 中文 on /lobby, or opening / with Chinese chosen, lands on the Chinese
  // address. Crawlers send no cookie and are never redirected.
  const languageTarget=languageRedirect(request.nextUrl.pathname,cookieLanguage(request.cookies.get(LANGUAGE_COOKIE)?.value));
  // Someone who has already been in the lobby does not need the entrance again. This is
  // decided here, before anything renders, so the entrance never flashes first; a
  // request with no cookie — every crawler — still gets the entrance page itself.
  const skipEntrance=skipsEntrance(request.nextUrl.pathname,request.nextUrl.searchParams.has(ENTRANCE_BYPASS),request.cookies.get(ENTRANCE_COOKIE)?.value);
  // The root layout owns <html>, so it cannot read the path itself. Handing it the
  // path lets it declare the right language in the markup a crawler receives,
  // which the Content-Language header alone does not cover.
  const requestHeaders=new Headers(request.headers);
  requestHeaders.set('x-jigsaw-path',request.nextUrl.pathname);
  if(!local&&(!s.PUZZLE_PUBLIC_ORIGIN||new URL(request.url).origin!==s.PUZZLE_PUBLIC_ORIGIN)) {
    response=NextResponse.json({error:'Service configuration is incomplete.'},{status:503});
  } else if(languageTarget) {
    // Temporary on purpose, like the entrance skip: both exist for the visitor, not for
    // search engines, which never send the cookie that triggers them.
    response=NextResponse.redirect(new URL(languageTarget+request.nextUrl.search,request.url));
  } else if(skipEntrance) {
    // Temporary on purpose: the entrance stays this address's page for search engines
    // and for anyone arriving for the first time.
    response=NextResponse.redirect(new URL('/play',request.url));
  } else {
    try {
      // In local mode the existing gateway enforces socket-IP limits. Hosted
      // requests must retain Cloudflare's ingress IP; never trust X-Forwarded-For.
      if(!local&&request.nextUrl.pathname.startsWith('/api/auth/')&&request.method==='POST') {
        const ip=request.headers.get('cf-connecting-ip');
        if(!ip)return NextResponse.json({error:'Authentication service is unavailable.'},{status:503});
        await securityLimit('auth-ip',ip,40);
      }
      response=NextResponse.next({request:{headers:requestHeaders}});
    } catch {
      response=NextResponse.json({error:'Too many requests. Please try again later.'},{status:429,headers:{'Retry-After':'900'}});
    }
  }
  response.headers.set('X-Content-Type-Options','nosniff');
  // The entrance answers differently depending on a cookie, so it must never be served
  // from a shared cache: a cached redirect would send a first-time visitor to the
  // lobby, and a cached entrance would hide the lobby from a returning one. The same
  // holds for a language redirect, which only ever happens for a visitor with a cookie.
  if(isEntrancePath(request.nextUrl.pathname)||languageTarget) {
    response.headers.set('Vary','Cookie');
    response.headers.set('Cache-Control','private, no-store');
  }
  // Allow only curated, stable public pages. Room and account URLs stay excluded.
  const searchable=!local && response.status<400 && !skipEntrance && !languageTarget && !request.nextUrl.search && isPublicSearchPage(request.nextUrl.pathname);
  response.headers.set('X-Robots-Tag',searchable?'index, follow, max-image-preview:large':'noindex, nofollow');
  response.headers.set('Referrer-Policy','no-referrer');
  response.headers.set('Permissions-Policy','camera=(), microphone=(), geolocation=()');
  response.headers.set('Content-Security-Policy',"object-src 'none'; base-uri 'self'; frame-ancestors 'self'");
  if(!local&&new URL(request.url).protocol==='https:')response.headers.set('Strict-Transport-Security','max-age=31536000');
  return response;
}
export const config={matcher:['/((?!assets|puzzles|intro|favicon).*)']};
