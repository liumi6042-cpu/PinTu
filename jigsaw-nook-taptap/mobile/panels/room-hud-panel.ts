import type {Rect} from '../ports';
import {PuzzleBoard} from '../puzzle-board';
import {landscapeRoomColors as roomColors} from '../theme';
import {roomRoundPath} from '../room-chrome';
import {RoomClient} from '../../lib/room-client';
import {activeRoomPhoto} from '../room-photo';
import {placedCount} from '../../lib/puzzle-engine';
import {type AppHost,type PublicMessage,clamp,photoMap,phrases,seatLimit} from './shared';

export function drawRoomPanelView(this:AppHost){
  if(this.nineGridRoom){this.drawNineGrid();return;}
  const s=this.stage,room=this.room,board=this.board,view=this.currentViewport(),p=this.client.profile;
  if(!room||!board){s.text('尚未加入房间',20,view.top+35,18);this.button(20,view.top+81,s.w-40,'返回大厅',()=>this.navigate('lobby'));return;}
  const visible=!this.hidden&&!this.modalBlocksInput;if(visible!==this.cursorVisible){this.cursorVisible=visible;if(visible)this.cursor?.refresh();else this.clearRoomPointer();}
  const layout=this.layout,c=s.ctx,safeBottom=s.h-view.bottom,headerTop=this.roomHeaderTop();
  if(layout==='desktop'){
   const panel=this.roomPanelCollapsed?32:300,bar=60;this.roomArea={x:0,y:bar,w:s.w-panel,h:s.h-bar};
   this.placeBoard(board,0,()=>this.desktopFit(board));
   c.fillStyle=this.colors.cream;c.fillRect(0,0,s.w,bar);c.fillStyle=this.colors.line;c.fillRect(0,bar-1,s.w,1);
   this.drawRoomTopBar({x:0,y:0,w:s.w,h:bar},'desktop');this.drawDesktopTools(this.roomArea.x+12,bar+12,safeBottom);
   if(!this.roomPanelCollapsed)this.drawRoomPanel({x:s.w-panel,y:bar,w:panel,h:s.h-bar});
   s.button({x:s.w-panel,y:bar+4,w:32,h:32},this.roomPanelCollapsed?'\u2039':'\u203a',()=>this.setRoomPanelCollapsed(!this.roomPanelCollapsed),{fontSize:22});
   this.drawRoomGift(this.roomArea.x+10,safeBottom-62,true);this.drawZoomControl(this.roomArea.x+this.roomArea.w-150,safeBottom-50);
  }else if(layout==='phoneLandscape'){
   const web=this.platform.config.id==='web',column=web?62:this.landscapeToolsOpen?72:0;this.roomArea={x:0,y:0,w:s.w-column,h:safeBottom};
   this.placeBoard(board,headerTop+58,()=>this.phoneFit(board,'height'));
   this.drawRoomTopBar({x:0,y:headerTop,w:s.w-column,h:52},'landscape');
   if(web){c.fillStyle=this.colors.cream;c.fillRect(s.w-column,0,column,s.h);c.fillStyle=this.colors.line;c.fillRect(s.w-column,0,2,s.h);this.drawToolColumn({x:s.w-column+2,y:headerTop+6,w:column-2,h:safeBottom-headerTop-6});}
   else this.drawToolColumn({x:s.w-72,y:0,w:72,h:s.h});
   if(web)this.drawRoomGift(8,safeBottom-50,false);else if(!board.previewZoomed)this.drawLandscapeRoomControls(board,headerTop,safeBottom);
  }else{
   const headerBottom=headerTop+76;this.roomArea={x:0,y:headerBottom+1,w:s.w,h:Math.max(90,safeBottom-headerBottom-1)};
   this.placeBoard(board,6,()=>this.phoneFit(board,'width'));
   c.fillStyle=this.colors.cream;c.fillRect(0,0,s.w,headerBottom);c.fillStyle=this.colors.line;c.fillRect(0,headerBottom,s.w,1);
   this.drawRoomTopBar({x:0,y:headerTop,w:s.w,h:76},'portrait');
   // The large reference covers the board like a dialog; its own close button and backdrop dismiss it.
   if(!board.previewZoomed){const map=board.minimapFrame;this.drawChatBubble(map?Math.max(headerBottom+8,map.y+map.h+8):headerBottom+8);this.drawRoomGift(10,safeBottom-62,true);if(!this.toolsOpen){const slot=this.portraitQuickSlot(s.w,safeBottom);this.drawBoardQuickTools(slot.x,slot.bottom);}this.drawRoomTools({x:s.w-63,y:safeBottom-65,w:50,h:50},false);}
  }
  if(!this.imageReady){const preparation=board.imagePreparation??{phase:'loading',completed:0,total:0},label=preparation.phase==='preparing'?'正在准备碎片 '+preparation.completed+'/'+preparation.total+'…':preparation.phase==='loading'?'正在加载图片…':'正在铺开拼图…',r=this.roomArea,w=Math.min(r.w-36,420);s.panel({x:r.x+(r.w-w)/2,y:r.y+20,w,h:74});this.paragraph(this.imageError||label,r.x+(r.w-w)/2+12,r.y+37,w-24,14);if(this.imageError)this.button(r.x+(r.w-w)/2+7,r.y+104,w-14,'重新加载图片',()=>void this.run(()=>this.retryRoomImage(board)));}
  if(this.platform.config.previewTestRoom){
   const d=this.realtime?.diagnostics(),active=d?.previewConnected===true,available=d?.preview==='taptap-test',label=active?'平台同步已接通':'原通道 · '+String(d?.previewDetail||'当前房间未启用平台预览'),w=Math.min(this.roomArea.w-24,420),x=this.roomArea.x+12,y=this.roomArea.y+5;
   s.panel({x,y,w,h:43});s.text('联机自测 D4：'+label,x+8,y+6,10,this.colors.ink,600,w-16);
   s.text(available?'目标 '+(d.previewTargetHz??'—')+'/秒 · 实发 '+(d.platformSendRate??0)+' · 成功 '+(d.platformSucceeded??0)+' · 失败 '+(d.platformFailed??0)+' · 收 '+(d.platformReceived??0):'平台统计未启用 · 点击查看原因',x+8,y+24,9,this.colors.muted,600,w-16);
   s.hit({x,y,w,h:43},()=>this.showModal('settings'));
  }else if(this.adminDiagEnabled)this.drawAdminDiagnostics();
  this.drawLagAlertBanner?.();
  if(this.completionFx)this.drawCompletionTransition();this.drawSettleButton();
  if(!room.connected)this.drawReconnectBanner(room);
  this.drawStoryIntro();
  if(!this.storyIntro){if(this.roomGuideStep)this.drawRoomGuide();else if(this.imageReady&&!this.modal&&!this.roomGuideSeen()){this.roomGuideStep=1;this.invalidate();}}
 }

