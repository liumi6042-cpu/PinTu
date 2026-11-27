import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomBytes} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {mkdirSync,mkdtempSync,rmSync} from 'node:fs';
import {resolve} from 'node:path';
import {createMobileService,CHAT_PHRASES} from '../server/mobile-service.mjs';
import {readMobilePrivacyReview} from '../server/mobile-privacy.mjs';

const rid=()=>randomBytes(16).toString('hex');
const actor=value=>createHash('sha256').update(value).digest('hex');
const a=actor('public-test-a'),b=actor('public-test-b'),c=actor('public-test-c');
function setup(options={}){
 let now=1800000000000;
 const service=createMobileService({...options,now:()=>now,randomInt:min=>min});
 const call=(owner,path,body,method=body===undefined?'GET':'POST',token)=>service.handle({identity:owner,url:path,method,body,authorization:token?'Bearer '+token:undefined});
 const social=(owner,path='',body,token)=>call(owner,'/api/mobile/social'+path,body===undefined?undefined:{requestId:rid(),...body},undefined,token);
 return {service,call,social,advance:()=>now+=3000};
}
function storedFixture(){
 const root=resolve('work');mkdirSync(root,{recursive:true});
 const directory=mkdtempSync(resolve(root,'public-test-controls-'));
 assert.ok(directory.startsWith(root+'\\'));
 return {databasePath:resolve(directory,'mobile.sqlite'),cleanup:()=>rmSync(directory,{recursive:true,force:true})};
}
function friends(f){
 const ac=f.social(a).data.self.code,bc=f.social(b).data.self.code;
 assert.equal(f.social(a,'/requests',{code:bc}).status,200);
 assert.equal(f.social(b,'/requests/respond',{code:ac,accept:true}).status,200);
 return {ac,bc};
}

test('mobile public-test defaults reject direct free-text APIs; Web and explicit host policies retain their behavior',()=>{
 const f=setup(),web=setup({runtimeProfile:'web'}),explicit=setup({publicTestPolicy:{customNames:true,privateMessages:true}}),safeWeb=setup({runtimeProfile:'web',publicTestPolicy:{customNames:false,privateMessages:false}});
 try{
  assert.equal(f.service.capabilities.customNames,false);
  assert.equal(f.service.capabilities.social.privateMessages,false);
  for(const key of ['friends','privateMessageHistory','roomInvites','reports','blocking','search','presence'])assert.equal(f.service.capabilities.social[key],true);
  assert.equal(f.call(a,'/api/mobile/profile',{name:'不应保存',autoSupply:false},'PATCH').data.code,'CUSTOM_NAMES_UNAVAILABLE');
  {const name=f.call(a,'/api/mobile/profile').data.name;assert.notEqual(name,'不应保存');assert.equal(f.call(a,'/api/mobile/profile').data.name,name);}
  assert.equal(f.call(a,'/api/mobile/profile').data.autoSupply,true); // Failed mixed updates roll back.
  assert.equal(f.call(a,'/api/mobile/profile',{autoSupply:false},'PATCH').data.autoSupply,false);
  assert.equal(f.social(a,'/messages',{kind:'text',peer:'123456789',text:'旧客户端直连'}).data.code,'PRIVATE_MESSAGES_UNAVAILABLE');
  for(const target of [web,explicit]){
   assert.equal(target.service.capabilities.customNames,true);
   assert.equal(target.service.capabilities.social.privateMessages,true);
   assert.equal(target.call(a,'/api/mobile/profile',{name:'已开启昵称'},'PATCH').data.name,'已开启昵称');
   const {bc}=friends(target);
   assert.equal(target.social(a,'/messages',{kind:'text',peer:bc,text:'显式开放后的旧功能'}).status,200);
  }
  assert.equal(web.service.capabilities.energy,false);
  assert.equal(safeWeb.call(a,'/api/mobile/profile',{name:'被关闭'},'PATCH').data.code,'CUSTOM_NAMES_UNAVAILABLE');
 }finally{for(const target of [f,web,explicit,safeWeb])target.service.close();}
 assert.throws(()=>createMobileService({publicTestPolicy:{privateMessages:'true'}}),TypeError);
});

test('closing free text preserves saved names, history, friendship, reports, read markers and room invitations without replay bypass',()=>{
 const fixture=storedFixture();let f=setup({databasePath:fixture.databasePath,publicTestPolicy:{privateMessages:true,customNames:true}});
 try{
  const {ac,bc}=friends(f);
  f.call(a,'/api/mobile/profile',{name:'原有昵称'},'PATCH');
  const input={requestId:rid(),kind:'text',peer:bc,text:'原有历史消息'};
  const sent=f.social(a,'/messages',input);assert.equal(sent.status,200);
  f.service.close();f=setup({databasePath:fixture.databasePath});f.advance();
  assert.equal(f.call(a,'/api/mobile/profile').data.name,'原有昵称');
  assert.equal(f.social(a,'/messages',input).data.code,'PRIVATE_MESSAGES_UNAVAILABLE');
  const history=f.social(b,'/messages?peer='+ac);assert.equal(history.data.messages[0].text,'原有历史消息');
  assert.equal(f.social(b).data.friends[0].code,ac);
  assert.equal(f.social(b,'/messages/read',{peer:ac,through:sent.data.message.id}).data.unread,0);
  assert.equal(f.social(b,'/reports',{source:'private',messageId:sent.data.message.id,reason:'other'}).status,200);
  const created=f.call(a,'/api/rooms',{requestId:rid(),mode:'random',pieces:48,visibility:'private'});assert.equal(created.status,201);
  const roomId=created.data.room.id,token=created.data.token;
  const invite=f.social(a,'/messages',{peer:bc,kind:'room-invite',roomId,title:'ignored free text'},token);
  assert.equal(invite.status,200);assert.equal(invite.data.message.kind,'room-invite');assert.equal(invite.data.message.title,created.data.room.title);
  assert.equal(f.call(a,'/api/rooms/'+roomId+'/chat',{requestId:rid(),phraseId:0},'POST',token).data.message.text,CHAT_PHRASES[0]);
 }finally{f.service.close();fixture.cleanup();}
});

