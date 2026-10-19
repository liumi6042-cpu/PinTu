import {currentAccount} from './account-store';
import {localDb} from './local-db';
import {settings} from './site-settings';
import {addMember,authenticate,applyAction,snapshot,RoomError,type Room,type RoomAction} from './room-engine';
import {newId,digestToken,json,getDigest} from './room-store';
import {worldFor,type PuzzleState} from './puzzle-engine';
import {recordRoomChange,roomUpdate} from './room-sync';
import {RoomWriteQueue} from './room-write-queue';
import {securityLimit} from './account-security';
import {applySharedAction,disconnectSharedActions,clearSharedActionLease,requireSharedActionChannel,sharedActionStreamWrite,checkSharedActionFrontier,sharedActionFrontierCommand,type SharedActionResult} from './shared-actions';

const writes=new RoomWriteQueue();
type DiagnosticRoom=Room&{diagnostic:true};
type Row={id:string;owner:string;request_id:string;token:string;player_id:string;revision:number;data:string;expires_at:number;closed:number};
export function webDiagnosticsAllowed(account:{id:string}|null){return !!account&&String(settings().PUZZLE_DIAGNOSTIC_ACCOUNT_IDS??'').split(',').map(s=>s.trim()).filter(s=>/^[a-f0-9]{32}$/.test(s)).includes(account.id);}
async function owner(request:Request){const account=await currentAccount(request);if(!webDiagnosticsAllowed(account))throw new RoomError('该测试入口仅对指定账号开放',403);return account!;}
function view(room:DiagnosticRoom,since:number|null=null){return {...roomUpdate(room,Date.now(),since),diagnostic:true};}
function ticket(row:Row,photo?:Record<string,any>){return {token:row.token,playerId:row.player_id,room:{...view(JSON.parse(row.data)),...(photo?{photo}:{})}};}
export async function createWebDiagnostic(request:Request,input:Record<string,any>,photo:Record<string,any>){
 const account=await owner(request);if(typeof input.requestId!=='string'||!/^[a-f0-9]{32}$/.test(input.requestId))throw new RoomError('请求编号无效');
 return writes.run('owner:'+account.id,async()=>{
  const db=localDb(),prior=await db.prepare('SELECT * FROM puzzle_diagnostic_rooms WHERE owner=? AND request_id=?').bind(account.id,input.requestId).first<Row>();
  if(prior){if(prior.closed||prior.expires_at<=Date.now())throw new RoomError('该测试已重置，请重新创建',409);return json(ticket(prior,photo));}
  await securityLimit('web-diagnostic-create',account.id,60);
  const now=Date.now(),id=newId(),token=newId(),puzzle:PuzzleState={version:1,layout:'square',imageId:photo.id,cols:3,rows:3,seed:now>>>0,elapsed:0,groups:Array.from({length:9},(_,n)=>({id:n,pieces:[n],dx:80+(n%3)*60,dy:80+Math.floor(n/3)*60,locked:false}))};
  const room:DiagnosticRoom={id,diagnostic:true,title:'九格拼合测试',ownerId:account.id,visibility:'private',acceptingNew:false,puzzle,revision:0,createdAt:now,expiresAt:now+86400000,completedAt:null,members:[],leases:{},startedAt:null,participants:{}};
  const member=addMember(room,newId(),account.name,await digestToken(token),now,account.id);
  room.expiresAt=now+86400000;
  await db.batch([db.prepare('UPDATE puzzle_diagnostic_rooms SET closed=1 WHERE owner=? AND closed=0').bind(account.id),db.prepare('INSERT INTO puzzle_diagnostic_rooms(id,owner,request_id,token,player_id,revision,data,expires_at) VALUES (?,?,?,?,?,0,?,?)').bind(id,account.id,input.requestId,token,member.id,JSON.stringify(room),room.expiresAt)]);
  return json({token,playerId:member.id,room:{...snapshot(room,now),diagnostic:true,photo}},201);
 });
}
/** Same Cookie identity, HTTP transport, original engine and SQLite CAS as Web.
 * Saves are isolated so test placements cannot count as player achievements. */
