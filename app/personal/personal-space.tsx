'use client';
import { t } from '@/lib/i18n';
import { useLanguage } from '@/app/language-switch';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowUpRight, Play, Clock3, Monitor, Server, Crown, BookOpen, Trash2, Undo2 } from 'lucide-react';
import type { RoomCard } from '@/lib/lobby-types';
import { customPhoto } from '@/lib/custom-images';
import { RESTORABLE_PHOTOS } from '@/lib/puzzle-catalog';
import { apiJson, joinPuzzle, clockLabel } from '@/lib/community-client';
import { readLocalProgress, removeLocalProgress, restoreRemovedLocalProgress, type LocalProgress, type RemovedLocalProgress } from '@/lib/local-progress';
import { AlertDialog, AlertDialogContent, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel } from '@/components/ui/alert-dialog';
import { resumeProgress, type ResumeProgress } from '@/lib/resume-progress';
import CommunityShell from '../community-shell';
import PuzzleApp from '../puzzle-app';
import { useAccount } from '../account-gate';
import { accountLoginUrl } from '@/lib/account-return';
import { PERSONAL_PLAY_VISIBLE,MEMBERSHIP_VISIBLE } from '@/lib/feature-visibility';

export default function PersonalSpace() {
  const language = useLanguage();
  const { account } = useAccount();
  const [mode, setMode] = useState<'solo' | 'create' | null>(null);
  const [rooms, setRooms] = useState<RoomCard[]>([]), [local, setLocal] = useState<LocalProgress[]>([]);
  const [error, setError] = useState(''), [localError, setLocalError] = useState('');
  const [busy, setBusy] = useState(''), [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState<ResumeProgress | null>(null), [deleteError, setDeleteError] = useState('');
  const [removed, setRemoved] = useState<{ entry: ResumeProgress; local?: RemovedLocalProgress } | null>(null);
  const actionLock = useRef(false), roomsRequest = useRef(0);
  useEffect(() => {
    const initial = new URLSearchParams(window.location.search).get('mode');
    if (initial === 'solo'&&PERSONAL_PLAY_VISIBLE || initial === 'create'&&MEMBERSHIP_VISIBLE) setMode(initial);
    let alive = true;
    const loadLocal = () => { if(!PERSONAL_PLAY_VISIBLE)return; try { setLocal(readLocalProgress(localStorage)); setLocalError(''); }
      catch { setLocalError('无法读取本机进度，请检查浏览器存储权限。'); } };
    const loadRooms = async () => {
      if (actionLock.current) return;
      const request = ++roomsRequest.current;
      try { const data = await apiJson<{ rooms: RoomCard[] }>('/api/my-rooms');
        if (alive && request === roomsRequest.current) { setRooms(data.rooms); setError(''); }
      } catch (e) { if (alive && request === roomsRequest.current) setError(e instanceof Error ? e.message : '连接失败'); }
      finally { if (alive && request === roomsRequest.current) setLoading(false); }
    };
    loadLocal(); void loadRooms();
    const onFocus = () => { loadLocal(); void loadRooms(); };
    window.addEventListener('focus', onFocus); window.addEventListener('storage', loadLocal);
    return () => { alive = false; window.removeEventListener('focus', onFocus); window.removeEventListener('storage', loadLocal); };
  }, []);
  const entries = useMemo(() => resumeProgress(PERSONAL_PLAY_VISIBLE?local:[], rooms.filter(room=>room.visibility==='public'||room.visibility==='solo'&&PERSONAL_PLAY_VISIBLE||room.visibility==='private'&&MEMBERSHIP_VISIBLE)), [local, rooms]);
  const ongoing = entries.filter(entry => !entry.completed), completed = entries.filter(entry => entry.completed);
  const latest = ongoing[0];
  function choose(next: 'solo' | 'create') { window.history.replaceState(null, '', '/personal?mode=' + next); setMode(next); }
  async function resume(entry: ResumeProgress) {
    if (busy || actionLock.current) return;
    const destination = entry.source === 'local' ? '/gallery?' + new URLSearchParams({ resume: entry.id }) : '/room/' + entry.id;
    if (!account && (entry.source === 'local' || entry.visibility === 'solo')) { window.location.assign(accountLoginUrl(destination)); return; }
    setBusy(entry.id); setError('');
    if (entry.source === 'local') { window.location.assign(destination); return; }
    try { await joinPuzzle(entry.id); window.location.assign('/room/' + entry.id); }
    catch (e) { setError(e instanceof Error ? e.message : '连接失败'); setBusy(''); }
  }
  async function deleteRecord() {
    if (!deleting || actionLock.current) return;
    const entry = deleting;
    actionLock.current = true; ++roomsRequest.current; setBusy('delete:' + entry.id); setDeleteError('');
    try {
      let localSnapshot: RemovedLocalProgress | undefined;
      if (entry.source === 'local') {
        localSnapshot = removeLocalProgress(localStorage, entry.id);
        setLocal(records => records.filter(record => record.key !== entry.id));
      } else {
        await apiJson('/api/my-rooms', { roomId: entry.id, action: 'remove' });
        setRooms(records => records.filter(record => record.id !== entry.id));
      }
      setRemoved({ entry, local: localSnapshot }); setDeleting(null);
    } catch (e) { setDeleteError(e instanceof Error ? e.message : '删除失败，请重试'); }
    finally { ++roomsRequest.current; actionLock.current = false; setBusy(''); setLoading(false); }
  }
  async function undoDelete() {
    if (!removed || actionLock.current || busy) return;
    actionLock.current = true; ++roomsRequest.current; setBusy('undo'); setError('');
    try {
      if (removed.local) {
        restoreRemovedLocalProgress(localStorage, removed.local);
        setLocal(readLocalProgress(localStorage));
      } else {
        await apiJson('/api/my-rooms', { roomId: removed.entry.id, action: 'restore' });
        const data = await apiJson<{ rooms: RoomCard[] }>('/api/my-rooms'); setRooms(data.rooms);
      }
      setRemoved(null);
    } catch (e) { setError(e instanceof Error ? e.message : '恢复失败，请重试'); }
    finally { ++roomsRequest.current; actionLock.current = false; setBusy(''); }
  }
  function card(entry: ResumeProgress, featured = false) {
    const photo = entry.customImage?customPhoto(entry.customImage,entry.id):RESTORABLE_PHOTOS.find(photo => photo.id === entry.imageId)!;
    return <article className={'recent-room unified-room' + (featured ? ' featured-resume' : '')} key={entry.source + entry.id}>
      <img src={photo.thumbSrc} alt="" loading="lazy"/>
      <div className="resume-copy">{featured && <span className="resume-eyebrow">{t('继续上次拼图')}</span>}
        <h3>{entry.customTitle?entry.title:t(entry.title)}</h3>
        <p>{entry.source === 'local' ? <Monitor size={14}/> : <Server size={14}/>}
          {t(entry.source === 'local' ? '本机存档' : '服务器房间')} · {entry.pieces} {t('片')} · {Math.round(entry.placed / entry.pieces * 100)}%</p>
        <small>{entry.source === 'local' ? t('保存在当前浏览器，无自动到期时间') : <>{t('保留至')} <time dateTime={new Date(entry.expiresAt!).toISOString()}>{new Date(entry.expiresAt!).toLocaleDateString(language === 'en' ? 'en-US' : 'zh-CN')}</time> · {t(entry.visibility === 'solo' ? '单人' : entry.visibility === 'public' ? '公开' : '私人')}</>}</small>
      </div>
      <span className="recent-time"><Clock3 size={15}/>{clockLabel(entry.elapsed)}</span>
      <div className="record-actions"><button className={featured ? 'primary' : 'secondary'} disabled={!!busy} onClick={() => void resume(entry)}>
        {t(busy === entry.id ? '连接中…' : entry.completed ? '欣赏作品' : '继续拼图')}<Play size={15}/>
      </button>
      <button className="record-delete" disabled={!!busy} aria-label={t('删除记录') + ' · ' + (entry.customTitle ? entry.title : t(entry.title))} onClick={() => { setDeleting(entry); setDeleteError(''); }}><Trash2 size={16}/><span>{t('删除记录')}</span></button></div>
    </article>;
  }
  if (mode) return <PuzzleApp entryMode={mode}/>;
  return <CommunityShell active="personal"><main className="community-main">
    <section className="lobby-heading"><div><p className="section-kicker">YOUR PUZZLES</p><h1>{t(PERSONAL_PLAY_VISIBLE?'这一片，按你的节奏。':'拼图记录')}</h1><p>{t(PERSONAL_PLAY_VISIBLE?'自己安静地拼，或挑一张图，邀请朋友坐下来。':'继续你参与过的公开拼图。')}</p></div></section>
    {error && <p role="alert" className="form-error">{t(error)}</p>}{localError && <p role="alert" className="form-error">{t(localError)}</p>}
    {removed && <div className="record-undo" role="status"><span>{t('已删除记录')} · {removed.entry.customTitle ? removed.entry.title : t(removed.entry.title)}</span><button className="text-button" disabled={!!busy} onClick={() => void undoDelete()}><Undo2 size={16}/>{t(busy === 'undo' ? '正在恢复…' : '撤销删除')}</button></div>}
    {loading && <p className="muted">{t('正在寻找上次的桌面…')}</p>}
    {latest && <section className="resume-highlight" aria-label={t('继续上次拼图')}>{card(latest, true)}</section>}
    <a className="achievement-entry" href="/achievements"><BookOpen size={32}/><div><h2>{t("我的拼图纪念册")}</h2><p>{t("收集纪念徽章，看看下一枚离你还有多远。")}</p></div><ArrowUpRight size={24}/></a>
    {MEMBERSHIP_VISIBLE&&<a className="membership-personal-entry" href="/membership/manage"><Crown size={18}/>{t("我的会员与自建房间")}<ArrowUpRight size={16}/></a>}
    {(PERSONAL_PLAY_VISIBLE||MEMBERSHIP_VISIBLE)&&<div className="personal-choices">{PERSONAL_PLAY_VISIBLE&&<button className="personal-choice" onClick={() => choose('solo')}><img src={RESTORABLE_PHOTOS.find(p => p.id === 'seaside')!.thumbSrc} alt="" aria-hidden="true"/><div><span className="choice-label">JUST ME · {t("登录后免费游玩")}</span><h2>{t('独自拼图')}</h2><p>{t('登录普通账号，选择图片与片数，开启自己的计时挑战。')}</p><span className="choice-arrow">{t('挑一张喜欢的 ')}<ArrowUpRight size={22}/></span></div></button>}
    {MEMBERSHIP_VISIBLE&&<button className="personal-choice" onClick={() => choose('create')}><img src={RESTORABLE_PHOTOS.find(p => p.id === 'alpine-village')!.thumbSrc} alt="" aria-hidden="true"/><div><span className="choice-label">WITH FRIENDS · {t('会员专属')}</span><h2>{t('创建私人房间')} <Crown size={24}/></h2><p>{t('订阅会员，创建仅凭邀请链接加入的私人拼图桌。')}</p><span className="choice-arrow">{t('查看会员权益')}<ArrowUpRight size={22}/></span></div></button>}</div>}
    {!PERSONAL_PLAY_VISIBLE&&<a className="secondary" href="/lobby">{t('去公开大厅')}<ArrowUpRight size={18}/></a>}
    <section className="recent-section"><div className="recent-heading"><h2>{t('我的桌面')} <small>{ongoing.length}</small></h2></div>
      <p className="retention-note">{t('公开房间有人在拼时保留；无人且无进度时清理，已有进度保留约 24 小时。')}</p>
      {ongoing.length ? <div className="recent-rooms">{ongoing.map(entry => card(entry))}</div> : !loading && <div className="recent-empty">{t('还没有未完成的公开拼图，去大厅选一张吧。')}</div>}
      {completed.length > 0 && <details className="completed-progress"><summary>{t('已完成的作品')} ({completed.length})</summary><div className="recent-rooms">{completed.map(entry => card(entry))}</div></details>}
    </section>
    <AlertDialog open={!!deleting} onOpenChange={open => { if (!open && !actionLock.current) setDeleting(null); }}><AlertDialogContent>
      <AlertDialogTitle>{t('删除这条拼图记录？')}</AlertDialogTitle>
      <AlertDialogDescription>{deleting && <><strong>{deleting.customTitle ? deleting.title : t(deleting.title)}</strong><br/>{t(deleting.source === 'local' ? '将清除这幅拼图在当前浏览器的存档。' : '仅从你的个人记录中移除，服务器房间和其他玩家的进度保持不变。')}<br/>{t('已有成绩和成就保留。删除后可在当前页面撤销。')}</>}</AlertDialogDescription>
      {deleteError && <p className="form-error" role="alert">{t(deleteError)}</p>}
      <AlertDialogFooter><AlertDialogCancel disabled={!!busy}>{t('取消')}</AlertDialogCancel><button className="primary record-delete-confirm" disabled={!!busy} onClick={() => void deleteRecord()}>{t(busy ? '正在删除…' : '确认删除')}</button></AlertDialogFooter>
    </AlertDialogContent></AlertDialog>
  </main></CommunityShell>;
}
