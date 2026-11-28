import type {Rect} from '../ports';
import type {MobileOwnedRoom} from '../../h5/mobile-api';
import type {CollectionPack} from '../../h5/mobile-collection-api';
import collectionCatalog from '../../lib/mobile-collection-catalog.json';
import {inviteOrder} from '../friend-invite';
import {streakBadge,streakHint} from '../retention';
import {type AppHost,type RoomListing,type SharedPhoto,clamp,orientation,photoMap,seatLimit} from './shared';

export function drawInviteBannerPanel(this:AppHost){
  if(!this.inviteBanner&&this.incomingInvite&&this.inviteBannerAllowed){const next=this.incomingInvite;this.incomingInvite=null;if(!this.inviteSeen.has(next.message.id)&&next.message.roomId!==this.room?.ticket.room.id){this.inviteSeen.add(next.message.id);this.inviteBanner={...next,until:Date.now()+60000};}}
  const banner=this.inviteBanner;if(!banner)return;if(Date.now()>banner.until){this.inviteBanner=null;return;}if(!this.inviteBannerAllowed)return;
  const s=this.stage,view=this.platform.viewport(),w=Math.min(s.w-24,400),h=62,x=(s.w-w)/2,top=Math.max(view.top+10,this.platform.config.id==='taptap'?44:0)+(this.busy?34:0),y=Math.max(top,this.noticeBottom?this.noticeBottom+6:0),r={x,y,w,h};
  s.panel(r,'gold');s.hit(r,()=>{});const joinW=58,laterW=52,joinX=x+w-10-joinW,laterX=joinX-6-laterW,tx=x+46,tw=Math.max(40,laterX-8-tx);
  s.icon('invite',{x:x+10,y:y+16,w:28,h:28});s.text(banner.peer.name+' 邀请你一起拼',tx,y+11,13,this.colors.ink,800,tw);
  s.text('「'+(banner.message.title??'一起拼图')+'」',tx,y+33,12,this.colors.muted,600,tw);
  s.button({x:laterX,y:y+15,w:laterW,h:32},'稍后',()=>{this.inviteBanner=null;this.invalidate();},{fontSize:12});
  s.button({x:joinX,y:y+15,w:joinW,h:32},'加入',()=>void this.joinInvite(banner),{tone:'berry',fontSize:12,disabled:this.busy});
 }

export function drawInviteFriendsPanel(this:AppHost,left:number,cy:number,width:number){
  const s=this.stage,ink=this.colors.ink,muted=this.colors.muted,data=this.social.state,room=this.socialRoom();
  s.text('邀请游戏好友',left,cy,16,ink,800,width);cy+=26;
  cy=this.paragraph(room?'好友会在游戏里收到邀请，点一下就能加入':'开一桌后自动邀请好友，不用分享',left,cy,width,12)+10;
  if(!data){s.text('正在读取好友…',left,cy+4,13,muted,600,width);return cy+36;}
  const friends=inviteOrder(data.friends),members=new Set((room?.members??[]).map(member=>member.code).filter(Boolean));
  if(!friends.length){
   s.text('还没有游戏好友',left,cy+2,14,ink,700,width);cy+=28;
   s.button({x:left,y:cy,w:width,h:38},'按玩家 ID 添加',()=>{this.showModal('social');this.social.startSearch();},{tone:'berry',icon:'plus',fontSize:13});cy+=50;
   const recent=this.recentPlayers.slice(0,5);
   if(recent.length){s.text('最近同桌',left,cy,13,muted,700);cy+=24;
    for(const peer of recent){s.icon('avatar',{x:left,y:cy,w:30,h:34});s.text(peer.name,left+40,cy+1,14,ink,800,width-130);s.text('一起拼过「'+peer.roomTitle+'」',left+40,cy+20,11,muted,600,width-130);s.button({x:left+width-74,y:cy+2,w:74,h:30},peer.requested?'已申请':'加好友',()=>void this.requestFriend(peer.code),{fontSize:12,disabled:peer.requested||this.busy});cy+=46;}}
   return cy+4;
  }
  for(const friend of friends){
   const r={x:left,y:cy,w:width,h:54},bw=86;s.frame(r,'button-linen-normal');s.icon('avatar',{x:left+8,y:cy+9,w:32,h:36});
   if(friend.online){s.ctx.fillStyle=s.color('#879864');s.ctx.fillRect(left+34,cy+38,7,7);}
   const status=members.has(friend.code)?'在这桌':friend.online?friend.room?'正在拼「'+friend.room.title+'」':'在线':friend.lastSeenAt?this.ago(friend.lastSeenAt)+'在线':'离线';
   s.text(friend.name,left+50,cy+8,14,ink,800,width-bw-64);s.text(status,left+50,cy+29,11,friend.online?ink:muted,600,width-bw-64);
   const b={x:left+width-bw-8,y:cy+11,w:bw,h:32};
   if(!room)s.button(b,'开一桌邀请',()=>this.startTableInvite(friend),{tone:'berry',fontSize:12,disabled:this.busy});
   else if(members.has(friend.code))s.button(b,'已在桌上',()=>{},{fontSize:12,disabled:true});
   else{const state=this.inviteQueue.state(room.id,friend.code),label=state==='queued'?'排队中':state==='sending'?'发送中':state==='sent'?'已邀请':state==='failed'?'重试':'邀请';
    s.button(b,label,()=>this.inviteFriend(friend),{tone:state==='sent'?'cream':'berry',icon:state?undefined:'invite',fontSize:12,disabled:state==='queued'||state==='sending'||state==='sent'});}
   cy+=60;
  }
  s.text('＋ 添加更多好友',left,cy+4,12,this.colors.berry,700);s.hit({x:left-4,y:cy-4,w:130,h:30},()=>{this.showModal('social');this.social.startSearch();});
  return cy+34;
 }

