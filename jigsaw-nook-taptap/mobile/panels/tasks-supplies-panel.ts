import type {Rect} from '../ports';
import {weeklyTaskRow} from '../retention';
import {type AppHost,clamp,taskCoinsText} from './shared';

export function drawTasksPanel(this:AppHost,inWindow=false){
  const s=this.stage,data=this.tasks,p=this.client.profile,pad=12,w=s.w-24,columns=w>=740?2:1,gap=16,cw=(w-gap*(columns-1))/columns;let y=this.bodyTop;
  if(!this.desktop&&!inWindow){s.icon('avatar',{x:pad,y,w:40,h:43});s.text('Lv.'+(p?.level??1),pad+47,y+3,15,this.colors.ink,700);s.meter({x:pad+47,y:y+26,w:70,h:7},(p?.xp??0)/Math.max(1,p?.xpToNext??1));s.icon(this.energyEnabled?'lightning':'coin',{x:s.w-130,y:y+8,w:23,h:27});s.text(this.energyEnabled?(this.energyUnlimitedToday?'今日无限':(p?.energy??0)+'/'+(p?.energyCap??0)):String(p?.collection?.coins??0),s.w-99,y+14,15,this.energyEnabled&&this.energyUnlimitedToday?this.colors.berry:this.colors.ink,700,83);if(!this.energyEnabled)s.hit({x:s.w-134,y,w:118,h:45},()=>this.showModal('coins'));y+=55;}
  const tabW=Math.min(220,(w-8)/2),tabH=inWindow?32:38;s.button({x:pad,y,w:tabW,h:tabH},'拼图任务',()=>this.setTaskTab('tasks'),{tone:this.taskTab==='tasks'?'berry':'cream',icon:'daily',fontSize:inWindow?13:15});s.button({x:pad+tabW+8,y,w:tabW,h:tabH},'我的礼包',()=>this.setTaskTab('gifts'),{tone:this.taskTab==='gifts'?'berry':'cream',icon:'gift',fontSize:inWindow?13:15});
  if(!inWindow){const label='补给站',bw=s.measure(label,13,750)+50,wide=w>=tabW*2+8+bw+8;s.button({x:wide?pad+w-bw:pad,y:wide?y:y+tabH+8,w:bw,h:wide?tabH:32},label,()=>this.navigate('supplies'),{icon:'store',fontSize:13});if(!wide)y+=40;}
  this.bodyTop=y+tabH+(inWindow?10:15);if(!data){s.text('正在整理任务与礼包…',pad+8,this.bodyTop+25,14);this.extent=0;return;}
  let cy=this.bodyTop-this.scroll;const gifts=data.inventory.filter(gift=>gift.count>0&&this.giftVisible(gift)),giftCount=gifts.reduce((n,g)=>n+g.count,0),full=(p?.energy??0)>=(p?.energyCap??1),unlimited=this.energyUnlimitedToday;
  const drawGift=(gift:typeof gifts[number],r:Rect)=>{s.panel(r);const art=gift.effect==='full-energy'&&this.energyEnabled?'refillGift':gift.kind.startsWith('ten')?'pouch':gift.kind.startsWith('friend')?'goldGift':'xpChest';s.icon(art,{x:r.x+13,y:r.y+17,w:55,h:57});const title=!this.energyEnabled&&gift.effect==='full-energy'?'邀请礼包':gift.title;s.text(title+' ×'+gift.count,r.x+80,r.y+16,15,this.colors.ink,750,r.w-94);let ry=r.y+45;
   const range=(min:number,max:number)=>String(min)+(max!==min?'～'+max:'');const lines=[this.energyEnabled?(gift.effect==='full-energy'?'恢复至当前体力上限':'体力 +'+range(gift.energyMin,gift.energyMax)):'',(gift.xpMax??gift.xp)>0?'经验 +'+range(gift.xpMin??gift.xp,gift.xpMax??gift.xp):'',(gift.coinsMax??gift.coins??0)>0?'金币 +'+range(gift.coinsMin??gift.coins??0,gift.coinsMax??gift.coins??0):''].filter(Boolean);for(const line of lines){s.text(line,r.x+80,ry,12,this.colors.muted,500,r.w-94);ry+=19;}
   const blocked=this.energyEnabled&&gift.effect==='full-energy'&&(full||unlimited);s.button({x:r.x+12,y:r.y+r.h-45,w:r.w-24,h:34},blocked?(unlimited?'今日无限':'体力已满'):gift.effect==='full-energy'&&this.energyEnabled?'使用一份':'开启一份',()=>void this.openGift(gift.kind),{tone:'berry',fontSize:12,disabled:this.busy||blocked});};
  const drawTask=(task:typeof data.tasks[number],r:Rect)=>{s.panel(r);const title=task.title||({beginner:'新手任务',sharing:'分享邀请',invitation:'邀请好友',friend:'好友默契',cooperation:'今日拼合'}[task.group]),art=task.group==='sharing'?'invitationArt':task.group==='invitation'||task.group==='friend'?'friendArt':'cooperationArt';s.icon(art,{x:r.x+12,y:r.y+17,w:53,h:55});s.text(title,r.x+77,r.y+16,16,this.colors.ink,750,r.w-92);const copy=task.group==='sharing'?'每日分享最多 '+task.target+' 次':task.group==='invitation'?'好友完成 '+data.invitation.requiredContributions+' 次有效拼合':'完成 '+task.target+' 次'+(task.group==='friend'?'好友':'')+'拼合';s.text(copy,r.x+77,r.y+45,11,this.colors.muted,500,r.w-92);
   const reward=this.energyEnabled&&task.effect==='full-energy'?'补满体力包'+(task.xp?' · 经验 +'+task.xp:'')+taskCoinsText(task.coins??0):this.rewardText(task.energy,task.xp,task.coins??0);s.text(reward,r.x+14,r.y+86,12,this.colors.ink,600,r.w-28);
   const label=Math.min(task.progress,task.target)+' / '+task.target;s.meter({x:r.x+14,y:r.y+112,w:r.w-87,h:8},task.progress/Math.max(1,task.target));s.text(label,r.x+r.w-66,r.y+108,11,this.colors.muted,700,56);
   const actionable=task.group==='sharing'||task.group==='invitation'||task.earned,action=()=>task.group==='sharing'?void this.shareInvitation():task.group==='invitation'?this.showModal('invite'):this.setTaskTab('gifts');s.button({x:r.x+12,y:r.y+r.h-45,w:r.w-24,h:33},task.group==='sharing'?'分享邀请':task.group==='invitation'?'邀请好友':task.earned?'查看已存礼包':'进行中',action,{tone:actionable?'berry':'cream',fontSize:12,disabled:this.busy||!actionable});};
  const drawGrid=<T,>(items:T[],height:number,draw:(item:T,r:Rect)=>void)=>{const base=cy;items.forEach((item,index)=>{const r={x:pad+(index%columns)*(cw+gap),y:base+Math.floor(index/columns)*(height+gap),w:cw,h:height};if(r.y+r.h>=this.bodyTop&&r.y<=this.bodyBottom)draw(item,r);});cy+=Math.ceil(items.length/columns)*(height+gap);};
  this.scrolled(()=>{if(this.taskTab==='tasks'){
   const giftRow=this.retentionCapable('weeklyGift')?weeklyTaskRow(this.retention?.weeklyGift??null):null;
   if(giftRow){s.button({x:pad,y:cy,w,h:39},giftRow,()=>this.openWeeklyGift(),{icon:'gift',tone:this.retention?.weeklyGift.available?'gold':'cream',fontSize:14});cy+=51;}
   const beginner=data.tasks.filter(task=>task.group==='beginner');if(beginner.length){s.text('新手任务',pad+2,cy+3,17,this.colors.ink,750);cy+=35;drawGrid(beginner,100,(task,r)=>{s.panel(r);s.icon('coin',{x:r.x+12,y:r.y+14,w:26,h:26});s.text(task.title,r.x+47,r.y+17,14,this.colors.ink,700,r.w-137);s.text('金币 +'+(task.coins??0),r.x+r.w-85,r.y+19,12,this.colors.ink,700,73);s.meter({x:r.x+14,y:r.y+54,w:r.w-91,h:8},task.progress/task.target);s.text(task.progress+' / '+task.target,r.x+r.w-69,r.y+50,11,this.colors.muted,700,57);s.text('达成自动领取 · 每档仅一次',r.x+14,r.y+76,10,this.colors.muted,500,r.w-28);});}
   s.panel({x:pad,y:cy,w,h:85});s.text('十格小礼',pad+15,cy+15,15,this.colors.ink,750);const slotsX=pad+103,slotsW=Math.min(320,w-168),slotW=slotsW/10,slotSize=Math.min(22,Math.max(8,slotW-3));for(let i=0;i<10;i++)s.icon('piece',{x:slotsX+i*slotW+(slotW-slotSize)/2,y:cy+24-slotSize/2,w:slotSize,h:slotSize},i<data.giftProgress?this.colors.rose:this.colors.line);s.text(data.giftProgress+'/10',slotsX+slotsW+8,cy+18,12,this.colors.ink,700);const smallReward=[this.energyEnabled?'体力 +'+(data.giftMinimum??1)+'～'+data.giftMaximum:'',(data.giftXp??0)>0?'经验 +'+data.giftXp:'',(data.giftCoins??0)>0?'金币 +'+data.giftCoins:''].filter(Boolean).join(' · ');s.text('每 10 次有效拼合存入小礼'+(smallReward?'：'+smallReward:''),pad+15,cy+55,11,this.colors.muted,500,w-30);s.hit({x:pad,y:cy,w,h:85},()=>this.setTaskTab('gifts'));cy+=101;
   const featured=data.tasks.filter(t=>t.group==='sharing'||t.group==='invitation');drawGrid(featured,180,drawTask);s.text('今日任务',pad+2,cy+3,17,this.colors.ink,750);cy+=35;drawGrid(data.tasks.filter(t=>t.group==='cooperation'||t.group==='friend'),180,drawTask);
   s.button({x:pad,y:cy,w,h:39},'查看已存礼包 · '+giftCount+' 份',()=>this.setTaskTab('gifts'),{icon:'gift',fontSize:14});cy+=54;
  }else{s.text('存下的小确幸',pad+2,cy+3,19,this.colors.ink,750);s.text('礼包可积累，开启后收下本次奖励',pad+2,cy+33,12,this.colors.muted);cy+=68;if(gifts.length)drawGrid(gifts,168,drawGift);else{s.icon('xpChest',{x:s.w/2-48,y:cy+13,w:96,h:83});const message='继续拼图，收下下一份小礼';s.text(message,(s.w-s.measure(message,14))/2,cy+116,14,this.colors.muted);cy+=177;}const resumeW=Math.min(260,w);s.button({x:pad+(w-resumeW)/2,y:cy,w:resumeW,h:39},'继续拼图',()=>inWindow?this.showModal(null):this.back(),{tone:'berry',fontSize:14});cy+=54;}
  });this.extent=cy-(this.bodyTop-this.scroll)+12;
 }

