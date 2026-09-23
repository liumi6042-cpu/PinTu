import {localDb} from '@/lib/local-db';
import {requireAccount,currentAccount} from '@/lib/account-store';
import {requireAdmin} from '@/lib/admin-store';
import {verifiedPassword} from '@/lib/account-security';
import {body,json,failure} from '@/lib/room-store';
import {chatText} from '@/lib/room-chat';
import {RoomError} from '@/lib/room-engine';
import {settings} from '@/lib/site-settings';
async function feed(){return (await localDb().prepare('SELECT id,user_id AS playerId,name,message AS text,sent_at AS sentAt FROM puzzle_lobby_chat WHERE hidden=0 AND sent_at>? ORDER BY id DESC LIMIT 100').bind(Date.now()-7*86400000).all()).results.reverse();}
export async function GET(request:Request){try{const user=await currentAccount(request);return json({messages:await feed(),canModerate:!!user&&(settings().PUZZLE_ADMIN_IDS||'').split(',').map(x=>x.trim()).includes(user.id)});}catch(e){return failure(e);}}
export async function POST(request:Request){try{
 const input=await body(request),db=localDb();
 if(input.action==='hide'){const admin=await requireAdmin(request);await verifiedPassword(request,input.password);if(!Number.isSafeInteger(input.id)||Number(input.id)<1)throw new RoomError('消息无效');await db.batch([db.prepare('UPDATE puzzle_lobby_chat SET hidden=1 WHERE id=?').bind(input.id),db.prepare('INSERT INTO puzzle_admin_audit(id,actor_id,action,target_id,reason,created_at) VALUES(?,?,?,?,?,?)').bind(crypto.randomUUID().replaceAll('-',''),admin.id,'hide-lobby-chat',String(input.id),'Hide public chat message',Date.now())]);return json({messages:await feed()});}
 const user=await requireAccount(request),text=chatText(input.text),op=input.requestId,now=Date.now();if(!text||typeof op!=='string'||!/^[a-f0-9]{32}$/.test(op))throw new RoomError('消息请填写1–300个字');
 const existing=()=>db.prepare('SELECT message FROM puzzle_lobby_chat WHERE user_id=? AND request_id=?').bind(user.id,op).first<{message:string}>();let old=await existing();
 if(!old){await db.prepare('INSERT OR IGNORE INTO puzzle_lobby_chat(user_id,request_id,name,message,sent_at) SELECT ?,?,?,?,? WHERE NOT EXISTS(SELECT 1 FROM puzzle_lobby_chat WHERE user_id=? AND sent_at>?) AND (SELECT COUNT(*) FROM puzzle_lobby_chat WHERE user_id=? AND sent_at>?)<20').bind(user.id,op,user.name,text,now,user.id,now-2000,user.id,now-60000).run();old=await existing();}
 if(!old)throw new RoomError('发送太快，请稍后重试',429);if(old.message!==text)throw new RoomError('消息编号已使用',409);
 // Retain enough recent identities for rate limiting while keeping the visible feed at 100.
 await db.prepare('DELETE FROM puzzle_lobby_chat WHERE sent_at<? OR (id < COALESCE((SELECT id FROM puzzle_lobby_chat ORDER BY id DESC LIMIT 1 OFFSET 999),0) AND sent_at<?)').bind(now-7*86400000,now-60000).run();
 return json({messages:await feed()});
 }catch(e){return failure(e);}}
