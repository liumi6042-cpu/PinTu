'use client';
import {type ReactNode} from 'react';
import {cosmeticAsset} from '@/lib/cosmetic-art';
export function CosmeticIcon({id,size=64}:{id:string;size?:number}){const url=cosmeticAsset('icon',id);return url?<img src={url} width={size} height={size} alt="" decoding="async"/>:null;}
export function CosmeticBubble({id,children}:{id?:string|null;children:ReactNode}){
 const url=id?cosmeticAsset('bubble',id):'';
 return <p dir="auto" className={url?'cosmetic-bubble':''} style={url?{borderImageSource:`url("${url}")`}:undefined}>{children}</p>;
}
export function CosmeticCursor({id}:{id:string}){const url=cosmeticAsset('cursor',id);return url?<img className="cosmetic-cursor" src={url} width={32} height={32} alt=""/>:null;}
