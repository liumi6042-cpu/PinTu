import { NextResponse,type NextRequest } from 'next/server';
import { settings } from './lib/site-settings';
import { securityLimit } from './lib/account-security';
import { isPublicSearchPage } from './lib/seo';
import { cookieLanguage,LANGUAGE_COOKIE } from './lib/language-detection';
import { isEntrancePath, languageRedirect } from './lib/entrance-preference';
import { sharedGameEntry } from './lib/shared-game-entry';

export async function middleware(request:NextRequest) {
  const s=settings(),local=!!s.PUZZLE_LOCAL_ORIGIN;
  let response:NextResponse;
  // Resolve legacy game addresses before language routing; /play has one shared UI.
  const gameTarget=sharedGameEntry(request.nextUrl.pathname,request.nextUrl.search,request.method);
  // A visitor who picked a language reaches the address that speaks it, whatever entry they
  // typed: choosing 中文 on /lobby, or opening / with Chinese chosen, lands on the Chinese
  // address. Crawlers send no cookie and are never redirected.
  const languageTarget=languageRedirect(request.nextUrl.pathname,cookieLanguage(request.cookies.get(LANGUAGE_COOKIE)?.value));
  // The root layout owns <html>, so it cannot read the path itself. Handing it the
  // path lets it declare the right language in the markup a crawler receives,
  // which the Content-Language header alone does not cover.
  const requestHeaders=new Headers(request.headers);
  requestHeaders.set('x-jigsaw-path',request.nextUrl.pathname);
  if(!local&&(!s.PUZZLE_PUBLIC_ORIGIN||new URL(request.url).origin!==s.PUZZLE_PUBLIC_ORIGIN)) {
    response=NextResponse.json({error:'Service configuration is incomplete.'},{status:503});
  } else if(gameTarget) {
    response=NextResponse.redirect(new URL(gameTarget,request.url));
  } else if(languageTarget) {
    // Language preference is a temporary redirect from the canonical public address.
    response=NextResponse.redirect(new URL(languageTarget+request.nextUrl.search,request.url));
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
  // Keep language and game-link redirects out of shared caches.
  if(gameTarget||isEntrancePath(request.nextUrl.pathname)||languageTarget) {
    response.headers.set('Vary','Cookie');
    response.headers.set('Cache-Control','private, no-store');
  }
  // Allow only curated, stable public pages. Room and account URLs stay excluded.
  const path=request.nextUrl.pathname;
  const searchable=!local && response.status<400 && !gameTarget && !languageTarget && !request.nextUrl.search && isPublicSearchPage(path);
  if(path!=='/robots.txt'&&path!=='/sitemap.xml')response.headers.set('X-Robots-Tag',searchable?'index, follow, max-image-preview:large':'noindex, nofollow');
  response.headers.set('Referrer-Policy','no-referrer');
  response.headers.set('Permissions-Policy','camera=(), microphone=(), geolocation=()');
  response.headers.set('Content-Security-Policy',"object-src 'none'; base-uri 'self'; frame-ancestors 'self'");
  if(!local&&new URL(request.url).protocol==='https:')response.headers.set('Strict-Transport-Security','max-age=31536000');
  return response;
}
export const config={matcher:['/((?!assets|puzzles|intro|favicon).*)']};
