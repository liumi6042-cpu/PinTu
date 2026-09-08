'use client';
import { t } from '@/lib/i18n';
import { useLanguage } from '@/app/language-switch';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Puzzle, ArrowRight, ArrowLeft, Search, ChevronLeft, ChevronRight, Play, Pause, Image as ImageIcon, Images, Lightbulb, Shuffle, ZoomIn, ZoomOut, Scan, HelpCircle, Volume2, VolumeX, RotateCcw, Check, X, Clock3, Expand, Minimize, LockKeyhole, PartyPopper } from 'lucide-react';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogContent, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction } from '@/components/ui/alert-dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Progress } from '@/components/ui/progress';
import LanguageSwitch from './language-switch';
import { createPuzzle, restartPuzzle, LEVELS, SAVED_LEVELS, placedCount, restorePuzzle, type PuzzleState } from '@/lib/puzzle-engine';
import { CompletionGate } from '@/lib/celebration-engine';
import { CelebrationOverlay, CelebrationPreview } from './celebration';
import { PuzzleTable } from '@/lib/puzzle-table';
import { registerPuzzleTools } from '@/lib/webmcp';
import AssistanceDialog from './assistance-dialog';
import type { AssistanceKind } from '@/lib/assistance-policy';
import { apiJson } from '@/lib/community-client';
import { saveTicket, type RoomTicket } from '@/lib/room-client';
import RoomToolbar from './room-toolbar';
import HomeNavigation from './home-navigation';
import PaperReel from './paper-reel';
import type { RoomClient } from '@/lib/room-client';
import { PHOTOS, FEATURED_PHOTOS, CATEGORIES } from '@/lib/puzzle-catalog';
export { PHOTOS } from '@/lib/puzzle-catalog';