export function drawDesktopToolsPanel(this:AppHost,x:number,y:number,safeBottom:number){
  const s=this.stage;
  if(!this.desktopToolsOpen){const toggle={x,y,w:48,h:48};this.roomToolsArea=toggle;s.frame(toggle,'button-cream-normal');s.icon('tools',{x:x+12,y:y+6,w:24,h:24});s.text('T',x+20,y+31,11,this.colors.muted,700);s.hit(toggle,()=>this.setDesktopToolsOpen(true));return;}
  const items=[...this.roomTools,['more','更多','']] as const,header=36,padding=8,available=safeBottom-80-y-header-padding,h=Math.min(66,available/items.length),r={x,y,w:80,h:header+items.length*h+padding};this.roomToolsArea=r;
  s.hit(r,()=>{});this.drawLandscapeSurface(r,10,this.colors.cream,this.colors.line,1,2);
  s.text('工具',x+10,y+12,12,this.colors.ink,700);s.button({x:x+r.w-34,y:y+4,w:28,h:28},'‹',()=>this.setDesktopToolsOpen(false),{fontSize:22});
  items.forEach(([kind,label,key],index)=>{const b={x:r.x+8,y:r.y+header+index*h,w:r.w-16,h:h-8},active=this.toolActive(kind),disabled=(kind==='hint'||kind==='underlay')&&this.assistanceUnavailable(kind);
   s.frame(b,active?'button-cream-selected':disabled?'button-cream-disabled':'button-cream-normal');s.icon(this.roomIcon(kind),{x:b.x+(b.w-26)/2,y:b.y+8,w:26,h:26});const text=label+(key?' '+key:'');s.text(label,b.x+(b.w-s.measure(text,12,700))/2,b.y+b.h-21,12,disabled?this.colors.disabled:this.colors.ink,700);if(key)s.text(key,b.x+(b.w+s.measure(text,12,700))/2-s.measure(key,11,700),b.y+b.h-20,11,this.colors.muted,700);
   this.drawAidBadge(kind,b.x+b.w+4,b.y-4);if(!disabled)s.hit(b,()=>this.roomTool(kind));});
 }

export function drawToolColumnPanel(this:AppHost,r:Rect){
  if(this.platform.config.id==='web'){
   const s=this.stage,items=([['edge','边缘'],['hint','提示'],['underlay','底图'],['organize','整理'],['orientation','竖屏'],['more','更多']] as const).filter(([kind])=>kind==='organize'?this.soloRoom:kind!=='orientation'||!!this.platform.setOrientation),h=Math.min(58,r.h/items.length);this.roomToolsArea={...r};
   items.forEach(([kind,label],index)=>{const b={x:r.x+5,y:r.y+index*h,w:r.w-10,h:h-5},active=this.toolActive(kind),disabled=(kind==='hint'||kind==='underlay')&&this.assistanceUnavailable(kind);
    if(active)s.frame(b,'button-cream-selected');s.icon(this.roomIcon(kind),{x:b.x+(b.w-22)/2,y:b.y+4,w:22,h:22});s.text(label,b.x+(b.w-s.measure(label,12,700))/2,b.y+b.h-17,12,disabled?this.colors.disabled:this.colors.ink,700);if(!disabled)s.hit(b,()=>this.roomTool(kind));});return;
  }
  const s=this.stage,c=s.ctx,menu=this.currentViewport().menu;
  if(menu){const y=Math.max(r.y,menu.y+menu.h+8);r={...r,y,h:Math.max(0,r.y+r.h-y)};}
  const toggle={x:(this.landscapeToolsOpen?r.x:s.w)-48,y:this.roomHeaderTop()+57,w:36,h:36};toggle.x-=this.menuReserve(toggle);this.landscapeToggle=toggle;this.roomToolsArea=this.landscapeToolsOpen?{...r}:toggle;
  if(this.landscapeToolsOpen){
   c.fillStyle=roomColors.cream;c.fillRect(r.x,0,r.w,s.h);c.fillStyle=roomColors.line;c.fillRect(r.x,0,2,s.h);s.hit(r,()=>{});
   const items=([['edge','边缘'],['hint','提示'],['underlay','底图'],['locate','定位'],['organize','整理'],['orientation','横竖屏'],['more','更多']] as const).filter(([kind])=>kind==='organize'?this.soloRoom:kind!=='orientation'||!!this.platform.setOrientation),height=Math.min(58,Math.floor(r.h/items.length)),gap=Math.min(4,Math.max(0,(r.h-items.length*height)/(items.length-1))),top=r.y+(r.h-(items.length*height+(items.length-1)*gap))/2;
   items.forEach(([kind,label],index)=>{const b={x:r.x+6,y:top+index*(height+gap),w:r.w-12,h:height},badge=kind==='hint'||kind==='underlay',active=this.toolActive(kind),disabled=badge&&this.assistanceUnavailable(kind);
    if(active||s.isPressed(b))this.drawLandscapeSurface(b,8,roomColors.roseL);
    s.icon(this.roomIcon(kind),{x:b.x+(b.w-22)/2,y:b.y+Math.min(10,Math.max(0,height-39)),w:22,h:22},roomColors.ink);s.text(label,b.x+(b.w-s.measure(label,11,700))/2,b.y+Math.min(38,height-11),11,roomColors.ink,700);
    if(badge){const grant=this.activeAid(kind),paused=kind==='underlay'&&!grant?this.pausedUnderlay():undefined,free=this.aid?.freeRemaining?.[kind]??0,text=grant||paused?this.aidBadge(kind):!this.aid?'读取中':this.aid.newcomerProtected||free>0?'免费':'看广告',bw=s.measure(text,8.5,700)+6;
     this.drawLandscapeSurface({x:b.x,y:b.y,w:bw,h:13},3,paused?'#e6f0e1':roomColors.goldL);s.text(text,b.x+3,b.y+2,8.5,paused?'#3c6b42':'#7a4d10',700);
    }if(!disabled)s.hit(b,()=>this.roomTool(kind));
   });
  }
  if(this.board?.previewZoomed)return;
  this.drawLandscapeSurface(toggle,18,roomColors.card,roomColors.ink,2,2);s.icon(this.landscapeToolsOpen?'close':'tools',{x:toggle.x+8,y:toggle.y+8,w:20,h:20},roomColors.ink);s.hit(toggle,()=>this.setLandscapeToolsOpen(!this.landscapeToolsOpen));
  if(!this.landscapeToolsOpen&&this.activeAid('underlay')){const text=this.aidBadge('underlay'),bw=s.measure(text,8.5,700)+8,bx=toggle.x+(toggle.w-bw)/2,by=toggle.y-10;this.drawLandscapeSurface({x:bx,y:by,w:bw,h:14},4,roomColors.goldL,roomColors.ink,1);s.text(text,bx+4,by+2,8.5,'#7a4d10',700);}
 }

export function drawLandscapeSurfacePanel(this:AppHost,r:Rect,radius:number,fill:string,border?:string,width=0,shadow=0){
  const c=this.stage.ctx;c.save();if(shadow){roomRoundPath(c,{...r,y:r.y+shadow},radius);c.fillStyle=border||roomColors.ink;c.fill();}
  roomRoundPath(c,r,radius);c.fillStyle=fill;c.fill();if(border){c.strokeStyle=border;c.lineWidth=width;c.stroke();}c.restore();
 }

export function drawLandscapeButtonPanel(this:AppHost,r:Rect,label:string,action:()=>void,fill:string,size:number){
  const s=this.stage;this.drawLandscapeSurface(r,8,s.isPressed(r)?roomColors.roseL:fill,roomColors.ink,2,2);
  s.textMiddle(label,r.x+(r.w-s.measure(label,size,900))/2,r.y+r.h/2-1,size,fill===roomColors.roseD?'#ffffff':roomColors.ink,900);s.hit(r,action);
 }

