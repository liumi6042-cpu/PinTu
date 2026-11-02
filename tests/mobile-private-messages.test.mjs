import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync} from 'node:fs';
import {rm} from 'node:fs/promises';
import {resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {spawn} from 'node:child_process';
import {randomBytes} from 'node:crypto';

// The real gateway entry point (node server/h5-gateway.mjs) is what prod runs, so the 私信 switch is tested through it:
// MOBILE_PRIVATE_MESSAGES unset turns free-text messages on, MOBILE_PRIVATE_MESSAGES=false keeps the old refusal.
const ORIGIN='https://ma-h5-al.tapimg.com',rid=()=>randomBytes(16).toString('hex');
async function gateway(extraEnv={}){
 const stage=mkdtempSync(resolve(tmpdir(),'jigsaw-private-messages-'));
 const env={...process.env,H5_PORT:'0',H5_HOST:'127.0.0.1',H5_UPSTREAM:'http://127.0.0.1:1',H5_ALLOWED_ORIGINS:ORIGIN,H5_SESSION_DB:resolve(stage,'sessions.sqlite'),MOBILE_DB:resolve(stage,'mobile.sqlite'),MOBILE_DAILY_APPEARANCES:resolve(stage,'appearances'),H5_AD_ASSISTANCE_ENABLED:'false',...extraEnv};
 for(const name of ['MOBILE_DAILY_CONFIG','JIGSAW_CONTENT_DIR','MOBILE_GAME_SETTINGS_CONFIG','MOBILE_TASK_REWARDS_CONFIG','MOBILE_ALBUMS_CONFIG','MOBILE_RUNTIME_PROFILE',...(extraEnv.MOBILE_PRIVATE_MESSAGES===undefined?['MOBILE_PRIVATE_MESSAGES']:[])])delete env[name];
 const child=spawn(process.execPath,['server/h5-gateway.mjs'],{cwd:process.cwd(),env,windowsHide:true,stdio:['ignore','pipe','pipe']});let log='';
 const base=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('gateway startup timeout '+log)),30000);child.once('error',reject);child.once('exit',code=>{clearTimeout(timer);reject(Error('gateway exit '+code+' '+log));});child.stderr.on('data',bytes=>log+=bytes);child.stdout.on('data',bytes=>{log+=bytes;const match=/H5 preview: (http:\/\/127\.0\.0\.1:\d+)\//.exec(log);if(match){clearTimeout(timer);resolve(match[1]+'/h5');}});});
 const call=async(path,session,body,headers={})=>{const response=await fetch(base+path,{method:body?'POST':'GET',headers:{Origin:ORIGIN,'Content-Type':'application/json',...(session?{'X-Jigsaw-H5-Session':session}:{}),...headers},body:body?JSON.stringify(body):undefined});return {status:response.status,data:await response.json()};};
 const ok=async(...args)=>{const reply=await call(...args);assert.ok(reply.status>=200&&reply.status<300,args[0]+' '+reply.status+' '+JSON.stringify(reply.data));return reply.data;};
 const guest=async()=>{const token=(await ok('/session',null,{})).token;return {token,code:(await ok('/api/mobile/social',token)).self.code};};
 const befriend=async(a,b)=>{
  await ok('/api/mobile/social/requests',a.token,{code:b.code,requestId:rid()});
  const accepted=await ok('/api/mobile/social/requests/respond',b.token,{code:a.code,accept:true,requestId:rid()});
  assert.deepEqual(accepted.friends.map(player=>player.code),[a.code]);
 };
 const close=async()=>{if(child.exitCode===null&&child.signalCode===null)await new Promise(resolve=>{child.once('exit',resolve);child.kill();});await rm(stage,{recursive:true,force:true,maxRetries:5,retryDelay:200});};
 return {call,ok,guest,befriend,close};
}

test('the gateway turns on free-text 私信 between mutual friends by default, with the existing guards',async()=>{
 const g=await gateway();
 try{
  const config=await g.ok('/config');
  assert.equal(config.capabilities.social.privateMessages,true);
  assert.equal(config.capabilities.social.privateMessageHistory,true);
  assert.equal(config.capabilities.customNames,false,'custom names stay off on mobile');
  const a=await g.guest(),b=await g.guest(),c=await g.guest();
  await g.befriend(a,b);
  const requestId=rid(),input={kind:'text',peer:b.code,text:'  一起拼图吗？今晚八点  ',requestId};
  const sent=await g.ok('/api/mobile/social/messages',a.token,input);
  assert.equal(sent.message.kind,'text');assert.equal(sent.message.text,'一起拼图吗？今晚八点');
  assert.equal(sent.message.from,a.code);assert.equal(sent.message.to,b.code);assert.equal(sent.message.mine,true);
  // A replayed request returns the same message without sending it twice.
  assert.deepEqual((await g.ok('/api/mobile/social/messages',a.token,input)).message,sent.message);
  // The other side reads it, with an unread count until it is marked read.
  const inbox=await g.ok('/api/mobile/social',b.token);
  assert.equal(inbox.unread,1);assert.equal(inbox.conversations.length,1);
  assert.equal(inbox.conversations[0].peer.code,a.code);assert.equal(inbox.conversations[0].lastMessage.text,'一起拼图吗？今晚八点');assert.equal(inbox.conversations[0].lastMessage.mine,false);
  const thread=await g.ok('/api/mobile/social/messages?peer='+a.code,b.token);
  assert.equal(thread.unread,1);assert.equal(thread.hasMore,false);
  assert.deepEqual(thread.messages.map(message=>[message.id,message.kind,message.text,message.from,message.mine]),[[sent.message.id,'text','一起拼图吗？今晚八点',a.code,false]]);
  const read=await g.ok('/api/mobile/social/messages/read',b.token,{peer:a.code,requestId:rid()});
  assert.equal(read.unread,0);assert.equal((await g.ok('/api/mobile/social',b.token)).unread,0);
  // A second message inside 3 s is refused; a blocked word is refused before that.
  const fast=await g.call('/api/mobile/social/messages',a.token,{kind:'text',peer:b.code,text:'第二条',requestId:rid()});
  assert.equal(fast.status,429);assert.equal(fast.data.code,'MESSAGE_RATE_LIMIT');
  const rude=await g.call('/api/mobile/social/messages',b.token,{kind:'text',peer:a.code,text:'你 是 傻 逼',requestId:rid()});
  assert.equal(rude.status,400);assert.equal(rude.data.code,'MESSAGE_BLOCKED');
  const empty=await g.call('/api/mobile/social/messages',b.token,{kind:'text',peer:a.code,text:'   ',requestId:rid()});
  assert.equal(empty.status,400);assert.equal(empty.data.code,'INVALID_MESSAGE');
  // Not friends: the existing refusal, both for sending and for reading.
  const stranger=await g.call('/api/mobile/social/messages',c.token,{kind:'text',peer:a.code,text:'你好',requestId:rid()});
  assert.equal(stranger.status,403);assert.equal(stranger.data.code,'FRIEND_REQUIRED');
  assert.equal((await g.call('/api/mobile/social/messages?peer='+a.code,c.token)).data.code,'FRIEND_REQUIRED');
  // B's reply arrives on A's side; blocking ends the conversation for both.
  const reply=await g.ok('/api/mobile/social/messages',b.token,{kind:'text',peer:a.code,text:'好呀，八点见',requestId:rid()});
  assert.deepEqual((await g.ok('/api/mobile/social/messages?peer='+b.code,a.token)).messages.map(message=>[message.text,message.mine]),[['一起拼图吗？今晚八点',true],['好呀，八点见',false]]);
  assert.equal((await g.ok('/api/mobile/social',a.token)).unread,1);
  await g.ok('/api/mobile/social/block',a.token,{code:b.code,requestId:rid()});
  const blocked=await g.call('/api/mobile/social/messages',b.token,{kind:'text',peer:a.code,text:'还在吗',requestId:rid()});
  assert.equal(blocked.status,403);assert.equal(blocked.data.code,'PLAYER_BLOCKED');
  assert.ok(reply.message.id>sent.message.id);
 }finally{await g.close();}
});

test('MOBILE_PRIVATE_MESSAGES=false keeps the old refusal for text while history and room invites still work',async()=>{
 const g=await gateway({MOBILE_PRIVATE_MESSAGES:'false'});
 try{
  const config=await g.ok('/config');
  assert.equal(config.capabilities.social.privateMessages,false);
  assert.equal(config.capabilities.social.privateMessageHistory,true);
  assert.equal(config.capabilities.social.roomInvites,true);
  assert.equal(config.capabilities.customNames,false);
  const a=await g.guest(),b=await g.guest();
  await g.befriend(a,b);
  const text=await g.call('/api/mobile/social/messages',a.token,{kind:'text',peer:b.code,text:'你好',requestId:rid()});
  assert.equal(text.status,403);assert.equal(text.data.code,'PRIVATE_MESSAGES_UNAVAILABLE');
  assert.equal(text.data.error,'公开测试暂不开放自由文本私信，请使用房间邀请或预设短句');
  const ticket=await g.ok('/api/rooms',a.token,{mode:'random',pieces:48,visibility:'public',requestId:rid()});
  const invite=await g.ok('/api/mobile/social/messages',a.token,{kind:'room-invite',peer:b.code,roomId:ticket.room.id,requestId:rid()},{Authorization:'Bearer '+ticket.token});
  assert.equal(invite.message.kind,'room-invite');assert.equal(invite.message.roomId,ticket.room.id);
  const thread=await g.ok('/api/mobile/social/messages?peer='+a.code,b.token);
  assert.deepEqual(thread.messages.map(message=>[message.kind,message.roomId]),[['room-invite',ticket.room.id]]);
  assert.equal(thread.unread,1);
 }finally{await g.close();}
});
