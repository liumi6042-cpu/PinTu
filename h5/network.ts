import { gatewayRequest } from './transport';
import { assetUrl, h5Config } from './config';
let pending: Promise<string> | undefined;
const nativeFetch = globalThis.fetch.bind(globalThis);
function storageKey() { return 'jigsaw:h5-session:'+h5Config().apiBase; }
async function createSession(signal?: AbortSignal) {
  try { const value=localStorage.getItem(storageKey());if(value&&/^[a-f0-9]{64}$/.test(value))return value; } catch { /* Session works in memory when storage is unavailable. */ }
  const response=await gatewayRequest(h5Config().apiBase+'/session',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}',credentials:'omit',signal});
  if(!response.ok)throw Error('暂时无法连接，请重试');
  const {token}=await response.json() as {token:string};
  if(!/^[a-f0-9]{64}$/.test(token))throw Error('Invalid H5 session');
  try {localStorage.setItem(storageKey(),token);}catch{}
  return token;
}
function session(signal?: AbortSignal) {
  return pending ??= (navigator.locks ? navigator.locks.request('jigsaw:h5-session:'+h5Config().apiBase,()=>createSession(signal)).then(value=>String(value)) : createSession(signal)).catch(error=>{pending=undefined;throw error;});
}
const mediaCache=new Map<string,{url:string;until:number}>();
export async function privateImageUrl(path:string) {
  const cached=mediaCache.get(path);if(cached&&cached.until>Date.now())return cached.url;
  const token=await session();
  const response=await gatewayRequest(h5Config().apiBase+'/media-ticket',{method:'POST',headers:{'Content-Type':'application/json','X-Jigsaw-H5-Session':token},body:JSON.stringify({path}),credentials:'omit'});
  if(!response.ok)throw Error('图片暂时无法读取，请重试');
  const data=await response.json() as {url:string;expiresAt:number};
  const url=new URL(data.url,h5Config().apiBase+'/').href;
  if(new URL(url).origin!==new URL(h5Config().apiBase).origin)throw Error('Invalid media gateway');
  if(mediaCache.size>512)mediaCache.clear();
  mediaCache.set(path,{url,until:data.expiresAt-10000});return url;
}
async function prepareData(value:unknown):Promise<unknown> {
  if(typeof value==='string') {
    if(/^\/api\/user-images\/custom-[a-f0-9]{32}(?:\?|$)/.test(value))return privateImageUrl(value);
    return assetUrl(value);
  }
  if(Array.isArray(value))return Promise.all(value.map(prepareData));
  if(value&&typeof value==='object') {
    const record=value as Record<string,unknown>;
    if(record.customImage&&typeof record.id==='string') {
      const image=record.customImage as Record<string,unknown>;
      if(typeof image.id==='string') {
        const path='/api/user-images/'+image.id+'?room='+encodeURIComponent(record.id);
        image.h5Src=await privateImageUrl(path);image.h5ThumbSrc=await privateImageUrl(path+'&preview=1');
      }
    }
    return Object.fromEntries(await Promise.all(Object.entries(record).map(async ([k,v])=>[k,['puzzle','groups','members','leases','syncHistory','upserts','participants'].includes(k)?v:await prepareData(v)])));
  }
  return value;
}
export async function apiFetch(input:RequestInfo|URL,init?:RequestInit):Promise<Response> {
  const path=typeof input==='string'?input:input instanceof URL?input.href:input.url;
  if(!path.startsWith('/api/'))return nativeFetch(assetUrl(path),init);
  const token=await session(init?.signal??undefined),headers=new Headers(init?.headers);
  headers.set('X-Jigsaw-H5-Session',token);
  const response=await gatewayRequest(h5Config().apiBase+path,{...init,headers,credentials:'omit'});
  if(response.headers.get('X-Jigsaw-H5-Session-Expired')==='1') {
    pending=undefined;try{localStorage.removeItem(storageKey());}catch{}
    throw Error('连接凭证已过期，请刷新后重新加入房间');
  }
  const originalJson=response.json.bind(response);
  response.json=async()=>prepareData(await originalJson());
  return response;
}
export async function gatewayConfig() {
  const response=await gatewayRequest(h5Config().apiBase+'/config',{credentials:'omit',signal:AbortSignal.timeout(8000)});
  if(!response.ok)throw Error('广告暂未开放');return response.json() as Promise<{rewardedAdUnitId?:string;adRewardEnabled:boolean}>;
}

export async function gatewayFetch(path:string,init?:RequestInit){
 const token=await session(init?.signal??undefined),headers=new Headers(init?.headers);headers.set('X-Jigsaw-H5-Session',token);
 const response=await gatewayRequest(h5Config().apiBase+path,{...init,headers,credentials:'omit'});
 return response;
}