export function drawRoomTopBarPanel(this:AppHost,r:Rect,mode:'desktop'|'portrait'|'landscape'){
  if(mode!=='portrait')r={...r,w:Math.min(r.w,this.stage.w-this.menuReserve(r)-r.x)};
  const s=this.stage,room=this.room!,photo=activeRoomPhoto(room.snapshot,photoMap.get(room.state.imageId)),title=room.snapshot.title||photo?.title||'一起拼图',total=room.state.cols*room.state.rows,placed=placedCount(room.state),percent=Math.floor(placed/Math.max(1,total)*100),members=room.snapshot.members,kind=total+' 片 · '+(room.snapshot.visibility==='private'?'私人房':'公开房'),ink=this.colors.ink;
  const back=(x:number,y:number)=>{s.button({x,y,w:36,h:36},'',()=>this.exitRoom());s.icon('back',{x:x+7,y:y+7,w:22,h:22});};
  const avatars=(right:number,y:number,size:number)=>{const shown=members.slice(0,3),label=members.length+'/'+seatLimit(room.snapshot),lw=s.measure(label,13,700);let x=right-lw;s.text(label,x,y+(size-13)/2,13,ink,700);x-=6+(shown.length?size+(shown.length-1)*(size*.62):0);const start=x;shown.forEach((_member,index)=>s.icon('avatar',{x:x+index*size*.62,y,w:size,h:size*1.08}));return start;};
  if(mode==='desktop'){
   back(r.x+12,r.y+12);s.text(title,r.x+58,r.y+11,18,ink,800,300);s.text(kind,r.x+58,r.y+35,12,this.colors.muted,600,300);
   const count=placed+' / '+total+'  '+percent+'%',cw=s.measure(count,18,800),mid=84+(s.w-84-300)/2;s.icon('piece',{x:mid-cw/2-28,y:r.y+9,w:22,h:24});s.text(count,mid-cw/2,r.y+10,18,ink,800);s.meter({x:mid-170,y:r.y+38,w:340,h:9},placed/Math.max(1,total));
   const inviteW=118;s.button({x:r.x+r.w-inviteW-14,y:r.y+12,w:inviteW,h:36},'＋ 邀请朋友',()=>this.showModal('invite'),{tone:'berry',fontSize:14});
   const start=avatars(r.x+r.w-inviteW-28,r.y+14,28);this.roomMembersArea={x:start-6,y:r.y+6,w:r.x+r.w-start,h:48};s.hit({x:start-6,y:r.y+6,w:r.x+r.w-inviteW-22-start,h:48},()=>this.focusRoomMembers());
  }else if(mode==='portrait'){
   back(r.x+8,r.y+4);const inviteX=r.x+r.w-44-this.menuReserve({...r,h:44});s.button({x:inviteX,y:r.y+6,w:34,h:34},'',()=>this.showModal('invite'),{tone:'berry'});s.icon('plus',{x:inviteX+9,y:r.y+15,w:16,h:16},this.colors.onAccent);
   const start=avatars(inviteX-8,r.y+9,24);this.roomMembersArea={x:start-4,y:r.y+2,w:inviteX+34-start,h:42};s.hit({x:start-4,y:r.y+2,w:inviteX-start,h:42},()=>this.showModal('chat'));
   s.text(title,r.x+50,r.y+5,16,ink,800,start-r.x-58);s.text(kind,r.x+50,r.y+26,11,this.colors.muted,600,start-r.x-58);
   const line=placed+' / '+total+' · '+percent+'%',lw=s.measure(line,14,800);s.icon('piece',{x:r.x+12,y:r.y+48,w:18,h:20});s.text(line,r.x+34,r.y+50,14,ink,800);s.meter({x:r.x+44+lw,y:r.y+55,w:Math.max(20,r.w-58-lw),h:9},placed/Math.max(1,total));
  }else if(this.platform.config.id==='web'){
   const panel={x:r.x+6,y:r.y+4,w:Math.min(320,r.w*.48),h:r.h-6};s.frame(panel,'button-linen-normal');back(panel.x+5,panel.y+5);
   s.text(title,panel.x+48,panel.y+5,14,ink,800,panel.w-56);const line=placed+'/'+total+' · '+percent+'%',lw=s.measure(line,12,800);s.text(line,panel.x+48,panel.y+25,12,ink,800);s.meter({x:panel.x+56+lw,y:panel.y+29,w:Math.max(20,panel.w-66-lw),h:7},placed/Math.max(1,total));
   const right=r.x+r.w-8,inviteW=64,box={x:right-inviteW-130,y:r.y+4,w:inviteW+130,h:r.h-6};s.frame(box,'button-linen-normal');s.button({x:right-inviteW-4,y:box.y+5,w:inviteW,h:box.h-10},'邀请',()=>this.showModal('invite'),{tone:'berry',icon:'invite',fontSize:13});
   avatars(right-inviteW-12,box.y+8,24);this.roomMembersArea={...box};s.hit({x:box.x,y:box.y,w:box.w-inviteW-8,h:box.h},()=>this.showModal('chat'));
  }else{
   const size=26,step=size-7,avatarW=members.length?size+(members.length-1)*step:0,gap=8,inviteW=s.measure('＋ 邀请',13,900)+20;
   const right=r.x+r.w-12,invite={x:right-inviteW,y:r.y,w:inviteW,h:34},avatarX=invite.x-gap-avatarW;
   const count=placed+'/'+total,percentText=Math.round(placed/Math.max(1,total)*100)+'%',countW=s.measure(count,13,900),percentW=s.measure(percentText,13,900),capsuleW=24+countW+percentW+16+180;
   // Centred on the table area with the full 180px meter. At a crowded small viewport,
   // move the capsule below the first row instead of shrinking the meter or overlapping members.
   const capsule={x:r.x+r.w/2-capsuleW/2,y:r.y+2,w:capsuleW,h:25},backRect={x:r.x+12,y:r.y,w:36,h:36},textX=backRect.x+44;
   const stacked=capsule.x<textX+28||capsule.x+capsule.w+gap>avatarX;if(stacked)capsule.y=r.y+44;
   const titleRight=stacked?avatarX-gap:capsule.x-gap;
   this.drawLandscapeButton(backRect,'<',()=>this.exitRoom(),roomColors.card,20);s.text(title,textX,r.y+2,15,roomColors.ink,900,Math.max(1,titleRight-textX));s.text(total+' 片',textX,r.y+21,10.5,roomColors.muted,500,Math.max(1,titleRight-textX));
   this.drawLandscapeSurface(capsule,16,'rgba(255,250,243,.92)',roomColors.lineD,1.5);
   s.textMiddle(count,capsule.x+12,capsule.y+capsule.h/2,13,roomColors.ink,900,'0123456789');
   const meter={x:capsule.x+12+countW+8,y:capsule.y+capsule.h/2-4,w:180,h:8};this.drawLandscapeSurface(meter,4,roomColors.meterTrack);const fill=placed/Math.max(1,total);if(fill>0)this.drawLandscapeSurface({...meter,w:meter.w*fill},4,roomColors.green);
   s.textMiddle(percentText,meter.x+meter.w+8,capsule.y+capsule.h/2,13,roomColors.green,900,'0123456789');s.hit(capsule,()=>{});
   members.forEach((_member,index)=>s.icon('avatar',{x:avatarX+index*step,y:r.y+4,w:size,h:size}));
   this.roomMembersArea={x:avatarX,y:r.y,w:avatarW,h:34};s.hit(this.roomMembersArea,()=>this.showModal('chat'));this.drawLandscapeButton(invite,'＋ 邀请',()=>this.showModal('invite'),roomColors.roseD,13);
  }
  this.drawRoomFriendBadge();
 }

export function drawLandscapeRoomControlsPanel(this:AppHost,board:PuzzleBoard,headerTop:number,safeBottom:number){
  const map=board.minimapFrame,toggle=this.landscapeToggle;this.drawChatBubble(0);this.drawRoomGift(12,map?map.y+map.h+8:headerTop+58,false);
  if(toggle)this.drawBoardQuickTools(toggle.x+toggle.w/2-23,toggle.y+toggle.h+8+54);else this.drawBoardQuickTools(this.roomArea.x+this.roomArea.w-58,safeBottom-4);
 }

