import {env} from 'cloudflare:workers';
import {localDb} from './local-db';
import {ONLINE_MS,type Room,type Member} from './room-engine';

const recentWrites=new WeakMap<object,Map<string,{at:number;pending?:Promise<void>}>>();
const identity=(member:Member)=>member.accountId||member.guestId;
const validOwner=(owner:string)=>/^(?:[a-f0-9]{32}|guest:[a-f0-9]{64})$/.test(owner);

/** Record only live, seated Web identities. Keep the heartbeat hot path write-free. */
export async function recordRecentTablemates(room:Room,member:Member,now=Date.now()){
 if(room.botRoom||(room as Room&{diagnostic?:boolean}).diagnostic||member.bot)return;
 const owner=identity(member);if(!owner||!validOwner(owner))return;
 const peers=[...new Set(room.members.filter(peer=>!peer.bot&&now-peer.lastSeen<ONLINE_MS).map(identity).filter((peer):peer is string=>!!peer&&peer!==owner&&validOwner(peer)))];
 if(!peers.length)return;
 const binding=(env as unknown as {PUZZLE_DB:object}).PUZZLE_DB;
 let cache=recentWrites.get(binding);if(!cache){cache=new Map();recentWrites.set(binding,cache);}
 const key=room.id+':'+owner,previous=cache.get(key);
 if(previous&&now>=previous.at&&now-previous.at<60000){await previous.pending;return;}
 for(const [key,value] of cache)if(!value.pending&&(now<value.at||now-value.at>=60000))cache.delete(key);
 const entry:{at:number;pending?:Promise<void>}={at:now};cache.set(key,entry);
 entry.pending=(async()=>{
  const db=localDb(),commands=[];
  for(const person of [owner,...peers])commands.push(db.prepare('INSERT OR IGNORE INTO puzzle_managed_invitation_codes(owner,code) VALUES(?,?)').bind(person,crypto.randomUUID().replaceAll('-','').slice(0,12)));
  for(const peer of peers)for(const [a,b] of [[owner,peer],[peer,owner]])commands.push(db.prepare(`INSERT INTO puzzle_shared_recent_tablemates(owner_id,peer_id,room_id,room_title,seen_at) VALUES(?,?,?,?,?)
   ON CONFLICT(owner_id,peer_id) DO UPDATE SET room_id=excluded.room_id,room_title=excluded.room_title,seen_at=excluded.seen_at
   WHERE excluded.seen_at>seen_at AND (excluded.room_id<>room_id OR excluded.seen_at-seen_at>=60000)`).bind(a,b,room.id,room.title??'',now));
  for(const owner of [identity(member)!,...peers])commands.push(db.prepare(`DELETE FROM puzzle_shared_recent_tablemates WHERE owner_id=? AND peer_id NOT IN
   (SELECT peer_id FROM puzzle_shared_recent_tablemates WHERE owner_id=? ORDER BY seen_at DESC,peer_id LIMIT 50)`).bind(owner,owner));
  await db.batch(commands);
 })();
 // Best-effort: a failed write must never fail the join or heartbeat it rides on; the next call retries.
 try{await entry.pending;delete entry.pending;}catch(error){if(cache.get(key)===entry)cache.delete(key);console.error('Recent tablemates not recorded',error instanceof Error?error.message:error);}
}
