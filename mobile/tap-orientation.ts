export type TapOrientationHost={setDeviceOrientation?:(options:{value:'portrait'|'landscape';success:()=>void;fail:(error?:unknown)=>void;complete?:()=>void})=>unknown;onDeviceOrientationChange?:(listener:()=>void)=>void;offDeviceOrientationChange?:(listener:()=>void)=>void};
export type TapOrientationOptions={current?:()=>'portrait'|'landscape'|null;timeoutMs?:number;pollMs?:number};
const failedText='TapTap没有切换屏幕方向，请更新TapTap后重试';
/** Manual host rotation only; never rotates the Canvas or changes puzzle data.
 * Some TapTap clients turn the screen without calling success/fail (or answer through a Promise), so the switch also counts as done once the window itself has turned. */
export function setTapOrientation(host:TapOrientationHost|undefined,value:'portrait'|'landscape',options:TapOrientationOptions={}):Promise<void>{
 if(!host?.setDeviceOrientation)return Promise.reject(Error('当前TapTap客户端不支持切换方向，请尝试更新TapTap'));
 const {current,timeoutMs=5000,pollMs=200}=options;
 return new Promise((resolve,reject)=>{let done=false;const turned=()=>{try{return current?.()===value;}catch{return false;}};
  const finish=(message?:string)=>{if(done)return;done=true;clearTimeout(timer);if(poll)clearInterval(poll);if(message&&!turned())reject(Error(message));else resolve();};
  const timer=setTimeout(()=>finish(failedText),timeoutMs),poll=current?setInterval(()=>{if(turned())finish();},pollMs):undefined;
  try{const result=host.setDeviceOrientation!({value,success:()=>finish(),fail:()=>finish(failedText),complete:()=>{if(turned())finish();}});
   if(result&&typeof (result as PromiseLike<unknown>).then==='function')(result as PromiseLike<unknown>).then(()=>finish(),()=>finish(failedText));}
  catch{finish(failedText);}
 });
}
