// Local test setup only. Multiplayer creation is now gated in the public API;
// collaboration regressions seed their own isolated rooms, without a production bypass.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createHash, randomBytes } from 'node:crypto';
import { makeRoom, addMember, validName, snapshot } from '../lib/room-engine.ts';
const run=promisify(execFile),networkFetch=globalThis.fetch,root=fileURLToPath(new URL('../',import.meta.url));
const hash=value=>createHash('sha256').update(value).digest('hex');
const literal=value=>"'"+String(value).replaceAll("'","''")+"'";
export async function fixtureFetch(input,options={}){
  const url=new URL(input,process.env.PUZZLE_TEST_URL||'http://localhost:3000');
  if(url.pathname!=='/api/rooms'||options.method!=='POST')return networkFetch(url,options);
  const data=JSON.parse(options.body||'{}');
  if(data.visibility==='solo'||(data.visibility!==undefined&&!['public','private'].includes(data.visibility)))return networkFetch(url,options);
  if(!['localhost','127.0.0.1'].includes(url.hostname))throw new Error('Room fixtures can only seed the local test server');
  const headers=new Headers(options.headers);
  if(headers.get('Origin')&&headers.get('Origin')!==url.origin)return networkFetch(url,options);
  try{
    const now=Date.now(),id=crypto.randomUUID().replaceAll('-',''),token=crypto.randomUUID().replaceAll('-','');
    const room=makeRoom(id,data.imageId,data.pieces,now);
    let account,guestId,cookie,name=data.name;
    if(data.visibility){
      account=(await (await networkFetch(url.origin+'/api/auth/me',{headers:{Cookie:headers.get('Cookie')||''}})).json()).account;
      if(!account){let secret=headers.get('Cookie')?.match(/puzzle_guest=([a-f0-9]{64})/)?.[1];
        if(!secret){secret=randomBytes(32).toString('hex');cookie='puzzle_guest='+secret+'; Path=/; HttpOnly; SameSite=Strict';}
        guestId='guest:'+hash(secret);name='游客 '+guestId.slice(-4).toUpperCase();
      }else name=account.name;
      room.visibility=data.visibility;room.ownerId=account?.id||guestId;room.startedAt=null;room.participants={};
    }
    const member=addMember(room,crypto.randomUUID().replaceAll('-',''),validName(name),hash(token),now,account?.id,guestId);
    const serialized=JSON.stringify(room);
    const commands=[`INSERT INTO puzzle_rooms (id,revision,data,expires_at) VALUES (${literal(id)},0,'',${room.expiresAt});`];
    // CLI SQL statements have a lower size ceiling than bound production writes.
    for(let offset=0;offset<serialized.length;offset+=16000)commands.push(`UPDATE puzzle_rooms SET data=data||${literal(serialized.slice(offset,offset+16000))} WHERE id=${literal(id)};`);
    if(data.visibility)commands.push(`INSERT INTO puzzle_room_directory (room_id,visibility,owner_id,title,image_id,piece_count,created_at,expires_at,completed_at,slot) VALUES (${literal(id)},${literal(data.visibility)},${literal(room.ownerId)},${literal(data.imageId)},${literal(data.imageId)},${data.pieces},${now},${room.expiresAt},NULL,NULL);`);
    await mkdir(new URL('../work/test-fixtures/',import.meta.url),{recursive:true});
    const path=fileURLToPath(new URL('../work/test-fixtures/'+id+'.sql',import.meta.url));await writeFile(path,commands.join('\n'));
    await run(process.execPath,[fileURLToPath(new URL('../node_modules/wrangler/bin/wrangler.js',import.meta.url)),'d1','execute','PUZZLE_DB','--local','--config','wrangler.local.json','--file',path],{cwd:root,windowsHide:true,env:{...process.env,WRANGLER_SEND_METRICS:'false'},maxBuffer:1024*1024});
    return Response.json({token,playerId:member.id,room:snapshot(room,now)},{status:201,headers:cookie?{'Set-Cookie':cookie}:{}});
  }catch(error){if(error.status)return Response.json({error:error.message},{status:error.status});throw error;}
}
