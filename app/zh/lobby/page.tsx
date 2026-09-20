import AccountGate from '@/app/account-gate';
import PublicLobby from '@/app/public-lobby';
import { zhPageMetadata } from '@/lib/seo';
import ChineseIntroduction from '../chinese-introduction';
export const metadata = zhPageMetadata('/lobby');
export default function Page() { return <><AccountGate><PublicLobby/></AccountGate><ChineseIntroduction kind="lobby"/></>; }
