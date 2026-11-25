import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';
import {readFileSync} from 'node:fs';

// 11-06 player feedback: 「游戏内加好友为什么找不到在游戏里邀请的选项，每次还需要分享到微信才行」.
// The room's 「＋ 邀请」 window now lists game friends (room-invite messages, queued 3.2 s apart),
// and an invite received anywhere pops one banner with 加入 / 稍后.
const root=fileURLToPath(new URL('../',import.meta.url));
const bundle=await build({absWorkingDir:root,stdin:{contents:'export * from "./mobile/friend-invite"; export {GameApp} from "./mobile/app"; export {Stage} from "./mobile/ui";',resolveDir:root,loader:'ts'},bundle:true,write:false,format:'esm',platform:'node',target:'es2020'});
const {RoomInviteQueue,InviteSeenStore,pickIncomingInvite,inviteOrder,INVITE_GAP_MS,INVITE_SEEN_KEY,GameApp,Stage}=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));

function clock(){const c={t:1000,waits:[],now:()=>c.t,wait:async ms=>{c.waits.push(ms);c.t+=ms;}};return c;}
const settle=async()=>{for(let i=0;i<20;i++)await new Promise(resolve=>setImmediate(resolve));};
const room='a'.repeat(32);

test('invites go out one at a time, at least 3.2 s apart, and a friend is only queued once per room',async()=>{
 const c=clock(),sent=[];let id=0;
 const queue=new RoomInviteQueue({now:c.now,wait:c.wait,randomId:()=>'r'+(++id),send:async job=>{sent.push({...job,at:c.t});}});
 assert.equal(INVITE_GAP_MS>=3000,true);
 assert.equal(queue.enqueue(room,'111111111'),true);
 assert.equal(queue.enqueue(room,'222222222'),true);
 assert.equal(queue.enqueue(room,'333333333'),true);
 assert.equal(queue.enqueue(room,'222222222'),false,'already queued');
 await settle();
 assert.deepEqual(sent.map(job=>job.code),['111111111','222222222','333333333']);
 for(let i=1;i<sent.length;i++)assert.ok(sent[i].at-sent[i-1].at>=INVITE_GAP_MS,'gap '+i);
 assert.equal(queue.state(room,'222222222'),'sent');
 assert.equal(queue.enqueue(room,'222222222'),false,'already invited to this room');
 assert.equal(queue.enqueue('b'.repeat(32),'222222222'),true,'a new room can invite again');
 await settle();assert.equal(sent.length,4);assert.ok(sent[3].at-sent[2].at>=INVITE_GAP_MS);
});

test('a rate-limited invite is retried with the same request id; other errors fail the row and can be retried',async()=>{
 const c=clock(),attempts=[],failures=[];let id=0,limited=1;
 const queue=new RoomInviteQueue({now:c.now,wait:c.wait,randomId:()=>'r'+(++id),failed:(error,job)=>failures.push([error.message,job.code]),send:async job=>{attempts.push(job.requestId+':'+job.code);
  if(job.code==='111111111'&&limited-->0)throw Object.assign(Error('消息发送较快，请稍后'),{status:429,code:'MESSAGE_RATE_LIMIT'});
  if(job.code==='222222222')throw Object.assign(Error('请先添加对方为好友'),{status:403,code:'FRIEND_REQUIRED'});}});
 queue.enqueue(room,'111111111');queue.enqueue(room,'222222222');await settle();
 assert.deepEqual(attempts,['r1:111111111','r1:111111111','r2:222222222']);
 assert.equal(queue.state(room,'111111111'),'sent');
 assert.equal(queue.state(room,'222222222'),'failed');
 assert.deepEqual(failures,[['请先添加对方为好友','222222222']]);
 assert.equal(queue.enqueue(room,'222222222'),true,'重试 is allowed after a failure');
});

test('leaving a room drops its queued invites but not the one being sent',async()=>{
 const c=clock(),sent=[];let release;let id=0;
 const queue=new RoomInviteQueue({now:c.now,wait:c.wait,randomId:()=>'r'+(++id),send:job=>new Promise(resolve=>{sent.push(job.code);release=resolve;})});
 queue.enqueue(room,'111111111');queue.enqueue(room,'222222222');await settle();
 assert.deepEqual(sent,['111111111']);
 queue.cancel(room);assert.equal(queue.state(room,'222222222'),null);release();await settle();
 assert.deepEqual(sent,['111111111']);assert.equal(queue.state(room,'111111111'),'sent');assert.equal(queue.pending,0);
});

