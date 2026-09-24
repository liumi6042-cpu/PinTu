'use client';
import {useEffect,useState,type ReactNode} from 'react';
import {cosmeticUrl} from '@/lib/cosmetic-art';
import {validStyle,iconCrop,iconSheet} from '../public/cosmetics/catalog.mjs';
export function CosmeticIcon({id,size=64}:{id:string;size?:number}){if(!validStyle(id))return null;return <svg width={size} height={size} viewBox={iconCrop(id).join(' ')} aria-hidden="true"><image href={iconSheet} width="1448" height="1086"/></svg>;}
export function CosmeticBubble({id,children}:{id?:string|null;children:ReactNode}){
 const [url,setUrl]=useState('');useEffect(()=>{let active=true;setUrl('');if(id&&validStyle(id))void cosmeticUrl('bubble',id).then(u=>{if(active)setUrl(u);}).catch(()=>{});return()=>{active=false;};},[id]);
 return <p dir="auto" className={url?'cosmetic-bubble':''} style={url?{borderImageSource:`url("${url}")`}:undefined}>{children}</p>;
}

export function CosmeticCursor({id}:{id:string}){const [url,setUrl]=useState('');useEffect(()=>{let active=true;void cosmeticUrl('cursor',id).then(u=>{if(active)setUrl(u);}).catch(()=>{});return()=>{active=false;};},[id]);return url?<img className="cosmetic-cursor" src={url} width={32} height={32} alt=""/>:null;}