export function drawTasksPagePanel(this:AppHost){
  const s=this.stage,data=this.tasks,p=this.client.profile,pad=12,w=s.w-24,two=w>=760,gap=16,colW=two?(w-gap)/2:w,ink=this.colors.ink,muted=this.colors.muted;
  if(!data){s.text('正在整理任务与礼包…',pad+8,this.bodyTop+25,14);this.extent=0;return;}
  const columns=[pad,two?pad+colW+gap:pad];let left=this.bodyTop-this.scroll,right=two?left:0;
  const section=(column:0|1,title:string,height:number,draw:(x:number,y:number,w:number)=>void)=>{const x=columns[column],y=column===0||!two?left:right,r={x,y,w:colW,h:height};if(y+height>=this.bodyTop-20&&y<=this.bodyBottom+20){s.panel(r);s.text(title,x+16,y+14,17,ink,800,colW-32);draw(x+16,y+44,colW-32);}if(column===0||!two)left+=height+14;else right+=height+14;return y;};
  let supplyY=0;
  this.scrolled(()=>{
   // 1. 十格小礼
   section(0,'十格小礼',118,(x,y,cw)=>{const slot=Math.min(30,(cw-60)/10);for(let i=0;i<10;i++)s.icon('fragment',{x:x+i*(slot+2),y,w:slot,h:slot},i<data.giftProgress?undefined:this.colors.line);if(data.giftProgress<10){s.ctx.save();s.ctx.globalAlpha=.55;s.ctx.fillStyle=this.colors.cream;for(let i=data.giftProgress;i<10;i++)s.ctx.fillRect(x+i*(slot+2),y,slot,slot);s.ctx.restore();}
    s.text(data.giftProgress+'/10',x+10*(slot+2)+6,y+slot/2-8,15,ink,800);const left=Math.max(0,10-data.giftProgress),reward=[this.energyEnabled?'体力 +'+(data.giftMinimum??1)+'～'+data.giftMaximum:'',(data.giftXp??0)>0?'经验 +'+data.giftXp:'',(data.giftCoins??0)>0?'金币 +'+data.giftCoins:''].filter(Boolean).join(' · ');
    s.text('再拼合 '+left+' 次就能存下一份'+(reward?' · '+reward:''),x,y+slot+12,13,muted,600,cw);});
   // 2. 今日任务
   const daily=data.tasks.filter(task=>task.group==='cooperation'||task.group==='friend');
   section(0,'今日任务',44+daily.length*86+8,(x,y,cw)=>{daily.forEach((task,index)=>{const ty=y+index*86,art=task.group==='friend'?'friendArt':'cooperationArt',done=task.earned||task.progress>=task.target,copy='完成 '+task.target+' 次'+(task.group==='friend'?'好友':'')+'拼合',reward=this.energyEnabled&&task.effect==='full-energy'?'补满体力包'+(task.xp?' · 经验 +'+task.xp:''):this.rewardText(task.energy,task.xp,task.coins??0);
     s.icon(art,{x,y:ty,w:44,h:46});s.text(task.title||copy,x+54,ty+2,15,ink,800,cw-160);s.text(copy,x+54,ty+22,12,muted,600,cw-150);s.meter({x:x+54,y:ty+44,w:cw-134,h:8},task.progress/Math.max(1,task.target));s.text(Math.min(task.progress,task.target)+'/'+task.target,x+cw-74,ty+40,12,muted,700,40);
     if(done)s.text('✓ 礼包已存入',x+cw-92,ty+4,12,'#879864',800,92);s.text('奖励 '+reward,x+54,ty+58,12,done?muted:ink,700,cw-54);});});
   // 3. 新手任务
   const beginner=data.tasks.filter(task=>task.group==='beginner'),current=beginner.find(task=>task.progress<task.target)??beginner[beginner.length-1];
   if(current)section(0,'新手任务',118,(x,y,cw)=>{s.icon('coin',{x,y,w:28,h:30});s.text(current.title,x+38,y+4,15,ink,800,cw-140);s.text('金币 +'+(current.coins??0),x+cw-s.measure('金币 +'+(current.coins??0),14,800),y+5,14,ink,800);s.meter({x,y:y+40,w:cw-70,h:9},current.progress/Math.max(1,current.target));s.text(Math.min(current.progress,current.target)+' / '+current.target,x+cw-62,y+35,13,muted,700,62);s.text('达成自动领取 · 共 '+beginner.length+' 档',x,y+56,12,muted,600,cw);});
   // 4. 我的礼包
   const gifts=data.inventory.filter(gift=>gift.count>0&&this.giftVisible(gift)),full=(p?.energy??0)>=(p?.energyCap??1),unlimited=this.energyUnlimitedToday,giftCols=colW>=420?3:2,giftW=(colW-32-(giftCols-1)*10)/giftCols,giftRows=Math.ceil(gifts.length/giftCols);
   section(1,'我的礼包',gifts.length?44+giftRows*136+56:150,(x,y,cw)=>{
    if(!gifts.length){s.icon('xpChest',{x,y,w:56,h:48});s.text('继续拼图，收下下一份小礼',x+68,y+16,13,muted,600,cw-68);return;}
    gifts.forEach((gift,index)=>{const gx=x+(index%giftCols)*(giftW+10),gy=y+Math.floor(index/giftCols)*136,r={x:gx,y:gy,w:giftW,h:126},art=gift.effect==='full-energy'&&this.energyEnabled?'refillGift':gift.kind.startsWith('ten')?'pouch':gift.kind.startsWith('friend')?'goldGift':'xpChest',blocked=this.energyEnabled&&gift.effect==='full-energy'&&(full||unlimited);
     s.frame(r,'button-linen-normal');s.icon(art,{x:gx+(giftW-52)/2,y:gy+8,w:52,h:50});const title=(!this.energyEnabled&&gift.effect==='full-energy'?'邀请礼包':gift.title)+' ×'+gift.count;s.text(title,gx+(giftW-Math.min(giftW-12,s.measure(title,13,700)))/2,gy+62,13,ink,700,giftW-12);
     s.button({x:gx+8,y:gy+84,w:giftW-16,h:34},blocked?(unlimited?'今日无限':'体力已满'):'开启',()=>void this.openGift(gift.kind),{tone:'berry',fontSize:13,disabled:this.busy||blocked});});
    const allLabel=this.onlyLargeTenGifts?.()?'全部开启（每次 20 份）':'全部开启';
    s.button({x,y:y+giftRows*136+4,w:cw,h:38},allLabel,()=>void this.openAllGifts(),{tone:'berrydark',fontSize:14,disabled:this.busy});});
   // 5. 补给
   const tickets=this.usesCreationTickets,energy=this.energyEnabled,wechat=this.platform.config?.id==='wechat',adLabel=wechat?'观看广告':'观看 TapTap 广告',adCount=this.energyAdCountToday,adLimit=this.energyAdLimitToday;
   // Narrow portrait: the energy buttons move to their own row when space beside the title is tight.
   const energyTitle='补满体力包 '+(p?.supply.energy??0)+'/3',energyLine=unlimited?'今日无限体力生效中 · 当日不限体力':'体力 '+(p?.energy??0)+'/'+(p?.energyCap??0)+' · 今日广告 '+adCount+'/'+adLimit+'（满'+adLimit+'次无限）',energyButtonsW=72+130,energyStacked=energy&&38+Math.max(s.measure(energyTitle,15,800),s.measure(energyLine,12,600))+12+energyButtonsW>colW-32;
   if(tickets||energy){supplyY=section(1,'补给',44+(tickets?70:0)+(energy?(energyStacked?106:70):0)+10,(x,y,cw)=>{let ry=y;
    if(energy){const stock=p?.supply.energy??0,textW=energyStacked?cw-38:cw-50-energyButtonsW;s.icon('lightning',{x,y:ry,w:28,h:38});s.text(energyTitle,x+38,ry+2,15,ink,800,textW);s.text(energyLine,x+38,ry+24,12,unlimited?this.colors.berry:muted,unlimited?700:600,textW);
     const useOptions={fontSize:13,disabled:this.busy||!p||unlimited||stock===0||(p?.energy??0)>=(p?.energyCap??0)},useLabel=unlimited?'已无限':'使用',energyAdLabel=unlimited?'今日无限体力':stock>=3?'库存已满':adLabel,energyAdDisabled=this.busy||unlimited||stock>=3;
     if(this.supplyAdAvailable&&!unlimited&&stock<3)this.prepareRewardedAd();
     if(energyStacked){const bw=(cw-8)/2,by=ry+50;
      s.button({x,y:by,w:bw,h:34},energyAdLabel,()=>void this.claimSupply('energy'),{tone:'berry',fontSize:12,disabled:energyAdDisabled});
      s.button({x:x+bw+8,y:by,w:bw,h:34},useLabel,()=>void this.useEnergy(),useOptions);ry+=106;}
     else{const bw=72,adW=124;s.button({x:x+cw-bw,y:ry+4,w:bw,h:34},useLabel,()=>void this.useEnergy(),useOptions);
      s.button({x:x+cw-bw-adW-6,y:ry+4,w:adW,h:34},energyAdLabel,()=>void this.claimSupply('energy'),{tone:'berry',fontSize:12,disabled:energyAdDisabled});ry+=70;}}
    if(tickets){const stock=p?.supply.create??0;s.icon('ticket',{x,y:ry,w:34,h:36});s.text('建房券 '+stock+'/3',x+44,ry+2,15,ink,800,cw-176);s.text('私人房或指定图片时使用',x+44,ry+24,12,muted,600,cw-176);
     if(this.supplyAdAvailable)this.prepareRewardedAd();
     s.button({x:x+cw-124,y:ry+4,w:124,h:34},stock>=3?'库存已满':adLabel,()=>void this.claimSupply('create'),{tone:'berry',fontSize:12,disabled:this.busy||stock>=3||!this.ticketClaimAvailable});}
   });}
   // 6. 邀请好友
   const invitation=data.invitation,invitationTask=data.tasks.find(task=>task.group==='invitation');
   if(!this.inviteRewardsHidden)section(1,'邀请好友',this.energyEnabled?292:222,(x,y,cw)=>{s.icon('invitationArt',{x,y,w:70,h:66});const copy=this.energyEnabled?'每位有效好友体力上限 +1（最多 +5），并送补满体力包'+(invitationTask?.xp?'及 '+invitationTask.xp+' 经验':'')+taskCoinsText(invitationTask?.coins??0):'好友接受邀请并完成 '+(invitation?.requiredContributions??3)+' 次有效拼合，你可获得 '+this.rewardText(0,invitationTask?.xp??0,invitationTask?.coins??0)+'，每日最多 '+(invitation?.dailyLimit??3)+' 位。';this.paragraph(copy,x+82,y,cw-82,12,muted);
    if(this.energyEnabled){this.paragraph('好友绑定邀请码并完成 '+(invitation?.requiredContributions??3)+' 次有效拼合；补满包每日最多 '+(invitation?.dailyLimit??3)+' 份。',x,y+76,cw,12,muted);s.text('已加成 '+(invitation?.capBonus??0)+'/'+(invitation?.capBonusMaximum??5),x,y+120,13,this.colors.berry,700);y+=70;}
    s.text('我的邀请码',x,y+84,12,muted,700);s.text(invitation?.code??'正在读取…',x+76,y+80,18,ink,800,cw-76);if(invitation?.code)s.hit({x:x+70,y:y+72,w:Math.min(cw-70,s.measure(invitation.code,18,800)+20),h:34},()=>this.copyInvitationCode(invitation.code));const bw=(cw-10)/2;
    s.button({x,y:y+114,w:bw,h:38},'分享邀请',()=>void this.shareInvitation(),{tone:'berry',icon:'invite',fontSize:14,disabled:this.busy});
    s.button({x:x+bw+10,y:y+114,w:bw,h:38},this.platform.copyText?'复制邀请码':'输入好友邀请码',()=>{if(this.platform.copyText&&invitation?.code)this.copyInvitationCode(invitation.code);else this.showModal('invite');},{fontSize:14});
    s.text('输入好友的邀请码 ›',x,y+160,12,this.colors.berry,700);s.hit({x:x-4,y:y+152,w:140,h:26},()=>this.showModal('invite'));});
  });
  this.extent=Math.max(left,right)+this.scroll-this.bodyTop+12;
  if(this.supplyFocus&&supplyY){this.supplyFocus=false;this.scroll=clamp(supplyY+this.scroll-this.bodyTop-8,0,Math.max(0,this.extent-(this.bodyBottom-this.bodyTop)));this.invalidate();}
 }