export function drawFriendsPanel(this:AppHost){
  const s=this.stage,data=this.social.state,desktop=this.desktop,pad=12,w=s.w-24,ink=this.colors.ink,muted=this.colors.muted,sideW=desktop?Math.min(340,w*.36):w,listW=desktop?w-sideW-16:w;
  const friends=data?.friends??[],incoming=data?.requests.incoming??[],outgoing=data?.requests.outgoing??[],conversations=data?.conversations??[],messages=this.client.config?.capabilities?.social?.privateMessages===true||this.client.config?.capabilities?.social?.privateMessageHistory===true;
  let y=this.bodyTop-this.scroll,side=desktop?this.bodyTop-this.scroll:0;
  const row=(r:Rect)=>{s.frame(r,'button-linen-normal');};
  this.scrolled(()=>{
   const tabs:[typeof this.friendsTab,string][]=[['friends','好友 '+friends.length],...(messages?[['messages','消息'] as [typeof this.friendsTab,string]]:[]),['requests','好友申请']];
   y=this.drawChips(pad,y,Math.min(listW,360),34,tabs.map(([id,label])=>[label,this.friendsTab===id,()=>{this.friendsTab=id;this.scroll=0;this.invalidate();}] as const));
   const unread=this.social.unread,requests=incoming.length,tw=Math.min(listW,360);if(requests){const x=pad+tw-18;s.frame({x,y:y-42,w:20,h:18},'segment-berry-selected');s.text(String(Math.min(99,requests)),x+5,y-40,11,this.colors.onAccent,700);}
   if(unread&&messages){const x=pad+tw/3*2-18;s.frame({x,y:y-42,w:20,h:18},'segment-berry-selected');s.text(String(Math.min(99,unread)),x+5,y-40,11,this.colors.onAccent,700);}
   y+=14;
   if(!data){s.text('正在读取好友…',pad+8,y+12,14,muted);y+=60;}
   else if(this.friendsTab==='friends'){
    if(!friends.length){s.icon('friendArt',{x:pad+(listW-70)/2,y,w:70,h:66});const t='认识一位拼友吧';s.text(t,pad+(listW-s.measure(t,16,800))/2,y+76,16,ink,800);const h='按玩家 ID 添加，或在最近同桌里加好友';s.text(h,pad+(listW-s.measure(h,12,600))/2,y+102,12,muted,600,listW);y+=136;}
    for(const friend of friends){const r={x:pad,y,w:listW,h:72};row(r);s.icon('avatar',{x:pad+10,y:y+12,w:44,h:48});s.text(friend.name,pad+64,y+12,15,ink,800,listW-260);s.text('Lv.'+friend.level,pad+64+Math.min(listW-260,s.measure(friend.name,15,800))+8,y+15,12,muted,700);
     const room=friend.room,status=friend.online?room?'正在拼「'+room.title+'」'+(typeof room.players==='number'?' · '+room.players+'/'+seatLimit(room):''):'在大厅':friend.lastSeenAt?this.ago(friend.lastSeenAt)+'在线':'很久没上线';if(friend.online){s.ctx.fillStyle=s.color('#879864');s.ctx.fillRect(pad+50,y+52,8,8);}
     s.text(status,pad+64,y+38,12,friend.online?ink:muted,600,listW-260);let bx=messages?pad+listW-82:pad+listW;if(messages)s.button({x:bx,y:y+19,w:72,h:34},'私信',()=>this.openConversation(friend.code),{fontSize:13});
     if(friend.online&&room&&room.visibility!=='private'){bx-=104;s.button({x:bx,y:y+19,w:96,h:34},'加入这桌',()=>void this.enterRoom(room.id),{tone:'berry',fontSize:13,disabled:this.busy});}else if(friend.online&&this.roomInvitesEnabled){bx-=104;s.button({x:bx,y:y+19,w:96,h:34},'开一桌邀请TA',()=>this.startTableInvite(friend),{tone:'berry',fontSize:12,disabled:this.busy});}
     y+=80;}
   }else if(this.friendsTab==='messages'){
    if(!conversations.length){s.text('还没有私聊，点好友的“私信”开始',pad+8,y+12,14,muted,600,listW);y+=50;}
    for(const item of conversations){const r={x:pad,y,w:listW,h:66};row(r);s.icon('avatar',{x:pad+10,y:y+10,w:40,h:44});s.text(item.peer.name,pad+60,y+10,15,ink,800,listW-150);const last=item.lastMessage,text=last.kind==='room-invite'?'邀请你一起拼「'+(last.title??'拼图')+'」':last.text??'';s.text((last.mine?'我：':'')+text,pad+60,y+36,12,muted,600,listW-150);s.text(this.ago(last.sentAt),pad+listW-80,y+12,11,muted,600,70);
     if(item.unread){s.frame({x:pad+listW-36,y:y+34,w:22,h:18},'segment-berry-selected');s.text(String(Math.min(99,item.unread)),pad+listW-30,y+36,11,this.colors.onAccent,700);}s.hit(r,()=>this.openConversation(item.peer.code));y+=74;}
   }else{
    if(!incoming.length&&!outgoing.length){s.text('没有待处理的好友申请',pad+8,y+12,14,muted,600,listW);y+=50;}
    for(const peer of incoming){const r={x:pad,y,w:listW,h:66};row(r);s.icon('avatar',{x:pad+10,y:y+10,w:40,h:44});s.text(peer.name,pad+60,y+10,15,ink,800,listW-240);s.text('Lv.'+peer.level+' · 想加你为好友',pad+60,y+36,12,muted,600,listW-240);
     s.button({x:pad+listW-166,y:y+16,w:76,h:34},'接受',()=>void this.respondFriend(peer.code,true),{tone:'berry',fontSize:13,disabled:this.busy});s.button({x:pad+listW-84,y:y+16,w:74,h:34},'忽略',()=>void this.respondFriend(peer.code,false),{fontSize:13,disabled:this.busy});y+=74;}
    for(const peer of outgoing){const r={x:pad,y,w:listW,h:58};row(r);s.icon('avatar',{x:pad+10,y:y+8,w:36,h:40});s.text(peer.name,pad+56,y+10,14,ink,800,listW-150);s.text('已发送申请，等待对方确认',pad+56,y+32,12,muted,600,listW-150);y+=66;}
   }
   // 加好友 and 最近同桌: a right column on desktop, below the list on phones.
   const sx=desktop?pad+listW+16:pad;let sy=desktop?side:y+8;
   const add={x:sx,y:sy,w:sideW,h:128};s.panel(add);s.text('加好友',sx+16,sy+14,16,ink,800);s.button({x:sx+16,y:sy+42,w:sideW-32,h:38},'按玩家 ID 添加',()=>{this.showModal('social');this.social.startSearch();},{tone:'berry',icon:'plus',fontSize:14});
   const code=data?.self.code??this.client.profile?.code??'';s.text('我的 ID '+(code||'…'),sx+16,sy+94,13,muted,700,sideW-110);if(code&&this.platform.copyText){s.button({x:sx+sideW-80,y:sy+86,w:64,h:30},'复制',()=>void this.platform.copyText!(code).then(ok=>this.note(ok?'已复制玩家 ID':'复制失败')),{fontSize:12});}
   sy+=140;const recent=this.recentPlayers,rh=50+Math.max(1,recent.length)*58;s.panel({x:sx,y:sy,w:sideW,h:rh});s.text('最近同桌',sx+16,sy+14,16,ink,800);let ry=sy+46;
   if(!recent.length){s.text('一起拼过的人会出现在这里',sx+16,ry+4,12,muted,600,sideW-32);}
   for(const peer of recent){s.icon('avatar',{x:sx+14,y:ry,w:34,h:38});s.text(peer.name,sx+56,ry+2,14,ink,800,sideW-150);s.text('一起拼过「'+peer.roomTitle+'」· '+this.ago(peer.seenAt),sx+56,ry+22,11,muted,600,sideW-150);s.button({x:sx+sideW-88,y:ry+4,w:74,h:32},peer.requested?'已申请':'加好友',()=>void this.requestFriend(peer.code),{fontSize:12,disabled:peer.requested||this.busy});ry+=58;}
   sy+=rh+12;if(!desktop)y=sy;else side=sy;
  });
  this.extent=Math.max(y,desktop?side:0)+this.scroll-this.bodyTop+12;
 }

