import { recoverPassword } from '@/lib/account-security';
import { body,json,failure } from '@/lib/room-store';
export async function POST(request:Request){try{await recoverPassword(await body(request));return json({ok:true});}catch(error){return failure(error);}}
