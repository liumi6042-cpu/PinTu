'use client';
import { useEffect,useRef,useState } from 'react';
import { Crown,ArrowRight,RefreshCw,Copy,Check,Play,Users,LockKeyhole } from 'lucide-react';
import { t } from '@/lib/i18n';
import { useLanguage } from '../../language-switch';
import { useAccount } from '../../account-gate';
import CommunityShell from '../../community-shell';
import { MembershipRules } from '../benefits';
import { useMembership } from '@/lib/use-membership';
import { useRoomConnection } from '@/lib/use-room-connection';
import { apiJson,joinPuzzle,clockLabel } from '@/lib/community-client';
import { ensureGuestSession } from '@/lib/guest-client';
import { customPhoto } from '@/lib/custom-images';
import { RESTORABLE_PHOTOS } from '@/lib/puzzle-catalog';
import type { RoomCard } from '@/lib/lobby-types';
import { MEMBER_ROOM_LIMIT } from '@/lib/membership-policy';
export default function MembershipCenter(){
  const language=useLanguage(),{account}=useAccount(),membership=useMembership(),[rooms,setRooms]=useState<RoomCard[]>([]),[error,setError]=useState(''),[loading,setLoading]=useState(true),[version,setVersion]=useState(0);
  useEffect(()=>{membership.reload();setRooms([]);},[account?.id,membership.reload]);
  useEffect(()=>{let alive=true;setLoading(version===0);setError('');ensureGuestSession().then(()=>apiJson<{rooms:RoomCard[]}>('/api/member-rooms')).then(data=>{if(alive)setRooms(data.rooms);}).catch(()=>{if(alive)setError('自建房间暂时无法读取，请重试。');}).finally(()=>{if(alive)setLoading(false);});return()=>{alive=false;};},[version,account?.id]);
  const summary=membership.data?.summary,active=summary?.status==='active',expired=summary?.status==='expired';
  const date=(n:number)=>new Date(n).toLocaleString(language==='en'?'en-US':'zh-CN',{year:'numeric',month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'});
  const refresh=()=>{membership.reload();setVersion(n=>n+1);};
  return <CommunityShell active="membership"><main className="community-main membership-center">
    <div className="member-center-heading"><div><p className="section-kicker">YOUR TABLES & MEMBERSHIP</p><h1>{t('我的会员')}</h1><p>{t('会员状态和自己的房间，都在这里。')}</p></div><a className="secondary" href="/membership">{t('查看会员权益')}<ArrowRight size={16}/></a></div>
    {membership.error&&<p className="form-error" role="alert">{t(membership.error)}<button className="text-button" onClick={membership.reload}>{t('重试')}</button></p>}
    <section className="member-status-card" aria-busy={membership.loading}><Crown size={34}/><div><span>{t('拼图会员')}</span><h2>{t(membership.loading?'正在读取会员状态…':active?'会员有效':expired?'会员已到期':summary?.status==='inactive'?'会员暂未生效':'尚未开通会员')}</h2><p>{summary?.membership?<>{t('有效期')}：{date(summary.membership.startsAt)} — {date(summary.membership.expiresAt)}</>:t('订阅暂未开放，当前不会收取费用。')}</p>{summary?.membership?.cancelAtPeriodEnd&&<p>{t('已设置到期后不续费，本期权益保留至到期。')}</p>}<small>{t('当前没有自动扣款；开通和续费入口将在支付接入后开放。')}</small></div><div className="member-status-action"><span>{t('订阅即将开放')}</span>{!account&&<a className="text-button" href="/account?returnTo=/membership/manage">{t('登录查看账号会员')}<ArrowRight size={15}/></a>}</div></section>
    <a className="membership-personal-entry" href="/personal/images"><Crown size={20}/>{t("我的图片 · 上传照片拼图")}<ArrowRight size={18}/></a>
    <section className="member-rooms-section"><div className="member-section-heading"><div><h2>{t('我的自建房间')}</h2><p>{t('只列出你创建的多人房间，参加过的桌面仍在个人空间。')}</p></div><button className="text-button" onClick={refresh} disabled={loading}><RefreshCw size={15}/>{t('刷新')}</button></div>
      <a className="secondary" href="/gallery?mode=public">{t('免费创建公开房间')}</a><div className="member-room-quota"><span>{t('账号进行中的私人房间')} <strong>{summary?.usedRooms??'—'} / {MEMBER_ROOM_LIMIT}</strong></span>{summary?.canCreate?<a className="primary" href="/gallery?mode=create">{t('创建新房间')}<ArrowRight size={16}/></a>:<span>{t(active?'已有 3 个进行中的私人房间，请先完成其中一局':expired?'会员到期，已有房间仍可继续':'新建私人房间需要有效会员')}</span>}</div>
      {error&&<p className="form-error" role="alert">{t(error)}<button className="text-button" onClick={refresh}>{t('重试')}</button></p>}
      {loading?<p role="status" className="muted">{t('正在读取自建房间…')}</p>:rooms.length?<div className="managed-room-list">{rooms.map(room=><ManagedRoom key={room.id} room={room} onSaved={refresh} canPrivatize={!!summary?.canCreate}/>)}</div>:!error&&<div className="member-empty"><Users size={30}/><h3>{t('还没有自己的拼图桌')}</h3><p>{t('订阅开放后可创建房间，现在可以先去公开大厅免费游玩。')}</p><a className="secondary" href="/lobby">{t('去公开大厅一起玩')}<ArrowRight size={16}/></a></div>}
      <a className="text-button" href="/personal">{t('查看全部续玩进度')}<ArrowRight size={15}/></a>
    </section>
    <section className="member-orders"><h2>{t('订单记录')}</h2>{membership.loading?<p>{t('正在读取会员状态…')}</p>:membership.error?<p>{t('会员信息暂时无法读取，请重试。')}</p>:membership.data?.orders.length?<div className="membership-table-scroll"><table><thead><tr><th>{t('订单号')}</th><th>{t('时间')}</th><th>{t('金额')}</th><th>{t('状态')}</th></tr></thead><tbody>{membership.data.orders.map(order=><tr key={order.id}><td>{order.id}</td><td>{date(order.createdAt)}</td><td>{new Intl.NumberFormat(language==='en'?'en-US':'zh-CN',{style:'currency',currency:order.currency}).format(order.amountMinor/100)}</td><td>{t(({paid:'已支付',pending:'待支付',failed:'支付失败',refunded:'已退款'} as Record<string,string>)[order.status]||order.status)}</td></tr>)}</tbody></table></div>:<p>{t('暂无订单。订阅尚未开放，不会产生扣款。')}</p>}</section>
    <MembershipRules/>
  </main></CommunityShell>;
}
function ManagedRoom({room,onSaved,canPrivatize}:{room:RoomCard;onSaved:()=>void;canPrivatize:boolean}){
  useLanguage();const photo=room.customImage?customPhoto(room.customImage,room.id):RESTORABLE_PHOTOS.find(p=>p.id===room.imageId)!,[draftTitle,setTitle]=useState<string|null>(null),[visibility,setVisibility]=useState<'private'|'public'>(room.visibility==='public'?'public':'private'),[accepting,setAccepting]=useState(room.acceptingNew!==false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[saved,setSaved]=useState(false),[copied,setCopied]=useState(false),[fallback,setFallback]=useState(false),input=useRef<HTMLInputElement>(null),connection=useRoomConnection();
  const title=draftTitle??(room.customTitle?room.title:t(room.title));
  const changed=title!==(room.customTitle?room.title:t(room.title))||visibility!==room.visibility||accepting!==(room.acceptingNew!==false),invite=connection.inviteOrigin+'/room/'+room.id;
  useEffect(()=>{setTitle(null);setVisibility(room.visibility==='public'?'public':'private');setAccepting(room.acceptingNew!==false);},[room.title,room.visibility,room.acceptingNew,room.customTitle]);
  async function save(event:React.FormEvent){event.preventDefault();if(busy)return;setBusy(true);setError('');setSaved(false);try{await apiJson('/api/member-rooms/'+room.id,{...(title!==(room.customTitle?room.title:t(room.title))?{title}:{}),visibility,acceptingNew:accepting});setSaved(true);onSaved();}catch(e){setError(e instanceof Error?e.message:'房间设置未能保存');}finally{setBusy(false);}}
  async function enter(){if(busy)return;setBusy(true);setError('');try{await joinPuzzle(room.id);location.assign('/room/'+room.id);}catch(e){setError(e instanceof Error?e.message:'连接失败');setBusy(false);}}
  async function copy(){try{await navigator.clipboard.writeText(invite);setCopied(true);}catch{setFallback(true);requestAnimationFrame(()=>{input.current?.focus();input.current?.select();});}}
  return <article className="managed-room"><div className="managed-room-picture"><img src={photo.thumbSrc} alt={t(photo.title)} loading="lazy"/><span>{room.pieces} {t('片')} · {room.players}/8</span></div><form onSubmit={save}><div className="managed-room-summary"><span>{t(photo.title)} · {room.completed?t('已完成'):Math.round(room.placed/room.pieces*100)+'%'} · {clockLabel(room.elapsed)}</span><button type="button" className="text-button" onClick={()=>void enter()} disabled={busy}><Play size={15}/>{t(room.completed?'欣赏作品':'继续拼图')}</button></div><label>{t('房间名称')}<input value={title} required maxLength={40} onChange={e=>{setTitle(e.target.value);setSaved(false);}} disabled={busy}/><small>{t('1–40 个字符，所有玩家都能看到。')}</small></label><div className="managed-room-controls"><fieldset disabled={busy}><legend>{t('房间可见范围')}</legend><label><input type="radio" disabled={room.visibility!=='private'&&!canPrivatize} checked={visibility==='private'} onChange={()=>setVisibility('private')}/><LockKeyhole size={14}/>{t('私人房间（会员）')}</label><label><input type="radio" checked={visibility==='public'} onChange={()=>setVisibility('public')}/><Users size={14}/>{t('公开到大厅')}</label></fieldset><label className="managed-accepting"><input type="checkbox" checked={accepting} onChange={e=>setAccepting(e.target.checked)} disabled={busy}/>{t('允许新玩家加入')}<small>{t('关闭后，已入座的朋友仍可回来续拼。')}</small></label></div><div className="managed-room-footer"><button className="primary" disabled={busy||!changed}>{t(busy?'正在保存…':'保存设置')}</button><button type="button" className="secondary" onClick={()=>void copy()} disabled={!connection.ready}>{copied?<Check size={15}/>:<Copy size={15}/>} {t(copied?'已复制邀请':'复制邀请链接')}</button>{saved&&<span role="status">{t('房间设置已保存')}</span>}</div>{fallback&&<label>{t('已选中链接，按 Ctrl+C 或长按复制')}<input ref={input} value={invite} readOnly onFocus={e=>e.target.select()}/></label>}{error&&<p className="form-error" role="alert">{t(error)}</p>}</form></article>;
}
