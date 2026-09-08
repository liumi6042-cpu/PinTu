'use client';
import { Puzzle,Users,UserRound,Trophy,LogOut } from 'lucide-react';
import { useState } from 'react';
import { useAccount } from './account-gate';
export default function CommunityShell({active,children}:{active:'lobby'|'personal'|'ranking';children:React.ReactNode}){
 const {account,logout}=useAccount(),[busy,setBusy]=useState(false),[error,setError]=useState('');
 return <div className="community"><header className="community-header"><a className="community-brand" href="/"><Puzzle size={28}/><span>一起拼图<small>PIECES & PEOPLE</small></span></a><nav aria-label="主要导航">{[{key:'lobby',href:'/lobby',label:'公开大厅',Icon:Users},{key:'personal',href:'/personal',label:'个人空间',Icon:UserRound},{key:'ranking',href:'/leaderboard',label:'用时榜',Icon:Trophy}].map(({key,href,label,Icon})=><a key={key} href={href} aria-current={active===key?'page':undefined}><Icon size={18}/>{label}</a>)}</nav><div className="account-status"><span className="account-avatar">{account.name.slice(0,1)}</span><span>{account.name}</span><button aria-label="退出登录" title="退出登录" disabled={busy} onClick={async()=>{setBusy(true);try{await logout();}catch(e){setError(e instanceof Error?e.message:'退出失败');}finally{setBusy(false);}}}><LogOut size={18}/></button></div></header>{error&&<p className="form-error" role="alert">{error}</p>}{children}<footer className="community-footer"><span>和眼前的人，拼这一刻。</span><span>本机 / 同一局域网 · 图片均为项目生成</span></footer></div>;
}
