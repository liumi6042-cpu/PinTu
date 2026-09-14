'use client';
import { useCallback,useEffect,useRef,useState } from 'react';
import type { PuzzleState } from './puzzle-engine';
import type { RoomClient } from './room-client';
import { localAssistanceKey,makeAssistanceGrant } from './assistance-engine';
import { activeAssistance,type AssistanceGrant,type AssistanceKind,type AssistanceState } from './assistance-policy';

export function useAssistance(state:PuzzleState,client?:RoomClient){
 const key=localAssistanceKey(state),roomId=client?.ticket.room.id,token=client?.ticket.token;
 const [grants,setGrants]=useState<AssistanceGrant[]>([]),[now,setNow]=useState(Date.now),[ready,setReady]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const locked=useRef(false),pending=useRef<{kind:AssistanceKind;requestId:string}|null>(null),mounted=useRef(true);
 const apply=useCallback((data:AssistanceState)=>{if(!mounted.current)return;const received=Date.now(),offset=roomId?received-data.serverTime:0;
  // A slower focus/reload response must never restore a use consumed by a newer response.
  setGrants(previous=>{const merged=new Map(previous.map(g=>[g.requestId,g]));for(const g of data.grants){const old=merged.get(g.requestId);merged.set(g.requestId,{...g,expiresAt:Math.min(old?.expiresAt??Infinity,g.expiresAt+offset)});}return [...merged.values()];});setNow(received);setReady(true);
 },[roomId]);
 const readLocal=useCallback(()=>JSON.parse(localStorage.getItem(key)||'[]') as AssistanceGrant[],[key]);
 const request=useCallback(async(input?:{kind:AssistanceKind;requestId:string})=>{
  const response=await fetch(`/api/rooms/${roomId}/assistance`,{method:input?'POST':'GET',headers:{Authorization:`Bearer ${token}`,...(input?{'Content-Type':'application/json'}:{})},body:input?JSON.stringify(input):undefined,cache:'no-store',signal:AbortSignal.timeout(10000)});
  const data=await response.json().catch(()=>({error:'暂时无法读取帮助次数，请重试'})) as AssistanceState&{error?:string};if(!response.ok)throw new Error(data.error||'暂时无法读取帮助次数，请重试');return data;
 },[roomId,token]);
 const reload=useCallback(async()=>{try{apply(roomId?await request():{grants:readLocal(),serverTime:Date.now()});if(mounted.current)setError('');}catch(e){if(mounted.current)setError(e instanceof Error?e.message:'暂时无法读取帮助次数，请重试');}},[roomId,request,readLocal,apply]);
 useEffect(()=>{mounted.current=true;void reload();const focus=()=>{if(!document.hidden)void reload();};const storage=(e:StorageEvent)=>{if(e.key===key||e.key===null)void reload();};window.addEventListener('focus',focus);document.addEventListener('visibilitychange',focus);if(!roomId)window.addEventListener('storage',storage);return()=>{mounted.current=false;window.removeEventListener('focus',focus);document.removeEventListener('visibilitychange',focus);window.removeEventListener('storage',storage);};},[reload,key,roomId]);
 const ticking=grants.some(g=>g.kind!=='reference'&&g.expiresAt>now);
 useEffect(()=>{if(!ticking)return;const tick=()=>setNow(Date.now()),timer=setInterval(tick,1000);return()=>clearInterval(timer);},[ticking]);
 const activate=async(kind:AssistanceKind)=>{
  if(locked.current||!ready)return false;locked.current=true;setBusy(true);setError('');
  try{
   if(!pending.current||pending.current.kind!==kind)pending.current={kind,requestId:Array.from(crypto.getRandomValues(new Uint8Array(16)),n=>n.toString(16).padStart(2,'0')).join('')};
   let data:AssistanceState;
   if(roomId)data=await request(pending.current);
   else{
    const consume=()=>{const grants=readLocal(),now=Date.now(),grant=makeAssistanceGrant(grants,kind,pending.current!.requestId,state,now);if(!grants.some(g=>g.requestId===grant.requestId))grants.push(grant);localStorage.setItem(key,JSON.stringify(grants));return {grants,serverTime:now};};
    data=navigator.locks?await navigator.locks.request(key,consume):consume();
   }
   apply(data);pending.current=null;return true;
  }catch(e){if(mounted.current)setError(e instanceof Error?e.message:'暂时无法读取帮助次数，请重试');return false;}
  finally{locked.current=false;if(mounted.current)setBusy(false);}
 };
 return {grants,now,ready,busy,error,reload,activate,underlay:activeAssistance(grants,'underlay',now),hint:activeAssistance(grants,'hint',now)};
}
