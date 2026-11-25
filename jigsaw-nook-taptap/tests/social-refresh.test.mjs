import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';

const built=await build({stdin:{contents:'export {SocialPanel} from "./mobile/social-panel";',resolveDir:process.cwd(),loader:'ts'},bundle:true,write:false,format:'esm',platform:'node',target:'es2020'});
const {SocialPanel}=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'));
const self={code:'123456789',name:'自己',level:1,online:true,lastSeenAt:1};
const peer={code:'987654321',name:'好友',level:2,online:true,lastSeenAt:1};
const message={id:1,kind:'text',text:'你好',from:peer.code,to:self.code,mine:false,sentAt:1};
const snapshot=()=>({self:{...self},friends:[{...peer}],requests:{incoming:[],outgoing:[]},conversations:[],blocked:[],unread:0,serverTime:1});
const conversation=()=>({peer:{...peer},messages:[],hasMore:false,unread:0,serverTime:1});
const ticks=async()=>{await new Promise(resolve=>setTimeout(resolve,0));await new Promise(resolve=>setTimeout(resolve,0));};
const deferred=()=>{let resolve;const promise=new Promise(done=>resolve=done);return {promise,resolve};};
function fixture({json,post}={}){
 let changes=0;const notes=[],calls=[];
 const client={config:{capabilities:{social:{privateMessages:true,privateMessageHistory:true,roomInvites:true}}},platform:{randomId:()=>String(calls.length)},json:async path=>{calls.push(path);return json?json(path):snapshot();},post:async(path,body)=>{calls.push(path);return post?post(path,body):{unread:0};}};
 const panel=new SocialPanel(client,{invalidate:()=>changes++,note:note=>notes.push(note),joinRoom:async()=>{},room:()=>null});
 return {panel,notes,calls,get changes(){return changes;},reset:()=>changes=0};
}

test('closed social refresh retains current snapshots and repaints only external state changes',async()=>{
 let state=snapshot();const f=fixture({json:()=>structuredClone(state)});await f.panel.refresh();f.reset();
 state={...state,serverTime:2,self:{...self,lastSeenAt:2},friends:[{...peer,name:'新名字',lastSeenAt:2}]};
 await f.panel.refresh();assert.equal(f.changes,0);assert.equal(f.panel.snapshot.serverTime,2);assert.equal(f.panel.snapshot.friends[0].name,'新名字');
 state.unread=2;await f.panel.refresh();assert.equal(f.changes,1);
 state.requests.incoming=[{...peer,createdAt:1}];await f.panel.refresh();assert.equal(f.changes,2);
 state={...state,unread:1,requests:{incoming:[{...peer,createdAt:1},{...peer,code:'111111111',createdAt:1}],outgoing:[]}};
 await f.panel.refresh();assert.equal(f.changes,3,'separate counts remain visible in profile and social tabs');
 state.self={...self,code:'222222222'};await f.panel.refresh();assert.equal(f.changes,4);
 state.blocked=[{...peer}];await f.panel.refresh();assert.equal(f.changes,5,'room chat filtering uses the blocked codes while closed');
 f.panel.destroy();
});

test('open social refresh ignores metadata timestamps and retains visible friend, request and message changes',async()=>{
 let state=snapshot();const f=fixture({json:()=>structuredClone(state)});f.panel.open();await f.panel.refresh();f.reset();
 state.serverTime++;state.self.lastSeenAt++;state.friends[0].lastSeenAt++;await f.panel.refresh();assert.equal(f.changes,0);
 state.friends[0].online=false;await f.panel.refresh();assert.equal(f.changes,1);
 state.friends[0].name='改名好友';await f.panel.refresh();assert.equal(f.changes,2);
 state.requests.incoming=[{...peer,createdAt:123}];await f.panel.refresh();assert.equal(f.changes,3);
 state.conversations=[{peer:{...peer},lastMessage:{...message},unread:0}];await f.panel.refresh();assert.equal(f.changes,4);
 state.serverTime++;state.conversations[0].peer.lastSeenAt++;await f.panel.refresh();assert.equal(f.changes,4);
 state.conversations[0].lastMessage.text='新的消息';await f.panel.refresh();assert.equal(f.changes,5);
 f.panel.destroy();
});

test('idle conversation polls do not repaint or scroll, but message and online changes do',async()=>{
 let thread=conversation();const f=fixture({json:path=>structuredClone(path.includes('/messages?')?thread:snapshot())});
 await f.panel.refresh();f.panel.openConversation(peer.code);await ticks();f.reset();f.panel.stickToBottom=false;
 thread.serverTime=2;thread.peer.lastSeenAt=2;await f.panel.refresh();assert.equal(f.changes,0);assert.equal(f.panel.thread.serverTime,2);assert.equal(f.panel.stickToBottom,false);
 thread.messages=[{...message}];await f.panel.refresh();assert.equal(f.changes,1);assert.equal(f.panel.thread.messages[0].text,message.text);
 f.panel.stickToBottom=false;await f.panel.refresh();assert.equal(f.changes,1);assert.equal(f.panel.stickToBottom,false);
 thread.peer.online=false;await f.panel.refresh();assert.equal(f.changes,2);
 f.panel.destroy();
});

test('conversation loading, failed retry and switching still reject late replies',async()=>{
 let fail=true;const first=deferred(),second=deferred();const other={...peer,code:'111111111',name:'另一位好友'};
 const f=fixture({json:path=>{if(!path.includes('/messages?'))return snapshot();if(fail)throw Error('连接失败');return path.includes(other.code)?second.promise:first.promise;}});
 f.panel.openConversation(peer.code);assert.equal(f.panel.loading,true);await ticks();assert.equal(f.panel.loading,false);assert.equal(f.panel.thread,null);assert.equal(f.notes.at(-1),'连接失败');
 fail=false;f.reset();f.panel.openConversation(peer.code);assert.equal(f.panel.loading,true);assert.ok(f.changes>0);
 f.panel.openConversation(other.code);first.resolve({...conversation(),messages:[message]});await ticks();assert.equal(f.panel.thread,null);assert.equal(f.panel.loading,true);
 second.resolve({...conversation(),peer:other});await ticks();assert.equal(f.panel.thread.peer.code,other.code);assert.equal(f.panel.loading,false);
 f.panel.destroy();
});

test('read receipts repaint unread badges after close and cannot alter a different account',async()=>{
 let state={...snapshot(),unread:2,conversations:[{peer,lastMessage:message,unread:2}]},thread={...conversation(),messages:[message],unread:0};
 let read=deferred();const f=fixture({json:path=>structuredClone(path.includes('/messages?')?thread:state),post:()=>read.promise});
 await f.panel.refresh();f.panel.openConversation(peer.code);await ticks();f.reset();
 thread.unread=2;const poll=f.panel.refresh();await ticks();f.panel.close();read.resolve({unread:0});await poll;
 assert.equal(f.panel.unread,0);assert.ok(f.changes>0,'completed read receipt updates the outer unread badge');
 state={...snapshot(),unread:2,conversations:[{peer,lastMessage:message,unread:2}]};await f.panel.refresh();read=deferred();f.panel.openConversation(peer.code);await ticks();
 state={...snapshot(),self:{...self,code:'222222222'},unread:9,conversations:[{peer,lastMessage:message,unread:9}]};
 f.panel.open('friends');await f.panel.refresh();f.reset();read.resolve({unread:0});await ticks();
 assert.equal(f.panel.playerCode,'222222222');assert.equal(f.panel.unread,9);assert.equal(f.changes,0,'old account receipt must not repaint or replace new unread state');
 f.panel.destroy();
});