export function drawLoadingPanel(this:AppHost){
  const s=this.stage,now=Date.now(),v=this.platform.viewport(),ink=this.colors.ink,muted=this.colors.muted;if(!this.loadingStarted)this.loadingStarted=now;
  // Quick to ~70%, then a slow creep toward 99% so a long login never looks frozen; 100% only once start-up is done.
  const elapsed=(now-this.loadingStarted)/1000,creep=.7*(1-Math.exp(-elapsed/1.4))+.29*(1-Math.exp(-elapsed/25)),target=this.client.profile?Math.max(creep,.97*(1-Math.exp(-elapsed/1.4))):creep,finish=this.loadingDone?Math.min(1,(now-this.loadingDone)/220):0;
  const progress=this.loadingDone?this.loadingFrom+(1-this.loadingFrom)*(1-(1-finish)**2):Math.max(this.loadingShown,target);this.loadingShown=progress;
  const glow=s.ctx.createRadialGradient(s.w/2,s.h*.42,0,s.w/2,s.h*.42,Math.max(s.w,s.h)*.7);glow.addColorStop(0,this.colors.cream);glow.addColorStop(1,this.colors.paper);s.ctx.fillStyle=glow;s.ctx.fillRect(0,0,s.w,s.h);
  const cx=s.w/2,size=Math.min(112,s.w*.26,s.h*.2),top=Math.max(v.top+16,s.h*.42-size-60);
  s.icon('piece',{x:cx-size/2,y:top,w:size,h:size});
  const name=this.platform.config.gameName||'拼图小窝',nameSize=Math.min(34,s.w/9);s.text(name,cx-s.measure(name,nameSize,800)/2,top+size+18,nameSize,ink,800);
  const slogan='和朋友一起拼拼拼';s.text(slogan,cx-s.measure(slogan,15,600)/2,top+size+nameSize+30,15,muted,600);
  const barW=Math.min(320,s.w-64),barY=top+size+nameSize+76;s.meter({x:cx-barW/2,y:barY,w:barW,h:10},progress);const percent=Math.round(progress*100)+'%';s.text(percent,cx-s.measure(percent,13,700)/2,barY+18,13,ink,700);
  const tips=['先把边缘拼好，框架出来就快多了','双指缩放，拖空白处可以移动桌面','拼完的图会自动收进图集','公开房免费，叫上朋友一起拼','卡住的时候，试试提示和底图','每天都有一张新的每日拼图','集齐一个图包，有金币和装饰'],tip=tips[Math.floor(elapsed/3)%tips.length];
  s.text(tip,cx-Math.min(s.w-32,s.measure(tip,13,600))/2,Math.min(s.h-v.bottom-40,barY+64),13,muted,600,s.w-32);
  setTimeout(()=>{if(!this.destroyed)this.invalidate();},this.loadingDone?16:120);
 }

export function drawLobbyStartupPanel(this:AppHost){
  const s=this.stage,left=12,width=Math.min(1120,s.w-24),x=(s.w-width)/2,y=this.bodyTop+8;
  s.icon('piece',{x,y,w:28,h:28});s.text('拼图大厅',x+36,y+2,23,this.colors.ink,800,width-42);
  if(this.startupError||this.client.authRequired){
   const w=Math.min(440,width),cx=x+(width-w)/2,cy=y+60;this.extent=250;
   const by=this.paragraph(this.client.authRequired?'登录网站账号，即可继续使用已有进度与收藏。':this.startupError,cx+left,cy,w-24,15)+20;
   const offline=!!this.offline.catalog&&!this.formalWeb,retry=()=>void this.start();if(offline)s.button({x:cx+12,y:by,w:w-24,h:40},'离线拼图',()=>this.enterOffline(),{tone:'berry'});s.button({x:cx+12,y:by+(offline?50:0),w:w-24,h:40},'重新连接',retry,{tone:offline?'cream':'berry'});
   if(this.formalWeb){s.button({x:cx+12,y:by+50,w:w-24,h:38},'登录 / 注册',()=>this.openWeb('account'));this.drawWebLinks(cx+12,by+108,w-24);}else{let next=by+(offline?104:54);if(this.platform.config.tapAuthorizationTest){s.button({x:cx+12,y:next,w:w-24,h:40},this.authorizationTesting?'取消昵称授权测试':'重新走昵称授权',()=>void this.reauthorizeNickname(),{disabled:this.busy&&!this.authorizationTesting});next+=54;next=this.paragraph(this.platform.tapIdentityDiagnostics?.()??'昵称授权自测',cx+12,next,w-24,11)+20;}if(this.platform.config.buildVersion)s.text('版本 '+this.platform.config.buildVersion,cx+12,next,11,this.colors.muted,500,w-24);}return;
  }
  s.text('正在读取房间与玩家信息…',x,y+43,13,this.colors.muted,500,width);
  const columns=this.desktop?Math.max(3,Math.min(4,Math.floor(width/240))):s.w>=640?3:2,gap=12,cw=(width-gap*(columns-1))/columns,h=Math.min(205,cw*.72+48),top=y+79;
  for(let index=0;index<columns;index++){const cx=x+index*(cw+gap);s.panel({x:cx,y:top,w:cw,h});s.ctx.fillStyle=this.colors.line;s.ctx.globalAlpha=.22;s.ctx.fillRect(cx+10,top+10,cw-20,h-55);s.ctx.fillRect(cx+12,top+h-31,cw*.58,8);s.ctx.fillRect(cx+12,top+h-16,cw*.35,5);s.ctx.globalAlpha=1;}
  this.extent=top+h-this.bodyTop+18;
 }

export function drawTuanziLobbyCardPanel(this:AppHost,r:Rect,compact:boolean){
  const s=this.stage,sum=this.tuanziV2?.summary??{collected:0,total:50,developed:0,unread:0,isAway:false,loaded:false};
  const ink=this.colors.ink,muted=this.colors.muted,bw=compact?74:86,bh=compact?32:36;
  s.frame(r,'panel-gold');
  const iconSize=compact?34:42;
  s.icon('book',{x:r.x+10,y:r.y+(r.h-iconSize)/2,w:iconSize,h:iconSize});
  if(sum.unread>0){
   const dot=String(Math.min(99,sum.unread)),dw=Math.max(16,s.measure(dot,10,700)+8);
   s.frame({x:r.x+10+iconSize-dw+4,y:r.y+(r.h-iconSize)/2-4,w:dw,h:16},'segment-berry-selected');
   s.text(dot,r.x+10+iconSize-dw+4+(dw-s.measure(dot,10,700))/2,r.y+(r.h-iconSize)/2-2,10,this.colors.onAccent,700);
  }
  const tx=r.x+18+iconSize,tw=Math.max(60,r.w-tx+r.x-bw-14);
  const title=compact?'团子的小窝 · 华夏行记':'团子的小窝 · 华夏行记 50 城';
  const sub=sum.unread>0
   ?`有 ${sum.unread} 封新来信 · 华夏集 ${sum.collected}/${sum.total} 城`
   :`已集齐 ${sum.collected}/${sum.total} 城 · 显影解锁图库多人建房`;
  s.text(title,tx,r.y+(compact?10:13),compact?13:15,ink,800,tw);
  s.text(sub,tx,r.y+(compact?30:37),compact?11:12,muted,600,tw);
  s.button({x:r.x+r.w-bw-10,y:r.y+(r.h-bh)/2,w:bw,h:bh},'进小窝',()=>this.openTuanziV2(),{tone:'berry',fontSize:compact?12:13});
  s.hit(r,()=>this.openTuanziV2());
}

