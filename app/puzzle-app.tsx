'use client';
import { t } from '@/lib/i18n';
import { useLanguage } from '@/app/language-switch';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Puzzle, Moon, Sun, ArrowRight, ArrowLeft, Search, Play, Pause, Image as ImageIcon, Images, Lightbulb, Shuffle, ZoomIn, ZoomOut, Scan, HelpCircle, RotateCcw, Check, X, Clock3, Expand, Minimize, LockKeyhole, PartyPopper } from 'lucide-react';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogContent, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction } from '@/components/ui/alert-dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import LanguageSwitch from './language-switch';
import { createPuzzle, restartPuzzle, LEVELS, placedCount, type PuzzleState } from '@/lib/puzzle-engine';
import { CompletionGate } from '@/lib/celebration-engine';
import { CelebrationOverlay, CelebrationPreview } from './celebration';
import { PuzzleTable } from '@/lib/puzzle-table';
import { TABLE_THEME_KEY, parseTableTheme, type TableTheme } from '@/lib/table-theme';
import { registerPuzzleTools } from '@/lib/webmcp';
import AssistanceTools from './assistance-tools';
import SoundControl from './sound-control';
import { apiJson } from '@/lib/community-client';
import { saveTicket, type RoomTicket } from '@/lib/room-client';
import RoomToolbar from './room-toolbar';
import RoomCursors from './room-cursors';
import AchievementBadge from './achievement-badge';
import { Trophy } from 'lucide-react';
import { useGameAchievements,AchievementToast,CompletionAchievements } from './game-achievements';
import MemberRoomGate from './member-room-gate';
import { MEMBERSHIP_REQUIRED } from '@/lib/membership-policy';
import { useMembership } from '@/lib/use-membership';
import {ReportProblem} from './feedback-widget';
import CompletionRecord from './completion-record';
import HomeNavigation from './home-navigation';
import { recommendedPieces } from '@/lib/play-guidance';
import GalleryCard from './gallery-card';
import PuzzleOpening from './puzzle-opening';
import { activeKey, saveKey, readLocalProgress, writeLocalProgress } from '@/lib/local-progress';
import { randomPhoto } from '@/lib/random-photo';
import type { RoomClient } from '@/lib/room-client';
import { PHOTOS, RESTORABLE_PHOTOS, CATEGORIES } from '@/lib/puzzle-catalog';
import { englishCopy } from '@/lib/seo';
import AccountGate from './account-gate';
import { useRouter } from 'next/navigation';
import { preloadPuzzleImage } from '@/lib/puzzle-image-loading';
export { PHOTOS } from '@/lib/puzzle-catalog';

