import { roomCards } from '@/lib/lobby-store';
import { json,failure } from '@/lib/room-store';
export async function GET(){try{return json({rooms:await roomCards(),serverTime:Date.now()});}catch(error){return failure(error);}}