export function drawLobbyPanel(this:AppHost){
  const s=this.stage,layout=this.layout,gap=layout==='phoneLandscape'?10:14,top=this.bodyTop,bottom=this.bodyBottom,width=Math.min(1400,s.w-24),left=(s.w-width)/2;
  const showTuanzi=this.tuanziV2?.available===true;
  if(layout==='phonePortrait'){
   // One scrolling column: hero, Tuanzi nook card, last room, actions, then the public rooms.
   let y=top-this.scroll;const columns=width>=520?3:2;
   this.scrolled(()=>{
    const heroH=Math.min(s.h*.45,this.heroTextHeight(false)+Math.min(width*.52,220)+16);y=this.drawDailyHero({x:left,y,w:width,h:heroH},false)+gap;
    if(showTuanzi){drawTuanziLobbyCardPanel.call(this,{x:left,y,w:width,h:68},false);y+=68+gap;}
    const last=this.continueRoom;if(last){this.drawContinueRoom(last,{x:left,y,w:width,h:72});y+=72+gap;}
    this.drawLobbyActions({x:left,y,w:width,h:46});y+=46+gap+4;
    y=this.drawRoomSection(left,y,width,columns,top,bottom);
   },top,bottom);
   this.extent=y+this.scroll-top+12;return;
  }
  // Desktop and phone landscape: a fixed left column and a room list that scrolls by itself.
  const landscape=layout==='phoneLandscape',leftW=landscape?Math.min(300,width*.42):Math.min(380,width*.36),rightX=left+leftW+gap+6,rightW=left+width-rightX;
  let y=top;const last=this.continueRoom,actionH=landscape?38:46,continueH=landscape?52:76,tuanziH=showTuanzi?(landscape?54:68):0,rest=(tuanziH?tuanziH+gap:0)+(last?continueH+gap:0)+actionH+gap,heroH=Math.max(this.heroTextHeight(landscape)+16,Math.min(landscape?bottom-top-rest:430,bottom-top-rest));
  y=this.drawDailyHero({x:left,y,w:leftW,h:heroH},landscape)+gap;
  if(showTuanzi){drawTuanziLobbyCardPanel.call(this,{x:left,y,w:leftW,h:tuanziH},landscape);y+=tuanziH+gap;}
  if(last){this.drawContinueRoom(last,{x:left,y,w:leftW,h:continueH});y+=continueH+gap;}
  this.drawLobbyActions({x:left,y,w:leftW,h:actionH});
  const header=this.drawRoomHeader(rightX,top,rightW,landscape),columns=landscape?3:rightW>=900?4:3;
  this.bodyTop=header;this.listColumn={x:this.contentOrigin.x+rightX-6,w:rightW+12};
  let end=header;this.scrolled(()=>{end=this.drawRoomGrid(rightX,header-this.scroll+4,rightW,columns,header,bottom);},header,bottom);
  this.extent=end+this.scroll-header+12;
 }

export function drawDailyHeroPanel(this:AppHost,r:Rect,compact:boolean){
  const s=this.stage,photo=this.dailyPhoto,ink=this.colors.ink,textH=this.heroTextHeight(compact),imageH=Math.max(0,r.h-textH-8),hasImage=imageH>=(compact?24:40),busy=this.busy||!this.client.profile;
  s.frame(r,'panel-cream');
  if(hasImage){const art={x:r.x+8,y:r.y+8,w:r.w-16,h:imageH};if(photo)s.image(this.client.asset(photo.src||photo.thumbSrc),art,'cover');else{s.ctx.fillStyle=this.colors.placeholder;s.ctx.fillRect(art.x,art.y,art.w,art.h);}s.hit(art,()=>{if(!busy)this.launchDaily();});}
  // 每日拼图连续天数: a gold tag on the picture (or in the label row when the card has no picture).
  const streak=this.dailyStreak,badge=streak?streakBadge(streak.count):'',hint=badge&&!compact?streakHint(streak):null;
  // Top-right corner: the one-time settings tip points at the avatar on the left.
  if(badge&&hasImage){const bw=s.measure(badge,12,800)+22,bx=r.x+r.w-14-bw,by=r.y+14;s.frame({x:bx,y:by,w:bw,h:26},'panel-gold');s.text(badge,bx+11,by+7,12,ink,800,bw-14);
   if(hint&&imageH>=64){const hw=s.measure(hint,11,600)+18,hx=r.x+r.w-14-hw;s.frame({x:hx,y:by+30,w:hw,h:24},'button-cream-normal');s.text(hint,hx+9,by+36,11,this.colors.muted,600,hw-12);}}
  let y=r.y+(hasImage?imageH+8:0)+(compact?8:10);const x=r.x+14,w=r.w-28,left=this.dailyLeft,leftW=s.measure(left,11,600);
  const finished=this.dailyFinished?' · 今天已有 '+this.dailyFinished+' 人拼完':'';s.text(this.dailyLabel+(badge&&!hasImage?' · '+badge:'')+finished,x,y,11,this.colors.muted,700,w-leftW-10);s.text(left,x+w-leftW,y,11,this.colors.muted,600);y+=compact?16:18;
  const title=photo?.title??'正在读取今日拼图…',size=compact?15:22;s.text(title,x,y,size,ink,800,w);y+=size+(compact?6:8);
  const description=(photo as {description?:unknown}|null)?.description;if(!compact&&typeof description==='string'&&description){s.text(description,x,y,12,this.colors.muted,500,w);y+=20;}
  const bh=compact?34:40,primary=Math.round(w*.58);
  s.button({x,y,w:primary,h:bh},'开始拼 · 108 片',()=>this.launchDaily(),{tone:'berrydark',icon:'daily',fontSize:compact?12:14,disabled:busy});
  s.button({x:x+primary+8,y,w:w-primary-8,h:bh},'叫上朋友',()=>void this.inviteToDaily(),{icon:'invite',fontSize:compact?12:14,disabled:busy});
  s.ornaments(r,compact?14:18);
  return r.y+r.h;
 }

