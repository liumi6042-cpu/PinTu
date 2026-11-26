import {DatabaseSync} from 'node:sqlite';
import {createMobileTasks} from './mobile-tasks.mjs';
import {createMobileRetention,readRetentionConfiguration} from './mobile-retention.mjs';
import {createMobileTuanzi} from './mobile-tuanzi.mjs';
import {createMobileRedeem} from './mobile-redeem.mjs';
import {createMobileEvents} from './mobile-events.mjs';
import {createMobileLevels,readLevelConfiguration} from './mobile-levels.mjs';
import {createTaskRewardSettings} from './task-reward-settings.mjs';
import {createGameSettings} from './game-settings.mjs';
import {createAlbumContent} from './album-content.mjs';
import {createMobileManagedContent} from './mobile-managed-content.mjs';
import {createManagedDailyContent} from './managed-daily-content.mjs';
import {createMobileCollection,AD_UNLOCK_ALBUM_IDS} from './mobile-collection.mjs';
import {createMobileSocial} from './mobile-social.mjs';
import {createMobilePrivacy} from './mobile-privacy.mjs';
import {createMobileRoomHistory} from './mobile-room-history.mjs';
import {createDiagnosticActions} from './diagnostic-actions.mjs';
import {createSoloBatch} from './mobile-solo-batch.mjs';
import {createTapPreview} from './tap-preview.mjs';
import chatPhrases from '../config/social-phrases.json' with {type:'json'};
import {randomBytes,randomInt as secureRandomInt,createHash} from 'node:crypto';
import {mkdirSync,chmodSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import * as engine from '../outputs/mobile/engine.mjs';
import {guestName} from './guest-names.mjs';
const DEFAULT_PLAYER_NAME='拼图朋友';
import {MOBILE_COUNTS,effectiveEnergyCap,inviteCapBonus,xpForLevel,newProfile,restoreEnergy,applyContribution,completionDistribution} from './mobile-economy.mjs';

// A first-time mobile player starts with three creation tickets. Web play needs none,
// so the runtime decides the amount instead of baking it into the profile factory.
export const NEWCOMER_CREATION_TICKETS=3;
export const LOBBY_QUIET_HIDE_MS=5*60*1000;
const id=()=>randomBytes(16).toString('hex');
const hash=value=>createHash('sha256').update(value).digest('hex');
const fail=(status,code,message,extra={})=>{throw Object.assign(new Error(message),{status,code,...extra});};
const requestKey=value=>typeof value==='string'&&/^[a-f0-9]{32}$/.test(value);
const directionOf=photo=>{const d=Number.isFinite(photo.width)&&Number.isFinite(photo.height)?photo:engine.photoGuidance(photo.id)??photo;return d.width===d.height?'square':d.width>d.height?'landscape':'portrait';};
// Keep the artwork aspect ratio and square piece bodies while respecting mobile limits.
export function mobileGridForPhoto(photo,count,mode='gallery'){
 const small=(mode==='level'||mode==='postcard')&&[12,16,20,24,28,30,35,40,54].includes(count);
 const d=Number.isFinite(photo.width)&&Number.isFinite(photo.height)?photo:engine.photoGuidance(photo.id);if(!d||!MOBILE_COUNTS.includes(count)&&!small)return null;
 const fitted=engine.gridForDimensions(d.width,d.height,count);if(!fitted)return null;
 if(small||fitted.count>=48&&fitted.count<=500)return fitted;
 const ratio=d.width/d.height,floor=count<=108?20:30,span=Math.ceil(Math.sqrt(count*Math.max(ratio,1/ratio)))*2+4;let best=null;
 for(let rows=2;rows<=span;rows++)for(let cols=2;cols<=span;cols++){
  const total=cols*rows,pixels=Math.min(Math.floor(d.width/cols),Math.floor(d.height/rows));
  if(total<48||total>500||Math.abs(total-count)>count*.15||pixels<floor)continue;
  const target=cols/rows,retained=ratio>target?target/ratio:ratio/target,tightness=pixels<floor*1.15?(floor*1.15-pixels)/(floor*1.15):0,score=Math.abs(total-count)/count+(1-retained)*2.6+tightness*.5;
  if(!best||score<best.score-1e-9)best={cols,rows,count:total,pixels,exact:total===count,score};
 }
 if(!best)return null;const {score:_score,...grid}=best;return grid;
}
export const CHAT_PHRASES=Object.freeze(chatPhrases);

/** All state changes execute without await inside one SQLite IMMEDIATE transaction.
 * The gateway passes its verified opaque identity directly; clients cannot select it.
 * Reward completion is a client SDK report, not a platform-signed receipt.
 */
export function createMobileService(options={}){
 const levelConfiguration=readLevelConfiguration(options.levels);
 const clock=options.now??Date.now,randomInt=options.randomInt??secureRandomInt;
 const tapMultiplayerEnabled=options.runtimeProfile!=='web'&&(options.tapMultiplayerEnabled??process.env.MOBILE_TAP_MULTIPLAYER_ENABLED==='true')===true;
 const tapPreview=createTapPreview({enabled:tapMultiplayerEnabled,roomIds:options.tapPreviewRoomIds??String(process.env.MOBILE_TAP_PREVIEW_ROOM_IDS??'').split(',').filter(value=>/^[a-f0-9]{32}$/.test(value)),now:clock,notify:roomId=>markRoom(roomId)});
 const tapTap=options.tapTap??{};
 const diagnosticAccounts=new Set((options.diagnosticAccountIds??String(process.env.MOBILE_DIAGNOSTIC_ACCOUNT_IDS??'').split(',')).filter(value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value))); 
 const tapTapExchange=tapTap.exchangeCode??(async code=>{
  const appId=String(tapTap.appId??process.env.TAPTAP_APP_ID??'').trim();
  const secret=String(tapTap.secret??process.env.TAPTAP_APP_SECRET??'').trim();
  const endpoint=String(tapTap.endpoint??process.env.TAPTAP_CODE2SESSION_URL??'https://cloud-miniapp.tapapis.cn/auth/v1/jscode2session').trim();
  if(!appId||!secret)fail(503,'TAPTAP_LOGIN_NOT_CONFIGURED','TapTap账号登录暂未配置，请稍后再试');
  if(!/^https:\/\//i.test(endpoint))fail(500,'TAPTAP_ENDPOINT_INVALID','TapTap登录服务地址无效');
  const url=new URL(endpoint);url.search=new URLSearchParams({appid:appId,secret,js_code:code,grant_type:'authorization_code'}).toString();
  let response;try{response=await fetch(url,{method:'GET',headers:{Accept:'application/json'},signal:AbortSignal.timeout(10000)});}catch{fail(503,'TAPTAP_LOGIN_UNAVAILABLE','TapTap登录服务暂时不可用，请稍后再试');}
  let data={};try{data=await response.json();}catch{}
  if(!response.ok||typeof data.openid!=='string'||!data.openid)fail(401,'TAPTAP_CODE_INVALID','TapTap登录凭证无效或已过期，请重试');
  return {openid:data.openid,unionid:typeof data.unionid==='string'&&data.unionid?data.unionid:undefined};
 });
 // The host chooses this profile. No request body/header may disable stamina.
 const web=options.runtimeProfile==='web',guestNames=options.guestNames??true,energyEnabled=!web,shareRewards=options.shareRewards??!web,adsEnabled=!web&&options.adEnabled===true;
 const retentionEnabled=!web&&options.retention!==false&&process.env.MOBILE_RETENTION!=='false';
 const retentionConfiguration=retentionEnabled?readRetentionConfiguration():null;
 // 团子去旅行: the /h5/config capability tuanziTravel; MOBILE_TUANZI=false switches the whole feature off.
 const tuanziEnabled=!web&&options.tuanzi!==false&&process.env.MOBILE_TUANZI!=='false';
 // 兑换码 (POST /api/mobile/redeem); MOBILE_REDEEM=false answers REDEEM_DISABLED. Seeds come from config/redeem-codes.json.
 const redeemEnabled=!web&&options.redeem!==false&&process.env.MOBILE_REDEEM!=='false';
 // The mobile daily turns over at this Beijing hour (20:00 gathers players in the lobby). The daily clock runs
 // ahead so its Beijing midnight lands on that hour; every package's lobby countdown follows the gallery serverTime.
 const dailyTurnoverHour=web?0:options.dailyTurnoverHour??Number(process.env.MOBILE_DAILY_TURNOVER_HOUR??20);
 if(!Number.isInteger(dailyTurnoverHour)||dailyTurnoverHour<0||dailyTurnoverHour>23)throw new Error('MOBILE_DAILY_TURNOVER_HOUR must be an hour 0-23');
 const dailyShift=dailyTurnoverHour?(24-dailyTurnoverHour)*3600000:0,dailyClock=now=>now+dailyShift;
 // 分享领体力包: once per game day (the same day as the daily puzzle, which flips at dailyTurnoverHour Beijing time).
 const SHARE_ENERGY_DAILY_TEXT='今天已经分享领过体力包了，每天限 1 次，北京时间 '+dailyTurnoverHour+' 点后可以再领';
 const shareEnergyDay=now=>new Date(dailyClock(now)+8*3600000).toISOString().slice(0,10);
 // Receipts keep the real time, but never before their own Beijing date, so the web service (midnight turnover) reads them as valid.
 const dailyActivation=clock=>Math.max(Date.parse(new Date(clock+8*3600000).toISOString().slice(0,10)+'T00:00:00+08:00'),clock-dailyShift);
 const onDailyClock=content=>content&&dailyShift?{...content,...Object.fromEntries(['tick','select','albumEntries','managedImageIds','releasedImageIds','galleryPhotos'].filter(name=>typeof content[name]==='function').map(name=>[name,(now=clock(),...rest)=>content[name](dailyClock(now),...rest)]))}:content;
 const soloLocalPlay=!web&&(options.soloLocalPlay??process.env.MOBILE_SOLO_LOCAL_PLAY!=='false')===true;
 const offlineLevelClears=!web&&(options.offlineLevelClears??process.env.MOBILE_OFFLINE_LEVEL_CLEARS!=='false')===true;
 // Only a trusted host option can re-enable free text. Local/development hosts
 // use the same safe mobile default as a public-test package.
 const customNames=options.publicTestPolicy?.customNames??web,privateMessages=options.publicTestPolicy?.privateMessages??web;
 if(typeof customNames!=='boolean'||typeof privateMessages!=='boolean')throw new TypeError('publicTestPolicy values must be booleans');
 const capabilities=Object.freeze({weeklyGift:retentionEnabled,dailyStreak:retentionEnabled,tuanziTravel:tuanziEnabled,energy:energyEnabled,ads:adsEnabled,shareRewards:!web&&shareRewards,tapMultiplayer:tapMultiplayerEnabled,soloLocalPlay,offlineLevelClears,albumTarget:web?'pc':options.albumTarget??'mobile-shared',createTickets:!web,customNames,cheers:true,privacyRequests:true,roomActionRevisionBody:!web,social:Object.freeze({friends:true,privateMessages,privateMessageHistory:true,roomInvites:true,reports:true,blocking:true,search:true,presence:true,codeFormat:'digits9'})});
 const managedContent=options.managedContent??(options.contentDirectory?createMobileManagedContent({directory:options.contentDirectory,photos:engine.RESTORABLE_PHOTOS,assetDir:options.assetDir}):null);
 let operationRelease=managedContent?.read()??null,requestRelease;
 const taskRewardConfiguration=options.taskRewardSettings??createTaskRewardSettings({configurationPath:options.taskRewardConfigurationPath});
 let operationTaskRewards=operationRelease?.taskRewards??taskRewardConfiguration.read();
 const gameConfiguration=options.gameSettings??createGameSettings({configurationPath:options.gameConfigurationPath});
 let operationGameSettings=operationRelease?.gameSettings??gameConfiguration.read();
 const albumConfiguration=options.albumContent??createAlbumContent({configurationPath:options.albumConfigurationPath,photos:engine.RESTORABLE_PHOTOS,readSettings:()=>operationGameSettings});
 let operationAlbums=operationRelease?.albums??albumConfiguration.read();
 const filename=options.databasePath??':memory:';
 if(filename!==':memory:')mkdirSync(dirname(resolve(filename)),{recursive:true,mode:0o700});
 const db=new DatabaseSync(filename);if(filename!==':memory:')chmodSync(filename,0o600);
 // WAL + NORMAL syncs at checkpoints instead of on every commit (~1 ms each, and every request commits). The file
 // cannot corrupt; a power cut or OS crash may drop the last moments of play. MOBILE_SQLITE_SYNCHRONOUS=full restores per-commit sync.
 const synchronous=String(options.synchronous??process.env.MOBILE_SQLITE_SYNCHRONOUS??'normal').toUpperCase();
 if(!['NORMAL','FULL'].includes(synchronous))throw new Error('MOBILE_SQLITE_SYNCHRONOUS must be normal or full');
 db.exec('PRAGMA synchronous='+synchronous);
 db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
 CREATE TABLE IF NOT EXISTS mobile_profiles(id TEXT PRIMARY KEY,data TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS mobile_taptap_accounts(provider_key TEXT PRIMARY KEY,canonical_identity TEXT NOT NULL,nickname TEXT,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS mobile_taptap_sessions(session_identity TEXT PRIMARY KEY,canonical_identity TEXT NOT NULL,updated_at INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS mobile_taptap_codes(code_hash TEXT PRIMARY KEY,provider_key TEXT NOT NULL,canonical_identity TEXT NOT NULL,created_at INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS mobile_rooms(id TEXT PRIMARY KEY,owner TEXT NOT NULL,visibility TEXT NOT NULL,pieces INTEGER NOT NULL,created_at INTEGER NOT NULL,completed_at INTEGER,closed_at INTEGER,data TEXT NOT NULL);
 CREATE INDEX IF NOT EXISTS mobile_rooms_owner ON mobile_rooms(owner,completed_at,closed_at);
 CREATE INDEX IF NOT EXISTS mobile_rooms_lobby ON mobile_rooms(visibility,created_at);
 CREATE TABLE IF NOT EXISTS mobile_requests(owner TEXT NOT NULL,scope TEXT NOT NULL,request_id TEXT NOT NULL,input_hash TEXT NOT NULL,response TEXT NOT NULL,created_at INTEGER NOT NULL,PRIMARY KEY(owner,scope,request_id));
 CREATE INDEX IF NOT EXISTS mobile_requests_created ON mobile_requests(created_at);
 CREATE TABLE IF NOT EXISTS mobile_ad_challenges(token TEXT PRIMARY KEY,owner TEXT NOT NULL,kind TEXT NOT NULL,request_id TEXT NOT NULL,context TEXT NOT NULL,auth_hash TEXT NOT NULL,expires_at INTEGER NOT NULL,used INTEGER NOT NULL DEFAULT 0,UNIQUE(owner,context,request_id));
 CREATE TABLE IF NOT EXISTS mobile_tool_uses(room_id TEXT NOT NULL,owner TEXT NOT NULL,kind TEXT NOT NULL,uses INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(room_id,owner,kind));
 CREATE INDEX IF NOT EXISTS mobile_tool_uses_owner_kind ON mobile_tool_uses(owner,kind);
 CREATE TABLE IF NOT EXISTS mobile_tool_grants(room_id TEXT NOT NULL,owner TEXT NOT NULL,request_id TEXT NOT NULL,kind TEXT NOT NULL,expires_at INTEGER NOT NULL,data TEXT NOT NULL,PRIMARY KEY(room_id,owner,request_id));
 CREATE TABLE IF NOT EXISTS mobile_settlements(room_id TEXT NOT NULL,owner TEXT NOT NULL,energy INTEGER NOT NULL,contribution INTEGER NOT NULL,created_at INTEGER NOT NULL,PRIMARY KEY(room_id,owner));
 CREATE TABLE IF NOT EXISTS mobile_chat(id INTEGER PRIMARY KEY AUTOINCREMENT,room_id TEXT NOT NULL,owner TEXT NOT NULL,request_id TEXT NOT NULL,data TEXT NOT NULL,sent_at INTEGER NOT NULL,UNIQUE(room_id,owner,request_id));
 CREATE TABLE IF NOT EXISTS mobile_cursors(room_id TEXT NOT NULL,player_id TEXT NOT NULL,client_id TEXT NOT NULL,seq INTEGER NOT NULL,data TEXT NOT NULL,updated_at INTEGER NOT NULL,PRIMARY KEY(room_id,player_id));`);
 const events=createMobileEvents({db});
 // Energy rejection must survive the action's rollback (including savepoints).
 let requestEnergyEmpty=null;
 // Only remember persisted bytes for this transaction. Every new request still
 // reads SQLite, including changes committed by another service instance.
 let requestProfileData=null,requestRoomChanges=null,requestCursorUndo=null,requestInviteBonuses=null;
 const readInviteCapBonus=owner=>{
  if(!energyEnabled)return {count:0,maximum:0};
  if(requestInviteBonuses?.has(owner))return requestInviteBonuses.get(owner);
  const bonus=inviteCapBonus(db,owner);requestInviteBonuses?.set(owner,bonus);return bonus;
 };
 const playerEnergyCap=p=>effectiveEnergyCap(p.level,operationGameSettings,readInviteCapBonus(p.id).count);
 const roomListeners=new Set(),roomVersions=new Map(),cursorRooms=new Map(),cheerRooms=new Map(),cheerRates=new Map();let cheerSeq=clock();
 const realtimeCounters={roomReads:0,authorizations:0,cursorWrites:0,cursorFlushes:0};
 const markRoom=(roomId,kind={room:true,cursors:true})=>{if(requestRoomChanges){const old=requestRoomChanges.get(roomId);requestRoomChanges.set(roomId,{room:kind.room||old?.room,cursors:kind.cursors||old?.cursors,cheers:kind.cheers||old?.cheers});}else{commitEpoch++;for(const listener of roomListeners)listener(roomId,kind);}};
 // Read caches. Every committed write on this connection bumps commitEpoch; PRAGMA data_version moves when another
 // connection commits. Realtime reads of one committed state share a single parsed room (read-only: handle() always
 // parses its own copy, since actions mutate it) and one card per member, instead of each peer parsing the room again.
 let commitEpoch=0;const dataVersionStatement=db.prepare('PRAGMA data_version');
 const readKey=()=>commitEpoch+':'+dataVersionStatement.get().data_version;
 const sharedRooms=new Map(),sharedRoomObjects=new WeakSet(),sharedMemberCards=new WeakMap();
 const readSharedRoom=roomId=>{
  const key=readKey(),hit=sharedRooms.get(roomId);if(hit?.key===key)return hit.room;
  sharedRooms.delete(roomId);const room=readRoom(roomId);sharedRoomObjects.add(room);sharedRooms.set(roomId,{key,room});
  if(sharedRooms.size>256)sharedRooms.delete(sharedRooms.keys().next().value);return room;
 };
 // Lists that only change when a room row changes: each owner's rooms (profileView), the open public tables (lobby,
 // friends) and the daily finished count. A save bumps the owner's / public generation; a rollback drops them all.
 let publicGeneration=0,settlementGeneration=0;const ownerGenerations=new Map(),ownedRoomRows=new Map();let openPublicRows=null,dailyFinishedMemo=null;
 const touchRoomLists=room=>{publicGeneration++;ownerGenerations.set(room.ownerId,(ownerGenerations.get(room.ownerId)??0)+1);};
 const dropReadCaches=()=>{commitEpoch++;sharedRooms.clear();ownedRoomRows.clear();openPublicRows=null;dailyFinishedMemo=null;publicGeneration++;settlementGeneration++;};
 const pruneCheers=(roomId,now)=>{
  const state=cheerRooms.get(roomId);if(state){state.items=state.items.filter(item=>item.at>now-15000).slice(-60);if(!state.items.length)cheerRooms.delete(roomId);}
  // Rate windows outlive the visible items, including when a sweep drops an empty room.
  const rates=cheerRates.get(roomId);if(rates){for(const [playerId,times]of rates){const recent=times.filter(at=>at>now-60000);if(recent.length)rates.set(playerId,recent);else rates.delete(playerId);}if(!rates.size)cheerRates.delete(roomId);}
 };
 const putCheer=(room,member,input,now)=>{
  pruneCheers(room.id,now);
  if(member.lastSeen<=0)fail(409,'ROOM_ADMISSION_REQUIRED','请先重新连接房间');
  if(!room.completedAt)fail(409,'ROOM_NOT_COMPLETED','拼图完成后才能喝彩');
  if(!requestKey(input?.id)||!['clap','popper','heart','star','tea','cat'].includes(input?.emote))fail(400,'INVALID_CHEER','喝彩内容无效');
  let state=cheerRooms.get(room.id);if(state?.items.some(item=>item.playerId===member.id&&item.id===input.id))return;
  const rates=cheerRates.get(room.id)??new Map(),times=rates.get(member.id)??[];
  if(times.length>=40||times.filter(at=>at>now-2000).length>=4)fail(429,'CHEER_RATE_LIMIT','喝彩太快啦，歇一下');
  if(!state){state={items:[]};cheerRooms.set(room.id,state);}cheerRates.set(room.id,rates);rates.set(member.id,[...times,now]);
  state.items.push({seq:++cheerSeq,id:input.id,playerId:member.id,name:member.name,emote:input.emote,at:now});if(state.items.length>60)state.items.shift();markRoom(room.id,{room:false,cursors:false,cheers:true});
 };
 const cheersView=(roomId,after,now)=>{pruneCheers(roomId,now);const value=typeof after==='string'||typeof after==='number'?Number(after):0,cursor=Number.isSafeInteger(value)&&value>=0?value:0;return {cheers:(cheerRooms.get(roomId)?.items??[]).filter(item=>item.seq>cursor),cursor:cheerSeq,serverTime:now};};
 const cheerTimer=setInterval(()=>{const now=clock();for(const roomId of new Set([...cheerRooms.keys(),...cheerRates.keys()])){const room=db.prepare('SELECT closed_at FROM mobile_rooms WHERE id=?').get(roomId);if(!room||room.closed_at){cheerRooms.delete(roomId);cheerRates.delete(roomId);}else pruneCheers(roomId,now);}},30000);cheerTimer.unref();
 const cursorState=(roomId,refresh=false)=>{
  let state=cursorRooms.get(roomId);if(!state){state=new Map();cursorRooms.set(roomId,state);refresh=true;}
  if(refresh)for(const row of db.prepare('SELECT player_id,client_id,seq,data,updated_at FROM mobile_cursors WHERE room_id=?').all(roomId)){
   const old=state.get(row.player_id);if(!old?.dirty||row.updated_at>old.updatedAt)state.set(row.player_id,{clientId:row.client_id,seq:row.seq,point:JSON.parse(row.data),updatedAt:row.updated_at,dirty:false});
  }
  return state;
 };
 const rememberCursors=roomId=>{if(requestCursorUndo&&!requestCursorUndo.has(roomId))requestCursorUndo.set(roomId,structuredClone(cursorState(roomId)));};
 const putCursor=(room,member,input,now)=>{
  if(member.lastSeen<=0)fail(409,'ROOM_ADMISSION_REQUIRED','请先重新连接房间');
  const value=engine.cursorInput(input);if(!value)fail(400,'INVALID_CURSOR_POSITION','鼠标位置无效');
  const state=cursorState(room.id),old=state.get(member.id);
  if(value.point===null){if(!old||old.clientId!==value.clientId||value.seq<=old.seq)return false;rememberCursors(room.id);state.set(member.id,{...old,seq:value.seq,dirty:true});}
  else {if(old?.clientId===value.clientId&&value.seq<=old.seq)return false;rememberCursors(room.id);state.set(member.id,{clientId:value.clientId,seq:value.seq,point:value.point,updatedAt:now,dirty:true});}
  realtimeCounters.cursorWrites++;return true;
 };
 // One transaction per flush: a separate autocommit per cursor paid one WAL commit (and sync) each.
 const flushCursors=()=>{
  const own=!db.isTransaction,written=[];let began=false;
  try{
   for(const [roomId,state]of cursorRooms)for(const [playerId,value]of state)if(value.dirty){
    if(own&&!began){db.exec('BEGIN IMMEDIATE');began=true;}
    db.prepare('INSERT INTO mobile_cursors VALUES(?,?,?,?,?,?) ON CONFLICT(room_id,player_id) DO UPDATE SET client_id=excluded.client_id,seq=excluded.seq,data=excluded.data,updated_at=excluded.updated_at WHERE excluded.updated_at>=mobile_cursors.updated_at AND (mobile_cursors.client_id!=excluded.client_id OR excluded.seq>=mobile_cursors.seq)').run(roomId,playerId,value.clientId,value.seq,JSON.stringify(value.point),value.updatedAt);value.dirty=false;written.push(value);realtimeCounters.cursorFlushes++;
   }
   if(began)db.exec('COMMIT');
  }catch(error){if(began){db.exec('ROLLBACK');for(const value of written)value.dirty=true;}throw error;}
 };
 const cursorTimer=setInterval(flushCursors,options.cursorFlushMs??500);cursorTimer.unref();
 // A room-action receipt stores the whole room reply for one drop and only guards client retries for a few minutes.
 // Keep a day of them and delete older ones in small batches, yielding between batches so a sweep never holds the
 // write lock for long. Other receipts (purchases, offline clears, invitations) are small and stay.
 const requestRetentionMs=options.requestRetentionMs??86400000,requestPruneBatch=options.requestPruneBatch??2000,requestPruneYieldMs=options.requestPruneYieldMs??50;
 const pruneRequestStatement=db.prepare("DELETE FROM mobile_requests WHERE rowid IN (SELECT rowid FROM mobile_requests WHERE created_at<? AND scope GLOB 'room-action:*' LIMIT ?)");
 let requestPrune=null,requestPruneStep=null;
 // The sweep is published before its first batch runs: a sweep that finishes in one batch clears requestPrune
 // synchronously, and assigning afterwards would leave a settled promise there and stop every later sweep.
 const pruneRequests=()=>{
  if(requestPrune)return requestPrune;
  let finish;const sweep=requestPrune=new Promise(done=>{finish=done;});
  let removed=0;
  const step=()=>{
   requestPruneStep=null;
   let changes=0;try{changes=Number(pruneRequestStatement.run(clock()-requestRetentionMs,requestPruneBatch).changes);}catch(error){console.warn('mobile request prune stopped:',error.message);}
   removed+=changes;
   if(changes>=requestPruneBatch){requestPruneStep=setTimeout(step,requestPruneYieldMs);requestPruneStep.unref?.();}
   else{requestPrune=null;finish(removed);}
  };
  step();
  return sweep;
 };
 const requestPruneStart=setTimeout(pruneRequests,options.requestPruneStartMs??5000);requestPruneStart.unref();
 const requestPruneTimer=setInterval(pruneRequests,options.requestPruneMs??600000);requestPruneTimer.unref();
 const resolveIdentity=identity=>db.prepare('SELECT canonical_identity FROM mobile_taptap_sessions WHERE session_identity=?').get(identity)?.canonical_identity??identity;
 const statePresent=identity=>{
  const row=db.prepare('SELECT data FROM mobile_profiles WHERE id=?').get(identity);if(row){const p=JSON.parse(row.data);if(Number(p.totalXp)>0||Number(p.level)>0||Number(p.supply?.energy)>0||Number(p.supply?.create)>NEWCOMER_CREATION_TICKETS||p.firstRoomCompleted===true)return true;}
  return !!db.prepare("SELECT 1 FROM mobile_rooms WHERE owner=? UNION SELECT 1 FROM mobile_collection_wallets WHERE owner=? AND (coins>0 OR fragments>0 OR equipped IS NOT NULL) UNION SELECT 1 FROM mobile_collection_owned WHERE owner=? LIMIT 1").get(identity,identity,identity);
 };
 const displayName=value=>{if(typeof value!=='string')return null;const text=value.trim();if(!text||Array.from(text).length>16||Array.from(text).some(c=>c.charCodeAt(0)<32||c.charCodeAt(0)===127))return null;return text;};
 const diagnosticAllowed=identity=>!web&&diagnosticAccounts.has(identity)&&Boolean(db.prepare('SELECT 1 FROM mobile_taptap_accounts WHERE canonical_identity=?').get(identity));
 const taptapView=identity=>{const row=db.prepare('SELECT nickname FROM mobile_taptap_accounts WHERE canonical_identity=?').get(identity);return row?{bound:true,nickname:row.nickname??null,provider:'taptap',diagnostics:diagnosticAllowed(identity)}:{bound:false,provider:'taptap'};};
 const nameTaken=name=>Boolean(db.prepare("SELECT 1 FROM mobile_profiles WHERE json_extract(data,'$.name')=? LIMIT 1").get(name)),randomName=identity=>guestName(identity,nameTaken);
 /** Players without a readable platform name still carry the old default; they get a soft random name on their next visit. */
 const needsName=p=>guestNames&&!p.nameSource&&(typeof p.name!=='string'||!p.name.trim()||p.name===DEFAULT_PLAYER_NAME);
 const readProfile=(identity,now)=>{const row=db.prepare('SELECT data FROM mobile_profiles WHERE id=?').get(identity);if(requestProfileData&&!requestProfileData.has(identity))requestProfileData.set(identity,row?.data??null);const p=row?JSON.parse(row.data):newProfile(identity,now,operationGameSettings,{creationTickets:web?0:NEWCOMER_CREATION_TICKETS});if(!row&&guestNames)p.name=randomName(identity);if(energyEnabled)restoreEnergy(p,now,operationGameSettings,{inviteBonus:readInviteCapBonus(p.id).count});else if(!row)p.energy=0;return p;};
 const saveProfile=p=>{const data=JSON.stringify(p);if(requestProfileData?.get(p.id)===data)return;const result=db.prepare('INSERT INTO mobile_profiles VALUES(?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data WHERE mobile_profiles.data<>excluded.data').run(p.id,data);requestProfileData?.set(p.id,data);return result;};
 const tasks=createMobileTasks({db,readProfile,saveProfile,energyEnabled,readInviteCapBonus,invalidateInviteCapBonus:owner=>requestInviteBonuses?.delete(owner),areFriends:(owner,peer)=>social.areFriends(owner,peer),readSettings:()=>operationTaskRewards,readGameSettings:()=>operationGameSettings,awardCoins:(owner,source,coins,now)=>collection.awardTaskCoins(owner,source,coins,now)});
 const dailyContent=onDailyClock(managedContent?createManagedDailyContent({readSnapshot:()=>requestRelease===undefined?managedContent.read():requestRelease,legacy:options.dailyContent??null,photos:engine.RESTORABLE_PHOTOS,galleryPhotos:engine.GALLERY_VISIBLE_PHOTOS,fallback:engine.dailyPuzzle,appearanceDir:options.dailyAppearanceDir??resolve('work/daily-appearances'),now:()=>dailyClock(clock()),activationTime:dailyActivation}):options.dailyContent??null);
 const collection=createMobileCollection({db,photos:dailyContent?.collectiblePhotos()??(operationAlbums?engine.RESTORABLE_PHOTOS:engine.GALLERY_VISIBLE_PHOTOS),dailyContent,readSettings:()=>operationGameSettings,readAlbums:()=>operationAlbums,albumTarget:capabilities.albumTarget});
 const levels=createMobileLevels({db,photos:engine.RESTORABLE_PHOTOS,collection,configuration:levelConfiguration});
 const retention=retentionEnabled?createMobileRetention({db,config:retentionConfiguration,awardCoins:collection.awardCoins,grantDecoration:collection.grantDecoration}):null;
 const redeem=redeemEnabled?createMobileRedeem({db,seeds:options.redeemSeeds,now:clock,awardWallet:collection.awardWallet,grantDecoration:collection.grantCodeDecoration}):null;
 const storyImageIds=now=>new Set(levelConfiguration.chapters.flatMap(chapter=>collection.albumImages(chapter.albumId,now)?.imageIds??[]));
 const tuanzi=tuanziEnabled?createMobileTuanzi({db,config:options.tuanziConfig,regions:options.tuanziRegions,randomInt,grantDecoration:collection.grantDecoration,
  cleared:owner=>levels.progress(owner).some(row=>row.level_id===(options.tuanziConfig?.unlockLevelId??'ch1-2')&&row.cleared_at!==null),
  // Postcards show the current artwork (v54 clients always send the artwork-snapshot header).
  pool:now=>{const story=storyImageIds(now);return galleryPhotos(now).filter(photo=>!story.has(photo.id)).map(photo=>{const shown=engine.activeArtworkPhoto(photo);return {id:photo.id,title:shown.title??photo.title,src:shown.src,thumbSrc:shown.thumbSrc,width:shown.width??photo.width,height:shown.height??photo.height};});},
  albumOf:(imageId,now)=>collection.albumOf(imageId,now),grid:(picture,pieces)=>mobileGridForPhoto(picture,pieces,'postcard')}):null;
 /** A tuanzi side effect never breaks the request it rides on (completion, login, offline clears). */
 const tuanziSide=(label,fn)=>{if(!tuanzi)return;db.exec('SAVEPOINT tuanzi_side');try{fn();db.exec('RELEASE tuanzi_side');}catch(error){db.exec('ROLLBACK TO tuanzi_side; RELEASE tuanzi_side');console.warn('mobile tuanzi '+label+' failed:',error.message);}};
 if(!options.deferDailyStart)dailyContent?.start();
 const galleryPhotos=now=>collection.galleryPhotos(now);
 // TapTap tables seat more players as they grow: under 300 pieces 4, 300-499 pieces 6, 500 or more 8.
 const seatLimit=room=>{const pieces=room.mobilePieces??room.puzzle.cols*room.puzzle.rows;return web?8:pieces>=500?8:pieces>=300?6:4;};
 // TapTap players open 500-piece tables from level 10; anyone may still join one.
 const pieceLevels=web?{}:{500:10},pieceLevel=pieces=>pieceLevels[pieces]??0;
 const readRoom=roomId=>{const row=db.prepare('SELECT data,closed_at FROM mobile_rooms WHERE id=?').get(roomId);if(!row||row.closed_at)fail(404,'ROOM_NOT_FOUND','房间不存在或已关闭');const room=JSON.parse(row.data);if(!web&&room.diagnostic!==true)room.persistent=true;room.playerLimit=seatLimit(room);return room;};
 const saveRoom=room=>{if(!web&&room.diagnostic!==true)room.persistent=true;const result=db.prepare('INSERT INTO mobile_rooms VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET completed_at=excluded.completed_at,closed_at=excluded.closed_at,data=excluded.data').run(room.id,room.ownerId,room.visibility,room.mobilePieces,room.createdAt,room.completedAt,room.closedAt??null,JSON.stringify(room));touchRoomLists(room);markRoom(room.id);return result;};
 const pruneRoomCursors=room=>{
  rememberCursors(room.id);const state=cursorState(room.id);
  if(room.closedAt){state.clear();db.prepare('DELETE FROM mobile_cursors WHERE room_id=?').run(room.id);return;}
  for(const [playerId,value]of state){const member=room.members.find(m=>m.id===playerId);if(!member)state.delete(playerId);else if(member.lastSeen<=0)state.set(playerId,{...value,point:null,dirty:true});}
  // Membership, not pointer age, owns the last decoration position. Keep leave
  // tombstones until the existing room rules actually remove the member.
  const members=JSON.stringify(room.members);
  db.prepare("DELETE FROM mobile_cursors WHERE room_id=? AND NOT EXISTS(SELECT 1 FROM json_each(?) m WHERE json_extract(m.value,'$.id')=mobile_cursors.player_id)").run(room.id,members);
  db.prepare("UPDATE mobile_cursors SET data='null' WHERE room_id=? AND data!='null' AND EXISTS(SELECT 1 FROM json_each(?) m WHERE json_extract(m.value,'$.id')=mobile_cursors.player_id AND CAST(json_extract(m.value,'$.lastSeen') AS INTEGER)<=0)").run(room.id,members);
 };
 const social=createMobileSocial({db,readProfile,replay,readRoom,authorizeRoom:authorize,roomCard:card,openPublicRooms:()=>openPublicRooms(),blockedWords:options.socialBlockedWords,privateMessages});
 const privacy=createMobilePrivacy({db});
 const roomHistory=createMobileRoomHistory({db,card});
 {const removeOwned=roomHistory.removeOwned;roomHistory.removeOwned=(owner,roomId,now)=>{const result=removeOwned(owner,roomId,now);ownerGenerations.set(owner,(ownerGenerations.get(owner)??0)+1);return result;};}
 // profileView rides on every room action reply: parse an owner's rooms once per change of those rooms, not per reply.
 const ownedRoomCards=(owner,now)=>{
  const key=(ownerGenerations.get(owner)??0)+':'+dataVersionStatement.get().data_version;let hit=ownedRoomRows.get(owner);
  if(hit?.key!==key){
   hit={key,rooms:db.prepare('SELECT data FROM mobile_rooms WHERE owner=? AND closed_at IS NULL AND json_extract(data,\'$.diagnostic\') IS NOT 1 AND NOT EXISTS(SELECT 1 FROM mobile_room_list_removals x WHERE x.owner=mobile_rooms.owner AND x.room_id=mobile_rooms.id) ORDER BY created_at DESC').all(owner).map(row=>JSON.parse(row.data))};
   ownedRoomRows.delete(owner);ownedRoomRows.set(owner,hit);if(ownedRoomRows.size>2048)ownedRoomRows.delete(ownedRoomRows.keys().next().value);
  }
  return hit.rooms.map(r=>({...card(r,now),...(r.completedAt!==null?{title:'已完成'}:{}),inviteCode:r.mobileInviteCode??null}));
 };
 // The open public tables, newest first (lobby, friends' tables). Parsed once per change of any public room.
 const openPublicRooms=()=>{
  const key=publicGeneration+':'+dataVersionStatement.get().data_version;
  if(openPublicRows?.key!==key)openPublicRows={key,rooms:db.prepare("SELECT data FROM mobile_rooms WHERE visibility='public' AND completed_at IS NULL AND closed_at IS NULL ORDER BY created_at DESC").all().map(row=>JSON.parse(row.data))};
  return openPublicRows.rooms;
 };
 /** Per-member extras of a room reply. On a shared (realtime) room they are worked out once per committed state. */
 const memberCard=(room,member,now)=>{
  let cards=sharedMemberCards.get(room);if(!cards){cards=new Map();if(sharedRoomObjects.has(room))sharedMemberCards.set(room,cards);}
  let value=cards.get(member.id);if(value)return value;
  const identity=member.guestId||member.accountId;
  value=identity?{contribution:room.achievements?.contributors?.[identity]?.count??0,code:social.person(identity,now).code,level:readProfile(identity,now).level,decoration:collection.equipped(identity)}:{contribution:0,code:null,level:0,decoration:null};
  cards.set(member.id,value);return value;
 };
 const profileView=(p,now)=>({capabilities,...(retention?{retention:retention.summary(p.id,now,engine.dailyPuzzleDate(dailyClock(now)))}:{}),code:social.person(p.id,now).code,collection:collection.summary(p.id,now),level:p.level,pieceLevels,xp:p.xp,totalXp:p.totalXp,xpToNext:xpForLevel(p.level+1,operationGameSettings),energy:p.energy,energyCap:playerEnergyCap(p),...(energyEnabled?{inviteCapBonus:readInviteCapBonus(p.id)}:{}),economy:{contributionCost:energyEnabled?operationGameSettings.energy.contributionCost:0,contributionXp:operationGameSettings.energy.contributionXp,firstRoomFree:operationGameSettings.energy.firstRoomFree,upgradeRefill:operationGameSettings.energy.upgradeRefill,upgradeEnergy:operationGameSettings.energy.upgradeEnergy,naturalRecoveryMinutes:operationGameSettings.energy.naturalRecoveryMinutes},giftProgress:p.giftProgress,giftCount:tasks.giftCount(p.id),supply:p.supply,shareEnergyClaimedToday:p.shareEnergyDay===shareEnergyDay(now),autoSupply:p.autoSupply,adEligible:adsEnabled,name:p.name,newcomer:!p.firstRoomCompleted,firstRoomId:p.firstRoomId,starterSelectionAvailable:p.starterSelectionAvailable,firstSelectionAvailable:p.starterSelectionAvailable,lastReward:p.lastReward,taptap:taptapView(p.id),naturalRecoveryAt:energyEnabled&&operationGameSettings.energy.naturalRecoveryMinutes>0&&p.energy<playerEnergyCap(p)?p.energyAt+operationGameSettings.energy.naturalRecoveryMinutes*60000:null,serverTime:now,ownedRooms:ownedRoomCards(p.id,now)});
 const photoOf=room=>engine.roomArtworkPhoto(room,engine.RESTORABLE_PHOTOS);
 const displayPhoto=(photo,request)=>photo&&request.artworkSnapshot===true?engine.activeArtworkPhoto(photo):photo;
 const creationArtwork=(photo,pieces,request)=>engine.currentRoomArtwork(engine.RESTORABLE_PHOTOS.find(item=>item.id===photo.id)??photo,pieces,request.artworkSnapshot!==true);
 function requireArtworkClient(room,request){if(engine.roomUsesUpgradedArtwork(room)&&request.artworkSnapshot!==true)fail(409,'ARTWORK_CLIENT_UPDATE_REQUIRED','这间拼图使用新版图片，请刷新页面或更新小游戏后重新进入');}
 function card(room,now){const photo=photoOf(room);return {id:room.id,title:room.title||photo?.title||'一起拼图',imageId:room.puzzle.imageId,pieces:room.mobilePieces,actualPieces:room.puzzle.cols*room.puzzle.rows,visibility:room.visibility,players:room.members.filter(m=>now-m.lastSeen<engine.ONLINE_MS).length,maxPlayers:seatLimit(room),placed:engine.placedCount(room.puzzle),completed:room.completedAt!==null,acceptingNew:room.acceptingNew!==false,started:room.startedAt!==null,startedAt:room.startedAt,createdAt:room.createdAt,expiresAt:room.expiresAt,lastPlayedAt:room.lastPlayedAt,direction:photo?directionOf(photo):'landscape',artwork:engine.resolveRoomArtwork(room,engine.RESTORABLE_PHOTOS),photo,thumbSrc:photo?.thumbSrc};}
 function snapshotView(room,now,since=null,identity=null){const result=engine.roomUpdate(room,now,since);result.requestedPieces=room.mobilePieces;result.maxPlayers=seatLimit(room);if(room.mobileMode==='level')result.levelId=room.mobileLevelId;const preview=tapPreview.descriptor(room);if(preview)result.tapPreview=preview;if(room.diagnostic===true)result.diagnostic=true;result.artwork=engine.resolveRoomArtwork(room,engine.RESTORABLE_PHOTOS);result.photo=photoOf(room);if(identity===room.ownerId&&room.mobileInviteCode)result.inviteCode=room.mobileInviteCode;result.members=result.members.map(m=>{const member=room.members.find(p=>p.id===m.id),extra=member?memberCard(room,member,now):null;return {...m,contribution:extra?.contribution??0,code:extra?.code??null,level:extra?.level??0,decoration:extra?.decoration??null};});if(identity&&room.completedAt!==null&&room.diagnostic!==true){const award=db.prepare('SELECT energy,contribution FROM mobile_settlements WHERE room_id=? AND owner=?').get(room.id,identity);result.mobileResult={roomId:room.id,contribution:award?.contribution??0,xp:room.mobileContributionXp?.[identity]??award?.contribution??0,energy:award?.energy??0,...collection.completion(identity,room.id),ranking:Object.entries(room.achievements?.contributors??{}).filter(([,c])=>c.count>0).sort((x,y)=>y[1].count-x[1].count).slice(0,8).map(([owner,c])=>({name:readProfile(owner,now).name,code:social.person(owner,now).code,contribution:c.count,mine:owner===identity}))};if(room.mobileMode==='level'&&identity===room.ownerId){const progress=levels.progress(identity).find(row=>row.level_id===room.mobileLevelId),firstClear=progress?.room_id===room.id;result.mobileResult.levelClear={levelId:room.mobileLevelId,energy:firstClear?progress.energy:0,firstClear,...levels.destination(room.mobileLevelId)};}}return result;}
 function authorize(room,request,now){
  if(room.diagnostic===true){request.identity=resolveIdentity(request.identity);if(room.ownerId!==request.identity||!diagnosticAllowed(request.identity))fail(403,'DIAGNOSTIC_FORBIDDEN','该测试房间仅对指定账号开放');}
  const token=/^Bearer ([a-f0-9]{32})$/.exec(request.authorization??'')?.[1];if(!token)fail(401,'ROOM_ADMISSION_REQUIRED','请重新加入房间');
  const member=engine.authenticate(room,hash(token),now);if(member.guestId!==request.identity)fail(403,'ROOM_IDENTITY_MISMATCH','请用当前身份重新加入房间');return member;
 }
 function cursorMembers(room,now){return room.members.filter(m=>m.lastSeen>0).map(m=>{const extra=m.guestId?memberCard(room,m,now):null;return {playerId:m.id,name:m.name,color:m.color,level:extra?extra.level:readProfile(m.guestId,now).level,decoration:extra?extra.decoration:collection.equipped(m.guestId)};});}
 function cursorsView(room,now,members=cursorMembers(room,now),refresh=false){return {cursors:[...cursorState(room.id,refresh)].flatMap(([playerId,value])=>{const member=members.find(m=>m.playerId===playerId);return value.point&&member?[{...value.point,...member,updatedAt:now,positionUpdatedAt:value.updatedAt}]:[];}),serverTime:now};}
 function realtimeAuthorize(context){
  realtimeCounters.authorizations++;const now=clock(),room=readSharedRoom(context.roomId);requireArtworkClient(room,context);const member=authorize(room,context,now);
  if(member.lastSeen<=0)fail(409,'ROOM_ADMISSION_REQUIRED','请先重新连接房间');
  context.room=room;context.member=member;context.cursorMembers=cursorMembers(room,now);context.version=roomVersions.get(room.id)??0;return context;
 }
 const diagnosticTransport=Symbol('room-action-transport'),diagnosticConnections=new WeakMap(),openActionConnections=new Set();
 const diagnosticError=(error,context)=>({status:error.status??500,data:{...(context?.room?.diagnostic===true?{diagnostic:true}:{}),error:error.status?error.message:'房间动作暂时不可用',code:error.code??'DIAGNOSTIC_ACTION_FAILED',...(error.profile?{profile:error.profile}:{}),diagnosticTiming:{serverMs:0}}});
 function requireDiagnosticContext(context){
  realtimeAuthorize(context);
 }
 function writeDiagnostic(context,input){
  const started=performance.now();
  try{
   requireDiagnosticContext(context);let connection=diagnosticConnections.get(context);
   if(!connection){connection={id:id(),closed:false};diagnosticConnections.set(context,connection);openActionConnections.add(connection.id);}
   if(connection.closed)fail(409,'DIAGNOSTIC_CONNECTION_CLOSED','测试连接已断开，请重新连接');
   const result=handle({identity:context.identity,authorization:context.authorization,artworkSnapshot:context.artworkSnapshot,method:'POST',url:'/api/rooms/'+context.roomId,body:input?.action??{},[diagnosticTransport]:{context,connectionId:connection.id,input}});
   if(context.room.diagnostic===true)result.data.diagnostic=true;result.data.diagnosticTiming={serverMs:Math.max(0,performance.now()-started)};return result;
  }catch(error){return diagnosticError(error,context);}
 }
 function disconnectDiagnostic(context){
  if(!context)return;const connection=diagnosticConnections.get(context);if(!connection||connection.closed)return;connection.closed=true;openActionConnections.delete(connection.id);
  return handle({identity:context.identity,authorization:context.authorization,artworkSnapshot:context.artworkSnapshot,method:'POST',url:'/api/rooms/'+context.roomId,body:{},[diagnosticTransport]:{context,connectionId:connection.id,disconnect:true}});
 }
 const realtime={
  subscribe(request){if(typeof request.identity!=='string'||!/^[a-f0-9]{64}$/.test(request.identity))fail(401,'IDENTITY_REQUIRED','连接身份无效');return realtimeAuthorize({...request});},
  validate:realtimeAuthorize,
  readRoom(context,since){realtimeCounters.roomReads++;realtimeAuthorize(context);return snapshotView(context.room,clock(),since,context.identity);},
  readCursors(context){if(context.version!==(roomVersions.get(context.roomId)??0))realtimeAuthorize(context);return cursorsView(context.room,clock(),context.cursorMembers);},
  writeCursor(context,input){if(context.version!==(roomVersions.get(context.roomId)??0))realtimeAuthorize(context);putCursor(context.room,context.member,input,clock());},
  readCheers(context,after){if(context.version!==(roomVersions.get(context.roomId)??0))realtimeAuthorize(context);const data=cheersView(context.roomId,after,clock());return after===null?{...data,cheers:[]}:data;},
  writeCheer(context,input){if(context.version!==(roomVersions.get(context.roomId)??0))realtimeAuthorize(context);putCheer(context.room,context.member,input,clock());},
  actionCapabilities(context){requireDiagnosticContext(context);if(!diagnosticConnections.has(context)){const connection={id:id(),closed:false};diagnosticConnections.set(context,connection);openActionConnections.add(connection.id);}return {version:1,diagnosticOnly:context.room.diagnostic===true};},
  writeAction:writeDiagnostic,disconnectActions:disconnectDiagnostic,
  onChange(listener){roomListeners.add(listener);return ()=>roomListeners.delete(listener);},
  stats:()=>({...realtimeCounters}),flush:flushCursors,
 };
 const diagnosticActions=createDiagnosticActions({db,readRoom,saveRoom,now:clock,isConnectionOpen:connectionId=>openActionConnections.has(connectionId),
  authorize(room,context){const member=authorize(room,context,clock());if(member.lastSeen<=0)fail(409,'ROOM_ADMISSION_REQUIRED','请先重新连接房间');return member;},
  view(room,context){const now=clock(),p=readProfile(context.identity,now);return {...snapshotView(room,now,null,p.id),profile:profileView(p,now)};},
 });
 function bindFirstRoom(p,room){if(room.diagnostic!==true&&room.completedAt===null&&!p.firstRoomId&&!p.firstRoomCompleted)p.firstRoomId=room.id;}
 /** Distinct players who completed the current daily (its day starts at the turnover hour, matching the daily schedule). */
 function dailyFinishedCount(now){const day=engine.dailyPuzzleDate(dailyClock(now)),start=Date.parse(day+'T00:00:00+08:00')-dailyShift,key=day+':'+settlementGeneration+':'+dataVersionStatement.get().data_version;if(dailyFinishedMemo?.key===key)return dailyFinishedMemo.value;const value=Number(db.prepare("SELECT COUNT(DISTINCT s.owner) n FROM mobile_settlements s JOIN mobile_rooms r ON r.id=s.room_id WHERE r.completed_at>=? AND json_extract(r.data,'$.mobileMode')='daily' AND json_extract(r.data,'$.mobileDay')=?").get(start,day).n);dailyFinishedMemo={key,value};return value;}
 function join(room,p,input,now,request={}){
  requireArtworkClient(room,request);room.playerLimit=seatLimit(room);
  if(room.diagnostic===true&&(room.ownerId!==p.id||!diagnosticAllowed(p.id)))fail(403,'DIAGNOSTIC_FORBIDDEN','该测试房间仅对指定账号开放');
  if(room.visibility==='private'&&room.ownerId!==p.id&&!room.admitted?.[p.id]&&input.inviteCode!==room.mobileInviteCode)fail(403,'INVITE_REQUIRED','私人房间需要有效邀请码');
  const token=id(),known=room.members.some(m=>m.guestId===p.id),member=engine.addMember(room,id(),p.name,hash(token),now,undefined,p.id);if(!known)events.record(p.id,'room-join',room.id,{},now);social.recordTablemates(p.id,room.members.filter(m=>m.guestId&&m.guestId!==p.id&&now-m.lastSeen<engine.ONLINE_MS).map(m=>m.guestId),room,now);bindFirstRoom(p,room);room.revision++;saveRoom(room);roomHistory.joined(p.id,room,now);pruneRoomCursors(room);saveProfile(p);
  return {token,playerId:member.id,room:snapshotView(room,now,null,p.id),...(room.ownerId===p.id&&room.mobileInviteCode?{inviteCode:room.mobileInviteCode}:{})};
 }
 // With a receipt, only receipt.store(result) is kept (marked receipt:1) and a retry gets receipt.restore(stored).
 // Rows written before receipts existed hold the whole reply and still replay as stored.
 function replay(p,scope,input,now,fn,receipt){
  if(!requestKey(input.requestId))fail(400,'REQUEST_ID_REQUIRED','缺少有效请求编号，请重试');
  const fingerprint=hash(JSON.stringify(input)),old=db.prepare('SELECT input_hash,response FROM mobile_requests WHERE owner=? AND scope=? AND request_id=?').get(p.id,scope,input.requestId);
  if(old){if(old.input_hash!==fingerprint)fail(409,'REQUEST_CONFLICT','同一请求编号不能用于其他操作');const stored=JSON.parse(old.response);return receipt&&stored?.receipt===1?receipt.restore(stored):stored;}
  const result=fn();db.prepare('INSERT INTO mobile_requests VALUES(?,?,?,?,?,?)').run(p.id,scope,input.requestId,fingerprint,JSON.stringify(receipt?{...receipt.store(result),receipt:1}:result),now);return result;
 }
 // A drop receipt keeps only the contribution; the whole room reply was ~12 KB per drop.
 const roomActionReceipt=result=>result.mobileContribution?{mobileContribution:result.mobileContribution}:{};
 const soloBatch=createSoloBatch({enabled:soloLocalPlay,roomActionReceipt,replay,snapshotView,profileView,engine,fail,requestKey});
 function challenge(p,{kind,requestId,context='supply',authorization='',allowSkip=false},now){
  if(!requestKey(requestId))fail(400,'REQUEST_ID_REQUIRED','请求编号无效');
  const sharing=context.startsWith('share:');if(sharing?!shareRewards:!adsEnabled&&!(allowSkip&&!web))fail(503,sharing?'SHARE_UNAVAILABLE':'ADS_UNAVAILABLE',sharing?'当前平台未开放分享奖励':'当前平台未开放广告');
  const existing=db.prepare('SELECT * FROM mobile_ad_challenges WHERE owner=? AND context=? AND request_id=?').get(p.id,context,requestId);
  if(existing){if(existing.kind!==kind||existing.auth_hash!==hash(authorization))fail(409,'REQUEST_CONFLICT','广告请求与当前操作不匹配');if(existing.used||existing.expires_at<=now)fail(409,'AD_EXPIRED','本次广告机会已失效');return {rewardToken:existing.token,expiresAt:existing.expires_at};}
  if(context==='supply'||context==='share:supply'){
   if(!['energy','create'].includes(kind))fail(400,'INVALID_SUPPLY','补给种类无效');
   const pending=db.prepare('SELECT COUNT(*) n FROM mobile_ad_challenges WHERE owner=? AND context=? AND kind=? AND used=0 AND expires_at>?').get(p.id,context,kind,now).n;
   if(p.supply[kind]+pending>=3)fail(409,'SUPPLY_FULL','库存已满或已有待领取奖励');
  }
  const recent=db.prepare('SELECT COUNT(*) n FROM mobile_ad_challenges WHERE owner=? AND expires_at>?').get(p.id,now+540000).n;if(recent>=20)fail(429,'AD_RATE_LIMIT','请稍后再试');
  const token=randomBytes(32).toString('hex'),expiresAt=now+600000;db.prepare('INSERT INTO mobile_ad_challenges VALUES(?,?,?,?,?,?,?,0)').run(token,p.id,kind,requestId,context,hash(authorization),expiresAt);return {rewardToken:token,expiresAt};
 }
 function consumeChallenge(p,input,context,authorization,now){
  const row=typeof input.rewardToken==='string'?db.prepare('SELECT * FROM mobile_ad_challenges WHERE token=?').get(input.rewardToken):null;
  if(!row||row.owner!==p.id||row.kind!==input.kind||row.context!==context||row.request_id!==input.requestId||row.auth_hash!==hash(authorization??''))fail(403,context.startsWith('share:')?'SHARE_REQUIRED':'AD_REQUIRED',context.startsWith('share:')?'请先完成对应分享':'请先完整观看对应广告');
  if(row.used||row.expires_at<=now||input.completed!==true)fail(403,context.startsWith('share:')?'SHARE_EXPIRED':'AD_EXPIRED',context.startsWith('share:')?'分享已失效、已取消或尚未完成':'广告机会已失效或尚未完整观看');
  db.prepare('UPDATE mobile_ad_challenges SET used=1 WHERE token=? AND used=0').run(row.token);
 }
 function settle(room,now,current){
  if(room.diagnostic===true||!room.completedAt||room.mobileSettled)return;
  const counts=Object.fromEntries(Object.entries(room.achievements?.contributors??{}).map(([owner,v])=>[owner,v.count]));
  for(const configuredReward of completionDistribution(counts,room.mobilePieces,operationGameSettings)){
   const reward=energyEnabled&&room.mobileMode!=='postcard'?configuredReward:{...configuredReward,energy:0};
   const p=reward.id===current.id?current:readProfile(reward.id,now);
   const result=db.prepare('INSERT OR IGNORE INTO mobile_settlements VALUES(?,?,?,?,?)').run(room.id,p.id,reward.energy,reward.contribution,now);if(result.changes)settlementGeneration++;
   if(result.changes){events.record(p.id,'room-complete',room.id,{contribution:reward.contribution},now);const collected=collection.complete(p.id,room,reward.contribution,now);p.energy+=reward.energy;p.lastReward={...p.lastReward,completion:{roomId:room.id,...reward,...(collected??{})},at:now};}
   if(p.firstRoomId===room.id)p.firstRoomCompleted=true;saveProfile(p);
  }
  if(room.mobileMode==='level'){
   const p=room.ownerId===current.id?current:readProfile(room.ownerId,now),configuredEnergy=energyEnabled?levelConfiguration.firstClearEnergy:0;
   const firstClear=levels.recordClear(p.id,room.mobileLevelId,room.id,now,configuredEnergy),energy=firstClear?configuredEnergy:0;
   const {nextLevelId,chapterComplete}=levels.destination(room.mobileLevelId);
   p.energy+=energy;p.lastReward={...p.lastReward,levelClear:{levelId:room.mobileLevelId,energy,firstClear,nextLevelId,chapterComplete},at:now};saveProfile(p);
   events.record(p.id,'level-clear',room.id,{levelId:room.mobileLevelId,firstClear,energy},now);
  }
  // 第一桌: only profiles whose stored firstRoomId is this room (SQLite filters; it used to parse every profile), plus the acting player in memory.
  const firstRoomRows=db.prepare("SELECT id,data FROM mobile_profiles WHERE json_extract(data,'$.firstRoomId')=?").all(room.id);
  for(const p of [current,...firstRoomRows.filter(row=>row.id!==current.id).map(row=>JSON.parse(row.data))])if(p.firstRoomId===room.id&&!p.firstRoomCompleted){p.firstRoomCompleted=true;saveProfile(p);}
  tuanziSide('completion',()=>tuanzi.roomCompleted(room,Object.entries(room.achievements?.contributors??{}).filter(([,c])=>c.count>0).map(([owner])=>owner),now));
  room.mobileSettled=true;
 }
 // v53.10+ clients send lasting=true (POST body) / ?lasting=1 (GET): 提示 stays until its pieces are placed;
 // 底图 always lasts 30 seconds (LEGACY_TOOL_MS) per activation and disappears automatically afterwards.
 // Each account gets NEWCOMER_FREE_TOOL_USES lifetime free uses per tool kind (hint / underlay), starting from the first room.
 const LASTING_TOOL_MS=400*86400000,LEGACY_TOOL_MS=30000,NEWCOMER_FREE_TOOL_USES=2;
 const toolFreeUses=(owner,kind)=>Number(db.prepare('SELECT COALESCE(SUM(uses),0) n FROM mobile_tool_uses WHERE owner=? AND kind=?').get(owner,kind)?.n??0);
 function help(room,p,request,input,now,url){
  authorize(room,request,now);
  const lastingClient=request.method==='GET'?url?.searchParams.get('lasting')==='1':input.lasting===true;
  const used=kind=>toolFreeUses(p.id,kind);
  const locked=new Set(room.puzzle.groups.filter(g=>g.locked).flatMap(g=>g.pieces));
  const grants=()=>{
   const rows=db.prepare('SELECT data FROM mobile_tool_grants WHERE room_id=? AND owner=? AND expires_at>? ORDER BY rowid').all(room.id,p.id,now).map(r=>JSON.parse(r.data));
   // Only the newest lasting hint counts, and only while one of its pieces is still unplaced.
   // Underlay always expires 30s after activation, including any legacy lasting underlay rows.
   const lastHint=rows.findLast(g=>g.lasting&&g.kind==='hint');
   return rows.filter(g=>!g.lasting||g.kind!=='hint'||g===lastHint&&g.pieceIds.some(id=>!locked.has(id)))
    .map(g=>{
     if(g.lasting&&(g.kind==='underlay'||!lastingClient)){const {lasting:_lasting,...timed}=g;return {...timed,expiresAt:Math.min(g.expiresAt,(g.startedAt??now)+LEGACY_TOOL_MS)};}
     return g;
    }).filter(g=>g.expiresAt>now);
  };
  const view=()=>({grants:grants(),serverTime:now,freeRemaining:{hint:Math.max(0,NEWCOMER_FREE_TOOL_USES-used('hint')),underlay:Math.max(0,NEWCOMER_FREE_TOOL_USES-used('underlay'))},newcomerProtected:false});
  if(request.method==='GET')return view();if(request.method!=='POST')fail(405,'METHOD_NOT_ALLOWED','请求方式无效');
  return replay(p,'help:'+room.id,input,now,()=>{
   if(!['hint','underlay'].includes(input.kind))fail(400,'INVALID_TOOL','工具无效');
   const grantLasting=lastingClient&&input.kind==='hint';
   // A lasting hint may be replaced by a fresh one (its pieces may have been moved by teammates).
   if(grants().some(g=>g.kind===input.kind&&!grantLasting))fail(409,'TOOL_ACTIVE','该功能正在生效');
   const free=used(input.kind)<NEWCOMER_FREE_TOOL_USES;
   // Option A compatibility: new clients pass toolAd=true (expecting AD_REQUIRED + /api/rewarded/challenge);
   // legacy TapTap/WeChat clients omit toolAd and only handle SHARE_REQUIRED + /api/mobile/share/challenge.
   const adToolClient=input.toolAd===true||!shareRewards;
   if(!free&&!input.rewardToken)fail(402,adToolClient?'AD_REQUIRED':'SHARE_REQUIRED',adToolClient?(grantLasting?'免费次数已用完，观看 TapTap 广告后可开启':'免费次数已用完，观看 TapTap 广告后可开启30秒'):(grantLasting?'免费次数已用完，分享后可开启':'免费次数已用完，分享后可开启30秒'),{freeRemaining:view().freeRemaining});
   let pieceIds=[];if(input.kind==='hint'){const held=new Set(Object.keys(room.leases).map(Number));pieceIds=room.puzzle.groups.filter(g=>!g.locked&&!held.has(g.id)).flatMap(g=>g.pieces).slice(0,3);if(!pieceIds.length)fail(409,'NO_HINT_AVAILABLE','暂时没有可提示的拼块');}
   if(!free){
    const tokenContext=shareRewards&&typeof input.rewardToken==='string'&&db.prepare('SELECT context FROM mobile_ad_challenges WHERE token=?').get(input.rewardToken)?.context==='share:room/'+room.id?'share:room/'+room.id:'room/'+room.id;
    consumeChallenge(p,input,tokenContext,request.authorization,now);
   }
   if(free)db.prepare('INSERT INTO mobile_tool_uses VALUES(?,?,?,1) ON CONFLICT(room_id,owner,kind) DO UPDATE SET uses=uses+1').run(room.id,p.id,input.kind);
   const grant={requestId:input.requestId,kind:input.kind,pieceIds,expiresAt:now+(grantLasting?LASTING_TOOL_MS:LEGACY_TOOL_MS),...(grantLasting?{lasting:true,startedAt:now}:{})};db.prepare('INSERT INTO mobile_tool_grants VALUES(?,?,?,?,?,?)').run(room.id,p.id,input.requestId,input.kind,grant.expiresAt,JSON.stringify(grant));return view();
  });
 }
 function route(request,p,input,url,now){
  const path=url.pathname,method=request.method;
  if(path==='/api/mobile/diagnostics/room'&&method==='POST'){
   if(!diagnosticAllowed(p.id))fail(403,'DIAGNOSTIC_FORBIDDEN','该测试入口仅对指定账号开放');
   return replay(p,'diagnostic-room',input,now,()=>{
    // Only retire this owner's disposable test room; normal progress is untouched.
    for(const row of db.prepare('SELECT data FROM mobile_rooms WHERE owner=? AND closed_at IS NULL').all(p.id)){
     const previous=JSON.parse(row.data);if(previous.diagnostic===true){previous.closedAt=now;saveRoom(previous);pruneRoomCursors(previous);}
    }
    const photo=galleryPhotos(now).find(photo=>collection.randomAllowed(p.id,photo.id,now));
    if(!photo)fail(409,'NO_TEST_IMAGE','暂无可用的免费测试图片');
    const seed=now>>>0,puzzle={version:1,layout:'square',imageId:photo.id,cols:3,rows:3,seed,elapsed:0,
     groups:Array.from({length:9},(_,n)=>({id:n,pieces:[n],dx:80+(n%3)*60,dy:80+Math.floor(n/3)*60,locked:false}))};
    const room={id:id(),ownerId:p.id,visibility:'private',diagnostic:true,title:'老头 · 九格拼合测试',artwork:creationArtwork(photo,48,request),puzzle,mobilePieces:9,mobileMode:'diagnostic',mobileInviteCode:null,revision:0,createdAt:now,expiresAt:now+86400000,completedAt:null,retentionVersion:2,lastPlayedAt:now,members:[],leases:{},startedAt:null,participants:{}};
    saveRoom(room);return join(room,p,{},now,request);
   });
  }
  if(path==='/api/mobile/privacy-request')return privacy.route(request,input,now);
  if(path==='/api/mobile/social'||path.startsWith('/api/mobile/social/'))return social.route(request,p,input,url,now);
  if(path==='/api/daily'&&method==='GET'){const photo=displayPhoto(dailyContent?.select(now)??engine.dailyPuzzle(dailyClock(now)),request);return {date:engine.dailyPuzzleDate(dailyClock(now)),photo:{id:photo.id,title:photo.title,src:photo.src,thumbSrc:photo.thumbSrc,width:photo.width,height:photo.height},serverTime:now};}
  if(path==='/api/mobile/gallery'&&method==='GET'){const photos=galleryPhotos(now);return {imageIds:photos.map(photo=>photo.id),freeImageIds:collection.freeImageIds(now),packedImageIds:collection.packedImageIds(now),...(request.artworkSnapshot===true?{photos:photos.map(photo=>displayPhoto(photo,request)),daily:displayPhoto(dailyContent?.select(now)??engine.dailyPuzzle(dailyClock(now)),request)}:{}),serverTime:dailyClock(now)};}
  if(path==='/api/levels'&&method==='GET')return levels.view(p.id,now);
  if(path==='/api/levels/offline-clears'&&method==='POST'){
   if(!offlineLevelClears)fail(503,'OFFLINE_CLEARS_UNAVAILABLE','离线通关同步暂不可用');
   return replay(p,'level-offline-clears',input,now,()=>{
    if(!Array.isArray(input.clears)||input.clears.length<1||input.clears.length>20)fail(400,'INVALID_OFFLINE_CLEARS','离线通关数据无效');
    const ordered=levelConfiguration.chapters.flatMap(chapter=>chapter.pieces.map((_,index)=>chapter.id+'-'+(index+1))),order=new Map(ordered.map((id,index)=>[id,index]));
    const clearIds=new Set(),levelIds=new Set(),entries=[],results=[];let totalEnergy=0;
    for(const entry of input.clears){
     const clearId=typeof entry?.clearId==='string'?entry.clearId:null,levelId=typeof entry?.levelId==='string'?entry.levelId:null;
     if(clearId!==null&&clearIds.has(clearId)||levelId!==null&&levelIds.has(levelId))continue;
     if(clearId!==null)clearIds.add(clearId);if(levelId!==null)levelIds.add(levelId);
     if(!entry||typeof entry!=='object'||Array.isArray(entry)||!requestKey(clearId)||levelId===null||levelId.length>100||!Number.isSafeInteger(entry.completedAt)||!Number.isSafeInteger(entry.elapsedMs)||entry.elapsedMs<0||!Number.isSafeInteger(entry.pieces)||entry.pieces<=0){results.push({clearId,levelId,status:'rejected',energy:0,code:'INVALID'});continue;}
     entries.push(entry);
    }
    entries.sort((a,b)=>(order.get(a.levelId)??Infinity)-(order.get(b.levelId)??Infinity));
    for(const {clearId,levelId,completedAt,elapsedMs,pieces}of entries){
     const level=levels.view(p.id,now).chapters.flatMap(chapter=>chapter.levels).find(level=>level.id===levelId);
     let status='rejected',energy=0,code;
     if(!level)code='INVALID_LEVEL';
     else if(pieces!==level.pieces)code='PIECES_MISMATCH';
     else if(elapsedMs<pieces*200)code='TOO_FAST';
     else if(level.status==='cleared')status='duplicate';
     else if(level.status==='locked'||level.status==='unavailable')status='deferred';
     else{
      const configuredEnergy=energyEnabled?levelConfiguration.firstClearEnergy:0;
      const firstClear=levels.recordClear(p.id,levelId,'offline:'+clearId,Math.min(Math.max(completedAt,0),now),configuredEnergy);
      status=firstClear?'accepted':'duplicate';energy=firstClear?configuredEnergy:0;p.energy+=energy;
      if(firstClear)tuanziSide('offline clear',()=>tuanzi.levelClear(p.id,'offline:'+clearId,now));
      events.record(p.id,'level-clear',null,{levelId,firstClear,energy,offline:true,clearId,elapsedMs},now);
     }
     totalEnergy+=energy;results.push({clearId,levelId,status,energy,...(code?{code}:{})});
    }
    saveProfile(p);return {results,energy:totalEnergy,levels:levels.view(p.id,now),profile:profileView(p,now)};
   });
  }
  if(path==='/api/mobile/profile'){
   if(method==='PATCH'){
    if(input.name!==undefined&&!customNames)fail(403,'CUSTOM_NAMES_UNAVAILABLE','公开测试暂不开放自定义昵称');
    if(input.name!==undefined){if(typeof input.name!=='string'||!input.name.trim()||Array.from(input.name.trim()).length>16||Array.from(input.name).some(c=>c.charCodeAt(0)<32||c.charCodeAt(0)===127))fail(400,'INVALID_NAME','昵称请填写1～16个字');p.name=input.name.trim();}
    if(input.autoSupply!==undefined){if(typeof input.autoSupply!=='boolean')fail(400,'INVALID_SETTING','自动补给设置无效');p.autoSupply=input.autoSupply;}
   }else if(method!=='GET')fail(405,'METHOD_NOT_ALLOWED','请求方式无效');return profileView(p,now);
  }
  const collectionView=()=>{
   const view=collection.view(p.id,now);
   if(request.artworkSnapshot===true){view.albums=view.albums.map(album=>({...album,images:album.images.map(photo=>displayPhoto(photo,request))}));view.packs=view.packs.map(pack=>{const cover=pack.images.find(photo=>photo.thumbSrc===pack.coverSrc)??pack.images[0];return {...pack,images:pack.images.map(photo=>displayPhoto(photo,request)),coverSrc:cover?displayPhoto(cover,request).thumbSrc:pack.coverSrc};});}
   return {...view,profile:profileView(p,now)};
  };
  if(path==='/api/mobile/collection'&&method==='GET')return collectionView();
  if(path==='/api/mobile/collection/buy'&&method==='POST')return replay(p,'collection-buy',input,now,()=>{const purchase=collection.buy(p.id,input.packId,now);return {...collectionView(),purchase};});
  if(path==='/api/mobile/collection/craft'&&method==='POST')return replay(p,'collection-craft',input,now,()=>{const crafted=collection.craft(p.id,input.decorationId,now);return {...collectionView(),crafted};});
  if(path==='/api/mobile/collection/equip'&&method==='POST')return replay(p,'collection-equip',input,now,()=>{collection.equip(p.id,input.decorationId);return collectionView();});
  // 治愈时光: two completed rewarded ads unlock one picture permanently, capped at 2 unlock ads (1 picture) per Beijing day.
  if(path==='/api/mobile/collection/unlock/challenge'&&method==='POST'){
   if(typeof input.imageId!=='string')fail(400,'INVALID_AD_IMAGE','请选择要解锁的图片');
   const pendingWatches=db.prepare("SELECT COUNT(*) n FROM mobile_ad_challenges WHERE owner=? AND kind='image' AND context LIKE 'unlock:%' AND used=0 AND expires_at>? AND request_id<>?").get(p.id,now,typeof input.requestId==='string'?input.requestId:'').n;
   collection.assertAdUnlockAllowed(p.id,input.imageId,now,pendingWatches);
   return challenge(p,{kind:'image',requestId:input.requestId,context:'unlock:'+input.imageId},now);
  }
  if(path==='/api/mobile/collection/unlock/redeem'&&method==='POST')return replay(p,'collection-unlock',input,now,()=>{
   if(!adsEnabled)fail(503,'ADS_UNAVAILABLE','当前平台未开放广告');
   if(typeof input.imageId!=='string')fail(400,'INVALID_AD_IMAGE','请选择要解锁的图片');collection.adUnlockAlbum(input.imageId,now);
   consumeChallenge(p,{...input,kind:'image'},'unlock:'+input.imageId,'',now);
   const result=collection.unlockAdImage(p.id,input.imageId,now);return {...collectionView(),unlocked:{imageId:input.imageId,...result}};
  });
  if(path==='/api/mobile/collection/unlock/cancel'&&method==='POST'){
   if(typeof input.imageId!=='string'||!requestKey(input.requestId)||typeof input.rewardToken!=='string')fail(400,'INVALID_AD_IMAGE','解锁请求无效');
   const row=db.prepare('SELECT * FROM mobile_ad_challenges WHERE token=? AND owner=? AND context=? AND kind=? AND request_id=?').get(input.rewardToken,p.id,'unlock:'+input.imageId,'image',input.requestId);
   if(!row)fail(403,'AD_REQUIRED','广告请求不属于当前身份');
   if(row.used===0)db.prepare('UPDATE mobile_ad_challenges SET used=2 WHERE token=? AND used=0').run(row.token);
   return {ok:true};
  }
  // Completion double reward: one completed rewarded ad doubles base completion coins & fragments once per room.
  if(path==='/api/mobile/completion/double/challenge'&&method==='POST'){
   if(typeof input.roomId!=='string'||!requestKey(input.roomId))fail(400,'INVALID_ROOM','房间编号无效');
   const room=readRoom(input.roomId);if(room.diagnostic===true||!room.completedAt)fail(409,'COMPLETION_NOT_FOUND','该房间尚未完成');
   collection.assertCompletionDoubleAllowed(p.id,room.id);
   return challenge(p,{kind:'completion-double',requestId:input.requestId,context:'completion-double:'+room.id},now);
  }
  if(path==='/api/mobile/completion/double/redeem'&&method==='POST')return replay(p,'completion-double',input,now,()=>{
   if(!adsEnabled)fail(503,'ADS_UNAVAILABLE','当前平台未开放广告');
   if(typeof input.roomId!=='string'||!requestKey(input.roomId))fail(400,'INVALID_ROOM','房间编号无效');
   const room=readRoom(input.roomId);if(room.diagnostic===true||!room.completedAt)fail(409,'COMPLETION_NOT_FOUND','该房间尚未完成');
   collection.assertCompletionDoubleAllowed(p.id,room.id);
   consumeChallenge(p,{...input,kind:'completion-double'},'completion-double:'+room.id,'',now);
   const doubled=collection.claimCompletionDouble(p.id,room.id,now);
   events.record(p.id,'completion-double',room.id,{coins:doubled.coins,fragments:doubled.fragments},now);
   return {doubled:{roomId:room.id,...doubled},completion:collection.completion(p.id,room.id),collection:collection.summary(p.id,now),profile:profileView(p,now)};
  });
  if(path==='/api/mobile/completion/double/cancel'&&method==='POST'){
   if(typeof input.roomId!=='string'||!requestKey(input.roomId)||!requestKey(input.requestId)||typeof input.rewardToken!=='string')fail(400,'INVALID_ROOM','翻倍请求无效');
   const row=db.prepare('SELECT * FROM mobile_ad_challenges WHERE token=? AND owner=? AND context=? AND kind=? AND request_id=?').get(input.rewardToken,p.id,'completion-double:'+input.roomId,'completion-double',input.requestId);
   if(!row)fail(403,'AD_REQUIRED','广告请求不属于当前身份');
   if(row.used===0)db.prepare('UPDATE mobile_ad_challenges SET used=2 WHERE token=? AND used=0').run(row.token);
   return {ok:true};
  }
  const taskView=()=>({...tasks.view(p,now),profile:profileView(p,now)});
  if(retention&&path==='/api/mobile/retention'&&method==='GET'){
   retention.login(p.id,now);return {...retention.view(p.id,now,engine.dailyPuzzleDate(dailyClock(now))),profile:profileView(p,now)};
  }
  if(retention&&path==='/api/mobile/retention/weekly-claim'&&method==='POST')return replay(p,'weekly-gift-claim',input,now,()=>{
   const granted=retention.claim(p,now);saveProfile(p);return {...retention.view(p.id,now,engine.dailyPuzzleDate(dailyClock(now))),granted,profile:profileView(p,now)};
  });
  if(path==='/api/mobile/tuanzi'||path.startsWith('/api/mobile/tuanzi/'))return tuanziRoute(request,p,input,path,now);
  if(!web&&path==='/api/mobile/redeem'&&method==='POST'){
   if(!redeem)fail(503,'REDEEM_DISABLED','兑换功能暂未开放');
   return replay(p,'redeem-code',input,now,()=>{const redeemed=redeem.claim(p,input.code,now);saveProfile(p);return {redeemed,profile:profileView(p,now)};});
  }
  if(path==='/api/mobile/tasks'&&method==='GET')return taskView();
  if(path==='/api/mobile/gifts/open'&&method==='POST')return replay(p,'gift-open',input,now,()=>{const opened=tasks.open(p,input,now);return {...taskView(),opened};});
  if(path==='/api/mobile/invitations/share'&&method==='POST')return replay(p,'invitation-share',input,now,()=>{if(shareRewards&&input.shared!==true)fail(403,'SHARE_REQUIRED','请通过分享面板完成分享，复制链接不计奖励');const shared=tasks.share(p,input,now);return {...taskView(),shared};});
  if(path==='/api/mobile/invitations/accept'&&method==='POST')return replay(p,'invitation-accept',input,now,()=>{const accepted=tasks.accept(p,input,now);return {...taskView(),accepted};});
  if(path==='/api/mobile/share/challenge'&&method==='POST'){
   if(!shareRewards||web)fail(503,'SHARE_UNAVAILABLE','当前平台未开放分享奖励');
   // Keep legacy supply share endpoints working for older TapTap/WeChat clients; new TapTap UI only calls /api/mobile/supply/*.
   if(input.context==='supply'){if(!['energy','create'].includes(input.kind))fail(400,'INVALID_SUPPLY','补给种类无效');if(input.kind==='energy'&&p.shareEnergyDay===shareEnergyDay(now))fail(409,'SHARE_DAILY_LIMIT',SHARE_ENERGY_DAILY_TEXT);}
   else if(typeof input.context==='string'&&/^room\/[a-f0-9]{32}$/.test(input.context)){
    if(!['hint','underlay'].includes(input.kind))fail(400,'INVALID_TOOL','分享工具无效');const room=readRoom(input.context.slice(5));authorize(room,request,now);
    if(toolFreeUses(p.id,input.kind)<NEWCOMER_FREE_TOOL_USES)fail(409,'FREE_TOOL_AVAILABLE','请先使用新手免费次数');
   }else fail(400,'INVALID_SHARE','分享用途无效');
   return challenge(p,{...input,context:'share:'+input.context,authorization:input.context==='supply'?'':request.authorization??''},now);
  }
  if(path==='/api/mobile/share/cancel'&&method==='POST'){
   if(!requestKey(input.requestId)||input.context!=='supply'&&!(typeof input.context==='string'&&/^room\/[a-f0-9]{32}$/.test(input.context)))fail(400,'INVALID_SHARE','分享请求无效');
   const row=db.prepare('SELECT * FROM mobile_ad_challenges WHERE token=? AND owner=? AND context=? AND kind=? AND request_id=?').get(input.rewardToken??'',p.id,'share:'+input.context,input.kind,input.requestId);
   if(!row||row.auth_hash!==hash(input.context==='supply'?'':request.authorization??''))fail(403,'SHARE_REQUIRED','分享请求不属于当前身份');
   if(row.used===0)db.prepare('UPDATE mobile_ad_challenges SET used=2 WHERE token=? AND used=0').run(row.token);return profileView(p,now);
  }
  if(path==='/api/mobile/share/redeem'&&method==='POST')return replay(p,'share-supply',input,now,()=>{
   if(!shareRewards||web)fail(503,'SHARE_UNAVAILABLE','当前平台未开放分享奖励');
   if(input.context!=='supply'||!['energy','create'].includes(input.kind))fail(400,'INVALID_SUPPLY','补给种类无效');
   if(p.supply[input.kind]>=3)fail(409,'SUPPLY_FULL','库存已满');if(input.kind==='energy'&&p.shareEnergyDay===shareEnergyDay(now))fail(409,'SHARE_DAILY_LIMIT',SHARE_ENERGY_DAILY_TEXT);consumeChallenge(p,input,'share:supply','',now);p.supply[input.kind]++;if(input.kind==='energy')p.shareEnergyDay=shareEnergyDay(now);saveProfile(p);return profileView(p,now);
  });
  if(path==='/api/mobile/supply/challenge'&&method==='POST')return challenge(p,{kind:input.kind,requestId:input.requestId,allowSkip:input.adSkipped===true},now);
  if(path==='/api/mobile/supply/redeem'&&method==='POST')return replay(p,'supply-redeem',input,now,()=>{
   if(!adsEnabled&&!(!web&&input.adSkipped===true))fail(503,'ADS_UNAVAILABLE','当前平台暂未开放广告，请稍后再试');
   if(!['energy','create'].includes(input.kind))fail(400,'INVALID_SUPPLY','补给种类无效');
   if(p.supply[input.kind]>=3)fail(409,'SUPPLY_FULL','库存已满');consumeChallenge(p,input,'supply','',now);p.supply[input.kind]=input.kind==='create'?3:p.supply[input.kind]+1;saveProfile(p);return profileView(p,now);
  });
  if(path==='/api/mobile/supply/cancel'&&method==='POST'){
   if(!['energy','create'].includes(input.kind)||!requestKey(input.requestId)||typeof input.rewardToken!=='string')fail(400,'INVALID_SUPPLY','补给请求无效');
   const challenge=db.prepare("SELECT * FROM mobile_ad_challenges WHERE token=? AND owner=? AND context='supply' AND kind=? AND request_id=?").get(input.rewardToken,p.id,input.kind,input.requestId);
   if(!challenge)fail(403,'AD_REQUIRED','广告请求不属于当前身份');
   if(challenge.used===0)db.prepare('UPDATE mobile_ad_challenges SET used=2 WHERE token=? AND used=0').run(challenge.token);
   return profileView(p,now);
  }
  if(path==='/api/mobile/supply/use'&&method==='POST')return replay(p,'supply-use',input,now,()=>{
   if(!energyEnabled)fail(409,'ENERGY_UNAVAILABLE','网页版无需体力补给');
   if(input.kind!=='energy')fail(400,'INVALID_SUPPLY','建房券会在创建成功时使用');if(p.energy>=playerEnergyCap(p))fail(409,'ENERGY_FULL','体力已满，无需使用');if(p.supply.energy<1)fail(409,'SUPPLY_EMPTY','没有体力包');p.supply.energy--;p.energy=playerEnergyCap(p);p.energyAt=now;saveProfile(p);return profileView(p,now);
  });
  if(path==='/api/rewarded/challenge'&&method==='POST'){
   if(typeof input.context!=='string'||!/^room\/[a-f0-9]{32}$/.test(input.context)||!['hint','underlay'].includes(input.kind))fail(400,'INVALID_TOOL','广告工具请求无效');
   const room=readRoom(input.context.slice(5));authorize(room,request,now);
   if(toolFreeUses(p.id,input.kind)<NEWCOMER_FREE_TOOL_USES)fail(409,'FREE_TOOL_AVAILABLE','请先使用新手免费次数');
   return challenge(p,{...input,authorization:request.authorization??'',allowSkip:input.adSkipped===true},now);
  }
  if(path==='/api/auth/me'&&method==='GET')return {account:null};
  if(path==='/api/auth/logout'&&method==='POST')return {ok:true};
  if(path==='/api/guest'&&method==='POST')return {ready:true};
  if(path==='/api/connection'&&method==='GET')return {mode:'mobile-v3-isolated',inviteOrigin:null};
  if(path==='/api/my-rooms'&&method==='GET')return {rooms:profileView(p,now).ownedRooms,serverTime:now};
  if(path==='/api/room-history'&&method==='GET')return {rooms:roomHistory.view(p.id,now),limit:10,limits:roomHistory.limits,serverTime:now};
  if(path==='/api/my-rooms'&&method==='POST'){
   if(input.action!=='remove'||typeof input.roomId!=='string'||!requestKey(input.roomId))fail(400,'INVALID_MANAGEMENT','请选择自己的房间');
   const room=readRoom(input.roomId);if(room.ownerId!==p.id)fail(403,'OWNER_REQUIRED','只能删除自己的房间列表记录');
   roomHistory.removeOwned(p.id,room.id,now);return {ok:true,rooms:profileView(p,now).ownedRooms,serverTime:now};
  }
  if(path==='/api/lobby'&&method==='GET'){
   // A public table that nobody is sitting at and that is still under 10% done drops out of the lobby five
   // minutes after the last sign of play; anyone joining or moving a piece brings it back. Invites, the
   // owner's list and friend links still reach it. Tables with more progress keep their usual lobby day.
   const quietBarelyStarted=r=>r.members.every(m=>now-m.lastSeen>=engine.ONLINE_MS)&&engine.placedCount(r.puzzle)<0.1*r.puzzle.cols*r.puzzle.rows&&now-Math.max(r.lastPlayedAt??r.createdAt,r.lastLeftAt??0,...r.members.map(m=>m.lastSeen))>=LOBBY_QUIET_HIDE_MS;
   const limit=Math.max(1,Math.min(24,Number(url.searchParams.get('limit'))||12)),cursor=url.searchParams.get('cursor');
   let before=null;if(cursor){try{before=JSON.parse(Buffer.from(cursor,'base64url').toString());if(!Array.isArray(before)||![2,3].includes(before.length)||!Number.isSafeInteger(before[0])||before[0]<0||!requestKey(before.at(-1))||before.length===3&&!Number.isSafeInteger(before[1]))throw Error();}catch{fail(400,'INVALID_CURSOR','列表游标无效');}}
   const listed=openPublicRooms().filter(r=>r.expiresAt>now&&!quietBarelyStarted(r)&&(request.artworkSnapshot===true||!engine.roomUsesUpgradedArtwork(r))),byId=new Map(listed.map(r=>[r.id,r]));
   let cards=listed.map(r=>card(r,now));
   const dir=url.searchParams.get('direction'),pieces=Number(url.searchParams.get('pieces')),open=url.searchParams.get('open')==='1',active=url.searchParams.get('active')==='1';
   cards=cards.filter(r=>(!dir||dir==='all'||r.direction===dir)&&(!pieces||r.pieces===pieces)&&(!open||r.players<r.maxPlayers&&r.acceptingNew)&&(!active||r.players>0));
   // Legacy cursors finish in [createdAt, id] order; new cursors use [players, activityAt, id], all descending.
   const legacy=before?.length===2,activityAt=r=>r.lastPlayedAt??r.createdAt;cards.sort((a,b)=>(legacy?b.createdAt-a.createdAt:b.players-a.players||activityAt(b)-activityAt(a))||b.id.localeCompare(a.id));
   const total=cards.length;if(before)cards=cards.filter(r=>legacy?r.createdAt<before[0]||r.createdAt===before[0]&&r.id<before[1]:r.players<before[0]||r.players===before[0]&&(activityAt(r)<before[1]||activityAt(r)===before[1]&&r.id<before[2]));const page=cards.slice(0,limit),last=page.at(-1),nextCursor=cards.length>limit&&last?Buffer.from(JSON.stringify(legacy?[last.createdAt,last.id]:[last.players,activityAt(last),last.id])).toString('base64url'):null;
   // Seated players (up to four) let the lobby show real avatars; plus two small lobby counters.
   const seated=room=>room.members.filter(m=>m.guestId&&now-m.lastSeen<engine.ONLINE_MS).slice(0,4).map(m=>({name:m.name,level:readProfile(m.guestId,now).level,decoration:collection.equipped(m.guestId)}));
   return {rooms:page.map(c=>({...c,members:seated(byId.get(c.id))})),nextCursor,total,online:social.onlineCount(now),dailyFinished:dailyFinishedCount(now),serverTime:now,mode:'mobile-v3-isolated'};
  }
  if(path==='/api/rooms'&&method==='POST')return replay(p,'create-room',input,now,()=>{
   const mode=input.mode??'selected';let level;
   if(mode==='level'){
    level=levels.view(p.id,now).chapters.flatMap(chapter=>chapter.levels).find(item=>item.id===input.levelId);
    if(!level)fail(400,'INVALID_LEVEL','请选择有效关卡');
    if(level.status==='unavailable')fail(409,'LEVEL_UNAVAILABLE','关卡暂不可用');
    if(level.status==='locked')fail(403,'LEVEL_LOCKED','请先完成前一关');
    const existing=db.prepare('SELECT data FROM mobile_rooms WHERE owner=? AND completed_at IS NULL AND closed_at IS NULL ORDER BY created_at DESC').all(p.id).map(row=>JSON.parse(row.data)).find(room=>room.mobileMode==='level'&&room.mobileLevelId===level.id&&room.expiresAt>now);
    if(existing)return join(existing,p,{},now,request);
   }
   const pieces=level?level.pieces:mode==='daily'?108:input.pieces,visibility=level?'private':input.visibility??'public';
   if(!['random','selected','daily','level'].includes(mode)||!level&&!MOBILE_COUNTS.includes(pieces)||!['public','private'].includes(visibility))fail(400,'INVALID_ROOM_OPTIONS','请选择48、108、300或500片及有效房间类型');
   if(!level&&p.level<pieceLevel(pieces))fail(403,'PIECES_LEVEL_LOCKED',pieceLevel(pieces)+'级解锁'+pieces+'片房间，先拼小一点的吧',{requiredLevel:pieceLevel(pieces),level:p.level});
   if(mode==='daily'&&visibility!=='public')fail(400,'INVALID_ROOM_OPTIONS','每日拼图为公开房间');
   const direction=input.direction??'all';if(!['all','portrait','landscape','square'].includes(direction))fail(400,'INVALID_DIRECTION','图片方向无效');
   let photo;
   if(level)photo=engine.RESTORABLE_PHOTOS.find(photo=>photo.id===level.imageId);
   else if(mode==='daily')photo=dailyContent?.select(now)??engine.dailyPuzzle(dailyClock(now));
   else if(mode==='random'){
    if(input.imageId)fail(400,'RANDOM_IMAGE_NOT_SELECTABLE','随机模式不能指定图片');
    const pool=galleryPhotos(now).filter(photo=>{const bound={...photo,...creationArtwork(photo,pieces,request)};return collection.randomAllowed(p.id,photo.id,now)&&mobileGridForPhoto(bound,pieces)&&(direction==='all'||directionOf(bound)===direction);});if(!pool.length)fail(400,'NO_IMAGE_AVAILABLE','该条件下没有可用图片');photo=pool[randomInt(0,pool.length)];
   }else photo=galleryPhotos(now).find(p=>p.id===input.imageId);
   if(!photo)fail(400,'INVALID_IMAGE','请选择可用图片');
   if(!web&&mode==='selected'&&collection.packedImageIds(now).includes(photo.id)&&!collection.freeImageIds(now).includes(photo.id)&&!collection.ownsImage(p.id,photo.id,now))fail(403,'PACK_LOCKED',collection.albumOf(photo.id,now)?.id&&AD_UNLOCK_ALBUM_IDS.has(collection.albumOf(photo.id,now).id)?'这张图看两次广告就能解锁（每日限 1 张），解锁后再来开拼':'这张图在未解锁的图包里，请先解锁图包');
   const artwork=creationArtwork(photo,pieces,request),grid=mobileGridForPhoto({...photo,...artwork},pieces,mode);if(!grid)fail(400,'UNSUPPORTED_RESOLUTION','图片不支持该片数');
   if(mode==='daily'){
    const existing=db.prepare("SELECT data FROM mobile_rooms WHERE visibility='public' AND completed_at IS NULL AND closed_at IS NULL ORDER BY created_at DESC").all().map(r=>JSON.parse(r.data)).find(r=>r.mobileDay===engine.dailyPuzzleDate(dailyClock(now))&&r.mobileMode==='daily'&&r.expiresAt>now&&r.members.filter(m=>now-m.lastSeen<engine.ONLINE_MS).length<seatLimit(r)&&r.acceptingNew!==false&&engine.resolveRoomArtwork(r,engine.RESTORABLE_PHOTOS)?.revision===artwork.revision);
    if(existing)return join(existing,p,{},now,request);
   }
   const owned=db.prepare('SELECT COUNT(*) n FROM mobile_rooms WHERE owner=? AND completed_at IS NULL AND closed_at IS NULL AND COALESCE(json_extract(data,\'$.mobileMode\'),\'\') NOT IN (\'level\',\'postcard\') AND json_extract(data,\'$.diagnostic\') IS NOT 1 AND NOT EXISTS(SELECT 1 FROM mobile_room_list_removals x WHERE x.owner=mobile_rooms.owner AND x.room_id=mobile_rooms.id)').get(p.id).n;const ownLimit=web?3:5;if(mode!=='level'&&owned>=ownLimit)fail(409,'ROOM_LIMIT','最多保留'+ownLimit+'个未完成的自创房间入口，请先从自己的房间列表删除一间',{ownedRooms:profileView(p,now).ownedRooms});
   const needsTicket=mode!=='level'&&!web&&(visibility==='private'||mode==='selected'&&!collection.ownsImage(p.id,photo.id,now)),starter=needsTicket&&p.starterSelectionAvailable;
   if(needsTicket&&!starter&&p.supply.create<1)fail(402,'CREATE_TICKET_REQUIRED','需要1张建房券');
   const room={id:id(),ownerId:p.id,visibility,title:photo.title,artwork,puzzle:engine.createFittedPuzzle(photo.id,grid.cols,grid.rows),mobilePieces:pieces,mobileMode:mode,mobileDay:mode==='daily'?engine.dailyPuzzleDate(dailyClock(now)):null,mobileInviteCode:visibility==='private'?randomBytes(16).toString('hex'):null,revision:0,createdAt:now,expiresAt:now+30*86400000,completedAt:null,retentionVersion:2,lastPlayedAt:now,members:[],leases:{},startedAt:null,participants:{}};
   if(level)room.mobileLevelId=level.id;
   if(starter)p.starterSelectionAvailable=false;else if(needsTicket)p.supply.create--;saveRoom(room);events.record(p.id,'room-create',room.id,{mode,pieces,visibility},now);if(level)events.record(p.id,'level-start',room.id,{levelId:level.id,pieces},now);return join(room,p,{},now,request);
  });
  const match=/^\/api\/rooms\/([a-f0-9]{32})(?:\/(join|cursors|cheers|chat|assistance|management|continuation|invitation|tap-preview))?$/.exec(path);
  if(!match)fail(404,'NOT_FOUND','接口不存在');const room=readRoom(match[1]),part=match[2];
  if(room.diagnostic===true&&(room.ownerId!==p.id||!diagnosticAllowed(p.id)))fail(403,'DIAGNOSTIC_FORBIDDEN','该测试房间仅对指定账号开放');
  if(part!=='management'&&method!=='DELETE'&&!(method==='POST'&&!part&&input.type==='leave'))requireArtworkClient(room,request);
  if(part==='join'&&method==='POST')return join(room,p,input,now,request);
  if(part==='assistance')return help(room,p,request,input,now,url);
  if((method==='DELETE'&&!part)||part==='management'){
   if(room.ownerId!==p.id)fail(403,'OWNER_REQUIRED','只有房主可以管理房间');
   if(method==='GET')return {owner:true,acceptingNew:room.acceptingNew!==false,inviteCode:room.mobileInviteCode};
   if(method==='DELETE'||input.action==='close'){
    roomHistory.removeOwned(p.id,room.id,now);
    return {ok:true};
   }
   if(typeof input.acceptingNew==='boolean'){room.acceptingNew=input.acceptingNew;room.revision++;saveRoom(room);return {ok:true,acceptingNew:room.acceptingNew};}fail(400,'INVALID_MANAGEMENT','管理操作无效');
  }
  const member=authorize(room,request,now);
  if(part==='tap-preview'){
   if(method!=='POST')fail(405,'METHOD_NOT_ALLOWED','请求方式无效');
   if(!taptapView(p.id)?.bound||member.lastSeen<=0)fail(403,'TAP_PREVIEW_IDENTITY','仅已绑定的TapTap玩家可使用平台同步');
   return tapPreview.request(room,member,input);
  }
  if(part==='invitation'&&method==='GET'){if(room.ownerId!==p.id)fail(403,'OWNER_REQUIRED','只有房主可以查看邀请码');return {inviteCode:room.mobileInviteCode,roomId:room.id};}
  if(part==='cheers'){
   if(member.lastSeen<=0)fail(409,'ROOM_ADMISSION_REQUIRED','请先重新连接房间');
   if(method==='POST')putCheer(room,member,input,now);else if(method!=='GET')fail(405,'METHOD_NOT_ALLOWED','请求方式无效');
   return cheersView(room.id,method==='POST'?input.after:url.searchParams.get('after'),now);
  }
  if(part==='cursors'){
   if(member.lastSeen<=0)fail(409,'ROOM_ADMISSION_REQUIRED','请先重新连接房间');
   if(method==='POST'){
    // Older clients send null when their pointer leaves the canvas. Membership
    // owns removal; acknowledge the current writer's sequence without erasing
    // its position or letting an inactive tab take over another writer.
    cursorState(room.id,true);if(putCursor(room,member,input,now))markRoom(room.id,{room:false,cursors:true});
   }
   else if(method!=='GET')fail(405,'METHOD_NOT_ALLOWED','请求方式无效');
   // Legacy observers expire by updatedAt. Confirm continuing membership on
   // each reply while preserving the actual movement time separately.
   return cursorsView(room,now,undefined,true);
  }
  if(part==='chat'){
   const after=Number(method==='POST'?(input.after??0):(url.searchParams.get('after')??0));if(!Number.isSafeInteger(after)||after<0)fail(400,'INVALID_CHAT_CURSOR','消息游标无效');let message;
   if(method==='POST'){
    const text=input.phraseId!==undefined?CHAT_PHRASES[Number.isSafeInteger(input.phraseId)?input.phraseId:-1]:input.text;
    if(!requestKey(input.requestId)||!CHAT_PHRASES.includes(text)||input.text!==undefined&&input.text!==text)fail(400,'PRESET_CHAT_ONLY','请选择合作短语或表情',{phrases:CHAT_PHRASES});
    const old=db.prepare('SELECT data FROM mobile_chat WHERE room_id=? AND owner=? AND request_id=?').get(room.id,p.id,input.requestId);
    if(old){message=JSON.parse(old.data);if(message.text!==text)fail(409,'REQUEST_CONFLICT','消息编号已使用');}
    else {const recent=db.prepare('SELECT sent_at FROM mobile_chat WHERE owner=? ORDER BY sent_at DESC LIMIT 20').all(p.id);if(recent[0]&&now-recent[0].sent_at<2000||recent.length===20&&now-recent.at(-1).sent_at<60000)fail(429,'CHAT_RATE_LIMIT','消息发送较快，请稍后');message={playerId:member.id,code:social.person(p.id,now).code,name:p.name,color:member.color,level:p.level,text,sentAt:now};const inserted=db.prepare('INSERT INTO mobile_chat(room_id,owner,request_id,data,sent_at) VALUES(?,?,?,?,?)').run(room.id,p.id,input.requestId,JSON.stringify(message),now);message.id=Number(inserted.lastInsertRowid);db.prepare('UPDATE mobile_chat SET data=? WHERE id=?').run(JSON.stringify(message),message.id);}
   }else if(method!=='GET')fail(405,'METHOD_NOT_ALLOWED','请求方式无效');
   const rows=db.prepare('SELECT id,owner,data FROM mobile_chat WHERE room_id=? AND id>? ORDER BY id DESC LIMIT 100').all(room.id,after).reverse();const messages=rows.filter(row=>!social.blocked(p.id,row.owner)).map(row=>({...JSON.parse(row.data),code:social.person(row.owner,now).code}));return {messages,cursor:rows.at(-1)?.id??after,...(message?{message}:{}),phrases:CHAT_PHRASES};
  }

  if(part)fail(404,'NOT_FOUND','请从大厅创建下一局');
  const sinceText=url.searchParams.get('since'),since=sinceText!==null?(/^\d+$/.test(sinceText)?Number(sinceText):null):(method==='POST'&&Number.isSafeInteger(input.since)&&input.since>=0?input.since:null);
  if(method==='GET')return snapshotView(room,now,since,p.id);
  if(method!=='POST')fail(405,'METHOD_NOT_ALLOWED','请求方式无效');
  if(input.type==='drop'&&!requestKey(input.requestId))fail(400,'REQUEST_ID_REQUIRED','拼合操作缺少有效请求编号');
  const requestInput=input;
  const act=(input=requestInput)=>{
   const before=structuredClone(room.puzzle.groups),oldContrib=room.achievements?.contributors?.[p.id]?.count??0;
   room.mobileContributionXp??=Object.fromEntries(Object.entries(room.achievements?.contributors??{}).map(([owner,value])=>[owner,value.count]));
   member.name=p.name;engine.applyAction(room,member,input,now);
   if(input.type==='claim'&&tapPreview.allowed(room))room.leases[input.groupId].previewId=id();
   if(input.type==='heartbeat'&&input.historyJoin===true)roomHistory.joined(p.id,room,now);
   if(input.type==='leave')room.lastLeftAt=now;
   const streamState=room.diagnostic===true?room.diagnosticActions:room.roomActions;
   if(streamState?.leases&&['claim','drop','release'].includes(input.type))delete streamState.leases[input.groupId];
   const added=(room.achievements?.contributors?.[p.id]?.count??0)-oldContrib;
   let mobileContribution;
   if(added&&room.diagnostic!==true){
    const reward=applyContribution(p,{protectedRoom:p.firstRoomId===room.id&&!p.firstRoomCompleted,freeRoom:room.mobileMode==='postcard',now,randomInt,taskRewards:operationTaskRewards,gameSettings:operationGameSettings,energyEnabled,inviteBonus:readInviteCapBonus(p.id).count});if(!reward){requestEnergyEmpty=[p.id,'energy-empty',room.id,{progressPercent:Math.round(engine.placedCount({...room.puzzle,groups:before})/(room.puzzle.cols*room.puzzle.rows)*100)},now];fail(402,'ENERGY_EMPTY','体力不足，请使用补给或稍后再来',{profile:profileView(p,now)});}
    room.mobileContributionXp[p.id]=(room.mobileContributionXp[p.id]??0)+reward.xp;
    p.lastReward.giftsAdded=tasks.record(p,room,input.requestId,reward.pendingGift,now,engine.ONLINE_MS);
    if(retention&&room.mobileMode==='daily')try{
     const date=engine.dailyPuzzleDate(dailyClock(now));if(room.mobileDay===date)retention.dailyMerge(p.id,date,now);
    }catch(error){console.warn('mobile retention daily merge failed:',error.message);}
    const coins=collection.contribution(p.id,room.id,input.requestId,now)+tasks.beginner(p.id,now).coins;p.lastReward.coins=coins;
    mobileContribution={requestId:input.requestId,groupId:input.groupId,creditedXp:reward.xp,creditedCoins:coins};
   }
   room.revision++;engine.recordRoomChange(room,before);settle(room,now,p);saveRoom(room);if(input.type==='leave')pruneRoomCursors(room);saveProfile(p);return {...snapshotView(room,now,since,p.id),profile:profileView(p,now),...(mobileContribution?{mobileContribution}:{})};
  };
  // Only drops affect growth: avoid writing permanent receipts for heartbeat/move polling.
  if(input.type==='batch')return soloBatch({room,member,p,input,now,since,act});
  // A retried drop gets the current room and profile, as any other action reply would, plus its original
  // contribution; nothing is applied or granted again.
  const dropReceipt={store:roomActionReceipt,restore:stored=>({...snapshotView(room,now,since,p.id),profile:profileView(p,now),...(stored.mobileContribution?{mobileContribution:stored.mobileContribution}:{})})};
  return input.type==='drop'&&requestKey(input.requestId)&&(!request[diagnosticTransport]||room.diagnostic!==true)?replay(p,'room-action:'+room.id,input,now,act,dropReceipt):act();
 }
 /** 团子去旅行 endpoints: only when the capability is on, only after the unlock level. */
 function tuanziRoute(request,p,input,path,now){
  if(!tuanzi)fail(503,'TUANZI_DISABLED','团子去旅行暂未开放');
  const method=request.method,view=()=>({...tuanzi.view(p.id,now),profile:profileView(p,now)});
  if(path==='/api/mobile/tuanzi'&&method==='GET')return view();
  if(method!=='POST')fail(405,'METHOD_NOT_ALLOWED','请求方式无效');
  if(!tuanzi.ensure(p.id,now))fail(403,'TUANZI_LOCKED','通关故事 1-2 后，团子就会搬进小窝');
  tuanzi.advance(p.id,now);
  if(path==='/api/mobile/tuanzi/buy')return replay(p,'tuanzi-buy',input,now,()=>{const bought=tuanzi.buy(p.id,input.itemId,input.requestId,now);return {...view(),bought};});
  if(path==='/api/mobile/tuanzi/pack')return replay(p,'tuanzi-pack',input,now,()=>{const packed=tuanzi.pack(p.id,input,now);return {...view(),packed};});
  if(path==='/api/mobile/tuanzi/sill')return replay(p,'tuanzi-sill',input,now,()=>{const sill=tuanzi.sill(p.id,now);return {...view(),sillClaimed:sill};});
  if(path==='/api/mobile/tuanzi/postcards/read')return replay(p,'tuanzi-read',input,now,()=>{const read=tuanzi.read(p.id,input.cardIds,now);return {...view(),read};});
  const card=/^\/api\/mobile\/tuanzi\/postcards\/([a-z0-9-]{1,64})\/(complete|room)$/.exec(path);
  if(card?.[2]==='complete')return replay(p,'tuanzi-complete',input,now,()=>{
   if(!Number.isSafeInteger(input.elapsedMs)||input.elapsedMs<0)fail(400,'TUANZI_COMPLETE_INVALID','拼图记录无效');
   const completed=tuanzi.completeCard(p.id,card[1],now);return {...view(),completed};
  });
  // A private table for a gallery postcard: friends join by invite, it costs no energy, never reaches the lobby
  // and does not take one of the five unfinished-room slots.
  if(card?.[2]==='room')return replay(p,'tuanzi-room',input,now,()=>{
   const {row}=tuanzi.roomCard(p.id,card[1],now);
   const existing=db.prepare("SELECT data FROM mobile_rooms WHERE owner=? AND completed_at IS NULL AND closed_at IS NULL AND json_extract(data,'$.mobileMode')='postcard'").all(p.id).map(r=>JSON.parse(r.data)).find(r=>r.tuanziCard?.cardId===card[1]&&r.expiresAt>now);
   if(existing)return join(existing,p,{},now,request);
   const photo=galleryPhotos(now).find(item=>item.id===row.image_id);if(!photo)fail(409,'TUANZI_CARD_UNAVAILABLE','这张图暂时不能拼');
   const artwork=creationArtwork(photo,row.pieces,request),grid=mobileGridForPhoto({...photo,...artwork},row.pieces,'postcard');if(!grid)fail(400,'UNSUPPORTED_RESOLUTION','图片不支持该片数');
   const room={id:id(),ownerId:p.id,visibility:'private',title:photo.title,artwork,puzzle:engine.createFittedPuzzle(photo.id,grid.cols,grid.rows),mobilePieces:row.pieces,mobileMode:'postcard',mobileDay:null,mobileInviteCode:randomBytes(16).toString('hex'),revision:0,createdAt:now,expiresAt:now+30*86400000,completedAt:null,retentionVersion:2,lastPlayedAt:now,members:[],leases:{},startedAt:null,participants:{},tuanziCard:{owner:p.id,cardId:card[1]}};
   saveRoom(room);events.record(p.id,'room-create',room.id,{mode:'postcard',pieces:row.pieces,visibility:'private'},now);return join(room,p,{},now,request);
  });
  fail(404,'NOT_FOUND','接口不存在');
 }
 async function bindTapTap(request){
  const now=clock(),sessionIdentity=request.identity;
  try{
   if(typeof sessionIdentity!=='string'||!/^[a-f0-9]{64}$/.test(sessionIdentity))fail(401,'IDENTITY_REQUIRED','连接身份无效');
   const code=typeof request.code==='string'?request.code.trim():'';if(!code||code.length>512)fail(400,'TAPTAP_CODE_REQUIRED','TapTap登录凭证无效');
   const codeHash=hash('taptap-code:'+code);
   let account=db.prepare('SELECT provider_key,canonical_identity FROM mobile_taptap_codes WHERE code_hash=?').get(codeHash);
   let providerKey=account?.provider_key;
   if(!account){
    const exchanged=await tapTapExchange(code);const providerId=typeof exchanged?.unionid==='string'&&exchanged.unionid?exchanged.unionid:exchanged?.openid;
    if(typeof providerId!=='string'||!providerId)fail(401,'TAPTAP_CODE_INVALID','TapTap登录凭证无效或已过期，请重试');
    providerKey=hash('taptap-provider:'+providerId);
   }
   db.exec('BEGIN IMMEDIATE');
   try{
    const current=resolveIdentity(sessionIdentity),existing=db.prepare('SELECT canonical_identity,nickname FROM mobile_taptap_accounts WHERE provider_key=?').get(providerKey);
    let canonical=existing?.canonical_identity??current;
    if(existing&&canonical!==current&&statePresent(current))fail(409,'TAPTAP_ACCOUNT_CONFLICT','该TapTap账号已有其他游戏进度。为保护当前游客数据，请先完成账号选择后再绑定。');
    if(!existing){db.prepare('INSERT INTO mobile_taptap_accounts VALUES(?,?,?,?,?)').run(providerKey,canonical,displayName(request.nickname),now,now);}
    else if(request.nickname!==undefined){db.prepare('UPDATE mobile_taptap_accounts SET nickname=?,updated_at=? WHERE provider_key=?').run(displayName(request.nickname),now,providerKey);}
    db.prepare('INSERT INTO mobile_taptap_sessions VALUES(?,?,?) ON CONFLICT(session_identity) DO UPDATE SET canonical_identity=excluded.canonical_identity,updated_at=excluded.updated_at').run(sessionIdentity,canonical,now);
    if(!account)db.prepare('INSERT INTO mobile_taptap_codes VALUES(?,?,?,?)').run(codeHash,providerKey,canonical,now);
    const p=readProfile(canonical,now);const nickname=displayName(request.nickname)||(existing?.nickname??null);if(nickname){p.name=nickname;p.nameSource='taptap';saveProfile(p);}
    db.exec('COMMIT');commitEpoch++;return {status:200,data:{bound:true,identity:'taptap',taptap:taptapView(canonical),profile:profileView(p,now)}};
   }catch(error){db.exec('ROLLBACK');dropReadCaches();throw error;}
  }catch(error){return {status:error.status??500,data:{error:error.status?error.message:'TapTap账号绑定暂时失败',code:error.code??'TAPTAP_BIND_FAILED'}};}
 }
 function handle(request){
  const now=clock(),handlingAt=performance.now();try{
   if(typeof request.identity!=='string'||!/^[a-f0-9]{64}$/.test(request.identity))fail(401,'IDENTITY_REQUIRED','连接身份无效');
   request.identity=resolveIdentity(request.identity);
   const url=new URL(request.url,'http://mobile.invalid');let input=request.body??{};
   if(Buffer.isBuffer(input)||typeof input==='string'){try{input=JSON.parse(String(input)||'{}');}catch{fail(400,'INVALID_JSON','请求格式无效');}}
   if(!input||typeof input!=='object'||Array.isArray(input))fail(400,'INVALID_JSON','请求格式无效');
   operationRelease=managedContent?.read()??null;requestRelease=operationRelease;
   operationTaskRewards=operationRelease?.taskRewards??taskRewardConfiguration.read();
   operationGameSettings=operationRelease?.gameSettings??gameConfiguration.read();
   operationAlbums=operationRelease?.albums??albumConfiguration.read();
   const playerCard=/^\/api\/mobile\/players\/([^/]+)\/card$/.exec(url.pathname);
   if(playerCard&&request.method==='GET'){
    // Bypass the normal write transaction, profile creation and presence touch.
    const peer=social.cardIdentity(request.identity,playerCard[1],now),row=db.prepare('SELECT data FROM mobile_profiles WHERE id=?').get(peer.owner);
    if(!row)fail(404,'PLAYER_NOT_FOUND','没有找到这个玩家');
    const profile=JSON.parse(row.data);let roomContribution=0;
    const roomId=url.searchParams.get('room');
    if(roomId){const roomRow=db.prepare('SELECT data FROM mobile_rooms WHERE id=? AND closed_at IS NULL').get(roomId);if(roomRow){const room=JSON.parse(roomRow.data),admitted=room.members.some(member=>(member.guestId||member.accountId)===request.identity);if(admitted&&room.expiresAt>now&&(room.diagnostic!==true||room.ownerId===request.identity))roomContribution=room.achievements?.contributors?.[peer.owner]?.count??0;}}
    return {status:200,data:{player:{code:playerCard[1],name:profile.name,level:profile.level,decoration:collection.equipped(peer.owner)},stats:{...collection.playerStats(peer.owner,now),roomContribution},relationship:peer.relationship}};
   }
   social.guard(request,input,url,now);
   db.exec('BEGIN IMMEDIATE');requestProfileData=new Map();requestRoomChanges=new Map();requestCursorUndo=new Map();requestInviteBonuses=new Map();
   try{const p=readProfile(request.identity,now);if(needsName(p))p.name=randomName(p.id);saveProfile(p);social.touch(p.id,now);tuanziSide('activity',()=>tuanzi.activity(p.id,now));const transport=request[diagnosticTransport];
    const execute=(action,since)=>{const before=structuredClone(p);try{return route(request,p,{...action,...(since!==undefined?{since}:{})},new URL('/api/rooms/'+transport.context.roomId,'http://mobile.invalid'),now);}catch(error){for(const key of Object.keys(p))delete p[key];Object.assign(p,before);throw error;}};
    const actionResult=transport?(transport.disconnect?diagnosticActions.disconnect(transport.context,transport.connectionId,execute):diagnosticActions.write(transport.context,transport.input,transport.connectionId,execute)):null;
    const data=actionResult?actionResult.data:route(request,p,input,url,now);if(data?.room?.puzzle)requireArtworkClient(data.room,request);saveProfile(p);db.exec('COMMIT');commitEpoch++;if(requestEnergyEmpty)events.record(...requestEnergyEmpty);for(const [roomId,kind]of requestRoomChanges){if(kind.room)roomVersions.set(roomId,(roomVersions.get(roomId)??0)+1);for(const listener of roomListeners)listener(roomId,kind);}if(data?.diagnostic===true||transport){if(transport?.context.room.diagnostic===true)data.diagnostic=true;data.diagnosticTiming={serverMs:Math.max(0,performance.now()-handlingAt)};}return {status:actionResult?.status??(request.method==='POST'&&url.pathname==='/api/rooms'?201:200),data};}
   catch(error){db.exec('ROLLBACK');dropReadCaches();if(requestEnergyEmpty)events.record(...requestEnergyEmpty);for(const [roomId,state]of requestCursorUndo)cursorRooms.set(roomId,state);throw error;}
  }catch(error){return {status:error.status??500,data:{error:error.status?error.message:'独立拼图服务暂时不可用',code:error.code??(error.status?'ROOM_ERROR':'INTERNAL_ERROR'),...(error.profile?{profile:error.profile}:{}),...(error.freeRemaining?{freeRemaining:error.freeRemaining}:{}),...(error.ownedRooms?{ownedRooms:error.ownedRooms}:{}),...(error.requiredLevel?{requiredLevel:error.requiredLevel}:{}),...(error.phrases?{phrases:error.phrases}:{})}};}
  finally{requestRelease=undefined;requestEnergyEmpty=null;requestProfileData=null;requestRoomChanges=null;requestCursorUndo=null;requestInviteBonuses=null;}
 }
 return {handle,bindTapTap,realtime,capabilities,contentStatus(){const selected=managedContent?.read()??null;return {contentReleaseId:selected?.releaseId??null};},startDaily(){dailyContent?.start();},pruneRequests,close(){clearTimeout(requestPruneStart);clearInterval(requestPruneTimer);clearTimeout(requestPruneStep);clearInterval(cursorTimer);clearInterval(cheerTimer);cheerRooms.clear();cheerRates.clear();flushCursors();tapPreview.clear();roomListeners.clear();dailyContent?.close();db.close();},mode:'mobile-v3-isolated'};
}
