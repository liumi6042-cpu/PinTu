import {localDb} from './local-db';
import {playerName} from './player-name';
import {RoomError,type Room} from './room-engine';
import {pieceBand} from './piece-policy';
import {readManagedContent,effectiveManagedAlbums,managedDailyPuzzle,type ManagedContentSnapshot} from './managed-content';
import {newManagedProfile,xpForManagedLevel,TASK_DEFINITIONS,managedDay,recordManagedRoom,managedGift,claimManagedGift,purchaseManagedAlbum,craftManagedDecoration,shareManagedInvitation,managedBeginnerTasks} from './managed-economy-model.mjs';
import {isRetiredDecoration,availableDecorationId} from './decoration-policy.mjs';

type State=Record<string,any>;
type Cursor={id:string;artKey:string;color:string};
const validOwner=(owner:string)=>/^(?:[a-f0-9]{32}|guest:[a-f0-9]{64})$/.test(owner);
const readState=(data:string):State=>JSON.parse(data);
// Album overlays are resolved by the shared daily reader, not a Web randomizer.
export function managedAlbumImages(content:ManagedContentSnapshot,now=Date.now()):any[]{
 return effectiveManagedAlbums(content,now);
}
const photos=(content:ManagedContentSnapshot):any[]=>((content as any).photos??(content as any).deliveredPhotos??[]);
const settings=(content:ManagedContentSnapshot):any=>(content as any).gameSettings;
const taskRewards=(content:ManagedContentSnapshot):any=>(content as any).taskRewards;

async function activate(content:ManagedContentSnapshot|null,previous?:Room,occurredAt?:number){
 const db=localDb(),existing=await db.prepare("SELECT value FROM puzzle_managed_settings WHERE key='activated_at'").first<number>('value');
 if(existing)return existing;
 const now=Date.now(),commands=[db.prepare(`INSERT OR IGNORE INTO puzzle_managed_room_baselines(room_id,owner,count)
  SELECT r.id,c.key,CAST(json_extract(c.value,'$.count') AS INTEGER) FROM puzzle_rooms r,json_each(r.data,'$.achievements.contributors') c
  WHERE json_extract(c.value,'$.count')>0 AND NOT EXISTS(SELECT 1 FROM puzzle_managed_settings WHERE key='activated_at')`)];
 // The first post-commit hook receives the pre-commit room, so its new snap is
 // counted while all work predating activation remains a baseline.
 let activationAt=occurredAt??now;
 if(previous){
  const current=await db.prepare('SELECT data FROM puzzle_rooms WHERE id=?').bind(previous.id).first<{data:string}>();
  const owners=Object.keys(current?JSON.parse(current.data).achievements?.contributors??{}:previous.achievements?.contributors??{});
  if(current&&occurredAt===undefined)activationAt=Math.min(now,JSON.parse(current.data).lastPlayedAt??now);
  for(const owner of owners)commands.push(db.prepare(`INSERT OR REPLACE INTO puzzle_managed_room_baselines(room_id,owner,count)
   SELECT ?,?,? WHERE NOT EXISTS(SELECT 1 FROM puzzle_managed_settings WHERE key='activated_at')`).bind(previous.id,owner,previous.achievements?.contributors[owner]?.count??0));
 }
 commands.push(db.prepare("INSERT OR IGNORE INTO puzzle_managed_settings(key,value) VALUES('activated_at',?)").bind(activationAt));
 await db.batch(commands);return (await db.prepare("SELECT value FROM puzzle_managed_settings WHERE key='activated_at'").first<number>('value'))!;
}
async function stateFor(owner:string){
 if(!validOwner(owner))return {version:-1,state:newManagedProfile() as State};
 const row=await localDb().prepare('SELECT version,data FROM puzzle_managed_players WHERE owner=?').bind(owner).first<{version:number;data:string}>();
 return row?{version:row.version,state:readState(row.data)}:{version:-1,state:newManagedProfile() as State};
}
async function updateState(owner:string,transform:(state:State)=>Promise<void>|void){
 if(!validOwner(owner))throw new RoomError('玩家身份无效',401);
 const db=localDb();
 await db.prepare('INSERT OR IGNORE INTO puzzle_managed_players(owner,data,updated_at) VALUES(?,?,?)').bind(owner,JSON.stringify(newManagedProfile()),Date.now()).run();
 for(let retry=0;retry<8;retry++){
  const current=await stateFor(owner),before=JSON.stringify(current.state);await transform(current.state);const data=JSON.stringify(current.state);
  if(data===before)return current.state;
  const result=await db.prepare('UPDATE puzzle_managed_players SET data=?,version=version+1,updated_at=? WHERE owner=? AND version=?').bind(data,Date.now(),owner,current.version).run();
  if(result.meta.changes===1)return current.state;
 }
 throw new RoomError('个人进度正在同步，请稍后重试',409);
}
async function invitationCode(owner:string){
 const db=localDb(),old=await db.prepare('SELECT code FROM puzzle_managed_invitation_codes WHERE owner=?').bind(owner).first<string>('code');if(old)return old;
 for(let attempt=0;attempt<8;attempt++){
  const code=crypto.randomUUID().replaceAll('-','').slice(0,12);
  await db.prepare('INSERT OR IGNORE INTO puzzle_managed_invitation_codes(owner,code) VALUES(?,?)').bind(owner,code).run();
  const stored=await db.prepare('SELECT code FROM puzzle_managed_invitation_codes WHERE owner=?').bind(owner).first<string>('code');if(stored)return stored;
 }
 throw new RoomError('邀请码正在准备，请稍后重试',503);
}
async function linked(a:string,b:string){
 return !!await localDb().prepare(`SELECT 1 FROM puzzle_managed_invitation_bindings WHERE (invitee=? AND inviter=?) OR (invitee=? AND inviter=?)
  UNION ALL SELECT 1 FROM puzzle_managed_friends f WHERE f.owner=? AND f.peer=? AND EXISTS(SELECT 1 FROM puzzle_managed_friends r WHERE r.owner=? AND r.peer=?) LIMIT 1`).bind(a,b,b,a,a,b,b,a).first();
}
async function issueInvitationGifts(owner:string,content:ManagedContentSnapshot,now:number){
 const db=localDb(),rows=await db.prepare(`SELECT b.invitee,json_extract(p.data,'$.invitation.qualifiedAt') qualified_at,json_extract(p.data,'$.invitation.reward') reward
  FROM puzzle_managed_invitation_bindings b JOIN puzzle_managed_players p ON p.owner=b.invitee
  WHERE b.inviter=? AND json_extract(p.data,'$.invitation.inviter')=b.inviter AND json_extract(p.data,'$.invitation.qualifiedAt') IS NOT NULL
  ORDER BY qualified_at,b.invitee`).bind(owner).all<{invitee:string;qualified_at:number;reward:string|null}>();
 const counts=new Map<string,number>(),eligible=rows.results.filter(row=>{const day=managedDay(row.qualified_at),n=(counts.get(day)??0)+1;counts.set(day,n);return n<=3;});
 if(eligible.length)await updateState(owner,state=>{for(const row of eligible){const id='invite:'+row.invitee,reward=row.reward?JSON.parse(row.reward):{coins:0,xp:0};managedGift(state,id,{source:id,kind:'invite-friend',title:'邀友见面礼',coins:reward.coins??0,xp:reward.xp},row.qualified_at);}});
 return rows.results;
}

