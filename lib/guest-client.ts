let pending:Promise<void>|null=null;
function newSecret(){return Array.from(crypto.getRandomValues(new Uint8Array(32)),v=>v.toString(16).padStart(2,'0')).join('');}
// A read/write transaction serializes first visits across tabs, including LAN HTTP.
function browserSecret():Promise<string>{return new Promise((resolve,reject)=>{
 if(typeof indexedDB==='undefined'){reject(new Error('Browser storage unavailable'));return;}
 const request=indexedDB.open('together-puzzle-identity',1);
 request.onupgradeneeded=()=>{request.result.createObjectStore('identity');};
 request.onerror=()=>reject(request.error);
 request.onsuccess=()=>{
  const db=request.result,transaction=db.transaction('identity','readwrite'),store=transaction.objectStore('identity'),read=store.get('guest');let secret:string;
  read.onsuccess=()=>{secret=typeof read.result==='string'&&/^[a-f0-9]{64}$/.test(read.result)?read.result:newSecret();if(secret!==read.result)store.put(secret,'guest');};
  transaction.oncomplete=()=>{db.close();resolve(secret);};
  transaction.onabort=()=>{db.close();reject(transaction.error);};
 };
});}
export function ensureGuestSession(){
 if(pending)return pending;
 pending=(async()=>{
  const secret=await guestCreationSecret();
  const response=await fetch('/api/guest',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({secret}),cache:'no-store',signal:AbortSignal.timeout(12000)});
  if(!response.ok)throw new Error('暂时无法连接，请重试');
 })().finally(()=>{pending=null;});
 return pending;
}
// Creation can establish the same stable cookie in its own response. No network
// round trip is needed just to obtain the browser's existing identity secret.
export function guestCreationSecret(){
 return browserSecret().catch(()=>{
   // Cookie-backed sessions still work if browser database storage is disabled.
   try{const saved=localStorage.getItem('puzzle:guest-fallback');if(saved&&/^[a-f0-9]{64}$/.test(saved))return saved;const value=newSecret();localStorage.setItem('puzzle:guest-fallback',value);return value;}catch{return newSecret();}
  });
}
