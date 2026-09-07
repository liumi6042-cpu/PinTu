'use client';
import { useEffect, useState } from 'react';
import { Users, Copy, ExternalLink, Check } from 'lucide-react';
import { Input } from '@/components/ui/input';
import type { RoomClient } from '@/lib/room-client';
export default function RoomToolbar({client}:{client:RoomClient}){
 const [,refresh]=useState(0),[invite,setInvite]=useState(''),[copied,setCopied]=useState(false),[copyError,setCopyError]=useState(false);
 useEffect(()=>{setInvite(`${window.location.origin}/room/${client.snapshot.id}`);return client.subscribe(()=>refresh(n=>n+1));},[client]);
 async function copy(){try{await navigator.clipboard.writeText(invite);setCopied(true);setCopyError(false);setTimeout(()=>setCopied(false),2000);}catch{setCopyError(true);}}
 return <section className="room-toolbar" aria-label="多人房间"><div className="room-members"><span className="room-count"><Users size={17}/>{client.snapshot.members.length} / 8</span>{client.snapshot.members.map(m=><span key={m.id} className="member-chip" style={{borderColor:`${m.color}77`}}><i style={{background:m.color}}/>{m.name}{m.id===client.ticket.playerId?'（你）':''}</span>)}</div><div className="room-actions"><span className={client.connected?'connection online':'connection offline'}>{client.connected?'同步中':client.message}</span><button className="text-button" onClick={copy}>{copied?<Check size={15}/>:<Copy size={15}/>}<span>{copied?'已复制邀请':'邀请朋友'}</span></button><a className="text-button" href={invite} target="_blank" rel="noopener noreferrer"><ExternalLink size={15}/><span>打开第二个窗口</span></a></div>{copyError&&<label className="copy-fallback">长按或选中复制邀请链接<Input readOnly value={invite} onFocus={e=>e.target.select()}/></label>}{client.connected&&client.message!=='房间已连接'&&<p className="room-error" role="status">{client.message}</p>}</section>;
}