type Photo = typeof PHOTOS[number];
const duration = (seconds: number) => { const s = Math.floor(seconds); return `${s >= 3600 ? `${Math.floor(s / 3600)}:` : ''}${String(Math.floor(s / 60) % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; };
function Brand() { useLanguage(); return <span className="brand"><Puzzle size={26}/><span>{t('一起拼图')}<small>THE PUZZLE COLLECTION</small></span></span>; }
function Difficulty({count,setCount,disabled=false}:{count:number;setCount:(n:number)=>void;disabled?:boolean}) {
 useLanguage(); const items=[{value:0,label:t('按图片推荐')},...LEVELS.map(l=>({value:l.count,label:t(`${l.count.toLocaleString()} 片 · ${l.label}`)}))];
 return <div className="difficulty-picker"><label htmlFor="piece-count">{t('拼图片数')}</label><Select disabled={disabled} items={items} value={count} onValueChange={value=>{if(value!==null)setCount(value);}}><SelectTrigger id="piece-count" className="difficulty-trigger" aria-describedby="piece-count-note"><SelectValue/></SelectTrigger><SelectContent className="difficulty-menu" align="start" alignItemWithTrigger={false} sideOffset={9}>{items.map(item=><SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectContent></Select><p id="piece-count-note">{t(count===0?'按每张图的细节和构图选择合适片数。':count>=1000?'高片数适合耐心挑战，放大细节受原图限制。':'108–5,000 片，按喜欢的难度开始。')}</p></div>;
}
type PuzzleAppProps = {entryMode?:'solo'|'create'|'public';guestPlay?:boolean;gallery?:boolean;initialQuery?:string};
export default function PuzzleApp(props: PuzzleAppProps) {
 return (props.entryMode ?? 'solo') === 'solo' && !props.guestPlay
  ? <AccountGate requireLogin solo><PuzzleCollection {...props}/></AccountGate>
  : <PuzzleCollection {...props}/>;
}
function PuzzleCollection({entryMode='solo',guestPlay=false,gallery=false,initialQuery=''}: PuzzleAppProps) {
 const router=useRouter();
 const language=useLanguage(),membership=useMembership(entryMode==='create');
 const [roomName,setRoomName]=useState('');
 const [creating,setCreating]=useState(false),[entryError,setEntryError]=useState('');
 const [opening,setOpening]=useState<{photo:Photo;pieces:number}|null>(null);
 const launchLock=useRef(false),mounted=useRef(true);
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
 const [session,setSession]=useState<PuzzleState|null>(null),[query,setQuery]=useState(()=>t(initialQuery)),[category,setCategory]=useState('全部'),[count,setCount]=useState(0),[saved,setSaved]=useState<Record<string,PuzzleState>>({}),[ready,setReady]=useState(false),[saveError,setSaveError]=useState(false);
 useEffect(()=>{
  if(!guestPlay){setReady(true);return;}
  try{
   const entries=readLocalProgress(localStorage);setSaved(Object.fromEntries(entries.map(entry=>[entry.key,entry.state])));
   const resumeKey=new URLSearchParams(window.location.search).get('resume');
   if(guestPlay&&resumeKey){const previous=entries.find(entry=>entry.key===resumeKey);if(previous){setSession(structuredClone(previous.state));}else setEntryError('没有找到这份本机进度，请在原来的浏览器中继续。');}
  }catch{setSaveError(true);}setReady(true);
 },[guestPlay]);
 const photos=useMemo(()=>gallery?PHOTOS.filter(p=>(category==='全部'||p.category===category)&&[p.title,p.category,p.subtitle,englishCopy(p.title),englishCopy(p.category),englishCopy(p.subtitle)].join(' ').toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())):PHOTOS,[gallery,category,query]);
 const persist=useCallback((state:PuzzleState)=>{try{writeLocalProgress(localStorage,state);setSaveError(false);}catch{setSaveError(true);}},[]);
 const start=useCallback((chosen:Photo,pieces:number)=>{const level=LEVELS.find(l=>l.count===pieces);if(!level)throw new Error('请选择列表内的图片和片数');const previous=saved[saveKey(chosen.id,pieces)],state=previous&&placedCount(previous)<pieces?structuredClone(previous):createPuzzle(chosen.id,level.cols,level.rows);persist(state);setSession(state);},[saved,persist]);
 const beginPuzzle=useCallback(async(chosen:Photo,pieces:number)=>{
  if(entryMode==='create'&&(!membership.data?.summary.canCreate||membership.loading||membership.error))throw new Error(MEMBERSHIP_REQUIRED);
  if(launchLock.current)throw new Error('拼图正在打开，请稍候');
  if(!LEVELS.some(level=>level.count===pieces))throw new Error('请选择列表内的图片和片数');
  launchLock.current=true;const roomVisibility=entryMode==='solo'?'solo':entryMode==='public'?'public':'private';setOpening({photo:chosen,pieces});setCreating(true);setEntryError('');
  preloadPuzzleImage(chosen.src);
  try{if(guestPlay){start(chosen,pieces);setCreating(false);return;}const ticket=await apiJson<RoomTicket>('/api/rooms',{imageId:chosen.id,pieces,visibility:roomVisibility,...(entryMode!=='solo'?{title:roomName}: {})});if(!mounted.current)return;saveTicket(ticket);router.push('/room/'+ticket.room.id);}
  catch(error){launchLock.current=false;if(!mounted.current)return;setEntryError(error instanceof Error?error.message:'暂时无法开始');setCreating(false);throw error;}
 },[entryMode,guestPlay,start,roomName,membership.data?.summary.canCreate,membership.loading,membership.error,router]);
 const leave=()=>{launchLock.current=false;setCreating(false);if(session){persist(session);setSaved(s=>({...s,[saveKey(session.imageId,session.cols*session.rows)]:structuredClone(session)}));}try{localStorage.removeItem(activeKey);}catch{}const url=new URL(window.location.href);url.searchParams.delete('resume');window.history.replaceState(null,'',url.pathname+url.search);setSession(null);};
 const stateRef=useRef({session,count});stateRef.current={session,count};
 useEffect(()=>registerPuzzleTools({read:()=>({screen:stateRef.current.session?'playing':gallery?'gallery':'collection',puzzles:PHOTOS.map(({id,title})=>({id,title})),pieceCounts:LEVELS.map(l=>l.count),current:stateRef.current.session?{imageId:stateRef.current.session.imageId,pieces:stateRef.current.session.cols*stateRef.current.session.rows,placed:placedCount(stateRef.current.session),elapsed:stateRef.current.session.elapsed}:null}),start:async(imageId,pieces)=>{const p=PHOTOS.find(p=>p.id===imageId);if(!p||!LEVELS.some(l=>l.count===pieces))throw new Error('请选择列表内的图片和片数');if(stateRef.current.session)throw new Error('请先从当前拼图返回选图页');await beginPuzzle(p,pieces);return{screen:guestPlay?'playing':'room',imageId,pieces};}}),[beginPuzzle,guestPlay,gallery]);
 if(entryMode==='create'&&(!membership.data?.summary.canCreate||membership.loading||membership.error))return <main className="collection collection-simple"><header className="site-header"><a href="/" className="collection-brand-link"><Brand/></a><HomeNavigation/></header>{membership.loading?<p className="muted">{t('正在读取会员状态…')}</p>:<>{membership.error&&<p className="form-error" role="alert">{t(membership.error)}<button onClick={membership.reload}>{t('重试')}</button></p>}{membership.data?.summary.status==='active'&&!membership.data.summary.canCreate&&<p className="form-error">{t('已有 3 个进行中的私人房间，请先完成其中一局')}</p>}<MemberRoomGate/></>}</main>;
 if(session)return <Game key={`${session.imageId}-${session.cols}-${session.seed}`} state={session} photo={RESTORABLE_PHOTOS.find(p=>p.id===session.imageId)!} persist={persist} leave={leave} saveError={saveError} restart={()=>{const state=restartPuzzle(session);persist(state);setSession(state);}}/>;
 if(creating&&opening&&!guestPlay)return <PuzzleOpening photo={opening.photo} pieces={opening.pieces}/>;
 const oldSaves=Object.values(saved).filter(s=>placedCount(s)<s.cols*s.rows);
 const launchPhoto=(chosen:Photo)=>{void beginPuzzle(chosen,count||recommendedPieces(chosen.id)).catch(()=>{});};
 const roomOptions=entryMode!=='solo'&&<p className="room-mode-note">{t(entryMode==='public'?'免费公开房间 · 所有人都能加入':'会员私人房间 · 仅通过邀请链接加入')}</p>;
 return <main className={'collection collection-simple'+(gallery?' gallery-collection':'')}>
  <header className="site-header"><a href="/" className="collection-brand-link"><Brand/></a><HomeNavigation galleryHref={guestPlay?'/gallery':'/gallery?mode='+entryMode}/></header>
  <section className="collection-intro"><p className="eyebrow">{gallery?'THE PICTURE LIBRARY':'A LITTLE SURPRISE'}</p><h1>{t(entryMode==='public'?'创建公开房间':gallery?'把喜欢的画面，慢慢拼起来。':entryMode==='solo'?'下一幅，交给一点小运气。':'随机一幅画，准备一起拼。')}</h1><p className="muted">{t(gallery?'所有画面都在这里，选好片数，点图开拼。':'从整个图库随机挑一张，点一下就开拼。')}</p>
   {gallery?<div className="gallery-filters"><div className="search-box"><Search size={18}/><input disabled={creating} value={query} onChange={e=>{setQuery(e.target.value);}} placeholder={t('搜索拼图、风景、艺术…')} aria-label={t('搜索拼图')}/>{query&&<button disabled={creating} className="clear-search" aria-label={t('清空搜索')} onClick={()=>{setQuery('');}}><X size={16}/></button>}</div><div className="categories" aria-label={t('拼图分类')}>{CATEGORIES.map(c=><button key={c} disabled={creating} aria-pressed={category===c} className={category===c?'active':''} onClick={()=>{setCategory(c);}}>{t(c)}</button>)}</div></div>:<a className="gallery-entry" href={guestPlay?'/gallery':'/gallery?mode='+entryMode}><Images size={18}/>{t('去图库挑选更多')}<ArrowRight size={17}/></a>}
  </section>
  <div className="collection-settings"><Difficulty count={count} setCount={setCount} disabled={creating}/>{entryMode!=='solo'&&<label className="member-room-name">{t('房间名称（可选）')}<input maxLength={40} value={roomName} onChange={e=>setRoomName(e.target.value)} disabled={creating} placeholder={t('留空使用图片名称')}/><small>{t(entryMode==='public'?'无需登录，选择图片和片数后直接创建并加入。':'最多同时进行 3 个私人房间，每桌最多 8 人。')}</small></label>}{roomOptions}</div>
  {entryError&&<p className="form-error collection-error" role="alert">{t(entryError)}</p>}
  {gallery?<section className="gallery-content" aria-busy={creating}><div className="gallery-results"><span>{t('全部画面')} <strong>{photos.length}</strong></span><span>{t('点击图片，开始拼图')}</span></div>{photos.length?<div className="gallery-grid">{photos.map((p,i)=>{const pieces=count||recommendedPieces(p.id),progress=saved[saveKey(p.id,pieces)],resume=guestPlay&&progress&&placedCount(progress)<pieces;return <GalleryCard key={p.id} photo={p} pieces={pieces} progress={resume?placedCount(progress):undefined} eager={i<4} disabled={!ready||creating} onPlay={()=>launchPhoto(p)}/>;})}</div>:<div className="no-results"><Search size={30}/><p>{t('还没有找到这张拼图')}</p><button className="secondary" onClick={()=>{setQuery('');setCategory('全部');}}>{t('看看全部拼图')}</button></div>}</section>:<section className="random-start" aria-busy={creating}>
   <button className="random-play-button" disabled={!ready||creating} onClick={()=>{if(!launchLock.current)launchPhoto(randomPhoto(PHOTOS));}}>
    <span className="random-play-symbol" aria-hidden="true"><Shuffle size={40} strokeWidth={1.4}/></span>
    <span className="random-play-title">{t(creating?'正在铺开桌面…':entryMode==='create'?'随机一张，创建房间':'随机一张，开始拼图')}</span>
    <span className="random-play-caption">{t('让下一张画，给你一个小惊喜')}<ArrowRight size={17}/></span>
   </button>
   <p className="local-note">{t(saveError?'当前浏览器无法保存进度，仍可直接试玩':guestPlay?'进度保存在当前浏览器 · 不计用时榜':'服务器保存进度 · 完成后自动记录用时')}</p>
  </section>}

  <a className="progress-entry" href="/personal"><Clock3 size={17}/>{t('继续上次拼图 · 查看我的桌面')}<ArrowRight size={16}/></a>
  {guestPlay&&oldSaves.length>0&&<details className="legacy-progress"><summary>{t('继续以前的拼图')} ({oldSaves.length})</summary><div>{oldSaves.map(state=><button className="secondary" key={saveKey(state.imageId,state.cols*state.rows)} disabled={creating} onClick={()=>{persist(state);setSession(structuredClone(state));}}>{t(RESTORABLE_PHOTOS.find(p=>p.id===state.imageId)!.title)} · {state.cols*state.rows} {t('片')}<Play size={15}/></button>)}</div></details>}
  <footer className="collection-footer"><span>{t('小小一片，刚刚好的片刻。')}</span><span>{t(gallery?'点击图片，开始拼图':'随心随机，也可以去图库手选')}</span></footer>
 </main>;
}

export function Game({ state, photo, persist, leave, restart, saveError, collaboration }: {
    state: PuzzleState;
    photo: Pick<Photo,'id'|'title'|'src'>;
    persist: (s: PuzzleState) => void;
    leave: () => void;
    restart: () => void;
    saveError: boolean;
    collaboration?: RoomClient;
}) {
    useLanguage();
    const achievements=useGameAchievements(state,collaboration);
    const [celebrating, setCelebrating] = useState(false), [preview, setPreview] = useState(false), completionGate = useRef(new CompletionGate());
    const canvas = useRef<HTMLCanvasElement>(null), table = useRef<PuzzleTable | null>(null), container = useRef<HTMLElement>(null), [metrics, setMetrics] = useState({ placed: placedCount(state), elapsed: state.elapsed, zoom: 1 }), [loading, setLoading] = useState(true), [imageError, setImageError] = useState(false), [attempt, setAttempt] = useState(0), [edges, setEdges] = useState(false), [paused, setPaused] = useState(false), [help, setHelp] = useState(false), [reset, setReset] = useState(false), [complete, setComplete] = useState(false), [fullscreen, setFullscreen] = useState(false), [message, setMessage] = useState('把拼块拖到相应位置。靠近时，它们会轻轻吸附。');
    const [organizing,setOrganizing]=useState(false),organizeLock=useRef(false);
    const floatingTop = useRef<HTMLDivElement>(null), floatingFooter = useRef<HTMLElement>(null);
    useLayoutEffect(() => {
        const root = container.current, top = floatingTop.current, footer = floatingFooter.current;
        if (!root || !top || !footer) return;
        // Measure only the controls; the canvas always fills the entire game.
        const measure = () => {
            root.style.setProperty('--game-top-height', `${top.getBoundingClientRect().height}px`);
            root.style.setProperty('--game-footer-height', `${footer.getBoundingClientRect().height}px`);
        };
        const observer = new ResizeObserver(measure);
        observer.observe(top); observer.observe(footer); measure();
        return () => observer.disconnect();
    }, []);
    const [tableTheme,setTableTheme]=useState<TableTheme>('beige'),tableThemeRef=useRef<TableTheme>('beige');
    const applyTableTheme=useCallback((value:TableTheme)=>{tableThemeRef.current=value;setTableTheme(value);table.current?.setTheme(value);},[]);
    useEffect(()=>{
        try{applyTableTheme(parseTableTheme(localStorage.getItem(TABLE_THEME_KEY)));}catch{/* The switch also works without storage. */}
        const sync=(event:StorageEvent)=>{if(event.key===TABLE_THEME_KEY||event.key===null)applyTableTheme(parseTableTheme(event.newValue));};
        window.addEventListener('storage',sync);return()=>window.removeEventListener('storage',sync);
    },[applyTableTheme]);
    const switchTableTheme=()=>{const next=tableThemeRef.current==='beige'?'dark':'beige';applyTableTheme(next);try{localStorage.setItem(TABLE_THEME_KEY,next);}catch{/* Keep the selection for this visit. */}};
    const getTable=useCallback(()=>table.current,[]);
    const total = state.cols * state.rows, isMultiplayer = !!collaboration && collaboration.snapshot.visibility !== 'solo';
    useEffect(() => { let canceled = false; let detach: (() => void) | undefined; const img = new window.Image(); setLoading(true); setImageError(false); img.onload = () => { if (canceled || !canvas.current)
        return; const engine = new PuzzleTable(canvas.current, state, img, () => { if (canceled)
        return; setMetrics({ placed: placedCount(state), elapsed: state.elapsed, zoom: table.current?.camera.z ?? 1 }); persist(state); }, setMessage); table.current = engine; engine.setTheme(tableThemeRef.current); if (collaboration)
        detach = collaboration.attach(engine); setLoading(false); }; img.onerror = () => { if (!canceled) {
        setImageError(true);
        setLoading(false);
    } }; img.decoding = 'async'; img.fetchPriority = 'high'; img.src = photo.src; return () => { canceled = true; img.onload=null; img.onerror=null; table.current?.destroy(); detach?.(); table.current = null; persist(state); }; }, [state, photo.src, persist, attempt, collaboration]);
    const beginCelebration = useCallback(() => { setComplete(false); setPreview(false); setHelp(false); setReset(false); setPaused(false); setEdges(false); table.current?.setEdges(false); table.current?.fit(true); setCelebrating(true); setMessage('每一片，都刚刚好。庆祝这一刻！'); }, []);
    const finishCelebration = useCallback(() => { setCelebrating(false); setComplete(true); }, []);
    const celebrationBoard = useCallback(() => { const r = canvas.current?.getBoundingClientRect(), camera = table.current?.camera, board = table.current?.board; return r && camera && board ? { x: r.left + camera.x + board.x * camera.z, y: r.top + camera.y + board.y * camera.z, width: board.width * camera.z, height: board.height * camera.z } : null; }, []);
    useEffect(() => { if (completionGate.current.observe(metrics.placed, total, !loading && !imageError && (table.current?.width ?? 0) > 0))
        beginCelebration(); }, [metrics, total, loading, imageError, beginCelebration]);
    useEffect(() => { table.current?.setPaused(paused || help || reset || complete || celebrating || preview); }, [paused, help, reset, complete, celebrating, preview, loading]);
    useEffect(() => { const change = () => setFullscreen(!!document.fullscreenElement); document.addEventListener('fullscreenchange', change); return () => document.removeEventListener('fullscreenchange', change); }, []);
    useEffect(() => {
        if (!collaboration) return;
        const unsubscribe=collaboration.subscribe(()=>{if(!collaboration.connected)setMessage(collaboration.message);});
        // Keep the visible clock smooth without polling or redrawing the puzzle each second.
        const timer=setInterval(()=>{const elapsed=collaboration.elapsedNow();setMetrics(previous=>previous.elapsed===elapsed?previous:{...previous,elapsed});},1000);
        return()=>{unsubscribe();clearInterval(timer);};
    }, [collaboration]);
    async function organizeTable() {
        if(organizeLock.current||loading||imageError)return;
        organizeLock.current=true;setOrganizing(true);
        try {
            if(collaboration){await collaboration.organize();setMessage('整理完成，组合、已归位和正在拖动的拼块保持不动。');}
            else table.current?.shuffle();
        }catch(error){setMessage(error instanceof Error?error.message:'暂时无法整理，请重试。');}
        finally{organizeLock.current=false;setOrganizing(false);}
    }
    const switchEdges = () => { setEdges(!edges); table.current?.setEdges(!edges); };
    const fullscreenAction = async () => { try {
        if (document.fullscreenElement)
            await document.exitFullscreen();
        else if (document.documentElement.requestFullscreen)
            await document.documentElement.requestFullscreen();
        else
            setMessage('当前浏览器不支持全屏，可以用缩放按钮调整视野');
    }
    catch {
        setMessage('当前环境暂不支持全屏，可以用缩放按钮调整视野');
    } };
    return <main className="game" data-table-theme={tableTheme} ref={container}><div className="game-floating-top" ref={floatingTop}><header className="game-header"><button className="back-button" onClick={leave}><ArrowLeft size={18}/><span>{t(collaboration?.snapshot.visibility === 'public' ? '返回大厅' : '返回选图')}</span></button><div className="game-title"><h1>{t(photo.title)}</h1></div><div className="game-stats"><a className="game-achievement-link" href={achievements.href} target="_blank" rel="noreferrer" aria-label={t("我的拼图纪念册")} title={t("我的拼图纪念册")}>{achievements.book.equipped?<AchievementBadge id={achievements.book.equipped} small/>:<Trophy size={18}/>}</a><LanguageSwitch /><div className="time"><Clock3 size={16}/>{t(duration(metrics.elapsed))}</div><button className="icon-button" aria-label={t(paused ? '继续拼图' : '暂停拼图')} title={t(paused ? '继续' : '暂停')} onClick={() => setPaused(!paused)}>{t(paused ? <Play size={18}/> : <Pause size={18}/>)}</button><button className="icon-button" aria-label={t("游玩帮助")} title={t("游玩帮助")} onClick={() => setHelp(true)}><HelpCircle size={18}/></button></div></header>
 {t(isMultiplayer && collaboration && <RoomToolbar client={collaboration}/>)}</div>
 <section className="table-area" aria-label={t("拼图游玩区")}><canvas ref={canvas} className="puzzle-canvas" tabIndex={0} aria-label={t(`${photo.title}拼图桌。拖动拼块拼合；滚轮缩放；空白处拖动桌面。键盘 N 选择下一块，方向键移动，Shift 加方向键微调，Enter 吸附。`)}/>
 <div className="game-progress"><div><span><strong>{t(metrics.placed)}</strong> / {t(total)}{t(" 片已归位")}</span></div></div>
 {isMultiplayer&&collaboration&&!loading&&!imageError&&<RoomCursors client={collaboration} canvas={canvas} getTable={getTable} hidden={paused||help||reset||complete||celebrating}/> }
 {saveError && <div className="table-topline"><span className="save-state" role="status"><X size={13}/>{t("未能保存")}</span></div>}
 <AssistanceTools state={state} src={photo.src} client={collaboration} getTable={getTable} loading={loading} disabled={imageError||celebrating||metrics.placed===total} edgesButton={<button className={edges ? 'tool active' : 'tool'} aria-pressed={edges} onClick={switchEdges}><Scan size={20}/><span>{t("边缘")}</span></button>} organizeButton={<button className="tool" disabled={organizing||loading||imageError} aria-busy={organizing} title={t(isMultiplayer ? '整理散片，保留组合、已归位和正在拖动的拼块' : '整理散片')} onClick={() => void organizeTable()}><Shuffle size={20}/><span>{t(organizing?'整理中…':'整理')}</span></button>}/>


 <div className="zoom-controls"><button className="icon-button" aria-label={t("缩小")} onClick={() => table.current?.zoom(1 / 1.2)}><ZoomOut size={18}/></button><span>{t(Math.round(metrics.zoom * 100))}%</span><button className="icon-button" aria-label={t("放大")} onClick={() => table.current?.zoom(1.2)}><ZoomIn size={18}/></button><span className="vertical-divider"/><button className="icon-button background-toggle" aria-label={t("暗色背景")} aria-pressed={tableTheme==='dark'} title={t(tableTheme==='beige'?'切换为暗色背景':'切换为米色背景')} onClick={switchTableTheme}>{tableTheme==='beige'?<Moon size={18}/>:<Sun size={18}/>}</button><button className="icon-button" aria-label={t("查看整张拼图桌")} title={t("适应桌面")} onClick={() => table.current?.fit()}><Scan size={18}/></button><button className="icon-button fullscreen-button" aria-label={t(fullscreen ? '退出全屏' : '全屏')} onClick={fullscreenAction}>{t(fullscreen ? <Minimize size={18}/> : <Expand size={18}/>)}</button></div>
 {t(loading && <div className="table-overlay"><Puzzle className="loading-icon" size={32}/><p>{t("正在铺开拼图\u2026")}</p></div>)}
 {t(imageError && <div className="table-overlay"><p>{t("这张图片暂时没有加载成功")}</p><button className="primary" onClick={() => setAttempt(n => n + 1)}>{t("重新加载")}</button><button className="secondary" onClick={leave}>{t("返回选图")}</button></div>)}
 {t(paused && !help && !reset && <div className="table-overlay pause-overlay"><span className="eyebrow">A MOMENT TO BREATHE</span><h2>{t("休息一下也很好。")}</h2><p>{t(collaboration ? '你可以休息一下，榜单计时会继续。' : '拼图会在这里等你。')}</p><button className="primary" onClick={() => setPaused(false)}><Play size={18}/>{t("继续拼图")}</button></div>)}
 </section><footer className="game-footer" ref={floatingFooter}><p className="feedback" role="status" aria-live="polite">{t(message)}</p><div><ReportProblem context={{pictureId:photo.id,pieceCount:total,connection:collaboration?(collaboration.connected?"online":"offline"):"local"}}/>{t(metrics.placed === total && <button className="text-button preview-game-button" disabled={celebrating} aria-label={t("预览庆祝")} title={t("预览庆祝")} onClick={() => setPreview(true)}><PartyPopper size={17}/><span>{t("预览庆祝")}</span></button>)}<SoundControl getTable={getTable} loading={loading}/><>{t(!collaboration && <><button className="text-button" onClick={() => setReset(true)}><RotateCcw size={15}/><span>{t("重新开始")}</span></button></>)}</></div></footer>
 <Dialog open={help} onOpenChange={setHelp}><DialogContent className="help-dialog"><DialogTitle>{t("从一片开始，慢慢来。")}</DialogTitle><DialogDescription>{t("拼块不会旋转。找到相邻的两块，把它们放近一些就能连起来。")}</DialogDescription><div className="help-list"><p><strong>{t("拖动拼块")}</strong><span>{t("在桌面任意位置拼合，连接后可以整组移动。拖到框内正确位置会锁定。")}</span></p><p><strong>{t("调整视野")}</strong><span>{t("鼠标滚轮缩放，拖动空白处平移；按住空格拖动也可以。手机用双指缩放。")}</span></p><p><strong>{t("卡住的时候")}</strong><span>{t("「边缘」只显示含边缘的拼块组。每局每人可查看原图和底图各一次，每次 30 秒；提示可用 3 次，每次标出最多 3 片及对应位置。刷新不会重置次数。")}</span></p><p><strong>{t("键盘也能玩")}</strong><span>{t(collaboration ? '计时局用鼠标或触屏拖动，滚轮或双指缩放；按 0 显示整个桌面。' : '先聚焦桌面，按 N 选择拼块，方向键移动，Shift 微调，Enter 吸附；0 显示整个桌面。')}</span></p><p><strong>{t("随时回来")}</strong><span>{t(collaboration ? '房间进度由大家共享；刷新可以重新连接。未完成房间从最近一次游玩起保留 30 天，完成后保留 30 天。' : '进度保存在此浏览器，刷新可以继续。换设备不会同步。')}</span></p></div></DialogContent></Dialog>
 <AlertDialog open={reset} onOpenChange={setReset}><AlertDialogContent><AlertDialogTitle>{t("重新开始这幅拼图？")}</AlertDialogTitle><AlertDialogDescription>{t("当前这幅 ")}{t(total)}{t(" 片拼图的进度会被替换，其他拼图的进度会保留。")}</AlertDialogDescription><AlertDialogFooter><AlertDialogCancel>{t("继续当前拼图")}</AlertDialogCancel><AlertDialogAction onClick={() => { setReset(false); restart(); }}>{t("重新开始")}</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
 <Dialog open={complete} onOpenChange={setComplete}><DialogContent className="complete-dialog"><div className="complete-mark"><Check size={28}/></div><DialogTitle>{t("每一片，都刚刚好。")}</DialogTitle><DialogDescription>{t(isMultiplayer ? '你们一起完成了' : '你完成了')}「{t(photo.title)}」。{t(isMultiplayer ? '谢谢每一位朋友的加入。' : '把这一刻，留给自己。')}</DialogDescription><img src={photo.src} style={{ aspectRatio: state.cols / state.rows }} alt={t("你完成的拼图")}/><div className="complete-stats"><span><strong>{t(total)}</strong>{t("片拼图")}</span><span><strong>{t(duration(metrics.elapsed))}</strong>{t("专注时光")}</span></div>{t(collaboration?.snapshot.visibility && !collaboration.snapshot.customImage && <a className="text-button" href={'/leaderboard?' + new URLSearchParams({ mode: isMultiplayer ? 'team' : 'solo', imageId: state.imageId, pieces: String(total), players: String(collaboration.snapshot.participantCount || 1) }).toString()}>{t("本局已完成 \u00B7 查看用时榜")}</a>)}{complete&&collaboration?.snapshot.visibility&&!collaboration.snapshot.customImage&&<CompletionRecord client={collaboration}/>}<CompletionAchievements ids={achievements.earned} href={achievements.href}/><button className="primary" onClick={leave}>{t("再挑一幅 ")}<ArrowRight size={17}/></button><button className="secondary" onClick={beginCelebration}><PartyPopper size={17}/>{t("再庆祝一次")}</button><button className="text-button" onClick={() => setComplete(false)}>{t("留在桌面欣赏")}</button></DialogContent></Dialog>
 {!celebrating&&!complete&&<AchievementToast ids={achievements.toast} onClose={achievements.dismiss} href={achievements.href}/>}
 <CelebrationPreview photo={photo} open={preview} onOpenChange={setPreview} aspectRatio={state.cols / state.rows}/>{t(celebrating && <CelebrationOverlay getBoard={celebrationBoard} onFinish={finishCelebration}/>)}
 </main>;
}
