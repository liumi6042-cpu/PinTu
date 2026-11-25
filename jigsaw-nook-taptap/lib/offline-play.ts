import {createFittedPuzzle,placedCount,restorePuzzle,shuffleLoose,type PuzzleState} from './puzzle-engine';
import {applySoloDrop,type SoloStorage} from './solo-play';
import type {RoomSnapshot} from './room-engine';
import type {RoomClientDependencies,RoomTicket} from './room-client';
import type {OfflineCatalog} from './offline-catalog-types';
import type {MobileLevel,MobileLevelsView,MobileProfile} from '../h5/mobile-api';

const ROOM_INDEX='jigsaw:offline-room:index',PLAYER_KEY='jigsaw:offline-player:v1';
const CLEARS_KEY='jigsaw:offline-clears:v1',LEVELS_KEY='jigsaw:levels-cache:v1';
const roomKey=(id:string)=>'jigsaw:offline-room:v1:'+id;
const hex=(v:unknown):v is string=>typeof v==='string'&&/^[a-f0-9]{32}$/.test(v);
const object=(v:any):v is Record<string,any>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const integer=(v:unknown)=>Number.isSafeInteger(v)&&Number(v)>=0;
const get=(s:SoloStorage,k:string)=>{try{return s.get(k);}catch{return null;}};
const set=(s:SoloStorage,k:string,v:unknown)=>{try{s.set(k,JSON.stringify(v));}catch{}};
const remove=(s:SoloStorage,k:string)=>{try{s.remove(k);}catch{}};
const read=(s:SoloStorage,k:string):any=>{try{return JSON.parse(get(s,k)??'null');}catch{return null;}};
const clone=<T>(v:T):T=>JSON.parse(JSON.stringify(v));
const freshId=()=>Array.from(crypto.getRandomValues(new Uint8Array(16)),n=>n.toString(16).padStart(2,'0')).join('');

export type OfflineClear={levelId:string;roomId:string;completedAt:number;elapsedMs:number;pieces:number;clearId:string};
function validClear(v:any):v is OfflineClear{
 return object(v)&&typeof v.levelId==='string'&&v.levelId.length>0&&v.levelId.length<=100&&hex(v.roomId)&&hex(v.clearId)&&integer(v.completedAt)&&integer(v.elapsedMs)&&integer(v.pieces)&&v.pieces>0;
}
export function pendingOfflineClears(storage:SoloStorage):OfflineClear[]{
 const entries=read(storage,CLEARS_KEY),seen=new Set<string>();
 return Array.isArray(entries)?entries.filter(entry=>{if(!validClear(entry)||seen.has(entry.levelId))return false;seen.add(entry.levelId);return true;}):[];
}
export function recordOfflineClear(storage:SoloStorage,clear:OfflineClear){
 if(!validClear(clear))return;
 const pending=pendingOfflineClears(storage);
 if(!pending.some(entry=>entry.levelId===clear.levelId))set(storage,CLEARS_KEY,[...pending,clear]);
}
export function removeOfflineClears(storage:SoloStorage,clearIds:readonly string[]){
 const ids=new Set(clearIds),pending=pendingOfflineClears(storage).filter(entry=>!ids.has(entry.clearId));
 if(pending.length)set(storage,CLEARS_KEY,pending);else remove(storage,CLEARS_KEY);
}

