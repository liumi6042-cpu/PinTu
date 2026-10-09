import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {createH5Gateway} from '../server/h5-gateway.mjs';
const listen=server=>new Promise(resolve=>server.listen(0,'127.0.0.1',()=>resolve('http://127.0.0.1:'+server.address().port)));
const close=server=>new Promise(resolve=>server.close(resolve));
const source='https://h5-test.example';
test('H5 gateway separates origins, retains account cookies, forwards room tickets and limits media access',async()=>{
  const seen=[];
  const upstream=createServer(async(req,res)=>{
    const body=[];for await(const c of req)body.push(c);
    seen.push({path:req.url,cookie:req.headers.cookie,authorization:req.headers.authorization,origin:req.headers.origin,body:Buffer.concat(body).toString()});
    if(req.url==='/api/auth/login')res.setHeader('Set-Cookie','puzzle_session='+'a'.repeat(64)+'; HttpOnly; SameSite=Strict');
    if(req.url==='/api/auth/logout')res.setHeader('Set-Cookie','puzzle_session=; Max-Age=0; HttpOnly; SameSite=Strict');
    if(req.url.startsWith('/api/user-images/')) {
      if(!req.headers.cookie?.includes('puzzle_session=')){res.writeHead(403);res.end('denied');return;}
      res.writeHead(200,{'Content-Type':'image/webp'});res.end('image');return;
    }
    res.setHeader('Content-Type','application/json');res.end(JSON.stringify({ok:true}));
  });
  const backend=await listen(upstream),gateway=createH5Gateway({upstream:backend,allowedOrigins:[source]});
  const base=await listen(gateway);
  try{
    const request=(path,options={})=>fetch(base+path,{...options,headers:{Origin:source,...options.headers}});
    const blocked=await fetch(base+'/h5/session',{method:'POST',headers:{Origin:'https://untrusted.example'}});assert.equal(blocked.status,403);assert.equal(seen.length,0);
    const preflight=await request('/h5/api/rooms',{method:'OPTIONS',headers:{'Access-Control-Request-Method':'POST','Access-Control-Request-Headers':'authorization,x-jigsaw-h5-session,content-type'}});
    assert.equal(preflight.status,204);assert.equal(preflight.headers.get('Access-Control-Allow-Origin'),source);assert.ok(!preflight.headers.get('Access-Control-Allow-Credentials'));
    const badHeader=await request('/h5/api/rooms',{method:'OPTIONS',headers:{'Access-Control-Request-Method':'POST','Access-Control-Request-Headers':'cookie'}});assert.equal(badHeader.status,403);
    const {token}=await (await request('/h5/session',{method:'POST',body:'{}'})).json();
    const {token:second}=await (await request('/h5/session',{method:'POST',body:'{}'})).json();
    const headers={'X-Jigsaw-H5-Session':token,'Content-Type':'application/json'};
    assert.match(token,/^[a-f0-9]{64}$/);
    const missing=await request('/h5/api/auth/me');assert.equal(missing.status,401);assert.equal(missing.headers.get('X-Jigsaw-H5-Session-Expired'),'1');
    const login=await request('/h5/api/auth/login',{method:'POST',headers,body:'{"username":"test"}'});
    assert.equal(login.status,200);assert.equal(login.headers.get('Set-Cookie'),null);
    await request('/h5/api/rooms/'+ 'b'.repeat(32),{headers:{...headers,Authorization:'Bearer '+'c'.repeat(32)}});
    const room=seen.at(-1);assert.equal(room.authorization,'Bearer '+'c'.repeat(32));assert.ok(room.cookie.includes('puzzle_session='+'a'.repeat(64)));assert.equal(room.origin,backend);
    await request('/h5/api/auth/me',{headers:{'X-Jigsaw-H5-Session':second}});
    assert.ok(!seen.at(-1).cookie.includes('puzzle_session='));assert.notEqual(seen.at(-1).cookie.split(';')[0],room.cookie.split(';')[0]);
    const image='/api/user-images/custom-'+ 'd'.repeat(32)+'?room='+ 'b'.repeat(32);
    const signed=await request('/h5/media-ticket',{method:'POST',headers,body:JSON.stringify({path:image})});assert.equal(signed.status,200);
    const ticket=await signed.json();assert.ok(!ticket.url.includes(token));
    const actual=await request('/h5/'+ticket.url);assert.equal(actual.status,200);assert.equal(await actual.text(),'image');
    const guestTicket=await (await request('/h5/media-ticket',{method:'POST',headers:{...headers,'X-Jigsaw-H5-Session':second},body:JSON.stringify({path:image})})).json();
    assert.equal((await request('/h5/'+guestTicket.url)).status,403);
    assert.equal((await request('/h5/media-ticket',{method:'POST',headers,body:JSON.stringify({path:'/api/auth/me'})})).status,400);
    assert.equal((await request('/h5/media-ticket',{method:'POST',headers,body:JSON.stringify({path:'https://elsewhere.example/api/user-images/custom-'+ 'd'.repeat(32)})})).status,400);
    assert.equal((await request('/h5/api/internal/bots/tick',{method:'POST',headers,body:'{}'})).status,404);
    await request('/h5/api/auth/logout',{method:'POST',headers,body:'{}'});
    await request('/h5/api/auth/me',{headers});
    assert.ok(!seen.at(-1).cookie.includes('puzzle_session='));
    // A previously signed image still passes through the original permission
    // check after logout, rather than keeping a snapshot of account cookies.
    assert.equal((await request('/h5/'+ticket.url)).status,403);
    const config=await (await request('/h5/config')).json();assert.equal(config.adRewardEnabled,false);assert.equal(config.rewardedAdUnitId,'');
  }finally{await close(gateway);await close(upstream);}
});
