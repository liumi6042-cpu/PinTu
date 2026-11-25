import { securitySummary,rotateRecovery,changePassword,privacyRequest } from '@/lib/account-security';
import { body,json,failure } from '@/lib/room-store';
import { sessionCookie } from '@/lib/account-crypto';
export async function GET(request:Request){try{return json(await securitySummary(request));}catch(error){return failure(error);}}
export async function POST(request:Request){try{const input=await body(request);
  if(input.action==='recovery')return json(await rotateRecovery(request,input));
  if(input.action==='privacy')return json(await privacyRequest(request,input));
  if(input.action==='password'){await changePassword(request,input);const response=json({ok:true});response.headers.set('Set-Cookie',sessionCookie('',request,true));return response;}
  return json({error:'请求格式无效'},400);
}catch(error){return failure(error);}}
