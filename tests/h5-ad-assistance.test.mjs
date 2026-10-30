import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {createH5Gateway} from '../server/h5-gateway.mjs';
const listen=server=>new Promise(resolve=>server.listen(0,'127.0.0.1',()=>resolve('http://127.0.0.1:'+server.address().port)));
const close=server=>new Promise(resolve=>server.close(resolve));
test('ad help is bound to session, room, kind and one idempotent grant',async()=>{
 const roomId='b'.repeat(32),context='room/'+roomId,authorization='Bearer '+'c'.repeat(32);
 const upstream=createServer((req,res)=>{
  if(req.headers.authorization!==authorization){res.writeHead(403);res.end('{}');return;}
  res.setHeader('Content-Type','application/json');res.end(JSON.stringify(req.url.endsWith('/assistance')?{grants:[],serverTime:Date.now()}:{puzzle:{groups:[{id:1,locked:false,pieces:[1,2]},{id:2,locked:false,pieces:[3,4]}]},leases:{2:{playerId:'held'}}}));
 });
 const backend=await listen(upstream),gateway=createH5Gateway({upstream:backend,allowedOrigins:['https://h5.example'],adAssistanceEnabled:true,rewardedAdUnitId:'isolated-unit'}),base=await listen(gateway);
 try{
  const session=async()=>(await (await fetch(base+'/h5/session',{method:'POST',body:'{}'})).json()).token;
  const token=await session(),other=await session();
  const call=(path,body,sessionToken=token,auth=authorization)=>fetch(base+'/h5'+path,{method:body?'POST':'GET',headers:{Origin:'https://h5.example','X-Jigsaw-H5-Session':sessionToken,Authorization:auth,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});
  const endpoint='/api/rooms/'+roomId+'/assistance',input={context,kind:'hint',requestId:'d'.repeat(32)};
  assert.equal((await call(endpoint,{kind:'hint',requestId:input.requestId})).status,403);
  assert.equal((await call('/rewarded/challenge',input,token,'Bearer invalid')).status,403);
  const response=await call('/rewarded/challenge',input);assert.equal(response.status,201);const challenge=await response.json();
  const completed={...input,...challenge,completed:true};
  assert.equal((await call(endpoint,{...completed,completed:false})).status,403);
  assert.equal((await call(endpoint,completed,other)).status,403);
  assert.equal((await call(endpoint,{...completed,kind:'underlay'})).status,403);
  assert.equal((await call('/api/rooms/'+'e'.repeat(32)+'/assistance',completed)).status,403);
  const results=await Promise.all([call(endpoint,completed),call(endpoint,completed)]);
  assert.ok(results.every(r=>r.status===200));
  const bodies=await Promise.all(results.map(r=>r.json()));assert.equal(bodies[0].grants.length,1);assert.deepEqual(bodies[0].grants[0].pieceIds,[1,2]);
  assert.equal(bodies[0].grants[0].expiresAt,bodies[1].grants[0].expiresAt);assert.ok(bodies[0].grants[0].expiresAt-Date.now()<=30000);
  assert.equal((await call('/rewarded/challenge',{...input,requestId:'e'.repeat(32)})).status,409);
  assert.equal((await (await call(endpoint)).json()).grants.length,1);
  assert.equal((await call(endpoint,{...completed,requestId:'f'.repeat(32)})).status,403);
  const local='/assistance/local/'+'a'.repeat(64),localInput={context:'local/'+'a'.repeat(64),kind:'underlay',requestId:'1'.repeat(32)};
  const localWatch=await (await call('/rewarded/challenge',localInput)).json();assert.equal((await call(local,{...localInput,...localWatch,completed:true})).status,200);
 }finally{await close(gateway);await close(upstream);}
});
test('unconfigured advertising never grants help, including direct HTTP requests',async()=>{
 const gateway=createH5Gateway({upstream:'http://127.0.0.1:1',allowedOrigins:['https://h5.example']}),base=await listen(gateway);
 try{
  const token=(await (await fetch(base+'/h5/session',{method:'POST',body:'{}'})).json()).token;
  const options={method:'POST',headers:{'X-Jigsaw-H5-Session':token,'Content-Type':'application/json'},body:JSON.stringify({kind:'underlay',requestId:'a'.repeat(32),completed:true})};
  assert.equal((await fetch(base+'/h5/assistance/local/'+'b'.repeat(64),options)).status,503);
  assert.equal((await fetch(base+'/h5/rewarded/challenge',options)).status,503);
 }finally{await close(gateway);}
});

test('config adds the orientation slots only when ads are on; rewardedAdUnitId stays for old clients',async()=>{
 const read=async options=>{const gateway=createH5Gateway({upstream:'http://127.0.0.1:9',allowedOrigins:['https://h5.example'],...options}),base=await listen(gateway);try{return await (await fetch(base+'/h5/config')).json();}finally{await close(gateway);}};
 const on=await read({adAssistanceEnabled:true,rewardedAdUnitId:'1054324',rewardedAdUnitIdPortrait:'1054324',rewardedAdUnitIdLandscape:'1054323'});
 assert.equal(on.rewardedAdUnitId,'1054324');assert.equal(on.rewardedAdUnitIdPortrait,'1054324');assert.equal(on.rewardedAdUnitIdLandscape,'1054323');assert.equal(on.adRewardEnabled,true);
 const off=await read({adAssistanceEnabled:false,rewardedAdUnitId:'1054324',rewardedAdUnitIdPortrait:'1054324',rewardedAdUnitIdLandscape:'1054323'});
 assert.equal(off.rewardedAdUnitId,'');assert.equal('rewardedAdUnitIdPortrait' in off,false);assert.equal('rewardedAdUnitIdLandscape' in off,false);
 const legacy=await read({adAssistanceEnabled:true,rewardedAdUnitId:'1054324'});
 assert.equal(legacy.rewardedAdUnitId,'1054324');assert.equal('rewardedAdUnitIdLandscape' in legacy,false);
});