const self={code:'123456789',name:'我',level:3,online:true,lastSeenAt:1};
const peer=(code,name,online=true,lastSeenAt=1)=>({code,name,level:2,online,lastSeenAt});
const invite=(id,from,sentAt,extra={})=>({id,kind:'room-invite',roomId:'c'.repeat(32),title:'晚风小镇',pieces:108,visibility:'public',from,to:self.code,mine:false,sentAt,...extra});
function snapshot(conversations,serverTime=10_000_000,friends=[]){return {self,friends,requests:{incoming:[],outgoing:[]},conversations,blocked:[],unread:conversations.reduce((n,c)=>n+c.unread,0),serverTime};}

test('the banner picks the newest unread, unseen, recent invite that is not for the current room',()=>{
 const now=10_000_000,a=peer('111111111','小满'),b=peer('222222222','阿禾'),d=peer('333333333','旧友'),e=peer('444444444','同桌');
 const state=snapshot([
  {peer:a,lastMessage:invite(5,a.code,now-60_000),unread:1},
  {peer:b,lastMessage:invite(9,b.code,now-5_000,{roomId:'d'.repeat(32)}),unread:1},
  {peer:d,lastMessage:invite(12,d.code,now-31*60_000),unread:1},
  {peer:e,lastMessage:invite(13,e.code,now-1_000,{roomId:room}),unread:1},
  {peer:peer('555555555','已读'),lastMessage:invite(14,'555555555',now-1_000),unread:0},
  {peer:peer('666666666','文字'),lastMessage:{id:15,kind:'text',text:'在吗',from:'666666666',to:self.code,mine:false,sentAt:now},unread:1},
 ],now);
 assert.equal(pickIncomingInvite(state,new Set(),room).message.id,9,'13 is for the room the player is in; 12 is older than 30 min');
 assert.equal(pickIncomingInvite(state,new Set([9]),room).message.id,5);
 assert.equal(pickIncomingInvite(state,new Set([9,5]),room),null);
 assert.equal(pickIncomingInvite(state,new Set([9,5]),null).message.id,13,'outside that room it is a normal invite');
 assert.equal(pickIncomingInvite(snapshot([{peer:a,lastMessage:{...invite(20,self.code,now),mine:true},unread:0}],now),new Set(),null),null,'own invites never pop up');
});

test('seen invite ids survive a restart and stay bounded',()=>{
 const storage=new Map(),store={get:key=>storage.get(key)??null,set:(key,value)=>storage.set(key,value)};
 const first=new InviteSeenStore(store);first.add(7);first.add(7);first.add(8);
 const second=new InviteSeenStore(store);assert.equal(second.has(7),true);assert.equal(second.has(8),true);assert.equal(second.has(9),false);
 for(let id=100;id<300;id++)second.add(id);
 const ids=JSON.parse(storage.get(INVITE_SEEN_KEY));assert.equal(ids.length,100);assert.equal(ids.at(-1),299);assert.equal(new InviteSeenStore(store).has(7),false);
 assert.doesNotThrow(()=>new InviteSeenStore({get:()=>'{broken',set(){}}));
});

test('friends are listed online first, then by last seen',()=>{
 assert.deepEqual(inviteOrder([peer('1','离线早',false,10),peer('2','在线',true,5),peer('3','离线近',false,90),peer('4','在线近',true,50)]).map(f=>f.name),['在线近','在线','离线近','离线早']);
});

