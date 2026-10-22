'use client';
import { t } from '@/lib/i18n';
import { useLanguage } from '@/app/language-switch';

import { useEffect, useRef, useState } from 'react';
import { Users, Copy, Check } from 'lucide-react';
import { Input } from '@/components/ui/input';
import type { RoomClient } from '@/lib/room-client';
import { mobileLevelStyle, MobileDecoration, type MobileDecorationValue } from './room-cursors';
import { MobileArt } from '../h5/mobile-icons';
import { mobileInviteUrl } from '../h5/mobile-invite-links';
import { mobileJson } from '../h5/mobile-api';
import { claimMobileShareReward, pendingShareRewardId } from '../h5/mobile-share-reward';
import { useRoomConnection } from '@/lib/use-room-connection';
export default function RoomToolbar({ client, mobile = false }: {
    client: RoomClient; mobile?: boolean;
}) {
    useLanguage();
    const [, refresh] = useState(0), [copied, setCopied] = useState(false), [copyError, setCopyError] = useState(false), connection = useRoomConnection();
    const inviteCode = (client.ticket as typeof client.ticket & {inviteCode?:string}).inviteCode ?? (client.snapshot as typeof client.snapshot & {inviteCode?:string}).inviteCode;
    const mayInvite = !mobile || client.snapshot.visibility !== 'private' || !!inviteCode;
    const [mobileInvite, setMobileInvite] = useState(''), [preparing, setPreparing] = useState(false), [inviteError, setInviteError] = useState('');
    const invite = mobile ? mobileInvite : connection.inviteOrigin ? connection.inviteOrigin + '/room/' + client.snapshot.id : '';
    const [shareError,setShareError]=useState(''),[shareNotice,setShareNotice]=useState(''),[claiming,setClaiming]=useState(false),[pendingShare,setPendingShare]=useState(()=>mobile&&!!pendingShareRewardId());
    const inviteInput = useRef<HTMLInputElement>(null);
    useEffect(()=>{
      if(!mobile)return;
      const update=()=>setPendingShare(!!pendingShareRewardId());
      window.addEventListener('mobile:share-pending',update);
      return()=>window.removeEventListener('mobile:share-pending',update);
    },[mobile]);
    async function rewardShare(){
      setClaiming(true);setShareError('');setShareNotice('');
      try{
        const result=await claimMobileShareReward();
        setShareNotice(result.shared.alreadyRewarded?'今日分享奖励已领满，好友仍可加入':'分享奖励到账：体力 +'+result.shared.energy+' · 经验 +'+result.shared.xp);
      }catch(error){setShareError(error instanceof Error?error.message:'分享奖励暂未到账，请重试');}
      finally{setClaiming(false);setPendingShare(!!pendingShareRewardId());}
    }
    useEffect(() => client.subscribe(() => refresh(n => n + 1)), [client]);
    async function copy() {
      if(preparing||claiming)return;
      if(mobile&&pendingShareRewardId()){await rewardShare();return;}
      let link = invite;
      if (mobile) {
        setPreparing(true); setInviteError(''); setCopyError(false);
        try {
          const result = await mobileJson<{invitation:{code:string}}>('/api/mobile/tasks');
          link = mobileInviteUrl(result.invitation.code, {id:client.snapshot.id,inviteCode});
          setMobileInvite(link);
        } catch (error) { setInviteError(error instanceof Error ? error.message : '邀请暂不可用，请重试'); return; }
        finally { setPreparing(false); }
      }
      try {
        await navigator.clipboard.writeText(link);
        setCopied(true);
        setCopyError(false);
        setTimeout(() => setCopied(false), 2000);
    }
    catch {
        setCopyError(true);
        requestAnimationFrame(() => { inviteInput.current?.focus(); inviteInput.current?.select(); });
        return;
    }
    if(mobile)await rewardShare();
    }
    return <section className={mobile ? "room-toolbar mobile-room-toolbar" : "room-toolbar"} aria-label={t("多人房间")}>
        <div className="room-members">
            <span className="room-count"><Users size={17}/>{t(client.snapshot.members.length)} / 8</span>
            {client.snapshot.acceptingNew === false && <span className="room-admission-note">{t("暂停接待新玩家")}</span>}
        </div>
        {mobile && <ul className="mobile-room-member-list">{client.snapshot.members.map(member => {const level = (member as typeof member & {level?:number}).level ?? 0; return <li key={member.id}><span className="mobile-member-art"><MobileArt kind="avatar"/></span><b>{member.name}</b><MobileDecoration value={(member as typeof member & {decoration?:MobileDecorationValue|null}).decoration}/>{member.id === client.ticket.playerId && <small>我</small>}<span className="mobile-level-badge" style={mobileLevelStyle(level)}>Lv.{level}</span></li>;})}</ul>}
        <div className="room-actions">
            <button className="text-button" onClick={copy} disabled={!connection.ready || !mayInvite || preparing || claiming}>
                {copied ? <Check size={15}/> : <Copy size={15}/>}
                <span>{t(claiming ? '领取奖励…' : pendingShare ? '重试分享奖励' : preparing ? '准备邀请…' : copied ? '已复制邀请' : mayInvite ? '邀请朋友' : '仅房主可邀请')}</span>
            </button>
        </div>
        {mobile&&shareNotice&&<p className="mobile-inline-status" role="status">{shareNotice}</p>}
        {mobile&&shareError&&<p className="room-error" role="alert">{shareError}，请点击“重试分享奖励”。</p>}
        {inviteError && <p className="room-error" role="alert">{inviteError}</p>}
        {copyError && <label className="copy-fallback">
            {t('已选中链接，按 Ctrl+C 或长按复制')}
            <Input ref={inviteInput} readOnly value={invite} onFocus={e => e.target.select()}/>
        </label>}
        {(!client.connected || client.message !== '房间已连接') && <p className="room-error" role="status">{t(client.message)}</p>}
    </section>;
}