type FrozenOwner={owner:string;count:number;previousCount:number;cooperation:boolean;friend:boolean;invitation:{inviter:string;bound_at:number}|null};
type RewardSnapshot={releaseId:string;gameSettings:any;contributionXp:number;taskRewards:any;albums:any[];availableImageIds:string[]};
type RewardEventPayload={schema:1;room:Room;previous:Room;occurredAt:number;owners:FrozenOwner[];sourceReleaseId:string|null;snapshot:RewardSnapshot|null;resolution:{policy:'original-release'|'first-valid-release';releaseId:string;selectedAt:number}|null};
export type PreparedManagedRoomEvent={id:string;roomId:string;revision:number;occurredAt:number;payload:string;owners:string[]};
function rewardSnapshot(content:ManagedContentSnapshot,occurredAt:number):RewardSnapshot{
 const game=settings(content),rewards=taskRewards(content),coinXp=(value:any)=>({coins:value.coins??0,xp:value.xp});
 return {releaseId:content.releaseId,gameSettings:{progression:game.progression,collection:game.collection,decorations:game.decorations},contributionXp:game.energy.contributionXp,
  taskRewards:{tasks:rewards.tasks.map((task:any)=>({id:task.id,...coinXp(task)})),invitationShare:{...coinXp(rewards.invitationShare),dailyLimit:rewards.invitationShare.dailyLimit},invitationFriend:coinXp(rewards.invitationFriend),tenGrid:coinXp(rewards.tenGrid)},
  albums:managedAlbumImages(content,occurredAt),availableImageIds:photos(content).map(photo=>photo.id)};
}
function pinnedContent(value:RewardSnapshot):ManagedContentSnapshot{
 return {releaseId:value.releaseId,gameSettings:{...value.gameSettings,energy:{contributionXp:value.contributionXp}},taskRewards:value.taskRewards,albums:{albums:value.albums},photos:value.availableImageIds.map(id=>({id})),dailyRuntime:{managedImageIds:()=>new Set(),releasedImageIds:()=>new Set(),albumEntries:()=>[]}} as unknown as ManagedContentSnapshot;
}
/** Facts are captured before the room CAS, then root inserts this receipt directly
 * after its room UPDATE with WHERE changes()=1 in the same transaction. */
