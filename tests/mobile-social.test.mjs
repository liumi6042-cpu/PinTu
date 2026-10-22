import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomBytes} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync,mkdirSync,rmSync} from 'node:fs';
import {resolve} from 'node:path';
import {createMobileService,CHAT_PHRASES} from '../server/mobile-service.mjs';

const rid=()=>randomBytes(16).toString('hex');
const actor=name=>createHash('sha256').update(name).digest('hex');
function setup(options={}){
 let now=1800000000000;
 // These legacy social cases exercise the explicitly enabled full feature set.
 // Default public-test restrictions have their own service-control tests.
 const service=createMobileService({publicTestPolicy:{privateMessages:true,customNames:true},...options,now:()=>now,randomInt:min=>min});
 const call=(owner,path,body,authorization,method=body===undefined?'GET':'POST')=>service.handle({identity:owner,method,url:path,body:body===undefined?undefined:{requestId:rid(),...body},authorization:authorization?'Bearer '+authorization:undefined});
 const social=(owner,path='',body,token)=>call(owner,'/api/mobile/social'+path,body,token);
 return {service,call,social,advance:(milliseconds=3000)=>now+=milliseconds};
}
function connect(f,a,b){const ac=f.social(a).data.self.code,bc=f.social(b).data.self.code;assert.equal(f.social(a,'/requests',{code:bc}).status,200);assert.equal(f.social(b,'/requests/respond',{code:ac,accept:true}).status,200);return {ac,bc};}

test('public player codes are stable random IDs, additive migration persists them, and incoming requests are bilateral',()=>{
 mkdirSync(resolve('work'),{recursive:true});const dir=mkdtempSync(resolve('work/mobile-social-test-')),databasePath=resolve(dir,'social.sqlite');
 const a=actor('social-a'),b=actor('social-b');let f=setup({databasePath});
 try{
  const ac=f.social(a).data.self.code,bc=f.social(b).data.self.code;
  assert.match(ac,/^[1-9]\d{8}$/);assert.notEqual(ac,bc);assert.equal(f.call(a,'/api/mobile/profile').data.code,ac);
  const request={code:bc,requestId:rid()};assert.equal(f.social(a,'/requests',request).status,200);assert.equal(f.social(a,'/requests',request).status,200);
  assert.equal(f.social(a,'/requests',{code:bc}).status,200);assert.equal(f.social(b).data.requests.incoming.length,1);
  const c=actor('social-c');f.social(c);assert.equal(f.social(c,'/requests/respond',{code:ac,accept:true,identity:b,owner:b}).data.code,'REQUEST_NOT_FOUND');assert.equal(f.social(b).data.requests.incoming.length,1);
  assert.equal(f.social(a,'/requests/respond',{code:bc,accept:true}).data.code,'REQUEST_NOT_FOUND');
  assert.equal(f.social(b,'/requests/respond',{code:ac,accept:true}).data.friends[0].code,ac);
  assert.equal(f.social(a).data.friends[0].code,bc);
  assert.equal(f.social(b,'/requests/respond',{code:ac,accept:true}).status,200);
  assert.equal(f.social(a,'/search?code='+ac).data.relationship,'self');
  assert.equal(f.social(a,'/search?code='+bc).data.relationship,'friend');
  assert.equal(f.social(a,'/requests',{code:ac}).data.code,'SELF_NOT_ALLOWED');
  assert.equal(f.social(a,'/search?code=123').data.code,'INVALID_PLAYER_CODE');
  assert.equal(f.social(a,'/search?code=999999999').status,404);
  assert.ok(!JSON.stringify(f.social(a).data).includes(a));assert.ok(!JSON.stringify(f.social(a).data).includes(b));
  const concurrent=setup({databasePath});try{assert.equal(concurrent.social(a).data.self.code,ac);const dc=concurrent.social(actor('social-d')).data.self.code;assert.notEqual(dc,ac);assert.notEqual(dc,bc);assert.equal(f.social(actor('social-d')).data.self.code,dc);}finally{concurrent.service.close();}
  f.service.close();f=setup({databasePath});assert.equal(f.social(a).data.self.code,ac);assert.equal(f.social(a).data.friends[0].code,bc);
 }finally{f.service.close();rmSync(dir,{recursive:true,force:true});}
});

