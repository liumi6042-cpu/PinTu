type AdClose = {isEnded?:boolean};
type RewardedAd = {load:()=>Promise<unknown>;show:()=>Promise<unknown>;onClose:(f:(result:AdClose)=>void)=>void;offClose?:(f:(result:AdClose)=>void)=>void;onError:(f:(error:unknown)=>void)=>void;offError?:(f:(error:unknown)=>void)=>void;destroy?:()=>void};
export type TapRuntime={createRewardedVideoAd:(options:{adUnitId:string})=>RewardedAd};
export type AdOutcome='completed'|'closed'|'unavailable'|'failed';
declare global {interface Window {tap?:TapRuntime}}
type Watch={close:(result:AdClose)=>void;error:()=>void;cancel:()=>void};
let instance:{runtime:TapRuntime;unit:string;ad:RewardedAd;close:(result:AdClose)=>void;error:()=>void}|undefined;
let watch:Watch|undefined;

export function disposeRewardedAd(){
 watch?.cancel();
 if(!instance)return;
 const previous=instance;instance=undefined;
 try{previous.ad.offClose?.(previous.close);previous.ad.offError?.(previous.error);previous.ad.destroy?.();}catch{}
}
// Preloading does not display an ad or issue help. Keep one native instance for
// the game lifetime, as required by the TapTap H5 integration guide.
export function prepareRewardedAd(unit:string){
 const runtime=window.tap;
 if(!unit||!runtime?.createRewardedVideoAd)return undefined;
 if(instance?.runtime===runtime&&instance.unit===unit)return instance.ad;
 disposeRewardedAd();
 try{
  const ad=runtime.createRewardedVideoAd({adUnitId:unit});
  const close=(result:AdClose)=>{if(instance?.ad===ad)watch?.close(result);};
  const error=()=>{if(instance?.ad===ad)watch?.error();};
  instance={runtime,unit,ad,close,error};ad.onClose(close);ad.onError(error);
  void ad.load().catch(()=>{});
  return ad;
 }catch{disposeRewardedAd();return undefined;}
}
// isEnded is a platform callback, not a signed server verification. It must
// never issue purchased inventory or financial entitlements.
export async function showRewardedAd(unit:string):Promise<AdOutcome>{
 if(watch)return 'unavailable';
 const ad=prepareRewardedAd(unit);if(!ad)return 'unavailable';
 return new Promise(resolve=>{
  let finished=false,shown=false,openingError=false;
  const timer=window.setTimeout(()=>finish('failed'),180000);
  const finish=(result:AdOutcome)=>{if(finished)return;finished=true;clearTimeout(timer);if(watch===current)watch=undefined;resolve(result);};
  const current:Watch={
   close:result=>{if(result?.isEnded===true){if(shown)finish('completed');}else finish('closed');},
   error:()=>{if(shown)finish('failed');else openingError=true;},cancel:()=>finish('failed'),
  };
  watch=current;
  void (async()=>{
   try{
    try{await ad.show();}
    catch{if(finished)return;openingError=false;await ad.load();if(finished)return;await ad.show();}
    if(finished)return;shown=true;if(openingError)finish('failed');
   }catch{finish('failed');}
  })();
 });
}
