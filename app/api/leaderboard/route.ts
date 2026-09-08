import { requireAccount } from '@/lib/account-store';
import { rankings } from '@/lib/lobby-store';
import { json,failure } from '@/lib/room-store';
export async function GET(request:Request){try{await requireAccount(request);return json({entries:await rankings(new URL(request.url))});}catch(error){return failure(error);}}
