import {join,resolve} from 'node:path';
import {existsSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {isIP} from 'node:net';
import {startProdServer} from 'vinext/server/prod-server';

// Source lives in server/; packaging installs this same entry as app/server.js.
const app=existsSync(join(import.meta.dirname,'dist/server/index.js'))?import.meta.dirname:resolve(import.meta.dirname,'..');
const outDir=process.argv.find(value=>value.startsWith('--out-dir='))?.slice(10)||join(app,'dist');
let service,realtime;
try{
 const {attachWebRoomRealtime}=await import(pathToFileURL(join(app,'server/room-realtime.node.mjs')).href);
 // Only this upgraded Node entry advertises the capability; the old entry and
 // Worker/local runtimes retain HTTP without an unusable WebSocket flag.
 process.env.PUZZLE_REALTIME_ENABLED='1';
 service=await startProdServer({port:Number.parseInt(process.env.PORT??'3000',10),host:process.env.HOST??'0.0.0.0',outDir});
 const origin=process.env.PUZZLE_PUBLIC_ORIGIN||process.env.PUZZLE_LOCAL_ORIGIN||'http://127.0.0.1:'+service.port;
 realtime=attachWebRoomRealtime({server:service.server,port:service.port,origin,addressOf:request=>{
  const peer=request.socket.remoteAddress??'unknown',forwarded=request.headers['x-real-ip'];
  // nginx overwrites X-Real-IP. Accept it only on this machine's loopback hop;
  // direct visitors cannot choose their own connection-limit identity.
  return ['127.0.0.1','::1','::ffff:127.0.0.1'].includes(peer)&&typeof forwarded==='string'&&isIP(forwarded)?forwarded:peer;
 }});
 service.server.on('upgrade',(request,socket)=>{let path;try{path=new URL(request.url,origin).pathname;}catch{}if(path!=='/api/shared/realtime')socket.destroy();});
}catch{
 realtime?.close();service?.server.close();console.error('[jigsaw] Node game service failed to start');process.exitCode=1;
}
