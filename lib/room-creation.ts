import { createPuzzle, type PuzzleState } from './puzzle-engine';
import type { RoomSnapshot } from './room-engine';
import type { RoomTicket } from './room-client';

export const INITIAL_STATE_FORMAT='seed-v1';
export type SeedRoomTicket={
 token:string;playerId:string;initialState:typeof INITIAL_STATE_FORMAT;
 room:Omit<RoomSnapshot,'puzzle'>&{puzzle:Omit<PuzzleState,'groups'>};
};

// Only new, untouched puzzles use this format. Existing rooms always send
// authoritative groups/deltas, so the seed can never reset saved progress.
export function expandCreatedTicket(ticket:RoomTicket|SeedRoomTicket):RoomTicket{
 if(!('initialState' in ticket))return ticket;
 if(ticket.initialState!==INITIAL_STATE_FORMAT)throw new Error('暂时无法开始');
 const seed=ticket.room.puzzle;
 if(seed.version!==1||seed.layout!=='square'||!Number.isInteger(seed.seed)||seed.seed<0||seed.seed>0xffffffff||seed.elapsed!==0||ticket.room.revision!==0)throw new Error('暂时无法开始');
 const puzzle=createPuzzle(seed.imageId,seed.cols,seed.rows,seed.seed);
 return {token:ticket.token,playerId:ticket.playerId,room:{...ticket.room,puzzle}};
}

// At most one fresh server-authenticated creation response is kept in memory.
// Stored tickets and old revisits still go through normal server admission.
let fresh:{ticket:RoomTicket;until:number}|null=null;
export function rememberCreatedTicket(ticket:RoomTicket,now=Date.now()){
 fresh={ticket,until:now+15000};
}
export function takeCreatedTicket(roomId:string,now=Date.now()):RoomTicket|null{
 if(!fresh)return null;
 if(now>=fresh.until){fresh=null;return null;}
 if(fresh.ticket.room.id!==roomId)return null;
 const ticket=fresh.ticket;fresh=null;return ticket;
}
