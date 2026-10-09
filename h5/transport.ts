type NativeReply={statusCode:number;data:string|ArrayBuffer|object;header?:Record<string,string>};
type RequestHost={request?:(options:{url:string;method:string;data?:string;header:Record<string,string>;dataType:string;responseType:string;timeout:number;enableCache:boolean;success:(result:NativeReply)=>void;fail:(error:{errMsg?:string;errno?:number})=>void})=>{abort?:()=>void}};
const browserFetch=globalThis.fetch.bind(globalThis);
export async function gatewayRequest(url:string,init:RequestInit={}):Promise<Response>{
 const host=window.tap as unknown as RequestHost|undefined,method=(init.method||'GET').toUpperCase();
 if(!host?.request||!['GET','POST','DELETE'].includes(method)||init.body!=null&&typeof init.body!=='string'){
  try{return await browserFetch(url,{...init,credentials:'omit'});}catch(error){if(error instanceof TypeError)throw new Error('网络连接失败，请点击重新连接（WEB-NET）');throw error;}
 }
 if(init.signal?.aborted)throw init.signal.reason;
 return new Promise((resolve,reject)=>{
  let done=false,task:{abort?:()=>void}|undefined;
  const finish=(action:()=>void)=>{if(done)return;done=true;clearTimeout(timer);init.signal?.removeEventListener('abort',abort);action();};
  const abort=()=>finish(()=>{task?.abort?.();reject(init.signal?.reason??new DOMException('请求已取消','AbortError'));});
  const timer=setTimeout(()=>finish(()=>{task?.abort?.();reject(new Error('连接超时，请重新连接（TAP-TIMEOUT）'));}),20500);
  init.signal?.addEventListener('abort',abort,{once:true});
  const headers=Object.fromEntries(new Headers(init.headers));
  // Cookies remain in the gateway. Never pass a browser cookie or retry a write.
  delete headers.cookie;delete headers.referer;
  try{task=host.request!({url,method,data:typeof init.body==='string'?init.body:undefined,header:headers,dataType:'text',responseType:'arraybuffer',timeout:20000,enableCache:false,
   success:result=>finish(()=>{try{const headers=new Headers();for(const [key,value]of Object.entries(result.header||{}))if(['content-type','retry-after','x-jigsaw-h5-session-expired'].includes(key.toLowerCase()))headers.set(key,value);const body=result.statusCode===204||result.statusCode===205?null:typeof result.data==='string'||result.data instanceof ArrayBuffer?result.data:JSON.stringify(result.data);resolve(new Response(body,{status:result.statusCode,headers}));}catch(error){reject(error);}}),
   fail:()=>finish(()=>reject(new Error('网络连接失败，请点击重新连接（TAP-NET）'))),
  });}catch{finish(()=>reject(new Error('网络连接失败，请点击重新连接（TAP-NET）')));}
 });
}
