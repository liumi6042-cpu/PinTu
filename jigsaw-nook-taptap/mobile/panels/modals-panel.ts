import type {Rect} from '../ports';
import type {MobileOwnedRoom} from '../../h5/mobile-api';
import {tapAuthorizationLayout} from '../tap-authorization-layout';
import {privacySectionsFor,termsSectionsFor} from '../privacy-policy';
import {contributionCopy,recoveryCopy} from '../economy-copy';
import {HAIRPIN_ID,weeklyCell} from '../retention';
import {redeemCells} from '../redeem';
import type {WelcomeSlot} from '../welcome-greeting';
import type {ScreenOrientation} from '../orientation-choice';
import {type AppHost,beijingMonthDay,clamp,historyPhotoTitle,photoMap} from './shared';

export function drawSavedRoomPanel(this:AppHost,room:MobileOwnedRoom,left:number,cy:number,width:number,own:boolean){
  const s=this.stage,withDelete=own,thumb=room.thumbSrc??(room.imageId?photoMap.get(room.imageId)?.thumbSrc:undefined),textX=thumb?left+78:left+10,textWidth=width-(textX-left)-10;
  s.panel({x:left,y:cy,w:width,h:104});if(thumb)this.cardImage(thumb,{x:left+9,y:cy+10,w:58,h:46});
  s.text(room.completed?'已完成':room.title??'一起拼图',textX,cy+12,15,this.colors.ink,700,textWidth);
  const total=room.actualPieces??room.pieces??0,percent=clamp(Math.round((room.placed??0)/Math.max(1,total)*100),0,100);
  s.text(room.unavailable?'房间暂不可用':(room.players??0)+'人 · '+(total||'—')+'片 · '+(room.completed?'100':percent)+'%',textX,cy+37,12,this.colors.muted,undefined,textWidth);
  this.button(left+10,cy+65,withDelete?(width-26)/2:width-20,room.completed?'已完成':room.unavailable?'不可进入':'继续拼',()=>void this.enterRoom(room.id),'berry',30,room.completed===true||room.unavailable===true);
  if(withDelete)this.button(left+16+(width-26)/2,cy+65,(width-26)/2,'删除',()=>void this.removeOwnRoom(room.id),'cream',30);
  return cy+116;
 }

export function drawHistoryGridPanel(this:AppHost,rooms:MobileOwnedRoom[],left:number,top:number,width:number){
  const s=this.stage,columns=width>=720?Math.min(4,Math.floor((width+12)/210)):width>=520?3:2,gap=12,cw=(width-gap*(columns-1))/columns,imageHeight=(cw-12)/1.12,ch=imageHeight+76;
  rooms.forEach((room,index)=>{
   const x=left+index%columns*(cw+gap),y=top+Math.floor(index/columns)*(ch+gap),art={x:x+6,y:y+6,w:cw-12,h:imageHeight};
   s.frame({x,y,w:cw,h:ch},'button-linen-normal');s.ctx.fillStyle=this.colors.cream;s.ctx.fillRect(x+6,y+6,cw-12,ch-12);
   if(room.thumbSrc)s.image(this.client.asset(room.thumbSrc),art);
   const total=room.actualPieces??room.pieces??0,percent=room.completed?100:Math.max(0,Math.min(100,Math.round((room.placed??0)/Math.max(1,total)*100))),copyY=y+imageHeight+13,small=cw<160;
   s.text(room.completed?historyPhotoTitle(room):room.title??'一起拼图',x+10,copyY,small?13:16,this.colors.ink,800,cw-20);
   const metaY=copyY+24,font=small?10:12;s.text((total||'—')+'片',x+10,metaY,font,this.colors.muted);
   if(room.completed){const day=room.completedAt?beijingMonthDay(room.completedAt)+'完成':'已完成';s.text(day,x+cw-10-s.measure(day,font,700),metaY,font,this.colors.ink,700);s.meter({x:x+10,y:y+ch-16,w:cw-20,h:8},1);}
   else{s.text((room.players??0)+'人',x+cw*.44,metaY,font,this.colors.muted);s.text(percent+'%',x+cw-10-s.measure(percent+'%',font,700),metaY,font,this.colors.ink,700);s.meter({x:x+10,y:y+ch-16,w:cw-20,h:8},percent/100);}
   if(room.unavailable&&!room.completed){s.ctx.fillStyle='#6f374edb';s.ctx.fillRect(art.x,art.y+art.h-23,art.w,23);s.text('暂不可用',art.x+8,art.y+art.h-18,11,'#fff9f0',700);}
   else if(room.completed)s.hit({x,y,w:cw,h:ch},()=>{this.historyPreview=room;this.modalScroll=0;this.invalidate();});
   else s.hit({x,y,w:cw,h:ch},()=>{if(!this.busy)void this.enterRoom(room.id);});
  });
  return top+Math.ceil(rooms.length/columns)*(ch+gap);
 }

