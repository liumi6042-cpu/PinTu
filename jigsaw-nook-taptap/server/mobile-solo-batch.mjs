export const SOLO_BATCH_MAX=40;

function restore(target,backup){
 for(const key of Object.keys(target))delete target[key];
 Object.assign(target,backup);
 return target;
}

function validOptionalMeta(op){
 if(op.pieceId!==undefined&&(!Number.isSafeInteger(op.pieceId)||op.pieceId<0))return false;
 if(op.snapKind!==undefined&&op.snapKind!=='lock'&&op.snapKind!=='join')return false;
 if(op.mergedPieces!==undefined&&(!Array.isArray(op.mergedPieces)||op.mergedPieces.length>8||!op.mergedPieces.every(n=>Number.isSafeInteger(n)&&n>=0)))return false;
 return true;
}

export function createSoloBatch({enabled,replay,roomActionReceipt=result=>({mobileContribution:result.mobileContribution}),snapshotView,profileView,engine,fail,requestKey,awardForgiving,onBatchFinished}){
 // A batch only reads mobileContribution from each drop's reply, so a retried op needs nothing more than its receipt.
 const receipt={store:roomActionReceipt,restore:stored=>stored};
 return ({room,member,p,input,now,since,act})=>{
  if(!enabled)fail(409,'SOLO_BATCH_DISABLED','当前版本暂不支持本地拼图同步');
  if(room.diagnostic===true)fail(409,'SOLO_BATCH_UNAVAILABLE','测试房间不支持批量同步');
  if(!Array.isArray(input.ops)||input.ops.length<1||input.ops.length>SOLO_BATCH_MAX)fail(400,'INVALID_BATCH','同步内容无效');
  const applied=[],skipped=[],mobileContributions=[];let stopped=null;
  for(const op of input.ops){
   if(!op||!requestKey(op.requestId)||!Number.isSafeInteger(op.groupId)||op.groupId<0||!Number.isFinite(op.dx)||!Number.isFinite(op.dy)||Math.abs(op.dx)>20000||Math.abs(op.dy)>20000||!validOptionalMeta(op)){
    skipped.push({requestId:typeof op?.requestId==='string'?op.requestId:null,code:'INVALID_OP'});continue;
   }
   const {groupId,dx,dy,requestId}=op;
   const drop={type:'drop',groupId,dx,dy,seq:1,requestId};
   const roomBackup=structuredClone(room),profileBackup=structuredClone(p),members=new Map(room.members.map(m=>[m.id,m]));
   try{
    const reply=replay(p,'room-action:'+room.id,drop,now,()=>{
     const runDrop=(targetGroupId,targetDx,targetDy)=>{
      for(const [id,lease]of Object.entries(room.leases))if(Number(id)!==targetGroupId&&lease.playerId===member.id)delete room.leases[id];
      engine.applyAction(room,member,{type:'claim',groupId:targetGroupId},now);
      const execDrop=targetGroupId===groupId&&targetDx===dx&&targetDy===dy?drop:{type:'drop',groupId:targetGroupId,dx:targetDx,dy:targetDy,seq:1,requestId};
      return act(execDrop);
     };
     if(!room.puzzle?.groups||op.pieceId===undefined||(op.snapKind!=='lock'&&op.snapKind!=='join'))return runDrop(groupId,dx,dy);
     if(typeof engine.ensureOpen==='function')engine.ensureOpen(room,now);
     if(typeof engine.pruneLeases==='function')engine.pruneLeases(room,now);
     const {cols,rows,groups}=room.puzzle,totalPieces=cols*rows;
     if(op.pieceId>=totalPieces)return runDrop(groupId,dx,dy);
     const group=groups.find(g=>g.pieces.includes(op.pieceId));
     if(!group)fail(409,'CONFLICT','这组拼块已合并或归位，请重新选择');
     const tol=typeof engine.snapTolerance==='function'?engine.snapTolerance(room.puzzle):0;
     const leasedByOther=id=>{const lease=room.leases[id];return !!lease&&lease.expires>now&&lease.playerId!==member.id;};
     const pieceNeighbors=typeof engine.neighbors==='function'?new Set(engine.neighbors(op.pieceId,cols,rows)):null;
     const validTargets=Array.isArray(op.mergedPieces)?op.mergedPieces.filter(q=>q<totalPieces&&(!pieceNeighbors||pieceNeighbors.has(q))):[];
     if(op.snapKind==='lock'){
      const plausibleLock=Math.hypot(dx,dy)<=tol||validTargets.length>0;
      if(group.locked){
       if(typeof awardForgiving==='function'&&plausibleLock)return awardForgiving({room,member,p,op,snapKey:'L:'+op.pieceId,now});
       fail(409,'CONFLICT','这组拼块已归位');
      }
      if(leasedByOther(group.id))fail(409,'CONFLICT','这组拼块正被另一位玩家移动');
      if(plausibleLock)return group.id===groupId&&Math.hypot(dx,dy)<=tol?runDrop(groupId,dx,dy):runDrop(group.id,0,0);
      return runDrop(group.id,dx,dy);
     }
     // op.snapKind === 'join'
     if(!validTargets.length)return runDrop(group.id,dx,dy);
     const isAlreadyJoined=q=>group.pieces.includes(q)||(group.locked&&groups.find(g=>g.pieces.includes(q))?.locked===true);
     const unjoined=validTargets.filter(q=>!isAlreadyJoined(q));
     if(!unjoined.length){
      if(typeof awardForgiving==='function'){
       const q=validTargets[0];
       return awardForgiving({room,member,p,op,snapKey:'J:'+Math.min(op.pieceId,q)+':'+Math.max(op.pieceId,q),now});
      }
      fail(409,'CONFLICT','这组拼块已合并');
     }
     if(group.locked){
      const candidate=unjoined.map(q=>groups.find(g=>g.pieces.includes(q))).find(target=>target&&!target.locked&&!leasedByOther(target.id));
      if(!candidate)fail(409,'CONFLICT','这组拼块正被另一位玩家移动');
      return runDrop(candidate.id,0,0);
     }
     if(leasedByOther(group.id))fail(409,'CONFLICT','这组拼块正被另一位玩家移动');
     const targetGroup=unjoined.map(q=>groups.find(g=>g.pieces.includes(q))).find(target=>target&&target.id!==group.id&&!leasedByOther(target.id));
     if(!targetGroup)fail(409,'CONFLICT','这组拼块正被另一位玩家移动');
     const tDx=targetGroup.locked?0:targetGroup.dx,tDy=targetGroup.locked?0:targetGroup.dy;
     if(group.id===groupId&&Math.hypot(tDx-dx,tDy-dy)<=tol)return runDrop(groupId,dx,dy);
     return runDrop(group.id,tDx,tDy);
    },receipt);
    applied.push(requestId);
    if(reply?.mobileContribution)mobileContributions.push(reply.mobileContribution);
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
  if(applied.length>0&&typeof onBatchFinished==='function')onBatchFinished({room,member,p,now});
  return {...snapshotView(room,now,since,p.id),profile:profileView(p,now),soloBatch:{applied,skipped,stopped:stopped??null},mobileContributions};
 };
}
