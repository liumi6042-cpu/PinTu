import { localDb } from './local-db';
import { RoomError, ONLINE_MS, type Member } from './room-engine';
import { CHAT_HISTORY, CHAT_INTERVAL, CHAT_PER_MINUTE, type ChatFeed, type ChatMessage } from './room-chat';

const fields='id,player_id AS playerId,name,color,message AS text,sent_at AS sentAt';
export async function readChat(roomId:string,after=0):Promise<ChatFeed> {
 const data=await localDb().prepare(`SELECT ${fields} FROM puzzle_room_chat WHERE room_id=? AND id>? ORDER BY id DESC LIMIT ?`).bind(roomId,after,CHAT_HISTORY).all<ChatMessage>();
 const messages=data.results.reverse();return {messages,cursor:messages.at(-1)?.id??after};
}
export async function sendChat(roomId:string,member:Member,identity:string,requestId:string,text:string,now:number):Promise<ChatMessage> {
 const database=localDb();
 const existing=()=>database.prepare(`SELECT ${fields} FROM puzzle_room_chat WHERE room_id=? AND identity=? AND request_id=?`).bind(roomId,identity,requestId).first<ChatMessage>();
 const before=await existing();
 if(before){if(before.text!==text)throw new RoomError('这条消息已发送，请使用新的消息编号',409);return before;}
 // Atomic admission and rate checks; chat never updates the puzzle row.
 await database.prepare(`INSERT OR IGNORE INTO puzzle_room_chat(room_id,identity,request_id,player_id,name,color,message,sent_at)
 SELECT ?,?,?,?,?,?,?,? WHERE
 NOT EXISTS(SELECT 1 FROM puzzle_room_chat WHERE identity=? AND sent_at>?)
 AND (SELECT COUNT(*) FROM puzzle_room_chat WHERE identity=? AND sent_at>?)<?
 AND EXISTS(SELECT 1 FROM puzzle_rooms r JOIN json_each(r.data,'$.members') m
  WHERE r.id=? AND r.expires_at>? AND COALESCE(json_extract(r.data,'$.visibility'),'')!='solo'
  AND json_extract(m.value,'$.id')=? AND json_extract(m.value,'$.lastSeen')>?
  AND NOT EXISTS(SELECT 1 FROM puzzle_room_moderation WHERE room_id=r.id AND closed=1))`)
 .bind(roomId,identity,requestId,member.id,member.name,member.color,text,now,
 identity,now-CHAT_INTERVAL,identity,now-60000,CHAT_PER_MINUTE,roomId,now,member.id,now-ONLINE_MS).run();
 const sent=await existing();
 if(!sent)throw new RoomError('发送太快了，请稍等片刻再试',429);
 if(sent.text!==text)throw new RoomError('这条消息已发送，请使用新的消息编号',409);
 return sent;
}
