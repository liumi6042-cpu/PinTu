'use client';
import { useState } from 'react';
import { Users, ArrowRight, Link2 } from 'lucide-react';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { saveTicket, type RoomTicket } from '@/lib/room-client';
import { useRoomConnection } from '@/lib/use-room-connection';
import { roomInviteTarget } from '@/lib/room-invite';
export default function MultiplayerEntry({imageId,title,count,compact=false}:{imageId:string;title:string;count:number;compact?:boolean}){
 const [open,setOpen]=useState(false),[name,setName]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[invite,setInvite]=useState('');
 const connection=useRoomConnection();
 async function create(e:React.FormEvent){e.preventDefault();setBusy(true);setError('');try{const response=await fetch('/api/rooms',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({imageId,pieces:count,name:name.trim()})});const data=await response.json() as RoomTicket & {error?:string};if(!response.ok)throw new Error(data.error||'房间创建失败');const ticket=data as RoomTicket;saveTicket(ticket);window.location.assign(`/room/${ticket.room.id}`);}catch(e){setError(e instanceof Error?e.message:'连接失败，请重试');setBusy(false);}}
 function join(){try{window.location.assign(roomInviteTarget(invite,window.location.origin,connection.local));}catch(e){setError(e instanceof Error?e.message:'请粘贴完整的房间邀请链接');}}
 return <><button className={compact?'text-button multiplayer-compact':'secondary multiplayer-entry'} onClick={()=>setOpen(true)}><Users size={18}/><span>{connection.local?'局域网一起拼':'和朋友一起拼'}</span></button><Dialog open={open} onOpenChange={v=>{if(!busy){setOpen(v);setError('');}}}><DialogContent className="multiplayer-dialog"><div className="room-icon"><Users size={26}/></div><DialogTitle>把这幅拼图，分享给朋友。</DialogTitle><DialogDescription>{connection.local?'最多 8 人，在同一 Wi-Fi 或局域网一起拼。房间保存在这台电脑上，无需互联网。':'最多 8 人一起拼。创建后复制邀请链接，朋友随时可以加入。'}</DialogDescription><div className="room-selection"><strong>{title}</strong><span>{count} 片 · 合作拼图</span></div><form onSubmit={create}><label className="room-field">你的昵称<Input value={name} onChange={e=>setName(e.target.value)} placeholder="朋友怎么称呼你？" maxLength={16} required autoComplete="nickname" disabled={busy}/></label><button className="primary" disabled={busy||!name.trim()}>{busy?'正在创建房间…':'创建多人房间'}<ArrowRight size={17}/></button></form><div className="join-divider">已经有邀请？</div><label className="room-field">朋友的房间链接<Input value={invite} onChange={e=>setInvite(e.target.value)} placeholder="粘贴邀请链接" disabled={busy}/></label><button className="secondary" onClick={join} disabled={busy||!invite.trim()||!connection.ready}><Link2 size={16}/>加入朋友的房间</button>{error&&<p className="room-error" role="alert">{error}</p>}<p className="room-footnote">房间保留 24 小时 · 单人进度会保留</p></DialogContent></Dialog></>;
}


