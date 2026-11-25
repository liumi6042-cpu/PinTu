'use client';
import { useEffect,useState } from 'react';
import CommunityShell from '../community-shell';
import { useLanguage } from '../language-switch';
import { apiJson } from '@/lib/community-client';
import { t } from '@/lib/i18n';
type Row={id:string;[key:string]:string|number|null};
type Overview={requests:Row[];rooms:Row[];accounts:Row[];scores:Row[];audit:Row[];feedbackAdminUrl:string|null};
export default function AdminCenter(){
 const lang=useLanguage(),b=(zh:string,en:string)=>lang==='en'?en:zh;
 const [data,setData]=useState<Overview|null>(null),[tab,setTab]=useState<Exclude<keyof Overview,'feedbackAdminUrl'>>('requests'),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 const [pending,setPending]=useState<{action:string;target:string;label:string}|null>(null),[reason,setReason]=useState(''),[password,setPassword]=useState('');
 async function refresh(){setError('');try{setData(await apiJson<Overview>('/api/admin'));}catch(e){setError(e instanceof Error?e.message:'请求失败');}}
 useEffect(()=>{void refresh();},[]);
 async function submit(e:React.FormEvent){e.preventDefault();setBusy(true);setError('');try{await apiJson('/api/admin',{...pending,reason,password});setPending(null);setReason('');setPassword('');await refresh();}catch(e){setError(e instanceof Error?e.message:'请求失败');}finally{setBusy(false);}}
 function button(row:Row,action:string,label:string){return <button className="secondary" disabled={busy} onClick={()=>{setPending({action,target:row.id,label});setReason('');setPassword('');}}>{label}</button>;}
 return <CommunityShell active="personal"><main className="service-main"><h1>{b('管理中心','Administration')}</h1><p>{b('仅服务器指定的管理员可访问。列表最多展示最近 100 条记录，所有操作均记录原因。','Only server-designated administrators have access. Lists show up to 100 recent records. Every change records a reason.')}</p>
 {data?.feedbackAdminUrl&&<p><a className="secondary" href={data.feedbackAdminUrl} target="_blank" rel="noopener noreferrer">{b('打开反馈管理后台（独立登录）','Open feedback administration (separate sign-in)')}</a></p>}
 {error&&<p role="alert" className="form-error">{t(error)}</p>}<button className="secondary" disabled={busy} onClick={refresh}>{b('刷新','Refresh')}</button>
 {data&&<><nav className="service-tabs" aria-label={b('管理内容','Administration sections')}>{([['requests','数据申请','Data requests'],['rooms','房间','Rooms'],['accounts','账号','Accounts'],['scores','成绩','Scores'],['audit','操作记录','Audit log']] as const).map(([key,zh,en])=><button className="secondary" key={key} aria-pressed={tab===key} onClick={()=>setTab(key)}>{b(zh,en)}</button>)}</nav>
 {pending&&<form className="service-card" onSubmit={submit}><h2>{pending.label}</h2><p>{pending.target}</p>{pending.action==='resolve-privacy'&&<p className="service-notice">{b('仅在已实际完成数据核实及处理后结案。此按钮只记录处理结果，不会自动删除账号、房间或备份。','Close only after you have actually reviewed and handled the data. This button records a resolution; it does not erase accounts, rooms or backups.')}</p>}
 <label className="service-field">{b('原因 / 实际处理说明','Reason / actual resolution')}<textarea required minLength={4} maxLength={500} value={reason} onChange={e=>setReason(e.target.value)}/></label>
 <label className="service-field">{b('管理员当前密码','Administrator password')}<input type="password" autoComplete="current-password" required maxLength={128} value={password} onChange={e=>setPassword(e.target.value)}/></label><button className="primary" disabled={busy}>{b('确认处理','Confirm change')}</button> <button className="secondary" type="button" disabled={busy} onClick={()=>setPending(null)}>{b('取消','Cancel')}</button></form>}
 <section className="service-card">{!data[tab].length&&<p>{b('暂无记录','No records yet.')}</p>}{data[tab].map((row,index)=><div className="service-row" key={row.id||index}><span>{tab==='requests'?<>{row.username} · {row.status}{row.resolution&&<p>{row.resolution}</p>}</>:tab==='rooms'?<>{row.title} · {row.visibility} · {row.closed?b('已暂停','Paused'):b('开放','Open')}</>:tab==='accounts'?<>{row.username} · {row.name} · {row.status}</>:tab==='scores'?<>{row.image_id} · {row.piece_count} · {(Number(row.elapsed_ms)/1000).toFixed(1)} s · {row.hidden?b('已屏蔽','Hidden'):b('可见','Visible')}</>:<>{row.action} · {row.target_id}<p>{row.reason}</p><time>{new Date(Number(row.created_at)).toLocaleString(lang==='en'?'en-US':'zh-CN')}</time></>}</span>
 {tab==='requests'&&row.status==='pending'&&button(row,'resolve-privacy',b('记录处理结果','Record resolution'))}
 {tab==='rooms'&&button(row,row.closed?'open-room':'close-room',row.closed?b('恢复开放','Reopen'):b('暂停房间','Pause room'))}
 {tab==='accounts'&&button(row,row.status==='suspended'?'restore-account':'suspend-account',row.status==='suspended'?b('解冻账号','Restore account'):b('冻结账号','Suspend account'))}
 {tab==='scores'&&button(row,row.hidden?'show-score':'hide-score',row.hidden?b('恢复成绩','Restore score'):b('屏蔽成绩','Hide score'))}
 </div>)}</section></>}
 </main></CommunityShell>;
}