type Photo = typeof PHOTOS[number];
const ids = PHOTOS.map(p => p.id), activeKey = 'together-puzzle:active:v1';
const saveKey = (p: string, n: number) => `together-puzzle:v1:${p}:${n}`;
const duration = (seconds: number) => { const s = Math.floor(seconds); return `${s >= 3600 ? `${Math.floor(s / 3600)}:` : ''}${String(Math.floor(s / 60) % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; };
function Brand() { useLanguage(); return <span className="brand"><Puzzle size={26}/><span>{t('一起拼图')}<small>THE PUZZLE COLLECTION</small></span></span>; }
function Difficulty({count,setCount,disabled=false}:{count:number;setCount:(n:number)=>void;disabled?:boolean}) {
 useLanguage(); const items=LEVELS.map(l=>({value:l.count,label:t(`${l.count.toLocaleString()} 片 · ${l.label}`)}));
 return <div className="difficulty-picker"><label htmlFor="piece-count">{t('拼图片数')}</label><Select disabled={disabled} items={items} value={count} onValueChange={value=>{if(value!==null)setCount(value);}}><SelectTrigger id="piece-count" className="difficulty-trigger" aria-describedby="piece-count-note"><SelectValue/></SelectTrigger><SelectContent className="difficulty-menu" align="start" alignItemWithTrigger={false} sideOffset={9}>{items.map(item=><SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectContent></Select><p id="piece-count-note">{t('108–2,000 片，选好片数，点击图片就能玩。')}</p></div>;
}
export default function PuzzleApp({entryMode='solo',guestPlay=false,gallery=false}:{entryMode?:'solo'|'create';guestPlay?:boolean;gallery?:boolean}) {
 const language=useLanguage();
 const [creating,setCreating]=useState(false),[entryError,setEntryError]=useState(''),[visibility,setVisibility]=useState<'private'|'public'>('private');
 const launchLock=useRef(false),mounted=useRef(true);
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
 const [session,setSession]=useState<PuzzleState|null>(null),[query,setQuery]=useState(''),[category,setCategory]=useState('全部'),[index,setIndex]=useState(0),[count,setCount]=useState(108),[saved,setSaved]=useState<Record<string,PuzzleState>>({}),[ready,setReady]=useState(false),[saveError,setSaveError]=useState(false);
 useEffect(()=>{const map:Record<string,PuzzleState>={};try{for(const p of PHOTOS)for(const l of SAVED_LEVELS){const key=saveKey(p.id,l.count),raw=localStorage.getItem(key);if(raw){const value=restorePuzzle(raw,ids);if(value)map[key]=value;}}}catch{setSaveError(true);}setSaved(map);setReady(true);},[]);
 const photos=useMemo(()=>gallery?PHOTOS.filter(p=>(category==='全部'||p.category===category)&&[p.title,p.category,p.subtitle,t(p.title),t(p.category),t(p.subtitle)].join(' ').toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())):FEATURED_PHOTOS,[gallery,category,query,language]);
 const photo=photos.length?photos[((index%photos.length)+photos.length)%photos.length]:null;
 const persist=useCallback((state:PuzzleState)=>{try{localStorage.setItem(saveKey(state.imageId,state.cols*state.rows),JSON.stringify(state));localStorage.setItem(activeKey,saveKey(state.imageId,state.cols*state.rows));setSaveError(false);}catch{setSaveError(true);}},[]);
 const start=useCallback((chosen:Photo,pieces:number)=>{const level=LEVELS.find(l=>l.count===pieces);if(!level)throw new Error('请选择列表内的图片和片数');const previous=saved[saveKey(chosen.id,pieces)],state=previous&&placedCount(previous)<pieces?structuredClone(previous):createPuzzle(chosen.id,level.cols,level.rows);persist(state);setSession(state);},[saved,persist]);
 const beginPuzzle=useCallback(async(chosen:Photo,pieces:number)=>{
  if(launchLock.current)throw new Error('拼图正在打开，请稍候');
  if(!LEVELS.some(level=>level.count===pieces))throw new Error('请选择列表内的图片和片数');
  launchLock.current=true;const roomVisibility=entryMode==='solo'?'solo':visibility;setCreating(true);setEntryError('');
  try{if(guestPlay){start(chosen,pieces);setCreating(false);return;}const ticket=await apiJson<RoomTicket>('/api/rooms',{imageId:chosen.id,pieces,visibility:roomVisibility});if(!mounted.current)return;saveTicket(ticket);window.location.assign('/room/'+ticket.room.id);}
  catch(error){launchLock.current=false;if(!mounted.current)return;setEntryError(error instanceof Error?error.message:'暂时无法开始');setCreating(false);throw error;}
 },[entryMode,visibility,guestPlay,start]);
 const leave=()=>{launchLock.current=false;setCreating(false);if(session){persist(session);setSaved(s=>({...s,[saveKey(session.imageId,session.cols*session.rows)]:structuredClone(session)}));}try{localStorage.removeItem(activeKey);}catch{}setSession(null);};
 const stateRef=useRef({session,photo,count});stateRef.current={session,photo,count};
 useEffect(()=>registerPuzzleTools({read:()=>({screen:stateRef.current.session?'playing':gallery?'gallery':'collection',puzzles:PHOTOS.map(({id,title})=>({id,title})),pieceCounts:LEVELS.map(l=>l.count),current:stateRef.current.session?{imageId:stateRef.current.session.imageId,pieces:stateRef.current.session.cols*stateRef.current.session.rows,placed:placedCount(stateRef.current.session),elapsed:stateRef.current.session.elapsed}:null}),start:async(imageId,pieces)=>{const p=PHOTOS.find(p=>p.id===imageId);if(!p||!LEVELS.some(l=>l.count===pieces))throw new Error('请选择列表内的图片和片数');if(stateRef.current.session)throw new Error('请先从当前拼图返回选图页');await beginPuzzle(p,pieces);return{screen:guestPlay?'playing':'room',imageId,pieces};}}),[beginPuzzle,guestPlay,gallery]);
 if(session)return <Game key={`${session.imageId}-${session.cols}-${session.seed}`} state={session} photo={PHOTOS.find(p=>p.id===session.imageId)!} persist={persist} leave={leave} saveError={saveError} restart={()=>{const state=restartPuzzle(session);persist(state);setSession(state);}}/>;
 const previous=photo?saved[saveKey(photo.id,count)]:null,canResume=!!previous&&placedCount(previous)<count;
 const oldSaves=Object.values(saved).filter(s=>!LEVELS.some(l=>l.count===s.cols*s.rows)&&placedCount(s)<s.cols*s.rows);
 const launchPhoto=(chosen:Photo)=>{void beginPuzzle(chosen,count).catch(()=>{});};
 const roomOptions=entryMode==='create'&&<div className="visibility-choice" role="group" aria-label={t('房间可见范围')}><button disabled={creating} aria-pressed={visibility==='private'} onClick={()=>setVisibility('private')}><LockKeyhole size={17}/>{t('仅邀请朋友')}<span>{t('通过链接加入')}</span></button><button disabled={creating} aria-pressed={visibility==='public'} onClick={()=>setVisibility('public')}><Puzzle size={17}/>{t('公开到大厅')}<span>{t('大家都能入座')}</span></button></div>;
 return <main className={'collection collection-simple'+(gallery?' gallery-collection':'')}>
  <header className="site-header"><a href="/" className="collection-brand-link"><Brand/></a><HomeNavigation galleryHref={guestPlay?'/gallery':'/gallery?mode='+entryMode}/></header>
  <section className="collection-intro"><p className="eyebrow">{gallery?'THE PICTURE LIBRARY':'EIGHT LITTLE ESCAPES'}</p><h1>{t(gallery?'把喜欢的画面，慢慢拼起来。':entryMode==='solo'?'挑一张喜欢的，慢慢拼。':'选一幅画，准备一起拼。')}</h1><p className="muted">{t(gallery?'所有画面都在这里，选好片数，点图开拼。':'8 张精选，点击图片即可开始。')}</p>
   {gallery?<div className="gallery-filters"><div className="search-box"><Search size={18}/><input disabled={creating} value={query} onChange={e=>{setQuery(e.target.value);setIndex(0);}} placeholder={t('搜索拼图、风景、艺术…')} aria-label={t('搜索拼图')}/>{query&&<button disabled={creating} className="clear-search" aria-label={t('清空搜索')} onClick={()=>{setQuery('');setIndex(0);}}><X size={16}/></button>}</div><div className="categories" aria-label={t('拼图分类')}>{CATEGORIES.map(c=><button key={c} disabled={creating} aria-pressed={category===c} className={category===c?'active':''} onClick={()=>{setCategory(c);setIndex(0);}}>{t(c)}</button>)}</div></div>:<a className="gallery-entry" href={guestPlay?'/gallery':'/gallery?mode='+entryMode}><Images size={18}/>{t('去图库挑选更多')}<ArrowRight size={17}/></a>}
  </section>
  <div className="collection-settings"><Difficulty count={count} setCount={setCount} disabled={creating}/>{roomOptions}</div>
  {entryError&&<p className="form-error collection-error" role="alert">{t(entryError)}</p>}
  {gallery?<section className="gallery-content" aria-busy={creating}><div className="gallery-results"><span>{t('全部画面')} <strong>{photos.length}</strong></span><span>{t(creating?'正在铺开桌面…':'点击图片，开始拼图')}</span></div>{photos.length?<div className="gallery-grid">{photos.map((p,i)=>{const progress=saved[saveKey(p.id,count)],resume=guestPlay&&progress&&placedCount(progress)<count;return <button className="gallery-card" key={p.id} disabled={!ready||creating} onClick={()=>launchPhoto(p)} aria-label={t(p.title)+' · '+t(resume?'继续拼图':'开始拼图')}><div className="gallery-picture"><img src={p.src} alt={t(p.title)} loading={i<4?'eager':'lazy'} decoding="async"/><span className="gallery-card-action"><Play size={17}/>{t(resume?'继续拼图':'开始拼图')}</span></div><div className="gallery-card-copy"><div><h2>{t(p.title)}</h2><span>{t(p.category)}</span></div><p>{t(p.subtitle)}</p>{resume&&<small>{placedCount(progress)} / {count} {t('片')}</small>}</div></button>;})}</div>:<div className="no-results"><Search size={30}/><p>{t('还没有找到这张拼图')}</p><button className="secondary" onClick={()=>{setQuery('');setCategory('全部');}}>{t('看看全部拼图')}</button></div>}</section>:photo&&<>
   <PaperReel photos={photos} index={index} onIndex={setIndex} disabled={!ready||creating} onStart={launchPhoto}/>
   <div className="reel-navigation"><button className="circle-button" aria-label={t('上一张拼图')} disabled={creating} onClick={()=>setIndex(index-1)}><ChevronLeft size={20}/></button><span>{String(((index%photos.length)+photos.length)%photos.length+1).padStart(2,'0')} <i>/</i> {String(photos.length).padStart(2,'0')}</span><button className="circle-button" aria-label={t('下一张拼图')} disabled={creating} onClick={()=>setIndex(index+1)}><ChevronRight size={20}/></button></div>
   <section className="collection-controls"><h2>{t(photo.title)}</h2><p className="muted photo-subtitle">{t(photo.subtitle)}</p><button className="primary start-button" disabled={!ready||creating} onClick={()=>launchPhoto(photo)}>{t(creating?'正在铺开桌面…':guestPlay&&canResume?'继续拼图':entryMode==='solo'?'开始拼图':'创建这桌拼图')}<ArrowRight size={18}/></button><p className="local-note">{t(saveError?'当前浏览器无法保存进度，仍可直接试玩':guestPlay&&canResume?`已拼 ${placedCount(previous!)} / ${count} 片 · ${duration(previous!.elapsed)}`:guestPlay?'进度保存在当前浏览器 · 不计用时榜':'本地服务器保存进度 · 完成后自动记录用时')}</p></section>
  </>}
  {guestPlay&&oldSaves.length>0&&<details className="legacy-progress"><summary>{t('继续以前的拼图')} ({oldSaves.length})</summary><div>{oldSaves.map(state=><button className="secondary" key={saveKey(state.imageId,state.cols*state.rows)} disabled={creating} onClick={()=>{persist(state);setSession(structuredClone(state));}}>{t(PHOTOS.find(p=>p.id===state.imageId)!.title)} · {state.cols*state.rows} {t('片')}<Play size={15}/></button>)}</div></details>}
  <footer className="collection-footer"><span>{t('小小一片，刚刚好的片刻。')}</span><span>{t(gallery?'点击图片，开始拼图':'鼠标滚轮 / 拖动胶片切换')}</span></footer>
 </main>;
}

export function Game({ state, photo, persist, leave, restart, saveError, collaboration }: {
    state: PuzzleState;
    photo: Photo;
    persist: (s: PuzzleState) => void;
    leave: () => void;
    restart: () => void;
    saveError: boolean;
    collaboration?: RoomClient;
}) {
    useLanguage();
    const [celebrating, setCelebrating] = useState(false), [preview, setPreview] = useState(false), completionGate = useRef(new CompletionGate());
    const canvas = useRef<HTMLCanvasElement>(null), table = useRef<PuzzleTable | null>(null), container = useRef<HTMLElement>(null), [metrics, setMetrics] = useState({ placed: placedCount(state), elapsed: state.elapsed, zoom: 1 }), [loading, setLoading] = useState(true), [imageError, setImageError] = useState(false), [attempt, setAttempt] = useState(0), [edges, setEdges] = useState(false), [assistance, setAssistance] = useState<AssistanceKind | null>(null), [paused, setPaused] = useState(false), [sound, setSound] = useState(false), [help, setHelp] = useState(false), [reset, setReset] = useState(false), [complete, setComplete] = useState(false), [fullscreen, setFullscreen] = useState(false), [message, setMessage] = useState('把拼块拖到相应位置。靠近时，它们会轻轻吸附。');
    const total = state.cols * state.rows, isMultiplayer = !!collaboration && collaboration.snapshot.visibility !== 'solo';
    useEffect(() => { let canceled = false; let detach: (() => void) | undefined; const img = new window.Image(); setLoading(true); setImageError(false); img.onload = () => { if (canceled || !canvas.current)
        return; const engine = new PuzzleTable(canvas.current, state, img, () => { if (canceled)
        return; setMetrics({ placed: placedCount(state), elapsed: state.elapsed, zoom: table.current?.camera.z ?? 1 }); persist(state); }, setMessage); table.current = engine; if (collaboration)
        detach = collaboration.attach(engine); setLoading(false); }; img.onerror = () => { if (!canceled) {
        setImageError(true);
        setLoading(false);
    } }; img.src = photo.src; return () => { canceled = true; table.current?.destroy(); detach?.(); table.current = null; persist(state); }; }, [state, photo.src, persist, attempt, collaboration]);
    const beginCelebration = useCallback(() => { setComplete(false); setPreview(false); setHelp(false); setReset(false); setAssistance(null); setPaused(false); setEdges(false); table.current?.setEdges(false); table.current?.fit(true); setCelebrating(true); setMessage('每一片，都刚刚好。庆祝这一刻！'); }, []);
    const finishCelebration = useCallback(() => { setCelebrating(false); setComplete(true); }, []);
    const celebrationBoard = useCallback(() => { const r = canvas.current?.getBoundingClientRect(), camera = table.current?.camera, board = table.current?.board; return r && camera && board ? { x: r.left + camera.x + board.x * camera.z, y: r.top + camera.y + board.y * camera.z, width: board.width * camera.z, height: board.height * camera.z } : null; }, []);
    useEffect(() => { if (completionGate.current.observe(metrics.placed, total, !loading && !imageError && (table.current?.width ?? 0) > 0))
        beginCelebration(); }, [metrics, total, loading, imageError, beginCelebration]);
    useEffect(() => { table.current?.setPaused(paused || help || reset || complete || assistance !== null || celebrating || preview); }, [paused, help, reset, complete, assistance, celebrating, preview, loading]);
    useEffect(() => { const change = () => setFullscreen(!!document.fullscreenElement); document.addEventListener('fullscreenchange', change); return () => document.removeEventListener('fullscreenchange', change); }, []);
    useEffect(() => collaboration?.subscribe(() => { if (!collaboration.connected)
        setMessage(collaboration.message); }), [collaboration]);
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
    return <main className="game" ref={container}><header className="game-header"><button className="back-button" onClick={leave}><ArrowLeft size={18}/><span>{t(collaboration?.snapshot.visibility === 'public' ? '返回大厅' : '返回选图')}</span></button><div className="game-title"><h1>{t(photo.title)}</h1><span>{t(total)}{t(" 片 ")}<i>·</i> {t(isMultiplayer ? '合作拼图' : '单人拼图')}</span></div><div className="game-stats"><LanguageSwitch /><div className="time"><Clock3 size={16}/>{t(duration(metrics.elapsed))}</div><button className="icon-button" aria-label={t(paused ? '继续拼图' : '暂停拼图')} title={t(paused ? '继续' : '暂停')} onClick={() => setPaused(!paused)}>{t(paused ? <Play size={18}/> : <Pause size={18}/>)}</button><button className="icon-button" aria-label={t("游玩帮助")} title={t("游玩帮助")} onClick={() => setHelp(true)}><HelpCircle size={18}/></button></div></header>
 {t(isMultiplayer && collaboration && <RoomToolbar client={collaboration}/>)}<div className="game-progress"><div><span><strong>{t(metrics.placed)}</strong> / {t(total)}{t(" 片已归位")}</span><span>{t(Math.round(metrics.placed / total * 100))}%</span></div><Progress value={metrics.placed / total * 100} aria-label={t("拼图完成进度")}/></div>
 <section className="table-area" aria-label={t("拼图游玩区")}><canvas ref={canvas} className="puzzle-canvas" tabIndex={0} aria-label={t(`${photo.title}拼图桌。拖动拼块拼合；滚轮缩放；空白处拖动桌面。键盘 N 选择下一块，方向键移动，Shift 加方向键微调，Enter 吸附。`)}/>
 <div className="table-topline"><span className="table-badge"><span /> {t(isMultiplayer ? '一起拼合' : '自由拼合')}</span><span className="save-state">{t(saveError ? <><X size={13}/>{t("未能保存")}</> : <><Check size={13}/>{t(collaboration ? '房间进度自动保存' : '进度自动保存')}</>)}</span></div>
 <aside className="table-tools" aria-label={t("拼图工具")}><button className="tool locked-tool" aria-haspopup="dialog" aria-label={t("原图已锁定，每次广告解锁 30 秒，不限次数")} onClick={() => setAssistance('reference')}><ImageIcon size={20}/><span>{t("原图")}</span><LockKeyhole className="assist-lock" size={10}/></button><button className={edges ? 'tool active' : 'tool'} aria-pressed={edges} onClick={switchEdges}><Scan size={20}/><span>{t("边缘")}</span></button><button className="tool locked-tool" aria-label={t("底图已锁定，后续可观看广告解锁 30 秒")} aria-haspopup="dialog" title={t("底图已锁定 \u00B7 广告解锁即将开放")} onClick={() => setAssistance('underlay')}><LockKeyhole size={20}/><span>{t("底图")}</span><LockKeyhole className="assist-lock" size={10}/></button><span className="tool-divider"/><button className="tool locked-tool" aria-haspopup="dialog" aria-label={t("提示已锁定，每局最多 3 次，后续观看广告解锁")} onClick={() => setAssistance('hint')}><Lightbulb size={20}/><span>{t("提示")}</span><LockKeyhole className="assist-lock" size={10}/></button><button className="tool" disabled={isMultiplayer} title={t(isMultiplayer ? '多人模式请直接拖动散片' : '整理散片')} onClick={() => { if (collaboration)
        void collaboration.organize().then(() => setMessage('散片已整理，已连接的拼块保持完整。')).catch(e => setMessage(e.message));
    else
        table.current?.shuffle(); }}><Shuffle size={20}/><span>{t("整理")}</span></button></aside>

 <div className="zoom-controls"><button className="icon-button" aria-label={t("缩小")} onClick={() => table.current?.zoom(1 / 1.2)}><ZoomOut size={18}/></button><span>{t(Math.round(metrics.zoom * 100))}%</span><button className="icon-button" aria-label={t("放大")} onClick={() => table.current?.zoom(1.2)}><ZoomIn size={18}/></button><span className="vertical-divider"/><button className="icon-button" aria-label={t("查看整张拼图桌")} title={t("适应桌面")} onClick={() => table.current?.fit()}><Scan size={18}/></button><button className="icon-button fullscreen-button" aria-label={t(fullscreen ? '退出全屏' : '全屏')} onClick={fullscreenAction}>{t(fullscreen ? <Minimize size={18}/> : <Expand size={18}/>)}</button></div>
 {t(loading && <div className="table-overlay"><Puzzle className="loading-icon" size={32}/><p>{t("正在铺开拼图\u2026")}</p></div>)}
 {t(imageError && <div className="table-overlay"><p>{t("这张图片暂时没有加载成功")}</p><button className="primary" onClick={() => setAttempt(n => n + 1)}>{t("重新加载")}</button><button className="secondary" onClick={leave}>{t("返回选图")}</button></div>)}
 {t(paused && !help && !reset && <div className="table-overlay pause-overlay"><span className="eyebrow">A MOMENT TO BREATHE</span><h2>{t("休息一下也很好。")}</h2><p>{t(collaboration ? '你可以休息一下，榜单计时会继续。' : '拼图会在这里等你。')}</p><button className="primary" onClick={() => setPaused(false)}><Play size={18}/>{t("继续拼图")}</button></div>)}
 </section><footer className="game-footer"><p className="feedback" role="status" aria-live="polite">{t(message)}</p><div>{t(metrics.placed === total && <button className="text-button preview-game-button" disabled={celebrating} aria-label={t("预览庆祝")} title={t("预览庆祝")} onClick={() => setPreview(true)}><PartyPopper size={17}/><span>{t("预览庆祝")}</span></button>)}<button className="icon-button" aria-pressed={sound} aria-label={t(sound ? '关闭吸附音效' : '开启吸附音效')} title={t("吸附音效")} onClick={() => { setSound(!sound); if (table.current)
        table.current.sound = !sound; }}>{t(sound ? <Volume2 size={17}/> : <VolumeX size={17}/>)}</button><>{t(!collaboration && <><button className="text-button" onClick={() => setReset(true)}><RotateCcw size={15}/><span>{t("重新开始")}</span></button></>)}</></div></footer>
 <Dialog open={help} onOpenChange={setHelp}><DialogContent className="help-dialog"><DialogTitle>{t("从一片开始，慢慢来。")}</DialogTitle><DialogDescription>{t("拼块不会旋转。找到相邻的两块，把它们放近一些就能连起来。")}</DialogDescription><div className="help-list"><p><strong>{t("拖动拼块")}</strong><span>{t("在桌面任意位置拼合，连接后可以整组移动。拖到框内正确位置会锁定。")}</span></p><p><strong>{t("调整视野")}</strong><span>{t("鼠标滚轮缩放，拖动空白处平移；按住空格拖动也可以。手机用双指缩放。")}</span></p><p><strong>{t("卡住的时候")}</strong><span>{t("「边缘」只显示含边缘的拼块组。提示、原图和底图均已锁定；后续提示每局最多 3 次，原图每次广告解锁 30 秒且不限次数。")}</span></p><p><strong>{t("键盘也能玩")}</strong><span>{t(collaboration ? '计时局用鼠标或触屏拖动，滚轮或双指缩放；按 0 显示整个桌面。' : '先聚焦桌面，按 N 选择拼块，方向键移动，Shift 微调，Enter 吸附；0 显示整个桌面。')}</span></p><p><strong>{t("随时回来")}</strong><span>{t(collaboration ? '房间进度由大家共享；刷新可以重新连接。房间保留 24 小时。' : '进度保存在此浏览器，刷新可以继续。换设备不会同步。')}</span></p></div></DialogContent></Dialog>
 <AssistanceDialog kind={assistance} onClose={() => setAssistance(null)}/><AlertDialog open={reset} onOpenChange={setReset}><AlertDialogContent><AlertDialogTitle>{t("重新开始这幅拼图？")}</AlertDialogTitle><AlertDialogDescription>{t("当前这幅 ")}{t(total)}{t(" 片拼图的进度会被替换，其他拼图的进度会保留。")}</AlertDialogDescription><AlertDialogFooter><AlertDialogCancel>{t("继续当前拼图")}</AlertDialogCancel><AlertDialogAction onClick={() => { setReset(false); restart(); }}>{t("重新开始")}</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
 <Dialog open={complete} onOpenChange={setComplete}><DialogContent className="complete-dialog"><div className="complete-mark"><Check size={28}/></div><DialogTitle>{t("每一片，都刚刚好。")}</DialogTitle><DialogDescription>{t(isMultiplayer ? '你们一起完成了' : '你完成了')}「{t(photo.title)}」。{t(isMultiplayer ? '谢谢每一位朋友的加入。' : '把这一刻，留给自己。')}</DialogDescription><img src={photo.src} style={{ aspectRatio: state.cols / state.rows }} alt={t("你完成的拼图")}/><div className="complete-stats"><span><strong>{t(total)}</strong>{t("片拼图")}</span><span><strong>{t(duration(metrics.elapsed))}</strong>{t("专注时光")}</span></div>{t(collaboration?.snapshot.visibility && <a className="text-button" href={'/leaderboard?' + new URLSearchParams({ mode: isMultiplayer ? 'team' : 'solo', imageId: state.imageId, pieces: String(total), players: String(collaboration.snapshot.participantCount || 1) }).toString()}>{t("本局已完成 \u00B7 查看用时榜")}</a>)}<button className="primary" onClick={leave}>{t("再挑一幅 ")}<ArrowRight size={17}/></button><button className="secondary" onClick={beginCelebration}><PartyPopper size={17}/>{t("再庆祝一次")}</button><button className="text-button" onClick={() => setComplete(false)}>{t("留在桌面欣赏")}</button></DialogContent></Dialog>
 <CelebrationPreview photo={photo} open={preview} onOpenChange={setPreview} aspectRatio={state.cols / state.rows}/>{t(celebrating && <CelebrationOverlay getBoard={celebrationBoard} onFinish={finishCelebration}/>)}
 </main>;
}
