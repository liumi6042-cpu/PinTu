'use client';
import { t,getLanguage,playerName } from '@/lib/i18n';
import { useLanguage } from '@/app/language-switch';

import { useEffect, useState } from 'react';
import { Trophy, Clock3, Users } from 'lucide-react';
import { PHOTOS } from '@/lib/puzzle-catalog';
import { SAVED_LEVELS as LEVELS } from '@/lib/puzzle-engine';
import { apiJson, clockLabel } from '@/lib/community-client';
import type { RankingRow } from '@/lib/lobby-types';
import CommunityShell from '../community-shell';
import { Select, SelectTrigger, SelectContent, SelectItem, SelectValue } from '@/components/ui/select';
function Filter({ label, value, onChange, items }: {
    label: string;
    value: string;
    onChange: (value: string) => void;
    items: {
        value: string;
        label: string;
    }[];
}) { useLanguage(); return <label className="rank-filter"><span>{t(label)}</span><Select items={items.map(item=>({...item,label:t(item.label)}))} value={value} onValueChange={v => { if (v !== null)
    onChange(v); }}><SelectTrigger className="difficulty-trigger"><SelectValue /></SelectTrigger><SelectContent className="difficulty-menu" alignItemWithTrigger={false}>{t(items.map(item => <SelectItem key={item.value} value={item.value}>{t(item.label)}</SelectItem>))}</SelectContent></Select></label>; }
export default function RankingPage() {
    useLanguage();
    const [mode, setMode] = useState('team'), [imageId, setImageId] = useState(PHOTOS[0].id), [pieces, setPieces] = useState('108'), [players, setPlayers] = useState('1'), [entries, setEntries] = useState<RankingRow[]>([]), [loading, setLoading] = useState(true), [error, setError] = useState('');
    useEffect(() => { const p = new URLSearchParams(window.location.search), mode = p.get('mode'), image = p.get('imageId'), pieces = p.get('pieces'), players = p.get('players'); if (mode === 'solo' || mode === 'team')
        setMode(mode); if (image && PHOTOS.some(v => v.id === image))
        setImageId(image); if (pieces && LEVELS.some(v => v.count === Number(pieces)))
        setPieces(pieces); if (players && Number(players) >= 1 && Number(players) <= 32)
        setPlayers(players); }, []);
    useEffect(() => { let alive = true; setLoading(true); setEntries([]); setError(''); const params = new URLSearchParams({ mode, imageId, pieces, players }); apiJson<{
        entries: RankingRow[];
    }>('/api/leaderboard?' + params).then(data => { if (alive)
        setEntries(data.entries); }).catch(e => { if (alive)
        setError(e.message); }).finally(() => { if (alive)
        setLoading(false); }); return () => { alive = false; }; }, [mode, imageId, pieces, players]);
    return <CommunityShell active="ranking"><main className="community-main"><section className="lobby-heading"><div><p className="section-kicker"><Trophy size={16}/> A LITTLE MOMENT OF GLORY</p><h1>{t("把这一刻，留在榜上。")}</h1><p>{t("同一张图、相同片数与参与人数，用时越短，排名越靠前。")}</p></div><Trophy className="ranking-emblem" size={70}/></section><div className="ranking-controls"><div className="filter-tabs"><button aria-pressed={mode === 'team'} onClick={() => setMode('team')}><Users size={17}/>{t("合作用时榜")}</button><button aria-pressed={mode === 'solo'} onClick={() => setMode('solo')}><Clock3 size={17}/>{t("单人用时榜")}</button></div><div className="ranking-selects"><Filter label="拼图" value={imageId} onChange={setImageId} items={PHOTOS.map(p => ({ value: p.id, label: p.title }))}/><Filter label="片数" value={pieces} onChange={setPieces} items={LEVELS.map(l => ({ value: String(l.count), label: l.count.toLocaleString() + ' 片' }))}/>{t(mode === 'team' && <Filter label="参与人数" value={players} onChange={setPlayers} items={Array.from({ length: 32 }, (_, i) => ({ value: String(i + 1), label: (i + 1) + ' 人' }))}/>)}</div></div>{t(error && <p className="form-error" role="alert">{t(error)}</p>)}<section className="ranking-board" aria-label={t("完成用时排名")}><div className="ranking-row ranking-table-head"><span>{t("排名")}</span><span>{t(mode === 'solo' ? '玩家' : '共同完成的玩家')}</span><span>{t("完成用时")}</span><span>{t("完成日期")}</span></div>{t(loading ? <div className="community-empty">{t("正在读取成绩\u2026")}</div> : entries.length ? entries.map((entry, index) => <div className="ranking-row" key={entry.roomId}><strong className={'rank-number rank-' + index}>{t(String(index + 1).padStart(2, '0'))}</strong><span className="rank-names">{entry.names.map(playerName).join(getLanguage()==='en'?', ':'、')}</span><strong className="rank-time">{t(clockLabel(entry.elapsedMs / 1000))}<small>.{t(String(entry.elapsedMs % 1000).padStart(3, '0'))}</small></strong><time>{t(new Date(entry.completedAt).toLocaleDateString(getLanguage()==='en'?'en-US':'zh-CN'))}</time></div>) : <div className="community-empty"><Trophy size={38}/><h2>{t("第一名的位置，暂时空着。")}</h2><p>{t("完成符合条件的拼图，你的成绩就会出现在这里。")}</p><a href={mode === 'solo' ? '/personal' : '/lobby'} className="primary">{t("去拼一幅")}</a></div>)}</section><p className="ranking-note">{t("从第一次拿起拼块计时，全部归位时结束。暂停与离线不会暂停榜单计时；合作人数按实际参与拼块操作的玩家计算。每局只记一次成绩。")}</p></main></CommunityShell>;
}
