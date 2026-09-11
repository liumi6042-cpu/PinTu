import type { Room } from './room-engine';
export const PUBLIC_ROOM_IDLE_MS=24*60*60*1000;
export function touchPublicRoom(room:Room,now:number){
  if(room.visibility!=='public')return;
  room.publicLastSeenAt=Math.max(room.publicLastSeenAt||0,now);
  room.expiresAt=room.publicLastSeenAt+PUBLIC_ROOM_IDLE_MS;
}
