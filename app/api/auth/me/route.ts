import { currentAccount } from '@/lib/account-store';
import { json,failure } from '@/lib/room-store';
export async function GET(request:Request){try{return json({account:await currentAccount(request)});}catch(error){return failure(error);}}
