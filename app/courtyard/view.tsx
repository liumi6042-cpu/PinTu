'use client';
import CommunityShell from '../community-shell';
import {useLanguage} from '../language-switch';
export default function Courtyard(){const lang=useLanguage();return <CommunityShell active="courtyard"><iframe className="courtyard-frame" title={lang==='zh'?'我的庭院':'My courtyard'} src={'/courtyard/index.html?v=20260923d&lang='+lang}/></CommunityShell>}