export function drawSuppliesPanel(this:AppHost){
  if(!this.energyEnabled){this.drawWebSupplies();return;}
  const s=this.stage,p=this.client.profile,pad=12,w=s.w-pad*2,landscape=s.w>650&&s.w>s.h,adLabel=this.platform.config?.id==='wechat'?'观看广告':'观看 TapTap 广告',unlimited=this.energyUnlimitedToday,adCount=this.energyAdCountToday,adLimit=this.energyAdLimitToday;let y=this.bodyTop-this.scroll+4;
  this.scrolled(()=>{const cw=landscape?(w-12)/2:w,ch=218,start=y;
   for(const [index,[kind,title,description,art,smallArt]]of ([['energy','补满体力包',unlimited?'今日已解锁无限体力，当日拼图不耗体力':'今日广告 '+adCount+'/'+adLimit+'（满'+adLimit+'次今日无限体力）','supplyEnergy','lightning'],['create','建房券','指定图片或私人房间','supplyTicket','ticket']] as const).entries()){
    const x=pad+(landscape?index*(cw+12):0),cy=start+(landscape?0:index*(ch+12)),r={x,y:cy,w:cw,h:ch},imageW=Math.min(110,Math.floor(cw*.32)),imageR={x:x+10,y:cy+10,w:imageW,h:126};s.panel(r);s.clip(imageR,()=>{const edge=Math.max(imageR.w,imageR.h);s.icon(art,{x:imageR.x+(imageR.w-edge)/2,y:imageR.y+(imageR.h-edge)/2,w:edge,h:edge});});
    const dx=x+imageW+20,dw=cw-imageW-32,small=cw<330,stock=p?.supply[kind]??0,energyBlocked=kind==='energy'&&unlimited;
    s.icon(smallArt,{x:dx,y:cy+15,w:22,h:26});s.text(title,dx+28,cy+20,small?16:19,this.colors.ink,700,dw-28);
    this.paragraph(description,dx,cy+52,dw,12,energyBlocked?this.colors.berry:this.colors.ink);
    s.ctx.fillStyle=s.color('#f8e8d8');s.ctx.fillRect(dx,cy+103,dw,28);s.text('库存 '+stock+'/3',dx+8,cy+109,14,this.colors.ink,700,dw-16);
    if(this.supplyAdAvailable&&!energyBlocked&&stock<3)this.prepareRewardedAd();
    s.button({x:x+12,y:cy+150,w:cw-24,h:43},energyBlocked?'今日无限体力':stock>=3?'库存已满':adLabel,()=>void this.claimSupply(kind),{tone:'berry',fontSize:14,disabled:this.busy||energyBlocked||stock>=3});
   }y=start+(landscape?ch:2*ch+12)+12;
   s.panel({x:pad,y,w,h:40},'linen');s.icon('store',{x:pad+10,y:y+5,w:31,h:28});s.text('已购图包可免费创建公开房间。',pad+49,y+14,11,this.colors.ink,700,w-92);s.icon('sprig',{x:s.w-pad-31,y:y+11,w:22,h:20});y+=52;
   const inventory={x:pad,y,w,h:100};s.panel(inventory);s.icon('bag',{x:pad+13,y:y+11,w:17,h:18},this.colors.ink);s.text('我的库存',pad+37,y+12,18,this.colors.ink,700);s.ctx.fillStyle=s.color('#dfbdad');s.ctx.fillRect(pad+9,y+38,w-18,1);
   const slotW=(w-24)*.31,bx=pad+18+slotW*2,bw=s.w-pad-bx-11;
   for(const[index,[kind,label,art]]of ([['energy','体力包','energy'],['create','建房券','ticket']] as const).entries()){const sx=pad+12+index*slotW;s.icon(art,{x:sx,y:y+48,w:31,h:38});s.text(label,sx+35,y+47,10,this.colors.ink,700);s.ctx.fillStyle=s.color('#f8e8d8');s.ctx.fillRect(sx+35,y+64,33,21);s.text(p?.supply[kind]??0,sx+44,y+65,17,this.colors.ink,700);if(index===0){s.ctx.fillStyle=s.color('#dfbdad');s.ctx.fillRect(sx+slotW-4,y+45,1,43);}}
   this.button(bx,y+48,bw,unlimited?'今日无限':p&&p.energy>=p.energyCap?'体力已满':'使用体力包',()=>void this.useEnergy(),'berry',42,!p||unlimited||p.supply.energy===0||p.energy>=p.energyCap);y+=115;
   const note='提前准备，拼图时随用随取';s.text(note,(s.w-s.measure(note,11))/2,y,11,this.colors.muted);y+=28;
   s.text('回去拼图  →',(s.w-80)/2,y+4,12,this.colors.muted);s.hit({x:pad,y:y-4,w,h:36},()=>this.back());y+=46;
  });this.extent=y-(this.bodyTop-this.scroll)+12;
 }

