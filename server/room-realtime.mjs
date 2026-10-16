import {WebSocketServer} from 'ws';

const fault=(status,code,error)=>Object.assign(new Error(error),{status,code});
/** Transport only. Every room read uses the receiving peer's authenticated context. */
export function createRoomRealtimeHub(options){
 const {server,path,allowOrigin,subscribe,readRoom,readCursors,writeCursor,validate}=options;
 const wss=new WebSocketServer({noServer:true,maxPayload:options.maxPayload??4096,perMessageDeflate:false});
 const peers=new Set(),rooms=new Map(),pending=new Map();let closed=false;
 const counters={connections:0,roomReads:0,cursorReads:0,cursorWrites:0,validations:0,rejected:0};
 const send=(peer,message)=>{
  if(peer.ws.readyState!==1)return false;
  if(peer.ws.bufferedAmount>(options.maxBufferedAmount??512*1024)){peer.ws.close(1013,'Slow receiver');return false;}
  peer.ws.send(JSON.stringify(message));return true;
 };
 const reject=(peer,error)=>{counters.rejected++;send(peer,{type:'error',status:error.status??500,code:error.code??'REALTIME_ERROR',error:error.status?error.message:'实时连接暂不可用'});peer.ws.close(error.status===429?1008:4001,'Realtime rejected');};
 const roomFor=peer=>{let set=rooms.get(peer.context.roomId);if(!set){set=new Set();rooms.set(peer.context.roomId,set);}return set;};
 const refresh=async(peer,kind)=>{
  if(!peer.context||peer.ws.readyState!==1)return;
  try{
   if(kind.room){counters.roomReads++;const data=await readRoom(peer.context,peer.since);if(peer.ws.readyState!==1)return;if(Number.isSafeInteger(data?.revision))peer.since=data.revision;send(peer,{type:'room',data});}
   if(kind.cursors){counters.cursorReads++;const data=await readCursors(peer.context);send(peer,{type:'cursors',data});}
  }catch(error){reject(peer,error);}
 };
 const notify=(roomId,{room=true,cursors=false}={})=>{
  if(closed||!rooms.has(roomId))return;
  const old=pending.get(roomId);pending.set(roomId,{room:room||old?.room,cursors:cursors||old?.cursors});
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
  const peer={ws,request,address,context:null,since:null,chain:Promise.resolve(),alive:true,window:Date.now(),count:0,cursors:0};peers.add(peer);counters.connections++;
  const admission=setTimeout(()=>{if(!peer.context)reject(peer,fault(408,'SUBSCRIBE_REQUIRED','请先订阅房间'));},options.subscribeTimeoutMs??5000);admission.unref();
  ws.on('pong',()=>{peer.alive=true;});
  ws.on('error',()=>{});
  ws.on('close',()=>{clearTimeout(admission);peers.delete(peer);if(peer.context){const set=rooms.get(peer.context.roomId);set?.delete(peer);if(!set?.size)rooms.delete(peer.context.roomId);}options.onDisconnect?.(peer.context);});
  ws.on('message',(bytes,binary)=>{
   const now=Date.now();if(now-peer.window>=1000){peer.window=now;peer.count=0;peer.cursors=0;}
   if(++peer.count>40){reject(peer,fault(429,'REALTIME_RATE_LIMIT','实时消息发送较快'));return;}
   let input;try{if(binary)throw Error();input=JSON.parse(bytes.toString());if(!input||typeof input!=='object'||Array.isArray(input))throw Error();}catch{reject(peer,fault(400,'INVALID_REALTIME_MESSAGE','实时消息格式无效'));return;}
   if(input.type==='cursor'&&++peer.cursors>25){reject(peer,fault(429,'CURSOR_RATE_LIMIT','光标发送较快'));return;}
   peer.chain=peer.chain.then(async()=>{
    if(ws.readyState!==1)return;
    try{
     if(!peer.context){
      if(input.type!=='subscribe'||typeof input.roomId!=='string'||!/^[a-f0-9]{32}$/.test(input.roomId)||typeof input.token!=='string'||!/^[a-f0-9]{32}$/.test(input.token)||input.since!==undefined&&(!Number.isSafeInteger(input.since)||input.since<0))throw fault(400,'INVALID_SUBSCRIPTION','房间订阅无效');
      const context=await subscribe(request,input);if(!context||context.roomId!==input.roomId)throw fault(403,'ROOM_IDENTITY_MISMATCH','请重新加入房间');
      if(ws.readyState!==1)return;peer.context=context;peer.since=input.since??null;clearTimeout(admission);roomFor(peer).add(peer);send(peer,{type:'ready'});await refresh(peer,{room:true,cursors:true});return;
     }
     if(input.type==='ping'){send(peer,{type:'pong'});return;}
     if(input.type!=='cursor')throw fault(400,'INVALID_REALTIME_MESSAGE','实时消息类型无效');
     counters.cursorWrites++;await writeCursor(peer.context,input.data);notify(peer.context.roomId,{room:false,cursors:true});
    }catch(error){reject(peer,error);}
   });
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
