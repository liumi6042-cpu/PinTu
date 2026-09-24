import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
const [origin,file]=process.argv.slice(2);assert(/^http:\/\/127\.0\.0\.1:\d+$/.test(origin)&&/[\\/]jigsaw-release-test-[^\\/]+[\\/]data[\\/]puzzle.sqlite$/.test(file),'isolated fixture only');
const db=new DatabaseSync(file),id=()=>crypto.randomUUID().replaceAll('-','');
async function req(actor,path,body,status=200){const r=await fetch(origin+path,{method:body?'POST':'GET',headers:{Host:'jigsawnook.online','X-Forwarded-Host':'jigsawnook.online','X-Forwarded-Proto':'https','CF-Connecting-IP':'192.0.2.89',Origin:'https://jigsawnook.online',...(body?{'Content-Type':'application/json'}:{}),Cookie:actor.cookie||'',...(actor.token?{Authorization:'Bearer '+actor.token}:{})},body:body?JSON.stringify(body):undefined});const data=await r.json();assert.equal(r.status,status,JSON.stringify(data));const cookie=r.headers.get('set-cookie')?.split(';')[0];if(cookie)actor.cookie=cookie;return data;}
const total=s=>Object.values(s.owned).reduce((a,b)=>a+b,0)+(s.cosmetics?.bubbles?.length||0)+(s.cosmetics?.cursors?.length||0);
try{
 const a={},guest={},b={};for(const actor of [a,b]){const r=await req(actor,'/api/auth/register',{username:'wear_'+id().slice(0,12),name:'Wardrobe QA',password:id()},201);actor.id=r.account.id;}
 let g=await req(a,'/api/courtyard');const equip=(kind,item,version=g.version)=>({action:'equip',kind,item,version,requestId:id()});
 await req(guest,'/api/courtyard',equip('cursor','leaf'),401);await req(a,'/api/courtyard',equip('cursor','leaf'),403);await req(b,'/api/courtyard',{...equip('bubble','moon'),userId:a.id,owned:['moon']},403);
 g.state.cosmetics={bubbles:['moon','flower'],cursors:['leaf'],equipped:{bubble:null,cursor:null}};g.state.progress=300;
 db.prepare('UPDATE puzzle_courtyards SET data=?,version=version+1 WHERE user_id=?').run(JSON.stringify(g.state),a.id);g=await req(a,'/api/courtyard');
 g=await req(a,'/api/courtyard',equip('bubble','moon'));g=await req(a,'/api/courtyard',equip('cursor','leaf'));assert.equal(g.state.cosmetics.equipped.bubble,'moon');assert.equal(g.state.cosmetics.equipped.cursor,'leaf');
 await req(a,'/api/courtyard',equip('__proto__','moon'),400);
 const room=await req(a,'/api/rooms',{visibility:'public',imageId:'seaside-native-v2',pieces:108},201);a.token=room.token;const path='/api/rooms/'+room.room.id;
 const joined=await req(guest,path+'/join',{guestSecret:id()+id()});guest.token=joined.token;
 const before=db.prepare('SELECT data FROM puzzle_rooms WHERE id=?').get(room.room.id).data;
 const sent=await req(a,path+'/chat',{text:'Cosmetic QA',requestId:id(),bubble:'strawberry'});assert.equal(sent.message.bubble,'moon');
 const feed=await req(guest,path+'/chat');assert.equal(feed.messages[0].bubble,'moon');
 const gs=await req(guest,path+'/chat',{text:'Guest QA',requestId:id(),bubble:'moon'});assert.equal(gs.message.bubble,null);
 await req(a,path+'/cursors',{clientId:id(),seq:1,point:{x:400,y:300},cursorStyle:'moon'});
 const cursors=await req(guest,path+'/cursors');assert.equal(cursors.cursors.find(c=>c.playerId===room.playerId).cursorStyle,'leaf');
 const guestPositions=await req(guest,path+'/cursors',{clientId:id(),seq:1,point:{x:500,y:300},cursorStyle:'leaf'});assert.equal(guestPositions.cursors.find(c=>c.playerId===joined.playerId).cursorStyle,null);
 assert.equal(db.prepare('SELECT data FROM puzzle_rooms WHERE id=?').get(room.room.id).data,before);
 const oldTotal=total(g.state),balance=g.state.balance,redeemed=g.state.redeemed;const hatch={action:'hatch',version:g.version,requestId:id()};
 const results=await Promise.all([req(a,'/api/courtyard',hatch),req(a,'/api/courtyard',hatch)]);assert.deepEqual(results[0].state.lastHatch,results[1].state.lastHatch);g=await req(a,'/api/courtyard');assert.equal(total(g.state),oldTotal+1);assert.equal(g.state.progress,250);assert.equal(g.state.balance,balance);assert.deepEqual(g.state.redeemed,redeemed);
 assert.equal((await req(a,'/api/courtyard')).state.cosmetics.equipped.cursor,'leaf');
 g=await req(a,'/api/courtyard',equip('cursor',null));assert.equal(g.state.cosmetics.equipped.cursor,null);assert.equal(g.state.cosmetics.equipped.bubble,'moon');
 db.prepare("INSERT OR REPLACE INTO puzzle_account_security(user_id,status) VALUES(?,'suspended')").run(a.id);await req(a,'/api/courtyard',equip('bubble',null),401);
 console.log('Cosmetics HTTP: guest/locked/forged equipment blocked, independent slots persisted, room bubble and cursor sharing correct, guest styles default, concurrent hatch exactly once, balance/quota/gameplay unchanged.');
}finally{db.close();}