export function drawBoardQuickToolsPanel(this:AppHost,x:number,bottom:number){
  const board=this.board,room=this.room;if(!this.lockButtonEnabled||!board||!room||this.layout==='desktop'||!this.imageReady||room.snapshot.completedAt||this.completionFx||board.previewZoomed)return;
  const s=this.stage,size=46,items=[[this.viewLocked?'lock':'unlock',this.viewLocked?'已锁定':'锁定',this.viewLocked,()=>this.toggleViewLock()]] as const;
  items.forEach(([icon,label,active,action],index)=>{const b={x,y:bottom-(index+1)*(size+8),w:size,h:size};s.frame(b,active?'button-gold-normal':'button-cream-normal');s.icon(icon,{x:b.x+(size-22)/2,y:b.y+5,w:22,h:22});s.text(label,b.x+(size-s.measure(label,10,700))/2,b.y+size-16,10,this.colors.ink,700);s.hit(b,action);});
 }

export function drawChatBubblePanel(this:AppHost,y:number){
  this.landscapeChatVisible=false;
  const s=this.stage,messages=this.messages.filter(message=>!this.social.blockedCodes.includes(message.code)),latest=messages[messages.length-1];
  if(latest){if(this.bubbleSeen<0)this.bubbleSeen=latest.id;else if(latest.id>this.bubbleSeen){this.bubbleSeen=latest.id;if(latest.code!==this.client.profile?.code||this.platform.config.id!=='web'&&this.layout==='phoneLandscape')this.chatBubble={message:latest,until:Date.now()+5000};}}
  const bubble=this.chatBubble;if(!bubble||Date.now()>bubble.until||this.modal)return;
  if(this.platform.config.id!=='web'&&this.layout==='phoneLandscape'){
   const c=s.ctx,name=bubble.message.name,text='：'+bubble.message.text,nameW=Math.min(s.measure(name,12,700),this.roomArea.w*.35),w=Math.min(this.roomArea.w-78,this.room?.snapshot.completedAt&&!this.completionFx?(this.roomArea.w-112)/2-20:Infinity,nameW+s.measure(text,12,500)+20),tray=this.board?.trayFrame,r={x:tray?64:12,y:tray?tray.y-26:this.roomArea.h-32,w:tray?Math.max(1,w-52):w,h:20},member=this.room?.snapshot.members.find(member=>member.id===bubble.message.playerId);
   const remaining=bubble.until-Date.now();c.save();c.globalAlpha=Math.min(1,remaining/1000);this.drawLandscapeSurface(r,14,'rgba(255,250,243,.95)',roomColors.lineD,1.5);if(remaining<1000)this.invalidate();
   s.text(name,r.x+10,r.y+4,12,member?.color||roomColors.ink,700,nameW);s.text(text,r.x+10+nameW,r.y+4,12,roomColors.ink,500,w-nameW-20);c.restore();this.bubbleHit(bubble,r);this.landscapeChatVisible=true;return;
  }
  const text=bubble.message.name+'：'+bubble.message.text,w=Math.min(s.w-24,s.measure(text,13,600)+48),r={x:(s.w-w)/2,y,w,h:32};s.frame(r,'button-linen-normal');s.icon('chat',{x:r.x+10,y:r.y+8,w:16,h:16});s.text(text,r.x+31,r.y+8,13,this.colors.ink,600,w-40);this.bubbleHit(bubble,r);
 }

export function drawRoomGiftPanel(this:AppHost,x:number,y:number,label:boolean){
  const s=this.stage,p=this.client.profile,giftLabel='任务 '+(p?.giftProgress??0)+'/10',reserve=label&&this.room?.snapshot.completedAt&&!this.completionFx&&this.layout==='phonePortrait',hitW=reserve?Math.min(144,(this.roomArea.w-112)/2-8-x+3):label?144:44;s.icon('gift',{x,y:y+4,w:label?44:36,h:label?46:38});if(label)s.text(giftLabel,x+46,y+20,15,this.colors.ink,700,reserve?Math.max(1,hitW-49):undefined);s.hit({x:x-3,y,w:hitW,h:52},()=>this.navigate('tasks'));
  const giftCount=p?.giftCount??0;if(giftCount>0){const text=giftCount>99?'99+':String(giftCount),badgeW=Math.max(20,s.measure(text,11,700)+8);s.panel({x:x+30,y:y-2,w:badgeW,h:19},'berry');s.text(text,x+34,y+1,11,'#fffaf0',700);}
 }

export function drawZoomControlPanel(this:AppHost,x:number,y:number){
  const s=this.stage,board=this.board;if(!board)return;const r={x,y,w:140,h:40},label=Math.round(board.camera.z/Math.max(.0001,this.roomZoomBase)*100)+'%';s.frame(r,'button-linen-normal');
  s.button({x:x+4,y:y+4,w:32,h:32},'−',()=>{if(!this.completionFx)board.zoom(.8);this.invalidate();},{fontSize:18});s.button({x:x+r.w-36,y:y+4,w:32,h:32},'＋',()=>{if(!this.completionFx)board.zoom(1.25);this.invalidate();},{fontSize:16});s.text(label,x+(r.w-s.measure(label,14,800))/2,y+12,14,this.colors.ink,800);
 }

export function drawPlayerCardPanel(this:AppHost){
  const s=this.stage,v=this.platform.viewport(),w=Math.min(360,s.w-24),h=Math.min(386,s.h-v.top-v.bottom-16),x=(s.w-w)/2,y=v.top+(s.h-v.top-v.bottom-h)/2;
  s.ctx.fillStyle=this.colors.overlay;s.ctx.fillRect(0,0,s.w,s.h);s.hit({x:0,y:0,w:s.w,h:s.h},()=>{});s.panel({x,y,w,h});
  s.text('玩家名片',x+16,y+17,19,this.colors.ink,800,w-70);s.button({x:x+w-44,y:y+10,w:30,h:30},'',()=>this.showModal(this.cardReturn),{icon:'close'});
  this.modalArea={x:x+12,y:y+50,w:w-24,h:h-62};this.modalExtent=0;
  const data=this.cardData;if(!data){s.wrap(this.cardLoading?'正在读取名片…':this.cardError||'名片暂不可用',x+22,y+78,w-44,14,this.colors.muted,22);if(!this.cardLoading)s.button({x:x+22,y:y+h-58,w:w-44,h:36},'重试',()=>void this.openPlayerCard({code:this.cardCode}),{fontSize:14});return;}
  const area=this.modalArea,contentH=data.relationship==='self'?270:322;this.modalExtent=contentH;this.modalScroll=clamp(this.modalScroll,0,Math.max(0,contentH-area.h));
  s.clip(area,()=>{let cy=area.y+8-this.modalScroll;
   s.icon('avatar',{x:x+22,y:cy,w:52,h:56});if(data.player.decoration)s.decoration(data.player.decoration,{x:x+54,y:cy+29,w:29,h:31});s.text(data.player.name,x+89,cy+6,18,this.colors.ink,800,w-109);s.icon('cardLevel',{x:x+89,y:cy+31,w:21,h:25});s.text('Lv.'+data.player.level,x+116,cy+36,14,this.colors.muted,700,w-136);cy+=76;
   const rows:[string,string,number][]=[['cardPuzzles','拼完的图片数',data.stats.completedPuzzles],['cardPacks','拥有的图包数',data.stats.ownedPacks],['cardAlbums','集齐的图集数',data.stats.completedAlbums],['piece','本局拼合数',data.stats.roomContribution]];
   for(const[icon,label,value]of rows){s.icon(icon,{x:x+24,y:cy,w:25,h:27});s.text(label,x+61,cy+7,14,this.colors.ink,600,w-131);const text=String(value);s.text(text,x+w-26-s.measure(text,16,800),cy+6,16,this.colors.ink,800);cy+=41;}
   if(data.relationship!=='self'){const disabled=this.cardSending||data.relationship==='friend'||data.relationship==='outgoing'||data.relationship==='incoming';s.button({x:x+22,y:cy+8,w:w-44,h:38},data.relationship==='friend'?'已是好友':['outgoing','incoming'].includes(data.relationship)?'已申请':this.cardSending?'正在申请…':'加好友',()=>void this.requestCardFriend(),{icon:'cardAddFriend',tone:'berry',fontSize:14,disabled});}
  });
 }