export function drawContinueRoomPanel(this:AppHost,room:MobileOwnedRoom,r:Rect){
  const s=this.stage,slim=r.h<70,thumb=room.thumbSrc??(room.imageId?photoMap.get(room.imageId)?.thumbSrc:undefined),total=room.actualPieces??room.pieces??0,percent=clamp(Math.round((room.placed??0)/Math.max(1,total)*100),0,100),bw=slim?82:96;
  s.frame(r,'button-linen-normal');const th=r.h-12,tw=Math.round(th*1.25);
  if(thumb)s.image(this.client.asset(thumb),{x:r.x+6,y:r.y+6,w:tw,h:th});else{s.ctx.fillStyle=this.colors.placeholder;s.ctx.fillRect(r.x+6,r.y+6,tw,th);}
  const x=r.x+tw+14,w=r.w-tw-bw-30;
  s.text('继续上次',x,r.y+(slim?7:9),10,this.colors.muted,700);s.text(room.title??'一起拼图',x+50,r.y+(slim?6:8),slim?12:14,this.colors.ink,800,w-50);
  s.text((total||'—')+' 片'+(room.players?' · 同桌 '+room.players+' 人':''),x,r.y+(slim?23:30),11,this.colors.muted,500,w);
  s.meter({x,y:r.y+r.h-(slim?13:19),w:Math.max(20,w-34),h:slim?6:8},percent/100);s.text(percent+'%',x+w-30,r.y+r.h-(slim?16:23),10,this.colors.ink,800,32);
  s.button({x:r.x+r.w-bw-8,y:r.y+(r.h-(slim?32:36))/2,w:bw,h:slim?32:36},'回到这桌',()=>{if(!this.busy)void this.enterRoom(room.id);},{tone:'berry',fontSize:slim?11:13});
 }

export function drawLobbyActionsPanel(this:AppHost,r:Rect){
  const half=(r.w-10)/2,font=r.h<42?13:15,icon=r.h<42?17:21;
  this.drawPictureButton({x:r.x,y:r.y,w:half,h:r.h},'历史记录',()=>this.showModal('history'),'cream','piece',font,icon);
  this.drawPictureButton({x:r.x+half+10,y:r.y,w:half,h:r.h},'开一桌',()=>this.navigate('gallery'),'berry','create',font,icon);
 }

export function drawRoomHeaderPanel(this:AppHost,x:number,y:number,_w:number,compact:boolean){
  const s=this.stage,count=this.lobbyRooms.length,label=(this.lobbyCursor?count+'+':String(count))+' 桌在拼',size=compact?16:20;
  s.text('公开房间',x,y+2,size,this.colors.ink,800);s.text(label,x+s.measure('公开房间',size,800)+10,y+(compact?5:8),12,this.colors.muted,600);
  return y+(compact?28:34);
 }

export function drawChipsPanel(this:AppHost,x:number,y:number,w:number,h:number,chips:readonly(readonly[string,boolean,()=>void])[],fill=false){
  const s=this.stage,font=12,chipGap=6,natural=chips.map(([label])=>s.measure(label,font,700)+(w<360?14:22));
  const avail=Math.max(0,w-chipGap*(chips.length-1)),total=natural.reduce((a,b)=>a+b,0);
  const scale=total>0?Math.min(1,avail/total):1,extra=fill&&total<avail?(avail-total)/Math.max(1,chips.length):0;
  let cx=x;chips.forEach(([label,selected,action],index)=>{const last=index===chips.length-1,cw=fill&&last?Math.max(24,Math.round(x+w-cx)):Math.floor(natural[index]*scale+extra),r={x:cx,y,w:cw,h};s.frame(r,selected?'segment-berry-selected':'button-linen-normal');s.text(label,cx+(cw-s.measure(label,font,700))/2,y+(h-font)/2-1,font,selected?this.colors.onAccent:this.colors.ink,700,cw-4);s.hit(r,action);cx+=cw+chipGap;});
  return y+h;
 }

export function drawRoomGridPanel(this:AppHost,x:number,y:number,w:number,columns:number,top:number,bottom:number){
  const s=this.stage,rooms=this.lobbyRooms,completed=this.completedPhotoIds?.(),gap=w>=600?14:10,cw=(w-gap*(columns-1))/columns,imageHeight=(cw-12)/1.12,ch=imageHeight+76;
  if(!rooms.length){
   if(this.lobbyBusy){s.text('正在寻找拼图桌面…',x+(w-s.measure('正在寻找拼图桌面…',15,700))/2,y+30,15,this.colors.muted,700);return y+80;}
   if(this.rooms.length||this.lobbyPieces!=='all'||this.direction!=='all'||this.filterCount||this.lobbyUnplayedOnly){
    const message=this.lobbyUnplayedOnly&&this.rooms.length?'当前列表里的图你都拼过啦':'没有符合条件的房间，换个筛选试试';
    s.text(message,x+(w-s.measure(message,14,700))/2,y+26,14,this.colors.muted,700,w);
    let endY=y+60;
    if(this.lobbyCursor){this.button(x+12,endY,w-24,this.lobbyBusy?'加载中…':'加载更多房间',()=>void this.loadLobby(true),'cream',38,this.lobbyBusy);endY+=48;}
    else if(this.lobbyUnplayedOnly){this.button(x+12,endY,w-24,'查看全部房间',()=>this.changeListView(()=>{this.lobbyUnplayedOnly=false;}),'cream',38);endY+=48;}
    return endY+12;
   }
   const r={x,y,w,h:Math.min(260,w*.7+60)},bw=Math.min(170,(w-46)/2),art=Math.min(84,r.h*.32);s.panel(r);
   s.icon('friendArt',{x:x+(w-art)/2,y:y+16,w:art,h:art});let cy=y+art+28;
   const title='还没有公开房，来开第一桌吧';s.text(title,x+(w-s.measure(title,16,800))/2,cy,16,this.colors.ink,800,w-24);cy+=28;
   const hint='开好后别人能在这里看到并加入；也可以把邀请发给朋友',hw=Math.min(w-32,s.measure(hint,12,500));cy+=this.stage.wrap(hint,x+(w-hw)/2,cy,hw+2,12,this.colors.muted,18)+8;
   const bx=x+(w-bw*2-12)/2,by=Math.min(cy,r.y+r.h-50);s.button({x:bx,y:by,w:bw,h:38},'随机开一桌',()=>void this.launch({mode:'random',pieces:this.pieces,visibility:'public',direction:this.direction}),{tone:'berrydark',icon:'dice',fontSize:13,disabled:this.busy||!this.client.profile});s.button({x:bx+bw+12,y:by,w:bw,h:38},'邀请朋友',()=>this.showModal('invite'),{icon:'invite',fontSize:13});
   return y+r.h+12;
  }
  rooms.forEach((room,index)=>{const cx=x+(index%columns)*(cw+gap),cy=y+Math.floor(index/columns)*(ch+gap);if(cy+ch<top||cy>bottom)return;this.drawRoomCard(room,{x:cx,y:cy,w:cw,h:ch},completed);});
  let end=y+Math.ceil(rooms.length/columns)*(ch+gap);
  if(this.lobbyCursor){this.button(x+12,end,w-24,this.lobbyBusy?'加载中…':'加载更多',()=>void this.loadLobby(true),'cream',38,this.lobbyBusy);end+=50;}
  return end;
 }

