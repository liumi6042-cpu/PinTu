import AccountGate from '@/app/account-gate';
import DailyPuzzle from '@/app/daily-puzzle';
import PublicLobby from '@/app/public-lobby';
import { zhPageMetadata } from '@/lib/seo';
import ChineseIntroduction from '../chinese-introduction';
import { completionStats } from '@/lib/completion-stats';
import { localDb } from '@/lib/local-db';
export const metadata = zhPageMetadata('/lobby');
// How much the site has finished belongs in the markup itself: a crawler reads it, and the
// numbers are there on the first paint instead of waiting for the browser's first poll.
// Counted from finished rooms, with a short cache shared with /api/lobby.
const stats = () => completionStats(Date.now(), localDb() as never).catch(() => null);
export default async function Page() { return <><AccountGate><PublicLobby initialStats={await stats()} daily={<DailyPuzzle locale="zh" variant="strip"/>}/></AccountGate><ChineseIntroduction kind="lobby"/></>; }
