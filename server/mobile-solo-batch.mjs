export const SOLO_BATCH_MAX=40;

function restore(target,backup){
 for(const key of Object.keys(target))delete target[key];
 Object.assign(target,backup);
 return target;
}

export function createSoloBatch({enabled,replay,snapshotView,profileView,engine,fail,requestKey}){
 return ({room,member,p,input,now,since,act})=>{
  if(!enabled)fail(409,'SOLO_BATCH_DISABLED','当前版本暂不支持本地拼图同步');
  if(room.diagnostic===true)fail(409,'SOLO_BATCH_UNAVAILABLE','测试房间不支持批量同步');
  if(!Array.isArray(input.ops)||input.ops.length<1||input.ops.length>SOLO_BATCH_MAX)fail(400,'INVALID_BATCH','同步内容无效');
  const applied=[],skipped=[],mobileContributions=[];let stopped=null;
  for(const op of input.ops){
   if(!op||!requestKey(op.requestId)||!Number.isSafeInteger(op.groupId)||op.groupId<0||!Number.isFinite(op.dx)||!Number.isFinite(op.dy)||Math.abs(op.dx)>20000||Math.abs(op.dy)>20000){
    skipped.push({requestId:typeof op?.requestId==='string'?op.requestId:null,code:'INVALID_OP'});continue;
   }
   const {groupId,dx,dy,requestId}=op;
   const drop={type:'drop',groupId,dx,dy,seq:1,requestId};
   const roomBackup=structuredClone(room),profileBackup=structuredClone(p),members=new Map(room.members.map(m=>[m.id,m]));
   try{
    const reply=replay(p,'room-action:'+room.id,drop,now,()=>{
     for(const [id,lease]of Object.entries(room.leases))if(Number(id)!==groupId&&lease.playerId===member.id)delete room.leases[id];
     engine.applyAction(room,member,{type:'claim',groupId},now);
     return act(drop);
    });
    applied.push(requestId);
    if(reply.mobileContribution)mobileContributions.push(reply.mobileContribution);
   }catch(error){
    // act writes no SQLite state before ENERGY_EMPTY; engine refusals precede its saves.
    // Restore member objects too: the handler and act retain their live references.
    const restoredMembers=roomBackup.members.map(saved=>restore(members.get(saved.id)??{},saved));
    restore(room,{...roomBackup,members:restoredMembers});restore(p,profileBackup);
    if(error.code==='ENERGY_EMPTY'){stopped={requestId,code:'ENERGY_EMPTY',message:error.message};break;}
    if([400,403,409,410,422].includes(error.status)){skipped.push({requestId,code:error.code||'CONFLICT'});continue;}
    throw error;
   }
  }
  return {...snapshotView(room,now,since,p.id),profile:profileView(p,now),soloBatch:{applied,skipped,stopped:stopped??null},mobileContributions};
 };
}
