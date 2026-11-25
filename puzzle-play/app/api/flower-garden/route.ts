import {requireAccount} from '@/lib/account-store';
import {securityLimit} from '@/lib/account-security';
import {body,json,failure} from '@/lib/room-store';
import {RoomError} from '@/lib/room-engine';
import {gardenFor,gardenAction,update,recoverGardenRewards} from '@/lib/courtyard-store';
import {migrateFlowerGarden,flowerState,applyFlowerAction} from '@/lib/flower-garden-model.mjs';
async function profile(id:string){
 const current=await gardenFor(id);
 if(!current.state.flowerGarden)return update(id,'flower-garden-migration-v1','migration',s=>{migrateFlowerGarden(s);});
 return current;
}
const response=(p:Awaited<ReturnType<typeof gardenFor>>,op?:string)=>json({state:flowerState(p.state,p.version),now:Date.now(),result:op?p.state.flowerResults?.[op]??null:null});
export async function GET(request:Request){try{const user=await requireAccount(request);await profile(user.id);await recoverGardenRewards(user.id);return response(await gardenFor(user.id));}catch(e){return failure(e);}}
export async function POST(request:Request){try{
 const user=await requireAccount(request),input=await body(request);await securityLimit('flower-garden-actions',user.id,300);
 const op=input.requestId,version=input.version;
 if(typeof op!=='string'||!/^[a-f0-9]{32}$/.test(op)||!Number.isSafeInteger(version))throw new RoomError('请求格式无效');
 const current=await gardenFor(user.id);if(!current.state.flowerGarden)throw new RoomError('请先打开花园完成同步',409);
 if(input.action==='checkin')return response(await gardenAction(user.id,input));
 const p=await update(user.id,op,'flower:'+String(input.action),s=>{try{applyFlowerAction(s,input);}catch(e){throw new RoomError(e instanceof Error?e.message:'操作失败',409);}},null,version as number);
 return response(p,op);
 }catch(e){return failure(e);}}
