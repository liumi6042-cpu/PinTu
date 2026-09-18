'use client';
import { t } from '@/lib/i18n';
import { useLanguage } from '@/app/language-switch';

import { useEffect, useState } from 'react';
import { Users, UserRound, Images, Crown } from 'lucide-react';
import type { Account } from '@/lib/account-crypto';
import { apiJson } from '@/lib/community-client';
import LanguageSwitch from './language-switch';
import BookmarkSite from './bookmark-site';
import { MEMBERSHIP_VISIBLE,PERSONAL_PLAY_VISIBLE } from '@/lib/feature-visibility';
export default function HomeNavigation({galleryHref='/gallery'}:{galleryHref?:string}) {
    useLanguage();
    const [account, setAccount] = useState<Account | null>(null);
    useEffect(() => {
        let alive = true;
        void apiJson<{
            account: Account | null;
        }>('/api/auth/me').then(data => { if (alive)
            setAccount(data.account); }).catch(() => { });
        return () => { alive = false; };
    }, []);
    return <nav className="home-navigation" aria-label={t("主要导航")}>
  <a href="/lobby"><Users size={17}/>{t("公开大厅")}</a>
  <a href={galleryHref}><Images size={17}/>{t('图库')}</a>
  <a href="/personal"><UserRound size={17}/>{t(PERSONAL_PLAY_VISIBLE?'个人空间':'拼图记录')}</a>
  {MEMBERSHIP_VISIBLE&&<a href="/membership"><Crown size={17}/>{t("会员")}</a>}
  <a className="home-account-link" href={account?"/account/security":"/account"}>{account ? account.name : t('登录（可选）')}</a>
  <LanguageSwitch />
  <BookmarkSite />
 </nav>;
}