test('private messages require friendship, retain long Unicode text, rate limit, replay, unread and server read positions',()=>{
 const f=setup(),a=actor('private-a'),b=actor('private-b'),c=actor('private-c');
 try{
  const {ac,bc}=connect(f,a,b),cc=f.social(c).data.self.code;
  assert.equal(f.social(c,'/messages?peer='+ac).data.code,'FRIEND_REQUIRED');
  assert.equal(f.social(c,'/messages',{peer:ac,kind:'text',text:'冒充好友'}).data.code,'FRIEND_REQUIRED');
  const text='一起拼图🧩'.repeat(100),input={peer:bc,kind:'text',text,requestId:rid()};const sent=f.social(a,'/messages',input);
  assert.equal(sent.status,200);assert.equal(sent.data.message.text,text);assert.equal(sent.data.message.from,ac);assert.equal(sent.data.message.mine,true);
  assert.deepEqual(f.social(a,'/messages',input).data,sent.data);
  assert.equal(f.social(a,'/messages',{...input,text:'更改同编号'}).data.code,'REQUEST_CONFLICT');
  assert.equal(f.social(a,'/messages',{peer:bc,kind:'text',text:'太快'}).data.code,'MESSAGE_RATE_LIMIT');
  assert.equal(f.social(b).data.unread,1);assert.equal(f.social(b).data.conversations[0].unread,1);
  const received=f.social(b,'/messages?peer='+ac).data;assert.equal(received.messages[0].mine,false);assert.equal(received.unread,1);
  assert.equal(f.social(b,'/messages/read',{peer:ac,through:sent.data.message.id+10}).data.code,'INVALID_READ_CURSOR');
  assert.equal(f.social(b,'/messages/read',{peer:ac,through:sent.data.message.id}).data.unread,0);assert.equal(f.social(b).data.unread,0);
  f.advance();assert.equal(f.social(a,'/messages',{peer:bc,kind:'text',text:'傻 逼'}).data.code,'MESSAGE_BLOCKED');
  assert.equal(f.social(a,'/messages',{peer:bc,kind:'text',text:'🧩'.repeat(2001)}).data.code,'INVALID_MESSAGE');
  assert.equal(f.social(a,'/messages',{peer:bc,kind:'text',text:'\u0000'}).data.code,'INVALID_MESSAGE');
  assert.equal(f.social(a,'/messages',{peer:bc,kind:'text',text:'新消息',identity:c}).status,200);
  assert.equal(f.social(c).data.unread,0);
  assert.equal(f.social(a,'/messages?peer='+cc).data.code,'FRIEND_REQUIRED');
 }finally{f.service.close();}
});

test('blocking removes bilateral friendship and requests, prohibits both directions, and unblock needs a new request',()=>{
 const f=setup(),a=actor('block-a'),b=actor('block-b');
 try{
  const {ac,bc}=connect(f,a,b);assert.equal(f.social(a,'/messages',{peer:bc,kind:'text',text:'你好'}).status,200);
  assert.equal(f.social(b,'/block',{code:ac}).data.blocked[0].code,ac);
  assert.equal(f.social(a).data.friends.length,0);assert.equal(f.social(b).data.friends.length,0);assert.equal(f.social(b).data.unread,0);
  for(const [owner,peer] of [[a,bc],[b,ac]]){assert.equal(f.social(owner,'/messages?peer='+peer).data.code,'PLAYER_BLOCKED');assert.equal(f.social(owner,'/requests',{code:peer}).data.code,'PLAYER_BLOCKED');}
  assert.equal(f.social(b,'/unblock',{code:ac}).data.blocked.length,0);assert.equal(f.social(b).data.friends.length,0);
  f.advance();assert.equal(f.social(a,'/requests',{code:bc}).status,200);assert.equal(f.social(b,'/requests/respond',{code:ac,accept:true}).status,200);
  assert.equal(f.social(a,'/friends/remove',{code:bc}).data.friends.length,0);assert.equal(f.social(b).data.friends.length,0);
 }finally{f.service.close();}
});

