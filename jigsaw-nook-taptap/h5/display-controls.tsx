'use client';
import {useEffect,useSyncExternalStore} from 'react';
import {startOrientation,type DisplayMode} from './orientation';
let state:{mode:DisplayMode;message:string}={mode:'auto',message:''};const listeners=new Set<()=>void>();
const subscribe=(listener:()=>void)=>{listeners.add(listener);return()=>{listeners.delete(listener);};};
const snapshot=()=>state;const update=(next:typeof state)=>{state=next;for(const listener of listeners)listener();};
function choose(mode:DisplayMode){try{localStorage.setItem('jigsaw:mobile-v3-display-mode',mode);}catch{}update({mode,message:''});}
export function OrientationEffect(){
 const {mode}=useSyncExternalStore(subscribe,snapshot,snapshot);
 useEffect(()=>{document.documentElement.dataset.h5Host=window.tap?'taptap':'browser';try{const saved=localStorage.getItem('jigsaw:mobile-v3-display-mode');if(saved==='portrait'||saved==='landscape')choose(saved);}catch{}},[]);
 useEffect(()=>startOrientation(mode,message=>update({...state,message})),[mode]);return null;
}
export default function DisplayControls(){
 const {mode,message}=useSyncExternalStore(subscribe,snapshot,snapshot);
 return <div className="h5-display-controls"><label><span>屏幕</span><select aria-label="屏幕方向" value={mode} onChange={event=>choose(event.target.value as DisplayMode)}><option value="auto">随手机</option><option value="portrait">竖屏</option><option value="landscape">横屏</option></select></label>{message&&<output>{message}</output>}</div>;
}
