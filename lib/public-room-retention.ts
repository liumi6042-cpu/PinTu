import type { Room } from './room-engine';

// A public table lives for one day from the moment it appears in the lobby. The deadline is
// stamped once and never moves again: playing another round, leaving and coming back, or
// reconnecting does not extend it. That is what stops a public room from living forever just
// because somebody drops by every day, and it keeps the lobby turning over.
export const PUBLIC_ROOM_LIFETIME_MS=24*60*60*1000;
export function touchPublicRoom(room:Room,now:number){
  if(room.visibility!=='public')return;
  room.publicLastSeenAt=Math.max(room.publicLastSeenAt||0,now);
  // A room created before this rule existed has no deadline yet: it keeps the earliest promise
  // it was already given — its stored expiry, or 24 hours from this first touch.
  room.publicDeadline=room.publicDeadline??Math.min(room.expiresAt,now+PUBLIC_ROOM_LIFETIME_MS);
  room.expiresAt=room.publicDeadline;
}
// Public again after a spell as a private room: the day starts over, so the room does not come
// back already expired.
export function restartPublicLifetime(room:Room){if(room.visibility==='public')delete room.publicDeadline;}
export function publicRoomDeadline(room:Pick<Room,'publicDeadline'|'expiresAt'>,now:number){return room.publicDeadline??Math.min(room.expiresAt,now+PUBLIC_ROOM_LIFETIME_MS);}