test('room chat permits presets only, report evidence is server owned, and blocked chat cursor advances',()=>{
 mkdirSync(resolve('work'),{recursive:true});const dir=mkdtempSync(resolve('work/mobile-social-report-')),databasePath=resolve(dir,'reports.sqlite');
 const f=setup({databasePath}),a=actor('report-a'),b=actor('report-b'),c=actor('report-c');const fixture=new DatabaseSync(databasePath);
 try{
  const {ac,bc}=connect(f,a,b);f.social(c);const created=f.call(a,'/api/rooms',{mode:'random',pieces:48,visibility:'public'});assert.equal(created.status,201);
  const roomId=created.data.room.id,roomPath='/api/rooms/'+roomId,at=created.data.token,bt=f.call(b,roomPath+'/join',{}).data.token;
  assert.equal(created.data.room.members[0].code,ac);
  assert.equal(f.call(a,roomPath+'/chat',{text:'这是一条自定义短句'},at).data.code,'PRESET_CHAT_ONLY');
  assert.equal(f.call(a,roomPath+'/chat',{phraseId:0,text:'篡改短句'},at).data.code,'PRESET_CHAT_ONLY');
  const message=f.call(a,roomPath+'/chat',{phraseId:0},at).data.message;assert.equal(message.text,CHAT_PHRASES[0]);assert.equal(message.code,ac);
  const report={source:'room',messageId:message.id,roomId,reason:'harassment',text:'伪造消息',requestId:rid()};
  assert.equal(f.social(c,'/reports',report,at).data.code,'ROOM_IDENTITY_MISMATCH');
  assert.equal(f.social(b,'/reports',report).data.code,'ROOM_ADMISSION_REQUIRED');
  assert.equal(f.social(a,'/reports',report,at).data.code,'SELF_REPORT_NOT_ALLOWED');
  const result=f.social(b,'/reports',report,bt);assert.equal(result.status,200);assert.equal(result.data.duplicate,false);
  assert.deepEqual(f.social(b,'/reports',report,bt).data,result.data);
  assert.equal(f.social(b,'/reports',{...report,requestId:rid()},bt).data.duplicate,true);
  const evidence=JSON.parse(fixture.prepare('SELECT evidence FROM mobile_chat_reports WHERE id=?').get(result.data.reportId).evidence);assert.equal(evidence.text,CHAT_PHRASES[0]);assert.ok(!JSON.stringify(evidence).includes('伪造'));
  assert.equal(fixture.prepare('SELECT COUNT(*) n FROM mobile_chat_reports').get().n,1);
  assert.equal(f.social(b,'/reports',{...report,messageId:message.id+100,requestId:rid()},bt).data.code,'MESSAGE_NOT_FOUND');
  assert.equal(f.social(b,'/block',{code:ac}).status,200);const chat=f.call(b,roomPath+'/chat?after=0',undefined,bt);assert.equal(chat.data.messages.length,0);assert.equal(chat.data.cursor,message.id);
  // Reporting does not itself ban a sender; blocked public output is viewer-specific.
  assert.equal(f.call(a,roomPath+'/chat?after=0',undefined,at).data.messages.length,1);
  assert.equal(f.social(b,'/unblock',{code:ac}).status,200);f.advance();assert.equal(f.social(b,'/requests',{code:ac}).status,200);assert.equal(f.social(a,'/requests/respond',{code:bc,accept:true}).status,200);
  const dm=f.social(a,'/messages',{peer:bc,kind:'text',text:'私聊原文'}).data.message;
  assert.equal(f.social(c,'/reports',{source:'private',messageId:dm.id,reason:'other'}).data.code,'MESSAGE_NOT_FOUND');
  assert.equal(f.social(b,'/block',{code:ac}).status,200);assert.equal(f.social(b,'/messages?peer='+ac).data.code,'PLAYER_BLOCKED');
  const privateReport=f.social(b,'/reports',{source:'private',messageId:dm.id,reason:'other',text:'伪造'});assert.equal(privateReport.status,200);assert.equal(JSON.parse(fixture.prepare('SELECT evidence FROM mobile_chat_reports WHERE id=?').get(privateReport.data.reportId).evidence).text,'私聊原文');
 }finally{fixture.close();f.service.close();rmSync(dir,{recursive:true,force:true});}
});