// ---- App level: the invite window and the banner, drawn with a real Stage.
const gradient={addColorStop(){}};
const proxy=()=>new Proxy({measureText:value=>({width:String(value).length*7}),isPointInPath:()=>true},{get:(target,key)=>target[key]??(()=>gradient),set:(target,key,value)=>(target[key]=value,true)});
function app({w=390,h=844,friends=[],members=[{code:self.code,name:'我'}],inRoom=true,visibility='public',platformId='taptap',history=true}={}){
 const storage=new Map([['jigsaw:room-guide:v1','done']]),viewport={width:w,height:h,top:0,bottom:0,dpr:1},ctx=proxy(),calls=[];let id=0;
 const platform={config:{id:platformId,apiBase:'/api',gameName:'拼图小窝'},createImage:()=>({}),createCanvas:()=>({width:1,height:1,getContext:()=>ctx}),canvas:{style:{},getContext:()=>ctx},viewport:()=>viewport,randomId:()=>'id'+(++id),storage:{get:key=>storage.get(key)??null,set:(key,value)=>storage.set(key,value)}};
 const state=snapshot([],10_000_000,friends);
 const client={config:{capabilities:{social:{friends:true,roomInvites:true,privateMessageHistory:history}}},profile:{code:self.code,collection:{},giftProgress:0,giftCount:0},asset:value=>value,
  json:async(path,method='GET',body,headers)=>{calls.push({path,method,body,headers});return path==='/api/mobile/social'?state:{};},post:async(path,body)=>{calls.push({path,method:'POST',body});return {};}};
 const stage=new Stage(platform,value=>value),game=new GameApp(platform,client,stage);
 globalThis.matchMedia=()=>({matches:false});
 const texts=[],text=stage.text.bind(stage);stage.text=(value,...rest)=>{texts.push(String(value));return text(value,...rest);};
 const buttons=[],button=stage.button.bind(stage);stage.button=(r,label,fn,opts={})=>{buttons.push({r:{...r},label,fn,opts});return button(r,label,fn,opts);};
 game.social.snapshot=state;
 Object.assign(game,{ready:true,privacyAccepted:true,route:inRoom?'room':'lobby'});
 if(inRoom)game.room={ticket:{room:{id:room},token:'f'.repeat(32),playerId:'p'},snapshot:{id:room,title:'春日花园',visibility,members},state:{cols:12,rows:9}};
 const frame=draw=>{buttons.length=0;texts.length=0;stage.begin?.();draw();return buttons.map(b=>({...b}));};
 return {game,stage,calls,storage,state,frame,buttons,texts,platform};
}

test('the room invite window starts with the game friends; 邀请 sends a room invite and the row turns 已邀请',async()=>{
 const t=app({friends:[peer('111111111','阿禾',false,5),peer('222222222','小满',true,9),peer('333333333','同桌的',true,9)],members:[{code:self.code,name:'我'},{code:'333333333',name:'同桌的'}]});
 t.game.modal='invite';
 let shown=t.frame(()=>t.game.drawModal());
 const labels=shown.map(b=>b.label);
 assert.ok(labels.includes('邀请'),'邀请 button');assert.ok(labels.includes('已在桌上'),'a tablemate is marked');assert.ok(labels.includes('邀请好友'),'sharing stays below');
 const invites=shown.filter(b=>b.label==='邀请');assert.equal(invites.length,2);
 assert.ok(invites[0].r.y<invites[1].r.y);
 const share=shown.find(b=>b.label==='邀请好友');assert.ok(share.r.y>invites[1].r.y,'share to WeChat/QQ is below the friend list');
 invites[0].fn();invites[1].fn();await settle();
 const sent=t.calls.filter(call=>call.path==='/api/mobile/social/messages');
 assert.equal(sent.length,1,'the second invite waits its 3.2 s turn');
 assert.deepEqual({peer:sent[0].body.peer,kind:sent[0].body.kind,roomId:sent[0].body.roomId},{peer:'222222222',kind:'room-invite',roomId:room},'online friend first');
 assert.equal(sent[0].headers.Authorization,'Bearer '+'f'.repeat(32));
 shown=t.frame(()=>t.game.drawModal());
 assert.ok(shown.some(b=>b.label==='已邀请'&&b.opts.disabled));assert.ok(shown.some(b=>b.label==='排队中'&&b.opts.disabled));
});

test('with no friends the window offers 按玩家 ID 添加 and recent tablemates; outside a room rows read 开一桌邀请',()=>{
 const t=app({friends:[]});t.game.recentPlayers=[{...peer('777777777','路人'),roomTitle:'海边',seenAt:1,requested:false}];t.game.modal='invite';
 let labels=t.frame(()=>t.game.drawModal()).map(b=>b.label);
 assert.ok(labels.includes('按玩家 ID 添加'));assert.ok(labels.includes('加好友'));
 const lobby=app({friends:[peer('222222222','小满')],inRoom:false});lobby.game.modal='invite';
 labels=lobby.frame(()=>lobby.game.drawModal()).map(b=>b.label);
 assert.ok(labels.includes('开一桌邀请'));
 const solo=app({friends:[peer('222222222','小满')],visibility:'solo'});solo.game.modal='invite';
 labels=solo.frame(()=>solo.game.drawModal()).map(b=>b.label);
 assert.equal(labels.includes('邀请'),false,'a solo story room keeps the old window');
});

