'use client';
import { useEffect,useState } from 'react';
import { Puzzle,ArrowLeft,RefreshCw } from 'lucide-react';
import { Game } from './puzzle-app';
import { PHOTOS } from '@/lib/puzzle-catalog';
import { RoomClient } from '@/lib/room-client';
import { joinPuzzle } from '@/lib/community-client';
import { useAccount } from './account-gate';
const noop=()=>{};
export default function RoomPlay({roomId}:{roomId:string}){
 const {account}=useAccount(),[client,setClient]=useState<RoomClient|null>(null),[error,setError]=useState(''),[attempt,setAttempt]=useState(0);
 useEffect(()=>{let canceled=false;setError('');void joinPuzzle(roomId,account.name).then(ticket=>{if(!canceled)setClient(new RoomClient(ticket));}).catch(error=>{if(!canceled)setError(error instanceof Error?error.message:'暂时无法加入房间');});return()=>{canceled=true;};},[roomId,account.name,attempt]);
 if(client){const photo=PHOTOS.find(p=>p.id===client.state.imageId);if(photo)return <Game state={client.state} photo={photo} persist={noop} leave={()=>{client.leave();window.location.assign(client.snapshot.visibility==='public'?'/lobby':'/personal');}} restart={noop} saveError={false} collaboration={client}/>;}
 return <main className="room-join-page"><a href="/lobby" className="back-button"><ArrowLeft size={18}/>返回大厅</a><section className="join-card"><Puzzle size={38} className={error?'':'loading-icon'}/><h1>{error?'还没能入座':'正在为你留一个位置…'}</h1>{error?<><p role="alert" className="form-error">{error}</p><button className="primary" onClick={()=>setAttempt(n=>n+1)}><RefreshCw size={18}/>重新连接</button></>:<p className="muted">正在连接这张拼图桌面</p>}</section></main>;
}
