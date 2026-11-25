import {randomInt} from 'node:crypto';

const fail=(status,code,message)=>{throw Object.assign(new Error(message),{status,code});};
const validCode=value=>typeof value==='string'&&/^[1-9]\d{8}$/.test(value);
const validId=value=>Number.isSafeInteger(value)&&value>0;
const REASONS=['harassment','advertising','inappropriate','other'];
const DEFAULT_BLOCKED_WORDS=['傻逼','傻比','煞笔','操你妈','草你妈','去你妈','你妈死','死全家','fuck you','nigger'];
const normalized=value=>value.normalize('NFKC').toLowerCase().replace(/[\p{P}\p{Z}\p{Cf}\s]/gu,'');
const ONLINE_MS=90000;

/** Social identity is a random public code. All ownership uses the gateway's opaque identity.
 * The enclosing mobile service owns the single transaction and replay receipts.
 */
export function createMobileSocial({db,readProfile,replay,readRoom,authorizeRoom,roomCard,blockedWords=DEFAULT_BLOCKED_WORDS}){
 db.exec(`
 CREATE TABLE IF NOT EXISTS mobile_social_players(owner TEXT PRIMARY KEY,code TEXT NOT NULL UNIQUE,last_seen INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS mobile_friend_requests(sender TEXT NOT NULL,recipient TEXT NOT NULL,created_at INTEGER NOT NULL,PRIMARY KEY(sender,recipient));
 CREATE TABLE IF NOT EXISTS mobile_friends(owner TEXT NOT NULL,peer TEXT NOT NULL,created_at INTEGER NOT NULL,PRIMARY KEY(owner,peer));
 CREATE TABLE IF NOT EXISTS mobile_social_blocks(owner TEXT NOT NULL,peer TEXT NOT NULL,created_at INTEGER NOT NULL,PRIMARY KEY(owner,peer));
 CREATE TABLE IF NOT EXISTS mobile_social_rates(owner TEXT NOT NULL,scope TEXT NOT NULL,window_start INTEGER NOT NULL,last_at INTEGER NOT NULL,hits INTEGER NOT NULL,PRIMARY KEY(owner,scope));
 CREATE TABLE IF NOT EXISTS mobile_private_messages(id INTEGER PRIMARY KEY AUTOINCREMENT,sender TEXT NOT NULL,recipient TEXT NOT NULL,kind TEXT NOT NULL,data TEXT NOT NULL,sent_at INTEGER NOT NULL);
 CREATE INDEX IF NOT EXISTS mobile_private_sender ON mobile_private_messages(sender,recipient,id);
 CREATE INDEX IF NOT EXISTS mobile_private_recipient ON mobile_private_messages(recipient,sender,id);
 CREATE TABLE IF NOT EXISTS mobile_private_reads(owner TEXT NOT NULL,peer TEXT NOT NULL,through_id INTEGER NOT NULL,PRIMARY KEY(owner,peer));
 CREATE TABLE IF NOT EXISTS mobile_chat_reports(id INTEGER PRIMARY KEY AUTOINCREMENT,reporter TEXT NOT NULL,source TEXT NOT NULL,message_id INTEGER NOT NULL,target TEXT NOT NULL,reason TEXT NOT NULL,evidence TEXT NOT NULL,created_at INTEGER NOT NULL,status TEXT NOT NULL DEFAULT 'pending',UNIQUE(reporter,source,message_id));
 CREATE INDEX IF NOT EXISTS mobile_reports_status ON mobile_chat_reports(status,created_at);
 `);
 const prohibited=blockedWords.filter(word=>typeof word==='string'&&word.length).map(normalized);
 /** Run before the enclosing request transaction so failed lookups cannot roll back their rate counters.
  * A short separate IMMEDIATE transaction also serializes counters across service instances.
  */
 function guard(request,input,url,now){
  const search=request.method==='GET'&&url.pathname==='/api/mobile/social/search';
  const requestFriend=request.method==='POST'&&url.pathname==='/api/mobile/social/requests';
  if(!search&&!requestFriend)return;
  if(requestFriend){
   if(typeof input.requestId!=='string'||!/^[a-f0-9]{32}$/.test(input.requestId)||!validCode(input.code))return;
   if(db.prepare("SELECT 1 FROM mobile_requests WHERE owner=? AND scope='social:/requests' AND request_id=?").get(request.identity,input.requestId))return;
   const peer=db.prepare('SELECT owner FROM mobile_social_players WHERE code=?').get(input.code)?.owner;
   if(peer===request.identity||peer&&(eitherBlocked(request.identity,peer)||isFriend(request.identity,peer)||db.prepare('SELECT 1 FROM mobile_friend_requests WHERE sender=? AND recipient=?').get(request.identity,peer)))return;
  }
  const scope=search?'search':'request',window=search?60000:3600000,maximum=search?60:30,gap=search?0:2000,windowStart=Math.floor(now/window)*window;
  db.exec('BEGIN IMMEDIATE');
  try{
   const row=db.prepare('SELECT * FROM mobile_social_rates WHERE owner=? AND scope=?').get(request.identity,scope);
   const hits=row?.window_start===windowStart?row.hits:0;
   if(hits>=maximum||gap&&row&&now-row.last_at<gap)fail(429,search?'SEARCH_RATE_LIMIT':'REQUEST_RATE_LIMIT',search?'查找较频繁，请稍后再试':'申请发送较快，请稍后再试');
   db.prepare('INSERT INTO mobile_social_rates VALUES(?,?,?,?,?) ON CONFLICT(owner,scope) DO UPDATE SET window_start=excluded.window_start,last_at=excluded.last_at,hits=excluded.hits').run(request.identity,scope,windowStart,now,hits+1);
   db.exec('COMMIT');
  }catch(error){db.exec('ROLLBACK');throw error;}
 }
 function ensure(owner,now,touch=false){
  let row=db.prepare('SELECT code,last_seen FROM mobile_social_players WHERE owner=?').get(owner);
  if(!row){let code;do{code=String(randomInt(100000000,1000000000));}while(db.prepare('SELECT 1 FROM mobile_social_players WHERE code=?').get(code));const lastSeen=touch?now:0;db.prepare('INSERT INTO mobile_social_players VALUES(?,?,?)').run(owner,code,lastSeen);row={code,last_seen:lastSeen};}
  else if(touch){db.prepare('UPDATE mobile_social_players SET last_seen=? WHERE owner=?').run(now,owner);row.last_seen=now;}
  return row;
 }
 const touch=(owner,now)=>ensure(owner,now,true);
 function person(owner,now){const row=ensure(owner,now),p=readProfile(owner,now);return {code:row.code,name:p.name,level:p.level,online:now-row.last_seen<ONLINE_MS,lastSeenAt:row.last_seen};}
 function peerOf(code,owner){if(!validCode(code))fail(400,'INVALID_PLAYER_CODE','请填写9位好友编号');const row=db.prepare('SELECT owner FROM mobile_social_players WHERE code=?').get(code);if(!row)fail(404,'PLAYER_NOT_FOUND','没有找到这个玩家');if(row.owner===owner)fail(400,'SELF_NOT_ALLOWED','不能对自己进行此操作');return row.owner;}
 const isFriend=(owner,peer)=>Boolean(db.prepare('SELECT 1 FROM mobile_friends WHERE owner=? AND peer=?').get(owner,peer));
 const ownBlocked=(owner,peer)=>Boolean(db.prepare('SELECT 1 FROM mobile_social_blocks WHERE owner=? AND peer=?').get(owner,peer));
 const eitherBlocked=(owner,peer)=>ownBlocked(owner,peer)||ownBlocked(peer,owner);
 function requireFriend(owner,peer){if(eitherBlocked(owner,peer))fail(403,'PLAYER_BLOCKED','无法与这位玩家互动');if(!isFriend(owner,peer))fail(403,'FRIEND_REQUIRED','请先添加对方为好友');}
 const through=(owner,peer)=>db.prepare('SELECT through_id FROM mobile_private_reads WHERE owner=? AND peer=?').get(owner,peer)?.through_id??0;
 const unread=(owner,peer)=>Number(db.prepare('SELECT COUNT(*) n FROM mobile_private_messages WHERE recipient=? AND sender=? AND id>?').get(owner,peer,through(owner,peer)).n);
 function messageView(row,owner,now){return {id:Number(row.id),kind:row.kind,...JSON.parse(row.data),from:ensure(row.sender,now).code,to:ensure(row.recipient,now).code,mine:row.sender===owner,sentAt:row.sent_at};}
 function view(owner,now){
  const friendRows=db.prepare('SELECT peer FROM mobile_friends WHERE owner=? ORDER BY created_at DESC').all(owner).filter(row=>!eitherBlocked(owner,row.peer));
  const friends=friendRows.map(row=>person(row.peer,now));
  // One room scan per snapshot, rather than one full scan for every online friend.
  if(friends.some(player=>player.online)){
   const currentRooms=new Map(),wanted=new Set(friendRows.map(row=>row.peer));
   for(const row of db.prepare("SELECT data FROM mobile_rooms WHERE visibility='public' AND closed_at IS NULL AND completed_at IS NULL ORDER BY created_at DESC").all()){
    const room=JSON.parse(row.data);if(room.expiresAt<=now)continue;
    for(const member of room.members){if(wanted.has(member.guestId)&&now-member.lastSeen<ONLINE_MS&&!currentRooms.has(member.guestId))currentRooms.set(member.guestId,room);}
   }
   friends.forEach((player,index)=>{const room=currentRooms.get(friendRows[index].peer);if(player.online&&room)player.room=roomCard(room,now);});
  }
  const incoming=db.prepare('SELECT sender,created_at FROM mobile_friend_requests WHERE recipient=? ORDER BY created_at DESC').all(owner).filter(row=>!eitherBlocked(owner,row.sender)).map(row=>({...person(row.sender,now),createdAt:row.created_at}));
  const outgoing=db.prepare('SELECT recipient,created_at FROM mobile_friend_requests WHERE sender=? ORDER BY created_at DESC').all(owner).filter(row=>!eitherBlocked(owner,row.recipient)).map(row=>({...person(row.recipient,now),createdAt:row.created_at}));
  const conversations=friends.flatMap(player=>{const peer=db.prepare('SELECT owner FROM mobile_social_players WHERE code=?').get(player.code).owner;const latest=db.prepare('SELECT * FROM mobile_private_messages WHERE (sender=? AND recipient=?) OR (sender=? AND recipient=?) ORDER BY id DESC LIMIT 1').get(owner,peer,peer,owner);return latest?[{peer:player,lastMessage:messageView(latest,owner,now),unread:unread(owner,peer)}]:[];}).sort((a,b)=>b.lastMessage.id-a.lastMessage.id);
  const blocked=db.prepare('SELECT peer FROM mobile_social_blocks WHERE owner=? ORDER BY created_at DESC').all(owner).map(row=>person(row.peer,now));
  return {self:person(owner,now),friends,requests:{incoming,outgoing},conversations,blocked,unread:conversations.reduce((count,item)=>count+item.unread,0),serverTime:now};
 }
 const removeFriend=(owner,peer)=>{db.prepare('DELETE FROM mobile_friends WHERE (owner=? AND peer=?) OR (owner=? AND peer=?)').run(owner,peer,peer,owner);db.prepare('DELETE FROM mobile_friend_requests WHERE (sender=? AND recipient=?) OR (sender=? AND recipient=?)').run(owner,peer,peer,owner);};
 const friendCapacity=owner=>{if(Number(db.prepare('SELECT COUNT(*) n FROM mobile_friends WHERE owner=?').get(owner).n)>=100)fail(409,'FRIENDS_FULL','好友数量已达100位');};
 function report(owner,input,request,now){
  if(!['room','private'].includes(input.source)||!validId(input.messageId)||!REASONS.includes(input.reason))fail(400,'INVALID_REPORT','请选择要举报的消息和举报原因');
  let row,target,evidence;
  if(input.source==='private'){
   row=db.prepare('SELECT * FROM mobile_private_messages WHERE id=?').get(input.messageId);
   if(!row||row.sender!==owner&&row.recipient!==owner)fail(404,'MESSAGE_NOT_FOUND','无法举报这条消息');
   target=row.sender;evidence=messageView(row,owner,now);
  }else{
   if(typeof input.roomId!=='string'||!/^[a-f0-9]{32}$/.test(input.roomId))fail(400,'INVALID_ROOM','房间编号无效');
   const room=readRoom(input.roomId);authorizeRoom(room,request,now);
   row=db.prepare('SELECT * FROM mobile_chat WHERE id=? AND room_id=?').get(input.messageId,input.roomId);
   if(!row)fail(404,'MESSAGE_NOT_FOUND','无法举报这条消息');target=row.owner;evidence={...JSON.parse(row.data),roomId:input.roomId};
  }
  if(target===owner)fail(400,'SELF_REPORT_NOT_ALLOWED','不能举报自己的消息');
  const old=db.prepare('SELECT id FROM mobile_chat_reports WHERE reporter=? AND source=? AND message_id=?').get(owner,input.source,input.messageId);
  if(old)return {ok:true,reportId:Number(old.id),duplicate:true,serverTime:now};
  if(Number(db.prepare('SELECT COUNT(*) n FROM mobile_chat_reports WHERE reporter=? AND created_at>?').get(owner,now-86400000).n)>=10)fail(429,'REPORT_RATE_LIMIT','今日举报次数已达上限，请稍后再试');
  const result=db.prepare('INSERT INTO mobile_chat_reports(reporter,source,message_id,target,reason,evidence,created_at) VALUES(?,?,?,?,?,?,?)').run(owner,input.source,input.messageId,target,input.reason,JSON.stringify(evidence),now);
  return {ok:true,reportId:Number(result.lastInsertRowid),duplicate:false,serverTime:now};
 }
 function route(request,p,input,url,now){
  const prefix='/api/mobile/social',part=url.pathname.slice(prefix.length),method=request.method,owner=p.id;
  if(!url.pathname.startsWith(prefix))return null;
  if(!part&&method==='GET')return view(owner,now);
  if(part==='/search'&&method==='GET'){
   const code=url.searchParams.get('code');if(!validCode(code))fail(400,'INVALID_PLAYER_CODE','请填写9位好友编号');
   const row=db.prepare('SELECT owner FROM mobile_social_players WHERE code=?').get(code);if(!row)fail(404,'PLAYER_NOT_FOUND','没有找到这个玩家');
   const peer=row.owner;let relationship=peer===owner?'self':ownBlocked(owner,peer)?'blocked':isFriend(owner,peer)?'friend':db.prepare('SELECT 1 FROM mobile_friend_requests WHERE sender=? AND recipient=?').get(peer,owner)?'incoming':db.prepare('SELECT 1 FROM mobile_friend_requests WHERE sender=? AND recipient=?').get(owner,peer)?'outgoing':'none';
   return {player:person(peer,now),relationship,serverTime:now};
  }
  if(part==='/messages'&&method==='GET'){
   const peer=peerOf(url.searchParams.get('peer'),owner);requireFriend(owner,peer);
   const beforeText=url.searchParams.get('before'),before=beforeText===null?Number.MAX_SAFE_INTEGER:Number(beforeText);if(!validId(before))fail(400,'INVALID_MESSAGE_CURSOR','消息游标无效');
   const rows=db.prepare('SELECT * FROM mobile_private_messages WHERE ((sender=? AND recipient=?) OR (sender=? AND recipient=?)) AND id<? ORDER BY id DESC LIMIT 51').all(owner,peer,peer,owner,before),hasMore=rows.length>50;
   return {peer:person(peer,now),messages:rows.slice(0,50).reverse().map(row=>messageView(row,owner,now)),hasMore,unread:unread(owner,peer),serverTime:now};
  }
  if(method!=='POST')fail(405,'METHOD_NOT_ALLOWED','请求方式无效');
  if(!['/requests','/requests/respond','/friends/remove','/block','/unblock','/messages','/messages/read','/reports'].includes(part))fail(404,'NOT_FOUND','社交接口不存在');
  return replay(p,'social:'+part,input,now,()=>{
   if(part==='/reports')return report(owner,input,request,now);
   const peer=peerOf(part.startsWith('/messages')?input.peer:input.code,owner);
   if(part==='/requests'){
    if(eitherBlocked(owner,peer))fail(403,'PLAYER_BLOCKED','无法与这位玩家互动');
    if(isFriend(owner,peer)||db.prepare('SELECT 1 FROM mobile_friend_requests WHERE sender=? AND recipient=?').get(owner,peer))return view(owner,now);
    friendCapacity(owner);friendCapacity(peer);
    if(Number(db.prepare('SELECT COUNT(*) n FROM mobile_friend_requests WHERE sender=?').get(owner).n)>=30)fail(429,'TOO_MANY_REQUESTS','待处理好友申请较多，请稍后再试');
    if(Number(db.prepare('SELECT COUNT(*) n FROM mobile_friend_requests WHERE recipient=?').get(peer).n)>=50)fail(409,'REQUESTS_FULL','对方待处理的申请已满');
    db.prepare('INSERT INTO mobile_friend_requests VALUES(?,?,?)').run(owner,peer,now);return view(owner,now);
   }
   if(part==='/requests/respond'){
    if(typeof input.accept!=='boolean')fail(400,'INVALID_RESPONSE','申请处理方式无效');
    const exists=db.prepare('SELECT 1 FROM mobile_friend_requests WHERE sender=? AND recipient=?').get(peer,owner);
    if(!exists){if(isFriend(owner,peer))return view(owner,now);fail(404,'REQUEST_NOT_FOUND','好友申请已处理或不存在');}
    if(input.accept){if(eitherBlocked(owner,peer))fail(403,'PLAYER_BLOCKED','无法与这位玩家互动');friendCapacity(owner);friendCapacity(peer);db.prepare('INSERT OR IGNORE INTO mobile_friends VALUES(?,?,?)').run(owner,peer,now);db.prepare('INSERT OR IGNORE INTO mobile_friends VALUES(?,?,?)').run(peer,owner,now);}
    db.prepare('DELETE FROM mobile_friend_requests WHERE (sender=? AND recipient=?) OR (sender=? AND recipient=?)').run(owner,peer,peer,owner);return view(owner,now);
   }
   if(part==='/friends/remove'){removeFriend(owner,peer);return view(owner,now);}
   if(part==='/block'){db.prepare('INSERT OR IGNORE INTO mobile_social_blocks VALUES(?,?,?)').run(owner,peer,now);removeFriend(owner,peer);return view(owner,now);}
   if(part==='/unblock'){db.prepare('DELETE FROM mobile_social_blocks WHERE owner=? AND peer=?').run(owner,peer);return view(owner,now);}
   requireFriend(owner,peer);
   if(part==='/messages/read'){
    const latest=Number(db.prepare('SELECT MAX(id) id FROM mobile_private_messages WHERE (sender=? AND recipient=?) OR (sender=? AND recipient=?)').get(owner,peer,peer,owner).id??0);
    const mark=input.through??latest;if(!Number.isSafeInteger(mark)||mark<0||mark>latest)fail(400,'INVALID_READ_CURSOR','已读位置无效');
    db.prepare('INSERT INTO mobile_private_reads VALUES(?,?,?) ON CONFLICT(owner,peer) DO UPDATE SET through_id=MAX(through_id,excluded.through_id)').run(owner,peer,mark);
    return {ok:true,unread:unread(owner,peer),serverTime:now};
   }
   let data;
   if(input.kind==='text'){
    if(typeof input.text!=='string')fail(400,'INVALID_MESSAGE','请填写消息内容');const text=input.text.trim();
    if(!text||Array.from(text).length>2000||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(text))fail(400,'INVALID_MESSAGE','消息请填写1～2000个字');
    if(prohibited.some(word=>normalized(text).includes(word)))fail(400,'MESSAGE_BLOCKED','消息包含不适合发送的词语，请修改');data={text};
   }else if(input.kind==='room-invite'){
    if(typeof input.roomId!=='string'||!/^[a-f0-9]{32}$/.test(input.roomId))fail(400,'INVALID_ROOM','房间编号无效');
    const room=readRoom(input.roomId);authorizeRoom(room,request,now);
    if(room.completedAt!==null||room.expiresAt<=now||room.acceptingNew===false)fail(409,'ROOM_NOT_JOINABLE','这个房间暂时无法邀请');
    if(room.visibility==='private'&&room.ownerId!==owner&&input.inviteCode!==room.mobileInviteCode)fail(403,'INVITE_REQUIRED','请使用有效的房间邀请码');
    data={roomId:room.id,title:roomCard(room,now).title,pieces:room.mobilePieces,visibility:room.visibility,...(room.mobileInviteCode?{inviteCode:room.mobileInviteCode}:{})};
   }else fail(400,'INVALID_MESSAGE_KIND','消息类型无效');
   const recent=db.prepare('SELECT sent_at FROM mobile_private_messages WHERE sender=? ORDER BY id DESC LIMIT 1').get(owner);if(recent&&now-recent.sent_at<3000)fail(429,'MESSAGE_RATE_LIMIT','消息发送较快，请稍后');
   const inserted=db.prepare('INSERT INTO mobile_private_messages(sender,recipient,kind,data,sent_at) VALUES(?,?,?,?,?)').run(owner,peer,input.kind,JSON.stringify(data),now);
   const row=db.prepare('SELECT * FROM mobile_private_messages WHERE id=?').get(inserted.lastInsertRowid);return {message:messageView(row,owner,now),serverTime:now};
  });
 }
 const areFriends=(owner,peer)=>isFriend(owner,peer)&&isFriend(peer,owner)&&!eitherBlocked(owner,peer);
 return {guard,touch,person,view,route,blocked:ownBlocked,areFriends};
}
