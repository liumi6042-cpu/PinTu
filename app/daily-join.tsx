'use client';
import {useState} from 'react';
import {apiJson} from '@/lib/community-client';
import {saveTicket,type RoomTicket} from '@/lib/room-client';
import {dailyPuzzle} from '@/lib/daily-puzzle';
import type {RoomCard} from '@/lib/lobby-types';
export default function DailyJoin({zh}:{zh:boolean}){const [busy,setBusy]=useState(false),[error,setError]=useState('');async function join(){if(busy)return;setBusy(true);setError('');try{const photo=dailyPuzzle(),{rooms}=await apiJson<{rooms:RoomCard[]}>('/api/lobby');const open=rooms.filter(r=>r.imageId===photo.id&&!r.completed&&r.players<8&&r.acceptingNew!==false).sort((a,b)=>b.players-a.players||b.placed-a.placed)[0];if(open){location.assign('/room/'+open.id);return;}const ticket=await apiJson<RoomTicket>('/api/rooms',{imageId:photo.id,pieces:300,visibility:'public'});saveTicket(ticket);location.assign('/room/'+ticket.room.id);}catch(e){setError(zh?(e instanceof Error?e.message:'暂时无法加入，请重试'):'Could not join. Please try again.');setBusy(false);}}return <div><button className="daily-puzzle-action" disabled={busy} onClick={()=>void join()}>{zh?(busy?'正在找桌…':'今日一起拼'):(busy?'Finding a table…':'Join today’s puzzle')} →</button>{error&&<p role="alert">{error}</p>}</div>;}