export function drawHistoryPreviewPanel(this:AppHost,room:MobileOwnedRoom,left:number,top:number,width:number){
  const s=this.stage,src=room.artwork?.src||room.photo?.src||room.thumbSrc||'',total=room.actualPieces??room.pieces??0,meta=(total||'—')+'片'+(room.completedAt?' · '+beijingMonthDay(room.completedAt)+'完成':'');
  // 矮窗口（横屏手机）图放左边、文字放右边，免得说明和返回键被挤出窗口。
  const side=width>=520&&this.modalArea.h<420,imageW=side?Math.round(width*.6):width,imageH=side?Math.max(150,this.modalArea.h-8):Math.max(160,Math.min(width,this.modalArea.h-150));
  s.ctx.fillStyle=this.colors.cream;s.ctx.fillRect(left,top,imageW,imageH);
  if(src)s.image(this.client.asset(src),{x:left,y:top,w:imageW,h:imageH},'contain');
  const textX=side?left+imageW+18:left,textW=side?width-imageW-18:width;let cy=side?top+6:top+imageH+14;
  s.text(historyPhotoTitle(room),textX,cy,18,this.colors.ink,800,textW);cy+=28;
  s.text(meta,textX,cy,13,this.colors.muted,undefined,textW);cy+=30;
  this.button(textX,cy,textW,'返回已完成历史',()=>{this.historyPreview=null;this.modalScroll=0;this.invalidate();},'cream',38);
  return Math.max(cy+50,top+(side?imageH+8:0));
 }

export function drawHistoryWindowPanel(this:AppHost){
  const s=this.stage,v=this.platform.viewport(),w=Math.min(s.w-24,1000),x=(s.w-w)/2,y=Math.max(v.top+15,s.h*.1),h=s.h-y-v.bottom-24;
  s.ctx.fillStyle=this.colors.overlay;s.ctx.fillRect(0,0,s.w,s.h);s.hit({x:0,y:0,w:s.w,h:s.h},()=>{});s.panel({x,y,w,h});
  s.text('历史拼图',x+17,y+18,20,this.colors.ink,700,w-73);s.button({x:x+w-45,y:y+12,w:30,h:30},'',()=>this.showModal(null));s.icon('close',{x:x+w-42,y:y+15,w:24,h:24},this.colors.ink);
  const left=x+20,width=w-40,drafts=this.historyDrafts,finished=this.historyFinished,tabW=Math.min(220,(width-8)/2),tabY=y+54,compact=tabW<150;
  s.button({x:left,y:tabY,w:tabW,h:34},'草稿存档 '+drafts.length,()=>this.setHistoryTab('drafts'),{tone:this.historyTab==='drafts'?'berry':'cream',icon:'piece',fontSize:compact?12:14});
  s.button({x:left+tabW+8,y:tabY,w:tabW,h:34},'已完成历史 '+finished.length,()=>this.setHistoryTab('finished'),{tone:this.historyTab==='finished'?'berry':'cream',icon:'check',fontSize:compact?12:14});
  this.modalStart=tabY+46;this.modalArea={x:x+12,y:this.modalStart,w:w-24,h:y+h-14-this.modalStart};let cy=this.modalStart-this.modalScroll;
  s.clip(this.modalArea,()=>{
   const preview=this.historyTab==='finished'?this.historyPreview:null;
   if(preview){cy=this.drawHistoryPreview(preview,left,cy,width);return;}
   const limits=this.historyLimits,draftsTab=this.historyTab==='drafts',rooms=draftsTab?drafts:finished;
   cy=this.paragraph(draftsTab?'没拼完的拼图，点卡片继续拼。最多保留'+limits.drafts+'张。':'拼好的作品，点卡片看完整大图。最多保留'+limits.completed+'张。',left,cy,width,13)+15;
   if(this.historyLoading)cy=this.paragraph('正在读取历史记录…',left,cy,width,13)+15;
   if(this.historyError){cy=this.paragraph(this.historyError,left,cy,width,13)+12;this.button(left,cy,width,'重新读取',()=>void this.loadRoomHistory(),'cream',36);cy+=48;}
   cy=this.drawHistoryGrid(rooms,left,cy,width);
   if(!this.historyLoading&&!this.historyError&&!rooms.length)cy=this.paragraph(draftsTab?'没有没拼完的拼图，去大厅拼一会儿吧。':'还没有拼完的作品，拼完一张就会出现在这里。',left,cy,width,14)+24;
   if(draftsTab){this.button(left,cy,width,'自己的房间',()=>this.showModal('manage'),'cream',40);cy+=52;}
  });
  this.modalExtent=cy-(this.modalStart-this.modalScroll)+7;const next=Math.max(0,Math.min(this.modalScroll,Math.max(0,this.modalExtent-this.modalArea.h)));if(next!==this.modalScroll){this.modalScroll=next;this.invalidate();}
 }

