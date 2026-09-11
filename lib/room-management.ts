import { RoomError,ensureOpen,type Room } from './room-engine';
export function roomTitle(value:unknown,optional=false){
  if(optional&&(value===undefined||value===''))return undefined;
  if(typeof value!=='string')throw new RoomError('房间名称需为 1–40 个字符');
  const title=value.trim();if(!title||title.length>40||/[\u0000-\u001f\u007f]/.test(title))throw new RoomError('房间名称需为 1–40 个字符');return title;
}
export function manageRoom(room:Room,owners:ReadonlySet<string>,input:Record<string,unknown>,now:number){
  ensureOpen(room,now);
  if(!room.ownerId||!owners.has(room.ownerId)||!['private','public'].includes(room.visibility||''))throw new RoomError('只有房主可以管理这个房间',403);
  if(!Object.keys(input).length||Object.keys(input).some(key=>!['title','visibility','acceptingNew'].includes(key)))throw new RoomError('房间设置无效');
  if(input.title!==undefined)room.title=roomTitle(input.title);
  if(input.visibility==='public'&&room.customImage)throw new RoomError('自上传图片仅供自己和邀请的朋友游玩，不能公开到大厅。',403);
  if(input.visibility!==undefined){if(!['private','public'].includes(String(input.visibility)))throw new RoomError('房间设置无效');room.visibility=input.visibility as 'private'|'public';}
  if(input.acceptingNew!==undefined){if(typeof input.acceptingNew!=='boolean')throw new RoomError('房间设置无效');room.acceptingNew=input.acceptingNew;}
  // Preserve everyone already admitted, including guests who have not moved a piece yet.
  room.admitted??={};for(const member of room.members){const id=member.accountId||member.guestId;if(id)room.admitted[id]=true;}
}
