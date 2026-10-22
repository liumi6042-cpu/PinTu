import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { Check, Copy, Share2, UsersRound } from 'lucide-react';
import { h5Config } from './config';
import { mobileJson, mobilePost, requestId, type MobileGiftKind, type MobileGiftOpenResult, type MobileGiftReceipt, type MobileGiftStack, type MobileInviteAcceptResult, type MobileTask, type MobileTaskView } from './mobile-api';
import { mobileInviteUrl } from './mobile-invite-links';
import { currentPath, navigate } from './navigation';
import { claimMobileShareReward, pendingShareRewardId } from './mobile-share-reward';
import { MobileArt } from './mobile-icons';
import { TaskArt, giftArtKind } from './mobile-task-icons';
import { useMobilePlayer } from './mobile-state';
import { MobileLoading, MobileNotice, MobileSheet } from './mobile-shared';
import './mobile-tasks.css';

type PendingOpen={kind:MobileGiftKind;quantity:number;requestId:string};
function pendingKey(){return 'jigsaw:mobile-pending-gift:'+h5Config().apiBase;}
function readPendingOpen():PendingOpen|null{try{const p=JSON.parse(sessionStorage.getItem(pendingKey())||'null');return p&&/^(ten-(5|6|7)|cooperation-(10|30|60)|friend-(10|30)|invite-(friend|refill))$/.test(p.kind)&&Number.isInteger(p.quantity)&&p.quantity>=1&&p.quantity<=20&&(p.kind!=='invite-refill'||p.quantity===1)&&/^[a-f0-9]{32}$/.test(p.requestId)?p:null;}catch{return null;}}
function savePendingOpen(p:PendingOpen|null){try{if(p)sessionStorage.setItem(pendingKey(),JSON.stringify(p));else sessionStorage.removeItem(pendingKey());}catch{}}
function errorMessage(error:unknown){return error instanceof Error?error.message:'连接暂时中断，请重试';}
function progress(value:number,total:number){return Math.min(100,Math.max(0,value/Math.max(1,total)*100))+'%';}
function xpRewardText(min:number,max=min){return max>0?' · 经验 +'+min+(min===max?'':'～'+max):'';}
function coinRewardText(min=0,max=min){return max>0?' · 金币 +'+min+(min===max?'':'～'+max):'';}
function rewardText(energyMin:number,energyMax:number,xp:number,xpMax=xp,coins=0,coinsMax=coins){return '体力 +'+energyMin+(energyMin===energyMax?'':'～'+energyMax)+xpRewardText(xp,xpMax)+coinRewardText(coins,coinsMax);}

function TaskRow({task,onAction,busy=false,detail}:{task:MobileTask;onAction?:()=>void;busy?:boolean;detail?:string}){
 const sharing=task.group==='sharing',invitation=task.group==='invitation',title=sharing?'分享邀请':invitation?'好友加入':task.group==='friend'?'好友默契':'一起拼图';
 const description=detail??(sharing?'分享成功，奖励即到账':invitation?'好友完成3次有效拼合':'完成'+task.target+'次'+(task.group==='friend'?'好友':'协作')+'拼合');
 return <article className={'mobile-task-card task-'+task.kind+(task.earned?' is-earned':'')}>
  <MobileArt kind="frameLeaf" className="mobile-task-corner is-first"/><MobileArt kind="frameLeaf" className="mobile-task-corner is-last"/><MobileArt kind="frameLeaf" className="mobile-task-corner is-bottom-first"/><MobileArt kind="frameLeaf" className="mobile-task-corner is-bottom-last"/>
  <span className="mobile-task-card-art"><TaskArt kind={sharing?'invitation':invitation||task.group==='friend'?'friend-10':'cooperation-10'}/></span>
  <div className="mobile-task-card-copy"><h4>{title}{(sharing||invitation)&&<small>每日{task.target}{sharing?'次':'位'}</small>}</h4><p className="mobile-task-description">{description}</p><div className="mobile-task-progress-line"><span className="mobile-task-meter" role="progressbar" aria-label={task.title} aria-valuenow={Math.min(task.progress,task.target)} aria-valuemin={0} aria-valuemax={task.target}><i style={{width:progress(task.progress,task.target)}}/></span><span>{Math.min(task.progress,task.target)}/{task.target}{invitation?'人':''}</span></div></div>
  <div className="mobile-task-card-reward">{task.effect==='full-energy'?<span className="mobile-task-refill-reward"><MobileArt kind="refillGift"/><span>补满体力包<br/>×1{task.xp>0&&<> · 经验 +{task.xp}</>}{(task.coins??0)>0&&<><br/>金币 +{task.coins}</>}</span></span>:<span className="mobile-task-reward-values"><span><MobileArt kind="lightning"/><b>+{task.energy}</b></span>{task.xp>0&&<span><MobileArt kind="xpStar" className="mobile-task-xp-star"/><b>+{task.xp}</b></span>}{(task.coins??0)>0&&<span><MobileArt kind="coin"/><b>+{task.coins}</b></span>}</span>}
   <button type="button" className={'mobile-task-state'+(task.earned?' is-earned':'')} disabled={busy||!onAction} onClick={onAction}>{sharing?(task.earned?'再次分享':'去邀请'):invitation?'邀请好友':task.earned?<><Check size={13}/>已存入</>:'进行中'}{(sharing||invitation)&&<span aria-hidden="true">›</span>}</button>
  </div>
 </article>;
}

