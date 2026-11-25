import { localDb } from './local-db';
import { RoomError,type Room } from './room-engine';
import { makeAssistanceGrant } from './assistance-engine';
import { assistanceLimit,type AssistanceGrant,type AssistanceKind } from './assistance-policy';

export async function roomAssistance(roomId:string,identity:string){
 const rows=await localDb().prepare('SELECT request_id AS requestId,kind,expires_at AS expiresAt,piece_ids AS pieces FROM puzzle_assistance_grants WHERE room_id=? AND identity=? ORDER BY expires_at,request_id').bind(roomId,identity).all<Omit<AssistanceGrant,'pieceIds'>&{pieces:string}>();
 return rows.results.map(({pieces,...row})=>({...row,pieceIds:JSON.parse(pieces) as number[]}));
}
export async function grantRoomAssistance(room:Room,identity:string,kind:AssistanceKind,requestId:string,now:number){
 const existing=await roomAssistance(room.id,identity),excluded=new Set(Object.entries(room.leases).filter(([,lease])=>lease.expires>now).map(([id])=>Number(id)));
 let grant:AssistanceGrant;
 try{grant=makeAssistanceGrant(existing,kind,requestId,room.puzzle,now,excluded);}catch(error){throw new RoomError((error as Error).message,409);}
 if(existing.some(g=>g.requestId===grant.requestId))return existing;
 // Count, active-window check and insertion are one atomic statement, including across tabs.
 await localDb().prepare(`INSERT OR IGNORE INTO puzzle_assistance_grants(room_id,identity,request_id,kind,expires_at,piece_ids)
 SELECT ?,?,?,?,?,? WHERE (SELECT COUNT(*) FROM puzzle_assistance_grants WHERE room_id=? AND identity=? AND kind=?)<?
 AND NOT EXISTS(SELECT 1 FROM puzzle_assistance_grants WHERE room_id=? AND identity=? AND kind=? AND expires_at>?)
 AND EXISTS(SELECT 1 FROM puzzle_rooms WHERE id=? AND expires_at>?)`).bind(room.id,identity,requestId,kind,grant.expiresAt,JSON.stringify(grant.pieceIds),room.id,identity,kind,assistanceLimit(kind,room.puzzle.cols*room.puzzle.rows),room.id,identity,kind,now,room.id,now).run();
 return roomAssistance(room.id,identity);
}
