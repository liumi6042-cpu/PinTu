import { createContext,useCallback,useContext,useEffect,useRef,useState,type ReactNode } from 'react';
import { gatewayConfig } from './network';
import { h5Config } from './config';
import { showRewardedAd,prepareRewardedAd } from './ads';
import { isMobileProfile,mobileJson,mobilePost,requestId,type MobileProfile,type SupplyKind } from './mobile-api';
import { tapTapAvailable,tapTapLoginCode,tapTapUserNickname } from './taptap-account';
import './mobile-rewards.css';
export type { MobileProfile,SupplyKind } from './mobile-api';
type Settings={name?:string;autoSupply?:boolean};
type PlayerContext={profile:MobileProfile|null;loading:boolean;error:string;busy:boolean;refresh:()=>Promise<void>;saveSettings:(settings:Settings)=>Promise<void>;claimSupply:(kind:SupplyKind)=>Promise<void>;useEnergySupply:()=>Promise<void>;bindTapTap:(interactive?:boolean)=>Promise<MobileProfile|null>};
const Player=createContext<PlayerContext|null>(null);
type PendingReward={kind:SupplyKind;requestId:string;rewardToken:string;completed:boolean};
function rewardKey(){return 'jigsaw:mobile-pending-reward:'+h5Config().apiBase;}
function readPending():PendingReward|null{try{const p=JSON.parse(sessionStorage.getItem(rewardKey())||'null');return p&&['energy','create'].includes(p.kind)&&/^[a-f0-9]{32}$/.test(p.requestId)&&typeof p.rewardToken==='string'&&p.completed===true?p:null;}catch{return null;}}
function storePending(p:PendingReward|null){try{if(p)sessionStorage.setItem(rewardKey(),JSON.stringify(p));else sessionStorage.removeItem(rewardKey());}catch{}}
export function MobileProvider({children}:{children:ReactNode}){
 const [profile,setProfile]=useState<MobileProfile|null>(null),[loading,setLoading]=useState(true),[error,setError]=useState(''),[busy,setBusy]=useState(false),[toast,setToast]=useState('');
 const profileRef=useRef<MobileProfile|null>(null),lock=useRef(false),pending=useRef<PendingReward|null>(null),useId=useRef<string|null>(null),lastReward=useRef<string|null>(null),loaded=useRef(false);
 const apply=useCallback((next:unknown)=>{
  if(!isMobileProfile(next))return;
  const old=profileRef.current;
  if(old?.serverTime&&next.serverTime&&next.serverTime<old.serverTime)return;
  const reward=next.lastReward;
  const key=reward ? JSON.stringify([reward.id??reward.at,reward.type,reward.giftsAdded,reward.quantity,reward.energy,reward.xp,reward.coins??0,reward.levels,reward.completion]) : null;
  if(key&&key!==lastReward.current){
   if(loaded.current&&reward){
    const parts:string[]=[];
    const levels=Number(reward.levels??0),giftsAdded=Number(reward.giftsAdded??0);
    const completion=reward.completion as {energy?:number}|undefined;
    if(levels>0)parts.push('升级啦，体力已补满');
    if(reward.type==='gift-open')parts.push(reward.effect==='full-energy'?'已使用补满体力包，体力 +'+Number(reward.energy??0):'开启'+Number(reward.quantity??1)+'份礼包，体力 +'+Number(reward.energy??0)+(Number(reward.xp??0)>0?' · 经验 +'+Number(reward.xp):''));
    if(reward.type==='invitation-share')parts.push('分享奖励：体力 +'+Number(reward.energy??0)+' · 经验 +'+Number(reward.xp??0));
    if(Number(reward.coins??0)>0)parts.push('金币 +'+Number(reward.coins));
    if(giftsAdded>0)parts.push(giftsAdded+'份礼包已存入任务');
    if(Number(completion?.energy)>0)parts.push('完图奖励：体力 +'+completion!.energy);
    if(parts.length)setToast(parts.join(' · '));
   }
   lastReward.current=key;
  }
  profileRef.current=next;setProfile(next);setLoading(false);loaded.current=true;
 },[]);
 const refresh=useCallback(async()=>{
  try{apply(await mobileJson<MobileProfile>('/api/mobile/profile'));setError('');}
  catch(e){const message=e instanceof Error?e.message:'玩家数据暂时无法读取';setError(message);throw e;}
  finally{setLoading(false);}
 },[apply]);
 const bindTapTap=useCallback(async(interactive=true)=>{
  if(!tapTapAvailable())return null;
  const attemptKey='jigsaw:taptap-login-attempt:'+h5Config().apiBase;
  if(!interactive){try{const last=Number(sessionStorage.getItem(attemptKey)||0);if(last&&Date.now()-last<300000)return null;sessionStorage.setItem(attemptKey,String(Date.now()));}catch{} }
  const code=await tapTapLoginCode();let nickname:string|null=null;
  if(interactive){try{nickname=await tapTapUserNickname();}catch(error){if(!/授权|支持|拒绝|取消/.test(error instanceof Error?error.message:String(error)))throw error;}}
  const result=await mobilePost<{profile?:MobileProfile}>('/api/taptap/bind',{code,...(nickname?{nickname}:{}),requestId:requestId()});
  if(result.profile)apply(result.profile);return result.profile??null;
 },[apply]);
 useEffect(()=>{
  pending.current=readPending();void refresh().then(()=>{if(tapTapAvailable())void bindTapTap(false).catch(()=>{});}).catch(()=>{});
  const update=(event:Event)=>apply((event as CustomEvent).detail);
  const focus=()=>{if(!document.hidden)void refresh().catch(()=>{});};
  const timer=window.setInterval(focus,15000);
  window.addEventListener('mobile:profile',update);window.addEventListener('focus',focus);document.addEventListener('visibilitychange',focus);
  void gatewayConfig().then(config=>{if(config.adRewardEnabled&&config.rewardedAdUnitId)prepareRewardedAd(config.rewardedAdUnitId);}).catch(()=>{});
  return()=>{clearInterval(timer);window.removeEventListener('mobile:profile',update);window.removeEventListener('focus',focus);document.removeEventListener('visibilitychange',focus);};
 },[apply,bindTapTap,refresh]);
 useEffect(()=>{if(!toast)return;const timer=setTimeout(()=>setToast(''),2200);return()=>clearTimeout(timer);},[toast]);
 const perform=useCallback(async(action:()=>Promise<void>)=>{
  if(lock.current)throw Error('正在处理，请稍候');lock.current=true;setBusy(true);setError('');
  try{await action();}catch(e){setError(e instanceof Error?e.message:'暂时无法完成，请重试');throw e;}finally{lock.current=false;setBusy(false);}
 },[]);
 const saveSettings=useCallback((settings:Settings)=>perform(async()=>{
  apply(await mobileJson<MobileProfile>('/api/mobile/profile',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify(settings)}));
 }),[perform,apply]);
 const claimSupply=useCallback((kind:SupplyKind)=>perform(async()=>{
  let current=pending.current;
  if(current?.completed&&current.kind!==kind)throw Error('上次奖励正在等待到账，请先重试领取原来的补给');
  if(!current?.completed){
   if(!profileRef.current?.adEligible)throw Error(profileRef.current?.newcomer?'先享受首局体验，结束后再来领取广告补给':'广告暂未开放，已有补给仍可使用');
   if((profileRef.current?.supply[kind]??3)>=3)throw Error('库存已满，使用后再来领取');
   const config=await gatewayConfig();
   if(!config.adRewardEnabled||!config.rewardedAdUnitId||!window.tap?.createRewardedVideoAd)throw Error('请在TapTap中领取广告补给，当前暂无可播放广告');
   const id=requestId();
   const challenge=await mobilePost<{rewardToken:string}>('/api/mobile/supply/challenge',{kind,requestId:id});
   current={kind,requestId:id,rewardToken:challenge.rewardToken,completed:false};pending.current=current;
   const outcome=await showRewardedAd(config.rewardedAdUnitId);
   if(outcome!=='completed'){pending.current=null;await mobilePost('/api/mobile/supply/cancel',{kind,requestId:id,rewardToken:challenge.rewardToken}).catch(()=>{});throw Error(outcome==='closed'?'本次未完整观看，未领取奖励':'广告暂时无法播放，请稍后重试');}
   current.completed=true;storePending(current);
  }
  try{
   apply(await mobilePost<MobileProfile>('/api/mobile/supply/redeem',{kind:current.kind,requestId:current.requestId,rewardToken:current.rewardToken,completed:true}));
   pending.current=null;storePending(null);setToast(kind==='energy'?'体力包已存入补给站':'建房券已存入补给站');
  }catch(e){if([400,401,403,410].includes((e as {status?:number}).status??0)){pending.current=null;storePending(null);}throw e;}
 }),[perform,apply]);
 const useEnergySupply=useCallback(()=>perform(async()=>{
  const id=useId.current??=requestId();
  apply(await mobilePost<MobileProfile>('/api/mobile/supply/use',{kind:'energy',requestId:id}));useId.current=null;setToast('体力已补满');
 }),[perform,apply]);
 return <Player.Provider value={{profile,loading,error,busy,refresh,saveSettings,claimSupply,useEnergySupply,bindTapTap}}>{children}{toast&&<div className="mobile-reward-toast" role="status" aria-live="polite">{toast}</div>}</Player.Provider>;
}
export function useMobilePlayer(){const value=useContext(Player);if(!value)throw Error('MobileProvider is required');return value;}
