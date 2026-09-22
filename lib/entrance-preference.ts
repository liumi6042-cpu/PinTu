import { englishPath,hasChineseAddress,isChinesePath,zhPath } from './site-paths';

// The entrance is worth showing once. After that a visitor who has already stood in the
// lobby wants the tables, not the introduction — but the entrance is also the page that
// explains what this site is to everyone else, so the skip has to be narrow:
//
//  * only the two entrance addresses, and only without the `home` parameter, which is
//    what the brand link in the lobby uses to reach the entrance on purpose;
//  * a cookie rather than local storage, because the middleware decides before anything
//    renders — a client-side redirect would flash the entrance first;
//  * a crawler sends no cookie, so it always receives the entrance page itself.
export const ENTRANCE_COOKIE='puzzle-entered';
export const ENTRANCE_BYPASS='home';
export function entrancePaths(){return ['/','/zh'];}
export function isEntrancePath(pathname:string){return entrancePaths().includes(pathname);}
export function lobbyFor(pathname:string){return pathname==='/zh'?'/zh/lobby':'/lobby';}
// A visitor who picked a language is sent to the matching address of the page they asked for:
// the entrance to /zh, a table to /zh/lobby, a picture to /zh/puzzle/<id>, and back again for
// an English choice. Only an explicit choice redirects — a crawler and a first-time visitor
// send no cookie and see exactly the address they requested, which is what hreflang promises.
export function languageRedirect(pathname:string,cookieLanguage:'zh'|'en'|null){
  if(!cookieLanguage||!hasChineseAddress(pathname))return null;
  const chinese=isChinesePath(pathname);
  if(cookieLanguage==='zh')return chinese?null:zhPath(pathname);
  return chinese?englishPath(pathname):null;
}
export function skipsEntrance(pathname:string,bypass:boolean,cookie:string|undefined){
  return isEntrancePath(pathname)&&!bypass&&cookie==='1';
}
export function markLobbyVisited(){
  if(typeof document==='undefined')return;
  // A year is long enough to read as "this browser knows the site", and short enough
  // that a forgotten browser eventually gets the introduction again.
  try{document.cookie=ENTRANCE_COOKIE+'=1; path=/; max-age=31536000; SameSite=Lax';}catch{}
}