export function drawRedeemPanel(this:AppHost){
  const s=this.stage,v=this.platform.viewport(),grant=this.redeemGrant,cells=grant?redeemCells(grant):[],gap=8;
  const w=Math.min(grant&&cells.length>3?520:420,s.w-32),cols=Math.max(1,Math.min(cells.length,4)),rows=Math.ceil(cells.length/4),cellW=Math.min(112,(w-40-gap*(cols-1))/cols),cellH=96;
  const h=grant?80+rows*cellH+(rows-1)*gap+18+42+18:80+48+(this.redeemError?40:22)+42+18,x=(s.w-w)/2,y=v.top+Math.max(8,(s.h-v.top-v.bottom-h)/2),left=x+20;
  s.ctx.fillStyle=this.colors.overlay;s.ctx.fillRect(0,0,s.w,s.h);s.hit({x:0,y:0,w:s.w,h:s.h},()=>{});s.panel({x,y,w,h});
  this.modalArea={x,y,w,h};this.modalExtent=0;this.modalScroll=0;
  const centered=(label:string,top:number,size:number,color:string,weight=500)=>s.text(label,x+(w-s.measure(label,size,weight))/2,top,size,color,weight,w-40);
  s.button({x:x+w-38,y:y+8,w:28,h:28},'',()=>this.closeModal(),{icon:'close'});
  if(grant){
   centered('兑换成功',y+18,20,this.colors.ink,700);centered('兑换码 '+grant.code+' · 奖励已到账',y+48,13,this.colors.muted);
   const rowWidth=(n:number)=>n*cellW+(n-1)*gap;
   cells.forEach((cell,index)=>{
    const row=Math.floor(index/4),inRow=Math.min(4,cells.length-row*4),col=index%4,r={x:x+(w-rowWidth(inRow))/2+col*(cellW+gap),y:y+76+row*(cellH+gap),w:cellW,h:cellH};
    s.frame(r,'panel-gold');
    const size=Math.min(40,r.h-(cell.extra?56:44)),icon={x:r.x+(r.w-size)/2,y:r.y+12,w:size,h:size};
    if(cell.decoration)s.decoration(cell.decoration,icon);else s.icon(cell.icon,icon);
    const fs=Math.min(13,13*(r.w-8)/Math.max(1,s.measure(cell.label,13,700)));s.text(cell.label,r.x+(r.w-s.measure(cell.label,fs,700))/2,r.y+r.h-(cell.extra?38:24),fs,this.colors.ink,700,r.w-4);
    if(cell.extra){const es=Math.min(11,11*(r.w-8)/Math.max(1,s.measure(cell.extra,11,600)));s.text(cell.extra,r.x+(r.w-s.measure(cell.extra,es,600))/2,r.y+r.h-20,es,this.colors.muted,600,r.w-4);}
   });
   s.button({x:left,y:y+76+rows*cellH+(rows-1)*gap+18,w:w-40,h:42},'好的',()=>this.closeModal(),{tone:'berry',fontSize:15});
   return;
  }
  centered('兑换码',y+18,20,this.colors.ink,700);centered(this.redeemHint,y+48,13,this.colors.muted);
  const field={x:left,y:y+80,w:w-40,h:48};s.frame(field,'button-cream-normal');
  if(this.redeemCode)centered(this.redeemCode,field.y+14,20,this.colors.ink,800);else centered('点这里输入兑换码',field.y+16,15,this.colors.muted,600);
  s.hit(field,()=>void this.promptRedeemCode());
  let by=field.y+field.h+12;
  if(this.redeemError){centered(this.redeemError,by+2,13,this.colors.rose,700);by+=28;}else by+=10;
  s.button({x:left,y:by,w:w-40,h:42},this.busy?'正在兑换…':'兑换',()=>void(this.redeemCode?this.submitRedeem():this.promptRedeemCode()),{tone:'berrydark',fontSize:15,disabled:this.busy});
 }

