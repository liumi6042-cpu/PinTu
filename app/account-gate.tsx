'use client';
import { t } from '@/lib/i18n';
import { useLanguage } from '@/app/language-switch';

import { createContext, useContext, useEffect, useState } from 'react';
import { ArrowRight, Puzzle, Eye, EyeOff } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { registration, usernameOf, type Account } from '@/lib/account-crypto';
import { apiJson } from '@/lib/community-client';
import DreamIntro from './dream-intro';
import LanguageSwitch from './language-switch';
type AccountContextValue = {
    account: Account | null;
    logout: () => Promise<void>;
};
const AccountContext = createContext<AccountContextValue | null>(null);
export function useAccount() { const context = useContext(AccountContext); if (!context)
    throw new Error('AccountGate is required'); return context; }
export default function AccountGate({ children, intro = false, requireLogin = false }: {
    children: React.ReactNode;
    intro?: boolean;
    requireLogin?: boolean;
}) {
    useLanguage();
    const [account, setAccount] = useState<Account | null>(null), [ready, setReady] = useState(false), [showIntro, setShowIntro] = useState(intro), [error, setError] = useState('');
    useEffect(() => { let alive = true; try {
        if (sessionStorage.getItem('puzzle:intro-seen') === '1')
            setShowIntro(false);
    }
    catch { } apiJson<{
        account: Account | null;
    }>('/api/auth/me').then(data => { if (alive) {
        setAccount(data.account);
        if (data.account)
            setShowIntro(false);
    } }).catch(e => { if (alive)
        setError(e.message); }).finally(() => { if (alive)
        setReady(true); }); const expired = () => setAccount(null); window.addEventListener('puzzle:session-expired', expired); return () => { alive = false; window.removeEventListener('puzzle:session-expired', expired); }; }, []);
    async function logout() { await apiJson('/api/auth/logout', {}); setAccount(null); }
    if (showIntro)
        return <DreamIntro onEnter={() => setShowIntro(false)}/>;
    if (!ready && requireLogin)
        return <div className="account-loading"><Puzzle size={32}/><p>{t("正在打开拼图世界\u2026")}</p></div>;
    if (!account && requireLogin)
        return <AccountForm initialError={error} onSuccess={value => { setError(''); setAccount(value); }}/>;
    return <AccountContext.Provider value={{ account, logout }}>{t(children)}</AccountContext.Provider>;
}
function AccountForm({ onSuccess, initialError }: {
    onSuccess: (account: Account) => void;
    initialError: string;
}) {
    useLanguage();
    const [register, setRegister] = useState(false), [username, setUsername] = useState(''), [name, setName] = useState(''), [password, setPassword] = useState(''), [visible, setVisible] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState(initialError);
    async function submit(e: React.FormEvent) { e.preventDefault(); setError(''); try {
        const input = register ? registration({ username, name, password }) : { username: usernameOf(username), password };
        setBusy(true);
        const data = await apiJson<{
            account: Account;
        }>('/api/auth/' + (register ? 'register' : 'login'), input);
        onSuccess(data.account);
    }
    catch (e) {
        setError(e instanceof Error ? e.message : register ? '注册失败，请重试' : '登录失败，请重试');
    }
    finally {
        setBusy(false);
    } }
    return <main className="account-page">
  <img className="account-art" src="/intro/dream-horizon.png" alt="" aria-hidden="true"/>
  <a className="account-brand" href="/"><Puzzle size={26}/>{t("一起拼图")}</a>
  <div className="account-language"><LanguageSwitch /></div>
  <section className="account-card">
   <p className="section-kicker">YOUR NEXT LITTLE ADVENTURE</p>
   <h1>{t(register ? '把名字留在这里。' : '欢迎来到这一片。')}</h1>
   <p className="muted">{t(register ? '注册为可选操作，游客也可以直接游玩。' : '公开拼图和个人游玩均无需登录。账号入口为后续会员服务保留，当前没有付费项目。')}</p>
   <div className="account-tabs"><button aria-pressed={!register} onClick={() => { setRegister(false); setError(''); }} disabled={busy}>{t("登录")}</button><button aria-pressed={register} onClick={() => { setRegister(true); setError(''); }} disabled={busy}>{t("注册账号")}</button></div>
   <form key={register ? 'register' : 'login'} onSubmit={submit}>
    <label>{t("账号")}<Input value={username} onChange={e => { e.currentTarget.setCustomValidity(t('')); setUsername(e.target.value); }} onBlur={e => setUsername(e.target.value.trim())} onInvalid={e => e.currentTarget.setCustomValidity(t('账号需为 3–24 个字符，只能使用英文字母、数字或下划线'))} required minLength={3} maxLength={24} pattern="[a-zA-Z0-9_]{3,24}" aria-describedby={register ? 'account-username-help' : undefined} placeholder={t("例如 puzzle_2026")} autoComplete="username" disabled={busy}/>
     {t(register && <span className="account-field-help" id="account-username-help">{t("3\u201324 个字符，只能使用英文字母、数字或下划线；账号不区分大小写。")}</span>)}
    </label>
    {t(register && <label>{t("你的昵称")}<Input value={name} onChange={e => { e.currentTarget.setCustomValidity(t('')); setName(e.target.value); }} onBlur={e => setName(e.target.value.trim().replace(/[\u0000-\u001f\u007f]/g, ''))} onInvalid={e => e.currentTarget.setCustomValidity(t('昵称需为 1–16 个字符，不能只填空格'))} required minLength={1} maxLength={16} pattern={'.*\\S.*'} aria-describedby="account-name-help" placeholder={t("大家怎么称呼你？")} autoComplete="nickname" disabled={busy}/>
     <span className="account-field-help" id="account-name-help">{t("1\u201316 个字符，可使用中文；不能只填空格，首尾空格会自动去除。")}</span>
    </label>)}
    <label>{t("密码")}<div className="password-field"><Input type={visible ? 'text' : 'password'} value={password} onChange={e => { e.currentTarget.setCustomValidity(t('')); setPassword(e.target.value); }} onInvalid={e => e.currentTarget.setCustomValidity(t(register ? '密码需为 8–128 个字符' : '请输入密码（最多 128 个字符）'))} required minLength={register ? 8 : 1} maxLength={128} aria-describedby={register ? 'account-password-help' : undefined} placeholder={t(register ? '至少 8 个字符' : '输入密码')} autoComplete={register ? 'new-password' : 'current-password'} disabled={busy}/><button type="button" aria-label={t(visible ? '隐藏密码' : '显示密码')} onClick={() => setVisible(!visible)}>{t(visible ? <EyeOff size={18}/> : <Eye size={18}/>)}</button></div>
     {t(register && <span className="account-field-help" id="account-password-help">{t("8\u2013128 个字符，区分大小写；不限制字母、数字或符号的组合。")}</span>)}
    </label>
    {t(error && <p className="form-error" role="alert">{t(error)}</p>)}
    <button className="primary" disabled={busy}>{t(busy ? '正在连接…' : register ? '注册并进入' : '登录并进入')}<ArrowRight size={18}/></button>
   </form>
   <a className="guest-return-link" href="/">{t("先选图游玩，无需登录 ")}<ArrowRight size={16}/></a>
   <p className="account-note">{t("本地账号 \u00B7 仅用于这台服务器的拼图世界")}</p>
  </section>
 </main>;
}