export function drawWebSuppliesPanel(this:AppHost){
  const s=this.stage,p=this.client.profile,w=Math.min(650,s.w-24),x=(s.w-w)/2,adLabel=this.platform.config?.id==='wechat'?'观看广告':'观看 TapTap 广告';let y=this.bodyTop-this.scroll;
  if(this.formalWeb){this.scrolled(()=>{s.icon('coin',{x:x+12,y:y+8,w:42,h:44});s.text('我的金币 '+(p?.collection?.coins??0),x+67,y+17,22,this.colors.ink,750,w-80);y+=76;y=this.paragraph('金币、相册和已拥有内容继续保留。建房条件以当前账号与会员权限为准。',x+8,y,w-16,14)+24;s.button({x:x+8,y,w:w-16,h:40},'账号与会员',()=>this.openWeb('membership'),{fontSize:14});y+=52;});this.extent=y-(this.bodyTop-this.scroll)+12;return;}
  this.scrolled(()=>{s.panel({x,y,w,h:225});s.icon('supplyTicket',{x:x+14,y:y+22,w:140,h:140});s.text('建房券',x+166,y+24,23,this.colors.ink,750,w-183);s.text('指定图片或创建私人房间',x+167,y+64,12,this.colors.muted,500,w-184);s.text('当前库存 '+(p?.supply.create??0)+' / 3',x+167,y+100,17,this.colors.ink,750,w-184);s.button({x:x+17,y:y+169,w:w-34,h:39},(p?.supply.create??0)>=3?'库存已满':adLabel,()=>void this.claimSupply('create'),{tone:'berry',fontSize:13,disabled:this.busy||!this.ticketClaimAvailable||(p?.supply.create??0)>=3});if(this.supplyAdAvailable)this.prepareRewardedAd();y+=247;y=this.paragraph('随机公开房免费创建；已拥有的图包图片，也可免费创建公开房。已有建房券可以正常使用。',x+8,y,w-16,14)+23;s.button({x:x+8,y,w:w-16,h:41},'去挑选图片',()=>this.navigate('gallery'),{icon:'underlay',fontSize:14});y+=55;});this.extent=y-(this.bodyTop-this.scroll)+12;
 }