export function drawWeeklyGiftPanel(this:AppHost){
  const s=this.stage,v=this.platform.viewport(),view=this.retention?.weeklyGift,wide=this.layout==='phoneLandscape'||s.w>=720;
  const w=Math.min(wide?660:420,s.w-32),gap=8,cols=wide?7:4,rows=wide?1:2,cellW=(w-40-gap*(cols-1))/cols,cellH=wide?clamp(s.h-v.top-v.bottom-190,88,112):96;
  const h=80+rows*cellH+(rows-1)*gap+18+44+18,x=(s.w-w)/2,y=v.top+Math.max(8,(s.h-v.top-v.bottom-h)/2),left=x+20;
  s.ctx.fillStyle=this.colors.overlay;s.ctx.fillRect(0,0,s.w,s.h);s.hit({x:0,y:0,w:s.w,h:s.h},()=>{});s.panel({x,y,w,h});
  this.modalArea={x,y,w,h};this.modalExtent=0;this.modalScroll=0;
  const centered=(label:string,top:number,size:number,color:string,weight=500)=>s.text(label,x+(w-s.measure(label,size,weight))/2,top,size,color,weight,w-40);
  s.button({x:x+w-38,y:y+8,w:28,h:28},'',()=>this.closeModal(),{icon:'close'});
  centered('七日礼',y+18,20,this.colors.ink,700);centered('登录就能领，不用连续',y+48,13,this.colors.muted);
  const days=view?.days??[];
  days.forEach((day,index)=>{
   const row=wide?0:index<4?0:1,col=wide?index:index<4?index:index-4,offset=!wide&&row===1?(cellW+gap)/2:0;
   const r={x:left+offset+col*(cellW+gap),y:y+76+row*(cellH+gap),w:cellW,h:cellH},cell=weeklyCell(day),claimed=day.state==='claimed',today=day.state==='today';
   const c=s.ctx;c.save();if(claimed)c.globalAlpha=.55;
   s.frame(r,today?'panel-gold':claimed?'button-linen-normal':'button-cream-normal');
   const title=cell.title,tw=s.measure(title,12,700);s.text(title,r.x+(r.w-tw)/2,r.y+7,12,today?this.colors.ink:this.colors.muted,700,r.w-6);
   const size=Math.min(38,r.h-(cell.extra?58:46)),icon={x:r.x+(r.w-size)/2,y:r.y+24,w:size,h:size};
   if(cell.icon==='hairpin')s.decoration({id:HAIRPIN_ID,artKey:'hairpin',color:'#f4a6c0'},icon);else s.icon(cell.icon,icon);
   const label=cell.label,fs=Math.min(11,11*(r.w-6)/Math.max(1,s.measure(label,11,700)));s.text(label,r.x+(r.w-s.measure(label,fs,700))/2,r.y+r.h-(cell.extra?34:19),fs,this.colors.ink,700,r.w-4);
   if(cell.extra)s.text(cell.extra,r.x+(r.w-s.measure(cell.extra,10,600))/2,r.y+r.h-18,10,this.colors.muted,600,r.w-4);
   c.restore();
   if(claimed){const stamp='已领';s.text(stamp,r.x+(r.w-s.measure(stamp,11,800))/2,r.y+24+size/2-6,11,this.colors.rose,800);}
  });
  if(!view)centered('正在读取七日礼…',y+76+cellH/2,13,this.colors.muted);
  const by=y+76+rows*cellH+(rows-1)*gap+18,granted=this.weeklyGrant;
  if(granted)s.button({x:left,y:by,w:w-40,h:42},'好的',()=>this.closeModal(),{tone:'berry',fontSize:15});
  else if(view?.available)s.button({x:left,y:by,w:w-40,h:42},'领取第 '+(view.claimed+1)+' 天礼物',()=>void this.claimWeeklyGift(),{tone:'berrydark',fontSize:15,disabled:this.busy});
  else s.button({x:left,y:by,w:w-40,h:42},view?.done||!view?'好的':'明天再来',()=>this.closeModal(),{fontSize:15});
 }

export function drawLoginLogPanel(this:AppHost){
  const s=this.stage,v=this.platform.viewport(),w=Math.min(640,s.w-24),x=(s.w-w)/2,top=v.top+12,bottom=s.h-v.bottom-12;
  // 面板盖住登录弹窗时，透明原生按钮不能留在上面。
  this.platform.setIdentityButtonVisible?.(false);
  s.panel({x,y:top,w,h:bottom-top});
  s.text('登录日志',x+16,top+16,19,this.colors.ink,800,w-32);
  this.bodyTop=top+54;this.bodyBottom=bottom-70;this.listArea={x:x+15,y:this.bodyTop,w:w-30,h:Math.max(30,this.bodyBottom-this.bodyTop)};this.sceneArea={...this.listArea};
  const lines=this.platform.loginLog?.lines()??[];let y=this.bodyTop-this.scroll;
  s.clip(this.listArea,()=>{if(!lines.length)y=this.paragraph('暂无记录。',x+18,y,w-36,12)+6;for(const line of lines)y=this.paragraph(line,x+18,y,w-36,11,this.colors.ink)+5;y=this.paragraph('当前 · '+(this.platform.tapAuthorizationDebug?.()??''),x+18,y+4,w-36,11)+6;});
  this.extent=y-(this.bodyTop-this.scroll);this.scroll=clamp(this.scroll,0,Math.max(0,this.extent-this.listArea.h));
  const gap=8,half=(w-32-gap)/2;
  s.button({x:x+16,y:bottom-54,w:half,h:38},'关闭',()=>this.closeLoginLog(),{fontSize:12});
  s.button({x:x+24+half,y:bottom-54,w:half,h:38},'复制',()=>void this.copyLoginLog(),{fontSize:13,tone:'berrydark'});
 }

