'use client';
import { useEffect,useMemo,useState,useRef } from 'react';
import { ArrowUpRight,Users,Clock3,Search,RefreshCw,Plus,Shuffle,ImagePlus } from 'lucide-react';
import { GALLERY_VISIBLE_PHOTOS,RESTORABLE_PHOTOS } from '@/lib/puzzle-catalog';
import { randomPhoto } from '@/lib/random-photo';
import { recommendedPieces } from '@/lib/play-guidance';
import { saveTicket,type RoomTicket } from '@/lib/room-client';
import { useRouter } from 'next/navigation';
import type { RoomCard } from '@/lib/lobby-types';
import type { CompletionStats } from '@/lib/completion-stats';
import { apiJson,clockLabel } from '@/lib/community-client';
import { useAddressCopy } from '@/lib/address-copy';
import { useLanguage } from './language-switch';
import LobbyCommunity from './lobby-community';

/**
 * Pictures delivered after this bundle was built are absent from the compiled
 * catalogue. The lobby card already carries the thumbnail and measured frame
 * from the server, so render that instead of showing an empty card.
 */
function deliveredLobbyPhoto(room:RoomCard){
 if(!room.thumbSrc)return undefined;
 return {id:room.imageId,title:room.title,category:'',src:room.thumbSrc,thumbSrc:room.thumbSrc,playSrc:room.thumbSrc,optimizedSrc:room.thumbSrc,
  width:room.artwork?.width??0,height:room.artwork?.height??0} as unknown as (typeof RESTORABLE_PHOTOS)[number];
}
import CommunityShell from './community-shell';
import ResumePuzzle from './resume-puzzle';
import SearchIntroduction from './search-introduction';
import { usePathname } from 'next/navigation';
import { isChinesePath } from '@/lib/site-paths';
import { markLobbyVisited } from '@/lib/entrance-preference';
import { preloadPuzzleImage } from '@/lib/puzzle-image-loading';
import {puzzleImageSource} from '@/lib/puzzle-image-source';
import {PIECE_LOGIN_REQUIRED} from '@/lib/piece-access';
import {accountLoginUrl,publicPuzzleReturnTo} from '@/lib/account-return';
import {customPhoto} from '@/lib/custom-images';
import LobbyFirstVisit from './lobby-first-visit';