export function drawRoomCardPanel(this:AppHost,room:RoomListing,r:Rect,completed?:Set<string>){
  const s=this.stage,{x,y:cy,w:cw,h:ch}=r,narrow=cw<170,photo=room.photo??photoMap.get(room.imageId),thumb=room.thumbSrc??photo?.thumbSrc,total=room.actualPieces??room.pieces,percent=clamp(Math.round(room.placed/Math.max(1,total)*100),0,100),art={x:x+6,y:cy+6,w:cw-12,h:ch-82};
  const done=!!room.imageId&&(completed??this.completedPhotoIds?.())?.has(room.imageId)===true;
  const tuanziOrigin=room.tuanziOrigin??photo?.tuanziOrigin;
  s.frame(r,'button-linen-normal');s.ctx.fillStyle=this.colors.cream;s.ctx.fillRect(x+6,cy+6,cw-12,ch-12);if(thumb)s.image(this.client.asset(thumb),art);
  if(tuanziOrigin){const badge='团子明信片',bw=Math.ceil(s.measure(badge,10,800))+12,bh=18,bx=art.x+5,by=art.y+5;s.ctx.fillStyle='rgba(198,118,38,0.92)';s.ctx.fillRect(bx,by,bw,bh);s.text(badge,bx+6,by+3,10,'#fffaf0',800);}
  if(done){const badge='已拼',bw=Math.ceil(s.measure(badge,10,800))+12,bh=18,bx=art.x+art.w-bw-5,by=art.y+5;s.ctx.fillStyle='rgba(89,122,80,0.9)';s.ctx.fillRect(bx,by,bw,bh);s.text(badge,bx+6,by+3,10,'#fffaf0',800);}
  const copyY=art.y+art.h+7;s.text(room.title,x+11,copyY,narrow?14:16,this.colors.ink,800,cw-22);const metaY=copyY+23;s.icon('piece',{x:x+11,y:metaY,w:14,h:16});s.text(total+'片',x+28,metaY+2,12,this.colors.ink,600);
  const seats=room.players+'/'+seatLimit(room),seatsW=s.measure(seats,12,700),stack=Math.min(3,room.players),stackX=x+cw-11-seatsW-4-(stack?14+stack*10:0);
  for(let i=0;i<stack;i++){const member=room.members?.[i];s.icon('avatar',{x:stackX+i*10,y:metaY-2,w:18,h:20});if(member?.decoration)s.decoration(member.decoration,{x:stackX+i*10+10,y:metaY-6,w:10,h:11});}s.text(seats,x+cw-11-seatsW,metaY+2,12,this.colors.ink,700);
  s.meter({x:x+11,y:cy+ch-16,w:cw-52,h:8},percent/100);s.text(percent+'%',x+cw-11-s.measure(percent+'%',10,800),cy+ch-19,10,this.colors.ink,800);
  if(room.players>=seatLimit(room)||room.acceptingNew===false){s.ctx.fillStyle='#6f374edb';s.ctx.fillRect(art.x,art.y+art.h-23,art.w,23);s.text(room.players>=seatLimit(room)?'已满员':'暂停加入',art.x+8,art.y+art.h-18,11,'#fff9f0',700);}
  s.hit(r,()=>{if(room.players>=seatLimit(room))this.note('房间已满，请选择其他房间');else if(room.acceptingNew===false||room.completed)this.note('房间暂不接受加入');else void this.enterRoom(room.id);});
 }

export function drawGalleryPanel(this:AppHost){
  const s=this.stage,layout=this.layout,portrait=layout==='phonePortrait',landscape=layout==='phoneLandscape',width=Math.min(1400,s.w-24),left=(s.w-width)/2,owned=new Set([...(this.client.profile?.collection?.ownedImageIds??[]),...(this.tuanziGalleryIds??[])]);
  const pack=this.packId?(this.collection?.packs.find(p=>p.id===this.packId)??collectionCatalog.packs.find(p=>p.id===this.packId)):null;
  const panelW=portrait?0:landscape?260:340,gridW=width-(panelW?panelW+14:0);let y=this.bodyTop;
  const completed=this.completedPhotoIds();
  const extraCount=(this.direction!=='all'?1:0)+(this.category!=='全部'?1:0)+(this.search?1:0);
  const filterLabel=extraCount?'筛选·'+extraCount:'筛选';
  const view=(change:()=>void)=>this.changeListView(()=>{change();this.packId=null;this.selected=null;});
  const chips:[string,boolean,()=>void][]=[
   ['全部',this.source==='all',()=>view(()=>{this.source='all';})],
   ['免费',this.source==='free',()=>view(()=>{this.source=this.source==='free'?'all':'free';})],
   ['我的图包',this.source==='owned',()=>view(()=>{this.source=this.source==='owned'?'all':'owned';})],
   [this.unplayedOnly?'✓ 未拼过':'未拼过',this.unplayedOnly,()=>this.changeListView(()=>{this.unplayedOnly=!this.unplayedOnly;if(this.unplayedOnly&&this.selected&&completed.has(this.selected))this.selected=null;})],
   [filterLabel,extraCount>0,()=>this.showModal('filters')]];
  y=this.drawChips(left,y,gridW,portrait||landscape?30:34,chips,true)+10;
  if(pack){s.icon('book',{x:left+2,y,w:23,h:25});s.text(pack.title,left+30,y+5,13,this.colors.ink,700,gridW-130);s.text('查看所有图片',left+gridW-90,y+6,12,this.colors.muted,600);s.hit({x:left+gridW-98,y,w:98,h:30},()=>this.changeListView(()=>{this.packId=null;this.selected=null;}));y+=34;}
  const photos=this.availableGallery().filter(photo=>(this.direction==='all'||orientation(photo.id)===this.direction)&&(this.category==='全部'||this.category===photo.category)&&photo.title.includes(this.search)&&(!pack||pack.imageIds.includes(photo.id))&&(this.source==='all'||this.source==='free'&&(!!this.freeGalleryIds?.has(photo.id)||!!this.tuanziGalleryIds?.has(photo.id))||this.source==='owned'&&owned.has(photo.id))&&(!this.unplayedOnly||!completed.has(photo.id)));
  const selected=this.selected?photoMap.get(this.selected)??null:null,sheetH=portrait&&selected?this.createPanelHeight(true):0,v=this.platform.viewport(),bottom=s.h-v.bottom-12-(sheetH?sheetH+4:0);
  const columns=portrait?(gridW>=520?3:2):landscape?3:Math.max(2,Math.min(5,Math.floor(gridW/235))),gap=landscape?8:portrait?10:14,cw=(gridW-gap*(columns-1))/columns,imageHeight=(cw-12)/1.38,ch=imageHeight+(cw<170?56:60);
  this.bodyTop=y;this.bodyBottom=bottom;this.listColumn={x:this.contentOrigin.x+left-6,w:gridW+12};this.extent=Math.ceil(photos.length/columns)*(ch+gap)+12;
  this.scrolled(()=>{
   photos.forEach((photo,index)=>{const x=left+(index%columns)*(cw+gap),cy=y+Math.floor(index/columns)*(ch+gap)-this.scroll;if(cy+ch<y||cy>bottom)return;this.drawPhotoCard(photo,{x,y:cy,w:cw,h:ch},imageHeight,owned,completed);});
   if(!photos.length){const needPacks=this.source==='owned'&&!owned.size,message=needPacks?'收藏一个喜欢的图包':this.unplayedOnly?'这里的图片你都拼过啦':'换个条件试试';s.icon(needPacks?'book':'underlay',{x:left+gridW/2-26,y:y+20,w:52,h:52});s.text(message,left+(gridW-s.measure(message,17,800))/2,y+85,17,this.colors.ink,800);this.drawPictureButton({x:left+gridW/2-85,y:y+122,w:170,h:38},needPacks?'前往收藏':'查看全部图片',()=>{if(needPacks)this.navigate('collection');else view(()=>{this.direction='all';this.category='全部';this.search='';this.source='all';this.unplayedOnly=false;});},'cream','book',13,17);this.extent=190;}
  },y,bottom);
  if(panelW){const top=this.bodyTop-(pack?34:0)-40;this.drawCreatePanel({x:left+width-panelW,y:Math.max(12,top),w:panelW,h:s.h-v.bottom-12-Math.max(12,top)},selected,owned,false);}
  else if(selected)this.drawCreatePanel({x:left-2,y:s.h-v.bottom-sheetH-4,w:width+4,h:sheetH},selected,owned,true);
 }