export function drawPrivacyChoicePanel(this:AppHost){
  const s=this.stage,v=this.platform.viewport(),detail=this.privacyDocument!==null,entry=tapAuthorizationLayout(s.w,s.h,v.top,v.bottom),combined=this.platform.config.id==='taptap'&&!!this.platform.prepareTapConsent,waiting=this.platform.tapAuthorizationPending?.()===true;
  this.platform.setIdentityButtonVisible?.(!detail);
  const w=detail?Math.min(600,s.w-24):entry.panel.w,x=(s.w-w)/2,available=s.h-v.top-v.bottom-24,h=detail?available:entry.panel.h,top=v.top+12+(available-h)/2,bottom=top+h;
  s.panel({x,y:top,w,h});
  if(detail){
   s.text('服务与隐私协议',x+16,top+16,19,this.colors.ink,800,w-32);
   this.bodyTop=top+54;this.bodyBottom=bottom-70;this.listArea={x:x+15,y:this.bodyTop,w:w-30,h:Math.max(30,this.bodyBottom-this.bodyTop)};this.sceneArea={...this.listArea};
   const sections=[...privacySectionsFor(this.platform.config?.id,this.supplyAdAvailable),...termsSectionsFor(this.platform.config?.id)];let y=this.bodyTop-this.scroll;
   s.clip(this.listArea,()=>{for(const[title,text]of sections){s.text(title,x+18,y,14,this.colors.ink,750,w-36);y=this.paragraph(text,x+18,y+25,w-36,12)+17;}});
   this.extent=y-(this.bodyTop-this.scroll);this.scroll=clamp(this.scroll,0,Math.max(0,this.extent-this.listArea.h));
  }else{
   this.scroll=0;this.extent=0;this.bodyTop=top;this.bodyBottom=bottom;this.listArea={x,y:top,w,h:0};this.sceneArea={...this.listArea};
   const prefix='点击同意确认',size=16,prefixWidth=s.measure(prefix,size),linkWidth=s.measure('协议',size),start=x+(w-prefixWidth-linkWidth)/2,y=top+39;
   s.text(prefix,start,y,size,this.colors.ink,500);s.text('协议',start+prefixWidth,y,size,this.colors.berry,700);
   s.ctx.fillStyle=this.colors.berry;s.ctx.fillRect(start+prefixWidth,y+21,linkWidth,1);
   s.hit({x:start+prefixWidth-5,y:y-8,w:linkWidth+10,h:38},()=>{this.privacyDocument='privacy';this.scroll=0;this.platform.setIdentityButtonVisible?.(false);this.invalidate();});
   if(combined||waiting)this.paragraph(waiting&&this.authorizationNudged?'登录按钮已重新准备，请再点一次“同意并登录”；仍无反应将以游客身份进入。':!this.needsPrivacyChoice&&!waiting?'正在登录TapTap，已有进度会保留。':this.consentError&&!this.privacyRefused?(this.platform.tapNicknameUnavailable?.()?'此客户端不支持昵称授权，点“同意并登录”直接用TapTap账号登录。':'TapTap登录暂不可用，点“同意并登录”将以游客身份进入，进度会保留。'):'同时授权TapTap昵称，用于显示玩家名称。',x+20,top+78,w-40,11);
   // 登录日志入口放在面板右上角，远离透明原生按钮所在的右下按钮。
   if(this.platform.config.id==='taptap'&&this.platform.loginLog){const label='登录日志',width=s.measure(label,11),lx=x+w-16-width,ly=top+12;s.text(label,lx,ly,11,this.colors.berry,700);s.ctx.fillStyle=this.colors.berry;s.ctx.fillRect(lx,ly+15,width,1);s.hit({x:lx-8,y:ly-8,w:width+16,h:30},()=>this.openLoginLog());}
  }
  const gap=8,half=(w-32-gap)/2,back=()=>{this.privacyDocument=null;this.scroll=0;this.platform.setIdentityButtonVisible?.(true);this.invalidate();};
  s.button({x:x+16,y:bottom-54,w:half,h:38},detail?'返回':this.needsPrivacyChoice?'暂不同意':'取消登录',()=>{if(detail){back();return;}this.privacyRefused=true;this.platform.cancelIdentity?.();this.invalidate();},{fontSize:12});
  const right={x:x+24+half,y:bottom-54,w:half,h:38};
  if(detail&&combined){s.button(right,'返回登录',back,{fontSize:13,tone:'berrydark'});return;}
  if(!detail&&(waiting||combined)){
   if(waiting){s.frame(right,'button-berrydark-normal');s.text('同意并登录',right.x+(right.w-s.measure('同意并登录',13,750))/2,right.y+11,13,this.colors.onAccent,750);
    // 原生透明按钮应先接住这次点击；画布收到说明它没对准或未就绪，重建后请玩家再点一次。
    // 第一次：在这次点击内同步重建原生按钮；第二次仍落到画布：以游客身份进入。
    s.hit(right,()=>{this.platform.loginLog?.add('画布接到“同意并登录”点击（原生按钮未接住）· '+(this.platform.tapAuthorizationDebug?.()??''));if(!this.authorizationNudged){this.authorizationNudged=true;this.platform.retryTapAuthorizationButton?.();}else this.enterAsTapGuest('原生按钮两次未接住点击');this.invalidate();});}
   else if(this.consentPreparing||!this.needsPrivacyChoice)s.button(right,'正在连接…',()=>{},{fontSize:13,tone:'berrydark',disabled:true});
   else if(this.privacyRefused)s.button(right,'重新连接',()=>{this.privacyRefused=false;this.prepareConsentButton();this.invalidate();},{fontSize:13,tone:'berrydark'});
   else s.button(right,'同意并登录',()=>{if(this.platform.tapNicknameUnavailable?.())this.acceptLoginOnly();else this.enterAsTapGuest('TapTap登录准备失败');},{fontSize:13,tone:'berrydark'});
  }else s.button(right,'同意',()=>this.acceptPrivacy(),{fontSize:13,tone:'berrydark'});
 }