test('private room invitation requires room admission and delivers only an authorized real room card',()=>{
 const f=setup(),a=actor('invite-a'),b=actor('invite-b'),c=actor('invite-c');
 try{
  const {bc}=connect(f,a,b);const created=f.call(a,'/api/rooms',{mode:'random',pieces:48,visibility:'private'});assert.equal(created.status,201);
  const roomId=created.data.room.id,token=created.data.token;
  assert.equal(f.social(a,'/messages',{peer:bc,kind:'room-invite',roomId}).data.code,'ROOM_ADMISSION_REQUIRED');
  const invited=f.social(a,'/messages',{peer:bc,kind:'room-invite',roomId,title:'伪造标题',inviteCode:'伪造邀请码'},token);
  assert.equal(invited.status,200);assert.equal(invited.data.message.title,created.data.room.title);assert.equal(invited.data.message.inviteCode,created.data.inviteCode);
  const admitted=f.call(b,'/api/rooms/'+roomId+'/join',{inviteCode:invited.data.message.inviteCode});assert.equal(admitted.status,200);
  assert.equal(f.call(c,'/api/rooms/'+roomId+'/join',{}).data.code,'INVITE_REQUIRED');
  assert.equal(f.social(a,'/friends/remove',{code:bc}).status,200);
  assert.equal(f.social(a,'/messages?peer='+bc).data.code,'FRIEND_REQUIRED');
  const ac=f.social(a).data.self.code;assert.equal(f.social(b,'/messages?peer='+ac).data.code,'FRIEND_REQUIRED');
  // Existing delivered invitation codes keep their room-protocol validity; friendship removal revokes conversation access.
  assert.equal(f.call(b,'/api/rooms/'+roomId+'/join',{inviteCode:invited.data.message.inviteCode}).status,200);
 }finally{f.service.close();}
});

test('failed searches count toward a durable identity rate limit and processed requests cannot reset request throttling',()=>{
 const f=setup(),a=actor('rate-a'),b=actor('rate-b'),c=actor('rate-c');
 try{
  const ac=f.social(a).data.self.code,bc=f.social(b).data.self.code,cc=f.social(c).data.self.code;
  for(let index=0;index<60;index++)assert.equal(f.social(a,'/search?code=0').data.code,'INVALID_PLAYER_CODE');
  assert.equal(f.social(a,'/search?code='+bc).data.code,'SEARCH_RATE_LIMIT');
  assert.equal(f.social(b,'/search?code='+ac).status,200);
  f.advance(60000);assert.equal(f.social(a,'/search?code='+bc).status,200);
  const request={code:bc,requestId:rid()};assert.equal(f.social(a,'/requests',request).status,200);
  assert.equal(f.social(b,'/requests/respond',{code:ac,accept:false}).status,200);
  assert.equal(f.social(a,'/requests',request).status,200); // Original successful request replay remains usable.
  assert.equal(f.social(a,'/requests',{code:cc}).data.code,'REQUEST_RATE_LIMIT');
  f.advance();assert.equal(f.social(a,'/requests',{code:cc}).status,200);
 }finally{f.service.close();}
});
