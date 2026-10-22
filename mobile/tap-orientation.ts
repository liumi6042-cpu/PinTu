export type TapOrientationHost={setDeviceOrientation?:(options:{value:'portrait'|'landscape';success:()=>void;fail:()=>void})=>void;onDeviceOrientationChange?:(listener:()=>void)=>void;offDeviceOrientationChange?:(listener:()=>void)=>void};
/** Manual host rotation only; never rotates the Canvas or changes puzzle data. */
export function setTapOrientation(host:TapOrientationHost|undefined,value:'portrait'|'landscape',timeoutMs=8000):Promise<void>{
 if(!host?.setDeviceOrientation)return Promise.reject(Error('当前TapTap客户端不支持切换方向，请尝试更新TapTap'));
 return new Promise((resolve,reject)=>{let done=false;const finish=(message?:string)=>{if(done)return;done=true;clearTimeout(timer);if(message)reject(Error(message));else resolve();};const timer=setTimeout(()=>finish('切换方向暂未响应，请稍后重试'),timeoutMs);
  try{host.setDeviceOrientation!({value,success:()=>finish(),fail:()=>finish('当前TapTap客户端切换方向失败，请稍后重试')});}catch{finish('当前TapTap客户端切换方向失败，请稍后重试');}
 });
}
