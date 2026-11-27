import DisplayControls from './display-controls';
import { useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { useMobilePlayer } from './mobile-state';
import { MobileArt } from './mobile-icons';
import { currentPath, navigate } from './navigation';
import { MobileLoading, MobileNotice, MobileSheet } from './mobile-shared';
import { MobileTasksSheet } from './mobile-tasks';
import {contributionCopy} from '../mobile/economy-copy';
import { tapTapAvailable } from './taptap-account';

export function levelStyle(level:number){return level>=1000?'stellar':level>=500?'obsidian':level>=300?'rainbow':level>=180?'starlight':level>=120?'gold':level>=80?'silver':level>=50?'rose':level>=30?'amber':level>=20?'purple':level>=10?'blue':level>=5?'green':'gray';}

export function MobileStatus({compact=false,game=false}:{compact?:boolean;game?:boolean}) {
 const {profile,loading,error,refresh}=useMobilePlayer();
 const [settings,setSettings]=useState(false),[gift,setGift]=useState(false);
 return <>
  <div className={'mobile-player-bar'+(compact?' is-compact':'')} aria-label="玩家状态">
   {!game&&<MobileArt kind="sprig" className="mobile-status-sprig"/>}
   <button className="mobile-player" type="button" onClick={()=>setSettings(true)} aria-label={profile?`${profile.name}，等级${profile.level}，打开设置`:'打开玩家设置'}>
    <span className="mobile-avatar" aria-hidden="true"><MobileArt kind="avatar"/></span><span className="mobile-level-info"><strong className={'mobile-level level-'+levelStyle(profile?.level??0)}>Lv.{profile?.level??'—'}</strong><span className="mobile-xp-meter" aria-label={profile?`升级经验${profile.xp}/${profile.xpToNext}`:'经验加载中'}><i style={{width:profile?Math.min(100,Math.max(0,profile.xp/profile.xpToNext*100))+'%':'0%'}}/></span><small className="mobile-xp-copy">{profile?profile.xp+' / '+profile.xpToNext:'— / —'}</small></span>
   </button>
   <button className="mobile-energy-status" type="button" onClick={()=>navigate('/zh/supplies'+(currentPath().startsWith('/room/')?'?returnTo='+encodeURIComponent(currentPath()):''))} aria-label={profile?(profile.unlimitedEnergyToday?'今日无限体力，打开补给站':`体力${profile.energy}，上限${profile.energyCap}，打开补给站`):'打开补给站'}><MobileArt kind="lightning"/><span className={game?'mobile-game-energy-copy':undefined}><span>{profile?(profile.unlimitedEnergyToday?<b>今日无限</b>:<><b>{profile.energy}</b><small>/{profile.energyCap}</small></>):'—/—'}</span>{game&&<span className="mobile-energy-meter" aria-hidden="true"><i style={{width:profile?(profile.unlimitedEnergyToday?'100%':Math.min(100,Math.max(0,profile.energy/Math.max(1,profile.energyCap)*100))+'%'):'0%'}}/></span>}</span>{!profile?.unlimitedEnergyToday&&<span className="mobile-energy-plus" aria-hidden="true">+</span>}</button>
   {!game&&<button type="button" className="mobile-gift-status mobile-task-entry" onClick={()=>setGift(true)} aria-label={`任务与礼包，${profile?.giftCount??0}份未开启`}><MobileArt kind="gift"/><span className="mobile-task-entry-label">任务</span>{(profile?.giftCount??0)>0&&<span className="mobile-task-entry-badge">{(profile?.giftCount??0)>99?'99+':profile?.giftCount}</span>}</button>}
   {!compact&&<button type="button" className="mobile-store-entry" onClick={()=>navigate('/zh/supplies'+(currentPath().startsWith('/room/')?'?returnTo='+encodeURIComponent(currentPath()):''))}><MobileArt kind="store"/><span>补给站</span></button>}
  </div>
  {game&&<button type="button" className="mobile-gift-float mobile-task-entry" onClick={()=>setGift(true)} aria-label={`任务与礼包，${profile?.giftCount??0}份未开启`}><MobileArt kind="gift"/><span className="mobile-task-entry-label">任务 <span className="mobile-ten-progress">{profile?.giftProgress??0}/10</span></span>{(profile?.giftCount??0)>0&&<span className="mobile-task-entry-badge">{(profile?.giftCount??0)>99?'99+':profile?.giftCount}</span>}</button>}
  {!profile&&loading&&<span className="mobile-status-loading" role="status">正在连接玩家数据…</span>}
  {!profile&&error&&<MobileNotice message={error} onRetry={()=>void refresh().catch(()=>{})}/>}
  {settings&&<MobileSettings onClose={()=>setSettings(false)}/>}
  {gift&&<MobileTasksSheet onClose={()=>setGift(false)} initialTab={(profile?.energy??1)===0&&(profile?.giftCount??0)>0?'gifts':'tasks'}/>}
 </>;
}

export function MobileSettings({onClose}:{onClose:()=>void}) {
 const {profile,loading,busy,error,saveSettings,refresh,bindTapTap}=useMobilePlayer();
 const [name,setName]=useState(profile?.name??''),[notice,setNotice]=useState(''),[binding,setBinding]=useState(false),[showHelp,setShowHelp]=useState<'help'|'privacy'|null>(null);
 async function saveName(){setNotice('');try{await saveSettings({name:name.trim()});setNotice('昵称已保存');}catch(e){setNotice(e instanceof Error?e.message:'暂时无法保存');}}
 async function bind(){setNotice('');setBinding(true);try{const next=await bindTapTap(true);if(next)setNotice('TapTap账号已绑定，进度与资源已同步');else setNotice('当前环境不支持TapTap登录');}catch(e){setNotice(e instanceof Error?e.message:'TapTap账号绑定失败');}finally{setBinding(false);}}
 return <MobileSheet title="玩家与设置" onClose={onClose}>
  {!profile?loading?<MobileLoading/>:<MobileNotice message={error||'玩家数据暂不可用'} onRetry={()=>void refresh().catch(()=>{})}/>:<>
   <div className="mobile-profile-summary"><span className="mobile-avatar"><MobileArt kind="avatar"/></span><span className={'mobile-level level-'+levelStyle(profile.level)}>Lv.{profile.level}</span><div><strong>{profile.name}</strong><span>升级经验 {profile.xp} / {profile.xpToNext}</span></div></div>
   <div className="mobile-taptap-account"><div><strong>{profile.taptap?.bound?'TapTap账号已绑定':'绑定TapTap账号'}</strong><small>{profile.taptap?.bound?(profile.taptap.nickname?`昵称：${profile.taptap.nickname} · 进度、金币、碎片和装饰已同步`:'进度、金币、碎片和装饰已同步'):'换设备后可恢复进度、金币、碎片、装饰、任务和房间'}</small></div><button type="button" className="mobile-button mobile-secondary" disabled={binding||busy||!tapTapAvailable()} onClick={()=>void bind()}>{binding?'绑定中…':profile.taptap?.bound?'刷新TapTap昵称':'绑定账号'}</button></div>
   <label className="mobile-field">昵称<input maxLength={16} value={name} onChange={e=>setName(e.target.value)} autoComplete="off" placeholder="一起拼图的人"/></label><button type="button" className="mobile-button mobile-secondary" disabled={busy||!name.trim()||name.trim()===profile.name} onClick={()=>void saveName()}>保存昵称</button>
   <label className="mobile-setting-toggle"><span><strong>耗尽时自动开启礼包与补给</strong><small>默认开启，优先开启任务礼包与十格小礼，再用库存补满体力包，不会自动播放广告</small></span><input type="checkbox" checked={profile.autoSupply} disabled={busy} onChange={e=>{setNotice('');void saveSettings({autoSupply:e.target.checked}).catch(error=>setNotice(error instanceof Error?error.message:'暂时无法保存'));}}/></label>
   {notice&&<p role="status" className="mobile-inline-status">{notice}</p>}
   <button type="button" className="mobile-setting-link" onClick={()=>{onClose();navigate('/zh/gallery?manage=1');}}><span>我的房间</span><span>{profile.ownedRooms.length}/3 <ChevronRight size={17}/></span></button>
   <DisplayControls/>
   <button type="button" className="mobile-setting-link" onClick={()=>setShowHelp(showHelp==='help'?null:'help')}><span>玩法帮助</span><ChevronRight size={17}/></button>
   <button type="button" className="mobile-setting-link" onClick={()=>setShowHelp(showHelp==='privacy'?null:'privacy')}><span>隐私说明</span><ChevronRight size={17}/></button>
   {showHelp==='help'&&<div className="mobile-policy"><p>拖动拼块，靠近正确位置松开即可拼合。双指缩放和平移，一键“适配”找回完整桌面。</p><p>{contributionCopy(profile)}</p><p>任务入口可查看伙伴任务与礼包。礼包可积累，定额礼包开启后增加体力和经验；补满体力包在体力不足时单份使用，体力已满会保留。任务礼包不占广告补给库存。</p><p>分享邀请可获得奖励，具体数值和每日次数可在任务入口查看。好友首次接受邀请并完成3次有效拼合，邀请者获得补满体力包，每天最多奖励3位。与通过邀请关联的好友同房实际拼合，还可完成好友协作任务。</p><p>随机公开房免费创建，已购图包也可免费创建公开房；其他指定图片或私人房使用1张建房券。同时最多保留3个未结束的自建房间。</p><p>广告由你主动选择，完整观看后获得所选奖励。体力包与建房券各可保存3份，不会自动播放下一条。</p></div>}
   {showHelp==='privacy'&&<div className="mobile-policy"><p>本手机版的玩家身份、房间、聊天、等级和库存独立保存，不与PC网站共享房间。</p><p>服务器保存必要的玩家凭证、昵称、拼图进度、有效贡献、邀请关联、任务进度、奖励及库存流水。昵称与等级可向同房玩家显示，请勿填写个人隐私。</p><p>当前使用本机保存的玩家凭证。清除浏览器数据或换设备可能无法找回原游客身份和库存，请保留当前客户端数据。</p><p>广告由TapTap提供，仅在你主动领取时播放。我们记录一次性领奖请求以避免重复发放。</p><a href="https://www.taptap.cn/doc/privacy-policy" target="_blank" rel="noopener noreferrer">TapTap隐私政策 <ChevronRight size={15}/></a></div>}
  </>}
 </MobileSheet>;
}
