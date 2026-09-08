'use client';
import { useEffect,useMemo,useState } from 'react';
import { ArrowUpRight,Users,Clock3,Search,RefreshCw,Plus } from 'lucide-react';
import { PHOTOS } from '@/lib/puzzle-catalog';
import type { RoomCard } from '@/lib/lobby-types';
import { apiJson,clockLabel } from '@/lib/community-client';
import { t } from '@/lib/i18n';
import { useLanguage } from './language-switch';
import CommunityShell from './community-shell';

export default function PublicLobby(){
 const language=useLanguage();
 const [rooms,setRooms]=useState<RoomCard[]>([]),[ready,setReady]=useState(false),[error,setError]=useState('');
 const [query,setQuery]=useState(''),[filter,setFilter]=useState('all'),[now,setNow]=useState(Date.now),[offset,setOffset]=useState(0);
 useEffect(()=>{
  let alive=true,timer:ReturnType<typeof setTimeout>;
  async function refresh(){
   try{if(!document.hidden){const result=await apiJson<{rooms:RoomCard[];serverTime:number}>('/api/lobby');if(alive){setRooms(result.rooms);setOffset(result.serverTime-Date.now());setNow(Date.now());setError('');}}}
   catch(e){if(alive)setError(e instanceof Error?e.message:'大厅暂时无法刷新');}
   finally{if(alive){setReady(true);timer=setTimeout(refresh,3500);}}
  }
  void refresh();const tick=setInterval(()=>{if(!document.hidden)setNow(Date.now());},1000);
  return()=>{alive=false;clearTimeout(timer);clearInterval(tick);};
 },[]);
 const visible=useMemo(()=>rooms.filter(room=>{
  const photo=PHOTOS.find(p=>p.id===room.imageId);
  const text=[room.title,t(room.title),photo?.category,t(photo?.category)].join(' ').toLocaleLowerCase();
  return text.includes(query.trim().toLocaleLowerCase())&&(filter==='all'||filter==='active'&&room.players>0||filter==='open'&&room.players<8);
 }),[rooms,query,filter,language]);
 return <CommunityShell active="lobby"><main className="community-main lobby-main">
  <section className="lobby-heading"><div><p className="section-kicker">PIECES & PEOPLE</p><h1>{t('公开拼图大厅')}</h1><p>{t('无需登录，点开就能一起拼。')}</p></div><div className="lobby-summary"><span><Users size={16}/><strong>{rooms.reduce((sum,r)=>sum+r.players,0)}</strong> {t('位玩家在线')}</span><span><strong>{rooms.length}</strong> {t('个公开房间')}</span></div></section>
  <div className="lobby-filters"><div className="filter-tabs">{[{id:'all',name:'所有拼图'},{id:'active',name:'有人在拼'},{id:'open',name:'可以加入'}].map(item=><button key={item.id} aria-pressed={filter===item.id} onClick={()=>setFilter(item.id)}>{t(item.name)}</button>)}</div><label className="lobby-search"><Search size={18}/><input aria-label={t('搜索公开拼图')} placeholder={t('搜索喜欢的画面')} value={query} onChange={e=>setQuery(e.target.value)}/></label></div>
  {error&&<p className="form-error" role="alert">{t(error)}</p>}
  {!ready?<div className="community-empty"><RefreshCw className="loading-icon" size={28}/><p>{t('正在铺开公开桌面…')}</p></div>:visible.length?<div className="public-grid public-tiled-grid">{visible.map((room,index)=>{
   const photo=PHOTOS.find(p=>p.id===room.imageId)!;
   const progress=Math.round(room.placed/room.pieces*100),full=room.players>=8;
   const elapsed=room.startedAt===null?0:Math.max(0,Math.floor((now+offset-room.startedAt)/1000));
   return <article className="public-card" key={room.id}><a className="public-card-link" href={'/room/'+room.id} aria-disabled={full} onClick={event=>{if(full)event.preventDefault();}} aria-label={t(photo.title)+' · '+t(full?'已满员':'点击图片，加入拼图')}>
    <div className="public-picture"><img src={photo.src} alt={t(photo.title)} loading={index<3?'eager':'lazy'}/><span className="picture-count">{room.pieces.toLocaleString()} {t('片')}</span><span className={'live-chip'+(room.players?' is-active':'')}><i/>{t(full?'已满员':room.players?'正在拼图':'等你开拼')}</span><div className="public-picture-stats"><span aria-label={t('拼图计时')}><Clock3 size={16}/><time>{clockLabel(elapsed)}</time></span><span aria-label={t('在线人数')}><Users size={16}/><strong>{room.players}/8</strong></span></div></div>
    <div className="public-card-body"><div className="public-title"><h2>{t(photo.title)}</h2><ArrowUpRight size={19}/></div><div className="public-card-bottom"><span>{t(photo.category)} · {progress}% {t('已完成')}</span><span className="public-join-label">{t(full?'已满员':'加入拼图')}</span></div><div className="room-progress" aria-hidden="true"><span style={{width:progress+'%'}}/></div></div>
   </a></article>;
  })}</div>:<div className="community-empty"><Search size={30}/><h2>{t('还没有符合条件的桌面')}</h2><button className="secondary" onClick={()=>{setFilter('all');setQuery('');}}>{t('看看全部桌面')}</button></div>}
  <a href="/personal?mode=create" className="create-table-link"><Plus size={20}/><span>{t('去创建房间')}</span><ArrowUpRight size={20}/></a>
 </main></CommunityShell>;
}