export function drawPhotoCardPanel(this:AppHost,photo:SharedPhoto,r:Rect,imageHeight:number,owned:Set<string>,completed?:Set<string>){
  const s=this.stage,selected=this.selected===photo.id,art={x:r.x+6,y:r.y+6,w:r.w-12,h:imageHeight},tag=this.photoTag(photo.id,owned),small=r.w<170;
  const done=(completed??this.completedPhotoIds?.())?.has(photo.id)===true;
  s.frame(r,selected?'panel-gold':'button-linen-normal');s.ctx.fillStyle=selected?s.color('#fff3e7'):this.colors.cream;s.ctx.fillRect(r.x+6,r.y+6,r.w-12,r.h-12);s.image(this.client.asset(photo.thumbSrc),art);
  if(selected){s.frame({x:art.x+5,y:art.y+5,w:27,h:27},'segment-berry-selected');s.icon('check',{x:art.x+10,y:art.y+10,w:17,h:17},'#fff9ed');}
  if(done){const badge='已拼',bw=Math.ceil(s.measure(badge,10,800))+12,bh=18,bx=art.x+art.w-bw-5,by=art.y+5;s.ctx.fillStyle='rgba(89,122,80,0.9)';s.ctx.fillRect(bx,by,bw,bh);s.text(badge,bx+6,by+3,10,'#fffaf0',800);}
  const ty=art.y+art.h+7;s.text(photo.title,r.x+10,ty,small?14:15,this.colors.ink,800,r.w-20);
  const tagY=ty+(small?21:23);
  if(tag.tone==='locked'&&'ad' in tag){s.icon('lock',{x:r.x+9,y:tagY,w:13,h:14},this.colors.berry);s.text(tag.label,r.x+25,tagY+1,12,this.colors.berry,700,r.w-35);}
  else if(tag.tone==='locked'){s.icon('lock',{x:r.x+9,y:tagY,w:13,h:14},this.colors.muted);const price=String(tag.price)+' 金币',pw=s.measure(price,12,700);s.text(tag.label,r.x+25,tagY+1,12,this.colors.muted,600,r.w-pw-46);s.icon('coin',{x:r.x+r.w-pw-27,y:tagY,w:14,h:15});s.text(price,r.x+r.w-pw-10,tagY+1,12,this.colors.ink,700);}
  else{const tw=s.measure(tag.label,12,700)+12;s.ctx.fillStyle=s.color(tag.tone==='tuanzi'?'#c67626':tag.tone==='owned'?'#cc8996':'#f2d5ad');s.ctx.fillRect(r.x+10,tagY-1,tw,18);s.text(tag.label,r.x+16,tagY+1,12,tag.tone==='tuanzi'||tag.tone==='owned'?'#fff8ec':'#674625',700);}
  s.hit(r,()=>{this.selected=photo.id;this.invalidate();});
 }