test('an incoming invite shows one banner, once; 稍后 dismisses it for good and 加入 joins that room',async()=>{
 for(const [w,h] of [[390,844],[844,390]]){
  const t=app({w,h,inRoom:true}),now=Date.now(),from=peer('222222222','小满');
  const state=snapshot([{peer:from,lastMessage:invite(41,from.code,now-2000),unread:1}],now);
  t.game.socialSnapshot(state);
  let shown=t.frame(()=>t.game.drawInviteBanner());
  assert.deepEqual(shown.map(b=>b.label),['稍后','加入'],w+'x'+h);
  const join=shown.find(b=>b.label==='加入');assert.ok(join.r.x+join.r.w<=w-12&&join.r.y>=0,'on screen');
  shown.find(b=>b.label==='稍后').fn();
  t.game.socialSnapshot(state);assert.equal(t.frame(()=>t.game.drawInviteBanner()).length,0,'not shown again');
  assert.equal(new InviteSeenStore({get:key=>t.storage.get(key)??null,set(){}}).has(41),true,'remembered across restarts');
  // A second invite while one banner is open waits; it never stacks.
  const other=peer('333333333','阿禾');
  t.game.socialSnapshot(snapshot([{peer:other,lastMessage:invite(42,other.code,now-1000),unread:1}],now));
  t.frame(()=>t.game.drawInviteBanner());
  t.game.socialSnapshot(snapshot([{peer:from,lastMessage:invite(43,from.code,now),unread:1},{peer:other,lastMessage:invite(42,other.code,now-1000),unread:1}],now));
  shown=t.frame(()=>t.game.drawInviteBanner());assert.equal(shown.filter(b=>b.label==='加入').length,1);
  const entered=[];t.game.enterRoom=async(id,code)=>{entered.push([id,code]);};
  shown.find(b=>b.label==='加入').fn();await settle();
  assert.deepEqual(entered,[['c'.repeat(32),undefined]]);
  assert.ok(t.calls.some(call=>call.path==='/api/mobile/social/messages/read'&&call.body.through===42),'the invite is marked read');
  assert.equal(t.frame(()=>t.game.drawInviteBanner()).length,0);
 }
});

test('the room shows the friend badge on the member avatars and the chat window 好友 tab',()=>{
 for(const [w,h] of [[390,844],[844,390]]){
  const t=app({w,h});t.game.social.snapshot={...t.state,unread:2,requests:{incoming:[{...peer('9','申请'),createdAt:1}],outgoing:[]}};
  t.game.roomMembersArea={x:w-140,y:60,w:60,h:34};
  const hits=[],hit=t.stage.hit.bind(t.stage);t.stage.hit=(r,f)=>{hits.push({r:{...r},f});return hit(r,f);};
  t.frame(()=>t.game.drawRoomFriendBadge());
  assert.equal(hits.length,1);const badge=hits[0].r;assert.ok(badge.w>=30&&badge.h>=30,'thumb-sized hit');
  let opened=null;t.game.showModal=modal=>{opened=modal;};t.game.social.open=tab=>{opened+=':'+tab;};hits[0].f();
  assert.equal(opened,'social:messages');
 }
});

// WeChat 0.53.20: no free-text conversations; invites (fixed-format room cards) stay; sharing grants and advertises nothing.
test('WeChat keeps the friend invite list but its share section has no QQ, reward or invite-code copy',async()=>{
 const t=app({platformId:'wechat',history:false,friends:[peer('222222222','小满')]});t.game.modal='invite';
 const shown=t.frame(()=>t.game.drawModal()),labels=shown.map(b=>b.label),all=[...labels,...t.texts].join('|');
 assert.ok(labels.includes('邀请'),'in-game invite stays');assert.ok(labels.includes('分享给微信好友'));
 for(const banned of ['QQ','礼包','邀请码','奖励','TapTap'])assert.equal(all.includes(banned),false,banned+' in '+all);
 const lobby=app({platformId:'wechat',history:false,friends:[peer('222222222','小满')],inRoom:false});lobby.game.modal='invite';
 const lobbyText=[...lobby.frame(()=>lobby.game.drawModal()).map(b=>b.label),...lobby.texts].join('|');
 assert.ok(lobbyText.includes('开一桌邀请'));for(const banned of ['QQ','礼包','邀请码','奖励'])assert.equal(lobbyText.includes(banned),false,banned);
 // The WeChat share button opens WeChat sharing and never claims the share reward.
 t.platform.share=async()=>'opened';const claims=[];t.game.shareReward={pending:()=>null,claim:async()=>{claims.push(1);},complete:async()=>{claims.push(2);return null;}};
 await t.game.shareInvitation();assert.deepEqual(claims,[]);assert.equal(t.calls.some(call=>call.path.includes('/invitations/share')),false);
});