test('privacy applications are minimal, identity-bound, persistent and idempotent, with a separate random support verification code',()=>{
 const fixture=storedFixture();let f=setup({databasePath:fixture.databasePath});const db=new DatabaseSync(fixture.databasePath);
 try{
  assert.deepEqual(f.call(a,'/api/mobile/privacy-request').data.requests,[]);
  const input={requestId:rid(),type:'delete'},first=f.call(a,'/api/mobile/privacy-request',input);
  assert.equal(first.status,200);const task=first.data.request;
  assert.match(task.requestId,/^[a-f0-9]{32}$/);assert.notEqual(task.requestId,input.requestId);
  assert.match(task.verificationCode,/^[A-F0-9]{20}$/);assert.equal(task.status,'pending');
  assert.equal(f.call(a,'/api/mobile/privacy-request',input).data.request.requestId,task.requestId);
  assert.equal(f.call(a,'/api/mobile/privacy-request',{...input,type:'access'}).data.code,'REQUEST_CONFLICT');
  assert.equal(f.call(a,'/api/mobile/privacy-request',{...input,requestId:rid()}).data.request.requestId,task.requestId);
  assert.equal(f.call(a,'/api/mobile/privacy-request',{requestId:rid(),type:'access',owner:b}).data.code,'INVALID_PRIVACY_REQUEST');
  assert.equal(f.call(a,'/api/mobile/privacy-request',{requestId:rid(),type:'delete',email:'unnecessary@example.com'}).status,400);
  assert.equal(f.call(a,'/api/mobile/privacy-request',{requestId:rid(),type:'unknown'}).status,400);
  assert.equal(f.call(a,'/api/mobile/privacy-request',{type:'delete'}).data.code,'REQUEST_ID_REQUIRED');
  assert.equal(f.call('invalid','/api/mobile/privacy-request',input).status,401);
  assert.deepEqual(f.call(b,'/api/mobile/privacy-request').data.requests,[]);
  const other=f.call(b,'/api/mobile/privacy-request',input);assert.notEqual(other.data.request.requestId,task.requestId);
  assert.ok(!JSON.stringify(first.data).includes(a));
  assert.equal(readMobilePrivacyReview(db,{requestId:task.requestId,verificationCode:task.verificationCode}).owner,a);
  assert.equal(readMobilePrivacyReview(db,{requestId:task.requestId,verificationCode:'0'.repeat(20)}),null);
  assert.ok(db.prepare('SELECT 1 FROM mobile_profiles WHERE id=?').get(a)); // Request is not deletion.
  db.prepare("UPDATE mobile_privacy_requests SET status='in_review' WHERE request_id=?").run(task.requestId);
  f.service.close();f=setup({databasePath:fixture.databasePath});
  assert.equal(f.call(a,'/api/mobile/privacy-request',input).data.request.status,'in_review');
  assert.equal(f.call(a,'/api/mobile/privacy-request').data.requests.length,1);
  assert.equal(f.call(c,'/api/mobile/privacy-request').data.requests.length,0);
 }finally{db.close();f.service.close();fixture.cleanup();}
});

test('privacy rate limits bound new receipts while exact retries remain usable and pending requests coalesce',()=>{
 const fixture=storedFixture(),f=setup({databasePath:fixture.databasePath}),db=new DatabaseSync(fixture.databasePath);
 try{
  const input={requestId:rid(),type:'access'},first=f.call(a,'/api/mobile/privacy-request',input);
  for(let i=1;i<10;i++)assert.equal(f.call(a,'/api/mobile/privacy-request',{...input,requestId:rid()}).data.request.requestId,first.data.request.requestId);
  assert.equal(f.call(a,'/api/mobile/privacy-request',{...input,requestId:rid()}).data.code,'PRIVACY_REQUEST_RATE_LIMIT');
  assert.equal(f.call(a,'/api/mobile/privacy-request',input).status,200);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM mobile_privacy_requests').get().n,1);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM mobile_privacy_receipts').get().n,10);
  assert.equal(f.call(b,'/api/mobile/privacy-request',{requestId:rid(),type:'delete'}).status,200);
 }finally{db.close();f.service.close();fixture.cleanup();}
});

test('a persistence failure rolls back a new privacy task and its enclosing profile transaction',()=>{
 const fixture=storedFixture(),f=setup({databasePath:fixture.databasePath}),db=new DatabaseSync(fixture.databasePath);
 try{
  db.exec("CREATE TRIGGER reject_privacy_receipt BEFORE INSERT ON mobile_privacy_receipts BEGIN SELECT RAISE(ABORT,'test receipt storage failure'); END;");
  const input={requestId:rid(),type:'delete'};assert.equal(f.call(a,'/api/mobile/privacy-request',input).status,500);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM mobile_privacy_requests').get().n,0);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM mobile_profiles').get().n,0);
  db.exec('DROP TRIGGER reject_privacy_receipt');
  assert.equal(f.call(a,'/api/mobile/privacy-request',input).status,200);
 }finally{db.close();f.service.close();fixture.cleanup();}
});
