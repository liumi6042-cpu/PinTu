'use client';
import { COURTYARD_VISIBLE } from '@/lib/feature-visibility';
import { useAddressCopy } from '@/lib/address-copy';
import { useLanguage } from '@/app/language-switch';
import { usePathname } from 'next/navigation';
import { isChinesePath,zhPath } from '@/lib/site-paths';
// Lobby and gallery have Chinese pages, so on /zh the header keeps the visitor in
// Chinese; personal space and membership have no Chinese copy and stay shared. The
// brand is the way back to the entrance, which otherwise sends a returning visitor
// straight to the tables, so it carries the parameter that asks for the entrance.
const localizedHref = (zh:boolean, path:string) => (zh && (path === '/' || path === '/lobby' || path === '/gallery') ? zhPath(path) : path);
const entranceHref = (zh:boolean) => localizedHref(zh, '/') + '?home=1';

import { Puzzle, Users, UserRound, LogOut, Images, Crown } from 'lucide-react';
import { useState } from 'react';
import { useAccount } from './account-gate';
import LanguageSwitch from './language-switch';
import ServiceFooter from './service-footer';
import BookmarkSite from './bookmark-site';
import { PERSONAL_PLAY_VISIBLE,MEMBERSHIP_VISIBLE } from '@/lib/feature-visibility';
export default function CommunityShell({ active, children }: {
    active: 'lobby' | 'personal' | 'membership' | 'courtyard' | 'wardrobe';
    children: React.ReactNode;
}) {
    useLanguage();
    const copy = useAddressCopy();
    const zh = isChinesePath(usePathname() || '');
    const { account, logout } = useAccount(), [busy, setBusy] = useState(false), [error, setError] = useState('');
    return <div className="community"><header className="community-header"><a className="community-brand" href={entranceHref(zh)}><Puzzle size={28}/><span>{copy("一起拼图")}<small>JIGSAW NOOK</small></span></a><nav aria-label={copy("主要导航")}>{[{ key: 'lobby', href: '/lobby', label: '公开大厅', Icon: Users }, { key: 'courtyard', href: '/courtyard', label: '我的庭院', Icon: Puzzle }, { key: 'gallery', href: '/gallery', label: '图库', Icon: Images }, { key: 'personal', href: '/personal', label: PERSONAL_PLAY_VISIBLE?'个人空间':'拼图记录', Icon: UserRound }, { key: 'membership', href: '/membership', label: '会员', Icon: Crown }].filter(item=>(item.key!=='membership'||MEMBERSHIP_VISIBLE)&&(item.key!=='courtyard'||COURTYARD_VISIBLE)).map(({ key, href, label, Icon }) => <a key={key} href={localizedHref(zh, href)} aria-current={active === key ? 'page' : undefined}><Icon size={18}/>{copy(label)}</a>)}</nav><div className="community-tools"><BookmarkSite/><LanguageSwitch />{account ? <div className="account-status"><span className="account-avatar">{account.name.slice(0, 1)}</span><a href="/account/security">{account.name}</a><a href="/wardrobe">{copy("我的装扮")}</a><button aria-label={copy("退出登录")} title={copy("退出登录")} disabled={busy} onClick={async () => { setBusy(true); try {
        await logout();
    }
    catch (e) {
        setError(e instanceof Error ? e.message : '退出失败');
    }
    finally {
        setBusy(false);
    } }}><LogOut size={18}/></button></div> : <a className="optional-login" href="/account">{copy("登录（可选）")}</a>}</div></header>{copy(error) && <p className="form-error" role="alert">{copy(error)}</p>}{children}<footer className="community-footer"><span>{copy("和眼前的人，拼这一刻。")}</span><span>{copy("图库图片均已登记来源与使用授权")}</span></footer><ServiceFooter/></div>;
}