function validLevels(v:any):v is MobileLevelsView{
 if(!object(v)||!integer(v.firstClearEnergy)||!(v.seriesTitle===undefined||v.seriesTitle===null||typeof v.seriesTitle==='string')||!Array.isArray(v.chapters)||!v.chapters.length)return false;
 const seen=new Set<string>();
 for(const chapter of v.chapters){
  if(!object(chapter)||!['id','title','albumId'].every(key=>typeof chapter[key]==='string')||!['available','unavailable'].includes(chapter.status)||!['coverImageId','coverSrc'].every(key=>chapter[key]===null||typeof chapter[key]==='string')||!Array.isArray(chapter.levels)||!chapter.levels.length)return false;
  for(const level of chapter.levels){
   if(!object(level)||typeof level.id!=='string'||!level.id||seen.has(level.id)||!(level.imageId===null||typeof level.imageId==='string')||!(level.title===null||typeof level.title==='string')||!integer(level.pieces)||level.pieces<=0||!['locked','unlocked','cleared','unavailable'].includes(level.status)||!(level.line===undefined||level.line===null||typeof level.line==='string'))return false;
   seen.add(level.id);
  }
 }
 return v.current===null||object(v.current)&&v.current.status==='unlocked'&&v.chapters.some((chapter:any)=>chapter.levels.some((level:any)=>level.id===v.current.id&&JSON.stringify(level)===JSON.stringify(v.current)));
}
export function cacheServerLevels(storage:SoloStorage,view:MobileLevelsView){if(validLevels(view))set(storage,LEVELS_KEY,view);}
export function readCachedServerLevels(storage:SoloStorage):MobileLevelsView|null{
 try{const view=read(storage,LEVELS_KEY);return validLevels(view)?view:null;}catch{return null;}
}
export function offlineLevelsView(catalog:OfflineCatalog,cachedServerView:MobileLevelsView|null,storage:SoloStorage):MobileLevelsView{
 const cleared=new Set(pendingOfflineClears(storage).map(entry=>entry.levelId));
 if(cachedServerView&&validLevels(cachedServerView))for(const chapter of cachedServerView.chapters)for(const level of chapter.levels)if(level.status==='cleared')cleared.add(level.id);
 let previous:{id:string;available:boolean}|null=null,current:MobileLevel|null=null;
 const chapters=catalog.chapters.map(chapter=>{
  // Match mobile-levels.view(): availability is chapter-wide, and previous spans chapters.
  const available=chapter.levels.every(level=>Object.hasOwn(catalog.photos,level.imageId));
  const cover=catalog.photos[chapter.levels[0]?.imageId];
  const levels=chapter.levels.map(source=>{
   const {cols,rows,...fields}=source;
   const status:MobileLevel['status']=!available?'unavailable':cleared.has(source.id)?'cleared':previous===null||previous.available&&cleared.has(previous.id)?'unlocked':'locked';
   const level:MobileLevel={...fields,status};previous={id:source.id,available};
   if(status==='unlocked'&&current===null)current=level;return level;
  });
  return {id:chapter.id,title:chapter.title,albumId:chapter.albumId,coverImageId:cover?.id??null,coverSrc:cover?.thumbSrc??null,status:available?'available' as const:'unavailable' as const,levels};
 });
 return {chapters,current,firstClearEnergy:catalog.firstClearEnergy,seriesTitle:catalog.seriesTitle};
}

