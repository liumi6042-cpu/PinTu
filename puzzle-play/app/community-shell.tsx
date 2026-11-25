'use client';
import { useAddressCopy } from '@/lib/address-copy';
import { useLanguage } from '@/app/language-switch';
import { Puzzle, Users, UserRound, LogOut, Crown } from 'lucide-react';
import { useState } from 'react';
import { useAccount } from './account-gate';
import LanguageSwitch from './language-switch';
import ServiceFooter from './service-footer';
import BookmarkSite from './bookmark-site';
import { MEMBERSHIP_VISIBLE } from '@/lib/feature-visibility';
import './managed-play.css';
export default function CommunityShell({ active, children }: {
    active: 'lobby' | 'personal' | 'membership' | 'courtyard' | 'wardrobe' | 'albums' | 'tasks' | 'decorations';
    children: React.ReactNode;
}) {
    useLanguage();
    const copy = useAddressCopy();
    const { account, logout } = useAccount(), [busy, setBusy] = useState(false), [error, setError] = useState('');
    const navigation=[{key:'lobby',href:'/play',label:'返回拼图',Icon:Users},{key:'personal',href:'/account/security',label:'账号与安全',Icon:UserRound},...(MEMBERSHIP_VISIBLE?[{key:'membership',href:'/membership',label:'会员',Icon:Crown}]:[])];
    return <div className="community"><header className="community-header"><a className="community-brand" href="/play"><Puzzle size={28}/><span>{copy("一起拼图")}<small>JIGSAW NOOK</small></span></a><nav aria-label={copy("主要导航")}>{navigation.map(({ key, href, label, Icon }) => <a key={key} href={href} aria-current={active === key ? 'page' : undefined}><Icon size={18}/>{copy(label)}</a>)}</nav><div className="community-tools"><BookmarkSite/><LanguageSwitch />{account ? <div className="account-status"><span className="account-avatar">{account.name.slice(0, 1)}</span><a href="/account/security">{account.name}</a><button aria-label={copy("退出登录")} title={copy("退出登录")} disabled={busy} onClick={async () => { setBusy(true); try {
        await logout();
    }
    catch (e) {
        setError(e instanceof Error ? e.message : '退出失败');
    }
    finally {
        setBusy(false);
    } }}><LogOut size={18}/></button></div> : <a className="optional-login" href="/account">{copy("登录（可选）")}</a>}</div></header>{copy(error) && <p className="form-error" role="alert">{copy(error)}</p>}{children}<footer className="community-footer"><span>{copy("和眼前的人，拼这一刻。")}</span><span>{copy("图库图片均已登记来源与使用授权")}</span></footer><ServiceFooter/></div>;
}