export function drawRoomSidePanel(this:AppHost,r:Rect){
  const s=this.stage,room=this.room!,ink=this.colors.ink,x=r.x+12,w=r.w-24;s.ctx.fillStyle=this.colors.cream;s.ctx.fillRect(r.x,r.y,r.w,r.h);s.ctx.fillStyle=this.colors.line;s.ctx.fillRect(r.x,r.y,1,r.h);s.hit(r,()=>{});
  let y=r.y+40;const ratio=room.state.cols/Math.max(1,room.state.rows),artH=Math.min(170,Math.max(40,r.h-500),w/Math.max(.6,ratio)),art={x,y,w,h:artH};s.frame(art,'button-linen-normal');if(this.roomImage)s.image(this.roomImage,{x:x+5,y:y+5,w:w-10,h:artH-10},'contain');y+=artH+6;s.text('参考图',x,y,12,this.colors.muted,700);y+=24;
  const members=room.snapshot.members as Array<(typeof room.snapshot.members)[number]&{code?:string;level?:number;contribution?:number}>,me=this.client.profile?.code;
  const columns=r.h<680?2:1,rowW=w/columns;
  if(Date.now()<this.roomMembersHighlight)s.frame({x:x-4,y:y-4,w:w+8,h:28+Math.ceil(members.length/columns)*34},'panel-gold');
  s.text('同桌 '+members.length+' / '+seatLimit(room.snapshot),x,y,15,ink,800);y+=26;
  members.forEach((member,index)=>{const rx=x+index%columns*rowW,ry=y+Math.floor(index/columns)*34;s.icon('avatar',{x:rx,y:ry,w:26,h:28});s.text(member.name+(member.code&&member.code===me?'（我）':''),rx+34,ry+1,13,ink,700,rowW-(columns===1?90:40));s.text('Lv.'+(member.level??0)+(columns===2?' · 拼合 '+(member.contribution??0):''),rx+34,ry+17,10,this.colors.muted,600,rowW-38);if(columns===1){const placed='拼合 '+(member.contribution??0);s.text(placed,rx+rowW-18-s.measure(placed,12,700),ry+7,12,ink,700);}s.hit({x:rx,y:ry,w:rowW,h:32},()=>void this.openPlayerCard(member));});y+=Math.ceil(members.length/columns)*34;
  s.ctx.fillStyle=this.colors.line;s.ctx.fillRect(x,y+2,w,1);y+=12;s.text('聊天',x,y,15,ink,800);y+=24;
  const free=this.formalWeb,replies=[8,5,9,6],footer=8+Math.ceil(replies.length/2)*36+(free?42:0),bottom=r.y+r.h-footer,messages=this.messages.filter(message=>!this.social.blockedCodes.includes(message.code));
  this.chatSeen=this.chatCursor;const rows:PublicMessage[]=[];let used=0;for(let i=messages.length-1;i>=0&&used+40<=bottom-y;i--){rows.unshift(messages[i]);used+=40;}
  if(!rows.length)s.text('还没有消息，点下方短句打个招呼',x,y+4,12,this.colors.muted,500,w);
  let my=bottom-used-4;for(const message of rows){s.text(message.name,x,my,11,this.colors.muted,700,w);s.text(message.text,x,my+16,13,ink,600,w);my+=40;}
  let fy=bottom+4;const bw=(w-8)/2;replies.forEach((id,index)=>s.button({x:x+(index%2)*(bw+8),y:fy+Math.floor(index/2)*36,w:bw,h:30},phrases[id],()=>void this.say(id),{fontSize:12,disabled:this.busy}));fy+=Math.ceil(replies.length/2)*36;
  if(free){s.frame({x,y:fy,w,h:34},'rail-cream-normal');s.text('输入消息…',x+12,fy+10,13,this.colors.muted,500);s.hit({x,y:fy,w,h:34},()=>void this.sayText());}
 }

export function drawReconnectBannerPanel(this:AppHost,room:RoomClient){
  const s=this.stage,area=this.roomArea,w=Math.min(area.w-24,440),x=area.x+(area.w-w)/2,y=area.y+(this.layout==='phonePortrait'?44:this.layout==='phoneLandscape'?this.platform.viewport().top+60:10),r={x,y,w,h:58};s.panel(r);
  const t=Math.floor(Date.now()/250)%8;for(let i=0;i<8;i++){const angle=i*Math.PI/4;s.ctx.globalAlpha=i===t?1:.3;s.ctx.fillStyle=this.colors.berry;s.ctx.fillRect(Math.round(x+24+Math.cos(angle)*8)-2,Math.round(y+29+Math.sin(angle)*8)-2,4,4);}s.ctx.globalAlpha=1;
  s.text('房间同步中断，正在重连…',x+44,y+11,14,this.colors.ink,800,w-130);s.text('已确认的拼图进度会保留',x+44,y+33,12,this.colors.muted,500,w-130);
  s.button({x:x+w-76,y:y+12,w:64,h:34},'重试',()=>{room.retryNow();this.invalidate();},{fontSize:13});
 }

export function drawRoomGuidePanel(this:AppHost){
  const s=this.stage,c=s.ctx,step=this.roomGuideStep,layout=this.layout,menu={x:s.w-70,y:s.h-this.platform.viewport().bottom-72,w:64,h:64};
  const hole=step===1?this.roomArea:step===2?(layout==='phonePortrait'?menu:this.roomToolsArea):this.roomMembersArea,r={x:Math.round(hole.x),y:Math.round(hole.y),w:Math.round(hole.w),h:Math.round(hole.h)};
  c.fillStyle=this.colors.overlay;c.fillRect(0,0,s.w,r.y);c.fillRect(0,r.y+r.h,s.w,s.h-r.y-r.h);c.fillRect(0,r.y,r.x,r.h);c.fillRect(r.x+r.w,r.y,s.w-r.x-r.w,r.h);
  c.strokeStyle=s.color('#fff1d9');c.lineWidth=2;c.strokeRect(r.x+1,r.y+1,r.w-2,r.h-2);s.hit({x:0,y:0,w:s.w,h:s.h},()=>this.finishRoomGuide());
  const copy=['① 把拼块拖到拼盘里 — 拼对了会自动吸住。双指可以缩放，拖空白处可以移动桌面。','② 工具都在这里 — 边缘、提示、底图…'+(this.platform.config.id==='web'?'':' 找不到拼块就点「定位」，没拼上的块都会闪亮标出'),'③ 叫朋友一起拼 — 同桌越多越快'][step-1],w=Math.min(340,s.w-32);
  let x=Math.min(Math.max(16,r.x+r.w/2-w/2),s.w-w-16),y=step===1?r.y+Math.min(r.h*.55,r.h-150):r.y+r.h+12;if(y+140>s.h)y=Math.max(12,r.y-150);if(step===2&&layout!=='phonePortrait'&&r.x<s.w/2){x=Math.min(s.w-w-16,r.x+r.w+12);y=Math.min(r.y+40,s.h-160);}if(step===2&&layout==='phoneLandscape'){x=r.x-w-12;y=Math.min(r.y+40,s.h-160);}
  const textH=this.stage.wrap(copy,-9999,0,w-32,14,this.colors.ink,21),card={x,y,w,h:textH+70};s.panel(card);s.hit(card,()=>{});
  this.paragraph(copy,x+16,y+14,w-32,14,this.colors.ink);s.text(step+' / 3',x+16,y+card.h-38,13,this.colors.muted,700);s.button({x:x+w-110,y:y+card.h-46,w:94,h:36},step<3?'下一步':'知道了',()=>{if(step<3){this.roomGuideStep++;this.invalidate();}else this.finishRoomGuide();},{tone:'berrydark',fontSize:14});
 }