export function drawTaskWindowPanel(this:AppHost){
  const s=this.stage,v=this.platform.viewport(),w=Math.min(380,s.w-24),bottom=s.h-v.bottom-12,minY=this.route==='room'?this.roomArea.y+8:v.top+12,h=Math.min(560,Math.max(120,bottom-minY)),x=12,y=bottom-h;
  this.taskWindowArea={x,y,w,h};s.panel(this.taskWindowArea);s.hit(this.taskWindowArea,()=>{});
  s.text('任务与礼包',x+16,y+15,18,this.colors.ink,750,w-75);s.button({x:x+w-43,y:y+9,w:30,h:30},'',()=>this.showModal(null));s.icon('close',{x:x+w-40,y:y+12,w:24,h:24},this.colors.ink);
  const area={x:x+8,y:y+46,w:w-16,h:h-58},saved={scroll:this.scroll,extent:this.extent,bodyTop:this.bodyTop,bodyBottom:this.bodyBottom};
  // Reuse task cards while keeping their scroll separate from the page behind the window.
  try{s.withViewport(area,()=>{this.scroll=this.modalScroll;this.extent=this.modalExtent;this.bodyTop=6;this.bodyBottom=s.h-8;this.drawTasks(true);this.scroll=clamp(this.scroll,0,Math.max(0,this.extent-(this.bodyBottom-this.bodyTop)));this.modalScroll=this.scroll;this.modalExtent=this.extent;this.modalArea={x:area.x,y:area.y+this.bodyTop,w:area.w,h:Math.max(0,this.bodyBottom-this.bodyTop)};});}
  finally{Object.assign(this,saved);}
 }
