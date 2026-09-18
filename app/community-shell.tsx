'use client';
import { t } from '@/lib/i18n';
import { useLanguage } from '@/app/language-switch';

import { Puzzle, Users, UserRound, LogOut, Images, Crown } from 'lucide-react';
import { useState } from 'react';
import { useAccount } from './account-gate';
import LanguageSwitch from './language-switch';
import ServiceFooter from './service-footer';
import BookmarkSite from './bookmark-site';
import { PERSONAL_PLAY_VISIBLE,MEMBERSHIP_VISIBLE } from '@/lib/feature-visibility';
export default function CommunityShell({ active, children }: {
    active: 'lobby' | 'personal' | 'membership';
    children: React.ReactNode;
}) {
    useLanguage();
    const { account, logout } = useAccount(), [busy, setBusy] = useState(false), [error, setError] = useState('');
    return <div className="community"><header className="community-header"><a className="community-brand" href="/"><Puzzle size={28}/><span>{t("一起拼图")}<small>JIGSAW NOOK</small></span></a><nav aria-label={t("主要导航")}>{t([{ key: 'lobby', href: '/lobby', label: '公开大厅', Icon: Users }, { key: 'gallery', href: '/gallery', label: '图库', Icon: Images }, { key: 'personal', href: '/personal', label: PERSONAL_PLAY_VISIBLE?'个人空间':'拼图记录', Icon: UserRound }, { key: 'membership', href: '/membership', label: '会员', Icon: Crown }].filter(item=>item.key!=='membership'||MEMBERSHIP_VISIBLE).map(({ key, href, label, Icon }) => <a key={key} href={href} aria-current={active === key ? 'page' : undefined}><Icon size={18}/>{t(label)}</a>))}</nav><div className="community-tools"><BookmarkSite/><LanguageSwitch />{account ? <div className="account-status"><span className="account-avatar">{account.name.slice(0, 1)}</span><a href="/account/security">{account.name}</a><button aria-label={t("退出登录")} title={t("退出登录")} disabled={busy} onClick={async () => { setBusy(true); try {
        await logout();
    }
    catch (e) {
        setError(e instanceof Error ? e.message : '退出失败');
    }
    finally {
        setBusy(false);
    } }}><LogOut size={18}/></button></div> : <a className="optional-login" href="/account">{t("登录（可选）")}</a>}</div></header>{t(error && <p className="form-error" role="alert">{t(error)}</p>)}{t(children)}<footer className="community-footer"><span>{t("和眼前的人，拼这一刻。")}</span><span>{t("公共图库图片均为本项目原创生成")}</span></footer><ServiceFooter/></div>;
}
