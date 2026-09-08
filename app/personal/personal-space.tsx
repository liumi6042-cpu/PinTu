'use client';
import { t } from '@/lib/i18n';
import { useLanguage } from '@/app/language-switch';

import { useEffect, useState } from 'react';
import { ArrowUpRight, UserRound, Users, Play, Clock3, LockKeyhole, Globe } from 'lucide-react';
import type { RoomCard } from '@/lib/lobby-types';
import { RESTORABLE_PHOTOS } from '@/lib/puzzle-catalog';
import { apiJson, joinPuzzle, clockLabel } from '@/lib/community-client';
import CommunityShell from '../community-shell';
import PuzzleApp from '../puzzle-app';
export default function PersonalSpace() {
    useLanguage();
    const [mode, setMode] = useState<'solo' | 'create' | null>(null), [rooms, setRooms] = useState<RoomCard[]>([]), [error, setError] = useState(''), [busy, setBusy] = useState(''), [loading, setLoading] = useState(true);
    useEffect(() => { const mode = new URLSearchParams(window.location.search).get('mode'); if (mode === 'solo' || mode === 'create')
        setMode(mode); let alive = true; apiJson<{
        rooms: RoomCard[];
    }>('/api/my-rooms').then(data => { if (alive)
        setRooms(data.rooms); }).catch(e => { if (alive)
        setError(e.message); }).finally(() => { if (alive)
        setLoading(false); }); return () => { alive = false; }; }, []);
    function choose(next: 'solo' | 'create') { window.history.replaceState(null, '', '/personal?mode=' + next); setMode(next); }
    async function resume(id: string) { setBusy(id); setError(''); try {
        await joinPuzzle(id);
        window.location.assign('/room/' + id);
    }
    catch (e) {
        setError(e instanceof Error ? e.message : '连接失败');
        setBusy('');
    } }
    if (mode)
        return <PuzzleApp entryMode={mode}/>;
    return <CommunityShell active="personal"><main className="community-main"><section className="lobby-heading"><div><p className="section-kicker">A TABLE OF YOUR OWN</p><h1>{t("这一片，按你的节奏。")}</h1><p>{t("自己安静地拼，或挑一张图，邀请朋友坐下来。")}</p></div></section><div className="personal-choices"><button className="personal-choice" onClick={() => choose('solo')}><img src={RESTORABLE_PHOTOS.find(p=>p.id==='seaside')!.thumbSrc} alt="" aria-hidden="true"/><div><span className="choice-icon"><UserRound size={25}/></span><span className="choice-label">JUST ME</span><h2>{t("独自拼图")}</h2><p>{t("选择图片与片数，开启自己的计时挑战。")}</p><span className="choice-arrow">{t("挑一张喜欢的 ")}<ArrowUpRight size={22}/></span></div></button><button className="personal-choice" onClick={() => choose('create')}><img src={RESTORABLE_PHOTOS.find(p=>p.id==='alpine-village')!.thumbSrc} alt="" aria-hidden="true"/><div><span className="choice-icon"><Users size={25}/></span><span className="choice-label">WITH FRIENDS</span><h2>{t("创建房间")}</h2><p>{t("仅邀请朋友，或把你的桌子开放给所有人。")}</p><span className="choice-arrow">{t("布置一张桌子 ")}<ArrowUpRight size={22}/></span></div></button></div><section className="recent-section"><div className="recent-heading"><h2>{t("我的桌面")}</h2><span>{t("房间保留 24 小时")}</span></div>{t(error && <p role="alert" className="form-error">{t(error)}</p>)}{t(loading ? <p className="muted">{t("正在寻找上次的桌面\u2026")}</p> : rooms.length ? <div className="recent-rooms">{t(rooms.map(room => <article className="recent-room" key={room.id}><img src={RESTORABLE_PHOTOS.find(p => p.id === room.imageId)?.thumbSrc} alt=""/><div><h3>{t(room.title)}</h3><p>{t(room.visibility === 'solo' ? <UserRound size={14}/> : room.visibility === 'public' ? <Globe size={14}/> : <LockKeyhole size={14}/>)} {t(room.visibility === 'solo' ? '单人' : room.visibility === 'public' ? '公开' : '私人')} · {t(room.pieces)}{t(" 片 \u00B7 ")}{t(Math.round(room.placed / room.pieces * 100))}%</p></div><span className="recent-time"><Clock3 size={15}/>{t(clockLabel(room.elapsed))}</span><button className="secondary" disabled={!!busy} onClick={() => resume(room.id)}>{t(busy === room.id ? '连接中…' : room.completed ? '欣赏作品' : '继续拼图')}<Play size={15}/></button></article>))}</div> : <div className="recent-empty">{t("还没有你的桌面。从上面选一种方式开始吧。")}</div>)}</section></main></CommunityShell>;
}
