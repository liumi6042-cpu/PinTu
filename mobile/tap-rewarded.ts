export type TapRewardedAd={load():Promise<unknown>;show():Promise<unknown>;onLoad?(fn:()=>void):void;onClose(fn:(result:{isEnded?:boolean})=>void):void;onError(fn:(error:unknown)=>void):void;destroy?():void};
export type TapRewardedHost={createRewardedVideoAd?(options:{adUnitId:string}):TapRewardedAd};
export type RewardedOutcome='completed'|'closed'|'failed'|'unavailable';

// 官方 RewardedVideoAd.onError 错误码说明。
const AD_ERRORS:Record<string,string>={'1000':'后端接口调用失败','1001':'参数错误','1002':'广告单元无效','1003':'内部错误','1004':'无合适的广告','1005':'广告组件审核中','1006':'广告组件被驳回','1007':'广告组件被封禁','1008':'广告单元已关闭'};
export function adErrorCode(error:unknown){const value=error as any;const code=value?.errCode??value?.errno??value?.errNo??value?.code;return typeof code==='number'||typeof code==='string'&&/^-?\d{1,12}$/.test(code)?String(code):'';}
export function adErrorText(error:unknown){const code=adErrorCode(error);return code?'错误码 '+code+(AD_ERRORS[code]?' '+AD_ERRORS[code]:''):'';}

type Slot={ad:TapRewardedAd;listener?:{close(result:{isEnded?:boolean}):void;error(detail:unknown):void}};

/**
 * 按官方 AdManager：每个广告位只创建一次并立即预加载，onLoad/onError/onClose 只注册一次；
 * 点击时先 show()，失败再 load().then(show) 一次。广告真正出现前最多等 showDeadlineMs，
 * 出现后只等 onClose（closeDeadlineMs 仅防宿主丢失关闭回调）。
 */
export function createTapRewarded(readHost:()=>TapRewardedHost|undefined,report:(stage:string,unit:string,error?:unknown)=>void,options:{showDeadlineMs?:number;closeDeadlineMs?:number}={}){
 const showDeadlineMs=options.showDeadlineMs??10000,closeDeadlineMs=options.closeDeadlineMs??180000;
 const slots=new Map<string,Slot>();let failure='';
 const preload=(unit:string,slot:Slot)=>{try{void Promise.resolve(slot.ad.load()).catch(()=>{});}catch(error){report('预加载失败',unit,error);}};
 const slotFor=(unit:string)=>{
  const existing=slots.get(unit);if(existing)return existing;
  const host=readHost();if(!unit||typeof host?.createRewardedVideoAd!=='function')return undefined;
  const slot:Slot={ad:host.createRewardedVideoAd({adUnitId:unit})};slots.set(unit,slot);
  try{slot.ad.onLoad?.(()=>{if(!slot.listener)report('预加载完成',unit);});}catch{}
  slot.ad.onError(error=>{if(slot.listener)slot.listener.error(error);else report('预加载失败',unit,error);});
  slot.ad.onClose(result=>slot.listener?.close(result));
  preload(unit,slot);return slot;
 };
 return {
  prepare(unit:string){try{slotFor(unit);}catch(error){report('创建广告异常',unit,error);}},
  failure:()=>failure,
  async watch(unit:string):Promise<RewardedOutcome>{
   failure='';let slot:Slot|undefined;
   try{slot=slotFor(unit);}catch(error){report('创建广告异常',unit,error);failure=adErrorText(error)||'创建广告失败';return 'failed';}
   if(!slot){report(unit?'TapTap广告接口不可用':'广告位为空',unit);failure='广告接口不可用';return 'unavailable';}
   const ad=slot.ad,current=slot;
   return await new Promise<RewardedOutcome>(resolve=>{
    let done=false,shown=false,stage='展示',lastError:unknown;
    const finish=(outcome:RewardedOutcome,reload:boolean)=>{if(done)return;done=true;clearTimeout(timer);if(current.listener===listener)current.listener=undefined;if(reload)preload(unit,current);resolve(outcome);};
    const fail=(error:unknown)=>{if(done)return;report(stage+'失败',unit,error);failure=adErrorText(error)||'广告加载失败';finish('failed',true);};
    // 广告出现前的 onError 只记录：show/load 的 Promise 会给出结果，避免首次 show 未就绪就提前判失败。
    const listener={close:(result:{isEnded?:boolean})=>{if(done)return;const ended=result?.isEnded===true;report(ended?'完整观看':'提前关闭或未提供完播标记',unit);finish(ended?'completed':'closed',true);},
     error:(error:unknown)=>{lastError=error;if(shown)fail(error);else report(stage+'回调错误',unit,error);}};
    current.listener=listener;
    let timer=setTimeout(()=>{if(done||shown)return;report(stage+'超时（'+Math.round(showDeadlineMs/1000)+'秒）',unit,lastError);failure=(adErrorText(lastError)?adErrorText(lastError)+' · ':'')+'超时';finish('failed',false);},showDeadlineMs);
    report('展示中',unit);
    Promise.resolve().then(()=>ad.show()).catch(error=>{if(done)return;report('未就绪，重新加载',unit,error);stage='加载';return Promise.resolve(ad.load()).then(()=>{if(done)return;stage='展示';return ad.show();});})
     .then(()=>{if(done)return;shown=true;stage='播放';report('播放中，等待关闭',unit);clearTimeout(timer);
      timer=setTimeout(()=>{if(done)return;report('等待关闭超时',unit);finish('closed',false);},closeDeadlineMs);},fail);
   });
  },
 };
}