test('WeChat hides private conversations: no 私信, no unread count, invites still arrive as a banner',()=>{
 const t=app({platformId:'wechat',history:false,inRoom:false,friends:[peer('222222222','小满')]}),now=Date.now(),from=peer('222222222','小满');
 const state=snapshot([{peer:from,lastMessage:invite(51,from.code,now-1000),unread:3}],now,[from]);t.game.social.snapshot=state;
 assert.equal(t.game.social.unread,0,'nothing to read where conversations are hidden');
 t.game.route='friends';const labels=t.frame(()=>t.game.drawFriends()).map(b=>b.label);
 assert.equal(labels.includes('私信'),false);assert.equal(labels.includes('消息'),false);assert.ok(labels.includes('开一桌邀请TA'));
 t.game.socialSnapshot(state);assert.deepEqual(t.frame(()=>t.game.drawInviteBanner()).map(b=>b.label),['稍后','加入']);
 const source=readFileSync(new URL('../mobile/client.ts',import.meta.url),'utf8');
 assert.match(source,/\.\.\.\(wechat\?\{privateMessageHistory:false\}:\{\}\)/,'WeChat forces conversation history off');
});

// WeChat review treats share/invite rewards as 诱导分享: on WeChat no task asks for sharing or inviting, and no reward copy for it shows.
test('WeChat lists no share or invite reward tasks; TapTap keeps them',async()=>{
 const {TASK_REWARDS}=await import('../server/mobile-tasks.mjs');
 const serverTasks=[{id:'beginner-10',kind:'beginner-10',group:'beginner',title:'累计拼合10次',target:10,progress:0,earned:false,energy:0,xp:0,coins:10},...TASK_REWARDS.map(task=>({...task,kind:task.id,progress:0,earned:false})),
  {id:'share-invitation',kind:'share-invitation',group:'sharing',title:'分享邀请',target:6,progress:0,earned:false,energy:20,xp:10,coins:10},
  {id:'invite-friend',kind:'invite-refill',effect:'full-energy',group:'invitation',title:'邀请好友加入',target:3,progress:0,earned:false,energy:0,xp:0,coins:0}];
 const view={giftProgress:0,giftMaximum:5,giftCount:0,tasks:serverTasks,inventory:[],invitation:{code:'ABC123',bound:false,boundToName:null,requiredContributions:3,dailyLimit:3,capBonus:0,capBonusMaximum:5},serverTime:1};
 const draw=(id,energy)=>{
  const texts=[],labels=[],ctx=new Proxy({measureText:text=>({width:String(text).length*7})},{get:(target,key)=>key in target?target[key]:()=>gradient});
  const stage={w:390,h:844,ctx,palette:{ink:'#642238',muted:'#a17878',line:'#d4a399',rose:'#c8798c'},text:value=>texts.push(String(value)),icon(){},panel(){},frame(){},button:(_r,label)=>labels.push(String(label)),meter(){},hit(){},clip:(_r,fn)=>fn(),measure:text=>String(text).length*7,wrap:(value)=>{texts.push(String(value));return 18;},color:value=>value,segments(){}};
  const game=Object.create(GameApp.prototype);Object.assign(game,{stage,invalidate(){},client:{profile:{level:10,energy:20,energyCap:60,supply:{energy:0,create:0}},config:{capabilities:{energy,ads:false,albumTarget:'mobile-shared'}}},platform:{config:{id},viewport:()=>({top:0,bottom:0})},taskTab:'tasks',bodyTop:100,bodyBottom:10000,scroll:0,extent:0,busy:false});
  game.applyTasks(structuredClone(view));const groups=game.tasks.tasks.map(task=>task.group);
  for(const method of ['drawTasksPage','drawTasks'])game[method]();
  return {groups,all:[...texts,...labels].join('|')};
 };
 for(const energy of [true,false]){
  const wechat=draw('wechat',energy);
  assert.deepEqual([...new Set(wechat.groups)].sort(),['beginner','cooperation','friend']);
  for(const banned of ['分享邀请','邀请好友','邀请码','分享领','邀请礼包'])assert.equal(wechat.all.includes(banned),false,banned+' on WeChat');
  const taptap=draw('taptap',energy);
  assert.ok(taptap.groups.includes('sharing')&&taptap.groups.includes('invitation'));assert.ok(taptap.all.includes('分享邀请'),'TapTap unchanged');
 }
});
