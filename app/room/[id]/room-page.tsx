'use client';
import { useEffect, useState } from 'react';
import { Users, ArrowLeft, ArrowRight } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Game, PHOTOS } from '@/app/puzzle-app';
import type { RoomSnapshot } from '@/lib/room-engine';
import { RoomClient, roomSessionKey, saveTicket, type RoomTicket } from '@/lib/room-client';
const noop=()=>{};
export default function RoomPage({roomId}:{roomId:string}){
 const [client,setClient]=useState<RoomClient|null>(null),[name,setName]=useState(''),[loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState('');
 useEffect(()=>{let canceled=false;async function restore(){try{const raw=sessionStorage.getItem(roomSessionKey(roomId));if(raw){const {token,playerId}=JSON.parse(raw);const r=await fetch(`/api/rooms/${roomId}`,{headers:{Authorization:`Bearer ${token}`},cache:'no-store'});const data=await r.json() as RoomSnapshot & {error?:string};if(r.ok&&!canceled){setClient(new RoomClient({token,playerId,room:data}));return;}if(!canceled&&r.status!==401)setError(data.error||'无法连接房间');}}catch{if(!canceled)setError('暂时无法恢复连接，可以重新加入房间');}finally{if(!canceled)setLoading(false);}}void restore();return()=>{canceled=true;};},[roomId]);
 async function join(e:React.FormEvent){e.preventDefault();setBusy(true);setError('');try{const r=await fetch(`/api/rooms/${roomId}/join`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:name.trim()})});const data=await r.json() as RoomTicket & {error?:string};if(!r.ok)throw new Error(data.error||'加入失败');saveTicket(data as RoomTicket);setClient(new RoomClient(data));}catch(error){setError(error instanceof Error?error.message:'连接失败，请重试');}finally{setBusy(false);}}
 if(client){const photo=PHOTOS.find(p=>p.id===client.state.imageId)!;return <Game state={client.state} photo={photo} persist={noop} leave={()=>{client.leave();window.location.assign('/');}} restart={noop} saveError={false} collaboration={client}/>;}
 return <main className="room-join-page"><a href="/" className="back-button"><ArrowLeft size={18}/>返回选图</a><section className="join-card"><div className="room-icon"><Users size={30}/></div><p className="eyebrow">BETTER TOGETHER</p><h1>一起，把它拼完整。</h1><p className="muted">你收到了一份拼图邀请。填个昵称，就能加入朋友的桌面。</p>{loading?<p className="room-loading">正在连接房间…</p>:<form onSubmit={join}><label className="room-field">你的昵称<Input value={name} onChange={e=>setName(e.target.value)} maxLength={16} placeholder="朋友怎么称呼你？" autoComplete="nickname" required disabled={busy}/></label><button className="primary" disabled={busy||!name.trim()}>{busy?'正在加入…':'加入这桌拼图'}<ArrowRight size={18}/></button></form>}{error&&<p className="room-error" role="alert">{error}</p>}<p className="room-footnote">最多 8 人 · 共享同一张桌面 · 房间保留 24 小时</p></section></main>;
}

