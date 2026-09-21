import { roomCards } from '@/lib/lobby-store';
import { completionStats } from '@/lib/completion-stats';
import { localDb } from '@/lib/local-db';
import { json,failure } from '@/lib/room-store';
export async function GET(){
 try{
  const now=Date.now();
  const [rooms,stats]=await Promise.all([roomCards(),completionStats(now,localDb() as never)]);
  return json({rooms,stats,serverTime:now});
 }catch(error){return failure(error);}
}
