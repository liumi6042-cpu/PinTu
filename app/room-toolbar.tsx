'use client';
import { useEffect, useRef, useState } from 'react';
import { Users, Copy, ExternalLink, Check } from 'lucide-react';
import { Input } from '@/components/ui/input';
import type { RoomClient } from '@/lib/room-client';
import { useRoomConnection } from '@/lib/use-room-connection';
export default function RoomToolbar({client}:{client:RoomClient}){
 const [,refresh]=useState(0),[copied,setCopied]=useState(false),[copyError,setCopyError]=useState(false),connection=useRoomConnection();
 const invite=connection.inviteOrigin?`${connection.inviteOrigin}/room/${client.snapshot.id}`:'';
 const inviteInput=useRef<HTMLInputElement>(null);
 useEffect(()=>client.subscribe(()=>refresh(n=>n+1)),[client]);
 async function copy(){try{await navigator.clipboard.writeText(invite);setCopied(true);setCopyError(false);setTimeout(()=>setCopied(false),2000);}catch{setCopyError(true);requestAnimationFrame(()=>{inviteInput.current?.focus();inviteInput.current?.select();});}}
 return <section className="room-toolbar" aria-label="多人房间"><div className="room-members"><span className="room-count"><Users size={17}/>{client.snapshot.members.length} / 8</span>{client.snapshot.members.map(m=><span key={m.id} className="member-chip" style={{borderColor:`${m.color}77`}}><i style={{background:m.color}}/>{m.name}{m.id===client.ticket.playerId?'（你）':''}</span>)}</div><div className="room-actions"><span className={client.connected?'connection online':'connection offline'}>{client.connected?(connection.local?'局域网同步中':'同步中'):client.message}</span><button className="text-button" onClick={copy} disabled={!connection.ready}>{copied?<Check size={15}/>:<Copy size={15}/>}<span>{copied?'已复制邀请':connection.local?'邀请局域网朋友':'邀请朋友'}</span></button><a className="text-button" href={`/room/${client.snapshot.id}`} target="_blank" rel="noopener noreferrer"><ExternalLink size={15}/><span>打开第二个窗口</span></a></div>{(copyError||connection.local)&&<label className="copy-fallback">{copyError?'已选中链接，按 Ctrl+C 或长按复制':connection.local?'同一 Wi-Fi / 局域网的朋友，用浏览器打开这个链接':'长按或选中复制邀请链接'}<Input ref={inviteInput} readOnly value={invite} onFocus={e=>e.target.select()}/></label>}{client.connected&&client.message!=='房间已连接'&&<p className="room-error" role="status">{client.message}</p>}</section>;
}
