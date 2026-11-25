'use client';
import { useEffect, useRef, useState, type RefObject } from 'react';
import {cosmeticsOf,validStyle} from '../public/cosmetics/catalog.mjs';
import {cosmeticUrl} from '@/lib/cosmetic-art';
import {CosmeticCursor} from './cosmetic-preview';
import ManagedCursor from './managed-cursor';
import {managedCursorUrl,validManagedCursor,type ManagedCursorArt} from '@/lib/managed-decoration-art';
import AchievementBadge from './achievement-badge';
import { MousePointer2 } from 'lucide-react';
import { playerName } from '@/lib/i18n';
import { useLanguage } from './language-switch';
import { CursorClient } from '@/lib/cursor-client';
import { cursorWorld, cursorScreen, type SharedCursor } from '@/lib/room-cursors';
import { worldFor } from '@/lib/puzzle-engine';
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
  useEffect(()=>{const element=canvas.current;if(!element)return;let alive=true,revision=0;
    const clear=()=>{delete element.dataset.cosmeticCursor;element.style.removeProperty('--cosmetic-cursor');};
    const refresh=async()=>{const n=++revision;clear();if(!window.matchMedia('(pointer:fine)').matches)return;
      try{const response=await fetch('/api/player-content',{cache:'no-store'});if(response.ok){const data=await response.json() as {enabled:boolean;decorations?:Array<ManagedCursorArt&{owned:boolean;equipped:boolean}>};const art=data.enabled?data.decorations?.find(item=>item.owned&&item.equipped):null;if(validManagedCursor(art)){if(alive&&n===revision){element.style.setProperty('--cosmetic-cursor',`url("${managedCursorUrl(art)}") 16 16, auto`);element.dataset.cosmeticCursor=art.id;}return;}}}catch{}
      try{const r=await fetch('/api/courtyard',{cache:'no-store'});if(!r.ok)return;const data=await r.json() as {state:Parameters<typeof cosmeticsOf>[0]};const id=cosmeticsOf(data.state).equipped.cursor;if(!validStyle(id))return;const url=await cosmeticUrl('cursor',id);if(alive&&n===revision){element.style.setProperty('--cosmetic-cursor',`url("${url}") 16 16, auto`);element.dataset.cosmeticCursor=id;}}catch{}
    };
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
      if(!table||hiddenRef.current||document.hidden)return;
      const point=cursorWorld({x:event.clientX,y:event.clientY},element.getBoundingClientRect(),table.camera,worldFor(table.state));
      if(point)connection.point(point);
    };
    element.addEventListener('pointermove',pointer);element.addEventListener('pointerdown',pointer);
    const reduced=window.matchMedia('(prefers-reduced-motion: reduce)');let frame=0,previousTime=performance.now();
    const paint=(time:number)=>{
      const table=getTable(),dt=Math.min(100,time-previousTime);previousTime=time;
      if(table)for(const [id,node] of nodes.current){
        const position=positions.current.get(id);if(!position){node.style.visibility='hidden';continue;}
        const amount=reduced.matches?1:1-Math.exp(-dt/65);
        position.x+=(position.tx-position.x)*amount;position.y+=(position.ty-position.y)*amount;
        const screen=cursorScreen(position,table.camera);
        node.style.opacity='1';
        node.style.visibility=!hiddenRef.current&&screen.x>=0&&screen.y>=0&&screen.x<=table.width&&screen.y<=table.height?'visible':'hidden';
        node.style.transform=`translate3d(${screen.x}px,${screen.y}px,0)`;
      }
      frame=requestAnimationFrame(paint);
    };frame=requestAnimationFrame(paint);
    return()=>{
      alive=false;connection.stop();channel.current=null;cancelAnimationFrame(frame);positions.current.clear();
      element.removeEventListener('pointermove',pointer);element.removeEventListener('pointerdown',pointer);
    };
  },[client,canvas,getTable]);
  return <div className="shared-cursors" aria-hidden="true">{cursors.map(cursor=><div className="shared-cursor" key={cursor.playerId} ref={node=>{if(node)nodes.current.set(cursor.playerId,node);else nodes.current.delete(cursor.playerId);}}>
    {validManagedCursor(cursor.managedCursor)?<ManagedCursor art={cursor.managedCursor}/>:validStyle(cursor.cursorStyle)?<CosmeticCursor id={cursor.cursorStyle!}/>:<MousePointer2 size={24} fill={cursor.color} stroke="#342e26" strokeWidth={1.4}/>}<span style={{backgroundColor:cursor.color}}>{cursor.badge&&<AchievementBadge id={cursor.badge} small/>}{playerName(cursor.name)}</span>
  </div>)}</div>;
}
