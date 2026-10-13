import {DatabaseSync} from 'node:sqlite';
import {createMobileTasks} from './mobile-tasks.mjs';
import {createTaskRewardSettings} from './task-reward-settings.mjs';
import {createGameSettings} from './game-settings.mjs';
import {createAlbumContent} from './album-content.mjs';
import {createMobileCollection} from './mobile-collection.mjs';
import {createMobileSocial} from './mobile-social.mjs';
import chatPhrases from '../config/social-phrases.json' with {type:'json'};
import {randomBytes,randomInt as secureRandomInt,createHash} from 'node:crypto';
import {mkdirSync,chmodSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import * as engine from '../outputs/mobile/engine.mjs';
import {MOBILE_COUNTS,energyCap,xpForLevel,newProfile,restoreEnergy,adEligible,applyContribution,completionDistribution} from './mobile-economy.mjs';

const id=()=>randomBytes(16).toString('hex');
const hash=value=>createHash('sha256').update(value).digest('hex');
const fail=(status,code,message,extra={})=>{throw Object.assign(new Error(message),{status,code,...extra});};
const requestKey=value=>typeof value==='string'&&/^[a-f0-9]{32}$/.test(value);
const directionOf=photo=>{const d=engine.photoGuidance(photo.id)??photo;return d.width===d.height?'square':d.width>d.height?'landscape':'portrait';};
// Keep the artwork aspect ratio and square piece bodies while respecting mobile limits.
export function mobileGridForPhoto(photo,count){
 const d=engine.photoGuidance(photo.id);if(!d||!MOBILE_COUNTS.includes(count))return null;
 const fitted=engine.gridForDimensions(d.width,d.height,count);if(!fitted)return null;
 if(fitted.count>=48&&fitted.count<=500)return fitted;
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
 const clock=options.now??Date.now,randomInt=options.randomInt??secureRandomInt;
 const taskRewardConfiguration=options.taskRewardSettings??createTaskRewardSettings({configurationPath:options.taskRewardConfigurationPath});
 let operationTaskRewards=taskRewardConfiguration.read();
 const gameConfiguration=options.gameSettings??createGameSettings({configurationPath:options.gameConfigurationPath});
 let operationGameSettings=gameConfiguration.read();
 const albumConfiguration=options.albumContent??createAlbumContent({configurationPath:options.albumConfigurationPath,photos:engine.RESTORABLE_PHOTOS,readSettings:()=>operationGameSettings});
 let operationAlbums=albumConfiguration.read();
 const filename=options.databasePath??':memory:';
 if(filename!==':memory:')mkdirSync(dirname(resolve(filename)),{recursive:true,mode:0o700});
 const db=new DatabaseSync(filename);if(filename!==':memory:')chmodSync(filename,0o600);
 db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
 CREATE TABLE IF NOT EXISTS mobile_profiles(id TEXT PRIMARY KEY,data TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS mobile_rooms(id TEXT PRIMARY KEY,owner TEXT NOT NULL,visibility TEXT NOT NULL,pieces INTEGER NOT NULL,created_at INTEGER NOT NULL,completed_at INTEGER,closed_at INTEGER,data TEXT NOT NULL);
 CREATE INDEX IF NOT EXISTS mobile_rooms_owner ON mobile_rooms(owner,completed_at,closed_at);
 CREATE INDEX IF NOT EXISTS mobile_rooms_lobby ON mobile_rooms(visibility,created_at);
 CREATE TABLE IF NOT EXISTS mobile_requests(owner TEXT NOT NULL,scope TEXT NOT NULL,request_id TEXT NOT NULL,input_hash TEXT NOT NULL,response TEXT NOT NULL,created_at INTEGER NOT NULL,PRIMARY KEY(owner,scope,request_id));
 CREATE TABLE IF NOT EXISTS mobile_ad_challenges(token TEXT PRIMARY KEY,owner TEXT NOT NULL,kind TEXT NOT NULL,request_id TEXT NOT NULL,context TEXT NOT NULL,auth_hash TEXT NOT NULL,expires_at INTEGER NOT NULL,used INTEGER NOT NULL DEFAULT 0,UNIQUE(owner,context,request_id));
 CREATE TABLE IF NOT EXISTS mobile_tool_uses(room_id TEXT NOT NULL,owner TEXT NOT NULL,kind TEXT NOT NULL,uses INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(room_id,owner,kind));
 CREATE TABLE IF NOT EXISTS mobile_tool_grants(room_id TEXT NOT NULL,owner TEXT NOT NULL,request_id TEXT NOT NULL,kind TEXT NOT NULL,expires_at INTEGER NOT NULL,data TEXT NOT NULL,PRIMARY KEY(room_id,owner,request_id));
 CREATE TABLE IF NOT EXISTS mobile_settlements(room_id TEXT NOT NULL,owner TEXT NOT NULL,energy INTEGER NOT NULL,contribution INTEGER NOT NULL,created_at INTEGER NOT NULL,PRIMARY KEY(room_id,owner));
 CREATE TABLE IF NOT EXISTS mobile_chat(id INTEGER PRIMARY KEY AUTOINCREMENT,room_id TEXT NOT NULL,owner TEXT NOT NULL,request_id TEXT NOT NULL,data TEXT NOT NULL,sent_at INTEGER NOT NULL,UNIQUE(room_id,owner,request_id));
 CREATE TABLE IF NOT EXISTS mobile_cursors(room_id TEXT NOT NULL,player_id TEXT NOT NULL,client_id TEXT NOT NULL,seq INTEGER NOT NULL,data TEXT NOT NULL,updated_at INTEGER NOT NULL,PRIMARY KEY(room_id,player_id));`);
 const readProfile=(identity,now)=>{const row=db.prepare('SELECT data FROM mobile_profiles WHERE id=?').get(identity);const p=row?JSON.parse(row.data):newProfile(identity,now,operationGameSettings);restoreEnergy(p,now,operationGameSettings);return p;};
 const saveProfile=p=>db.prepare('INSERT INTO mobile_profiles VALUES(?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data').run(p.id,JSON.stringify(p));
 const tasks=createMobileTasks({db,readProfile,saveProfile,readSettings:()=>operationTaskRewards,readGameSettings:()=>operationGameSettings});
 const dailyContent=options.dailyContent??null;
 const collection=createMobileCollection({db,photos:dailyContent?.collectiblePhotos()??(operationAlbums?engine.RESTORABLE_PHOTOS:engine.GALLERY_VISIBLE_PHOTOS),dailyContent,readSettings:()=>operationGameSettings,readAlbums:()=>operationAlbums,albumTarget:options.albumTarget??'mobile-shared'});
 if(!options.deferDailyStart)dailyContent?.start();
 const galleryPhotos=now=>collection.galleryPhotos(now);
 const readRoom=roomId=>{const row=db.prepare('SELECT data,closed_at FROM mobile_rooms WHERE id=?').get(roomId);if(!row||row.closed_at)fail(404,'ROOM_NOT_FOUND','房间不存在或已关闭');return JSON.parse(row.data);};
 const saveRoom=room=>db.prepare('INSERT INTO mobile_rooms VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET completed_at=excluded.completed_at,closed_at=excluded.closed_at,data=excluded.data').run(room.id,room.ownerId,room.visibility,room.mobilePieces,room.createdAt,room.completedAt,room.closedAt??null,JSON.stringify(room));
 const social=createMobileSocial({db,readProfile,replay,readRoom,authorizeRoom:authorize,roomCard:card,blockedWords:options.socialBlockedWords});
 const profileView=(p,now)=>({code:social.person(p.id,now).code,collection:collection.summary(p.id,now),level:p.level,xp:p.xp,totalXp:p.totalXp,xpToNext:xpForLevel(p.level+1,operationGameSettings),energy:p.energy,energyCap:energyCap(p.level,operationGameSettings),economy:{contributionCost:operationGameSettings.energy.contributionCost,contributionXp:operationGameSettings.energy.contributionXp,firstRoomFree:operationGameSettings.energy.firstRoomFree,upgradeRefill:operationGameSettings.energy.upgradeRefill,upgradeEnergy:operationGameSettings.energy.upgradeEnergy,naturalRecoveryMinutes:operationGameSettings.energy.naturalRecoveryMinutes},giftProgress:p.giftProgress,giftCount:tasks.giftCount(p.id),supply:p.supply,autoSupply:p.autoSupply,adEligible:options.adEnabled===true&&adEligible(p,now),name:p.name,newcomer:!p.firstRoomCompleted,firstRoomId:p.firstRoomId,starterSelectionAvailable:p.starterSelectionAvailable,firstSelectionAvailable:p.starterSelectionAvailable,lastReward:p.lastReward,naturalRecoveryAt:operationGameSettings.energy.naturalRecoveryMinutes>0&&p.energy<energyCap(p.level,operationGameSettings)?p.energyAt+operationGameSettings.energy.naturalRecoveryMinutes*60000:null,serverTime:now,ownedRooms:db.prepare('SELECT data FROM mobile_rooms WHERE owner=? AND completed_at IS NULL AND closed_at IS NULL ORDER BY created_at DESC').all(p.id).map(row=>{const r=JSON.parse(row.data);return {...card(r,now),inviteCode:r.mobileInviteCode??null};})});
 const photoOf=room=>engine.RESTORABLE_PHOTOS.find(p=>p.id===room.puzzle.imageId);
 function card(room,now){const photo=photoOf(room);return {id:room.id,title:room.title||photo?.title||'一起拼图',imageId:room.puzzle.imageId,pieces:room.mobilePieces,actualPieces:room.puzzle.cols*room.puzzle.rows,visibility:room.visibility,players:room.members.filter(m=>now-m.lastSeen<engine.ONLINE_MS).length,placed:engine.placedCount(room.puzzle),completed:room.completedAt!==null,acceptingNew:room.acceptingNew!==false,started:room.startedAt!==null,startedAt:room.startedAt,createdAt:room.createdAt,expiresAt:room.expiresAt,lastPlayedAt:room.lastPlayedAt,direction:photo?directionOf(photo):'landscape',thumbSrc:photo?.thumbSrc};}
 function snapshotView(room,now,since=null,identity=null){const result=engine.roomUpdate(room,now,since);result.requestedPieces=room.mobilePieces;if(identity===room.ownerId&&room.mobileInviteCode)result.inviteCode=room.mobileInviteCode;result.members=result.members.map(m=>{const member=room.members.find(p=>p.id===m.id),identity=member?.guestId||member?.accountId;return {...m,code:identity?social.person(identity,now).code:null,level:identity?readProfile(identity,now).level:0,decoration:identity?collection.equipped(identity):null};});if(identity&&room.completedAt!==null){const award=db.prepare('SELECT energy,contribution FROM mobile_settlements WHERE room_id=? AND owner=?').get(room.id,identity);result.mobileResult={roomId:room.id,contribution:award?.contribution??0,xp:room.mobileContributionXp?.[identity]??award?.contribution??0,energy:award?.energy??0,...collection.completion(identity,room.id)};}return result;}
 function authorize(room,request,now){
  const token=/^Bearer ([a-f0-9]{32})$/.exec(request.authorization??'')?.[1];if(!token)fail(401,'ROOM_ADMISSION_REQUIRED','请重新加入房间');
  const member=engine.authenticate(room,hash(token),now);if(member.guestId!==request.identity)fail(403,'ROOM_IDENTITY_MISMATCH','请用当前身份重新加入房间');return member;
 }
 function bindFirstRoom(p,room){if(room.completedAt===null&&!p.firstRoomId&&!p.firstRoomCompleted)p.firstRoomId=room.id;}
 function join(room,p,input,now){
  if(room.visibility==='private'&&room.ownerId!==p.id&&!room.admitted?.[p.id]&&input.inviteCode!==room.mobileInviteCode)fail(403,'INVITE_REQUIRED','私人房间需要有效邀请码');
  const token=id(),member=engine.addMember(room,id(),p.name,hash(token),now,undefined,p.id);bindFirstRoom(p,room);room.revision++;saveRoom(room);saveProfile(p);
  return {token,playerId:member.id,room:snapshotView(room,now,null,p.id),...(room.ownerId===p.id&&room.mobileInviteCode?{inviteCode:room.mobileInviteCode}:{})};
 }
 function replay(p,scope,input,now,fn){
  if(!requestKey(input.requestId))fail(400,'REQUEST_ID_REQUIRED','缺少有效请求编号，请重试');
  const fingerprint=hash(JSON.stringify(input)),old=db.prepare('SELECT input_hash,response FROM mobile_requests WHERE owner=? AND scope=? AND request_id=?').get(p.id,scope,input.requestId);
  if(old){if(old.input_hash!==fingerprint)fail(409,'REQUEST_CONFLICT','同一请求编号不能用于其他操作');return JSON.parse(old.response);}
  const result=fn();db.prepare('INSERT INTO mobile_requests VALUES(?,?,?,?,?,?)').run(p.id,scope,input.requestId,fingerprint,JSON.stringify(result),now);return result;
 }
 function challenge(p,{kind,requestId,context='supply',authorization=''},now){
  if(!requestKey(requestId))fail(400,'REQUEST_ID_REQUIRED','请求编号无效');
  if(!options.adEnabled)fail(503,'ADS_UNAVAILABLE','广告暂未开放');
  if(!adEligible(p,now))fail(403,'NEWCOMER_PROTECTED','请先完成新手首局体验');
  const existing=db.prepare('SELECT * FROM mobile_ad_challenges WHERE owner=? AND context=? AND request_id=?').get(p.id,context,requestId);
  if(existing){if(existing.kind!==kind||existing.auth_hash!==hash(authorization))fail(409,'REQUEST_CONFLICT','广告请求与当前操作不匹配');if(existing.used||existing.expires_at<=now)fail(409,'AD_EXPIRED','本次广告机会已失效');return {rewardToken:existing.token,expiresAt:existing.expires_at};}
  if(context==='supply'){
   if(!['energy','create'].includes(kind))fail(400,'INVALID_SUPPLY','补给种类无效');
   const pending=db.prepare('SELECT COUNT(*) n FROM mobile_ad_challenges WHERE owner=? AND context=? AND kind=? AND used=0 AND expires_at>?').get(p.id,context,kind,now).n;
   if(p.supply[kind]+pending>=3)fail(409,'SUPPLY_FULL','库存已满或已有待领取奖励');
  }
  const recent=db.prepare('SELECT COUNT(*) n FROM mobile_ad_challenges WHERE owner=? AND expires_at>?').get(p.id,now+540000).n;if(recent>=20)fail(429,'AD_RATE_LIMIT','请稍后再试');
  const token=randomBytes(32).toString('hex'),expiresAt=now+600000;db.prepare('INSERT INTO mobile_ad_challenges VALUES(?,?,?,?,?,?,?,0)').run(token,p.id,kind,requestId,context,hash(authorization),expiresAt);return {rewardToken:token,expiresAt};
 }
 function consumeChallenge(p,input,context,authorization,now){
  const row=typeof input.rewardToken==='string'?db.prepare('SELECT * FROM mobile_ad_challenges WHERE token=?').get(input.rewardToken):null;
  if(!row||row.owner!==p.id||row.kind!==input.kind||row.context!==context||row.request_id!==input.requestId||row.auth_hash!==hash(authorization??''))fail(403,'AD_REQUIRED','请先完整观看对应广告');
  if(row.used||row.expires_at<=now||input.completed!==true)fail(403,'AD_EXPIRED','广告机会已失效或尚未完整观看');
  db.prepare('UPDATE mobile_ad_challenges SET used=1 WHERE token=? AND used=0').run(row.token);
 }
 function settle(room,now,current){
  if(!room.completedAt||room.mobileSettled)return;
  const counts=Object.fromEntries(Object.entries(room.achievements?.contributors??{}).map(([owner,v])=>[owner,v.count]));
  for(const reward of completionDistribution(counts,room.mobilePieces,operationGameSettings)){
   const p=reward.id===current.id?current:readProfile(reward.id,now);
   const result=db.prepare('INSERT OR IGNORE INTO mobile_settlements VALUES(?,?,?,?,?)').run(room.id,p.id,reward.energy,reward.contribution,now);
   if(result.changes){const collected=collection.complete(p.id,room,reward.contribution,now);p.energy+=reward.energy;p.lastReward={...p.lastReward,completion:{roomId:room.id,...reward,...(collected??{})},at:now};}
   if(p.firstRoomId===room.id)p.firstRoomCompleted=true;saveProfile(p);
  }
  for(const row of db.prepare('SELECT id,data FROM mobile_profiles').all()){const p=row.id===current.id?current:JSON.parse(row.data);if(p.firstRoomId===room.id&&!p.firstRoomCompleted){p.firstRoomCompleted=true;saveProfile(p);}}
  room.mobileSettled=true;
 }
 function help(room,p,request,input,now){
  authorize(room,request,now);const protectedRoom=p.firstRoomId===room.id&&!p.firstRoomCompleted;
  const used=kind=>Number(db.prepare('SELECT uses FROM mobile_tool_uses WHERE room_id=? AND owner=? AND kind=?').get(room.id,p.id,kind)?.uses??0);
  const grants=()=>db.prepare('SELECT data FROM mobile_tool_grants WHERE room_id=? AND owner=? AND expires_at>? ORDER BY rowid').all(room.id,p.id,now).map(r=>JSON.parse(r.data));
  const view=()=>({grants:grants(),serverTime:now,freeRemaining:{hint:Math.max(0,2-used('hint')),underlay:Math.max(0,2-used('underlay'))},newcomerProtected:protectedRoom});
  if(request.method==='GET')return view();if(request.method!=='POST')fail(405,'METHOD_NOT_ALLOWED','请求方式无效');
  return replay(p,'help:'+room.id,input,now,()=>{
   if(!['hint','underlay'].includes(input.kind))fail(400,'INVALID_TOOL','工具无效');
   if(grants().some(g=>g.kind===input.kind))fail(409,'TOOL_ACTIVE','该功能正在生效');
   const free=protectedRoom||used(input.kind)<2;
   if(!free&&!input.rewardToken)fail(402,'AD_REQUIRED','免费次数已用完，请主动观看广告',{freeRemaining:view().freeRemaining});
   let pieceIds=[];if(input.kind==='hint'){const held=new Set(Object.keys(room.leases).map(Number));pieceIds=room.puzzle.groups.filter(g=>!g.locked&&!held.has(g.id)).flatMap(g=>g.pieces).slice(0,3);if(!pieceIds.length)fail(409,'NO_HINT_AVAILABLE','暂时没有可提示的拼块');}
   if(!free)consumeChallenge(p,input,'room/'+room.id,request.authorization,now);
   if(!protectedRoom&&free)db.prepare('INSERT INTO mobile_tool_uses VALUES(?,?,?,1) ON CONFLICT(room_id,owner,kind) DO UPDATE SET uses=uses+1').run(room.id,p.id,input.kind);
   const grant={requestId:input.requestId,kind:input.kind,pieceIds,expiresAt:now+30000};db.prepare('INSERT INTO mobile_tool_grants VALUES(?,?,?,?,?,?)').run(room.id,p.id,input.requestId,input.kind,grant.expiresAt,JSON.stringify(grant));return view();
  });
 }
 function route(request,p,input,url,now){
  const path=url.pathname,method=request.method;
  if(path==='/api/mobile/social'||path.startsWith('/api/mobile/social/'))return social.route(request,p,input,url,now);
  if(path==='/api/daily'&&method==='GET'){const photo=dailyContent?.select(now)??engine.dailyPuzzle(now);return {date:engine.dailyPuzzleDate(now),photo:{id:photo.id,title:photo.title,src:photo.src,thumbSrc:photo.thumbSrc},serverTime:now};}
  if(path==='/api/mobile/gallery'&&method==='GET')return {imageIds:galleryPhotos(now).map(photo=>photo.id),packedImageIds:collection.packedImageIds(now),serverTime:now};
  if(path==='/api/mobile/profile'){
   if(method==='PATCH'){
    if(input.name!==undefined){if(typeof input.name!=='string'||!input.name.trim()||Array.from(input.name.trim()).length>16||Array.from(input.name).some(c=>c.charCodeAt(0)<32||c.charCodeAt(0)===127))fail(400,'INVALID_NAME','昵称请填写1～16个字');p.name=input.name.trim();}
    if(input.autoSupply!==undefined){if(typeof input.autoSupply!=='boolean')fail(400,'INVALID_SETTING','自动补给设置无效');p.autoSupply=input.autoSupply;}
   }else if(method!=='GET')fail(405,'METHOD_NOT_ALLOWED','请求方式无效');return profileView(p,now);
  }
  const collectionView=()=>({...collection.view(p.id,now),profile:profileView(p,now)});
  if(path==='/api/mobile/collection'&&method==='GET')return collectionView();
  if(path==='/api/mobile/collection/buy'&&method==='POST')return replay(p,'collection-buy',input,now,()=>{const purchase=collection.buy(p.id,input.packId,now);return {...collectionView(),purchase};});
  if(path==='/api/mobile/collection/craft'&&method==='POST')return replay(p,'collection-craft',input,now,()=>{const crafted=collection.craft(p.id,input.decorationId,now);return {...collectionView(),crafted};});
  if(path==='/api/mobile/collection/equip'&&method==='POST')return replay(p,'collection-equip',input,now,()=>{collection.equip(p.id,input.decorationId);return collectionView();});
  const taskView=()=>({...tasks.view(p,now),profile:profileView(p,now)});
  if(path==='/api/mobile/tasks'&&method==='GET')return taskView();
  if(path==='/api/mobile/gifts/open'&&method==='POST')return replay(p,'gift-open',input,now,()=>{const opened=tasks.open(p,input,now);return {...taskView(),opened};});
  if(path==='/api/mobile/invitations/share'&&method==='POST')return replay(p,'invitation-share',input,now,()=>{const shared=tasks.share(p,input,now);return {...taskView(),shared};});
  if(path==='/api/mobile/invitations/accept'&&method==='POST')return replay(p,'invitation-accept',input,now,()=>{const accepted=tasks.accept(p,input,now);return {...taskView(),accepted};});
  if(path==='/api/mobile/supply/challenge'&&method==='POST')return challenge(p,{kind:input.kind,requestId:input.requestId},now);
  if(path==='/api/mobile/supply/redeem'&&method==='POST')return replay(p,'supply-redeem',input,now,()=>{
   if(!['energy','create'].includes(input.kind))fail(400,'INVALID_SUPPLY','补给种类无效');
   if(p.supply[input.kind]>=3)fail(409,'SUPPLY_FULL','库存已满');consumeChallenge(p,input,'supply','',now);p.supply[input.kind]++;saveProfile(p);return profileView(p,now);
  });
  if(path==='/api/mobile/supply/cancel'&&method==='POST'){
   if(!['energy','create'].includes(input.kind)||!requestKey(input.requestId)||typeof input.rewardToken!=='string')fail(400,'INVALID_SUPPLY','补给请求无效');
   const challenge=db.prepare("SELECT * FROM mobile_ad_challenges WHERE token=? AND owner=? AND context='supply' AND kind=? AND request_id=?").get(input.rewardToken,p.id,input.kind,input.requestId);
   if(!challenge)fail(403,'AD_REQUIRED','广告请求不属于当前身份');
   if(challenge.used===0)db.prepare('UPDATE mobile_ad_challenges SET used=2 WHERE token=? AND used=0').run(challenge.token);
   return profileView(p,now);
  }
  if(path==='/api/mobile/supply/use'&&method==='POST')return replay(p,'supply-use',input,now,()=>{
   if(input.kind!=='energy')fail(400,'INVALID_SUPPLY','建房券会在创建成功时使用');if(p.energy>=energyCap(p.level,operationGameSettings))fail(409,'ENERGY_FULL','体力已满，无需使用');if(p.supply.energy<1)fail(409,'SUPPLY_EMPTY','没有体力包');p.supply.energy--;p.energy=energyCap(p.level,operationGameSettings);p.energyAt=now;saveProfile(p);return profileView(p,now);
  });
  if(path==='/api/rewarded/challenge'&&method==='POST'){
   if(typeof input.context!=='string'||!/^room\/[a-f0-9]{32}$/.test(input.context)||!['hint','underlay'].includes(input.kind))fail(400,'INVALID_TOOL','广告工具请求无效');
   const room=readRoom(input.context.slice(5));authorize(room,request,now);if(p.firstRoomId===room.id&&!p.firstRoomCompleted)fail(409,'FREE_TOOL_AVAILABLE','新手首局可直接使用工具');
   const uses=Number(db.prepare('SELECT uses FROM mobile_tool_uses WHERE room_id=? AND owner=? AND kind=?').get(room.id,p.id,input.kind)?.uses??0);if(uses<2)fail(409,'FREE_TOOL_AVAILABLE','请先使用本局免费次数');
   return challenge(p,{...input,authorization:request.authorization??''},now);
  }
  if(path==='/api/auth/me'&&method==='GET')return {account:null};
  if(path==='/api/auth/logout'&&method==='POST')return {ok:true};
  if(path==='/api/guest'&&method==='POST')return {ready:true};
  if(path==='/api/connection'&&method==='GET')return {mode:'mobile-v3-isolated',inviteOrigin:null};
  if(path==='/api/my-rooms'&&method==='GET')return {rooms:profileView(p,now).ownedRooms,serverTime:now};
  if(path==='/api/lobby'&&method==='GET'){
   const limit=Math.max(1,Math.min(24,Number(url.searchParams.get('limit'))||12)),cursor=url.searchParams.get('cursor');
   let before=null;if(cursor){try{before=JSON.parse(Buffer.from(cursor,'base64url').toString());if(!Array.isArray(before)||!Number.isSafeInteger(before[0])||!/^[a-f0-9]{32}$/.test(before[1]))throw Error();}catch{fail(400,'INVALID_CURSOR','列表游标无效');}}
   let cards=db.prepare("SELECT data FROM mobile_rooms WHERE visibility='public' AND completed_at IS NULL AND closed_at IS NULL ORDER BY created_at DESC,id DESC").all().map(r=>JSON.parse(r.data)).filter(r=>r.expiresAt>now).map(r=>card(r,now));
   const dir=url.searchParams.get('direction'),pieces=Number(url.searchParams.get('pieces')),open=url.searchParams.get('open')==='1',active=url.searchParams.get('active')==='1';
   cards=cards.filter(r=>(!dir||dir==='all'||r.direction===dir)&&(!pieces||r.pieces===pieces)&&(!open||r.players<8&&r.acceptingNew)&&(!active||r.players>0));
   const total=cards.length;if(before)cards=cards.filter(r=>r.createdAt<before[0]||r.createdAt===before[0]&&r.id<before[1]);const page=cards.slice(0,limit),last=page.at(-1),nextCursor=cards.length>limit&&last?Buffer.from(JSON.stringify([last.createdAt,last.id])).toString('base64url'):null;
   return {rooms:page,nextCursor,total,serverTime:now,mode:'mobile-v3-isolated'};
  }
  if(path==='/api/rooms'&&method==='POST')return replay(p,'create-room',input,now,()=>{
   const mode=input.mode??'selected',pieces=mode==='daily'?108:input.pieces,visibility=input.visibility??'public';
   if(!['random','selected','daily'].includes(mode)||!MOBILE_COUNTS.includes(pieces)||!['public','private'].includes(visibility))fail(400,'INVALID_ROOM_OPTIONS','请选择48、108、300或500片及有效房间类型');
   if(mode==='daily'&&visibility!=='public')fail(400,'INVALID_ROOM_OPTIONS','每日拼图为公开房间');
   const direction=input.direction??'all';if(!['all','portrait','landscape','square'].includes(direction))fail(400,'INVALID_DIRECTION','图片方向无效');
   let photo;
   if(mode==='daily')photo=dailyContent?.select(now)??engine.dailyPuzzle(now);
   else if(mode==='random'){
    if(input.imageId)fail(400,'RANDOM_IMAGE_NOT_SELECTABLE','随机模式不能指定图片');
    const pool=galleryPhotos(now).filter(photo=>{return collection.randomAllowed(p.id,photo.id,now)&&mobileGridForPhoto(photo,pieces)&&(direction==='all'||directionOf(photo)===direction);});if(!pool.length)fail(400,'NO_IMAGE_AVAILABLE','该条件下没有可用图片');photo=pool[randomInt(0,pool.length)];
   }else photo=galleryPhotos(now).find(p=>p.id===input.imageId);
   if(!photo)fail(400,'INVALID_IMAGE','请选择可用图片');const grid=mobileGridForPhoto(photo,pieces);if(!grid)fail(400,'UNSUPPORTED_RESOLUTION','图片不支持该片数');
   if(mode==='daily'){
    const existing=db.prepare("SELECT data FROM mobile_rooms WHERE visibility='public' AND completed_at IS NULL AND closed_at IS NULL ORDER BY created_at DESC").all().map(r=>JSON.parse(r.data)).find(r=>r.mobileDay===engine.dailyPuzzleDate(now)&&r.mobileMode==='daily'&&r.expiresAt>now&&r.members.filter(m=>now-m.lastSeen<engine.ONLINE_MS).length<8&&r.acceptingNew!==false);
    if(existing)return join(existing,p,{},now);
   }
   const owned=db.prepare('SELECT COUNT(*) n FROM mobile_rooms WHERE owner=? AND completed_at IS NULL AND closed_at IS NULL').get(p.id).n;if(owned>=3)fail(409,'ROOM_LIMIT','最多同时保留3个未结束的自建房间',{ownedRooms:profileView(p,now).ownedRooms});
   const needsTicket=visibility==='private'||mode==='selected'&&!collection.ownsImage(p.id,photo.id,now),starter=needsTicket&&p.starterSelectionAvailable;
   if(needsTicket&&!starter&&p.supply.create<1)fail(402,'CREATE_TICKET_REQUIRED','需要1张建房券');
   const room={id:id(),ownerId:p.id,visibility,title:photo.title,puzzle:engine.createFittedPuzzle(photo.id,grid.cols,grid.rows),mobilePieces:pieces,mobileMode:mode,mobileDay:mode==='daily'?engine.dailyPuzzleDate(now):null,mobileInviteCode:visibility==='private'?randomBytes(16).toString('hex'):null,revision:0,createdAt:now,expiresAt:now+30*86400000,completedAt:null,retentionVersion:2,lastPlayedAt:now,members:[],leases:{},startedAt:null,participants:{}};
   if(starter)p.starterSelectionAvailable=false;else if(needsTicket)p.supply.create--;saveRoom(room);return join(room,p,{},now);
  });
  const match=/^\/api\/rooms\/([a-f0-9]{32})(?:\/(join|cursors|chat|assistance|management|continuation|invitation))?$/.exec(path);
  if(!match)fail(404,'NOT_FOUND','接口不存在');const room=readRoom(match[1]),part=match[2];
  if(part==='join'&&method==='POST')return join(room,p,input,now);
  if(part==='assistance')return help(room,p,request,input,now);
  if((method==='DELETE'&&!part)||part==='management'){
   if(room.ownerId!==p.id)fail(403,'OWNER_REQUIRED','只有房主可以管理房间');
   if(method==='GET')return {owner:true,acceptingNew:room.acceptingNew!==false,inviteCode:room.mobileInviteCode};
   if(method==='DELETE'||input.action==='close'){
    if(room.members.some(m=>m.guestId!==p.id&&now-m.lastSeen<engine.ONLINE_MS))fail(409,'ROOM_STILL_ACTIVE','其他玩家仍在拼图，暂不能关闭');
    if(room.completedAt===null&&room.puzzle.groups.some(g=>g.locked||g.pieces.length>1))fail(409,'ROOM_HAS_PROGRESS','已有拼合进度，请完成后释放名额');
    room.closedAt=now;saveRoom(room);
    for(const row of db.prepare('SELECT id,data FROM mobile_profiles').all()){const profile=row.id===p.id?p:JSON.parse(row.data);if(profile.firstRoomId===room.id&&!profile.firstRoomCompleted){profile.firstRoomId=null;saveProfile(profile);}}
    return {ok:true};
   }
   if(typeof input.acceptingNew==='boolean'){room.acceptingNew=input.acceptingNew;room.revision++;saveRoom(room);return {ok:true,acceptingNew:room.acceptingNew};}fail(400,'INVALID_MANAGEMENT','管理操作无效');
  }
  const member=authorize(room,request,now);
  if(part==='invitation'&&method==='GET'){if(room.ownerId!==p.id)fail(403,'OWNER_REQUIRED','只有房主可以查看邀请码');return {inviteCode:room.mobileInviteCode,roomId:room.id};}
  if(part==='cursors'){
   if(method==='POST'){const point=engine.cursorInput(input);if(!point)fail(400,'INVALID_CURSOR_POSITION','鼠标位置无效');db.prepare('INSERT INTO mobile_cursors VALUES(?,?,?,?,?,?) ON CONFLICT(room_id,player_id) DO UPDATE SET client_id=excluded.client_id,seq=excluded.seq,data=excluded.data,updated_at=excluded.updated_at WHERE mobile_cursors.client_id!=excluded.client_id OR excluded.seq>mobile_cursors.seq').run(room.id,member.id,point.clientId,point.seq,JSON.stringify(point.point),now);}
   else if(method!=='GET')fail(405,'METHOD_NOT_ALLOWED','请求方式无效');
   return {cursors:db.prepare('SELECT player_id,data,updated_at FROM mobile_cursors WHERE room_id=? AND updated_at>?').all(room.id,now-engine.CURSOR_TTL).flatMap(row=>{const point=JSON.parse(row.data),m=room.members.find(x=>x.id===row.player_id&&now-x.lastSeen<engine.ONLINE_MS);return point&&m?[{...point,playerId:m.id,name:m.name,color:m.color,level:readProfile(m.guestId,now).level,decoration:collection.equipped(m.guestId),updatedAt:row.updated_at}]:[];}),serverTime:now};
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
  const sinceText=url.searchParams.get('since'),since=sinceText!==null&&/^\d+$/.test(sinceText)?Number(sinceText):null;
  if(method==='GET')return snapshotView(room,now,since,p.id);
  if(method!=='POST')fail(405,'METHOD_NOT_ALLOWED','请求方式无效');
  if(input.type==='drop'&&!requestKey(input.requestId))fail(400,'REQUEST_ID_REQUIRED','拼合操作缺少有效请求编号');
  const act=()=>{
   const before=structuredClone(room.puzzle.groups),oldContrib=room.achievements?.contributors?.[p.id]?.count??0;
   room.mobileContributionXp??=Object.fromEntries(Object.entries(room.achievements?.contributors??{}).map(([owner,value])=>[owner,value.count]));
   member.name=p.name;engine.applyAction(room,member,input,now);
   const added=(room.achievements?.contributors?.[p.id]?.count??0)-oldContrib;
   let mobileContribution;
   if(added){
    const reward=applyContribution(p,{protectedRoom:p.firstRoomId===room.id&&!p.firstRoomCompleted,now,randomInt,taskRewards:operationTaskRewards,gameSettings:operationGameSettings});if(!reward)fail(402,'ENERGY_EMPTY','体力不足，请使用补给或稍后再来',{profile:profileView(p,now)});
    room.mobileContributionXp[p.id]=(room.mobileContributionXp[p.id]??0)+reward.xp;
    p.lastReward.giftsAdded=tasks.record(p,room,input.requestId,reward.pendingGift,now,engine.ONLINE_MS);
    const coins=collection.contribution(p.id,room.id,input.requestId,now);p.lastReward.coins=coins;
    mobileContribution={requestId:input.requestId,groupId:input.groupId,creditedXp:reward.xp,creditedCoins:coins};
   }
   room.revision++;engine.recordRoomChange(room,before);settle(room,now,p);saveRoom(room);saveProfile(p);return {...snapshotView(room,now,since,p.id),profile:profileView(p,now),...(mobileContribution?{mobileContribution}:{})};
  };
  // Only drops affect growth: avoid writing permanent receipts for heartbeat/move polling.
  return input.type==='drop'&&requestKey(input.requestId)?replay(p,'room-action:'+room.id,input,now,act):act();
 }
 function handle(request){
  const now=clock();try{
   if(typeof request.identity!=='string'||!/^[a-f0-9]{64}$/.test(request.identity))fail(401,'IDENTITY_REQUIRED','连接身份无效');
   const url=new URL(request.url,'http://mobile.invalid');let input=request.body??{};
   if(Buffer.isBuffer(input)||typeof input==='string'){try{input=JSON.parse(String(input)||'{}');}catch{fail(400,'INVALID_JSON','请求格式无效');}}
   if(!input||typeof input!=='object'||Array.isArray(input))fail(400,'INVALID_JSON','请求格式无效');
   operationTaskRewards=taskRewardConfiguration.read();
   operationGameSettings=gameConfiguration.read();
   operationAlbums=albumConfiguration.read();
   db.exec('BEGIN IMMEDIATE');
   try{const p=readProfile(request.identity,now);saveProfile(p);social.touch(p.id,now);const data=route(request,p,input,url,now);saveProfile(p);db.exec('COMMIT');return {status:request.method==='POST'&&url.pathname==='/api/rooms'?201:200,data};}
   catch(error){db.exec('ROLLBACK');throw error;}
  }catch(error){return {status:error.status??500,data:{error:error.status?error.message:'独立拼图服务暂时不可用',code:error.code??(error.status?'ROOM_ERROR':'INTERNAL_ERROR'),...(error.profile?{profile:error.profile}:{}),...(error.freeRemaining?{freeRemaining:error.freeRemaining}:{}),...(error.ownedRooms?{ownedRooms:error.ownedRooms}:{}),...(error.phrases?{phrases:error.phrases}:{})}};}
 }
 return {handle,startDaily(){dailyContent?.start();},close(){dailyContent?.close();db.close();},mode:'mobile-v3-isolated'};
}
