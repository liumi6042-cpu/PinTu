import {WebSocketServer} from 'ws';

const fault=(status,code,error)=>Object.assign(new Error(error),{status,code});
const actionId=value=>typeof value==='string'&&/^[a-f0-9]{32}$/.test(value);
const actionInteger=(value,min=0)=>Number.isSafeInteger(value)&&value>=min&&value<=2147483647;
const validAction=input=>{
 const action=input.action;
 return actionId(input.id)&&actionId(input.clientId)&&actionId(input.gestureId)&&actionInteger(input.ordinal,1)&&
  (input.since===undefined||Number.isSafeInteger(input.since)&&input.since>=0)&&action&&typeof action==='object'&&!Array.isArray(action)&&['claim','move','drop','release'].includes(action.type)&&actionInteger(action.groupId)&&
  (action.seq===undefined||actionInteger(action.seq,1))&&(action.dx===undefined||Number.isFinite(action.dx)&&Math.abs(action.dx)<=20000)&&(action.dy===undefined||Number.isFinite(action.dy)&&Math.abs(action.dy)<=20000)&&
  (!['move','drop'].includes(action.type)||actionInteger(action.seq,1)&&Number.isFinite(action.dx)&&Number.isFinite(action.dy));
};
/** Transport only. Every room read uses the receiving peer's authenticated context. */
export function createRoomRealtimeHub(options){
 const {server,path,allowOrigin,subscribe,readRoom,readCursors,writeCursor,validate}=options;
 const wss=new WebSocketServer({noServer:true,maxPayload:Math.min(options.maxPayload??4096,4096),perMessageDeflate:false});
 const peers=new Set(),rooms=new Map(),pending=new Map();let closed=false;
 const counters={connections:0,roomReads:0,cursorReads:0,cursorWrites:0,actionWrites:0,validations:0,rejected:0};
 const capabilities=async context=>{
  if(typeof options.writeAction!=='function'||typeof options.actionCapabilities!=='function')return undefined;
  const value=await options.actionCapabilities(context);return value?.version===1&&typeof value?.diagnosticOnly==='boolean'?{version:1,diagnosticOnly:value.diagnosticOnly}:undefined;
 };
 const send=(peer,message)=>{
  if(peer.ws.readyState!==1)return false;
  if(peer.ws.bufferedAmount>(options.maxBufferedAmount??512*1024)){peer.ws.close(1013,'Slow receiver');return false;}
  try{peer.ws.send(JSON.stringify(message));return true;}catch{peer.ws.close(1011,'Send failed');return false;}
 };
 const reject=(peer,error)=>{counters.rejected++;send(peer,{type:'error',status:error.status??500,code:error.code??'REALTIME_ERROR',error:error.status?error.message:'实时连接暂不可用'});peer.ws.close(error.status===429?1008:4001,'Realtime rejected');};
 const roomFor=peer=>{let set=rooms.get(peer.context.roomId);if(!set){set=new Set();rooms.set(peer.context.roomId,set);}return set;};
 const refresh=async(peer,kind)=>{
  if(!peer.context||peer.ws.readyState!==1)return;
  try{
   if(kind.room){counters.roomReads++;const data=await readRoom(peer.context,peer.since);if(peer.ws.readyState!==1)return;if(Number.isSafeInteger(data?.revision))peer.since=data.revision;send(peer,{type:'room',data});}
   if(kind.cursors){counters.cursorReads++;const data=await readCursors(peer.context);send(peer,{type:'cursors',data});}
   if(kind.cheers&&options.readCheers){const data=await options.readCheers(peer.context,peer.cheerSince);peer.cheerSince=data.cursor;if(data.cheers?.length)send(peer,{type:'cheers',data});}
  }catch(error){reject(peer,error);}
 };
 const notify=(roomId,{room=true,cursors=false,cheers=false}={})=>{
  if(closed||!rooms.has(roomId))return;
  const old=pending.get(roomId);pending.set(roomId,{room:room||old?.room,cursors:cursors||old?.cursors,cheers:cheers||old?.cheers});
  if(old)return;
  queueMicrotask(async()=>{const kind=pending.get(roomId);pending.delete(roomId);if(!kind)return;await Promise.all([...rooms.get(roomId)??[]].map(peer=>{peer.chain=peer.chain.then(()=>refresh(peer,kind));return peer.chain;}));});
 };
 const upgrade=(request,socket,head)=>{
  let url;try{url=new URL(request.url,'http://realtime.invalid');}catch{socket.destroy();return;}
  if(url.pathname!==path){if(options.ignoreOtherPaths!==true)socket.destroy();return;}
  // Credentials and all query parameters are forbidden on the handshake URL.
  let originAllowed=false;try{originAllowed=allowOrigin(request.headers.origin,request)===true;}catch{}
  let address=socket.remoteAddress??'unknown';try{if(options.addressOf)address=options.addressOf(request);}catch{originAllowed=false;}
  const sameAddress=[...peers].filter(peer=>peer.address===address).length;
  if(url.search||!originAllowed||peers.size>=(options.maxConnections??512)||sameAddress>=(options.maxConnectionsPerAddress??16)){
   counters.rejected++;socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');return;
  }
  wss.handleUpgrade(request,socket,head,ws=>wss.emit('connection',ws,request,address));
 };
 server.on('upgrade',upgrade);
 wss.on('connection',(ws,request,address)=>{
  const peer={ws,request,address,context:null,since:null,chain:Promise.resolve(),alive:true,window:Date.now(),count:0,cursors:0,actions:0,actionCapabilities:undefined,queued:0,queuedActions:0};peers.add(peer);counters.connections++;
  const admission=setTimeout(()=>{if(!peer.context)reject(peer,fault(408,'SUBSCRIBE_REQUIRED','请先订阅房间'));},options.subscribeTimeoutMs??5000);admission.unref();
  ws.on('pong',()=>{peer.alive=true;});
  ws.on('error',()=>{});
  ws.on('close',()=>{clearTimeout(admission);peers.delete(peer);if(peer.context){const set=rooms.get(peer.context.roomId);set?.delete(peer);if(!set?.size)rooms.delete(peer.context.roomId);}options.onDisconnect?.(peer.context);});
  ws.on('message',(bytes,binary)=>{
   const now=Date.now();if(now-peer.window>=1000){peer.window=now;peer.count=0;peer.cursors=0;peer.actions=0;}
   let input;try{if(binary)throw Error();input=JSON.parse(bytes.toString());if(!input||typeof input!=='object'||Array.isArray(input))throw Error();}catch{reject(peer,fault(400,'INVALID_REALTIME_MESSAGE','实时消息格式无效'));return;}
   const isCheer=input.type==='cheer';
   const cheerError=error=>send(peer,{type:'cheer-error',id:input.data?.id??null,status:error.status??500,code:error.code??'CHEER_ERROR',error:error.status?error.message:'喝彩暂时无法发送'});
   if(++peer.count>(peer.actionCapabilities?96:40)){if(isCheer)cheerError(fault(429,'CHEER_RATE_LIMIT','喝彩太快啦，歇一下'));else reject(peer,fault(429,'REALTIME_RATE_LIMIT','实时消息发送较快'));return;}
   if(input.type==='cursor'&&++peer.cursors>25){reject(peer,fault(429,'CURSOR_RATE_LIMIT','光标发送较快'));return;}
   const isAction=input.type==='action';
   const actionResult=(status,data)=>send(peer,{type:'action-result',id:input.id,status,data});
   if(isAction&&!actionId(input.id)){reject(peer,fault(400,'INVALID_ACTION_INPUT','动作请求编号无效'));return;}
   if(isAction&&++peer.actions>64){actionResult(429,{code:'ACTION_RATE_LIMIT',error:'动作发送较快，请稍后再试'});return;}
   if(peer.queued>=64||isAction&&peer.queuedActions>=64){
    if(isCheer)cheerError(fault(429,'CHEER_RATE_LIMIT','喝彩太快啦，歇一下'));
    else if(isAction)actionResult(429,{code:'ACTION_BACKPRESSURE',error:'尚有动作等待确认，请稍后再试'});
    else reject(peer,fault(429,'REALTIME_BACKPRESSURE','实时消息积压，请重新连接'));return;
   }
   peer.queued++;if(isAction)peer.queuedActions++;
   peer.chain=peer.chain.then(async()=>{
    if(ws.readyState!==1)return;
    try{
     if(!peer.context){
      if(input.type!=='subscribe'||typeof input.roomId!=='string'||!/^[a-f0-9]{32}$/.test(input.roomId)||typeof input.token!=='string'||!/^[a-f0-9]{32}$/.test(input.token)||input.since!==undefined&&(!Number.isSafeInteger(input.since)||input.since<0))throw fault(400,'INVALID_SUBSCRIPTION','房间订阅无效');
      const context=await subscribe(request,input);if(!context||context.roomId!==input.roomId)throw fault(403,'ROOM_IDENTITY_MISMATCH','请重新加入房间');
      if(ws.readyState!==1)return;peer.context=context;peer.since=input.since??null;peer.actionCapabilities=await capabilities(context);peer.cheerSince=options.readCheers?(await options.readCheers(context)).cursor:0;clearTimeout(admission);roomFor(peer).add(peer);send(peer,{type:'ready',...(peer.actionCapabilities?{actions:peer.actionCapabilities}:{})});await refresh(peer,{room:true,cursors:true});return;
     }
     if(input.type==='ping'){send(peer,{type:'pong'});return;}
     if(isCheer){
      try{
       if(!options.writeCheer)throw fault(404,'CHEERS_UNSUPPORTED','当前房间暂不支持喝彩');
       await options.writeCheer(peer.context,input.data);
       notify(peer.context.roomId,{room:false,cursors:false,cheers:true});
      }catch(error){cheerError(error);}
      return;
     }
     if(isAction){
      // Revalidate the authenticated session before each write. A business
      // rejection has an acknowledgement; a lost identity closes the channel.
      await validate?.(peer.context);
      if(!peer.actionCapabilities||!await capabilities(peer.context)){actionResult(403,{code:'DIAGNOSTIC_ACTION_REQUIRED',error:'当前房间未开放诊断动作'});return;}
      if(!validAction(input)){actionResult(400,{code:'INVALID_ACTION_INPUT',error:'诊断动作格式无效'});return;}
      try{
       counters.actionWrites++;
       const result=await options.writeAction(peer.context,{id:input.id,clientId:input.clientId,gestureId:input.gestureId,ordinal:input.ordinal,action:input.action,...(input.since!==undefined?{since:input.since}:{})});
       if(!Number.isInteger(result?.status)||result.status<200||result.status>599||!Object.hasOwn(result,'data'))throw Error('Invalid action reply');
       actionResult(result.status,result.data);
      }catch(error){actionResult(error.status>=400&&error.status<=599?error.status:500,{code:error.code??'ACTION_ERROR',error:error.status?error.message:'动作暂时无法处理'});}
      return;
     }
     if(input.type!=='cursor')throw fault(400,'INVALID_REALTIME_MESSAGE','实时消息类型无效');
     counters.cursorWrites++;await writeCursor(peer.context,input.data);notify(peer.context.roomId,{room:false,cursors:true});
    }catch(error){if(isCheer)cheerError(error);else reject(peer,error);}
   }).finally(()=>{peer.queued--;if(isAction)peer.queuedActions--;});
  });
 });
 const authTimer=setInterval(()=>{
  for(const peer of peers)if(peer.context&&peer.ws.readyState===1)peer.chain=peer.chain.then(async()=>{try{counters.validations++;await validate?.(peer.context);}catch(error){reject(peer,error);}});
 },options.authorizeIntervalMs??5000);authTimer.unref();
 const heartbeat=setInterval(()=>{for(const peer of peers){if(!peer.alive){peer.ws.terminate();continue;}peer.alive=false;if(peer.ws.readyState===1)peer.ws.ping();}},options.heartbeatIntervalMs??30000);heartbeat.unref();
 const close=()=>{if(closed)return;closed=true;clearInterval(authTimer);clearInterval(heartbeat);server.off('upgrade',upgrade);pending.clear();for(const peer of peers)peer.ws.terminate();wss.close();};
 server.once('close',close);
 return {notify,close,stats:()=>({...counters,peers:peers.size,rooms:rooms.size})};
}
