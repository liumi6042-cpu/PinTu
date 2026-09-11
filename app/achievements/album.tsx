'use client';
import { useEffect,useState } from 'react';
import { BookOpen,ArrowRight,Check,Lock,Monitor,Users } from 'lucide-react';
import { ACHIEVEMENTS,achievementById,achievementProgress,emptyBook,type AchievementBook,type AchievementId } from '@/lib/achievements';
import { equipLocalAchievement,readLocalAchievements,recordLocalPuzzle } from '@/lib/local-achievements';
import { readLocalProgress } from '@/lib/local-progress';
import { apiJson } from '@/lib/community-client';
import { ensureGuestSession } from '@/lib/guest-client';
import { RESTORABLE_PHOTOS } from '@/lib/puzzle-catalog';
import { t } from '@/lib/i18n';
import { useLanguage } from '../language-switch';
import CommunityShell from '../community-shell';
import AchievementBadge from '../achievement-badge';
import { useAccount } from '../account-gate';
export default function AchievementAlbum(){
  const {account}=useAccount();
  const language=useLanguage(),[source,setSource]=useState<'local'|'server'>('local'),[local,setLocal]=useState<AchievementBook>(emptyBook),[server,setServer]=useState<AchievementBook>(emptyBook);
  const [loading,setLoading]=useState(true),[error,setError]=useState(''),[localError,setLocalError]=useState(''),[busy,setBusy]=useState(false),[filter,setFilter]=useState('全部'),[attempt,setAttempt]=useState(0);
  useEffect(()=>{const initial=new URLSearchParams(location.search).get('source');if(initial==='server')setSource('server');},[]);
  useEffect(()=>{
    let alive=true;setLoading(true);setError('');setServer(emptyBook());
    const loadLocal=()=>{try{for(const entry of readLocalProgress(localStorage))if(entry.completed)recordLocalPuzzle(localStorage,entry.state,entry.savedAt||Date.now(),true);setLocal(readLocalAchievements(localStorage));setLocalError('');}catch{setLocalError('本机纪念册暂时无法保存，请检查浏览器存储权限。');}};
    loadLocal();ensureGuestSession().then(()=>apiJson<{book:AchievementBook}>('/api/achievements')).then(data=>{if(alive)setServer(data.book);}).catch(()=>{if(alive)setError('服务器纪念册暂时无法读取，请重试。');}).finally(()=>{if(alive)setLoading(false);});
    window.addEventListener('storage',loadLocal);return()=>{alive=false;window.removeEventListener('storage',loadLocal);};
  },[attempt,account?.id]);
  const book=source==='local'?local:server,progress=achievementProgress(book),earned=Object.keys(book.earned).length;
  const visible=ACHIEVEMENTS.filter(b=>filter==='全部'||(filter==='已获得'?book.earned[b.id]:!book.earned[b.id]));
  const date=(n:number)=>new Date(n).toLocaleDateString(language==='en'?'en-US':'zh-CN');
  async function equip(id:AchievementId|null){if(busy)return;setBusy(true);try{
    if(source==='local'){equipLocalAchievement(localStorage,id);setLocal(readLocalAchievements(localStorage));setLocalError('');}
    else{const data=await apiJson<{book:AchievementBook}>('/api/achievements',{action:'equip',badge:id});setServer(data.book);setError('');}
  }catch{if(source==='local')setLocalError('本机纪念册暂时无法保存，请检查浏览器存储权限。');else setError('徽章未能保存，请重试。');}finally{setBusy(false);}}
  return <CommunityShell active="personal"><main className="community-main achievement-album">
    <div className="album-heading"><div><p className="section-kicker">PIECE BY PIECE</p><h1>{t('拼图纪念册')}</h1><p>{t('把慢慢拼好的时光，收进这一页。')}</p></div><a className="secondary" href="/personal">{t('回到个人空间')}<ArrowRight size={16}/></a></div>
    <div className="album-sources" aria-label={t('纪念册保存位置')}>{(['local','server'] as const).map(value=><button key={value} aria-pressed={source===value} onClick={()=>{setSource(value);history.replaceState(null,'','/achievements?source='+value);}}>{value==='local'?<Monitor size={17}/>:<Users size={17}/>} {t(value==='local'?'本机纪念册':'服务器纪念册')}</button>)}</div>
    <p className="album-storage-note">{t(source==='local'?'本机单人作品保存在当前浏览器，清除网站数据会丢失。本机徽章只在本机展示。':'服务器成就跟随当前游客或账号保存，不随房间到期消失。佩戴的徽章会显示在多人鼠标昵称旁。')}</p>
    {(source==='local'?localError:error)&&<div className="form-error" role="alert">{t(source==='local'?localError:error)}{source==='server'&&<button className="text-button" onClick={()=>setAttempt(n=>n+1)}>{t('重试')}</button>}</div>}
    {source==='server'&&loading?<p role="status">{t('正在翻开纪念册…')}</p>:<div className="album-layout">
      <aside className="album-cover"><BookOpen size={26} strokeWidth={1.4}/><p>MY LITTLE COLLECTION</p><h2>{t('每一片，都算数。')}</h2><div className="album-count"><strong>{earned.toString().padStart(2,'0')}</strong><span>/ {ACHIEVEMENTS.length}<br/>{t('枚纪念徽章')}</span></div><progress value={earned} max={ACHIEVEMENTS.length} aria-label={t('成就收集进度')}/><div className="album-totals"><span><b>{progress.pictures}</b>{t('张不同作品')}</span><span><b>{progress.days}</b>{t('个游玩日')}</span></div><div className="album-worn">{book.equipped?<><AchievementBadge id={book.equipped}/><strong>{t(achievementById(book.equipped)!.name)}</strong><button className="text-button" disabled={busy} onClick={()=>void equip(null)}>{t('取下徽章')}</button></>:<p>{t('获得徽章后，挑一枚佩戴。')}</p>}</div><a href="/gallery">{t('去拼一幅新作品')}<ArrowRight size={16}/></a></aside>
      <section className="album-pages" aria-label={t('我的成就')}><div className="album-filters">{['全部','已获得','待解锁'].map(value=><button key={value} aria-pressed={filter===value} onClick={()=>setFilter(value)}>{t(value)}</button>)}</div><div className="achievement-grid">{visible.map(b=>{const unlocked=!!book.earned[b.id],worn=book.equipped===b.id;return <article className={'achievement-card'+(unlocked?' earned':' locked')} key={b.id}><div className="achievement-card-top"><AchievementBadge id={b.id}/><span>{t(b.group)}</span>{unlocked?<Check size={16}/>:<Lock size={14}/>}</div><h3>{t(b.name)}</h3><p>{t(b.description)}</p>{unlocked?<><small>{t('获得于')} {date(book.earned[b.id]!)}</small><button className={worn?'secondary':'text-button'} aria-pressed={worn} disabled={busy} onClick={()=>void equip(worn?null:b.id)}>{t(worn?'已佩戴 · 点击取下':'佩戴徽章')}</button></>:<div className="achievement-progress"><progress value={Math.min(progress[b.metric],b.goal)} max={b.goal} aria-label={t(b.description)}/><span>{Math.min(progress[b.metric],b.goal)} / {b.goal}</span></div>}</article>;})}</div>{!visible.length&&<div className="recent-empty">{t(filter==='已获得'?'还没有徽章，完成第一张拼图就能获得。':'这一页的徽章已经收齐了。')}</div>}</section>
    </div>}
    <details className="album-rules"><summary>{t('成就如何记录')}</summary><p>{t('同一张图片在收藏成就中只计一次。成功连接拼块或首次归位算一次有效拼接，拖动已连接的大组不会把整组数量算给最后一人。合作成就要求至少两位玩家有有效拼接贡献。')}</p><p>{t('游玩日期按北京时间记录，无需连续签到。历史单人完成记录可以补入；旧多人记录无法确认贡献，合作成就从本次更新后开始累计。本机与服务器纪念册分别记录，暂不合并到账号。')}</p></details>
    {book.facts.length>0&&<section className="album-works"><h2>{t('收进纪念册的作品')}</h2><div>{[...new Map(book.facts.map(f=>[f.imageId,f])).values()].slice().reverse().map(f=>{const photo=RESTORABLE_PHOTOS.find(p=>p.id===f.imageId);return photo?<article key={f.imageId}><img src={photo.thumbSrc} alt={t(photo.title)} loading="lazy"/><h3>{t(photo.title)}</h3><small>{f.pieces} {t('片')} · {t(f.mode==='solo'?'单人拼图':'合作拼图')} · {date(f.completedAt)}</small></article>:null;})}</div></section>}
  </main></CommunityShell>;
}