export async function webDiagnosticRoom(request:Request,path:string,input:Record<string,any>){
 const match=/^\/api\/rooms\/([a-f0-9]{32})(?:\/(join|cursors|chat|assistance))?$/.exec(path);if(!match)return null;
 const started=performance.now(),id=match[1],part=match[2],db=localDb();
 let row=await db.prepare('SELECT * FROM puzzle_diagnostic_rooms WHERE id=?').bind(id).first<Row>();if(!row)return null;
 const account=await owner(request);if(row.owner!==account.id)throw new RoomError('该测试房间仅限创建账号使用',403);
 if(row.closed||row.expires_at<=Date.now())throw new RoomError('测试房间已重置，请重新创建',410);
 if(part==='join')return request.method==='POST'?json(ticket(row)):json({error:'请求方式无效'},405);
 const digest=await getDigest(request);let room=JSON.parse(row.data) as DiagnosticRoom;
 authenticate(room,digest,Date.now());
 if(part==='cursors'){
  const response=json({cursors:[],serverTime:Date.now()});response.headers.set('x-jigsaw-cursor-player',row.player_id);response.headers.set('x-jigsaw-cursor-world',JSON.stringify(worldFor(room.puzzle)));response.headers.set('x-jigsaw-cursor-sequences','[]');response.headers.set('x-jigsaw-realtime-actions','diagnostic');return response;
 }
 if(part)return json({error:'测试房间不使用此功能'},404);
 if(request.method==='POST'){
  if(!['heartbeat','leave','claim','move','drop','release','realtime-action','realtime-disconnect'].includes(input.type))throw new RoomError('测试操作无效');
  let actionResult:SharedActionResult|undefined;
  const realtime=input.type==='realtime-action'||input.type==='realtime-disconnect';if(realtime)requireSharedActionChannel(request,input);
  room=await writes.run(id,async()=>{
   for(let attempt=0;attempt<8;attempt++){
    row=await db.prepare('SELECT * FROM puzzle_diagnostic_rooms WHERE id=?').bind(id).first<Row>();
    if(!row||row.closed||row.expires_at<=Date.now())throw new RoomError('测试房间已重置',410);
    const current=JSON.parse(row.data) as DiagnosticRoom,previous=structuredClone(current.puzzle.groups),member=authenticate(current,digest,Date.now());
    const stream=realtime?sharedActionStreamWrite(member.id,input):undefined;await checkSharedActionFrontier(db,current,stream);
    if(input.type==='realtime-action')actionResult=applySharedAction(current,member,input.envelope,input.connectionId,Date.now());
    else if(input.type==='realtime-disconnect')disconnectSharedActions(current,member,input.connectionId,Date.now());
    else{applyAction(current,member,input as RoomAction,Date.now());clearSharedActionLease(current,member,input as RoomAction);}
    current.revision++;recordRoomChange(current,previous);current.expiresAt=row.expires_at;
    const serialized=JSON.stringify(current),commands=[db.prepare('UPDATE puzzle_diagnostic_rooms SET revision=?,data=? WHERE id=? AND revision=? AND closed=0').bind(current.revision,serialized,id,row.revision)];
    if(stream)commands.push(sharedActionFrontierCommand(db,current,serialized,stream,true));
    const [result]=await db.batch(commands);
    if(result.meta.changes===1)return current;
   }
   throw new RoomError('测试房间正在同步，请重试',409);
  });
  if(actionResult&&actionResult.status>=400)return json(actionResult.error,actionResult.status);
 }else if(request.method!=='GET')return json({error:'请求方式无效'},405);
 const raw=new URL(request.url).searchParams.get('since'),since=raw!==null&&/^\d+$/.test(raw)?Number(raw):null;
 return json({...view(room,since),diagnosticTiming:{serverMs:performance.now()-started}});
}