type StoredRoom={v:1;id:string;kind:'level'|'free';levelId?:string;imageId:string;pieces:number;puzzle:PuzzleState;revision:number;startedAt:number|null;completedAt:number|null;createdAt:number;updatedAt:number};
export type OfflineRoomSnapshot=RoomSnapshot&{offline:true;requestedPieces:number;levelId?:string};
type RoomInput={kind:'level';levelId:string}|{kind:'free';imageId:string;pieces:number};
export function preferOfflineLevelRoom(onlinePlaced:number,offlineRooms:readonly {kind:string;levelId?:string;completed:boolean;placed:number}[],levelId:string){
 return offlineRooms.some(room=>room.kind==='level'&&room.levelId===levelId&&!room.completed&&room.placed>onlinePlaced);
}
export function createOfflineRoomServer({catalog,storage,now,randomId,playerName='我'}:{catalog:OfflineCatalog;storage:SoloStorage;now:()=>number;randomId:()=>string;playerName?:string}){
 const id=()=>{const value=randomId().toLowerCase();if(!hex(value))throw new Error('Invalid offline id');return value;};
 const savedPlayer=read(storage,PLAYER_KEY);
 const player=object(savedPlayer)&&hex(savedPlayer.token)&&hex(savedPlayer.playerId)?{token:savedPlayer.token,playerId:savedPlayer.playerId}:{token:id(),playerId:id()};
 set(storage,PLAYER_KEY,player);
 const rooms=new Map<string,StoredRoom>(),index=read(storage,ROOM_INDEX);
 if(Array.isArray(index))for(const roomId of index){
  if(!hex(roomId)||rooms.has(roomId))continue;
  const room=read(storage,roomKey(roomId));
  if(!object(room)||room.v!==1||room.id!==roomId||!['level','free'].includes(room.kind)||room.kind==='level'&&typeof room.levelId!=='string'||!Object.hasOwn(catalog.photos,room.imageId)||!integer(room.pieces)||room.pieces<=0||!integer(room.revision)||!integer(room.createdAt)||!integer(room.updatedAt)||!(room.startedAt===null||integer(room.startedAt))||!(room.completedAt===null||integer(room.completedAt)))continue;
  const puzzle=restorePuzzle(JSON.stringify(room.puzzle),[room.imageId]);
  if(puzzle&&puzzle.imageId===room.imageId)rooms.set(roomId,{...room,puzzle} as StoredRoom);
 }
 function persist(room:StoredRoom){
  rooms.set(room.id,room);
  while(rooms.size>24){
   const all=[...rooms.values()],completed=all.filter(entry=>entry.completedAt!==null);
   const oldest=(completed.length?completed:all).sort((a,b)=>a.createdAt-b.createdAt)[0];
   rooms.delete(oldest.id);remove(storage,roomKey(oldest.id));
  }
  set(storage,roomKey(room.id),room);set(storage,ROOM_INDEX,[...rooms.keys()]);
 }
 const elapsed=(room:StoredRoom,time:number)=>room.startedAt===null?0:Math.max(0,(room.completedAt??time)-room.startedAt);
 function snapshot(room:StoredRoom):OfflineRoomSnapshot{
  const time=now(),photo=catalog.photos[room.imageId],level=catalog.chapters.flatMap(chapter=>chapter.levels).find(entry=>entry.id===room.levelId);
  return clone({id:room.id,puzzle:{...room.puzzle,elapsed:Math.floor(elapsed(room,time)/1000)},revision:room.revision,serverTime:time,expiresAt:time+30*24*60*60*1000,members:[{id:player.playerId,name:playerName,color:'#99caf4',lastSeen:time}],leases:{},visibility:'solo',startedAt:room.startedAt,completedAt:room.completedAt,title:level?.title??photo.title,acceptingNew:false,photo,artwork:photo.artwork,requestedPieces:room.pieces,offline:true,...(room.kind==='level'?{levelId:room.levelId}:{})});
 }
 function drop(room:StoredRoom,op:any){
  if(!object(op)||!Number.isSafeInteger(op.groupId)||!Number.isFinite(op.dx)||!Number.isFinite(op.dy))return false;
  const result=applySoloDrop(room.puzzle,{groupId:op.groupId,dx:op.dx,dy:op.dy});
  if(!result.applied)return false;
  const time=now();room.puzzle=result.puzzle;room.startedAt??=time;room.updatedAt=time;room.revision++;
  if(result.completed&&room.completedAt===null){
   room.completedAt=time;
   if(room.kind==='level')recordOfflineClear(storage,{levelId:room.levelId!,roomId:room.id,completedAt:time,elapsedMs:elapsed(room,time),pieces:room.pieces,clearId:id()});
  }
  persist(room);return true;
 }
 function createRoom(input:RoomInput):RoomTicket&{room:OfflineRoomSnapshot}{
  const level=input.kind==='level'?catalog.chapters.flatMap(chapter=>chapter.levels).find(entry=>entry.id===input.levelId):undefined;
  if(input.kind==='level'&&!level)throw new Error('关卡暂不可用');
  const picture=input.kind==='free'?catalog.free.find(entry=>entry.imageId===input.imageId):undefined;
  const imageId=level?.imageId??(input.kind==='free'?input.imageId:''),pieces=level?.pieces??(input.kind==='free'?input.pieces:0);
  const grid=level??picture?.grids[String(pieces) as '48'|'108'];
  if(!Object.hasOwn(catalog.photos,imageId)||!grid||input.kind==='free'&&![48,108].includes(pieces))throw new Error(input.kind==='level'?'关卡暂不可用':'图片暂不可用');
  const existing=[...rooms.values()].find(room=>room.completedAt===null&&room.kind===input.kind&&(input.kind==='level'?room.levelId===input.levelId:room.imageId===imageId&&room.pieces===pieces));
  if(existing)return {...player,room:snapshot(existing)};
  const time=now(),room:StoredRoom={v:1,id:id(),kind:input.kind,...(input.kind==='level'?{levelId:input.levelId}:{}),imageId,pieces,puzzle:createFittedPuzzle(imageId,grid.cols,grid.rows,time>>>0),revision:0,startedAt:null,completedAt:null,createdAt:time,updatedAt:time};
  persist(room);return {...player,room:snapshot(room)};
 }
 const fetch:RoomClientDependencies['fetch']=async(url,init)=>{
  // apiBase can include a path prefix. Only an exact room endpoint suffix is accepted.
  const path=url.split(/[?#]/,1)[0],match=path.match(/\/api\/rooms\/([a-f0-9]{32})$/),room=match?rooms.get(match[1]):undefined;
  if(!room)throw new TypeError('offline');
  const method=(init?.method??'GET').toUpperCase();let extra={};
  if(method==='POST'){
   let action:any;try{action=JSON.parse(String(init?.body));}catch{throw new TypeError('offline');}
   if(!object(action))throw new TypeError('offline');
   if(action.type==='batch'){
    const applied:string[]=[],skipped:{requestId:string;code:'CONFLICT'}[]=[];
    if(!Array.isArray(action.ops))throw new TypeError('offline');
    for(const op of action.ops){if(hex(op?.requestId)&&drop(room,op))applied.push(op.requestId);else skipped.push({requestId:op?.requestId,code:'CONFLICT'});}
    extra={soloBatch:{applied,skipped,stopped:null},mobileContributions:[]};
   }else if(action.type==='drop')drop(room,action);
   else if(action.type==='shuffle'){
    const time=now();if(shuffleLoose(room.puzzle,time>>>0)){room.revision++;room.updatedAt=time;persist(room);}
   }else if(!['heartbeat','leave','claim','move','release'].includes(action.type))throw new TypeError('offline');
  }else if(method!=='GET')throw new TypeError('offline');
  const data={...snapshot(room),...extra};
  return {ok:true,status:200,headers:{get:()=>null},json:async()=>clone(data)};
 };
 return {createRoom,fetch,isOfflineRoom:(roomId:string)=>rooms.has(roomId),rooms:()=>[...rooms.values()].map(room=>({id:room.id,kind:room.kind,...(room.levelId?{levelId:room.levelId}:{}),imageId:room.imageId,pieces:room.pieces,placed:placedCount(room.puzzle),total:room.puzzle.cols*room.puzzle.rows,completed:room.completedAt!==null,updatedAt:room.updatedAt}))};
}

type SyncReply={results:{clearId:string;levelId:string;status:'accepted'|'duplicate'|'rejected'|'deferred';energy:number}[];levels:MobileLevelsView;profile:MobileProfile};
export async function syncOfflineClears({storage,request,catalog,randomId=freshId}:{storage:SoloStorage;request:(path:string,body:unknown)=>Promise<{status:number;data:SyncReply}>;catalog?:OfflineCatalog;randomId?:()=>string}){
 const pending=pendingOfflineClears(storage);if(!pending.length)return null;
 // Passing the packaged catalog also orders clears before the first successful online fetch.
 const chapters:readonly {levels:readonly {id:string}[]}[]|undefined=catalog?.chapters??readCachedServerLevels(storage)?.chapters;
 const order=new Map(chapters?.flatMap(chapter=>chapter.levels).map((level,index)=>[level.id,index]));
 const clears=pending.sort((a,b)=>(order.get(a.levelId)??Infinity)-(order.get(b.levelId)??Infinity)).slice(0,20);
 try{
  const requestId=randomId();if(!hex(requestId))return null;
  const {status,data}=await request('/api/levels/offline-clears',{requestId,clears:clears.map(({roomId,...clear})=>clear)});
  if(status<200||status>=300||!Array.isArray(data?.results))return null;
  const sent=new Map(clears.map(clear=>[clear.clearId,clear])),seen=new Set<string>();
  const results=data.results.filter(result=>{if(!object(result)||!sent.has(result.clearId)||seen.has(result.clearId)||sent.get(result.clearId)!.levelId!==result.levelId)return false;seen.add(result.clearId);return true;});
  const accepted=results.filter(result=>result.status==='accepted');
  removeOfflineClears(storage,results.filter(result=>['accepted','duplicate','rejected'].includes(result.status)).map(result=>result.clearId));
  return {accepted:accepted.length,energy:accepted.reduce((sum,result)=>sum+(integer(result.energy)?result.energy:0),0),levels:data.levels,profile:data.profile};
 }catch{return null;}
}
export function isNetworkFailure(error:unknown){
 const status=(error as {status?:unknown}|null)?.status;
 if(typeof status==='number'&&status>=400)return false;
 return status===undefined||status===null||status===0||error instanceof TypeError||['TimeoutError','AbortError'].includes((error as {name?:string}|null)?.name??'');
}
