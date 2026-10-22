export type TapInterstitialAd={show():Promise<unknown>;onLoad(fn:()=>void):void;offLoad?(fn:()=>void):void;onError(fn:(error:unknown)=>void):void;offError?(fn:(error:unknown)=>void):void;onClose(fn:()=>void):void;offClose?(fn:()=>void):void;destroy():void};
export type TapInterstitialHost={createInterstitialAd?(options:{adUnitId:string}):TapInterstitialAd};
type Result='closed'|'failed'|'unavailable';

/** 仅在手动测试时创建；使用官方的自动加载→onLoad→show→onClose流程。 */
export function createTapInterstitial(readHost:()=>TapInterstitialHost|undefined,report:(stage:string,unit:string,error?:unknown)=>void,timeoutMs=180000){
 let active=false;
 return async function showInterstitial(unit:string):Promise<Result>{
  const host=readHost();if(!unit||typeof host?.createInterstitialAd!=='function'||active){report(!unit?'广告位为空':active?'上一条插屏仍在处理中':'TapTap插屏接口不可用',unit);return 'unavailable';}
  active=true;let instance:TapInterstitialAd|undefined,cleanup=()=>{};
  try{
   report('创建插屏',unit);instance=host.createInterstitialAd({adUnitId:unit});const ad=instance;
   return await new Promise<Result>(resolve=>{let done=false,showing=false,shown=false,closed=false,stage='自动加载';
    const finish=(result:Result)=>{if(done)return;done=true;clearTimeout(timer);resolve(result);};
    const fail=(error:unknown)=>{if(done)return;report(stage+'失败',unit,error);finish('failed');};
    const onClose=()=>{if(done||!showing)return;closed=true;if(shown){report('已展示并关闭',unit);finish('closed');}};
    const onLoad=()=>{if(done||showing)return;showing=true;stage='展示';report('加载成功，展示中',unit);
     try{void Promise.resolve(ad.show()).then(()=>{if(done)return;shown=true;stage='等待关闭';report('展示成功，等待关闭',unit);if(closed)onClose();},fail);}catch(error){fail(error);}
    };
    const timer=setTimeout(()=>{if(done)return;report(stage+'超时（'+Math.round(timeoutMs/1000)+'秒）',unit);finish('failed');},timeoutMs);
    cleanup=()=>{for(const off of [()=>ad.offLoad?.(onLoad),()=>ad.offError?.(fail),()=>ad.offClose?.(onClose)])try{off();}catch{}};
    try{ad.onError(fail);ad.onClose(onClose);ad.onLoad(onLoad);if(!showing&&!done)report('自动加载中',unit);}catch(error){fail(error);}
   });
  }catch(error){report('创建插屏异常',unit,error);return 'failed';}
  finally{cleanup();try{instance?.destroy();}catch{}active=false;}
 };
}