// `daily` is a server-rendered slot, the same one the home page uses, so the day's
// picture is in the lobby's HTML rather than appearing only after the client asks for
// it — and the lobby shows it as a single row, because the tables are what people came for.
function AnimatedCount({value}:{value:number}){
 const [shown,setShown]=useState(value),previous=useRef(value);
 useEffect(()=>{const from=previous.current,to=value;previous.current=to;if(from===to){setShown(to);return;}let frame=0;const start=performance.now();const step=(time:number)=>{const progress=Math.min(1,(time-start)/420);setShown(Math.round(from+(to-from)*(1-Math.pow(1-progress,3))));if(progress<1)frame=requestAnimationFrame(step);};frame=requestAnimationFrame(step);return()=>cancelAnimationFrame(frame);},[value]);
 return <strong>{shown.toLocaleString()}</strong>;
}
export default function PublicLobby({daily,initialStats}:{daily?:React.ReactNode;initialStats?:CompletionStats|null}){
 const language=useLanguage();
 // Creating a public table should keep a Chinese visitor on the Chinese gallery.
 const zh=isChinesePath(usePathname()||''),copy=useAddressCopy(),createTableHref=zh?'/zh/gallery?mode=public':'/gallery?mode=public';
 const router=useRouter(),launchLock=useRef(false),mounted=useRef(true);
 const [randomBusy,setRandomBusy]=useState(false),[launchError,setLaunchError]=useState('');
 useEffect(()=>{mounted.current=true;markLobbyVisited();return()=>{mounted.current=false;};},[]);
 async function launchRandom(){
  if(launchLock.current)return;launchLock.current=true;setRandomBusy(true);setLaunchError('');
  const photo=randomPhoto(GALLERY_VISIBLE_PHOTOS);preloadPuzzleImage(puzzleImageSource(photo,recommendedPieces(photo.id)));
  try{const ticket=await apiJson<RoomTicket>('/api/rooms',{imageId:photo.id,pieces:recommendedPieces(photo.id),visibility:'public'});if(!mounted.current)return;saveTicket(ticket);router.push('/room/'+ticket.room.id);}
  catch(e){if(mounted.current&&e instanceof Error&&e.message===PIECE_LOGIN_REQUIRED){window.location.assign(accountLoginUrl(publicPuzzleReturnTo(photo.id,recommendedPieces(photo.id))));return;}launchLock.current=false;if(mounted.current){setRandomBusy(false);setLaunchError(e instanceof Error?e.message:'暂时无法开始');}}
 }
 const [rooms,setRooms]=useState<RoomCard[]>([]),[ready,setReady]=useState(false),[error,setError]=useState('');
 const [stats,setStats]=useState<CompletionStats|null>(initialStats??null);
 const [query,setQuery]=useState(''),[filter,setFilter]=useState('all'),[now,setNow]=useState(Date.now),[offset,setOffset]=useState(0);
 const enterRooms=()=>{setFilter('open');window.setTimeout(()=>document.getElementById('lobby-tables')?.scrollIntoView({behavior:'smooth',block:'start'}),0);};
 useEffect(()=>{
  let alive=true,timer:ReturnType<typeof setTimeout>;
  async function refresh(){
   try{if(!document.hidden){const result=await apiJson<{rooms:RoomCard[];stats?:CompletionStats;serverTime:number}>('/api/lobby');if(alive){setRooms(result.rooms);setStats(result.stats??null);setOffset(result.serverTime-Date.now());setNow(Date.now());setError('');}}}
   catch(e){if(alive)setError(e instanceof Error?e.message:'大厅暂时无法刷新');}
   finally{if(alive){setReady(true);timer=setTimeout(refresh,3500);}}
  }
  void refresh();const tick=setInterval(()=>{if(!document.hidden)setNow(Date.now());},1000);
  return()=>{alive=false;clearTimeout(timer);clearInterval(tick);};
 },[]);
 const visible=useMemo(()=>rooms.filter(room=>{
  const photo=RESTORABLE_PHOTOS.find(p=>p.id===room.imageId);
  const text=[room.title,copy(room.title),photo?.category,copy(photo?.category)].join(' ').toLocaleLowerCase();
  return text.includes(query.trim().toLocaleLowerCase())&&(filter==='all'||filter==='active'&&room.players>0||filter==='open'&&room.players<8&&room.acceptingNew!==false);
 }),[rooms,query,filter,language]);
 // Finished-picture counters and placed-piece counters remain separate. The day's
 // placed pieces roll over at the same Beijing midnight as the daily picture.
 const summary=stats&&<><span><AnimatedCount value={stats.completedToday}/> {copy('幅 · 今天完成')}</span><span><AnimatedCount value={stats.completedTotal}/> {copy('幅 · 累计完成')}</span><span><AnimatedCount value={stats.completedPiecesTotal}/> {copy('片 · 全站累计')}</span></>;
 return <CommunityShell active="lobby"><LobbyFirstVisit zh={zh} onEnterRooms={enterRooms}/><main className="community-main lobby-main">
  <section className="lobby-heading"><div><p className="section-kicker">JIGSAW NOOK</p><h1>{copy('公开拼图大厅')}</h1><p>{copy('任何片数都能直接加入；只有创建 500 片及以上房间需要登录。')}</p></div><div className="lobby-summary"><span title={copy('今日实际归位的拼图块数，每天零点（北京时间）重新计数。')}>{stats?<AnimatedCount value={stats.completedPiecesToday}/>:<strong>—</strong>} {copy('当日完成碎片')}</span>{summary}</div></section>
  <LobbyCommunity/>
  <ResumePuzzle/>
  {daily}
  <div className="public-create-row"><a className="primary" href={createTableHref}><Plus size={19}/>{copy('创建公开房间')}</a><button className="secondary" disabled={randomBusy} onClick={()=>void launchRandom()} title={copy('随机选图，按推荐片数创建公开房间')}><Shuffle size={18}/>{copy(randomBusy?'正在铺开桌面…':'随机开一桌')}</button><p>{copy('公开房间免费；创建 500 片及以上房间需登录，加入不限。')}</p></div>{launchError&&<p className="form-error" role="alert">{copy(launchError)}</p>}<p className="public-retention-note">{copy('公开房间从创建起在大厅展示 24 小时（500 片及以上 36 小时），中途继续拼不会延长；到期后从大厅隐藏、仍可从拼图记录回来继续；无人且未拼合的房间会更早清理。')}</p>
  <div className="lobby-filters" id="lobby-tables"><div className="filter-tabs">{[{id:'all',name:'所有拼图'},{id:'active',name:'有人在拼'},{id:'open',name:'可以加入'}].map(item=><button key={item.id} aria-pressed={filter===item.id} onClick={()=>setFilter(item.id)}>{copy(item.name)}</button>)}</div><label className="lobby-search"><Search size={18}/><input aria-label={copy('搜索公开拼图')} placeholder={copy('搜索喜欢的画面')} value={query} onChange={e=>setQuery(e.target.value)}/></label></div>
  {error&&<p className="form-error" role="alert">{copy(error)}</p>}
  {!ready?<div className="community-empty"><RefreshCw className="loading-icon" size={28}/><p>{copy('正在铺开公开桌面…')}</p></div>:visible.length?<div className="public-grid public-tiled-grid">{visible.map((room,index)=>{
   const catalogPhoto=RESTORABLE_PHOTOS.find(p=>p.id===room.imageId)??deliveredLobbyPhoto(room),uploadedPhoto=room.customImage?customPhoto(room.customImage,room.id):null;
   const photo=catalogPhoto||uploadedPhoto,uploadOnly=!catalogPhoto&&!!room.customTitle,title=room.customTitle?room.title:(catalogPhoto?catalogPhoto.title:room.title),category=catalogPhoto?catalogPhoto.category:'玩家上传';
   const progress=Math.round(room.placed/room.pieces*100),full=room.players>=8;
   const elapsed=room.startedAt===null?0:Math.max(0,Math.floor((now+offset-room.startedAt)/1000));
   const joinLabel=copy(full?'已满员':room.acceptingNew===false?'老朋友继续':'加入拼图');
   return <article className="public-card" key={room.id}><a className="public-card-link" href={'/room/'+room.id} aria-disabled={full} onClick={event=>{if(full)event.preventDefault();else if(catalogPhoto)preloadPuzzleImage(puzzleImageSource(catalogPhoto,room.pieces));}} aria-label={copy(title)+' · '+copy(full?'已满员':'点击图片，加入拼图')}>
    <div className="public-picture">{room.customImage?<img src={'/api/user-images/'+room.customImage.id+'?room='+room.id+'&preview=1'} alt={copy(title)} loading={index<3?'eager':'lazy'}/>:photo?<img src={photo.thumbSrc} alt={copy(title)} loading={index<3?'eager':'lazy'}/>:<span className="public-picture-upload" aria-hidden="true"><ImagePlus size={30}/></span>}<span className="picture-count">{room.pieces.toLocaleString()} {copy('片')}</span><span className={'live-chip'+(room.players?' is-active':'')}><i/>{copy(full?'已满员':room.acceptingNew===false?'暂停接待新玩家':room.players?'正在拼图':'等你开拼')}</span><div className="public-picture-stats"><span aria-label={copy('拼图计时')}><Clock3 size={16}/><time>{clockLabel(elapsed)}</time></span><span aria-label={copy('在线人数')}><Users size={16}/><strong>{room.players}/8</strong></span></div></div>
    <div className="public-card-body"><div className="public-title"><h2>{catalogPhoto&&!room.customTitle?copy(catalogPhoto.title):room.title}</h2><ArrowUpRight size={19}/></div><div className="public-card-bottom"><span>{copy(category)} · {progress}% {copy('已完成')}</span><span className="public-join-label">{uploadOnly?copy('玩家上传'):joinLabel}</span></div><div className="room-progress" aria-hidden="true"><span style={{width:progress+'%'}}/></div></div>
   </a></article>;
  })}</div>:<div className="community-empty"><Search size={30}/><h2>{copy(rooms.length?'还没有符合条件的桌面':'还没有公开房间，来开第一桌吧。')}</h2><button className="secondary" onClick={()=>{setFilter('all');setQuery('');}}>{copy('看看全部桌面')}</button></div>}
  <a href={createTableHref} className="create-table-link"><Plus size={20}/><span>{copy('创建公开房间')}</span><ArrowUpRight size={20}/></a>
 <SearchIntroduction kind="lobby"/></main></CommunityShell>;
}