export async function prepareManagedRoomEvent(room:Room,previous:Room,content:ManagedContentSnapshot|null,occurredAt:number,options:{unavailable?:boolean}={}):Promise<PreparedManagedRoomEvent|null>{
 if(!content&&!options.unavailable)return null;
 const contributors=Object.entries(room.achievements?.contributors??{}).filter(([owner,c])=>validOwner(owner)&&Number.isSafeInteger(c.count)&&c.count>0&&!room.members.some(member=>member.bot&&(member.accountId||member.guestId)===owner));
 if(!contributors.some(([owner,c])=>c.count>(previous.achievements?.contributors[owner]?.count??0))&&!(!previous.completedAt&&room.completedAt))return null;
 await activate(content,previous,occurredAt);
 const db=localDb(),recent=await db.prepare('SELECT owner FROM puzzle_managed_recent_activity WHERE room_id=? AND created_at>=? AND created_at<=?').bind(room.id,occurredAt-120000,occurredAt).all<{owner:string}>();
 const active=new Set(recent.results.map(row=>row.owner));
 const queued=await db.prepare('SELECT payload FROM puzzle_managed_reward_events WHERE room_id=? AND occurred_at>=? AND occurred_at<=?').bind(room.id,occurredAt-120000,occurredAt).all<{payload:string}>();
 for(const row of queued.results)for(const participant of (JSON.parse(row.payload) as RewardEventPayload).owners)if(participant.count>participant.previousCount)active.add(participant.owner);
 const owners:FrozenOwner[]=[];
 for(const [owner,contribution] of contributors){
  const partners=room.members.filter(member=>!member.bot&&(member.accountId||member.guestId)!==owner&&member.lastSeen>0&&occurredAt-member.lastSeen<22000&&active.has((member.accountId||member.guestId)!));
  let friend=false;for(const partner of partners)if(await linked(owner,(partner.accountId||partner.guestId)!)){friend=true;break;}
  const invitation=await db.prepare('SELECT inviter,bound_at FROM puzzle_managed_invitation_bindings WHERE invitee=?').bind(owner).first<{inviter:string;bound_at:number}>();
  owners.push({owner,count:contribution.count,previousCount:previous.achievements?.contributors[owner]?.count??0,cooperation:partners.length>0,friend,invitation});
 }
 // Only the immutable facts needed for rewards are serialized. Bearer digests,
 // room tickets, image upload metadata and active drag state never enter receipts.
 const compact=(value:Room)=>({id:value.id,revision:value.revision,puzzle:{imageId:value.puzzle.imageId,cols:value.puzzle.cols,rows:value.puzzle.rows},createdAt:value.createdAt,lastPlayedAt:value.lastPlayedAt,completedAt:value.completedAt,members:value.members.map(member=>({id:member.id,lastSeen:member.lastSeen,accountId:member.accountId,guestId:member.guestId,bot:member.bot})),achievements:value.achievements}) as Room;
 const payload:RewardEventPayload={schema:1,room:compact(room),previous:compact(previous),occurredAt,owners,sourceReleaseId:content?.releaseId??null,snapshot:content?rewardSnapshot(content,occurredAt):null,resolution:content?{policy:'original-release',releaseId:content.releaseId,selectedAt:occurredAt}:null};
 return {id:'room:'+room.id+':'+room.revision,roomId:room.id,revision:room.revision,occurredAt,payload:JSON.stringify(payload),owners:owners.map(item=>item.owner)};
}
export async function managedRewardStatus(owner:string){
 const db=localDb(),pending=await db.prepare(`SELECT COUNT(*) count,SUM(CASE WHEN json_extract(e.payload,'$.snapshot') IS NULL THEN 1 ELSE 0 END) unknown
  FROM puzzle_managed_reward_events e WHERE e.settled_at IS NULL AND EXISTS(SELECT 1 FROM json_each(e.payload,'$.owners') p WHERE json_extract(p.value,'$.owner')=?)`).bind(owner).first<{count:number;unknown:number|null}>();
 const restored=await db.prepare(`SELECT json_extract(e.payload,'$.resolution.releaseId') release_id,e.occurred_at,e.settled_at FROM puzzle_managed_reward_events e
  WHERE e.settled_at IS NOT NULL AND json_extract(e.payload,'$.resolution.policy')='first-valid-release'
   AND EXISTS(SELECT 1 FROM json_each(e.payload,'$.owners') p WHERE json_extract(p.value,'$.owner')=?)
  ORDER BY e.settled_at DESC LIMIT 1`).bind(owner).first<{release_id:string;occurred_at:number;settled_at:number}>();
 const notice=pending?.count?`有 ${pending.count} 条拼图奖励待结算，暂时不能领取。${pending.unknown?'其中原配置不可用的奖励，会采用恢复后第一个有效发布版本，按原拼合日期结算。':''}`:restored?`原配置不可用的奖励已采用发布版本 ${restored.release_id}，按原拼合日期恢复结算。`:null;
 const noticeEn=pending?.count?`${pending.count} puzzle reward events are pending; claims are temporarily unavailable.${pending.unknown?' Rewards without an available original configuration will use the first valid release after recovery and retain their original puzzle date.':''}`:restored?`Rewards with an unavailable original configuration were recovered using release ${restored.release_id}, retaining their original puzzle date.`:null;
 return {pending:pending?.count??0,pendingEvents:pending?.count??0,unknownSnapshot:pending?.unknown??0,status:pending?.count?'pending':'settled',message:pending?.count?'奖励待结算，暂时不能领取，请稍后重试':null,notice,noticeEn,recoveryPolicy:'first-valid-release-when-original-unavailable',lastRecovered:restored?{contentReleaseId:restored.release_id,occurredAt:restored.occurred_at,settledAt:restored.settled_at,policy:'first-valid-release'}:null};
}
/** Replays preserve the original Beijing day and immutable payout configuration. */
export async function drainManagedRewards(content?:ManagedContentSnapshot|null,owner?:string){
 const db=localDb(),where=owner?" AND EXISTS(SELECT 1 FROM json_each(e.payload,'$.owners') p WHERE json_extract(p.value,'$.owner')=?)":'',query=db.prepare('SELECT e.id,e.payload FROM puzzle_managed_reward_events e WHERE e.settled_at IS NULL'+where+' ORDER BY e.occurred_at,e.revision LIMIT 100');
 const rows=await (owner?query.bind(owner):query).all<{id:string;payload:string}>();let completed=0;
 for(const row of rows.results){
  let payload=JSON.parse(row.payload) as RewardEventPayload;
  if(!payload.snapshot){
   const current=content===undefined?readManagedContent():content;if(!current)continue;
   const pinned={...payload,snapshot:rewardSnapshot(current,payload.occurredAt),resolution:{policy:'first-valid-release' as const,releaseId:current.releaseId,selectedAt:Date.now()}};
   await db.prepare("UPDATE puzzle_managed_reward_events SET payload=? WHERE id=? AND settled_at IS NULL AND json_extract(payload,'$.snapshot') IS NULL").bind(JSON.stringify(pinned),row.id).run();
   const saved=await db.prepare('SELECT payload FROM puzzle_managed_reward_events WHERE id=?').bind(row.id).first<string>('payload');if(!saved)continue;payload=JSON.parse(saved) as RewardEventPayload;
  }
  await syncManagedRoom(payload.room,pinnedContent(payload.snapshot!),payload.previous,{eventId:row.id,occurredAt:payload.occurredAt,owners:payload.owners,sourceReleaseId:payload.sourceReleaseId,resolution:payload.resolution!});
  await db.prepare('UPDATE puzzle_managed_reward_events SET settled_at=? WHERE id=? AND settled_at IS NULL').bind(Date.now(),row.id).run();completed++;
 }
 return {completed,pendingOwner:owner?await managedRewardStatus(owner):null};
}
/** Successful committed room state only; outbox replay supplies frozen facts. */
export async function syncManagedRoom(room:Room,content?:ManagedContentSnapshot|null,previous?:Room,event?:{eventId:string;occurredAt:number;owners:FrozenOwner[];sourceReleaseId:string|null;resolution:{policy:string;releaseId:string;selectedAt:number}}){
 const snapshot=content===undefined?readManagedContent():content;if(!snapshot)return;
 const activationAt=await activate(snapshot,previous,event?.occurredAt),db=localDb(),now=event?.occurredAt??Date.now(),albums=managedAlbumImages(snapshot,now),available=new Set(photos(snapshot).map(photo=>photo.id));
 const contributors=Object.entries(room.achievements?.contributors??{}).filter(([owner,c])=>validOwner(owner)&&Number.isSafeInteger(c.count)&&c.count>0&&!room.members.some(member=>member.bot&&(member.accountId||member.guestId)===owner));
 for(const [owner,contribution] of contributors){
  const storedBaseline=await db.prepare('SELECT count FROM puzzle_managed_room_baselines WHERE room_id=? AND owner=?').bind(room.id,owner).first<number>('count')??0;
  const baseline=previous?Math.min(storedBaseline,previous.achievements?.contributors[owner]?.count??0):storedBaseline;
  const frozen=event?.owners.find(item=>item.owner===owner);
  let cooperation=frozen?.cooperation??false,friend=frozen?.friend??false,binding=frozen?.invitation??null;
  if(!event){
   const active=await db.prepare('SELECT owner FROM puzzle_managed_recent_activity WHERE room_id=? AND created_at>=? AND created_at<=? AND owner<>?').bind(room.id,now-120000,now,owner).all<{owner:string}>();
   const partners=room.members.filter(member=>!member.bot&&(member.accountId||member.guestId)!==owner&&now-member.lastSeen<22000&&active.results.some(row=>row.owner===(member.accountId||member.guestId)));
   cooperation=partners.length>0;for(const partner of partners)if(await linked(owner,(partner.accountId||partner.guestId)!)){friend=true;break;}
   binding=await db.prepare('SELECT inviter,bound_at FROM puzzle_managed_invitation_bindings WHERE invitee=?').bind(owner).first<{inviter:string;bound_at:number}>();
  }
  let eventAt=0;
  await updateState(owner,state=>{if(event&&state.settlements?.[event.eventId]){eventAt=state.rooms[room.id]?.lastEventAt??0;return;}recordManagedRoom(state,{id:room.id,count:contribution.count,imageId:room.puzzle.imageId,completedAt:room.completedAt},{baseline,cooperation,friend,invitation:binding,albums,settings:settings(snapshot),rewards:taskRewards(snapshot),now,pieces:pieceBand(room.puzzle.cols*room.puzzle.rows)??room.puzzle.cols*room.puzzle.rows,availableImage:available.has(room.puzzle.imageId),activationAt});eventAt=state.rooms[room.id]?.lastEventAt??0;if(event)(state.settlements??={})[event.eventId]={sourceReleaseId:event.sourceReleaseId,contentReleaseId:event.resolution.releaseId,policy:event.resolution.policy,occurredAt:now,settledAt:Date.now()};});
  if(eventAt)await db.prepare(`INSERT INTO puzzle_managed_recent_activity(room_id,owner,count,created_at) VALUES(?,?,?,?) ON CONFLICT(room_id,owner) DO UPDATE SET count=MAX(count,excluded.count),created_at=MAX(created_at,excluded.created_at)`).bind(room.id,owner,contribution.count,eventAt).run();
  if(binding)await issueInvitationGifts(binding.inviter,snapshot,now);
 }
}
const defaultOwned=(state:State,item:any)=>!isRetiredDecoration(item.id)&&item.source==='default'||state.decorations.includes(item.id);
function ownsManagedImage(state:State,imageId:string,albums:any[]){return !!state.ownedImages[imageId]||albums.some(album=>album.imageIds.includes(imageId)&&(!album.purchasable||album.price===0||!!state.ownedAlbums[album.id]));}
export async function managedImageAllowed(owner:string,imageId:string,content:ManagedContentSnapshot|null,now=Date.now()){
 if(!content)return true;
 if(managedDailyPuzzle(content,now)?.id===imageId)return true;
 const albums=managedAlbumImages(content,now),state=(await stateFor(owner)).state;
 if(state.ownedImages[imageId])return true;
 return albums.some(album=>album.showOnPc!==false&&album.imageIds.includes(imageId)&&(!album.purchasable||album.price===0||!!state.ownedAlbums[album.id]));
}
export async function managedAccessibleImageIds(owner:string,content:ManagedContentSnapshot|null,now=Date.now()):Promise<Set<string>>{
 const output=new Set<string>();if(!content)return output;
 const state=(await stateFor(owner)).state;
 for(const [id,owned] of Object.entries(state.ownedImages))if(owned)output.add(id);
 for(const album of managedAlbumImages(content,now))if(!album.purchasable||album.price===0||state.ownedAlbums[album.id])for(const id of album.imageIds)output.add(id);
 const daily=managedDailyPuzzle(content,now);if(daily)output.add(daily.id);return output;
}
export async function ownedManagedCursors(owners:string[],content:ManagedContentSnapshot|null):Promise<Map<string,Cursor>>{
 const output=new Map<string,Cursor>();if(!content||!owners.length)return output;
 const ids=[...new Set(owners.filter(validOwner))];if(!ids.length)return output;
 const rows=await localDb().prepare(`SELECT p.owner,p.data FROM puzzle_managed_players p LEFT JOIN puzzle_account_security a ON a.user_id=p.owner WHERE p.owner IN (${ids.map(()=>'?').join(',')}) AND COALESCE(a.status,'active')='active'`).bind(...ids).all<{owner:string;data:string}>();
 const definitions=settings(content).decorations;
 for(const row of rows.results){const state=readState(row.data),item=definitions.find((entry:any)=>entry.id===state.equipped&&entry.kind==='cursor');if(item&&!isRetiredDecoration(item.id)&&defaultOwned(state,item))output.set(row.owner,{id:item.id,artKey:item.artKey,color:item.color});}
 return output;
}
export async function ownedManagedCursor(owner:string,content?:ManagedContentSnapshot|null){const snapshot=content===undefined?readManagedContent():content;return (await ownedManagedCursors([owner],snapshot)).get(owner)??null;}

