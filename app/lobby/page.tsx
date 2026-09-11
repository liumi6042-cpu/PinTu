import AccountGate from '../account-gate';
import PublicLobby from '../public-lobby';
import { pageMetadata } from '@/lib/seo';
export const metadata = pageMetadata('/lobby');
export default function Lobby() { return <AccountGate><PublicLobby/></AccountGate>; }