function GiftRow({gift,busy,energyFull,onOpen,compact=false}:{gift:MobileGiftStack;busy:boolean;energyFull:boolean;onOpen:(kind:MobileGiftKind,quantity:number)=>void;compact?:boolean}){
 const refill=gift.effect==='full-energy'||gift.kind==='invite-refill', [quantity,setQuantity]=useState(1),max=Math.min(20,gift.count),chosen=refill||compact?1:Math.min(max,quantity),field=useId();
 return <article className={'mobile-gift-card gift-'+gift.kind+(refill?' is-refill':'')}>
  <span className="mobile-gift-card-art"><TaskArt kind={giftArtKind(gift.kind)}/></span><div className="mobile-gift-card-copy"><h3>{gift.title} <span>×{gift.count}</span></h3><p>{refill?'恢复至当前体力上限'+xpRewardText(gift.xpMin??gift.xp,gift.xpMax??gift.xp)+coinRewardText(gift.coinsMin??gift.coins??0,gift.coinsMax??gift.coins??0):rewardText(gift.energyMin*chosen,gift.energyMax*chosen,(gift.xpMin??gift.xp)*chosen,(gift.xpMax??gift.xp)*chosen,(gift.coinsMin??gift.coins??0)*chosen,(gift.coinsMax??gift.coins??0)*chosen)}</p>{refill&&<small className="mobile-gift-preserve-note">留到缺体力时再用</small>}{!refill&&!compact&&gift.count>1&&<label className="mobile-gift-quantity" htmlFor={field}>开启数量<select id={field} value={chosen} disabled={busy} onChange={event=>setQuantity(Number(event.target.value))}>{Array.from({length:max},(_,i)=><option key={i+1} value={i+1}>{i+1} 份</option>)}</select></label>}</div>
  <button type="button" className="mobile-gift-open" disabled={busy||(refill&&energyFull)} onClick={()=>onOpen(gift.kind,chosen)} aria-label={refill?(energyFull?'体力已满，保留补满体力包':'使用1份补满体力包'):'开启'+chosen+'份'+gift.title}>{refill?(energyFull?'体力已满':'使用1份'):'开启'+chosen+'份'}</button>
 </article>;
}

