'use client';
import { useEffect, useRef, useState, type RefObject } from 'react';
import {cosmeticsOf,validStyle} from '../public/cosmetics/catalog.mjs';
import {cosmeticUrl} from '@/lib/cosmetic-art';
import {CosmeticCursor} from './cosmetic-preview';
import AchievementBadge from './achievement-badge';
import { MousePointer2 } from 'lucide-react';
import { playerName } from '@/lib/i18n';
import { useLanguage } from './language-switch';
import { CursorClient } from '@/lib/cursor-client';
import { cursorWorld, cursorScreen, type SharedCursor } from '@/lib/room-cursors';
import type { PuzzleTable } from '@/lib/puzzle-table';
import type { RoomClient } from '@/lib/room-client';

export default function RoomCursors({client,canvas,getTable,hidden=false}:{
  client:RoomClient;canvas:RefObject<HTMLCanvasElement|null>;getTable:()=>PuzzleTable|null;hidden?:boolean;
}){
  useLanguage();
  const [cursors,setCursors]=useState<SharedCursor[]>([]),nodes=useRef(new Map<string,HTMLDivElement>());
  const positions=useRef(new Map<string,{x:number;y:number;tx:number;ty:number;updatedAt:number}>());
  const hiddenRef=useRef(hidden);hiddenRef.current=hidden;
  const channel=useRef<CursorClient|null>(null);
  useEffect(()=>{if(hidden)channel.current?.point(null);},[hidden]);
  useEffect(()=>{const element=canvas.current;if(!element)return;let alive=true,revision=0;
    const clear=()=>{delete element.dataset.cosmeticCursor;element.style.removeProperty('--cosmetic-cursor');};
    const refresh=async()=>{const n=++revision;clear();if(!window.matchMedia('(pointer:fine)').matches)return;try{const r=await fetch('/api/courtyard',{cache:'no-store'});if(!r.ok)return;const data=await r.json() as {state:Parameters<typeof cosmeticsOf>[0]};const id=cosmeticsOf(data.state).equipped.cursor;if(!validStyle(id))return;const url=await cosmeticUrl('cursor',id);if(alive&&n===revision){element.style.setProperty('--cosmetic-cursor',`url("${url}") 16 16, auto`);element.dataset.cosmeticCursor=id;}}catch{}};
    void refresh();window.addEventListener('focus',refresh);window.addEventListener('puzzle:cosmetics-changed',refresh);window.addEventListener('puzzle:account-changed',refresh);
    const storage=(e:StorageEvent)=>{if(e.key==='jigsaw:cosmetics-updated')void refresh();};window.addEventListener('storage',storage);
    return()=>{alive=false;clear();window.removeEventListener('focus',refresh);window.removeEventListener('puzzle:cosmetics-changed',refresh);window.removeEventListener('puzzle:account-changed',refresh);window.removeEventListener('storage',storage);};
  },[canvas,client]);

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
      if(!table||hiddenRef.current||document.hidden){connection.point(null);return;}
      connection.point(cursorWorld({x:event.clientX,y:event.clientY},element.getBoundingClientRect(),table.camera));
    };
    const hide=()=>connection.point(null);
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
  },[client,canvas,getTable]);
  return <div className="shared-cursors" aria-hidden="true">{cursors.map(cursor=><div className="shared-cursor" key={cursor.playerId} ref={node=>{if(node)nodes.current.set(cursor.playerId,node);else nodes.current.delete(cursor.playerId);}}>
    {validStyle(cursor.cursorStyle)?<CosmeticCursor id={cursor.cursorStyle!}/>:<MousePointer2 size={24} fill={cursor.color} stroke="#342e26" strokeWidth={1.4}/>}<span style={{backgroundColor:cursor.color}}>{cursor.badge&&<AchievementBadge id={cursor.badge} small/>}{playerName(cursor.name)}</span>
  </div>)}</div>;
}