export async function managedPlayerView(owner:string,content:ManagedContentSnapshot|null,origin:string,options:{recover?:boolean}={}){
 if(!content)return {enabled:false,contentReleaseId:null};
 const now=Date.now();await activate(content);if(options.recover!==false){try{await drainManagedRewards(content,owner);}catch{console.error('Managed reward settlement pending recovery');}}
 const qualified=await issueInvitationGifts(owner,content,now),code=await invitationCode(owner),game=settings(content);
 // Wallet and once-only receipts are persisted together by updateState's CAS.
 let beginner:ReturnType<typeof managedBeginnerTasks>=[];
 const state=await updateState(owner,state=>{beginner=managedBeginnerTasks(state,game,now);}),rewards=taskRewards(content),day=managedDay(now),daily=state.daily[day]??{cooperation:0,friend:0,shares:[]},allAlbums=managedAlbumImages(content,now),photoById=new Map(photos(content).map(photo=>[photo.id,photo]));
 const albums=allAlbums.filter(album=>album.showOnPc!==false).map(album=>({id:album.id,title:album.title,description:album.description,price:album.price,purchasable:album.purchasable,owned:!album.purchasable||album.price===0||!!state.ownedAlbums[album.id],progress:album.imageIds.filter((id:string)=>!!state.artworks[id]).length,total:album.imageIds.length,
  images:album.imageIds.flatMap((id:string)=>{const photo=photoById.get(id);return photo?[{...photo,thumbSrc:photo.thumbSrc??photo.thumbnailSrc??photo.src,collected:!!state.artworks[id],difficulties:state.artworks[id]??[],accessible:ownsManagedImage(state,id,allAlbums)}]:[];}),
  milestones:(album.milestones??[]).map((m:any)=>{const issued=state.milestones[album.id]?.[m.id];return {...m,...(issued?{target:issued.target,coins:issued.coins}:{}),decorationId:availableDecorationId(issued?issued.decorationId:m.decorationId),claimed:!!issued,claimable:false};})}));
 const taskView=TASK_DEFINITIONS.map(def=>{const id='daily:'+day+':'+def.id,gift=state.gifts[id],reward=gift??rewards.tasks.find((item:any)=>item.id===def.id),claimed=!!gift?.openedAt,claimable=!!gift&&!claimed;
  const goal=def.group==='friend'?`与已互相添加的好友或绑定邀请的伙伴同桌，完成 ${def.target} 次有效拼合。伙伴也需要在最近两分钟内有效拼合。`:`与同桌伙伴一起完成 ${def.target} 次有效拼合。伙伴也需要在最近两分钟内有效拼合。`;
  const goalEn=def.group==='friend'?`Make ${def.target} successful connections at a table with an accepted friend or invitation-linked partner who also made a successful connection in the last two minutes.`:`Make ${def.target} successful connections with a table partner who also made a successful connection in the last two minutes.`;
  const titleEn=({'cooperation-10':'A first connection','cooperation-30':'In good company','cooperation-60':'A shared rhythm','friend-10':'Friends at the table','friend-30':'A familiar rhythm'} as Record<string,string>)[def.id];
  return {...def,titleEn,goal,goalEn,progress:Math.min(def.target,daily[def.group]),coins:reward?.coins??0,xp:reward?.xp??0,fragments:0,claimed,claimable,status:claimed?'claimed':claimable?'claimable':'pending'};});
 const shares=daily.shares.length,todayInvited=qualified.filter(row=>managedDay(row.qualified_at)===day).length;
 const binding=await localDb().prepare('SELECT inviter FROM puzzle_managed_invitation_bindings WHERE invitee=?').bind(owner).first();
 const tasks={daily:taskView.filter(task=>task.group==='cooperation'),friends:taskView.filter(task=>task.group==='friend'),invitations:[{id:'share-invitation',title:'分享邀请',goal:`成功复制或分享邀请链接后领取金币与经验，每天最多 ${rewards.invitationShare.dailyLimit} 次。`,goalEn:`Copy or share your invitation link to earn coins and XP, up to ${rewards.invitationShare.dailyLimit} times each day.`,target:rewards.invitationShare.dailyLimit,progress:Math.min(rewards.invitationShare.dailyLimit,shares),coins:rewards.invitationShare.coins??0,xp:rewards.invitationShare.xp,fragments:0,claimed:shares>=rewards.invitationShare.dailyLimit,claimable:false,status:shares>=rewards.invitationShare.dailyLimit?'claimed':'pending'},{id:'invite-friend',title:'邀请好友加入',goal:'新伙伴绑定你的邀请并完成至少 3 次有效拼合后，你会获得见面礼；每天最多 3 位，超出的不顺延。',goalEn:'Earn a welcome gift when a new partner binds your invitation and makes at least 3 successful connections. Up to 3 partners qualify each day; extra partners do not carry over.',target:3,progress:Math.min(3,todayInvited),coins:rewards.invitationFriend.coins??0,xp:rewards.invitationFriend.xp,fragments:0,claimed:todayInvited>=3,claimable:false,status:todayInvited>=3?'claimed':'pending'}],gifts:Object.values(state.gifts).map((gift:any)=>({...gift,fragments:0,claimed:!!gift.openedAt,claimable:!gift.openedAt,status:gift.openedAt?'claimed':'claimable'})),invitation:{code,bound:!!binding,joinedCount:await localDb().prepare('SELECT COUNT(*) FROM puzzle_managed_invitation_bindings WHERE inviter=?').bind(owner).first<number>('COUNT(*)'),qualifiedCount:qualified.length,dailyLimit:3,requiredContributions:3}};
 for(const task of tasks.invitations){
  if(task.id==='share-invitation'){task.goal=(task.coins>0||task.xp>0)?`成功复制或分享邀请链接后领取奖励，每天最多 ${rewards.invitationShare.dailyLimit} 次。`:'邀请朋友一起拼图；当前暂无分享金币或经验奖励。';task.goalEn=(task.coins>0||task.xp>0)?`Claim rewards after copying or sharing an invitation link, up to ${rewards.invitationShare.dailyLimit} times daily.`:'Invite friends to puzzle together. No sharing coins or XP are currently offered.';}
  else if(task.coins===0&&task.xp===0){task.goal='邀请新伙伴并完成至少 3 次有效拼合；当前暂无邀请金币或经验奖励。';task.goalEn='Invite a new player who makes at least 3 successful connections. No invitation coins or XP are currently offered.';}
 }
 const friendDb=localDb(),personSql="SELECT c.owner,c.code,u.name FROM puzzle_managed_invitation_codes c LEFT JOIN puzzle_users u ON u.id=c.owner";
 const [incoming,outgoing,friendList]=await Promise.all([
  friendDb.prepare(personSql+' WHERE EXISTS(SELECT 1 FROM puzzle_managed_friend_requests r WHERE r.sender=c.owner AND r.recipient=?) ORDER BY c.code LIMIT 50').bind(owner).all<{owner:string;code:string;name:string|null}>(),
  friendDb.prepare(personSql+' WHERE EXISTS(SELECT 1 FROM puzzle_managed_friend_requests r WHERE r.recipient=c.owner AND r.sender=?) ORDER BY c.code LIMIT 50').bind(owner).all<{owner:string;code:string;name:string|null}>(),
  friendDb.prepare(personSql+' WHERE EXISTS(SELECT 1 FROM puzzle_managed_friends f WHERE f.peer=c.owner AND f.owner=?) ORDER BY c.code LIMIT 100').bind(owner).all<{owner:string;code:string;name:string|null}>()
 ]);
 // Guests have no account row; name them like every other shared surface.
 const people=(rows:{owner:string;code:string;name:string|null}[])=>rows.map(row=>({code:row.code,name:playerName(row.name,row.owner)}));
 const friends={code,requests:people(incoming.results),outgoing:people(outgoing.results),list:people(friendList.results)};
 for(const task of tasks.invitations)Object.assign(task,{titleEn:task.id==='share-invitation'?'Share an invitation':'Invite a new friend'});
 const decorations=game.decorations.filter((item:any)=>!isRetiredDecoration(item.id)).map((item:any)=>({...item,owned:defaultOwned(state,item),equipped:state.equipped===item.id,rewardAlbums:allAlbums.flatMap(album=>(album.milestones??[]).filter((m:any)=>m.decorationId===item.id).map((m:any)=>({id:album.id,title:album.title,target:m.target})))})).filter((item:any)=>item.enabled!==false||item.owned);
 const visibleImages=new Set(albums.flatMap(album=>album.images.map((photo:any)=>photo.id)));
 const retainedImages=Object.keys(state.ownedImages).filter(id=>state.ownedImages[id]&&!visibleImages.has(id)).flatMap(id=>{const photo=photoById.get(id);return photo?[{...photo,thumbSrc:photo.thumbSrc??photo.thumbnailSrc??photo.src,collected:!!state.artworks[id],difficulties:state.artworks[id]??[],accessible:true}]:[];});
 const settlement=await managedRewardStatus(owner);
 if(settlement.pending)for(const task of [...tasks.daily,...tasks.friends,...tasks.invitations,...tasks.gifts])task.claimable=false;
 return {enabled:true,contentReleaseId:(content as any).releaseId,profile:{level:state.level,xp:state.totalXp,xpIntoLevel:state.xp,xpForNextLevel:xpForManagedLevel(state.level+1,game),coins:state.coins,fragments:state.fragments,giftProgress:state.giftProgress},albums,retainedImages,tasks:{...tasks,...(beginner.length?{beginner}:{})},decorations,friends,settlement,inviteUrl:origin+'/lobby?invite='+code,serverTime:now};
}
async function acceptInvitation(owner:string,code:unknown){
 if(typeof code!=='string'||!/^[a-f0-9]{12}$/i.test(code))throw new RoomError('请输入 12 位好友邀请码');
 const db=localDb(),inviter=await db.prepare('SELECT owner FROM puzzle_managed_invitation_codes WHERE code=?').bind(code.toLowerCase()).first<string>('owner');if(!inviter)throw new RoomError('邀请码不存在',404);if(inviter===owner)throw new RoomError('不能使用自己的邀请码',409);
 await db.prepare('INSERT OR IGNORE INTO puzzle_managed_invitation_bindings(invitee,inviter,bound_at) VALUES(?,?,?)').bind(owner,inviter,Date.now()).run();
 const bound=await db.prepare('SELECT inviter FROM puzzle_managed_invitation_bindings WHERE invitee=?').bind(owner).first<string>('inviter');if(bound!==inviter)throw new RoomError('已绑定另一位好友的邀请',409);
}
export async function managedPlayerAction(owner:string,input:Record<string,unknown>,content:ManagedContentSnapshot|null){
 if(!content)throw new RoomError('正在开发',410);await activate(content);
 await drainManagedRewards(content,owner);
 if((await managedRewardStatus(owner)).pending)throw new RoomError('奖励待结算，暂时不能领取，请稍后重试',503);
 const game=settings(content),rewards=taskRewards(content),now=Date.now(),action=input.action;
 if(action==='accept-invitation'||action==='bind-invitation'){await acceptInvitation(owner,input.code);return;}
 if(action==='request-friend'||action==='accept-friend'){
  if(typeof input.code!=='string'||!/^[a-f0-9]{12}$/i.test(input.code))throw new RoomError('好友编号无效');
  const db=localDb(),peer=await db.prepare('SELECT owner FROM puzzle_managed_invitation_codes WHERE code=?').bind(input.code.toLowerCase()).first<string>('owner');if(!peer||peer===owner)throw new RoomError('好友不存在',404);
  if(action==='request-friend')await db.prepare('INSERT OR IGNORE INTO puzzle_managed_friend_requests(sender,recipient,created_at) VALUES(?,?,?)').bind(owner,peer,now).run();
  else{if(await db.prepare('SELECT 1 FROM puzzle_managed_friends f WHERE f.owner=? AND f.peer=? AND EXISTS(SELECT 1 FROM puzzle_managed_friends r WHERE r.owner=? AND r.peer=?)').bind(owner,peer,peer,owner).first())return;if(!await db.prepare('SELECT 1 FROM puzzle_managed_friend_requests WHERE sender=? AND recipient=?').bind(peer,owner).first())throw new RoomError('请先收到对方的好友请求',403);await db.batch([db.prepare('INSERT OR IGNORE INTO puzzle_managed_friends VALUES(?,?,?)').bind(owner,peer,now),db.prepare('INSERT OR IGNORE INTO puzzle_managed_friends VALUES(?,?,?)').bind(peer,owner,now),db.prepare('DELETE FROM puzzle_managed_friend_requests WHERE sender=? AND recipient=?').bind(peer,owner)]);}return;
 }
 try{await updateState(owner,state=>{
  switch(action){
  case 'purchase-album':purchaseManagedAlbum(state,managedAlbumImages(content,now).find(album=>album.id===input.albumId),game,now);break;
  case 'craft-decoration':craftManagedDecoration(state,game.decorations.find((item:any)=>item.id===input.decorationId),game,now);break;
  case 'equip-decoration':{const item=game.decorations.find((entry:any)=>entry.id===input.decorationId);if(isRetiredDecoration(input.decorationId))throw new RoomError('这件装饰已移除，正在重新制作',409);if(input.decorationId!==null&&(!item||!defaultOwned(state,item)))throw new RoomError('请先获得这件装饰',403);state.equipped=input.decorationId;break;}
  case 'claim-task':{if(!TASK_DEFINITIONS.some(task=>task.id===input.taskId))throw new RoomError('任务不存在',404);claimManagedGift(state,'daily:'+managedDay(now)+':'+input.taskId,game,now);break;}
  case 'claim-gift':{if(typeof input.giftId!=='string'||input.giftId.length>160)throw new RoomError('奖励不存在',404);claimManagedGift(state,input.giftId,game,now);break;}
  case 'share-invitation':{if(typeof input.requestId!=='string'||!/^[a-f0-9-]{32,36}$/i.test(input.requestId))throw new RoomError('分享请求无效');shareManagedInvitation(state,input.requestId,game,rewards,now);break;}
  default:throw new RoomError('不支持的操作');
  }
 });}catch(error){if(error instanceof RoomError)throw error;if(error instanceof Error&&'status' in error)throw new RoomError(error.message,Number(error.status));throw error;}
}