export function drawCreatePanelView(this:AppHost,r:Rect,photo:SharedPhoto|null,owned:Set<string>,sheet:boolean){
  const s=this.stage,p=this.client.profile,ink=this.colors.ink,x=r.x+14,w=r.w-28,compact=r.w<300;
  s.frame(r,'panel-cream');s.hit(r,()=>{});let y=r.y+14;
  // Creation rules are unchanged: owned public rooms are free, otherwise the first choice or a ticket.
  const freeOwned=!!this.selected&&owned.has(this.selected)&&this.visibility==='public',freeFirst=!!p?.firstSelectionAvailable,available=(p?.supply.create??0)>0,roomCount=this.ownedRoomCount;
  const lockedPack=!this.formalWeb&&photo&&this.photoTag(photo.id,owned).tone==='locked'?this.galleryPack(photo.id):null;
  const adLocked=!!lockedPack&&(lockedPack as CollectionPack).unlock==='ad';
  const adFullPack=adLocked&&photo?this.collection?.packs.find(item=>item.id===lockedPack.id):null;
  const adImg=adFullPack&&photo?adFullPack.images.find(item=>item.id===photo.id):null;
  const adReq=adImg?.adRequired??adFullPack?.adRequired??2,adProg=adImg?.adProgress??0;
  const adDailyUsed=adFullPack?.dailyUsed??0,adDailyLimit=adFullPack?.dailyLimit??2,adDailyUnlocked=adFullPack?.dailyUnlocked??0,adDailyUnlockLimit=adFullPack?.dailyUnlockLimit??1;
  const adDailyBlocked=adLocked&&(adDailyUsed>=adDailyLimit||(adProg+1>=adReq&&adDailyUnlocked>=adDailyUnlockLimit));
  const createLabel=adLocked?(adDailyBlocked?'今日次数已用完 · 明天再来':adProg>0?'再看 '+(adReq-adProg)+' 次广告解锁（'+adProg+'/'+adReq+'）':'看广告解锁（0/'+adReq+'）'):lockedPack?'解锁图包':!this.usesCreationTickets?'开一桌':roomCount>=this.ownRoomLimit?'管理房间':freeOwned||freeFirst||available?'开一桌':'观看 TapTap 广告',createAction=()=>{if(adLocked&&photo){void this.unlockAdImage(photo.id);return;}if(lockedPack){const full=this.collection?.packs.find(item=>item.id===lockedPack.id);if(full)this.openPackPreview(full);else this.navigate('collection');return;}if(!this.formalWeb&&roomCount>=this.ownRoomLimit){this.showModal('manage');return;}if(!this.selected){this.note('先选择一张图片');return;}if(!this.usesCreationTickets||freeOwned||freeFirst||available)void this.launch({mode:'selected',pieces:this.pieces,visibility:this.visibility,imageId:this.selected});else void this.claimSupply('create');};
  const disabled=this.busy||!p||adDailyBlocked||(!lockedPack&&this.usesCreationTickets&&!freeOwned&&!freeFirst&&!available&&!this.ticketClaimAvailable&&roomCount<3);
  const thumb=compact?52:64;
  if(photo){s.frame({x,y,w:Math.round(thumb*1.3),h:thumb},'plus-cream-normal');s.image(this.client.asset(photo.thumbSrc),{x:x+3,y:y+3,w:Math.round(thumb*1.3)-6,h:thumb-6});const tx=x+thumb*1.3+10,tw=w-thumb*1.3-(sheet?44:10);s.text(photo.title,tx,y+4,compact?15:17,ink,800,tw);s.text(photo.category,tx,y+(compact?26:30),12,this.colors.muted,600,tw);
   const tag=this.photoTag(photo.id,owned),pack=tag.tone==='locked'?this.galleryPack(photo.id):null;if(pack){const label=(pack as CollectionPack).unlock==='ad'?'看整本「'+pack.title+'」 ›':'解锁图包 ›';s.text(label,tx,y+thumb-16,12,this.colors.berry,700);s.hit({x:tx-4,y:y+thumb-22,w:s.measure(label,12,700)+8,h:24},()=>{const full=this.collection?.packs.find(item=>item.id===pack.id);if(full)this.openPackPreview(full);else this.navigate('collection');});}}
  else{s.icon('piece',{x,y:y+8,w:26,h:29});this.paragraph('点选一张喜欢的图片',x+34,y+10,w-34,13);}
  if(sheet){s.button({x:r.x+r.w-46,y:r.y+10,w:34,h:34},'',()=>{this.selected=null;this.invalidate();});s.icon('close',{x:r.x+r.w-41,y:r.y+15,w:24,h:24},ink);}
  y+=thumb+12;
  if(photo?.tuanziOrigin){
   const originText='获得方式：'+photo.tuanziOrigin;
   const originH=s.wrap(originText,-9999,0,w-12,11,'#8c4a19',15);
   const boxH=originH+10;
   s.ctx.fillStyle=s.color('#fdf1dc');s.ctx.fillRect(x,y-4,w,boxH);
   s.wrap(originText,x+6,y+1,w-12,11,'#8c4a19',15);
   y+=boxH+4;
  }
  const row=(label:string,draw:(rr:Rect)=>void)=>{if(sheet){const lw=56;s.text(label,x,y+8,13,this.colors.muted,700);draw({x:x+lw,y,w:w-lw,h:32});y+=40;}else{s.text(label,x,y,13,this.colors.muted,700);draw({x,y:y+20,w,h:34});y+=66;}};
  row('片数',rr=>s.segments(rr,this.pieceCounts.map(n=>[n,this.pieceLevel(n)?n+'·'+this.pieceLevel(n)+'级':String(n)] as const),this.pieces,n=>{if(this.pieceLevel(n)){this.note(this.pieceLevel(n)+'级解锁'+n+'片房间，你现在 Lv.'+(this.client.profile?.level??0));return;}this.pieces=n;this.invalidate();},this.pieceCounts.filter(n=>this.pieceLevel(n))));
  row('谁能加入',rr=>s.segments(rr,[['public','公开'],['private','私人']] as const,this.visibility,v=>{this.visibility=v;this.invalidate();}));
  const tables=this.selected?this.rooms.filter(room=>room.imageId===this.selected&&room.players<seatLimit(room)&&room.acceptingNew!==false&&!room.completed):[];
  if(tables.length){const label='这张图有 '+tables.length+' 桌公开房正在拼 · 去加入 ›';s.text(label,x,y,12,this.colors.berry,700,w);s.hit({x:x-4,y:y-6,w,h:26},()=>{const best=[...tables].sort((a,b)=>b.placed/Math.max(1,b.actualPieces??b.pieces)-a.placed/Math.max(1,a.actualPieces??a.pieces))[0];if(best)void this.enterRoom(best.id);});y+=26;}
  if(this.usesCreationTickets){const costLine=photo?.tuanziOrigin&&freeOwned?'明信片已解锁 · 公开房免费（私人房用 1 券）':(freeOwned?'这张图的公开房免费':freeFirst?'首次开桌免费':'需要 1 张建房券')+' · 私人房或其他图用 1 张建房券';s.text(costLine,x,y,12,this.colors.ink,600,w);y+=19;const stock='建房券 '+(p?.supply.create??0)+'/3';s.text(stock,x,y,12,this.colors.muted,700);if(this.ticketClaimAvailable){const lx=x+s.measure(stock,12,700)+8,label='· 观看 TapTap 广告';s.text(label,lx,y,12,this.colors.berry,700);s.hit({x:lx-4,y:y-6,w:s.measure(label,12,700)+8,h:26},()=>void this.claimSupply('create'));}y+=23;}
  this.drawPictureButton({x,y,w,h:44},createLabel,createAction,'berrydark','players',16,19,disabled);y+=54;
  if(!sheet)this.drawPictureButton({x,y,w,h:38},'随机开一桌（公开 · 免费）',()=>void this.launch({mode:'random',pieces:this.pieces,visibility:'public',direction:this.direction}),'cream','dice',compact?12:13,16,this.busy||!p);
 }

export function drawPictureButtonPanel(this:AppHost,r:Rect,label:string,fn:()=>void,tone='cream',icon='',fontSize=11,iconSize=16,disabled=false,selected=false){
  const s=this.stage,c=s.ctx;c.save();if(selected){s.frame(r,'button-'+tone+'-'+(disabled?'disabled':'selected'));if(!disabled)s.hit(r,fn);}else s.button(r,'',fn,{tone,disabled});const accent=tone==='berry'||tone==='berrydark'||tone==='gold',textColor=disabled?this.colors.disabled:accent?'#fffaf0':this.colors.ink,gap=label&&icon?3:0,contentWidth=s.measure(label,fontSize,750)+(icon?iconSize:0)+gap,start=r.x+(r.w-contentWidth)/2;if(icon)s.icon(icon,{x:start,y:r.y+(r.h-iconSize)/2,w:iconSize,h:iconSize},disabled?this.colors.disabled:accent?'#fffaf0':icon==='create'?this.colors.gold:undefined);if(label)s.text(label,start+(icon?iconSize+gap:0),r.y+(r.h-fontSize)/2-1,fontSize,textColor,750);c.restore();
 }
