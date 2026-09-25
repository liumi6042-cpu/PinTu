'use client';
import {useAccount} from './account-gate';
import {useLanguage} from './language-switch';
import {CompanionEgg} from './courtyard-companion';
export default function CompletionCourtyardInvite(){const {account}=useAccount(),zh=useLanguage()==='zh',c=(a:string,b:string)=>zh?a:b;return account?<a className="secondary" href="/courtyard">{c('前往庭院，查看孵化进度','Visit your courtyard to see hatching progress')}</a>:<section className="completion-courtyard-invite"><div className="completion-courtyard-preview"><CompanionEgg/></div><p>{c('给下一次拼图，添一个小目标：签到、完成拼图，种下第一朵花。','A little goal for your next puzzle: check in, finish puzzles and grow your first flower.')}</p><a className="primary" href="/account?returnTo=%2Fcourtyard">{c('登录，开启我的庭院','Sign in to start my courtyard')}</a></section>}
