'use client';
import { useEffect,useState } from 'react';
import CommunityShell from '../../community-shell';
import { useLanguage } from '../../language-switch';
import { apiJson } from '@/lib/community-client';
import { t } from '@/lib/i18n';

type Summary={account:{username:string};recoveryReady:boolean;recoveryExpiresAt:number|null;privacy:null|{status:string;resolution:string|null}};
export default function SecurityCenter(){
 const lang=useLanguage(),b=(zh:string,en:string)=>lang==='en'?en:zh;
 const [data,setData]=useState<Summary|null>(null),[password,setPassword]=useState(''),[next,setNext]=useState(''),[confirm,setConfirm]=useState('');
 const [code,setCode]=useState(''),[error,setError]=useState(''),[message,setMessage]=useState(''),[busy,setBusy]=useState(false),[ack,setAck]=useState(false);
 async function refresh(){setData(await apiJson<Summary>('/api/auth/security'));}
 useEffect(()=>{refresh().catch(e=>setError(e.message));},[]);
 async function action(kind:string,cancel=false){
  if(kind==='password'&&next!==confirm){setError(b('两次新密码不一致','The new passwords do not match.'));return;}
  setBusy(true);setError('');setMessage('');setCode('');
  try{const result=await apiJson<{code?:string}>('/api/auth/security',{action:kind,password,newPassword:next,cancel});
   if(kind==='password'){window.location.assign('/account?changed=1');return;}
   if(result.code)setCode(result.code);
   else setMessage(cancel?b('删除申请已取消。','Deletion request cancelled.'):b('申请已提交，处理结果会显示在这里；提交不会立即删除账号。','Request submitted. Its resolution will appear here; submission does not immediately delete your account.'));
   setPassword('');setAck(false);await refresh();
  }catch(e){setError(e instanceof Error?e.message:'请求失败');}finally{setBusy(false);}
 }
 return <CommunityShell active="personal"><main className="service-main">
  <h1>{b('账号与安全','Account & security')}</h1><p>{data?.account.username}</p>
  <p>{b('公开大厅和本机单人游玩仍无需登录。','You can still play public tables and device-only solo puzzles without signing in.')}</p>
  {error&&<p role="alert" className="form-error">{t(error)}</p>}{message&&<p role="status">{message}</p>}
  <label className="service-field">{b('当前密码（用于确认以下操作）','Current password (to confirm changes)')}<input type="password" autoComplete="current-password" value={password} maxLength={128} onChange={e=>setPassword(e.target.value)}/></label>
  <section className="service-card"><h2>{b('一次性恢复码','One-time recovery code')}</h2>
   <p>{b('恢复码有效期为 180 天。请保存到密码管理器或其他安全位置；本网站不会再次显示原码。重新生成会立即使旧码失效。','Your recovery code lasts 180 days. Save it in a password manager or another safe place; this site cannot show it again. Generating a new code immediately invalidates the old one.')}</p>
   <p>{data?.recoveryReady?b('已设置有效恢复码','An active recovery code is set'):b('尚未设置有效恢复码','No active recovery code is set')}</p>
   <button className="secondary" disabled={busy||!password||!data} onClick={()=>action('recovery')}>{b('生成新的恢复码','Generate a new recovery code')}</button>
   {code&&<div className="recovery-code" role="status"><p>{b('仅显示这一次，请立即保存：','Shown only once. Save it now:')}</p><code>{code}</code></div>}
   <a href="/account/recover">{b('使用恢复码重设密码','Reset a password with a recovery code')}</a>
  </section>
  <form className="service-card" onSubmit={e=>{e.preventDefault();void action('password');}}><h2>{b('修改密码','Change password')}</h2>
   <label className="service-field">{b('新密码','New password')}<input type="password" autoComplete="new-password" required minLength={8} maxLength={128} value={next} onChange={e=>setNext(e.target.value)}/></label>
   <small>{b('8–128 个字符，区分大小写。','8–128 characters. Case-sensitive.')}</small>
   <label className="service-field">{b('再次输入新密码','Confirm new password')}<input type="password" autoComplete="new-password" required minLength={8} maxLength={128} value={confirm} onChange={e=>setConfirm(e.target.value)}/></label>
   <p>{b('修改后，所有设备会退出登录，旧恢复码失效。请重新登录并生成新恢复码。','Changing your password signs out all devices and invalidates your recovery code. Sign in again to create a new code.')}</p>
   <button className="primary" disabled={busy||!password||!data}>{b('修改并退出登录','Change password & sign out')}</button>
  </form>
  <section className="service-card"><h2>{b('申请删除账号','Request account deletion')}</h2>
   <p>{b('管理员会核实并处理账号和关联数据；共同完成的拼图、必要订单及备份可能需要另行匿名化或按适用期限保留。此入口提交申请，不会自动清除浏览器存档。','An administrator will review your account and associated data. Shared puzzles, necessary order records and backups may need anonymization or applicable retention. This submits a request; it does not clear browser saves.')}</p>
   {data?.privacy?.status==='pending'?<><p>{b('正在等待处理','Awaiting review')}</p><button className="secondary" disabled={busy||!password} onClick={()=>action('privacy',true)}>{b('取消删除申请','Cancel request')}</button></>:data?.privacy?.status==='completed'?<p>{b('处理说明：','Resolution: ')}{data.privacy.resolution}</p>:<>
    <label className="service-check"><input type="checkbox" checked={ack} onChange={e=>setAck(e.target.checked)}/>{b('我了解这是一项账号数据删除申请。','I understand this requests deletion of my account data.')}</label>
    <button className="secondary" disabled={busy||!password||!ack||!data} onClick={()=>action('privacy')}>{b('提交删除申请','Submit deletion request')}</button></>}
  </section>
 </main></CommunityShell>;
}
