const retiredGamePages=new Set(['/', '/lobby', '/gallery', '/albums', '/tasks', '/decorations', '/personal', '/personal/images', '/achievements', '/leaderboard', '/courtyard', '/wardrobe']);

/** Keep saved game links working without reopening the retired presentation. */
export function sharedGameEntry(pathname:string,search='',method='GET'):string|null {
 if(method!=='GET'&&method!=='HEAD')return null;
 const path=pathname.replace(/\/+$/,'')||'/',plain=path==='/zh'?'/':path.startsWith('/zh/')?path.slice(3):path;
 const room=plain.match(/^\/room\/([^/]+)$/);
 if(!room&&!retiredGamePages.has(plain)&&!/^\/puzzle\/[^/]+$/.test(plain))return null;
 const params=new URLSearchParams(search);
 if(room){let id:string;try{id=decodeURIComponent(room[1]);}catch{return null;}if(!/^[a-zA-Z0-9_-]+$/.test(id))return null;params.set('room',id);params.delete('roomId');}
 const query=params.toString();
 return '/play'+(query?'?'+query:'');
}
