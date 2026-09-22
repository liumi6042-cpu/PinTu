'use client';
import { Crown,Users,LockKeyhole,Settings2,Check,ArrowRight,ImagePlus } from 'lucide-react';
import CommunityShell from '../community-shell';
import { useLanguage } from '../language-switch';
import { t } from '@/lib/i18n';
import { MEMBER_ROOM_LIMIT,ROOM_PLAYER_LIMIT } from '@/lib/membership-policy';
const comparisons=[
  ['单人拼图与完整图库','免费开放','继续享有'],['加入公开大厅和朋友的房间','免费开放','继续享有'],['基础成就与纪念册','免费开放','继续享有'],['创建公开房间','免费开放','继续享有'],
  ['创建私人邀请房间','需会员，朋友免费加入','同时进行 3 个私人房间'],['每桌人数','最多 8 人','最多 8 人'],
  ['上传自己的图片制作拼图','登录免费，最多保存 10 张','可额外创建私人房间一起拼'],
  ['自建房间管理','已有自建房间仍可管理','命名、可见范围和新玩家加入设置'],
];
export default function MembershipBenefits(){useLanguage();return <CommunityShell active="membership"><main className="community-main membership-page">
  <div className="membership-heading"><p className="section-kicker">A TABLE FOR YOUR PEOPLE</p><h1>{t('留一张桌，等朋友来。')}</h1><p>{t('自己选图、安排房间，邀请熟悉的人一起慢慢拼。')}</p></div>
  <div className="membership-intro"><section className="membership-offer"><span className="membership-seal"><Crown size={32} strokeWidth={1.4}/></span><p className="section-kicker">TOGETHER MEMBERSHIP</p><h2>{t('拼图会员')}</h2><p>{t('一份会员，为你和朋友准备自己的拼图桌。')}</p><div className="membership-capacity"><span><strong>{MEMBER_ROOM_LIMIT}</strong>{t('个同时进行的私人房间')}</span><span><strong>{ROOM_PLAYER_LIMIT}</strong>{t('人一起拼一桌')}</span></div><div className="membership-pending">{t('订阅即将开放')}<small>{t('价格与支付方式将在开放时公布，当前不会收费。')}</small></div><a className="primary" href="/membership/manage">{t('查看我的会员与房间')}<ArrowRight size={17}/></a><a className="text-button" href="/lobby">{t('先去公开大厅一起玩')}</a></section>
  <section className="membership-features"><article><ImagePlus size={23}/><div><h3>{t("把自己的照片做成拼图")}</h3><p>{t("所有账号均可免费上传图片，选择 108–2000 片独自拼图。会员可用自己的图片创建私人房间，邀请朋友一起拼。")}</p><a className="text-button" href="/personal/images">{t("查看我的图片")}<ArrowRight size={15}/></a></div></article><article><LockKeyhole size={23}/><div><h3>{t('只邀请你想见的人')}</h3><p>{t('创建私人房间，通过链接邀请朋友；也可以把房间公开到大厅。')}</p></div></article><article><Settings2 size={23}/><div><h3>{t('把房间安排好')}</h3><p>{t('给房间起名字，随时调整可见范围，暂停接待新玩家。已入座的朋友仍可回来。')}</p></div></article><article><Users size={23}/><div><h3>{t('朋友免费入座')}</h3><p>{t('只有创建私人房间需要会员；公开房间免费创建，朋友加入也免费。')}</p></div></article><div className="membership-future"><span>{t('后续计划')}</span><p>{t('专属头像框、桌布与纪念册外观将另行公布，暂不计入当前权益。')}</p></div></section></div>
  <section className="membership-comparison"><h2>{t('免费游玩与会员权益')}</h2><div className="membership-table-scroll"><table><thead><tr><th scope="col">{t('功能')}</th><th scope="col">{t('免费游玩')}</th><th scope="col">{t('拼图会员')}</th></tr></thead><tbody>{comparisons.map(([feature,free,member])=><tr key={feature}><th scope="row">{t(feature)}</th><td>{t(free)}</td><td><Check size={14}/>{t(member)}</td></tr>)}</tbody></table></div></section>
  <MembershipRules/><div className="membership-bottom"><a href="/gallery">{t('去图库选一张')}<ArrowRight size={16}/></a><a href="/membership/manage">{t('我的会员')}<ArrowRight size={16}/></a></div>
 </main></CommunityShell>;}
export function MembershipRules(){return <section className="membership-rules"><h2>{t('到期后，拼图也会等你。')}</h2><div><p><strong>{t('暂停新建，保留已有房间')}</strong>{t('会员到期后不能新建私人房间；已有房间继续游玩和管理，公开房间仍可免费创建。')} {t('上传自己的图片和独自拼图始终向普通账号免费开放。')}</p><p><strong>{t('进度沿用原保存规则')}</strong>{t('私人及单人房间沿用 30 天规则；公开房间从创建起在大厅展示 24 小时（500 片及以上 36 小时），中途继续拼不会延长。')}</p><p><strong>{t('收藏与成就继续保留')}</strong>{t('会员到期不删除成就记录。房间过期后的完成纪念保留在纪念册中，本机记录仍保存在原浏览器。')}</p><p><strong>{t('续费规则清楚说明')}</strong>{t('当前没有自动续费或扣款。未来如开放自动续费，取消后可继续使用到本期结束。')}</p></div></section>;}
