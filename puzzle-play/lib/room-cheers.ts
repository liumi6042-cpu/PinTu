export const CHEER_EMOTES = ['clap','popper','heart','star','tea','cat'] as const;
export type CheerEmote = typeof CHEER_EMOTES[number];
export type Cheer = {seq:number;id:string;playerId:string;name:string;emote:CheerEmote;at:number};
export type CheerSnapshot = {cheers:Cheer[];cursor:number;serverTime:number};
type CheerRoom = {items:Cheer[];accepted:Map<string,number[]>};
type Member = {id:string;name:string;lastSeen:number};
export class CheerError extends Error {
  status:number;code:string;
  constructor(status:number,code:string,message:string){super(message);this.status=status;this.code=code;}
}
export function cheerAfter(value:unknown):number {
  const parsed=typeof value==='string'&&value.trim()!==''?Number(value):value;
  return typeof parsed==='number'&&Number.isSafeInteger(parsed)&&parsed>=0?parsed:0;
}
/** Pure ephemeral store. Access-driven sweeping also works in Worker runtimes. */
export function createRoomCheers(clock:()=>number=Date.now){
  const rooms=new Map<string,CheerRoom>();let seq=clock(),sweptAt=seq;
  const prune=(entry:CheerRoom,now:number)=>{
    entry.items=entry.items.filter(item=>item.at>now-15000).slice(-60);
    // Keep rate history for a minute even when every visible cheer has expired.
    for(const [player,times] of entry.accepted){const kept=times.filter(at=>at>now-60000);if(kept.length)entry.accepted.set(player,kept);else entry.accepted.delete(player);}
  };
  const access=(id:string,now:number)=>{
    if(now-sweptAt>=30000){for(const [key,entry] of rooms){prune(entry,now);if(!entry.items.length&&!entry.accepted.size)rooms.delete(key);}sweptAt=now;}
    const entry=rooms.get(id);if(entry){prune(entry,now);if(!entry.items.length&&!entry.accepted.size){rooms.delete(id);return undefined;}}return entry;
  };
  return {
    putCheer(room:{id:string;completedAt?:number|null},member:Member,input:unknown,now=clock()){
      let entry=access(room.id,now);
      if(member.lastSeen<=0)throw new CheerError(409,'ROOM_ADMISSION_REQUIRED','请先重新连接房间');
      if(!room.completedAt)throw new CheerError(409,'ROOM_NOT_COMPLETED','拼图完成后才能喝彩');
      const raw=input as {id?:unknown;emote?:unknown}|null;
      if(!raw||typeof raw.id!=='string'||!/^[a-f0-9]{32}$/.test(raw.id)||!CHEER_EMOTES.includes(raw.emote as CheerEmote))throw new CheerError(400,'INVALID_CHEER','喝彩内容无效');
      if(entry?.items.some(item=>item.playerId===member.id&&item.id===raw.id))return false;
      const times=entry?.accepted.get(member.id)??[];
      if(times.length>=40||times.filter(at=>at>now-2000).length>=4)throw new CheerError(429,'CHEER_RATE_LIMIT','喝彩太快啦，歇一下');
      if(!entry){entry={items:[],accepted:new Map()};rooms.set(room.id,entry);}
      entry.accepted.set(member.id,[...times,now]);
      entry.items.push({seq:++seq,id:raw.id,playerId:member.id,name:member.name,emote:raw.emote as CheerEmote,at:now});
      if(entry.items.length>60)entry.items.splice(0,entry.items.length-60);
      return true;
    },
    cheersView(roomId:string,after:unknown=0,now=clock()):CheerSnapshot {
      const entry=access(roomId,now),since=cheerAfter(after);
      return {cheers:(entry?.items??[]).filter(item=>item.seq>since).map(item=>({...item})),cursor:seq,serverTime:now};
    },
    forget(roomId:string){rooms.delete(roomId);},
    close(){rooms.clear();},
  };
}
// One sequence and store for all rooms handled by this backend runtime.
export const roomCheers=createRoomCheers();
