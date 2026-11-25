// 团子去旅行 postcards pieced on the phone: a local room (like the offline story rooms) that never touches the room
// server, costs no energy and is not seen by anyone else. Finishing one queues a completion report that the app sends
// to /api/mobile/tuanzi/postcards/:id/complete with a request id, retried until the server answers.
import {createFittedPuzzle,placedCount,restorePuzzle,shuffleLoose,type PuzzleState} from './puzzle-engine';
import {applySoloDrop,type SoloStorage} from './solo-play';
import type {RoomSnapshot} from './room-engine';
import type {RoomClientDependencies,RoomTicket} from './room-client';

const INDEX='jigsaw:postcard-room:index',PLAYER='jigsaw:postcard-player:v1',PENDING='jigsaw:postcard-done:v1';
const roomKey=(id:string)=>'jigsaw:postcard-room:v1:'+id;
const hex=(v:unknown):v is string=>typeof v==='string'&&/^[a-f0-9]{32}$/.test(v);
const object=(v:any):v is Record<string,any>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const count=(v:unknown)=>Number.isSafeInteger(v)&&Number(v)>=0;
const read=(s:SoloStorage,k:string):any=>{try{return JSON.parse(s.get(k)??'null');}catch{return null;}};
const write=(s:SoloStorage,k:string,v:unknown)=>{try{s.set(k,JSON.stringify(v));}catch{}};
const drop=(s:SoloStorage,k:string)=>{try{s.remove(k);}catch{}};
const clone=<T>(v:T):T=>JSON.parse(JSON.stringify(v));

/** What a postcard needs to be pieced: the picture and its grid (from the server's postcard view). */
export type PostcardPicture={cardId:string;imageId:string;title:string;src:string;thumbSrc:string;width:number;height:number;cols:number;rows:number;pieces:number};
export type PostcardDone={cardId:string;roomId:string;elapsedMs:number;requestId:string};
type Stored={v:1;id:string;picture:PostcardPicture;puzzle:PuzzleState;revision:number;startedAt:number|null;completedAt:number|null;createdAt:number;updatedAt:number};
const validPicture=(p:any):p is PostcardPicture=>object(p)&&typeof p.cardId==='string'&&p.cardId.length<=64&&typeof p.imageId==='string'&&typeof p.src==='string'&&typeof p.thumbSrc==='string'&&count(p.width)&&count(p.height)&&count(p.cols)&&count(p.rows)&&p.cols*p.rows>0&&count(p.pieces)&&typeof p.title==='string';

export function pendingPostcards(storage:SoloStorage):PostcardDone[]{
 const value=read(storage,PENDING);
 return Array.isArray(value)?value.filter(item=>object(item)&&typeof item.cardId==='string'&&hex(item.roomId)&&hex(item.requestId)&&count(item.elapsedMs)):[];
}
export function settlePostcard(storage:SoloStorage,cardId:string){
 const rest=pendingPostcards(storage).filter(item=>item.cardId!==cardId);if(rest.length)write(storage,PENDING,rest);else drop(storage,PENDING);
}

