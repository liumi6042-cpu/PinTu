import { NextResponse,type NextRequest } from 'next/server';
import { settings } from './lib/site-settings';
import { securityLimit } from './lib/account-security';
import { isPublicSearchPage } from './lib/seo';

export async function middleware(request:NextRequest) {
  const s=settings(),local=!!s.PUZZLE_LOCAL_ORIGIN;
  let response:NextResponse;
  if(!local&&(!s.PUZZLE_PUBLIC_ORIGIN||new URL(request.url).origin!==s.PUZZLE_PUBLIC_ORIGIN)) {
    response=NextResponse.json({error:'Service configuration is incomplete.'},{status:503});
  } else {
    try {
      // In local mode the existing gateway enforces socket-IP limits. Hosted
      // requests must retain Cloudflare's ingress IP; never trust X-Forwarded-For.
      if(!local&&request.nextUrl.pathname.startsWith('/api/auth/')&&request.method==='POST') {
        const ip=request.headers.get('cf-connecting-ip');
        if(!ip)return NextResponse.json({error:'Authentication service is unavailable.'},{status:503});
        await securityLimit('auth-ip',ip,40);
      }
      response=NextResponse.next();
    } catch {
      response=NextResponse.json({error:'Too many requests. Please try again later.'},{status:429,headers:{'Retry-After':'900'}});
    }
  }
  response.headers.set('X-Content-Type-Options','nosniff');
  // Allow only curated, stable public pages. Room and account URLs stay excluded.
  const searchable=!local && response.status<400 && !request.nextUrl.search && isPublicSearchPage(request.nextUrl.pathname);
  response.headers.set('X-Robots-Tag',searchable?'index, follow, max-image-preview:large':'noindex, nofollow');
  response.headers.set('Referrer-Policy','no-referrer');
  response.headers.set('Permissions-Policy','camera=(), microphone=(), geolocation=()');
  response.headers.set('Content-Security-Policy',"object-src 'none'; base-uri 'self'; frame-ancestors 'self'");
  if(!local&&new URL(request.url).protocol==='https:')response.headers.set('Strict-Transport-Security','max-age=31536000');
  return response;
}
export const config={matcher:['/((?!assets|puzzles|intro|favicon).*)']};
