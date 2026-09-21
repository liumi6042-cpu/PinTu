'use client';
import { useAddressCopy } from '@/lib/address-copy';
import { useLanguage } from '@/app/language-switch';
import { usePathname } from 'next/navigation';
import { isChinesePath,zhPath } from '@/lib/site-paths';

import { useEffect, useState } from 'react';
import { Users, UserRound, Images, Crown } from 'lucide-react';
import type { Account } from '@/lib/account-crypto';
import { apiJson } from '@/lib/community-client';
import LanguageSwitch from './language-switch';
import BookmarkSite from './bookmark-site';
import { MEMBERSHIP_VISIBLE,PERSONAL_PLAY_VISIBLE } from '@/lib/feature-visibility';
// The address decides where the navigation points: on a Chinese page it keeps the
// visitor inside /zh, and the routes that have no Chinese copy stay shared. Deriving
// it here rather than from a prop means every caller gets the right links.
export default function HomeNavigation({galleryHref='/gallery'}:{galleryHref?:string}) {
    const copy=useAddressCopy();
    useLanguage();
    const zh=isChinesePath(usePathname()||'');
    const zhHref=(href:string)=>{const [path,...query]=href.split('?');return zh?zhPath(path)+(query.length?'?'+query.join('?'):''):href;};
    const [account, setAccount] = useState<Account | null>(null);
    useEffect(() => {
        let alive = true;
        void apiJson<{
            account: Account | null;
        }>('/api/auth/me').then(data => { if (alive)
            setAccount(data.account); }).catch(() => { });
        return () => { alive = false; };
    }, []);
    return <nav className="home-navigation" aria-label={copy("主要导航")}>
  <a href={zh?'/zh/lobby':'/lobby'}><Users size={17}/>{copy("公开大厅")}</a>
  <a href={zhHref(galleryHref)}><Images size={17}/>{copy('图库')}</a>
  <a href="/personal"><UserRound size={17}/>{copy(PERSONAL_PLAY_VISIBLE?'个人空间':'拼图记录')}</a>
  {MEMBERSHIP_VISIBLE&&<a href="/membership"><Crown size={17}/>{copy("会员")}</a>}
  <a className="home-account-link" href={account?"/account/security":"/account"}>{account ? account.name : copy('登录（可选）')}</a>
  <LanguageSwitch />
  <BookmarkSite />
 </nav>;
}
