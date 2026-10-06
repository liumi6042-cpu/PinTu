import { roomCards } from '@/lib/lobby-store';
import { completionStats } from '@/lib/completion-stats';
import { localDb } from '@/lib/local-db';
import { json,failure } from '@/lib/room-store';
import { botTick } from '@/lib/bot-runner';
import { botsEnabled } from '@/lib/bot-settings';
let lastBotTick = 0;
export async function GET(){
 try{
  const now=Date.now();
  if (botsEnabled() && now - lastBotTick >= 4000) { lastBotTick = now; void botTick(now).catch(() => {}); }
  const [rooms,stats]=await Promise.all([roomCards(),completionStats(now,localDb() as never)]);
  return json({rooms,stats,serverTime:now});
 }catch(error){return failure(error);}
}