export function drawPolicyPanel(this:AppHost){const s=this.stage;let y=this.bodyTop-this.scroll;const sections=this.route==='privacy'||this.route==='terms'?[...privacySectionsFor(this.platform.config?.id,this.supplyAdAvailable),...termsSectionsFor(this.platform.config?.id)]:[
  ['一起拼图','拖动拼块，靠近正确位置松开即可拼合。双指缩放和平移，电脑可滚轮缩放、空格或中键平移；'+(this.platform.config.id==='web'?'“适配”可找回完整桌面。':'“定位”会闪亮标出所有未拼块，压在拼好画面上的也能找到；“更多”里可启用锁定按钮，锁定后单指只拖拼块不移动画面；原图小窗点开后可双指放大查看；“更多”里可打开小地图，放大时点小地图直接跳到那里；“更多”里可适配完整桌面。')+'边缘筛选和整理可帮助寻找拼块。'],
  [this.energyEnabled?'体力与经验':'拼合与经验',this.energyEnabled?contributionCopy(this.client.profile)+' '+recoveryCopy(this.client.profile)+' 体力耗尽后拼下一片时默认自动开启任务礼包或补满体力包（可在设置里关闭）。每日观看 5 次补满体力包广告后，当日解锁无限体力（次日 0 点重置）。':'浏览器拼图不消耗体力。有效拼合可获得经验，金币和装饰按统一奖励规则结算。'],
  ['房间与收藏','随机公开房免费创建。指定图片或私人房使用建房券；已购图包可免费创建公开房。同时最多保留'+this.ownRoomLimit+'个未结束的自建房间。'],
  ['邀请与礼包',this.inviteRewardsHidden?'和好友一起拼图，可以积累每日任务礼包；邀请好友不发放奖励。':this.energyEnabled?'好友首次接受邀请并完成3次有效拼合，邀请者可获得补满体力包，每日最多3位。与好友实际协作，还可积累每日任务礼包。':'与好友实际参与拼图，可以积累任务礼包；金币与经验奖励以任务页面展示为准。'],
  ...(this.communityGroupVisible?[['玩家交流群与卡顿反馈','欢迎加入玩家交流 QQ 群 397229653，进群可领兑换码、约朋友一起拼图。如果游玩中遇到画面卡顿或网络波动，可在「设置」或房间「更多」里打开卡顿与网络诊断，一键复制日志发到群里反馈。']]:[['卡顿与网络诊断','如果游玩中遇到画面卡顿或网络波动，可在「设置」或房间「更多」里打开房间网络诊断浮窗或复制诊断日志。']]),
 ];this.scrolled(()=>{for(const[title,text]of sections){s.text(title,20,y,18,this.colors.ink,700);y=this.paragraph(text,20,y+31,s.w-40,14)+24;}if(this.communityGroupVisible&&this.route==='help'){this.button(20,y,s.w-40,'复制玩家 QQ 群号：397229653',()=>void this.copyQqGroup(),'berry');y+=48;}if(!this.formalWeb){this.button(20,y,s.w-40,'个人资料访问与删除申请',()=>this.showModal('privacyRequests'));y+=48;}this.button(20,y,s.w-40,'服务与隐私说明',()=>this.navigate('privacy'));y+=52;});this.extent=y-(this.bodyTop-this.scroll);}

export function drawWelcomeHeroPanel(this:AppHost,r:Rect,slot:WelcomeSlot){
  const s=this.stage,c=s.ctx,photo=this.dailyPhoto,tone=slot.tone;
  if(photo)s.image(this.client.asset(photo.src||photo.thumbSrc),r,'cover');else{c.fillStyle=this.colors.placeholder;c.fillRect(r.x,r.y,r.w,r.h);}
  c.save();
  if(tone==='morning'){c.fillStyle='#ffd9bf33';c.fillRect(r.x,r.y,r.w,r.h);const g=c.createLinearGradient(0,r.y,0,r.y+r.h);g.addColorStop(0,'#fff0dcb0');g.addColorStop(.5,'#ffd8bf40');g.addColorStop(1,'#ffd8bf00');c.fillStyle=g;c.fillRect(r.x,r.y,r.w,r.h);}
  if(tone==='dusk'){const g=c.createLinearGradient(0,r.y,0,r.y+r.h);g.addColorStop(0,'#e7a07a40');g.addColorStop(1,'#d9824c80');c.fillStyle=g;c.fillRect(r.x,r.y,r.w,r.h);}
  if(tone==='night'){
   c.fillStyle='#231d4459';c.fillRect(r.x,r.y,r.w,r.h);const g=c.createLinearGradient(0,r.y,0,r.y+r.h*.55);g.addColorStop(0,'#1c173a66');g.addColorStop(1,'#1c173a00');c.fillStyle=g;c.fillRect(r.x,r.y,r.w,r.h*.55);
   // Pixel stars along the top; the 1 s lobby tick makes a couple of them blink.
   const second=Math.floor(Date.now()/1000),alpha=c.globalAlpha;
   [[.07,.12,3],[.19,.3,2],[.31,.09,2],[.47,.2,3],[.63,.08,2],[.78,.24,3],[.91,.1,2]].forEach(([fx,fy,size],index)=>{const x=Math.round(r.x+fx*r.w),y=Math.round(r.y+fy*r.h);
    c.globalAlpha=alpha*((second+index)%3===0?.4:1);c.fillStyle='#fff6dc';c.fillRect(x-1.5,y-1.5,3,3);if(size>2){c.fillStyle='#f1d498';c.fillRect(x-1,y-5.5,2,3.5);c.fillRect(x-1,y+2,2,3.5);c.fillRect(x-5.5,y-1,3.5,2);c.fillRect(x+2,y-1,3.5,2);}});
  }
  c.restore();
  if(!photo){const glyph=tone==='night'?'themeMoon':'themeSun',size=Math.min(56,r.h*.4);s.icon(glyph,{x:r.x+(r.w-size)/2,y:r.y+(r.h-size)/2,w:size,h:size},tone==='night'?'#fff6dc':this.colors.gold);return;}
  const label='今日拼图 · '+(photo.title||'每日拼图'),size=11,lw=Math.min(r.w-16,s.measure(label,size,700)+30),chip={x:r.x+8,y:r.y+r.h-28,w:lw,h:20};
  c.save();c.globalAlpha*=.86;c.fillStyle='#573b40';c.fillRect(chip.x,chip.y,chip.w,chip.h);c.restore();s.icon('piece',{x:chip.x+5,y:chip.y+3,w:14,h:14},'#fff8ed');s.textCentered(label,chip.x+22,chip.y+chip.h/2,size,'#fff8ed',700,chip.w-28);
 }

