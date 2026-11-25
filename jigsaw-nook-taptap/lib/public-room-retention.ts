import type { Room } from './room-engine';
import { pieceBand } from './piece-policy';

// A public table is shown in the lobby for one day from the moment it appears there, and a
// 500-piece table or larger gets half a day more because a big board is rarely finished in one
// sitting. The deadline is stamped once and never moves again: playing another round, leaving
// and coming back, or reconnecting does not extend it. That is what stops a public room from
// living in the lobby forever just because somebody drops by every day.
export const PUBLIC_ROOM_LIFETIME_MS=24*60*60*1000;
export const PUBLIC_ROOM_LARGE_LIFETIME_MS=PUBLIC_ROOM_LIFETIME_MS+12*60*60*1000;
// A room that has left the lobby comes back while somebody plays it again, and hides itself an
// hour after the play stops.
export const PUBLIC_LOBBY_REVEAL_MS=60*60*1000;
export function publicRoomLifetime(puzzle:Pick<Room['puzzle'],'cols'|'rows'>){
  const band=pieceBand(puzzle.cols*puzzle.rows)??puzzle.cols*puzzle.rows;
  return band>=500?PUBLIC_ROOM_LARGE_LIFETIME_MS:PUBLIC_ROOM_LIFETIME_MS;
}
export function touchPublicRoom(room:Room,now:number){
  if(room.visibility!=='public')return;
  room.publicLastSeenAt=Math.max(room.publicLastSeenAt||0,now);
  // A room created before this rule existed has no deadline yet: it keeps the earliest promise
  // it was already given — its stored expiry, or its own lifetime from this first touch.
  room.publicDeadline=room.publicDeadline??Math.min(room.expiresAt,now+publicRoomLifetime(room.puzzle));
  room.expiresAt=room.publicDeadline;
}
// Public again after a spell as a private room: the day starts over, so the room does not come
// back already expired.
export function restartPublicLifetime(room:Room){if(room.visibility==='public')delete room.publicDeadline;}
