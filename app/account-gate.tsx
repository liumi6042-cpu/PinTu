'use client';
import { createContext,useContext,useEffect,useState } from 'react';
import { ArrowRight, Puzzle,Eye,EyeOff } from 'lucide-react';
import { Input } from '@/components/ui/input';
import type { Account } from '@/lib/account-crypto';
import { apiJson } from '@/lib/community-client';
import DreamIntro from './dream-intro';
type AccountContextValue={account:Account;logout:()=>Promise<void>};
const AccountContext=createContext<AccountContextValue|null>(null);
export function useAccount(){const context=useContext(AccountContext);if(!context)throw new Error('AccountGate is required');return context;}
export default function AccountGate({children,intro=false}:{children:React.ReactNode;intro?:boolean}){
 const [account,setAccount]=useState<Account|null>(null),[ready,setReady]=useState(false),[showIntro,setShowIntro]=useState(intro),[error,setError]=useState('');
 useEffect(()=>{let alive=true;try{if(sessionStorage.getItem('puzzle:intro-seen')==='1')setShowIntro(false);}catch{}apiJson<{account:Account|null}>('/api/auth/me').then(data=>{if(alive){setAccount(data.account);if(data.account)setShowIntro(false);}}).catch(e=>{if(alive)setError(e.message);}).finally(()=>{if(alive)setReady(true);});const expired=()=>setAccount(null);window.addEventListener('puzzle:session-expired',expired);return()=>{alive=false;window.removeEventListener('puzzle:session-expired',expired);};},[]);
 async function logout(){await apiJson('/api/auth/logout',{});setAccount(null);}
 if(showIntro)return <DreamIntro onEnter={()=>setShowIntro(false)}/>;
 if(!ready)return <div className="account-loading"><Puzzle size={32}/><p>正在打开拼图世界…</p></div>;
 if(!account)return <AccountForm initialError={error} onSuccess={value=>{setError('');setAccount(value);}}/>;
 return <AccountContext.Provider value={{account,logout}}>{children}</AccountContext.Provider>;
}
function AccountForm({onSuccess,initialError}:{onSuccess:(account:Account)=>void;initialError:string}){
 const [register,setRegister]=useState(false),[username,setUsername]=useState(''),[name,setName]=useState(''),[password,setPassword]=useState(''),[visible,setVisible]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(initialError);
 async function submit(e:React.FormEvent){e.preventDefault();setBusy(true);setError('');try{const data=await apiJson<{account:Account}>('/api/auth/'+(register?'register':'login'),{username,name,password});onSuccess(data.account);}catch(e){setError(e instanceof Error?e.message:'登录失败，请重试');}finally{setBusy(false);}}
 return <main className="account-page"><img className="account-art" src="/intro/dream-horizon.png" alt="" aria-hidden="true"/><a className="account-brand" href="/"><Puzzle size={26}/>一起拼图</a><section className="account-card"><p className="section-kicker">YOUR NEXT LITTLE ADVENTURE</p><h1>{register?'把名字留在这里。':'欢迎来到这一片。'}</h1><p className="muted">{register?'创建账号，保存你的拼图和成绩。':'登录后，选一张桌子就能和大家一起拼。'}</p><div className="account-tabs"><button aria-pressed={!register} onClick={()=>{setRegister(false);setError('');}} disabled={busy}>登录</button><button aria-pressed={register} onClick={()=>{setRegister(true);setError('');}} disabled={busy}>注册账号</button></div><form onSubmit={submit}><label>账号<Input value={username} onChange={e=>setUsername(e.target.value)} required minLength={3} maxLength={24} pattern="[a-zA-Z0-9_]{3,24}" placeholder="英文字母、数字或下划线" autoComplete="username" disabled={busy}/></label>{register&&<label>你的昵称<Input value={name} onChange={e=>setName(e.target.value)} required maxLength={16} placeholder="大家怎么称呼你？" autoComplete="nickname" disabled={busy}/></label>}<label>密码<div className="password-field"><Input type={visible?'text':'password'} value={password} onChange={e=>setPassword(e.target.value)} required minLength={register?8:1} maxLength={128} placeholder={register?'至少 8 个字符':'输入密码'} autoComplete={register?'new-password':'current-password'} disabled={busy}/><button type="button" aria-label={visible?'隐藏密码':'显示密码'} onClick={()=>setVisible(!visible)}>{visible?<EyeOff size={18}/>:<Eye size={18}/>}</button></div></label>{error&&<p className="form-error" role="alert">{error}</p>}<button className="primary" disabled={busy}>{busy?'正在连接…':register?'注册并进入大厅':'登录并进入'}<ArrowRight size={18}/></button></form><p className="account-note">本地账号 · 仅用于这台服务器的拼图世界</p></section></main>;
}
