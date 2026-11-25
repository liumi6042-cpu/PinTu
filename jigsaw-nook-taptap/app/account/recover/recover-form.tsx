'use client';
import { useState } from 'react';
import CommunityShell from '../../community-shell';
import { useLanguage } from '../../language-switch';
import { apiJson } from '@/lib/community-client';
import { t } from '@/lib/i18n';
export default function RecoverForm(){const lang=useLanguage(),b=(zh:string,en:string)=>lang==='en'?en:zh;
 const [username,setUsername]=useState(''),[code,setCode]=useState(''),[password,setPassword]=useState(''),[confirm,setConfirm]=useState(''),[error,setError]=useState(''),[done,setDone]=useState(false),[busy,setBusy]=useState(false);
 async function submit(e:React.FormEvent){e.preventDefault();setError('');if(password!==confirm){setError(b('两次新密码不一致','The new passwords do not match.'));return;}setBusy(true);try{await apiJson('/api/auth/recover',{username,code,newPassword:password});setDone(true);setCode('');setPassword('');setConfirm('');}catch(e){setError(e instanceof Error?e.message:'请求失败');}finally{setBusy(false);}}
 return <CommunityShell active="personal"><main className="service-main"><h1>{b('找回账号','Recover your account')}</h1><p>{b('使用之前在“账号与安全”中保存的一次性恢复码。暂不支持邮件找回；没有恢复码时请勿向他人提供密码。','Use the one-time code you saved in Account & security. Email recovery is not available yet. Never share your password with anyone.')}</p>
 {done?<section className="service-card" role="status"><h2>{b('密码已重设','Password reset')}</h2><p>{b('旧会话和恢复码已失效。请登录并保存新的恢复码。','Old sessions and the recovery code are now invalid. Sign in and save a new recovery code.')}</p><a className="primary" href="/account">{b('前往登录','Sign in')}</a></section>:<form className="service-card" onSubmit={submit}>
 <label className="service-field">{b('账号','Username')}<input required pattern="[a-zA-Z0-9_]{3,24}" maxLength={24} autoComplete="username" value={username} onChange={e=>setUsername(e.target.value)}/></label>
 <label className="service-field">{b('恢复码','Recovery code')}<input required minLength={64} maxLength={71} autoComplete="off" spellCheck={false} value={code} onChange={e=>setCode(e.target.value)}/></label>
 <label className="service-field">{b('新密码','New password')}<input required type="password" minLength={8} maxLength={128} autoComplete="new-password" value={password} onChange={e=>setPassword(e.target.value)}/></label><small>{b('8–128 个字符，区分大小写。','8–128 characters. Case-sensitive.')}</small>
 <label className="service-field">{b('再次输入新密码','Confirm new password')}<input required type="password" minLength={8} maxLength={128} autoComplete="new-password" value={confirm} onChange={e=>setConfirm(e.target.value)}/></label>
 {error&&<p className="form-error" role="alert">{t(error)}</p>}<button className="primary" disabled={busy}>{b('重设密码','Reset password')}</button>
 </form>}<a href="/">{b('返回免登录游玩','Return to guest play')}</a></main></CommunityShell>;
}
