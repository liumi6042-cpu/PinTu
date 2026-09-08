'use client';
import { useEffect,useState } from 'react';
import { Users,Trophy,UserRound } from 'lucide-react';
import type { Account } from '@/lib/account-crypto';
import { apiJson } from '@/lib/community-client';

export default function HomeNavigation(){
 const [account,setAccount]=useState<Account|null>(null);
 useEffect(()=>{
  let alive=true;
  void apiJson<{account:Account|null}>('/api/auth/me').then(data=>{if(alive)setAccount(data.account);}).catch(()=>{});
  return()=>{alive=false;};
 },[]);
 return <nav className="home-navigation" aria-label="主要导航">
  <a href="/lobby"><Users size={17}/>公开大厅</a>
  <a href="/leaderboard"><Trophy size={17}/>用时榜</a>
  <a className="home-account-link" href="/personal"><UserRound size={17}/>{account?'个人空间':'登录 / 注册'}</a>
 </nav>;
}
