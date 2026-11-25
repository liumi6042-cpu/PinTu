'use client';
import {useCallback,useEffect,useState} from 'react';
import {apiJson} from '@/lib/community-client';
import {ensureGuestSession} from '@/lib/guest-client';
import {useOptionalAccount} from './account-gate';

export type ManagedProfile={level:number;xp:number;xpIntoLevel:number;xpForNextLevel:number;coins:number;fragments:number;giftProgress?:number};
export type ManagedImage={id:string;title:string;src:string;thumbSrc?:string;width:number;height:number;collected:boolean;accessible:boolean};
export type ManagedMilestone={id:string;target:number;coins:number;decorationId?:string|null;claimed:boolean;claimable:boolean};
export type ManagedAlbum={id:string;title:string;description:string;price:number;purchasable:boolean;owned:boolean;progress:number;total:number;images:ManagedImage[];milestones:ManagedMilestone[]};
export type ManagedTask={id:string;title:string;titleEn?:string;goal:string;goalEn?:string;target:number;progress:number;coins:number;xp:number;fragments?:number;status:'pending'|'claimable'|'claimed';claimed:boolean;claimable:boolean};
export type ManagedGift={id:string;title?:string;coins:number;xp:number;fragments?:number;claimed?:boolean;claimable?:boolean;status?:string};
export type ManagedDecoration={id:string;title:string;description:string;kind:string;artKey:string;color:string;cost:number;source:string;owned:boolean;equipped:boolean;enabled:boolean;rewardAlbums?:{id:string;title:string;target:number}[]};
export type ManagedContent={enabled:boolean;contentReleaseId:string|null;profile?:ManagedProfile;albums?:ManagedAlbum[];retainedImages?:ManagedImage[];settlement?:{pendingEvents:number;status:string;notice?:string|null;noticeEn?:string|null};tasks?:{daily:ManagedTask[];friends:ManagedTask[];invitations:ManagedTask[];gifts:ManagedGift[];invitation?:{code:string;bound:boolean;joinedCount:number;qualifiedCount:number;dailyLimit:number;requiredContributions:number}};friends?:{code:string;requests:{code:string;name:string}[];outgoing:{code:string;name:string}[];list:{code:string;name:string}[]};decorations?:ManagedDecoration[];inviteUrl?:string;serverTime?:number};

const cache=new Map<string,{value:ManagedContent;at:number}>();
const pending=new Map<string,Promise<ManagedContent>>();
const invitationBindings=new Map<string,Promise<unknown>>();
async function readContent(identity:string,force=false){
 const previous=cache.get(identity);if(!force&&previous&&Date.now()-previous.at<15000)return previous.value;
 const running=pending.get(identity);if(running)return running;
 const request=(async()=>{await ensureGuestSession();const value=await apiJson<ManagedContent>('/api/player-content');cache.set(identity,{value,at:Date.now()});return value;})();
 pending.set(identity,request);try{return await request;}finally{if(pending.get(identity)===request)pending.delete(identity);}
}
export function notifyManagedContentChanged(){cache.clear();window.dispatchEvent(new Event('puzzle:managed-content-changed'));}
export function notifyManagedStyleChanged(){window.dispatchEvent(new Event('puzzle:cosmetics-changed'));try{localStorage.setItem('jigsaw:cosmetics-updated',String(Date.now()));}catch{/* Styling still updates in this tab without storage. */}}
export function useManagedContent(){
 const account=useOptionalAccount()?.account,identity=account?.id??'guest';
 const [data,setData]=useState<ManagedContent|null>(null),[loading,setLoading]=useState(true),[error,setError]=useState('');
 const reload=useCallback(async()=>{setError('');try{setData(await readContent(identity,true));}catch(e){setData(null);setError(e instanceof Error?e.message:'Unable to load');}finally{setLoading(false);}},[identity]);
 useEffect(()=>{let live=true;setLoading(true);setData(null);setError('');void readContent(identity).then(value=>{if(live)setData(value);}).catch(e=>{if(live)setError(e instanceof Error?e.message:'Unable to load');}).finally(()=>{if(live)setLoading(false);});const changed=()=>{if(live)void reload();};const timer=window.setInterval(()=>{if(live&&!document.hidden)void readContent(identity).then(value=>{if(live)setData(value);}).catch(()=>{});},30000);window.addEventListener('puzzle:managed-content-changed',changed);window.addEventListener('puzzle:account-changed',changed);return()=>{live=false;window.clearInterval(timer);window.removeEventListener('puzzle:managed-content-changed',changed);window.removeEventListener('puzzle:account-changed',changed);};},[identity,reload]);
 useEffect(()=>{if(!data?.enabled)return;const url=new URL(window.location.href),code=url.searchParams.get('invite');if(!code||!/^[a-f0-9]{12}$/.test(code))return;const key=identity+':'+code;let binding=invitationBindings.get(key);if(!binding){binding=apiJson('/api/player-content',{action:'accept-invitation',code});invitationBindings.set(key,binding);}let live=true;void binding.then(()=>{if(!live)return;const next=new URL(window.location.href);if(next.searchParams.get('invite')===code){next.searchParams.delete('invite');window.history.replaceState(null,'',next.pathname+next.search+next.hash);notifyManagedContentChanged();}}).catch(()=>{invitationBindings.delete(key);});return()=>{live=false;};},[data?.enabled,identity]);
 return {data,loading,error,reload};
}
