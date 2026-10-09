type AdClose = {isEnded?:boolean};
type RewardedAd = {load:()=>Promise<unknown>;show:()=>Promise<unknown>;onClose:(f:(result:AdClose)=>void)=>void;offClose?:(f:(result:AdClose)=>void)=>void;onError:(f:(error:unknown)=>void)=>void;offError?:(f:(error:unknown)=>void)=>void;destroy?:()=>void};
export type TapRuntime={createRewardedVideoAd:(options:{adUnitId:string})=>RewardedAd};
declare global {interface Window {tap?:TapRuntime}}
let playing=false;
// Watching only reports the platform result. Reward issuance belongs to a
// server operation. Its completion callback is not a signed server-side proof;
// never use it to issue purchased inventory or financial entitlements.
export async function showRewardedAd(adUnitId:string):Promise<'completed'|'closed'|'unavailable'|'failed'> {
  if(!adUnitId||!window.tap?.createRewardedVideoAd||playing)return 'unavailable';
  playing=true;
  let ad:RewardedAd|undefined;
  try {
    ad=window.tap.createRewardedVideoAd({adUnitId});
    return await new Promise(resolve=>{
      let finished=false;const timer=window.setTimeout(()=>finish('failed'),180000);
      const finish=(result:'completed'|'closed'|'failed')=>{if(finished)return;finished=true;clearTimeout(timer);ad?.offClose?.(close);ad?.offError?.(fail);resolve(result);};
      const close=(result:AdClose)=>finish(result?.isEnded===true?'completed':'closed');
      const fail=()=>finish('failed');
      ad!.onClose(close);ad!.onError(fail);
      void ad!.load().then(()=>ad!.show()).catch(fail);
    });
  } catch {return 'failed';}
  finally {playing=false;try{ad?.destroy?.();}catch{}}
}
