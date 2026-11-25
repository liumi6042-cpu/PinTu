'use client';
import { useEffect, useRef, useState, type RefObject, type CSSProperties } from 'react';
import {cosmeticsOf,validStyle} from '../public/cosmetics/catalog.mjs';
import {cosmeticUrl} from '@/lib/cosmetic-art';
import {CosmeticCursor} from './cosmetic-preview';
import AchievementBadge from './achievement-badge';
import { MousePointer2 } from 'lucide-react';
import { MobileArt, type MobileArtKind } from '../h5/mobile-icons';
import { playerName } from '@/lib/i18n';
import { useLanguage } from './language-switch';
import { CursorClient } from '@/lib/cursor-client';
import { cursorWorld, cursorScreen, type SharedCursor } from '@/lib/room-cursors';
import type { PuzzleTable } from '@/lib/puzzle-table';
import type { RoomClient } from '@/lib/room-client';

export default function RoomCursors({client,canvas,getTable,hidden=false,mobile=false}:{
  client:RoomClient;canvas:RefObject<HTMLCanvasElement|null>;getTable:()=>PuzzleTable|null;hidden?:boolean;mobile?:boolean;
}){
  useLanguage();
  const [cursors,setCursors]=useState<SharedCursor[]>([]),nodes=useRef(new Map<string,HTMLDivElement>());
  const positions=useRef(new Map<string,{x:number;y:number;tx:number;ty:number;updatedAt:number}>());
  const hiddenRef=useRef(hidden);hiddenRef.current=hidden;
  const channel=useRef<CursorClient|null>(null);
  const ownPointer=useRef<HTMLDivElement>(null);
  useEffect(()=>{if(hidden)channel.current?.point(null);},[hidden]);
  useEffect(()=>{const element=canvas.current;if(!element||mobile)return;let alive=true,revision=0;
    const clear=()=>{delete element.dataset.cosmeticCursor;element.style.removeProperty('--cosmetic-cursor');};
    const refresh=async()=>{const n=++revision;clear();if(!window.matchMedia('(pointer:fine)').matches)return;try{const r=await fetch('/api/courtyard',{cache:'no-store'});if(!r.ok)return;const data=await r.json() as {state:Parameters<typeof cosmeticsOf>[0]};const id=cosmeticsOf(data.state).equipped.cursor;if(!validStyle(id))return;const url=await cosmeticUrl('cursor',id);if(alive&&n===revision){element.style.setProperty('--cosmetic-cursor',`url("${url}") 16 16, auto`);element.dataset.cosmeticCursor=id;}}catch{}};
    void refresh();window.addEventListener('focus',refresh);window.addEventListener('puzzle:cosmetics-changed',refresh);window.addEventListener('puzzle:account-changed',refresh);
    const storage=(e:StorageEvent)=>{if(e.key==='jigsaw:cosmetics-updated')void refresh();};window.addEventListener('storage',storage);
    return()=>{alive=false;clear();window.removeEventListener('focus',refresh);window.removeEventListener('puzzle:cosmetics-changed',refresh);window.removeEventListener('puzzle:account-changed',refresh);window.removeEventListener('storage',storage);};
  },[canvas,client,mobile]);

  useEffect(()=>{
    const element=canvas.current;if(!element)return;
    let alive=true;
    const connection=new CursorClient(client.snapshot.id,client.ticket.token,client.ticket.playerId,next=>{
      if(!alive)return;
      const ids=new Set(next.map(cursor=>cursor.playerId));
      for(const id of positions.current.keys())if(!ids.has(id))positions.current.delete(id);
      for(const cursor of next){const previous=positions.current.get(cursor.playerId);positions.current.set(cursor.playerId,{x:previous?.x??cursor.x,y:previous?.y??cursor.y,tx:cursor.x,ty:cursor.y,updatedAt:cursor.updatedAt});}
      setCursors(next);
    },()=>client.connected,()=>document.hidden);
    channel.current=connection;connection.start();
    const pointer=(event:PointerEvent)=>{
      const table=getTable();
      if(!table||hiddenRef.current||document.hidden){connection.point(null);if(ownPointer.current)ownPointer.current.style.visibility='hidden';return;}
      if(mobile&&ownPointer.current&&event.pointerType==='touch'){const rect=element.getBoundingClientRect();ownPointer.current.style.transform='translate3d('+(event.clientX-rect.left+17)+'px,'+(event.clientY-rect.top-27)+'px,0)';ownPointer.current.style.visibility='visible';}
      connection.point(cursorWorld({x:event.clientX,y:event.clientY},element.getBoundingClientRect(),table.camera));
    };
    const hide=()=>{connection.point(null);if(ownPointer.current)ownPointer.current.style.visibility='hidden';};
    const touchEnd=(event:PointerEvent)=>{if(event.pointerType==='touch')hide();};
    const visibility=()=>{if(document.hidden)hide();};
    element.addEventListener('pointermove',pointer);element.addEventListener('pointerdown',pointer);
    element.addEventListener('pointerleave',hide);element.addEventListener('pointercancel',hide);element.addEventListener('pointerup',touchEnd);
    window.addEventListener('blur',hide);document.addEventListener('visibilitychange',visibility);
    const reduced=window.matchMedia('(prefers-reduced-motion: reduce)');let frame=0,previousTime=performance.now();
    const paint=(time:number)=>{
      const table=getTable(),dt=Math.min(100,time-previousTime);previousTime=time;
      if(table)for(const [id,node] of nodes.current){
        const position=positions.current.get(id);if(!position){node.style.visibility='hidden';continue;}
        const amount=reduced.matches?1:1-Math.exp(-dt/65);
        position.x+=(position.tx-position.x)*amount;position.y+=(position.ty-position.y)*amount;
        const screen=cursorScreen(position,table.camera);
        node.style.opacity=reduced.matches?'1':String(Math.max(0,Math.min(1,(10000-(Date.now()-position.updatedAt))/3000)));
        node.style.visibility=!hiddenRef.current&&screen.x>=0&&screen.y>=0&&screen.x<=table.width&&screen.y<=table.height?'visible':'hidden';
        node.style.transform=`translate3d(${screen.x}px,${screen.y}px,0)`;
      }
      frame=requestAnimationFrame(paint);
    };frame=requestAnimationFrame(paint);
    return()=>{
      alive=false;connection.stop();channel.current=null;cancelAnimationFrame(frame);positions.current.clear();
      element.removeEventListener('pointermove',pointer);element.removeEventListener('pointerdown',pointer);
      element.removeEventListener('pointerleave',hide);element.removeEventListener('pointercancel',hide);element.removeEventListener('pointerup',touchEnd);
      window.removeEventListener('blur',hide);document.removeEventListener('visibilitychange',visibility);
    };
  },[client,canvas,getTable,mobile]);
  const ownMember=client.snapshot.members.find(member=>member.id===client.ticket.playerId) as {decoration?:MobileDecorationValue|null}|undefined;
  return <div className="shared-cursors" aria-hidden="true">{cursors.map(cursor=>{
    const details=cursor as SharedCursor & {level?:number;decoration?:MobileDecorationValue|null};
    return <div className="shared-cursor" key={cursor.playerId} ref={node=>{if(node)nodes.current.set(cursor.playerId,node);else nodes.current.delete(cursor.playerId);}}>
    {!mobile&&validStyle(cursor.cursorStyle)?<CosmeticCursor id={cursor.cursorStyle!}/>:mobile?<svg width="24" height="27" viewBox="0 0 20 23" fill="none" shapeRendering="crispEdges"><path d="M1 1h3v2h3v2h3v2h3v2h3v3h-5v3H8v5H5v-7H1Z" fill={cursor.color} stroke="#54333b" strokeWidth="2"/><path d="M3 4h2v2h3v2h3v2H7v3H5V9H3Z" fill="#fff5e1" opacity=".7"/></svg>:<MousePointer2 size={24} fill={cursor.color} stroke="#342e26" strokeWidth={1.4}/>}
    <span style={{backgroundColor:cursor.color}}>{!mobile&&cursor.badge&&<AchievementBadge id={cursor.badge} small/>}{mobile&&<span className="mobile-cursor-avatar"><MobileArt kind="avatar"/></span>}<b>{playerName(cursor.name)}</b>{mobile&&<><span className="mobile-level-badge" style={mobileLevelStyle(details.level??0)}>Lv.{details.level??0}</span><MobileDecoration value={details.decoration}/></>}</span>
  </div>})}{mobile&&ownMember?.decoration&&<div ref={ownPointer} className="mobile-own-decoration" style={{visibility:'hidden'}}><MobileDecoration value={ownMember.decoration}/></div>}</div>;

}

export function mobileLevelStyle(level: number): CSSProperties {
  const color = level >= 1000 ? '#403b52' : level >= 500 ? '#242628' : level >= 300 ? '#5b4874' : level >= 180 ? '#674081' : level >= 120 ? '#7a501b' : level >= 80 ? '#287487' : level >= 50 ? '#b54466' : level >= 30 ? '#a46716' : level >= 20 ? '#7650a7' : level >= 10 ? '#386e99' : level >= 5 ? '#3c7d5d' : '#64748b';
  const border = level >= 120 ? '#e1bc68' : level >= 80 ? '#ccdee3' : 'transparent';
  return { '--level-color': color, '--level-border': border } as CSSProperties;
}

export type MobileDecorationValue={id:string;title:string;kind:string;artKey:string;color:string};
export function MobileDecoration({value}:{value?:MobileDecorationValue|null}) {
  if(!value)return null;
  const supported=['star','bow','butterfly','feather','moon','lantern','leaf'];
  const kind=(supported.includes(value.artKey)?value.artKey:'piece') as MobileArtKind;
  return <span className="mobile-cursor-decoration" title={value.title} style={{color:value.color}}><MobileArt kind={kind}/></span>;
}
