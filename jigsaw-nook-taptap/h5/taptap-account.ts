type TapLoginResult={code?:string};
type TapUserInfo={nickName?:string;nickname?:string;userInfo?:{nickName?:string;nickname?:string}};
type TapApi={login?: (options?:Record<string,unknown>)=>unknown;getUserInfo?: (options?:Record<string,unknown>)=>unknown};
function api(){return (typeof window!=='undefined'?(window as unknown as {tap?:TapApi}).tap:undefined)??null;}
function call<T>(method:'login'|'getUserInfo',options:Record<string,unknown>={}):Promise<T>{
 const target=api()?.[method];if(typeof target!=='function')return Promise.reject(new Error('当前环境暂不支持TapTap账号登录'));
 return new Promise((resolve,reject)=>{
  let settled=false;const succeed=(value:T)=>{if(settled)return;settled=true;resolve(value);};const fail=(error:unknown)=>{if(settled)return;settled=true;reject(error instanceof Error?error:new Error('TapTap授权未完成'));};
  try{
   const result=(target as (options?:Record<string,unknown>)=>unknown).call(api(),{...options,success:succeed,fail});
   if(result&&typeof (result as PromiseLike<T>).then==='function')(result as PromiseLike<T>).then(succeed,fail);
  }catch(error){fail(error);}
 });
}
export function tapTapAvailable(){return typeof api()?.login==='function';}
export async function tapTapLoginCode(){
 const result=await call<TapLoginResult>('login');const code=typeof result?.code==='string'?result.code.trim():'';if(!code)throw new Error('TapTap没有返回登录凭证');return code;
}
export async function tapTapUserNickname(){
 const result=await call<TapUserInfo>('getUserInfo',{scope:'userInfo'});const value=result?.nickName??result?.nickname??result?.userInfo?.nickName??result?.userInfo?.nickname;return typeof value==='string'&&value.trim()?value.trim():null;
}
