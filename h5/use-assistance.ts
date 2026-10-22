'use client';
import { useCallback,useEffect,useRef,useState } from 'react';
import type { PuzzleState } from '../lib/puzzle-engine';
import type { RoomClient } from '../lib/room-client';
import { localAssistanceKey,hintPieces } from '../lib/assistance-engine';
import { apiFetch,gatewayFetch,gatewayConfig } from './network';
import { showRewardedAd } from './ads';
import { activeAssistance,type AssistanceGrant,type AssistanceKind,type AssistanceState } from '../lib/assistance-policy';

type MobileAssistanceState = AssistanceState & {freeRemaining?:Record<AssistanceKind,number>;newcomerProtected?:boolean};
export function useAssistance(state:PuzzleState,client?:RoomClient){
 const key=localAssistanceKey(state),roomId=client?.ticket.room.id,token=client?.ticket.token;
 const [grants,setGrants]=useState<AssistanceGrant[]>([]),[now,setNow]=useState(Date.now),[ready,setReady]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const [freeRemaining,setFreeRemaining]=useState<Record<AssistanceKind,number>>({hint:0,underlay:0}),[newcomerProtected,setNewcomerProtected]=useState(false);
 const locked=useRef(false),pending=useRef<{kind:AssistanceKind;requestId:string}|null>(null),mounted=useRef(true);
 const apply=useCallback((data:MobileAssistanceState)=>{if(!mounted.current)return;const received=Date.now(),offset=received-data.serverTime;
  // A slower focus/reload response must never restore a use consumed by a newer response.
  setGrants(previous=>{const merged=new Map(previous.map(g=>[g.requestId,g]));for(const g of data.grants){const old=merged.get(g.requestId);merged.set(g.requestId,{...g,expiresAt:Math.min(old?.expiresAt??Infinity,g.expiresAt+offset)});}return [...merged.values()];});setNow(received);setReady(true);if(data.freeRemaining)setFreeRemaining(data.freeRemaining);setNewcomerProtected(data.newcomerProtected===true);
 },[]);
 const localHints=useRef(new Map<string,number[]>()),stateRef=useRef(state);useEffect(()=>{stateRef.current=state;},[state]);
 const localContext=useCallback(async()=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(key))),n=>n.toString(16).padStart(2,'0')).join(''),[key]);
 const rewarded=useRef<{requestId:string;rewardToken:string}|null>(null);
 const request=useCallback(async(input?:{kind:AssistanceKind;requestId:string;rewardToken?:string;completed?:boolean})=>{
  const endpoint=roomId?`/api/rooms/${roomId}/assistance`:'/assistance/local/'+await localContext();
  const response=await (roomId?apiFetch:gatewayFetch)(endpoint,{method:input?'POST':'GET',headers:{...(token?{Authorization:`Bearer ${token}`} : {}),...(input?{'Content-Type':'application/json'}:{})},body:input?JSON.stringify(input):undefined,cache:'no-store',signal:AbortSignal.timeout(10000)});
  const data=await response.json().catch(()=>({error:'暂时无法读取帮助次数，请重试'})) as MobileAssistanceState&{error?:string;code?:string};if(!response.ok){if(data.freeRemaining)setFreeRemaining(data.freeRemaining);if(response.status===401||(response.status===403&&data.code!=='AD_REQUIRED')){pending.current=null;rewarded.current=null;}throw Object.assign(new Error(data.error||'暂时无法读取帮助次数，请重试'),{status:response.status,code:data.code});}if(!roomId)for(const grant of data.grants){if(grant.kind!=='hint')continue;
    let ids=localHints.current.get(grant.requestId);if(!ids){ids=hintPieces(stateRef.current);localHints.current.set(grant.requestId,ids);}grant.pieceIds=ids;
  }return data;
 },[roomId,token,localContext]);
 const reload=useCallback(async()=>{try{apply(await request());if(mounted.current)setError('');}catch(e){if(mounted.current)setError(e instanceof Error?e.message:'暂时无法读取帮助次数，请重试');}},[request,apply]);
 useEffect(()=>{mounted.current=true;queueMicrotask(()=>void reload());const focus=()=>{if(!document.hidden)void reload();};const storage=(e:StorageEvent)=>{if(e.key===key||e.key===null)void reload();};window.addEventListener('focus',focus);document.addEventListener('visibilitychange',focus);if(!roomId)window.addEventListener('storage',storage);return()=>{mounted.current=false;window.removeEventListener('focus',focus);document.removeEventListener('visibilitychange',focus);window.removeEventListener('storage',storage);};},[reload,key,roomId]);
 const ticking=grants.some(g=>g.kind!=='reference'&&g.expiresAt>now);
 useEffect(()=>{if(!ticking)return;const tick=()=>setNow(Date.now()),timer=setInterval(tick,1000);return()=>clearInterval(timer);},[ticking]);
 const activate=async(kind:AssistanceKind)=>{
  if(locked.current||!ready)return false;locked.current=true;setBusy(true);setError('');
  try{
   if(!pending.current||pending.current.kind!==kind)pending.current={kind,requestId:Array.from(crypto.getRandomValues(new Uint8Array(16)),n=>n.toString(16).padStart(2,'0')).join('')};
   const attempt=pending.current;
   if(rewarded.current?.requestId!==attempt.requestId){
    if(roomId){
     try{const free=await request(attempt);apply(free);pending.current=null;return true;}
     catch(error){if((error as {code?:string}).code!=='AD_REQUIRED')throw error;if(newcomerProtected||freeRemaining[kind]>0){setNewcomerProtected(false);throw Error('免费次数已用完，点击看广告可继续使用');}}
    }
    const config=await gatewayConfig();
    if(!config.adRewardEnabled||!config.rewardedAdUnitId||!window.tap?.createRewardedVideoAd)throw Error('广告暂未开放，请继续正常拼图');
    const context=roomId?'room/'+roomId:'local/'+await localContext();
    const response=await gatewayFetch('/rewarded/challenge',{method:'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:JSON.stringify({...attempt,context}),signal:AbortSignal.timeout(10000)});
    const challenge=await response.json() as {rewardToken:string;error?:string};
    if(!response.ok){pending.current=null;throw Error(challenge.error||'广告暂时无法播放，请稍后再试');}
    const outcome=await showRewardedAd(config.rewardedAdUnitId);
    if(outcome!=='completed'){pending.current=null;throw Error(outcome==='closed'?'需要完整观看广告才能使用；本次未解锁':'广告暂时无法播放，请稍后再试');}
    rewarded.current={requestId:attempt.requestId,rewardToken:challenge.rewardToken};
   }
   const data=await request({...attempt,rewardToken:rewarded.current.rewardToken,completed:true});
   apply(data);pending.current=null;rewarded.current=null;return true;
  }catch(e){if(mounted.current)setError(e instanceof Error?e.message:'暂时无法读取帮助次数，请重试');return false;}
  finally{locked.current=false;if(mounted.current)setBusy(false);}
 };
 return {adGated:true,freeRemaining,newcomerProtected,grants,now,ready,busy,error,reload,activate,underlay:activeAssistance(grants,'underlay',now),hint:activeAssistance(grants,'hint',now)};
}
