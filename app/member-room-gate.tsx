'use client';
import { Crown, ArrowRight, Users, UserRound } from 'lucide-react';
import { t } from '@/lib/i18n';
import { useLanguage } from './language-switch';
export default function MemberRoomGate(){
  useLanguage();
  return <section className="member-room-gate" aria-labelledby="member-room-heading">
    <span className="member-room-emblem"><Crown size={29}/></span>
    <p className="member-eyebrow">{t('会员专属')}</p><h1 id="member-room-heading">{t('为朋友，留一张拼图桌。')}</h1>
    <p>{t('公开房间人人免费创建；订阅会员后可创建仅凭邀请加入的私人房间。')}</p>
    <div className="membership-coming" role="status">{t('订阅即将开放')}</div>
    <small>{t('当前暂未开放订阅，不会收取费用。')}</small>
    <div className="member-gate-links"><a className="secondary" href="/membership">{t("查看会员权益")}<ArrowRight size={16}/></a><a className="text-button" href="/membership/manage">{t("管理已有房间")}</a></div>
    <div className="member-free-options"><a className="primary" href="/lobby"><Users size={17}/>{t('去公开大厅一起玩')}<ArrowRight size={16}/></a><a className="secondary" href="/personal?mode=solo"><UserRound size={17}/>{t('先独自拼图')}</a></div>
    <p className="member-free-note">{t('创建和加入公开房间、加入朋友的房间，以及个人游玩，都无需会员。')}</p>
  </section>;
}
