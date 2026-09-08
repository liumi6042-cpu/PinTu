import { logoutAccount } from '@/lib/account-store';
import { sessionCookie } from '@/lib/account-crypto';
import { body,json,failure } from '@/lib/room-store';
export async function POST(request:Request){try{await body(request);await logoutAccount(request);const response=json({ok:true});response.headers.set('Set-Cookie',sessionCookie('',request,true));return response;}catch(error){return failure(error);}}
