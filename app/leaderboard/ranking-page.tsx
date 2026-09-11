'use client';
import { useEffect,useState } from 'react';
import { Trophy,Clock3,Users,RefreshCw } from 'lucide-react';
import { t,getLanguage,playerName } from '@/lib/i18n';
import { useLanguage } from '@/app/language-switch';
import { RESTORABLE_PHOTOS } from '@/lib/puzzle-catalog';
import { SAVED_LEVELS } from '@/lib/puzzle-engine';
import { apiJson,clockLabel } from '@/lib/community-client';
import { ensureGuestSession } from '@/lib/guest-client';
import type { RankingBoard } from '@/lib/lobby-types';
import CommunityShell from '../community-shell';
import { Select,SelectTrigger,SelectContent,SelectItem,SelectValue } from '@/components/ui/select';
function Filter({label,value,onChange,items}:{label:string;value:string;onChange:(value:string)=>void;items:{value:string;label:string}[]}){
  return <label className="rank-filter"><span>{t(label)}</span><Select items={items.map(item=>({...item,label:t(item.label)}))} value={value} onValueChange={v=>{if(v!==null)onChange(v);}}><SelectTrigger className="difficulty-trigger"><SelectValue/></SelectTrigger><SelectContent className="difficulty-menu" alignItemWithTrigger={false}>{items.map(item=><SelectItem key={item.value} value={item.value}>{t(item.label)}</SelectItem>)}</SelectContent></Select></label>;
}
function time(ms:number){return clockLabel(ms/1000)+'.'+String(ms%1000).padStart(3,'0');}
export default function RankingPage(){
  useLanguage();const [mode,setMode]=useState('team'),[imageId,setImageId]=useState(RESTORABLE_PHOTOS[0].id),[pieces,setPieces]=useState('108'),[players,setPlayers]=useState('1'),[period,setPeriod]=useState('week'),[board,setBoard]=useState<RankingBoard|null>(null),[loading,setLoading]=useState(true),[error,setError]=useState(''),[ready,setReady]=useState(false),[version,setVersion]=useState(0);
  useEffect(()=>{const p=new URLSearchParams(location.search),m=p.get('mode'),image=p.get('imageId'),n=p.get('pieces'),count=p.get('players'),period=p.get('period');if(m==='solo'||m==='team')setMode(m);if(image&&RESTORABLE_PHOTOS.some(v=>v.id===image))setImageId(image);if(n&&SAVED_LEVELS.some(v=>v.count===Number(n)))setPieces(n);if(count&&Number.isInteger(Number(count))&&Number(count)>=1&&Number(count)<=32)setPlayers(count);if(period==='week'||period==='all')setPeriod(period);setReady(true);const refresh=()=>setVersion(n=>n+1);window.addEventListener('focus',refresh);return()=>window.removeEventListener('focus',refresh);},[]);
  useEffect(()=>{if(!ready)return;let alive=true;setLoading(true);setBoard(null);setError('');const params=new URLSearchParams({mode,imageId,pieces,players,period});history.replaceState(null,'','/leaderboard?'+params);ensureGuestSession().then(()=>apiJson<RankingBoard>('/api/leaderboard?'+params)).then(data=>{if(alive)setBoard(data);}).catch(()=>{if(alive)setError('成绩暂时无法读取，请重试。');}).finally(()=>{if(alive)setLoading(false);});return()=>{alive=false;};},[ready,mode,imageId,pieces,players,period,version]);
  const date=(value:number)=>new Date(value).toLocaleDateString(getLanguage()==='en'?'en-US':'zh-CN',{timeZone:'Asia/Shanghai',year:'numeric',month:'short',day:'numeric'});
  return <CommunityShell active="ranking"><main className="community-main">
    <section className="lobby-heading"><div><p className="section-kicker"><Trophy size={16}/> A LITTLE MOMENT OF GLORY</p><h1>{t('把这一刻，留在榜上。')}</h1><p>{t('同一张图、相同片数与参与人数，用时越短，排名越靠前。')}</p></div><Trophy className="ranking-emblem" size={70}/></section>
    <div className="ranking-controls"><div className="ranking-tabs-row"><div className="filter-tabs" aria-label={t('榜单模式')}><button aria-pressed={mode==='team'} onClick={()=>setMode('team')}><Users size={17}/>{t('合作用时榜')}</button><button aria-pressed={mode==='solo'} onClick={()=>setMode('solo')}><Clock3 size={17}/>{t('单人用时榜')}</button></div><div className="filter-tabs" aria-label={t('统计时段')}><button aria-pressed={period==='week'} onClick={()=>setPeriod('week')}>{t('本周榜')}</button><button aria-pressed={period==='all'} onClick={()=>setPeriod('all')}>{t('历史榜')}</button></div></div>
      <div className="ranking-selects"><Filter label="拼图" value={imageId} onChange={setImageId} items={RESTORABLE_PHOTOS.map(p=>({value:p.id,label:p.title}))}/><Filter label="片数" value={pieces} onChange={setPieces} items={SAVED_LEVELS.map(l=>({value:String(l.count),label:l.count.toLocaleString()+' 片'}))}/>{mode==='team'&&<Filter label="累计参与人数" value={players} onChange={setPlayers} items={Array.from({length:32},(_,i)=>({value:String(i+1),label:(i+1)+' 人'}))}/>}</div>
    </div>
    <p className="ranking-period-note">{t(period==='week'?'本周按北京时间周一 00:00 开始，按完成时间归档。':'保留全部历史完成成绩。')}{board&&period==='week'&&<> {date(board.weekStart)} — {date(board.weekEnd-1)}</>}</p>
    {error?<p className="form-error" role="alert">{t(error)} <button className="text-button" onClick={()=>setVersion(n=>n+1)}><RefreshCw size={15}/>{t('重试')}</button></p>:<section className="personal-record-card" aria-busy={loading}><Trophy size={26}/><div><h2>{t(period==='week'?'本周个人最佳':'历史个人最佳')}</h2>{loading?<p>{t('正在读取成绩…')}</p>:board?.myBest?<p><strong>{time(board.myBest.elapsedMs)}</strong><span>{t('排名')} #{board.myBest.rank} / {board.total}</span></p>:<p>{t('这些条件下还没有你的成绩，完成一局就能留下纪录。')}</p>}</div>{board?.myBest&&<span className="personal-record-date">{date(board.myBest.completedAt)}</span>}</section>}
    <section className="ranking-board" aria-label={t('完成用时排名')}><div className="ranking-row ranking-table-head"><span>{t('排名')}</span><span>{t(mode==='solo'?'玩家':'共同完成的玩家')}</span><span>{t('完成用时')}</span><span>{t('完成日期')}</span></div>{loading?<div className="community-empty" role="status">{t('正在读取成绩…')}</div>:error?null:board?.entries.length?board.entries.map((entry,index)=><div className={'ranking-row'+(entry.mine?' ranking-row-mine':'')} key={entry.roomId}><strong className={'rank-number rank-'+index}>{String(entry.rank).padStart(2,'0')}</strong><span className="rank-names">{entry.names.map(playerName).join(getLanguage()==='en'?', ':'、')}{entry.mine&&<small className="rank-mine-label">{t('有你参与')}</small>}</span><strong className="rank-time">{time(entry.elapsedMs)}</strong><time>{date(entry.completedAt)}</time></div>):<div className="community-empty"><Trophy size={38}/><h2>{t('第一名的位置，暂时空着。')}</h2><p>{t('完成符合条件的拼图，你的成绩就会出现在这里。')}</p><a href={mode==='solo'?'/personal':'/lobby'} className="primary">{t('去拼一幅')}</a>{period==='week'&&<button className="text-button" onClick={()=>setPeriod('all')}>{t('看看历史成绩')}</button>}</div>}</section>
    {board&&board.total>50&&<p className="ranking-note">{t('榜单展示前 50 名，个人最佳仍会显示你的实际名次。')}</p>}
    <p className="ranking-note">{t('从第一次拿起拼块计时，全部归位时结束。暂停与离线不会暂停榜单计时；每局只记一次成绩。')}</p>
    {mode==='team'&&<p className="ranking-note">{t('每桌最多 8 人同时在线；榜单统计整局实际操作过拼块的累计人数，中途换人也会计入。')}</p>}
    <p className="ranking-note">{t('个人纪录包含此浏览器游客与当前账号的服务器成绩。本机单人存档不计榜单；无法确认身份的早期成绩仅保留在公开榜单。')}</p>
  </main></CommunityShell>;
}