export function MobileTasksSheet({onClose,initialTab='tasks'}:{onClose:()=>void;initialTab?:'tasks'|'gifts'}){
 const {profile}=useMobilePlayer(),[tab,setTab]=useState<'tasks'|'gifts'>(initialTab),[view,setView]=useState<MobileTaskView|null>(null),[loading,setLoading]=useState(true),[error,setError]=useState(''),[busy,setBusy]=useState(false),[notice,setNotice]=useState(''),[receipt,setReceipt]=useState<MobileGiftReceipt|null>(null),[pending,setPending]=useState<PendingOpen|null>(readPendingOpen),[inviteCode,setInviteCode]=useState(''),[acceptCode,setAcceptCode]=useState<string|null>(null),[showInviteInput,setShowInviteInput]=useState(false),[shareBusy,setShareBusy]=useState(false),[sharePending,setSharePending]=useState<string|null>(pendingShareRewardId),[shareError,setShareError]=useState('');
 const alive=useRef(true),locking=useRef(false),pendingRef=useRef<PendingOpen|null>(pending),latest=useRef(0),tabsId=useId(),shareLock=useRef(false),sharePendingRef=useRef<string|null>(sharePending);
 useEffect(()=>{const sync=()=>{const id=pendingShareRewardId();sharePendingRef.current=id;setSharePending(id);};window.addEventListener('mobile:share-pending',sync);return()=>window.removeEventListener('mobile:share-pending',sync);},[]);
 const apply=useCallback((next:MobileTaskView)=>{if(!alive.current||next.serverTime<latest.current)return;latest.current=next.serverTime;setView(next);},[]);
 const refresh=useCallback(async()=>{try{const next=await mobileJson<MobileTaskView>('/api/mobile/tasks');apply(next);if(alive.current)setError('');}catch(e){if(alive.current)setError(errorMessage(e));}finally{if(alive.current)setLoading(false);}},[apply]);
 useEffect(()=>{alive.current=true;void refresh();const timer=window.setInterval(()=>{if(!document.hidden&&!locking.current)void refresh();},15000);return()=>{alive.current=false;clearInterval(timer);};},[refresh]);
 useEffect(()=>{if(!locking.current)void refresh();},[profile?.giftCount,profile?.giftProgress,refresh]);
 function setOpenPending(value:PendingOpen|null){pendingRef.current=value;savePendingOpen(value);if(alive.current)setPending(value);}
 async function openGift(kind:MobileGiftKind,quantity:number){
  if(locking.current)return;
  if(!pendingRef.current&&kind==='invite-refill'&&profile&&profile.energy>=profile.energyCap){setError('体力已满，补满体力包已为你保留');return;}
  locking.current=true;setBusy(true);setError('');setReceipt(null);
  const operation=pendingRef.current??{kind,quantity,requestId:requestId()};setOpenPending(operation);
  try{const result=await mobilePost<MobileGiftOpenResult>('/api/mobile/gifts/open',operation);setOpenPending(null);apply(result);if(alive.current){setReceipt(result.opened);setTab('gifts');}await refresh();}
  catch(e){const status=(e as {status?:number}).status;if(status&&status>=400&&status<500&&status!==408&&status!==429)setOpenPending(null);if(alive.current)setError(errorMessage(e));}
  finally{locking.current=false;if(alive.current)setBusy(false);}
 }
 function setShareOperation(id:string|null){sharePendingRef.current=id;if(alive.current)setSharePending(id);}
 async function claimShare(){
  const operation=claimMobileShareReward();setShareOperation(pendingShareRewardId());
  const result=await operation;
  setShareOperation(pendingShareRewardId());apply(result);if(alive.current){setNotice(result.shared.alreadyRewarded?'今日分享奖励已领满，好友仍可通过链接加入':'分享奖励到账：体力 +'+result.shared.energy+' · 经验 +'+result.shared.xp+coinRewardText(result.shared.coins??0));setShareError('');}await refresh();
 }
 async function retryShare(){if(shareLock.current||!sharePendingRef.current)return;shareLock.current=true;setShareBusy(true);setShareError('');try{await claimShare();}catch(e){if(alive.current)setShareError(errorMessage(e));}finally{shareLock.current=false;if(alive.current)setShareBusy(false);}}
 async function copyInvitation(codeOnly=false){
  if(!view||shareLock.current)return;
  if(codeOnly){try{await navigator.clipboard.writeText(view.invitation.code);setNotice('邀请码已复制');}catch{setNotice('请长按邀请码复制');}return;}
  if(sharePendingRef.current){await retryShare();return;}
  shareLock.current=true;setShareBusy(true);setNotice('');setShareError('');
  try{await navigator.clipboard.writeText(mobileInviteUrl(view.invitation.code));await claimShare();}
  catch(e){if(alive.current){if(sharePendingRef.current)setShareError(errorMessage(e));else setNotice('未能自动复制，请长按下方邀请链接复制；本次暂未领取分享奖励');}}
  finally{shareLock.current=false;if(alive.current)setShareBusy(false);}
 }
 async function shareInvitation(){
  if(!view||shareLock.current)return;if(sharePendingRef.current){await retryShare();return;}
  if(!navigator.share){await copyInvitation();return;}
  shareLock.current=true;setShareBusy(true);setNotice('');setShareError('');
  try{await navigator.share({title:'一起拼图',text:'来和我一起拼图，完成任务把体力包攒起来。邀请码：'+view.invitation.code,url:mobileInviteUrl(view.invitation.code)});await claimShare();}
  catch(e){if(alive.current){if(sharePendingRef.current)setShareError(errorMessage(e));else setNotice((e as {name?:string}).name==='AbortError'?'本次分享已取消':'暂时无法打开分享，请使用复制链接');}}
  finally{shareLock.current=false;if(alive.current)setShareBusy(false);}
 }

 const effectiveProfile=profile??view?.profile,count=view?.giftCount??profile?.giftCount??0,invitation=view?.invitation;
 const sharingTask=view?.tasks.find(task=>task.group==='sharing'),invitationTask=view?.tasks.find(task=>task.group==='invitation');
 const cooperationTasks=view?.tasks.filter(task=>task.group==='cooperation')??[],currentCooperation=cooperationTasks.find(task=>!task.earned)??cooperationTasks.at(-1);
 const stored=view?.inventory.filter(gift=>gift.count>0)??[];
 const goSupplies=()=>{const path=currentPath();onClose();navigate('/zh/supplies'+(path.startsWith('/room/')?'?returnTo='+encodeURIComponent(path):''));};
 return <MobileSheet title="任务与礼包" headerArt="gift" onClose={onClose}><div className="mobile-tasks-panel">
  <div className="mobile-task-player-strip" aria-label="玩家状态"><MobileArt kind="avatar"/><div className="mobile-task-player-level"><strong>Lv.{effectiveProfile?.level??'—'}</strong><span className="mobile-task-meter" aria-hidden="true"><i style={{width:effectiveProfile?progress(effectiveProfile.xp,effectiveProfile.xpToNext):'0%'}}/></span><small>{effectiveProfile?effectiveProfile.xp+'/'+effectiveProfile.xpToNext:'— / —'}</small></div><button type="button" className="mobile-task-energy-link" onClick={goSupplies} aria-label="查看体力补给"><MobileArt kind="lightning"/><strong>{effectiveProfile?.energy??'—'}/{effectiveProfile?.energyCap??'—'}</strong><span>+</span></button><button type="button" className="mobile-task-current-link" onClick={()=>setTab('tasks')} aria-label="查看任务"><MobileArt kind="gift"/><span>任务</span></button><button type="button" className="mobile-task-supply-link" onClick={goSupplies}><MobileArt kind="store"/><span>补给站</span></button></div>
  <div className="mobile-task-tabs" role="tablist" aria-label="任务与礼包"><button type="button" role="tab" id={tabsId+'-tasks-tab'} aria-selected={tab==='tasks'} aria-controls={tabsId+'-tasks'} onClick={()=>setTab('tasks')}><MobileArt kind="daily"/>任务</button><button type="button" role="tab" id={tabsId+'-gifts-tab'} aria-selected={tab==='gifts'} aria-controls={tabsId+'-gifts'} onClick={()=>setTab('gifts')}><MobileArt kind="giftFlat"/>我的礼包{count>0&&<span className="mobile-task-count">{count>99?'99+':count}</span>}</button></div>
  {loading&&!view?<MobileLoading text="正在整理任务与礼包…"/>:null}
  {error&&<MobileNotice message={error} onRetry={()=>{if(pendingRef.current)void openGift(pendingRef.current.kind,pendingRef.current.quantity);else void refresh();}}/>}
  {sharePending&&<div className="mobile-gift-pending" role="status"><span>{shareBusy?'正在领取分享奖励…':'分享已完成，奖励待确认，无需重新分享。'}</span>{!shareBusy&&<button type="button" onClick={()=>void retryShare()}>重试领取分享奖励</button>}</div>}
  {shareError&&<MobileNotice message={shareError} onRetry={()=>void retryShare()}/>}
  {pending&&<div className="mobile-gift-pending" role="status"><span>{busy?'正在开启礼包…':'上次开启结果待确认，请重试同一笔领取。'}</span>{!busy&&<button type="button" onClick={()=>void openGift(pending.kind,pending.quantity)}>重试领取</button>}</div>}
  {notice&&<p className="mobile-inline-status" role="status">{notice}</p>}
  {view&&<>
   <section role="tabpanel" id={tabsId+'-tasks'} aria-labelledby={tabsId+'-tasks-tab'} hidden={tab!=='tasks'}>
    <div className="mobile-ten-gift" aria-label={'十格拼合奖励进度'+view.giftProgress+'/10'}><strong>拼合奖励</strong><span className="mobile-ten-slots" role="progressbar" aria-label="十格拼合奖励" aria-valuemin={0} aria-valuemax={10} aria-valuenow={view.giftProgress}>{Array.from({length:10},(_,index)=><i key={index} className={index<view.giftProgress?'is-filled':''}><MobileArt kind="piece"/></i>)}</span><b>{view.giftProgress}/10</b><button type="button" onClick={()=>setTab('gifts')} aria-label="查看已存十格礼包"><MobileArt kind="gift"/></button></div>
    <p className="mobile-task-footnote">每份十格小礼：{rewardText(view.giftMinimum??1,view.giftMaximum,view.giftXp??0,view.giftXp??0,view.giftCoins??0)}</p>
    <div className="mobile-task-list mobile-task-featured">{sharingTask&&<TaskRow task={sharingTask} busy={shareBusy||busy} onAction={()=>void shareInvitation()}/>} {invitationTask&&<TaskRow task={invitationTask} detail={'好友完成'+(invitation?.requiredContributions??3)+'次有效拼合'} busy={shareBusy||busy} onAction={()=>void shareInvitation()}/>} {currentCooperation&&<TaskRow task={currentCooperation} onAction={currentCooperation.earned?()=>setTab('gifts'):undefined}/>}</div>
    <div className="mobile-task-section-title"><MobileArt kind="gift"/><h3>已存礼包</h3><span/><button type="button" onClick={()=>setTab('gifts')}>全部 {count} ›</button></div>
    {stored.length?<div className="mobile-stored-preview" data-kinds={Math.min(stored.length,3)}>{stored.slice(0,3).map(gift=><GiftRow key={gift.kind} gift={gift} compact busy={busy||shareBusy||!!pending} energyFull={!effectiveProfile||effectiveProfile.energy>=effectiveProfile.energyCap} onOpen={(kind,quantity)=>void openGift(kind,quantity)}/>)}</div>:<div className="mobile-stored-empty"><TaskArt kind="ten"/><span>每10次有效拼合，存入一份小礼</span><b>{view.giftProgress}/10</b></div>}
    <details className="mobile-task-details"><summary><UsersRound size={16}/>全部协作任务<span>{view.tasks.filter(task=>(task.group==='cooperation'||task.group==='friend')&&task.earned).length}/{view.tasks.filter(task=>task.group==='cooperation'||task.group==='friend').length}</span></summary><div className="mobile-task-list">{view.tasks.filter(task=>task.group==='cooperation'||task.group==='friend').map(task=><TaskRow key={task.id} task={task} onAction={task.earned?()=>setTab('gifts'):undefined}/>)}</div><p className="mobile-task-footnote">按本人的有效拼合计数；同房伙伴近2分钟需实际参与。好友协作需通过邀请建立关系。任务每天零点（北京时间）刷新，礼包一直保留。</p></details>
    <details className="mobile-task-details mobile-invitation-details"><summary><Share2 size={16}/>邀请详情与邀请码</summary><div className="mobile-invite-card">
     <div className="mobile-invite-stats"><span>已加入 <b>{invitation?.joinedCount??0}</b></span><span>已达成 <b>{invitation?.qualifiedCount??0}</b></span><span>今日体力包 <b>{invitation?.todayRewarded??0}/{invitation?.dailyLimit??3}</b></span></div>
     <div className="mobile-invite-actions"><button type="button" className="mobile-button mobile-green" disabled={shareBusy||busy} onClick={()=>void shareInvitation()}><Share2 size={16}/>邀请好友</button><button type="button" className="mobile-small-button" disabled={shareBusy||busy} onClick={()=>void copyInvitation()}><Copy size={15}/>复制链接</button></div>
     <label className="mobile-invite-copy">我的邀请码<button type="button" onClick={()=>void copyInvitation(true)}>{invitation?.code}<Copy size={13}/></button></label>
     <label className="mobile-invite-link">邀请链接<input readOnly value={invitation?mobileInviteUrl(invitation.code):''} onFocus={event=>event.currentTarget.select()} aria-label="邀请链接"/></label>
     <p className="mobile-task-footnote">成功分享或复制完整链接即领奖，每日{invitation?.shareDailyLimit??3}次。好友首次接受邀请后完成{invitation?.requiredContributions??3}次有效拼合，另发补满体力包{xpRewardText(invitationTask?.xp??0)}{coinRewardText(invitationTask?.coins??0)}，每日最多{invitation?.dailyLimit??3}位，超出不顺延。</p>
     <button type="button" className="mobile-invite-input-toggle" onClick={()=>setShowInviteInput(!showInviteInput)}>{invitation?.bound?'已接受 '+(invitation.boundToName||'好友')+' 的邀请':'有好友的邀请码？'}</button>
     {showInviteInput&&<form className="mobile-invite-input-form" onSubmit={event=>{event.preventDefault();setAcceptCode(inviteCode.trim().toLowerCase());}}><label>好友邀请码<input value={inviteCode} onChange={event=>setInviteCode(event.target.value)} maxLength={12} autoCapitalize="none" autoCorrect="off" placeholder="输入12位邀请码"/></label><button type="submit" className="mobile-small-button" disabled={!/^[a-f0-9]{12}$/i.test(inviteCode.trim())}>查看邀请</button></form>}
    </div></details>
   </section>
   <section role="tabpanel" id={tabsId+'-gifts'} aria-labelledby={tabsId+'-gifts-tab'} hidden={tab!=='gifts'}>
    <div className="mobile-task-section-title"><MobileArt kind="gift"/><h3>存下的小确幸</h3><span/></div><p className="mobile-gift-subtitle">礼包可积累，需要时再开启</p>
    {(effectiveProfile?.energy??1)===0&&count>0&&<p className="mobile-gift-low-energy" role="status">体力用完啦，开启一份礼包继续拼图。</p>}
    {stored.length?<div className="mobile-gift-list">{stored.map(gift=><GiftRow key={gift.kind} gift={gift} busy={busy||shareBusy||!!pending} energyFull={!effectiveProfile||effectiveProfile.energy>=effectiveProfile.energyCap} onOpen={(kind,quantity)=>void openGift(kind,quantity)}/>)}</div>:<div className="mobile-task-empty"><TaskArt kind="task-book"/><h3>礼包正在路上</h3><p>完成拼合与伙伴任务，礼包会自动存到这里。</p><button type="button" className="mobile-small-button" onClick={()=>setTab('tasks')}>查看任务</button></div>}
    {receipt&&<div className="mobile-gift-receipt" role="status"><TaskArt kind={giftArtKind(receipt.kind)}/><div><strong>{receipt.effect==='full-energy'?'体力已补满':'已开启 '+receipt.quantity+' 份'}</strong><p>体力 +{receipt.energy}{receipt.xp>0?' · 经验 +'+receipt.xp:''}{coinRewardText(receipt.coins??0)}</p>{receipt.levels>0&&<small>已升级，等级与奖励已到账</small>}</div></div>}
    <p className="mobile-task-footnote">定额礼包可批量开启，体力可超过上限。补满体力包一次使用1份，体力已满时自动保留。</p>
    <button type="button" className="mobile-button mobile-green mobile-task-back" onClick={onClose}>继续拼图</button>
   </section>
  </>}
 </div>{acceptCode&&<MobileInvitationSheet key={acceptCode} code={acceptCode} reward={invitationTask} onClose={()=>{setAcceptCode(null);void refresh();}}/>}</MobileSheet>;
}

