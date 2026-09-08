import { addMember, validName, snapshot } from '@/lib/room-engine';
import { body, digestToken, newId, mutateRoom, json, failure,readRoom } from '@/lib/room-store';
import { requireAccount } from '@/lib/account-store';
export async function POST(request:Request,context:{params:Promise<{id:string}>}){
 try{
  const {id}=await context.params,input=await body(request),existing=await readRoom(id);
  const account=existing.visibility?await requireAccount(request):null,name=account?.name||validName(input.name);
  const token=newId(),digest=await digestToken(token),now=Date.now();
  const {room,result:member}=await mutateRoom(id,room=>addMember(room,newId(),name,digest,now,account?.id));
  return json({token,playerId:member.id,room:snapshot(room,now)});
 }catch(error){return failure(error);}
}
