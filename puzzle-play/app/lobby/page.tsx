import AccountGate from '../account-gate';
import DailyPuzzle from '../daily-puzzle';
import PublicLobby from '../public-lobby';
import { pageMetadata } from '@/lib/seo';
import { completionStats } from '@/lib/completion-stats';
import { localDb } from '@/lib/local-db';
export const metadata = pageMetadata('/lobby');
// See the Chinese page: the numbers are part of the markup, not only of the client's poll.
const stats = () => completionStats(Date.now(), localDb() as never).catch(() => null);
export default async function Lobby() { return <AccountGate><PublicLobby initialStats={await stats()} daily={<DailyPuzzle locale="en" variant="strip"/>}/></AccountGate>; }