export function MobileInvitationSheet({code,onClose,reward}:{code:string;onClose:()=>void;reward?:MobileTask}){
 const normalized=code.trim().toLowerCase(),valid=/^[a-f0-9]{12}$/.test(normalized),[busy,setBusy]=useState(false),[error,setError]=useState(''),[result,setResult]=useState<MobileInviteAcceptResult|null>(null),lock=useRef(false),operation=useRef<{code:string;requestId:string}|null>(null);
 async function accept(){if(lock.current||!valid)return;lock.current=true;setBusy(true);setError('');if(!operation.current){const storageKey='jigsaw:mobile-pending-invitation:'+h5Config().apiBase+':'+normalized;let id='';try{id=sessionStorage.getItem(storageKey)||'';}catch{}if(!/^[a-f0-9]{32}$/.test(id))id=requestId();operation.current={code:normalized,requestId:id};try{sessionStorage.setItem(storageKey,id);}catch{}}try{const response=await mobilePost<MobileInviteAcceptResult>('/api/mobile/invitations/accept',operation.current);setResult(response);try{sessionStorage.removeItem('jigsaw:mobile-pending-invitation:'+h5Config().apiBase+':'+normalized);}catch{}void mobileJson('/api/mobile/profile').catch(()=>{});}catch(e){setError(errorMessage(e));}finally{lock.current=false;setBusy(false);}}
 const currentReward=result?.tasks.find(task=>task.group==='invitation')??reward,rewardCopy=xpRewardText(currentReward?.xp??0)+coinRewardText(currentReward?.coins??0);
 return <MobileSheet title="好友邀请" onClose={onClose}><div className="mobile-friend-invitation"><span className="mobile-friend-invitation-art"><TaskArt kind="invitation"/><TaskArt kind="refill"/></span>{result?<><h3>{result.accepted.alreadyBound?'你们已经是拼图伙伴啦':'邀请已接受'}</h3><p>和{result.accepted.inviterName}一起拼，完成任务积累礼包。</p><p className="mobile-muted">接受邀请后完成{result.invitation.requiredContributions}次有效拼合，邀请者可获得1份补满体力包{rewardCopy}，每天最多奖励{result.invitation.dailyLimit}位，超出不补发。再一起进入同一房间，参与每日好友协作。</p><button type="button" className="mobile-button mobile-green" onClick={onClose}>开始拼图</button></>:<><h3>一起拼图，慢慢攒礼包</h3><p>好友邀请码 <strong>{normalized}</strong></p><p className="mobile-muted">接受后与邀请者建立协作关系。每位玩家只能首次绑定一位邀请者；完成3次有效拼合后，邀请者可获得1份补满体力包{rewardCopy}，每天最多奖励{reward?.target??3}位，超出部分不补发。</p><p className="mobile-muted">已加入过游戏也可以接受首次邀请。双方在同一房间实际拼合，还能完成每日好友协作任务。</p>{(!valid||error)&&<MobileNotice message={!valid?'邀请码不完整，请向好友重新获取':error}/>}<button type="button" className="mobile-button mobile-green" disabled={busy||!valid} onClick={()=>void accept()}>{busy?'正在接受…':'接受邀请'}</button><button type="button" className="mobile-return-link" onClick={onClose}>稍后再说，先去拼图</button></>}</div></MobileSheet>;
}
