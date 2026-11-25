import { registerAccount } from '@/lib/account-store';
import { sessionCookie } from '@/lib/account-crypto';
import { body,json,failure } from '@/lib/room-store';
export async function POST(request:Request){try{const {account,token}=await registerAccount(await body(request));const response=json({account},201);response.headers.set('Set-Cookie',sessionCookie(token,request));return response;}catch(error){return failure(error);}}
