export type LoginLog={add(text:string):void;lines():string[]};

/** In-memory login trail for the login dialog and settings. Callers log stages, sizes and status codes only: never login codes, tokens, ids, nicknames or raw native messages. */
export function createLoginLog(limit=40,now:()=>number=()=>Date.now()):LoginLog{
 const start=now(),entries:string[]=[];
 return {
  add(text){entries.push('+'+(Math.max(0,now()-start)/1000).toFixed(2)+'s '+String(text).slice(0,200));if(entries.length>limit)entries.splice(0,entries.length-limit);},
  lines:()=>[...entries],
 };
}
