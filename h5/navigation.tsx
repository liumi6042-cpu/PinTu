import { useSyncExternalStore, type AnchorHTMLAttributes } from 'react';
const event = 'jigsaw:h5-navigation';
export function routeUrl() {
  const raw = window.location.hash.slice(1);
  return new URL(raw.startsWith('/') ? raw : '/zh/lobby', window.location.origin);
}
export function currentPath() { return routeUrl().pathname; }
export function currentSearch() { return routeUrl().search; }
export function currentHref() { return routeUrl().href; }
export function currentHash() { return routeUrl().hash; }
export function hrefFor(path: string) {
  if (!path.startsWith('/') || path.startsWith('//')) return path;
  return new URL(document.baseURI).href.split('#')[0]+'#'+path;
}
export function navigate(path: string, replace = false) {
  if (!path.startsWith('/') || path.startsWith('//')) { window.location.assign(path); return; }
  // Language switching may append the browser hash to a route. Do not nest routes.
  const normalized = path.replace(/#\/.*$/, '');
  window.history[replace ? 'replaceState' : 'pushState'](null, '', hrefFor(normalized));
  window.dispatchEvent(new Event(event));
}
const subscribe = (fn: () => void) => {
  window.addEventListener(event,fn); window.addEventListener('hashchange',fn); window.addEventListener('popstate',fn);
  return () => { window.removeEventListener(event,fn); window.removeEventListener('hashchange',fn); window.removeEventListener('popstate',fn); };
};
export function usePathname() { return new URL(useSyncExternalStore(subscribe,currentHref,()=>window.location.origin+'/zh/lobby')).pathname; }
export function useSearchParams() { usePathname(); return new URLSearchParams(currentSearch()); }
export function useRouter() { return {push:(path:string)=>navigate(path),replace:(path:string)=>navigate(path,true),refresh:()=>window.dispatchEvent(new Event(event)),back:()=>history.back(),prefetch:()=>{}}; }
export function Link({href,children,...props}: AnchorHTMLAttributes<HTMLAnchorElement> & {href:string}) {return <a {...props} href={hrefFor(href)}>{children}</a>;}
export function installNavigation() {
  document.addEventListener('click', e => {
    if (!(e instanceof MouseEvent) || e.defaultPrevented || e.button || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const a = (e.target as Element)?.closest?.('a');
    if (!a || a.target || a.hasAttribute('download')) return;
    const href = a.getAttribute('href') || '';
    if (href.startsWith('/') && !href.startsWith('//')) { e.preventDefault(); navigate(href); }
  });
}
export function replaceRouteHistory(_state:unknown,_unused:string,path?:string|URL|null){if(path)navigate(String(path),true);}
