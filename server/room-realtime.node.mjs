import {createRoomRealtimeHub} from './room-realtime.mjs';
import {randomUUID} from 'node:crypto';

const fault=(status,code,message)=>Object.assign(new Error(message),{status,code});
const roomPattern=/^[a-f0-9]{32}$/;
const credentialKey=cookie=>['puzzle_session','puzzle_guest'].map(name=>new RegExp('(?:^|;\\s*)'+name+'=([a-f0-9]{64})(?:;|$)').exec(cookie??'')?.[1]??'').join(':');
const normalize=(input,world)=>{
 if(!input||typeof input!=='object'||!/^[a-f0-9]{32}$/.test(input.clientId)||!Number.isSafeInteger(input.seq)||input.seq<0||input.seq>1e9)return null;
 if(input.point===null)return {clientId:input.clientId,seq:input.seq,point:null};
 const p=input.point,x=world.x??0,y=world.y??0;
 if(!p||!Number.isFinite(p.x)||!Number.isFinite(p.y)||p.x<x||p.y<y||p.x>x+world.width||p.y>y+world.height)return null;
 return {clientId:input.clientId,seq:input.seq,point:{x:p.x,y:p.y}};
};

/** Reuse the existing HTTP routes as the only game/identity authority. */
export function attachWebRoomRealtime({server,port,origin,fetchImpl=fetch,persistIntervalMs=250,authorizeIntervalMs=5000,...transportOptions}){
 const publicOrigin=new URL(origin).origin,loopback='http://127.0.0.1:'+port;
 const contexts=new Set(),rooms=new Map();let stopped=false,hub;
 const permits=new Map(),gateKey=Symbol.for('jigsaw.shared.action.authorize');
 const authorizeAction=(req,input)=>{
  const nonce=req.headers.get('x-jigsaw-action-permit'),permit=permits.get(nonce);if(!permit)return false;permits.delete(nonce);
  return permit.expires>Date.now()&&req.method==='POST'&&new URL(req.url).pathname.replace(/^\/api\/shared(?=\/api\/)/,'')===permit.path&&req.headers.get('cookie')===permit.cookie&&req.headers.get('authorization')===permit.authorization&&JSON.stringify(input)===permit.body;
 };
 globalThis[gateKey]=authorizeAction;
 const counters={authorizations:0,httpReads:0,cursorFlushes:0,coalescedCursorInputs:0};
 const stateFor=id=>{
  let room=rooms.get(id);if(!room){if(rooms.size>=512)throw fault(503,'REALTIME_CAPACITY','实时房间暂满，请稍后重试');room={generation:0,cursors:0,points:new Map(),contexts:new Set(),pending:0,cleanup:null};rooms.set(id,room);}return room;
 };
 const request=async(ctx,path,{method='GET',data}={})=>{
  const target=new URL(publicOrigin),body=data?JSON.stringify(data):undefined,realtime=data&&['realtime-action','realtime-disconnect'].includes(data.type),nonce=realtime?randomUUID().replaceAll('-',''):undefined;
  if(nonce){for(const [key,value]of permits)if(value.expires<=Date.now())permits.delete(key);permits.set(nonce,{expires:Date.now()+10000,path:path.split('?')[0],cookie:ctx.cookie,authorization:'Bearer '+ctx.token,body});}
  let response;try{response=await fetchImpl(loopback+'/api/shared'+path,{method,headers:{Host:target.host,'X-Forwarded-Host':target.host,'X-Forwarded-Proto':target.protocol.slice(0,-1),Origin:publicOrigin,Cookie:ctx.cookie,Authorization:'Bearer '+ctx.token,'X-Jigsaw-Artwork-Snapshot':'1',...(nonce?{'X-Jigsaw-Action-Permit':nonce}:{}),...(data?{'Content-Type':'application/json'}:{})},...(data?{body}:{}),redirect:'manual',signal:AbortSignal.timeout(5000)});}finally{if(nonce)permits.delete(nonce);}
  const text=await response.text();if(text.length>2*1024*1024)throw fault(503,'REALTIME_RESPONSE_SIZE','实时房间数据过大');let value;try{value=JSON.parse(text);}catch{throw fault(response.status>=400?response.status:503,'REALTIME_HTTP_RESPONSE','房间连接暂不可用');}
  if(!response.ok)throw fault(response.status,value.code??'ROOM_ACCESS_REJECTED',typeof value.error==='string'?value.error:'请重新加入房间');
  return {value,headers:response.headers};
 };
 const readCursorAuthority=async ctx=>{
  if(stopped||ctx.revoked)throw fault(401,'IDENTITY_REQUIRED','账号已变更，请重新进入房间');
  counters.authorizations++;counters.httpReads++;
  const generation=ctx.state.generation,cursorVersion=ctx.state.cursors;
  const response=await request(ctx,'/api/rooms/'+ctx.roomId+'/cursors');
  const playerId=response.headers.get('x-jigsaw-cursor-player');let world;try{world=JSON.parse(response.headers.get('x-jigsaw-cursor-world'));}catch{}
  if(!roomPattern.test(playerId??'')||!world||!Number.isFinite(world.width)||!Number.isFinite(world.height)||world.width<=0||world.height<=0)throw fault(503,'REALTIME_METADATA_UNAVAILABLE','实时连接暂不可用，请使用原连接');
  if(ctx.playerId&&ctx.playerId!==playerId)throw fault(401,'IDENTITY_REQUIRED','玩家身份已变更，请重新进入房间');
  let sequences;try{sequences=JSON.parse(response.headers.get('x-jigsaw-cursor-sequences'));}catch{}
  // A legacy HTTP tab may update another player's point while that player's WS
  // is closed. Every authenticated receiver can reconcile these saved sequences.
  ctx.sequences=new Map((Array.isArray(sequences)?sequences:[]).map(sequence=>[sequence.playerId,sequence]));
  for(const sequence of ctx.sequences.values()){const live=ctx.state.points.get(sequence.playerId),stored=response.value.cursors?.find(cursor=>cursor.playerId===sequence.playerId);
   if(live&&(sequence.clientId===live.clientId&&sequence.seq>live.seq||sequence.clientId!==live.clientId&&!live.pending&&!live.running)){live.clientId=sequence.clientId;live.seq=sequence.seq;live.point=stored?{x:stored.x,y:stored.y}:null;live.pending=null;}
  }
  const actionMode=response.headers.get('x-jigsaw-realtime-actions');ctx.actions=actionMode==='normal'?{version:1,diagnosticOnly:false}:actionMode==='diagnostic'?{version:1,diagnosticOnly:true}:undefined;
  ctx.playerId=playerId;ctx.world=world;ctx.cursorSnapshot=response.value;ctx.generation=generation;ctx.cursorVersion=cursorVersion;ctx.authorizedAt=Date.now();
 };
 const ensure=async(ctx,force=false)=>{
  if(ctx.revoked||stopped)throw fault(401,'IDENTITY_REQUIRED','账号已变更，请重新进入房间');
  if(force||ctx.generation!==ctx.state.generation||ctx.cursorVersion!==ctx.state.cursors||Date.now()-ctx.authorizedAt>=authorizeIntervalMs)await readCursorAuthority(ctx);
 };
 const snapshotCursors=async ctx=>{
  await ensure(ctx);if(ctx.cursorVersion!==ctx.state.cursors)await readCursorAuthority(ctx);
  const now=Date.now(),base=Array.isArray(ctx.cursorSnapshot?.cursors)?ctx.cursorSnapshot.cursors:[];
  // Decorations and the set of allowed players always come from this peer's
  // authorized HTTP view. Only live point coordinates are overlaid in memory.
  return {cursors:base.map(cursor=>{const point=ctx.state.points.get(cursor.playerId);return point?.point?{...cursor,x:point.point.x,y:point.point.y,updatedAt:now}:cursor;}),serverTime:now};
 };
 const schedule=entry=>{
  if(stopped||entry.timer||entry.running||!entry.pending)return;
  entry.timer=setTimeout(()=>{entry.timer=null;void flush(entry).catch(()=>{});},Math.max(1,persistIntervalMs-(Date.now()-entry.lastPersisted)));entry.timer.unref();
 };
 const flush=async entry=>{
  if(stopped||entry.running||!entry.pending)return;
  const input=entry.pending;entry.pending=null;entry.running=true;
  try{
   await ensure(entry.context);const result=await request(entry.context,'/api/rooms/'+entry.context.roomId+'/cursors',{method:'POST',data:input});counters.cursorFlushes++;
   entry.context.cursorSnapshot=result.value;entry.context.cursorVersion=entry.context.state.cursors;
   let sequences;try{sequences=JSON.parse(result.headers.get('x-jigsaw-cursor-sequences'));}catch{}
   const saved=sequences?.find(item=>item.playerId===entry.context.playerId),point=result.value.cursors?.find(item=>item.playerId===entry.context.playerId);
   if(saved&&(saved.clientId===entry.clientId&&saved.seq>entry.seq||saved.clientId!==entry.clientId&&!entry.pending)){entry.clientId=saved.clientId;entry.seq=saved.seq;entry.point=point?{x:point.x,y:point.y}:null;}
  }catch(error){
   if([401,403,404,409,410].includes(error.status)){entry.context.state.points.delete(entry.context.playerId);entry.pending=null;}
   throw error;
  }finally{entry.lastPersisted=Date.now();entry.running=false;schedule(entry);}
 };
 const removeContext=ctx=>{
  if(!ctx||ctx.closed)return;ctx.closed=true;contexts.delete(ctx);ctx.state.contexts.delete(ctx);
  // Only the exact member/connection lease generation is released. This is a
  // separate original-authority CAS, never a replay of an unacknowledged drop.
  if(ctx.actions)void request(ctx,'/api/rooms/'+ctx.roomId,{method:'POST',data:{type:'realtime-disconnect',connectionId:ctx.connectionId}}).catch(()=>{});
  if(!ctx.state.contexts.size&&!ctx.state.cleanup){ctx.state.cleanup=setTimeout(()=>{if(!ctx.state.contexts.size){for(const point of ctx.state.points.values())if(point.timer)clearTimeout(point.timer);rooms.delete(ctx.roomId);}ctx.state.cleanup=null;},300000);ctx.state.cleanup.unref();}
 };
 hub=createRoomRealtimeHub({server,path:'/api/shared/realtime',...transportOptions,authorizeIntervalMs,
  allowOrigin:(source,req)=>{try{return source===publicOrigin&&new URL(req.url,publicOrigin).pathname==='/api/shared/realtime'&&req.headers.host&&new URL('http://'+req.headers.host).host===new URL(publicOrigin).host;}catch{return false;}},
  async subscribe(req,message){
   const cookie=req.headers.cookie??'',credential=credentialKey(cookie);if(!credential.replace(':',''))throw fault(401,'IDENTITY_REQUIRED','请先恢复网站账号或游客身份');
   const ctx={roomId:message.roomId,token:message.token,cookie,credential,generation:-1,cursorVersion:-1,authorizedAt:0,revoked:false,closed:false,connectionId:randomUUID().replaceAll('-',''),state:stateFor(message.roomId)};
   ctx.state.pending++;let admitted=false;
   try{await readCursorAuthority(ctx);if(req.socket.destroyed)throw fault(499,'REALTIME_CLOSED','连接已关闭');contexts.add(ctx);ctx.state.contexts.add(ctx);admitted=true;if(ctx.state.cleanup){clearTimeout(ctx.state.cleanup);ctx.state.cleanup=null;}req.socket.once('close',()=>removeContext(ctx));return ctx;}
   finally{ctx.state.pending--;if(!admitted&&!ctx.state.pending&&!ctx.state.contexts.size)rooms.delete(ctx.roomId);}
  },
  async readRoom(ctx,since){await ensure(ctx);counters.httpReads++;const query=Number.isSafeInteger(since)&&since>=0?'?since='+since:'';return (await request(ctx,'/api/rooms/'+ctx.roomId+query)).value;},
  readCursors:snapshotCursors,
  actionCapabilities:ctx=>ctx.actions,
  async writeAction(ctx,input){
   if(ctx.closed||ctx.revoked||stopped)throw fault(401,'IDENTITY_REQUIRED','连接已关闭，请重新进入房间');
   await ensure(ctx);
   try{const result=await request(ctx,'/api/rooms/'+ctx.roomId+(Number.isSafeInteger(input.since)?'?since='+input.since:''),{method:'POST',data:{type:'realtime-action',connectionId:ctx.connectionId,envelope:input}});return {status:200,data:result.value};}
   catch(error){if(error.status>=400&&error.status<500)return {status:error.status,data:{code:error.code??'ROOM_ERROR',error:error.message}};throw error;}
  },
  async writeCursor(ctx,raw){
   await ensure(ctx);const input=normalize(raw,ctx.world);if(!input)throw fault(400,'INVALID_CURSOR','鼠标位置无效');
   let entry=ctx.state.points.get(ctx.playerId);
   if(!entry){const saved=ctx.sequences?.get(ctx.playerId),point=ctx.cursorSnapshot?.cursors?.find(cursor=>cursor.playerId===ctx.playerId);
    if(saved){entry={context:ctx,clientId:saved.clientId,seq:saved.seq,point:point?{x:point.x,y:point.y}:null,pending:null,timer:null,running:false,lastPersisted:0};ctx.state.points.set(ctx.playerId,entry);}
   }
   if(entry){if(entry.clientId===input.clientId&&input.seq<=entry.seq||entry.clientId!==input.clientId&&input.point===null)return;entry.seq=input.seq;if(input.point!==null){entry.clientId=input.clientId;entry.point=input.point;}entry.context=ctx;entry.pending=input;counters.coalescedCursorInputs++;schedule(entry);}
   else{
    entry={context:ctx,clientId:input.clientId,seq:input.seq,point:input.point,pending:input,timer:null,running:false,lastPersisted:0};ctx.state.points.set(ctx.playerId,entry);
    // One initial authoritative write creates the styling/presence row. Later
    // high-frequency points are sent from memory and merged into bounded writes.
    await flush(entry);
   }
  },
  validate:ctx=>ensure(ctx,true),onDisconnect:removeContext,
 });
 const onRequest=(req,res)=>{
  if(!['POST','PUT','PATCH','DELETE'].includes(req.method))return;
  let pathname;try{pathname=new URL(req.url,publicOrigin).pathname;}catch{return;}
  if(!pathname.startsWith('/api/'))return;
  res.once('finish',()=>{
   if(res.statusCode<200||res.statusCode>=300||stopped)return;
   const match=/^\/api\/(?:shared\/api\/)?(?:rooms|member-rooms)\/([a-f0-9]{32})(?:\/(.*))?$/.exec(pathname);
   if(/^\/api\/auth\//.test(pathname)){
    const key=credentialKey(req.headers.cookie??'');if(key!==':')for(const ctx of contexts)if(ctx.credential===key)ctx.revoked=true;
   }
   const ids=match?[match[1]]:[...rooms.keys()];
   for(const id of ids){const state=rooms.get(id);if(!state)continue;
    if(match?.[2]==='cursors'){state.cursors++;hub.notify(id,{room:false,cursors:true});}
    else{state.generation++;state.cursors++;hub.notify(id,{room:true,cursors:true});}
   }
  });
 };
 server.prependListener('request',onRequest);
 const close=()=>{if(stopped)return;stopped=true;server.off('request',onRequest);for(const state of rooms.values()){if(state.cleanup)clearTimeout(state.cleanup);for(const point of state.points.values())if(point.timer)clearTimeout(point.timer);}hub.close();contexts.clear();rooms.clear();permits.clear();if(globalThis[gateKey]===authorizeAction)delete globalThis[gateKey];};
 server.once('close',close);
 return {...hub,close,stats:()=>({...hub.stats(),...counters,trackedRooms:rooms.size})};
}
