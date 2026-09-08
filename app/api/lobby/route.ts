import { requireAccount } from '@/lib/account-store';
import { roomCards } from '@/lib/lobby-store';
import { json,failure } from '@/lib/room-store';
export async function GET(request:Request){try{await requireAccount(request);return json({rooms:await roomCards()});}catch(error){return failure(error);}}
