'use client';
import {useEffect,useRef,useState} from 'react';
import {DiscoveryTracker,pictureDiscoveries,type Discovery} from '@/lib/picture-discoveries';
import type {PuzzleState} from '@/lib/puzzle-engine';
import type {RoomClient} from '@/lib/room-client';
import {useLanguage} from './language-switch';

export default function PictureDiscoveries({state,client,ready,hidden}:{state:PuzzleState;client?:RoomClient;ready:boolean;hidden:boolean}){
 const zh=useLanguage()==='zh',[notice,setNotice]=useState<Discovery|null>(null),blocked=useRef(hidden);blocked.current=hidden;
 useEffect(()=>{
  if(!ready||!pictureDiscoveries[state.imageId])return;
  const key='jigsaw:discoveries:v1:'+(client?.snapshot.id||`${state.imageId}:${state.cols}:${state.rows}:${state.seed}`);
  let saved:string[]=[];try{const value=JSON.parse(localStorage.getItem(key)||'[]');if(Array.isArray(value))saved=value.filter(v=>typeof v==='string');}catch{}
  const tracker=new DiscoveryTracker(state,saved),queue:Discovery[]=[];let until=0;
  const puzzle=()=>client?.snapshot.puzzle||state;
  tracker.observe(puzzle());setNotice(null);
  const tick=()=>{
   if(document.hidden)return;
   const count=tracker.seen.size;queue.push(...tracker.observe(puzzle()));
   if(count!==tracker.seen.size)try{localStorage.setItem(key,JSON.stringify([...tracker.seen]));}catch{}
   if(blocked.current){until=0;setNotice(null);return;}
   if(Date.now()<until)return;
   const next=queue.shift()||null;setNotice(next);until=next?Date.now()+4200:0;
  };
  const timer=setInterval(tick,600);return()=>clearInterval(timer);
 },[state,client,ready]);
 return !hidden&&notice?<aside className="picture-discovery" role="status" aria-live="polite" aria-atomic="true"><span aria-hidden="true">✦</span><div><small>{zh?'画中发现':'A little discovery'}</small><p>{zh?notice.zh:notice.en}</p></div></aside>:null;
}