export function drawNineGridPanel(this:AppHost){
  const s=this.stage,room=this.room!,board=this.board!,view=this.platform.viewport(),top=view.top+5,wide=s.w>=600&&s.w>s.h,panelW=wide?242:s.w-24,x=12;
  const time=(key:string)=>{const value=this.nineTimings.get(key);if(!value)return '—';return value.status===0?'连接失败':value.status>=400?'失败 '+value.status:value.ms>=1000?(value.ms/1000).toFixed(2)+'秒':Math.round(value.ms)+'ms';};
  s.button({x:8,y:top+3,w:34,h:34},'‹',()=>this.exitRoom(),{fontSize:24});
  s.text('九格拼合测试 · '+placedCount(room.state)+'/9',49,top+12,17,this.colors.ink,750,s.w-60);
  const mode=this.platform.networkDiagnostics?.().http,channel=mode==='browser'?'浏览器直连':mode==='native'?'TapTap宿主':'正在选择';
    s.text((this.room?.diagnosticActionsActive?'长连接操作':channel)+' · '+(this.realtime?.connected?'实时推送':'轮询同步'),x,top+51,12,this.colors.muted,600,panelW);
  s.text('拿起 '+time('claim')+'  ·  移动 '+time('move'),x,top+76,12,this.colors.ink,600,panelW);
  s.text('排队 '+time('drop-queue')+'  ·  拼合 '+time('drop'),x,top+100,12,this.colors.ink,600,panelW);
  const serverMs=this.nineTimings.get('drop')?.serverMs,server=serverMs===undefined?'—':Math.round(serverMs)+'ms';
  s.text('服务器 '+server+'  ·  松手总计 '+time('drop-total'),x,top+124,12,this.colors.ink,700,panelW);
  const gap=8,bw=(panelW-gap)/2;
  s.button({x,y:top+150,w:bw,h:37},'自动拼一片',()=>void this.testNineGridPiece(),{tone:'berry',fontSize:12,disabled:this.busy||!this.imageReady});
  s.button({x:x+bw+gap,y:top+150,w:bw,h:37},'重新摆放',()=>void this.startNineGrid(),{fontSize:12,disabled:this.busy});
  if(wide)this.paragraph('仅你的账号可用\n不扣体力，不发奖励\n碎片按1—9排列，也可手动拖动。\n测试后截图上方耗时。',x,top+202,panelW,12);
  else s.text('不扣体力、不发奖励 · 可手动拖动或自动测试',x,top+198,11,this.colors.muted,500,panelW);
  this.roomArea=wide?{x:panelW+24,y:top+45,w:s.w-panelW-24,h:Math.max(90,s.h-view.bottom-top-45)}:{x:0,y:top+220,w:s.w,h:Math.max(90,s.h-view.bottom-top-220)};
  this.bodyTop=this.roomArea.y;this.bodyBottom=this.roomArea.y+this.roomArea.h;board.previewTopInset=0;board.setRect(this.roomArea);
  if(this.roomViewPending){board.openMobileView({bottom:8});this.roomViewPending=false;}board.draw(s.ctx);
  s.ctx.save();s.ctx.beginPath();s.ctx.rect(this.roomArea.x,this.roomArea.y,this.roomArea.w,this.roomArea.h);s.ctx.clip();
  const unit=board.board.width/3;
  for(const group of room.state.groups){if(group.locked)continue;const id=group.pieces[0],p=board.worldToScreen({x:board.board.x+(id%3+.5)*unit+group.dx,y:board.board.y+(Math.floor(id/3)+.5)*unit+group.dy});s.panel({x:p.x-11,y:p.y-11,w:22,h:22});s.text(String(id+1),p.x-4,p.y-7,12,this.colors.ink,750);}
  s.ctx.restore();
  if(!this.imageReady||!room.connected){s.panel({x:this.roomArea.x+8,y:this.roomArea.y+8,w:this.roomArea.w-16,h:45});s.text(this.imageError||(!room.connected?room.message:'正在准备九格图片…'),this.roomArea.x+17,this.roomArea.y+24,12,this.colors.ink,500,this.roomArea.w-34);}
 }

export function drawRoomChatEntryPanel(this:AppHost,members:number,unread:number,floating:boolean){
  const s=this.stage,r=this.chatEntryArea,label=members+'/'+seatLimit(this.room?.snapshot),start=floating?r.x+(r.w-25-s.measure(label,14,700))/2:r.x+3;
  if(floating)s.button(r,'',()=>this.showModal('chat'));else s.hit(r,()=>this.showModal('chat'));
  s.icon('person',{x:start,y:r.y+(r.h-25)/2,w:20,h:25});s.text(label,start+25,r.y+(r.h-14)/2,14,this.colors.ink,700);
  if(unread){const x=r.x+r.w-16,y=r.y-4;s.frame({x,y,w:17,h:17},'segment-berry-selected');s.text(Math.min(99,unread),x+4,y+2,9,this.colors.onAccent,700);}
 }

export function drawRoomToolTogglePanel(this:AppHost,toggle:Rect,open:boolean,change:()=>void){
  const s=this.stage,c=s.ctx;
  // The original B2 toggle is an integer-stepped circle, not a rounded rectangle.
  c.save();c.translate(toggle.x,toggle.y);c.scale(toggle.w/54,toggle.h/54);
  const circle=(points:number[],fill:string)=>{c.beginPath();for(let i=0;i<points.length;i+=2){if(i)c.lineTo(points[i],points[i+1]);else c.moveTo(points[i],points[i+1]);}c.closePath();c.fillStyle=s.color(fill);c.fill();};
  circle([18,1,36,1,36,3,42,3,42,6,48,6,48,12,51,12,51,18,53,18,53,36,51,36,51,42,48,42,48,48,42,48,42,51,36,51,36,53,18,53,18,51,12,51,12,48,6,48,6,42,3,42,3,36,1,36,1,18,3,18,3,12,6,12,6,6,12,6,12,3,18,3],'#925363');
  circle([18,3,36,3,36,5,42,5,42,8,46,8,46,12,49,12,49,18,51,18,51,36,49,36,49,42,46,42,46,46,42,46,42,49,36,49,36,51,18,51,18,49,12,49,12,46,8,46,8,42,5,42,5,36,3,36,3,18,5,18,5,12,8,12,8,8,12,8,12,5,18,5],'#e3bda4');
  circle([19,5,35,5,35,7,41,7,41,10,44,10,44,13,47,13,47,19,49,19,49,35,47,35,47,41,44,41,44,44,41,44,41,47,35,47,35,49,19,49,19,47,13,47,13,44,10,44,10,41,7,41,7,35,5,35,5,19,7,19,7,13,10,13,10,10,13,10,13,7,19,7],open?'#f4e7db':'#fff8ef');c.restore();
  const inset=toggle.w*12/50,size=toggle.w*26/50;s.icon(open?'close':'tools',{x:toggle.x+inset,y:toggle.y+inset,w:size,h:size});s.hit(toggle,change);
  if(!open&&this.activeAid('underlay')){const text=this.aidBadge('underlay'),bw=s.measure(text,9.5,700)+8,bx=toggle.x+(toggle.w-bw)/2,by=toggle.y-10;c.fillStyle=s.color('#fae7b8');c.fillRect(Math.round(bx),Math.round(by),Math.round(bw),15);c.strokeStyle=s.color('#83542f');c.lineWidth=1;c.strokeRect?.(Math.round(bx)+.5,Math.round(by)+.5,Math.round(bw)-1,14);s.text(text,bx+4,by+2,9.5,'#83542f',700);}
 }