export function createPostcardRooms({storage,now,randomId,playerName='我'}:{storage:SoloStorage;now:()=>number;randomId:()=>string;playerName?:string}){
 // Never throws at startup: a platform id that is not 32 hex digits falls back to a random one.
 const id=()=>{let value='';try{value=randomId().replace(/-/g,'').toLowerCase();}catch{}return hex(value)?value:Array.from({length:32},()=>Math.floor(Math.random()*16).toString(16)).join('');};
 // The local player identity is created on the first postcard, so starting the app writes nothing.
 let known:{token:string;playerId:string}|null=null;
 const me=()=>{if(known)return known;const saved=read(storage,PLAYER);known=object(saved)&&hex(saved.token)&&hex(saved.playerId)?{token:saved.token,playerId:saved.playerId}:{token:id(),playerId:id()};write(storage,PLAYER,known);return known;};
 const rooms=new Map<string,Stored>();
 const index=read(storage,INDEX);
 if(Array.isArray(index))for(const roomId of index){
  const room=read(storage,roomKey(roomId));
  if(!hex(roomId)||!object(room)||room.v!==1||room.id!==roomId||!validPicture(room.picture))continue;
  const puzzle=restorePuzzle(JSON.stringify(room.puzzle),[room.picture.imageId]);
  if(puzzle)rooms.set(roomId,{...room,puzzle} as Stored);
 }
 function persist(room:Stored){
  rooms.set(room.id,room);
  while(rooms.size>12){const oldest=[...rooms.values()].sort((a,b)=>(a.completedAt===null?1:0)-(b.completedAt===null?1:0)||a.updatedAt-b.updatedAt)[0];rooms.delete(oldest.id);drop(storage,roomKey(oldest.id));}
  write(storage,roomKey(room.id),room);write(storage,INDEX,[...rooms.keys()]);
 }
 const elapsed=(room:Stored,time:number)=>room.startedAt===null?0:Math.max(0,(room.completedAt??time)-room.startedAt);
 function snapshot(room:Stored):RoomSnapshot&{offline:true;postcardId:string;requestedPieces:number}{
  const time=now(),p=room.picture,photo={id:p.imageId,title:p.title,src:p.src,thumbSrc:p.thumbSrc,width:p.width,height:p.height,category:'明信片'};
  return clone({id:room.id,puzzle:{...room.puzzle,elapsed:Math.floor(elapsed(room,time)/1000)},revision:room.revision,serverTime:time,expiresAt:time+30*86400000,members:[{id:me().playerId,name:playerName,color:'#99caf4',lastSeen:time}],leases:{},visibility:'solo',startedAt:room.startedAt,completedAt:room.completedAt,title:p.title,acceptingNew:false,photo,requestedPieces:p.pieces,offline:true,postcardId:p.cardId}) as any;
 }
 function apply(room:Stored,op:any){
  if(!object(op)||!Number.isSafeInteger(op.groupId)||!Number.isFinite(op.dx)||!Number.isFinite(op.dy))return false;
  const result=applySoloDrop(room.puzzle,{groupId:op.groupId,dx:op.dx,dy:op.dy});if(!result.applied)return false;
  const time=now();room.puzzle=result.puzzle;room.startedAt??=time;room.updatedAt=time;room.revision++;
  if(result.completed&&room.completedAt===null){
   room.completedAt=time;
   const pending=pendingPostcards(storage).filter(item=>item.cardId!==room.picture.cardId);
   write(storage,PENDING,[...pending,{cardId:room.picture.cardId,roomId:room.id,elapsedMs:elapsed(room,time),requestId:id()}]);
  }
  persist(room);return true;
 }
 /** Opens (or resumes) the local room for a postcard. */
 function open(picture:PostcardPicture):RoomTicket{
  if(!validPicture(picture))throw new Error('这张明信片暂时不能拼');
  const existing=[...rooms.values()].find(room=>room.picture.cardId===picture.cardId&&room.picture.imageId===picture.imageId&&room.completedAt===null);
  if(existing)return {...me(),room:snapshot(existing)};
  const time=now(),room:Stored={v:1,id:id(),picture,puzzle:createFittedPuzzle(picture.imageId,picture.cols,picture.rows,time>>>0),revision:0,startedAt:null,completedAt:null,createdAt:time,updatedAt:time};
  persist(room);return {...me(),room:snapshot(room)};
 }
 const fetch:RoomClientDependencies['fetch']=async(url,init)=>{
  const path=url.split(/[?#]/,1)[0],match=path.match(/\/api\/rooms\/([a-f0-9]{32})$/),room=match?rooms.get(match[1]):undefined;
  if(!room)throw new TypeError('postcard');
  const method=(init?.method??'GET').toUpperCase();let extra={};
  if(method==='POST'){
   let action:any;try{action=JSON.parse(String(init?.body));}catch{throw new TypeError('postcard');}
   if(!object(action))throw new TypeError('postcard');
   if(action.type==='batch'){
    const applied:string[]=[],skipped:{requestId:string;code:'CONFLICT'}[]=[];
    if(!Array.isArray(action.ops))throw new TypeError('postcard');
    for(const op of action.ops){if(hex(op?.requestId)&&apply(room,op))applied.push(op.requestId);else skipped.push({requestId:op?.requestId,code:'CONFLICT'});}
    extra={soloBatch:{applied,skipped,stopped:null},mobileContributions:[]};
   }else if(action.type==='drop')apply(room,action);
   else if(action.type==='shuffle'){const time=now();if(shuffleLoose(room.puzzle,time>>>0)){room.revision++;room.updatedAt=time;persist(room);}}
   else if(!['heartbeat','leave','claim','move','release'].includes(action.type))throw new TypeError('postcard');
  }else if(method!=='GET')throw new TypeError('postcard');
  const data={...snapshot(room),...extra};
  return {ok:true,status:200,headers:{get:()=>null},json:async()=>clone(data)};
 };
 return {open,fetch,isRoom:(roomId?:string)=>!!roomId&&rooms.has(roomId),cardOf:(roomId?:string)=>roomId?rooms.get(roomId)?.picture.cardId??null:null,
  progress:(cardId:string)=>{const room=[...rooms.values()].find(r=>r.picture.cardId===cardId&&r.completedAt===null);return room?{placed:placedCount(room.puzzle),total:room.puzzle.cols*room.puzzle.rows}:null;}};
}
