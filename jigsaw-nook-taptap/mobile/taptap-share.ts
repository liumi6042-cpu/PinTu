export type TapShareHost={showShareboard?:(options:Record<string,unknown>)=>void;onShareMessage?:(options:Record<string,unknown>)=>void;offShareMessage?:()=>void;onHide?:(listener:()=>void)=>void;offHide?:(listener:()=>void)=>void;onShow?:(listener:()=>void)=>void;offShow?:(listener:()=>void)=>void};
// Approved in this game's TapTap sharing console; public template ID, not a credential.
export const TAPTAP_SHARE_TEMPLATE_ID='ST1792415349659O9SC25PR4';
export type TapShareResult='shared'|'copied'|'cancelled'|'unavailable';
/** How the game came back: `background` means the whole app really went to the background (another app such as WeChat took over), with how long it was away. */
export type TapShareReturn={background:boolean;awayMs:number};
type ShareWaitOptions={signal?:AbortSignal;subscribeReturn?:(returned:(info?:TapShareReturn)=>void)=>()=>void};
/** WeChat gives TapTap no usable share result, so players who really shared there came back without a channel event and were told they cancelled. A real trip to another app this long, without an explicit cancel, counts as a share. */
export const TAP_SHARE_AWAY_MS=2500;
/** Native panels do not consistently report dismissal. Observe an actual return; only a long background trip may stand in for a missing channel event. */
export function subscribeTapShareReturn(host:TapShareHost|undefined,environment:{window:EventTarget;document:EventTarget&{hidden:boolean};canvas:EventTarget},returned:(info?:TapShareReturn)=>void,now:()=>number=Date.now):()=>void{
 let nativeHidden=false,browserHidden=environment.document.hidden,blurred=false,awayAt:number|undefined=browserHidden?now():undefined;
 // Only a real background trip (native hide or a hidden page) counts as having left for another app; a blur or a touch only proves the sheet closed.
 const away=()=>{if(awayAt===undefined)awayAt=now();},back=()=>{const at=awayAt;awayAt=undefined;blurred=false;returned(at===undefined?{background:false,awayMs:0}:{background:true,awayMs:Math.max(0,now()-at)});};
 const hide=()=>{nativeHidden=true;away();},show=()=>{if(nativeHidden){nativeHidden=false;if(!browserHidden)back();}};
 const visibility=()=>{if(environment.document.hidden){browserHidden=true;away();}else if(browserHidden){browserHidden=false;if(!nativeHidden)back();}};
 const blur=()=>{blurred=true;},focus=()=>{if(blurred){blurred=false;if(awayAt===undefined)returned({background:false,awayMs:0});}};
 // A new touch on the game itself also proves that its native share sheet is no longer covering it.
 const touched=()=>returned({background:false,awayMs:0});
 const capture={capture:true};environment.canvas.addEventListener('pointerdown',touched,capture);environment.canvas.addEventListener('touchstart',touched,capture);
 environment.document.addEventListener('visibilitychange',visibility);environment.window.addEventListener('blur',blur);environment.window.addEventListener('focus',focus);
 let native=false;try{if(host?.onHide&&host.offHide&&host.onShow&&host.offShow){native=true;host.onHide(hide);host.onShow(show);}}catch{}
 return()=>{environment.canvas.removeEventListener('pointerdown',touched,capture);environment.canvas.removeEventListener('touchstart',touched,capture);environment.document.removeEventListener('visibilitychange',visibility);environment.window.removeEventListener('blur',blur);environment.window.removeEventListener('focus',focus);if(native){try{host?.offHide?.(hide);}catch{}try{host?.offShow?.(show);}catch{}}};
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
   // Back from a real trip to another app: wait a little longer for a late channel event, then trust the trip. Back from the sheet only: cancelled.
   let tripCounted=false;
   detachReturn=options.subscribeReturn?.(info=>{if(settled||tripCounted)return;
    if(info?.background&&info.awayMs>=TAP_SHARE_AWAY_MS){tripCounted=true;clearTimeout(returnTimer);describe('离开游戏'+Math.round(info.awayMs/100)/10+'秒后返回，等待渠道结果');returnTimer=setTimeout(()=>{describe('未收到渠道回调，已离开游戏前往分享，按已分享计');finish('shared');},1500);return;}
    if(returnTimer)return;describe(info?.background?'离开游戏'+Math.round(info.awayMs/100)/10+'秒即返回，等待渠道结果':'已返回游戏，等待渠道结果');returnTimer=setTimeout(()=>{describe('返回游戏后未收到分享成功回调');finish('cancelled');},800);});
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