export function drawRoomToolsPanel(this:AppHost,toggle:Rect,landscape:boolean){
  const s=this.stage,board=this.board;if(!board)return;
  this.drawRoomToolToggle(toggle,this.toolsOpen,()=>{this.clearRoomPointer();this.toolsOpen=!this.toolsOpen;this.invalidate();});
  if(!this.toolsOpen)return;
  const width=Math.min(366,s.w-26),box={x:s.w-13-width,y:Math.max(this.roomArea.y+7,toggle.y-160),w:width,h:150};s.panel(box);s.hit(box,()=>{});
  const items:readonly(readonly[string,string])[]=[...this.roomTools.map(([kind,label])=>[kind,label] as const),...(this.platform.setOrientation?[['orientation','横屏']] as const:[])],cellW=(box.w-14)/items.length;
  items.forEach(([kind,label],index)=>{const x=box.x+7+index*cellW,cx=x+cellW/2,y=box.y+12,disabled=(kind==='hint'||kind==='underlay')&&this.assistanceUnavailable(kind);
   s.frame({x:cx-21,y:y+8,w:42,h:42},this.toolActive(kind)?'button-cream-selected':disabled?'button-cream-disabled':'button-cream-normal');s.icon(this.roomIcon(kind),{x:cx-13,y:y+16,w:26,h:26});s.text(label,cx-s.measure(label,12,700)/2,y+55,12,disabled?this.colors.disabled:this.colors.ink,700);
   this.drawAidBadge(kind,x+cellW-1,box.y+4);if(!disabled)s.hit({x,y:box.y+5,w:cellW,h:76},()=>this.roomTool(kind));});
  s.ctx.fillStyle=this.colors.line;s.ctx.fillRect(box.x+12,box.y+88,box.w-24,1);
  const members=this.room?.snapshot.members.length??0,unread=this.chatUnread,bw=(box.w-24-12)/3,by=box.y+98;
  s.button({x:box.x+12,y:by,w:bw,h:40},'',()=>this.roomTool('chat'));for(let i=0;i<Math.min(3,members);i++)s.icon('avatar',{x:box.x+20+i*11,y:by+10,w:18,h:20});s.text('同桌 '+members,box.x+24+Math.min(3,members)*11+8,by+12,13,this.colors.ink,700,bw-40);
  s.button({x:box.x+18+bw,y:by,w:bw,h:40},'聊天',()=>this.roomTool('chat'),{icon:'chat',fontSize:13});if(unread){const ux=box.x+18+bw*2-18;s.frame({x:ux,y:by-6,w:18,h:18},'segment-berry-selected');s.text(Math.min(99,unread),ux+4,by-4,10,this.colors.onAccent,700);}
  s.button({x:box.x+24+bw*2,y:by,w:bw,h:40},'更多 ›',()=>this.roomTool('more'),{fontSize:13});
 }

export function drawPublicChatPanel(this:AppHost){
  const messages=this.messages.filter(message=>!this.social.blockedCodes.includes(message.code));
  const s=this.stage,view=this.platform.viewport(),landscape=s.w>s.h&&s.w>=540,w=landscape?Math.min(370,s.w*.44):s.w-24,chatTop=this.roomArea.y+12,
   h=landscape?Math.min(520,s.h-view.bottom-chatTop-12):Math.min(Math.max(380,s.h*.52),s.h-view.top-view.bottom-20),
   x=landscape?s.w-w-74:12,y=landscape?Math.max(view.top+8,chatTop):s.h-view.bottom-h-10;
  this.chatWindowArea={x,y,w,h};s.panel(this.chatWindowArea);s.hit(this.chatWindowArea,()=>{});
  s.text('同桌交流',x+15,y+17,18,this.colors.ink,800,w-180);
  s.segments({x:x+w-165,y:y+12,w:116,h:32},[['room','房间'],['friends','好友']],'room',value=>{if(value==='friends')this.openSocialInbox();});
  {const count=this.social.unread+this.social.requestCount;if(count){const label=count>99?'99+':String(count),bw=Math.max(17,s.measure(label,9,700)+8),bx=x+w-165+116-bw/2,by=y+6;s.frame({x:bx,y:by,w:bw,h:17},'segment-berry-selected');s.text(label,bx+(bw-s.measure(label,9,700))/2,by+2,9,this.colors.onAccent,700);}}
  const strip=this.room?.snapshot.members??[],memberColumns=Math.max(1,Math.floor((w-110)/78)),memberWidth=78,memberBottom=84;
  strip.slice(0,memberColumns).forEach((member,index)=>{const sx=x+14+index*memberWidth,sy=y+50;s.icon('avatar',{x:sx,y:sy,w:24,h:26});s.text(member.name,sx+27,sy+1,12,this.colors.ink,700,46);s.text('Lv.'+((member as {level?:number}).level??0),sx+27,sy+16,10,this.colors.muted,600);s.hit({x:sx,y:sy,w:75,h:34},()=>void this.openPlayerCard(member));});
  s.button({x:x+w-86,y:y+50,w:72,h:30},'同桌 '+strip.length+' ›',()=>this.showModal('members'),{fontSize:12});
  s.button({x:x+w-42,y:y+12,w:29,h:31},'',()=>this.showModal(null),{icon:'close'});
  const groups=[{label:'协作',ids:[1,5,6,2,8,3,7]},{label:'鼓励',ids:[0,4,9,10,11]},{label:'表情',ids:[12,13,14,15]},{label:'心情',ids:[16,17,18,19,20]}].map(g=>({...g,ids:g.ids.filter(id=>this.phraseAvailable(id))})).filter(g=>g.ids.length);
  if(this.phraseGroup>=groups.length)this.phraseGroup=0;
  const selected=groups[this.phraseGroup],columns=w>=310?3:2,
   rows=Math.ceil(selected.ids.length/columns),footerHeight=48+rows*34+(this.formalWeb?38:0),footerY=y+h-footerHeight-10,
   list={x:x+10,y:y+memberBottom+4,w:w-20,h:Math.max(24,footerY-y-memberBottom-11)};
  let messageY=0;const entries=messages.map(message=>{const lines:string[]=[];if(this.formalWeb){let line='';for(const char of message.text){if(char==='\n'||s.measure(line+char,14,650)>list.w-82){lines.push(line);line=char==='\n'?'':char;}else line+=char;}lines.push(line);}else lines.push(message.text);const h=this.formalWeb?Math.max(56,31+lines.length*21):56,entry={message,lines,y:messageY,h};messageY+=h;return entry;});
  this.modalArea=list;this.modalExtent=messageY;this.modalScroll=clamp(this.modalScroll,0,Math.max(0,this.modalExtent-list.h));this.chatHits=[];
  s.clip(list,()=>{
   if(!messages.length){s.text('还没有消息',list.x+9,list.y+16,13,this.colors.muted);s.text('点下方短句和同桌打个招呼',list.x+9,list.y+42,12,this.colors.muted,500,list.w-20);}
   for(const entry of entries){
    const {message,lines}=entry,cy=list.y+entry.y-this.modalScroll;
    if(cy+entry.h<list.y||cy>list.y+list.h)continue;
    const r={x:list.x,y:cy,w:list.w,h:entry.h-4},avatar={x:r.x+3,y:r.y+4,w:29,h:32};s.icon('avatar',avatar);
    const name=message.name+' · Lv.'+(message.level??0);s.text(name,r.x+40,r.y+2,11,this.colors.muted,700,r.w-75);
    lines.forEach((line,index)=>s.text(line,r.x+40,r.y+23+index*21,14,this.colors.ink,650,r.w-82));
    if(message.sentAt){const date=new Date(message.sentAt);s.text(String(date.getHours()).padStart(2,'0')+':'+String(date.getMinutes()).padStart(2,'0'),r.x+r.w-42,r.y+2,9,this.colors.muted);}
    const own=message.code===this.client.profile?.code;
    if(!own&&message.code){s.text('···',r.x+r.w-24,r.y+23,18,this.colors.muted,800);s.hit({x:r.x+r.w-37,y:r.y+13,w:36,h:36},()=>this.openPublicMessage(message));const visible={x:r.x,y:Math.max(list.y,r.y),w:r.w-39,h:Math.max(0,Math.min(list.y+list.h,r.y+r.h)-Math.max(list.y,r.y))};this.chatHits.push({r:visible,message});}
   }
  });
  s.ctx.fillStyle=this.colors.line;s.ctx.fillRect(x+12,footerY,w-24,1);if(w>=310)s.text(this.formalWeb?'快捷短句':'只发送预设短句',x+14,footerY+7,10,this.colors.muted);
  const segmentW=Math.min(groups.length*58,w-26);s.segments({x:x+w-13-segmentW,y:footerY+3,w:segmentW,h:28},groups.map((g,i)=>[i as 0|1|2|3,g.label] as const),this.phraseGroup,value=>{this.phraseGroup=value;this.invalidate();});
  const bw=(w-26-(columns-1)*6)/columns;
  selected.ids.forEach((id,i)=>s.button({x:x+13+(i%columns)*(bw+6),y:footerY+39+Math.floor(i/columns)*34,w:bw,h:29},phrases[id],()=>void this.say(id),{fontSize:11,tone:'cream',disabled:this.busy}));
  if(this.formalWeb)s.button({x:x+13,y:footerY+39+rows*34,w:w-26,h:30},'输入消息',()=>void this.sayText(),{fontSize:12,disabled:this.busy});
 }