export function drawWelcomeArtPanel(this:AppHost,r:Rect){
  const c=this.stage.ctx;c.save();c.beginPath();c.moveTo(r.x,r.y);c.lineTo(r.x+r.w,r.y);c.lineTo(r.x+r.w,r.y+r.h*.56);c.lineTo(r.x+r.w*.6,r.y+r.h*.56);c.lineTo(r.x+r.w*.6,r.y+r.h);c.lineTo(r.x,r.y+r.h);c.closePath();c.clip();this.stage.icon('friendArt',r);c.restore();
  // A flower from the same sprite set hides the cut where the add-friend badge was.
  this.stage.icon('flower',{x:r.x+r.w*.5,y:r.y+r.h*.5,w:r.w*.44,h:r.h*.46});
 }

export function drawWelcomePanel(this:AppHost){
  const view=this.welcome;if(!view){this.modal=null;return;}
  const s=this.stage,c=s.ctx,v=this.platform.viewport(),landscape=this.layout==='phoneLandscape',{slot,tie}=view,t=clamp((Date.now()-view.openedAt)/180,0,1),ease=1-(1-t)**3,lift=Math.round((1-ease)*12);
  if(t<1&&this.welcomeFrame==null&&this.platform.frame)this.welcomeFrame=this.platform.frame(()=>{this.welcomeFrame=null;if(!this.destroyed&&this.modal==='welcome')this.invalidate();});
  c.save();c.globalAlpha=ease;
  c.fillStyle=this.colors.overlay;c.fillRect(0,0,s.w,s.h);s.hit({x:0,y:0,w:s.w,h:s.h},()=>this.closeWelcome());
  const story=tie?.kind==='story',pill=tie&&tie.kind!=='away'?tie:null,ink=this.colors.ink,muted=this.colors.muted,availH=s.h-v.top-v.bottom-24;
  const wrapLine=(width:number)=>{const lines:string[]=[];let row='';for(const ch of view.line){if(s.measure(row+ch,14)>width){lines.push(row);row=ch;}else row+=ch;}if(row)lines.push(row);return lines.slice(0,2);};
  const textBlock=(x:number,y:number,w:number,art:number,artTop=-2)=>{
   // Chip: sun or moon and the slot greeting (no clock: players read it as a wrong time).
   const chipLabel=slot.greeting,chip={x,y,w:s.measure(chipLabel,12,700)+40,h:26};s.frame(chip,'button-linen-normal');
   s.icon(slot.tone==='night'?'themeMoon':'themeSun',{x:chip.x+8,y:chip.y+5,w:16,h:16},slot.tone==='night'?this.colors.gold:'#d9915a');s.textCentered(chipLabel,chip.x+28,chip.y+chip.h/2,12,muted,700);
   if(art)this.drawWelcomeArt({x:x+w-art,y:y+artTop,w:art,h:Math.round(art*66/70)});
   let cy=y+38;s.text('欢迎回家',x,cy,24,ink,800,w-art-6);cy+=36;
   const lines=wrapLine(w-art);lines.forEach((text,index)=>s.text(text,x,cy+index*22,14,muted,500,w-art));cy+=lines.length*22+8;
   if(pill){const size=13,pw=Math.min(w,s.measure(pill.text,size,700)+46),r={x,y:cy,w:pw,h:30};s.frame(r,'rail-cream-normal');s.icon(pill.icon,{x:r.x+9,y:r.y+6,w:18,h:18});s.textCentered(pill.text,r.x+33,r.y+r.h/2,size,ink,700,pw-40);cy+=40;}
   return cy;
  };
  const buttons=(x:number,y:number,w:number,h:number)=>{const primary=Math.round(w*.6);s.button({x,y,w:primary,h},story?'继续故事':'开拼 · 108 片',()=>this.welcomePrimary(),{tone:'berrydark',icon:story?'story':'daily',fontSize:15,disabled:this.busy});s.button({x:x+primary+10,y,w:w-primary-10,h},'先逛逛',()=>this.closeWelcome(),{fontSize:15});};
  let panel:Rect;
  if(landscape){
   // Hero left, text right; the panel is only as tall as the text column needs.
   const w=Math.min(s.w-32,640),heroW=Math.round(w*.47),tw=w-heroW-56,art=tw>=260?64:0,lines=wrapLine(tw-art).length,h=Math.min(availH,Math.max(232,22+74+lines*22+8+(pill?40:0)+12+42+20)),x=Math.round((s.w-w)/2),y=Math.round(v.top+12+(availH-h)/2)+lift;panel={x,y,w,h};
   s.hit(panel,()=>{});s.panel(panel);
   const hero={x:x+12,y:y+12,w:heroW,h:h-24};this.drawWelcomeHero(hero,slot);
   const tx=hero.x+hero.w+20;textBlock(tx,y+22,tw,art,30);buttons(tx,y+h-62,tw,42);
  }else{
   const w=Math.min(s.w-32,420),heroH=Math.round(clamp((w-24)*.52,120,200)),art=70,lines=wrapLine(w-40-art).length,h=Math.min(availH,12+heroH+18+74+lines*22+8+(pill?40:0)+10+44+20),x=Math.round((s.w-w)/2),y=Math.round(v.top+12+(availH-h)/2)+lift;panel={x,y,w,h};
   s.hit(panel,()=>{});s.panel(panel);
   const hero={x:x+12,y:y+12,w:w-24,h:heroH};this.drawWelcomeHero(hero,slot);
   textBlock(x+20,hero.y+hero.h+18,w-40,art);buttons(x+20,y+h-64,w-40,44);
  }
  s.ornaments(panel,18);
  s.button({x:panel.x+panel.w-42,y:panel.y+8,w:30,h:30},'',()=>this.closeWelcome(),{icon:'close'});
  this.modalArea=panel;this.modalExtent=0;this.modalScroll=0;
  c.restore();
 }

