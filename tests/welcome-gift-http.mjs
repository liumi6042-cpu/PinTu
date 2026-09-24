import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
const [origin,file]=process.argv.slice(2);assert(/^http:\/\/127\.0\.0\.1:\d+$/.test(origin)&&/[\\/]jigsaw-release-test-[^\\/]+[\\/]data[\\/]puzzle.sqlite$/.test(file),'isolated fixture only');
const db=new DatabaseSync(file),id=()=>crypto.randomUUID().replaceAll('-','');
async function req(actor,path,body,status=200){
 const r=await fetch(origin+path,{method:body?'POST':'GET',headers:{Host:'jigsawnook.online','X-Forwarded-Host':'jigsawnook.online','X-Forwarded-Proto':'https','CF-Connecting-IP':'192.0.2.87',Origin:'https://jigsawnook.online',...(body?{'Content-Type':'application/json'}:{}),Cookie:actor.cookie||'',...(actor.token?{Authorization:'Bearer '+actor.token}:{})},body:body?JSON.stringify(body):undefined});
 const data=await r.json();assert.equal(r.status,status,JSON.stringify(data));
 const cookie=r.headers.get('set-cookie')?.split(';')[0];if(cookie){const name=cookie.split('=')[0];actor.cookie=[...(actor.cookie||'').split('; ').filter(c=>c&&!c.startsWith(name+'=')),cookie].join('; ');}return data;
}
async function register(actor){const r=await req(actor,'/api/auth/register',{username:'gift_'+id().slice(0,12),name:'Gift QA',password:id()},201);actor.id=r.account.id;return actor;}
async function create(actor){const r=await req(actor,'/api/rooms',{visibility:'public',imageId:'seaside-native-v2',pieces:108,guestSecret:id()+id()},201);actor.token=r.token;actor.room=r.room.id;return r.room;}
async function snap(actor){const path='/api/rooms/'+actor.room;await req(actor,path,{type:'claim',groupId:0});await req(actor,path,{type:'drop',groupId:0,dx:0,dy:0,seq:1});}
const gift='/api/welcome-gift',offer=a=>({action:'offer',roomId:a.room});
try{
 const guest={};assert.equal((await req(guest,gift)).gift,null);await req(guest,gift,{action:'claim'},401);
 await create(guest);await req(guest,gift,offer(guest),403);await snap(guest);
 const before=db.prepare('SELECT data FROM puzzle_rooms WHERE id=?').get(guest.room).data;
 const pending=(await req(guest,gift,offer(guest))).gift;assert.ok(['fern','cushion','blueVase'].includes(pending.item));assert.equal(pending.claimed,false);
 assert.deepEqual((await req(guest,gift,offer(guest))).gift,pending);assert.deepEqual((await req(guest,gift)).gift,pending);
 const stranger={};await create(stranger);await req(stranger,gift,{action:'offer',roomId:guest.room},403);
 const guestCookie=guest.cookie;await register(guest);assert.deepEqual((await req(guest,gift)).gift,pending,'login preserves exact guest gift');
 const initial=await req(guest,'/api/courtyard');
 const claims=await Promise.all(Array.from({length:5},()=>req(guest,gift,{action:'claim',item:'table'})));
 assert.ok(claims.every(r=>r.gift.item===pending.item&&r.gift.claimed));
 const after=await req(guest,'/api/courtyard');assert.equal(after.state.owned[pending.item],1);assert.equal(Object.values(after.state.owned).reduce((a,b)=>a+b,0),1);
 assert.deepEqual(after.state.redeemed,initial.state.redeemed);assert.equal(after.state.balance,initial.state.balance);assert.equal(after.state.progress,initial.state.progress);
 assert.equal(db.prepare("SELECT COUNT(*) n FROM puzzle_courtyard_events WHERE user_id=? AND operation='welcome-gift-v1'").get(guest.id).n,1);
 assert.equal(db.prepare('SELECT data FROM puzzle_rooms WHERE id=?').get(guest.room).data,before,'reward never writes puzzle state');
 const second={cookie:guestCookie};await register(second);await req(second,gift,{action:'claim'},409);
 await req(guest,gift,{action:'claim'});assert.equal((await req(guest,'/api/courtyard')).state.owned[pending.item],1);
 const signed=await register({});await create(signed);await snap(signed);const g=await req(signed,'/api/courtyard');g.state.owned={fern:2,cushion:1};
 db.prepare('UPDATE puzzle_courtyards SET data=?,version=version+1 WHERE user_id=?').run(JSON.stringify(g.state),signed.id);
 assert.equal((await req(signed,gift,offer(signed))).gift.item,'blueVase','prefer unowned');
 const accountClaim=await req(signed,gift,{action:'claim'});assert.equal(accountClaim.profile.state.owned.blueVase,1);assert.equal(accountClaim.profile.state.owned.fern,2);
 db.prepare("INSERT OR REPLACE INTO puzzle_account_security(user_id,status) VALUES(?,'suspended')").run(signed.id);await req(signed,gift,{action:'claim'},401);
 console.log('Welcome gift: real snap eligibility, guest-to-account continuity, concurrent once-only claim, no cross-account reuse, inventory persistence, unowned preference, no balance/quota/puzzle changes passed.');
}finally{db.close();}
