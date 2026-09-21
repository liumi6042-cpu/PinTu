import AccountGate from '../account-gate';
import DailyPuzzle from '../daily-puzzle';
import PublicLobby from '../public-lobby';
import { pageMetadata } from '@/lib/seo';
export const metadata = pageMetadata('/lobby');
export default function Lobby() { return <AccountGate><PublicLobby daily={<DailyPuzzle locale="en" variant="strip"/>}/></AccountGate>; }