export function drawAdminDiagnosticsPanel(this:AppHost){
  const s=this.stage,snap=this.roomDiagnosticSnapshot();
  const topY=this.layout==='phoneLandscape'?this.roomHeaderTop()+56:this.roomArea.y+6;
  const label=snap.pill+(this.adminDiagExpanded?' ▴':' ▾');
  const pillW=Math.min(this.roomArea.w-16,Math.max(150,s.measure(label,10,700)+20));
  const pill={x:this.roomArea.x+(this.roomArea.w-pillW)/2,y:topY,w:pillW,h:24};
  const hasLag=snap.lag?.slowFrames5s>=3||snap.lag?.slowNet15s>=2||!snap.wsConnected;
  this.drawLandscapeSurface(pill,12,'rgba(34,26,22,0.84)',hasLag?'#f08a8a':'#e8c47a',1);
  s.text(label,pill.x+10,pill.y+6,10,'#fff8ee',700,pill.w-20);
  s.hit(pill,()=>{this.adminDiagExpanded=!this.adminDiagExpanded;this.invalidate();});
  if(!this.adminDiagExpanded)return;
  const showQq=this.communityGroupVisible===true;
  const displayLines=showQq?[...snap.lines,'遇到卡顿请复制诊断发到玩家 QQ 群 397229653']:snap.lines;
  const cardW=Math.min(this.roomArea.w-16,380),lineH=15,cardH=14+displayLines.length*lineH+36;
  const card={x:this.roomArea.x+(this.roomArea.w-cardW)/2,y:topY+28,w:cardW,h:cardH};
  this.drawLandscapeSurface(card,10,'rgba(28,22,19,0.92)','#e8c47a88',1);
  s.hit(card,()=>{});
  displayLines.forEach((line:string,index:number)=>s.text(line,card.x+10,card.y+8+index*lineH,10,showQq&&index===displayLines.length-1?'#f7d996':'#f7efe2',600,card.w-20));
  const by=card.y+card.h-30,cols=showQq?3:2,gap=6,bw=(card.w-20-gap*(cols-1))/cols;
  const copyBtn={x:card.x+10,y:by,w:bw,h:22};
  this.drawLandscapeSurface(copyBtn,6,'rgba(176,84,111,0.92)','#fff2e288',1);
  s.text('复制诊断',copyBtn.x+(bw-s.measure('复制诊断',10,700))/2,copyBtn.y+5,10,'#fff8ee',700,bw-6);
  s.hit(copyBtn,()=>void this.copyRoomDiagnostics());
  if(showQq){
   const qqBtn={x:card.x+10+bw+gap,y:by,w:bw,h:22};
   this.drawLandscapeSurface(qqBtn,6,'rgba(184,132,58,0.92)','#fff2e288',1);
   s.text('复制QQ群',qqBtn.x+(bw-s.measure('复制QQ群',10,700))/2,qqBtn.y+5,10,'#fff8ee',700,bw-6);
   s.hit(qqBtn,()=>void this.copyQqGroup());
  }
  const closeBtn={x:card.x+10+(bw+gap)*(cols-1),y:by,w:bw,h:22};
  this.drawLandscapeSurface(closeBtn,6,'rgba(82,68,60,0.92)','#fff2e255',1);
  s.text('收起',closeBtn.x+(bw-s.measure('收起',10,700))/2,closeBtn.y+5,10,'#fff8ee',700,bw-6);
  s.hit(closeBtn,()=>{this.adminDiagExpanded=false;this.invalidate();});
 }

export function drawLagAlertBannerPanel(this:AppHost){
  if(this.modal||this.completionFx||this.nineGridRoom)return;
  const alert=this.lagSnapshot?.activeAlert;if(!alert)return;
  const s=this.stage,baseY=this.layout==='phoneLandscape'?this.roomHeaderTop()+56:this.roomArea.y+6;
  const y=baseY+(this.adminDiagEnabled?(this.adminDiagExpanded?206:30):0);
  const w=Math.min(this.roomArea.w-16,410),h=46,x=this.roomArea.x+(this.roomArea.w-w)/2,r={x,y,w,h};
  this.drawLandscapeSurface(r,10,'rgba(44,29,28,0.92)','#f0967e',1.5);
  s.hit(r,()=>this.showModal('lagFeedback'));
  const closeW=24,copyW=62,closeX=x+w-closeW-6,copyX=closeX-copyW-6,textW=Math.max(60,copyX-x-16);
  s.text(alert.title,x+10,y+7,11,'#fff3e6',800,textW);
  const sub=this.communityGroupVisible?'点此查看或复制日志，加 QQ 群 397229653 反馈':'点此查看或一键复制诊断日志';
  s.text(sub,x+10,y+25,9.5,'#f4d5b4',600,textW);
  const copyBtn={x:copyX,y:y+11,w:copyW,h:24};
  this.drawLandscapeSurface(copyBtn,6,'rgba(176,84,111,0.96)','#fff2e288',1);
  s.text('复制日志',copyBtn.x+(copyW-s.measure('复制日志',10,700))/2,copyBtn.y+6,10,'#fff8ee',700,copyW-4);
  s.hit(copyBtn,()=>void this.copyRoomDiagnostics(true));
  const closeBtn={x:closeX,y:y+11,w:closeW,h:24};
  s.text('×',closeBtn.x+6,closeBtn.y+3,14,'#f4d5b4',700);
  s.hit(closeBtn,()=>{this.lag.dismissAlert();this.invalidate();});
 }
