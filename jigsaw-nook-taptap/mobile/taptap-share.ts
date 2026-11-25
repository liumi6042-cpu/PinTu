export type TapShareHost={showShareboard?:(options:Record<string,unknown>)=>void;onShareMessage?:(options:Record<string,unknown>)=>void;offShareMessage?:()=>void;onHide?:(listener:()=>void)=>void;offHide?:(listener:()=>void)=>void;onShow?:(listener:()=>void)=>void;offShow?:(listener:()=>void)=>void};
// Approved in this game's TapTap sharing console; public template ID, not a credential.
export const TAPTAP_SHARE_TEMPLATE_ID='ST1792415349659O9SC25PR4';
export type TapShareResult='shared'|'copied'|'cancelled'|'unavailable';
type ShareWaitOptions={signal?:AbortSignal;subscribeReturn?:(returned:()=>void)=>()=>void};
/** Native panels do not consistently report dismissal. Observe an actual return, never infer success. */
export function subscribeTapShareReturn(host:TapShareHost|undefined,environment:{window:EventTarget;document:EventTarget&{hidden:boolean};canvas:EventTarget},returned:()=>void):()=>void{
 let nativeHidden=false,browserHidden=environment.document.hidden,blurred=false;
 const hide=()=>{nativeHidden=true;},show=()=>{if(nativeHidden){nativeHidden=false;returned();}};
 const visibility=()=>{if(environment.document.hidden)browserHidden=true;else if(browserHidden){browserHidden=false;returned();}};
 const blur=()=>{blurred=true;},focus=()=>{if(blurred){blurred=false;returned();}};
 // A new touch on the game itself also proves that its native share sheet is no longer covering it.
 const capture={capture:true};environment.canvas.addEventListener('pointerdown',returned,capture);environment.canvas.addEventListener('touchstart',returned,capture);
 environment.document.addEventListener('visibilitychange',visibility);environment.window.addEventListener('blur',blur);environment.window.addEventListener('focus',focus);
 let native=false;try{if(host?.onHide&&host.offHide&&host.onShow&&host.offShow){native=true;host.onHide(hide);host.onShow(show);}}catch{}
 return()=>{environment.canvas.removeEventListener('pointerdown',returned,capture);environment.canvas.removeEventListener('touchstart',returned,capture);environment.document.removeEventListener('visibilitychange',visibility);environment.window.removeEventListener('blur',blur);environment.window.removeEventListener('focus',focus);if(native){try{host?.offHide?.(hide);}catch{}try{host?.offShow?.(show);}catch{}}};
}
/** Opening the panel is not a share. Only the separate channel event may complete it. */
export function shareOnTapTap(host:TapShareHost|undefined,scene:Record<string,string>,timeoutMs=45000,report?:(detail:string)=>void,options:ShareWaitOptions={}):Promise<TapShareResult>{
 const methods='面板:'+!!host?.showShareboard+' 监听:'+!!host?.onShareMessage;
 const describe=(stage:string,error?:any)=>{const raw=String(error?.errMsg??error?.message??'').replace(/https?:\/\/\S+/gi,'[URL]').replace(/(?:bearer\s+|(?:token|secret|code|sceneParam)[=:]\s*)[^\s,;]+/gi,'[已隐藏]').slice(0,220);try{report?.(stage+' · '+methods+(error?' · errno:'+String(error.errno??error.errNo??'无')+' · '+raw:''));}catch{}};
 if(!host?.showShareboard||!host.onShareMessage){describe('接口缺失');return Promise.resolve('unavailable');}
 describe('开始分享');
 const listen=host.onShareMessage,show=host.showShareboard;
 return new Promise(resolve=>{
  let settled=false,timer:ReturnType<typeof setTimeout>|undefined,returnTimer:ReturnType<typeof setTimeout>|undefined,detachReturn:(()=>void)|undefined;
  const finish=(result:TapShareResult)=>{if(settled)return;settled=true;clearTimeout(timer);clearTimeout(returnTimer);options.signal?.removeEventListener('abort',abort);try{detachReturn?.();}catch{}try{host.offShareMessage?.();}catch{}resolve(result);};
  const abort=()=>{if(settled)return;describe('已取消分享等待');finish('cancelled');};
  const cancelled=(event:any)=>/cancel|取消|\bclose(?:d)?\b/i.test(String(event?.errMsg??event?.message??''));
  const fail=(stage:string,error:any)=>{if(settled)return;describe(stage,error);finish(cancelled(error)?'cancelled':'unavailable');};
  try{
   if(options.signal?.aborted){abort();return;}options.signal?.addEventListener('abort',abort,{once:true});
   timer=setTimeout(()=>{describe('等待渠道回调超时');finish('cancelled');},timeoutMs);
   detachReturn=options.subscribeReturn?.(()=>{if(settled||returnTimer)return;describe('已返回游戏，等待渠道结果');returnTimer=setTimeout(()=>{describe('返回游戏后未收到分享成功回调');finish('cancelled');},800);});
   listen.call(host,{success:(event:any)=>{if(settled)return;if(cancelled(event)){describe('分享已取消');finish('cancelled');return;}if(event?.errno&&event.errno!==0){fail('渠道回调失败',event);return;}const channel=typeof event?.channel==='string'?event.channel.trim():'';if(!channel)return;describe('渠道回调:'+channel.slice(0,40));finish(/copy|clipboard/i.test(channel)?'copied':'shared');},fail:(error:any)=>fail('分享监听失败',error)});
   if(settled)return;
   // Real H5 host rejects an empty templateId, even with console preset copy.
   show.call(host,{templateId:TAPTAP_SHARE_TEMPLATE_ID,sceneParam:JSON.stringify(scene),success:(event:any)=>{if(settled)return;if(cancelled(event)){describe('分享面板已取消');finish('cancelled');}else describe('面板已打开，等待渠道回调');},fail:(error:any)=>fail('面板调用失败',error),complete:(event:any)=>{if(!settled&&cancelled(event)){describe('分享面板已取消');finish('cancelled');}}});
  }catch(error){describe('同步调用异常',error);finish('unavailable');}
 });
}

export function tapShareScene(value:unknown):Record<string,string>{
 const out:Record<string,string>={};try{const parsed=typeof value==='string'?JSON.parse(value):value;if(parsed&&typeof parsed==='object')for(const key of ['room','roomInvite','ref']){const item=(parsed as Record<string,unknown>)[key];if(typeof item==='string'&&item.length<=200)out[key]=item;}}catch{}return out;
}