export function drawOrientationPickerPanel(this:AppHost){
  const s=this.stage,v=this.platform.viewport(),w=Math.min(s.w-32,420),tileH=clamp(s.h-v.top-v.bottom-216,84,116),h=tileH+184,x=(s.w-w)/2,y=v.top+(s.h-v.top-v.bottom-h)/2,left=x+20,width=w-40,tileW=(width-12)/2,cy=y+80;
  s.ctx.fillStyle=this.colors.overlay;s.ctx.fillRect(0,0,s.w,s.h);s.hit({x:0,y:0,w:s.w,h:s.h},()=>{});s.panel({x,y,w,h});
  const centered=(label:string,top:number,size:number,color:string,weight=500)=>s.text(label,x+(w-s.measure(label,size,weight))/2,top,size,color,weight,w-40);
  this.modalArea={x,y,w,h};this.modalExtent=0;this.modalScroll=0;
  s.button({x:x+w-38,y:y+8,w:28,h:28},'',()=>this.closeModal(),{icon:'close',disabled:this.orientationSwitching});
  centered('选择屏幕方向',y+20,20,this.colors.ink,700);centered('点一下立即切换，选好后点确认',y+51,13,this.colors.muted);
  const options:readonly(readonly[ScreenOrientation,string,string])[]=[['landscape','横屏','画面更宽'],['portrait','竖屏','单手更顺']];
  options.forEach(([value,label,caption],index)=>{
   const tile={x:left+index*(tileW+12),y:cy,w:tileW,h:tileH};s.button(tile,'',()=>void this.chooseOrientation(value),{selected:this.orientationChoice===value,disabled:this.orientationSwitching});
   const c=s.ctx,on=this.orientationChoice===value,tint=on?this.colors.rose:this.colors.ink,dw=value==='landscape'?44:28,dh=value==='landscape'?28:44,dx=tile.x+(tile.w-dw)/2,dy=tile.y+(tile.h-46-dh)/2,r=5;
   // The pixel frame's selected state is subtle; a rose inner ring makes the current choice obvious.
   c.save();if(on){c.strokeStyle=this.colors.rose;c.lineWidth=3;c.strokeRect(tile.x+6.5,tile.y+6.5,tile.w-13,tile.h-13);}c.strokeStyle=tint;c.lineWidth=2;c.beginPath();c.moveTo(dx+r,dy);c.arcTo(dx+dw,dy,dx+dw,dy+dh,r);c.arcTo(dx+dw,dy+dh,dx,dy+dh,r);c.arcTo(dx,dy+dh,dx,dy,r);c.arcTo(dx,dy,dx+dw,dy,r);c.closePath();c.stroke();c.fillStyle=tint;c.beginPath();c.arc(value==='landscape'?dx+dw-5:dx+dw/2,value==='landscape'?dy+dh/2:dy+dh-5,1.5,0,Math.PI*2);c.fill();c.restore();
   s.text(label,tile.x+(tile.w-s.measure(label,16,700))/2,tile.y+tile.h-46,16,this.colors.ink,700);s.text(caption,tile.x+(tile.w-s.measure(caption,12))/2,tile.y+tile.h-26,12,this.colors.muted);
   if(on)s.icon('check',{x:tile.x+tile.w-28,y:tile.y+10,w:18,h:18},this.colors.rose);
  });
  centered('之后也能点右上角的旋转按钮随时切换',cy+tileH+12,12,this.colors.muted);s.button({x:left,y:cy+tileH+42,w:width,h:42},'确认',()=>this.confirmOrientation(),{tone:'berry',fontSize:15,disabled:this.orientationSwitching});
 }
