'use client';
import {useState} from 'react';
import {apiJson} from '@/lib/community-client';
import {saveTicket,type RoomTicket} from '@/lib/room-client';
import {dailyPuzzle} from '@/lib/daily-puzzle';
import type {RoomCard} from '@/lib/lobby-types';
import PiecePicker from './piece-picker';
import type { PHOTOS } from '@/lib/puzzle-catalog';

type DailyPhoto = typeof PHOTOS[number];

export default function DailyJoin({zh, photo, title, compact=false, showImage=false}:{zh:boolean;photo?:DailyPhoto;title?:string;compact?:boolean;showImage?:boolean}){
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[pieces,setPieces]=useState(300);
 const chosen=photo??dailyPuzzle();
 async function join(){
  if(busy)return;setBusy(true);setError('');
  try{
   const {rooms}=await apiJson<{rooms:RoomCard[]}>('/api/lobby');
   const open=rooms.filter(r=>r.imageId===chosen.id&&r.pieces===pieces&&!r.completed&&r.players<8&&r.acceptingNew!==false).sort((a,b)=>b.players-a.players||b.placed-a.placed)[0];
   if(open){location.assign('/room/'+open.id);return;}
   const ticket=await apiJson<RoomTicket>('/api/rooms',{imageId:chosen.id,pieces,visibility:'public'});
   saveTicket(ticket);location.assign('/room/'+ticket.room.id);
  }catch(e){setError(zh?(e instanceof Error?e.message:'暂时无法加入，请重试'):'Could not join. Please try again.');setBusy(false);}
 }
 return <div className={'daily-puzzle-join'+(compact?' is-compact':'')}>
  {showImage&&<button className="daily-puzzle-image-button" type="button" onClick={()=>void join()} disabled={busy} aria-label={title ? `${title} · ${zh?'选择片数并开始拼图':'choose pieces and start'}` : undefined}><img src={chosen.thumbSrc} alt={title||chosen.title} width={480} height={384} loading="lazy" decoding="async"/></button>}
  <PiecePicker count={pieces} onChange={setPieces} disabled={busy} roomCreation/>
  <button className="daily-puzzle-action" disabled={busy} onClick={()=>void join()} aria-label={title ? `${title} · ${zh?'选择片数并开始拼图':'choose pieces and start'}` : undefined}>{zh?(busy?'正在找桌…':'选择片数，开始拼图'):(busy?'Finding a table…':'Choose pieces and start')} →</button>
  {error&&<p role="alert">{error}</p>}
 </div>;
}
