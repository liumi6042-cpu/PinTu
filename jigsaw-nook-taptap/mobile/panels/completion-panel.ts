import type {Platform,Rect} from '../ports';
import type {CompletionSeat} from '../completion-seats';
import {CHEER_EMOTES} from '../../lib/room-realtime';
import {CHEER_LABELS} from '../cheer-client';
import {drawCheerIcon} from '../cheer-icons';
import {drawCelebration} from '../completion-celebration';
import {chapterProgress,completionPrimary,teaserLine} from '../retention';
import {type AppHost,clamp} from './shared';

export function storyCompletionLinesPanel(this:AppHost,levelId:string|undefined,chapters:readonly {albumId?:string;milestones?:readonly {target:number;coins?:number;earned?:boolean}[];levels:readonly {id:string;status:string;intro?:string|null;line?:string|null}[]}[],maxChars:number):{progress:string;reward:string|null;teaser:string|null}|null{
  if(!levelId)return null;const index=chapters.findIndex(chapter=>chapter.levels.some(level=>level.id===levelId));if(index<0)return null;
  const chapter=chapters[index],levels=chapter.levels,at=levels.findIndex(level=>level.id===levelId),cleared=levels.filter(level=>level.status==='cleared'||level.id===levelId).length;
  const album=this.collection?.albums.find(item=>item.id===chapter.albumId),numbers=['一','二','三','四','五','六','七','八','九','十'];
  const {progress,reward}=chapterProgress({chapterTitle:'第'+(numbers[index]??String(index+1))+'章',cleared,total:levels.length,milestones:album?.milestones??chapter.milestones??[]});
  const next=levels[at+1]??chapters[index+1]?.levels[0],text=next?.intro||next?.line||null,teaser=teaserLine(text,Math.max(6,maxChars-4));
  return {progress,reward,teaser:teaser?'下一关：'+teaser:null};
 }

export function drawCompletionTransitionPanel(this:AppHost){
  const fx=this.completionFx,board=this.board;if(!fx||!board||this.nineGridRoom)return;const s=this.stage,c=s.ctx,now=Date.now(),p=board.pictureScreenRect(),room=this.roomArea,left=Math.max(room.x,p.x-p.w*.2),right=Math.min(room.x+room.w,p.x+p.w*1.2),top=Math.max(room.y,p.y),bottom=Math.min(room.y+room.h,p.y+p.h),area={x:left,y:top,w:right-left,h:bottom-top};
  if(area.w>0&&area.h>0){c.save();c.beginPath();c.rect(room.x,room.y,room.w,room.h);c.clip();drawCelebration(c,fx.celebration,now,{picture:p,field:{x:area.x,y:room.y,w:area.w,h:area.y+area.h-room.y},clip:room});c.restore();}
  const banner=fx.banner(now);if(!banner)return;const label='拼好啦！',w=s.measure(label,15,800)+58,h=32,x=clamp(p.x+p.w/2-w/2,room.x+8,room.x+room.w-w-8),topSafe=this.layout==='phoneLandscape'?this.roomHeaderTop()+58:room.y+10,y=Math.min(p.y+p.h/2,Math.max(topSafe,p.y-42)),scale=banner.scale,r={x:x+w*(1-scale)/2,y:y+h*(1-scale)/2,w:w*scale,h:h*scale};c.save();c.globalAlpha=banner.alpha;s.frame(r,'button-gold-normal');s.text(label,r.x+29*scale,r.y+8*scale,15*scale,this.colors.ink,800);drawCheerIcon(c,'star',{x:r.x+7*scale,y:r.y+8*scale,w:16*scale,h:16*scale});drawCheerIcon(c,'star',{x:r.x+r.w-23*scale,y:r.y+8*scale,w:16*scale,h:16*scale});c.restore();
 }

export function drawSettleButtonPanel(this:AppHost){
  this.settleButtonRect=null;if(!this.room?.snapshot.completedAt||this.completionFx||this.modal!==null||this.nineGridRoom)return;
  // A finished story level always shows the way on, also after its popup was closed.
  const destination=this.room.snapshot.levelId?this.levelDestination():null,label=destination?this.levelNextLabel(destination):'查看结算';
  const area=this.roomArea,safeBottom=this.stage.h-this.platform.viewport().bottom,x=area.x+(area.w-112)/2,y=safeBottom-(this.layout==='phoneLandscape'?12:14)-36;this.settleButtonRect={x,y,w:112,h:36};this.button(x,y,112,label,()=>{if(destination)this.continueLevel(destination);else this.openCompletionPopup();},'gold',36);
 }

export function drawCompletionSeatPanel(this:AppHost,seat:CompletionSeat,r:Rect,vertical=false){
  const s=this.stage,c=s.ctx,avatar=vertical?34:this.layout==='phoneLandscape'?r.w<140?30:34:50,size=vertical?34:this.layout==='phoneLandscape'?avatar:40;r={...r,y:r.y+this.cheerEffects.hop(seat.playerId)};this.completionSeatRects.set(seat.playerId,r);
  c.save();c.globalAlpha=1;s.frame(r,seat.me?'button-cream-selected':'button-linen-normal');
  if(seat.me){c.save();c.globalAlpha*=.12;c.fillStyle=this.colors.berry;c.fillRect(r.x+4,r.y+4,r.w-8,r.h-8);c.restore();}
  // The portrait me tag needs 1px more clearance at the outer avatar edge.
  const mirror=seat.column==='right',ax=vertical?r.x+(r.w-avatar)/2+(seat.me?(mirror?-1:1):0):mirror?r.x+r.w-avatar-6:r.x+6,ay=vertical?r.y+3:r.y+(r.h-avatar)/2;
  const ar={x:ax,y:ay,w:avatar,h:avatar};this.completionAvatarRects.set(seat.playerId,ar);if(!seat.present)c.globalAlpha=.45;s.icon('avatar',ar);if(seat.crown)drawCheerIcon(c,'crown',{x:ax+(avatar-24)/2,y:ay-10,w:24,h:24});
  const p=this.completionPicture,slot={x:vertical?(mirror?(p.x+p.w+r.x)/2:(r.x+r.w+p.x)/2)-size/2:mirror?r.x+6:r.x+r.w-6-size,y:ay+(avatar-size)/2,w:size,h:size};this.completionSlotRects.set(seat.playerId,slot);
  const tx=vertical?r.x+3:mirror?slot.x+size+4:ax+avatar+5,tw=vertical?r.w-6:mirror?ax-5-tx:slot.x-4-tx;
  s.text(seat.name,tx,vertical?r.y+39:r.y+12,vertical?11:12,this.colors.ink,seat.me?800:600,tw);
  s.text('拼合 '+seat.contribution,tx,vertical?r.y+56:r.y+34,vertical?10:11,this.colors.muted,600,tw);
  if(seat.me){const tag={x:mirror?r.x+r.w-17:r.x+3,y:r.y+(vertical?3:-6),w:14,h:13};c.fillStyle=this.colors.berry;c.fillRect(tag.x,tag.y,tag.w,tag.h);s.text('我',tag.x+2,tag.y+1,9,this.colors.onAccent,700);}
  c.restore();
 }

export function drawCompletionSeatsPanel(this:AppHost,panel:Rect){
  this.completionAvatarRects.clear();this.completionSlotRects.clear();
  const seats=this.completionSeats(),landscape=this.layout==='phoneLandscape',v=this.platform.viewport() as ReturnType<Platform['viewport']>&{left?:number;right?:number},w=landscape?this.landscapeSeatWidth(this.stage.w-(v.left??0)-(v.right??0)):176,h=landscape?60:70,gap=landscape?12:16;
  for(const seat of seats){const rows=Math.ceil(seats.length/2),x=landscape?seat.column==='left'?10+(v.left??0):this.stage.w-10-(v.right??0)-w:seat.column==='left'?panel.x-18-w:panel.x+panel.w+18,y=panel.y+(panel.h-(rows*h+(rows-1)*gap))/2+seat.row*(h+gap);this.drawCompletionSeat(seat,{x,y,w,h});}
 }

export function drawCompletionPicturePanel(this:AppHost,r:Rect){
  const s=this.stage;this.completionPicture=r;s.frame(r,'panel-cream');const shown=this.board?.drawCompletedPicture(s.ctx,{x:r.x+6,y:r.y+6,w:r.w-12,h:r.h-12});
  const level=this.chapterForLevel(this.room?.snapshot.levelId)?.levels.find(level=>level.id===this.room?.snapshot.levelId),src=level?this.levelPicture(level).src:'';
  if(!shown&&src)s.image(this.client.asset(src),{x:r.x+6,y:r.y+6,w:r.w-12,h:r.h-12},'contain');
  if(!shown&&!src){s.text(this.imageError?'图片加载失败':'正在加载成品…',r.x+12,r.y+r.h/2-20,13,this.colors.muted,500,r.w-24);if(this.imageError)this.button(r.x+12,r.y+r.h/2+4,r.w-24,'重新加载',()=>void this.run(async()=>{const board=this.board;if(!board)return;await board.setImage(this.roomImage);if(this.board===board){this.imageReady=true;this.imageError='';this.message='';}}),'cream',32);}
  s.ornaments(r,26);
 }

export function drawCompletionBarPanel(this:AppHost,r:Rect){
  this.completionBar=r;const s=this.stage,vertical=this.layout==='phonePortrait',enabled=!!this.room?.snapshot.members.some(member=>member.id===this.room!.ticket.playerId&&member.lastSeen>0),gap=4,bw=(r.w-5*gap)/6;
  CHEER_EMOTES.forEach((emote,i)=>{const b={x:r.x+i*(bw+gap),y:r.y,w:bw,h:r.h};s.ctx.save();if(!enabled)s.ctx.globalAlpha=.45;s.frame(b,this.cheerEffects.pressed(emote)?'button-cream-pressed':'button-cream-normal');
   const size=vertical?24:22,label=CHEER_LABELS[emote],font=vertical?11:this.desktop?14:13,iw=16,lw=s.measure(label,font,700),horizontal=bw>=iw+lw+10;
   drawCheerIcon(s.ctx,emote,{x:vertical||!horizontal?b.x+(bw-size)/2:b.x+(bw-iw-lw-4)/2,y:vertical?b.y+5:horizontal?b.y+(b.h-size)/2:b.y+3,w:size,h:size});
   s.text(label,vertical||!horizontal?b.x+(bw-lw)/2:b.x+(bw-iw-lw-4)/2+iw+6,vertical?b.y+35:horizontal?b.y+(b.h-font)/2:b.y+26,font,this.colors.ink,700,bw-4);
   if(this.desktop)s.text(i+1,b.x+4,b.y+3,9,this.colors.muted);
   const count=this.cheerEffects.count(emote);if(count>=2){const badge='×'+count;s.ctx.fillStyle=this.colors.berry;s.ctx.fillRect(b.x+b.w-25,b.y-4,27,16);s.text(badge,b.x+b.w-23,b.y-3,10,this.colors.onAccent,700,25);}
   if(enabled)s.hit(b,()=>this.sendCompletionCheer(emote));s.ctx.restore();});
 }

export function drawCompletionContentPanel(this:AppHost,left:number,cy:number,width:number,landscape=false,panel?:Rect){
  if(this.offlineRoom)return this.offline.drawCompletion(this.stage,{...this.room!.ticket,room:this.room!.snapshot},left,cy,width,landscape,panel,{picture:r=>this.drawCompletionPicture(r),paragraph:(...args)=>this.paragraph(...args),launch:input=>void this.run(()=>this.launchOffline(input)),back:()=>this.exitRoom(),comic:{available:id=>this.hasLevelComic(id),open:id=>this.openLevelComic(id,{fromClear:true})},story:id=>{const story=this.storyCompletionLines(id,this.offline.view?.chapters??[],Math.floor(width/13));return story?[story.progress+(story.reward?' · '+story.reward:''),...(story.teaser?[story.teaser]:[])]:null;},nextButton:(r,label,action)=>this.breathButton(r,label,action)});
  if(this.postcardRoom){
   const s=this.stage,room=this.room,snap=room?.snapshot,ink=this.colors.ink,muted=this.colors.muted;
   const pieces=room?room.state.cols*room.state.rows:108;
   if(landscape&&panel){const side=Math.min(240,panel.h-90,panel.w*.43);this.drawCompletionPicture({x:panel.x+16,y:panel.y+45,w:side,h:side});left=panel.x+side+32;width=panel.x+panel.w-left-16;cy=panel.y+48;}
   else{const h=Math.min(width*.62,230);this.drawCompletionPicture({x:left,y:cy,w:width,h});cy+=h+16;}
   const title=(snap?.title||'华夏明信片')+' · '+pieces+' 片完成！';
   s.text(title,left,cy,landscape?17:20,ink,800,width);cy+=landscape?28:32;
   const rewardText=this.postcardRewardCoins>0?`已入账主游戏金币 +${this.postcardRewardCoins}（不消耗体力）`:'《华夏行记》高片数挑战已完成，已保存纪念进度。';
   cy=this.paragraph(rewardText,left,cy,width,13)+18;
   s.button({x:left,y:cy,w:width,h:42},'回到团子的小窝',()=>{this.exitRoom();this.openTuanziV2('scrapbook');},{tone:'berry',fontSize:15});cy+=50;
   s.button({x:left,y:cy,w:width,h:40},'返回大厅',()=>this.exitRoom(),{fontSize:14});return cy+48;
  }
  const s=this.stage,room=this.room,snap=room?.snapshot as unknown as {title?:string;tuanziOrigin?:string;photo?:{title?:string;tuanziOrigin?:string};puzzle?:{imageId?:string};startedAt?:number|null;completedAt?:number|null;members?:Array<{name:string;code?:string|null;contribution?:number}>;mobileResult?:any}|undefined,result=snap?.mobileResult,ink=this.colors.ink,muted=this.colors.muted,center=(text:string,y:number,size:number,color:string,weight=700)=>s.text(text,left+Math.max(0,(width-s.measure(text,size,weight))/2),y,size,color,weight,width);
  const seats=this.completionSeats(),levelClear=(result?.levelClear??this.levelDestination()??undefined) as import('../../h5/mobile-api').MobileLevelClear|undefined,chapterComplete=levelClear&&(levelClear.chapterComplete||levelClear.nextLevelId===null),levelLandscape=landscape&&!!levelClear;
  if(!landscape&&!this.completionOutsideSeats(left-20,width+40)){this.completionAvatarRects.clear();this.completionSlotRects.clear();}
  if(landscape&&panel){const side=Math.min(240,panel.h-134,panel.w*.43);this.drawCompletionPicture({x:panel.x+16,y:panel.y+40,w:side,h:side});left=panel.x+16+side+16;width=panel.x+panel.w-16-left;
   // Short screens only lift the column when album reward lines need the room.
   cy=panel.y+Math.max(12,Math.min(42,panel.h-332+18*Math.max(0,2-(result?.catalog?.albumRewards?.length??0))));}
  else if(seats.length&&!this.completionOutsideSeats(left-20,width+40)){
   cy+=5; // Leave the first row clear of the modal heading.
   const side=width-146,rows=Math.ceil(seats.length/2),height=Math.max(side,rows*74+(rows-1)*8);this.drawCompletionPicture({x:left+73,y:cy,w:side,h:side});
   for(const seat of seats)this.drawCompletionSeat(seat,{x:seat.column==='left'?left:left+width-66,y:cy+seat.row*82,w:66,h:74},true);cy+=height+20;
  }else{const picture={x:left,y:cy,w:width,h:Math.min(width*.62,this.desktop?230:240)};this.drawCompletionPicture(picture);cy+=picture.h+20;}
  const title=(snap?.title||snap?.photo?.title||'这幅画')+'，拼好啦！';
  // A lifted landscape title shares the close button's row, so centre it in the space before the button.
  if(landscape&&panel&&cy<panel.y+36){const tw=width-28;s.text(title,left+Math.max(0,(tw-s.measure(title,17,800))/2),cy,17,ink,800,tw);}else center(title,cy,landscape?17:20,ink,800);cy+=levelLandscape?24:landscape?27:32;
  if(chapterComplete){center((this.levels?.chapters.find(chapter=>chapter.levels.some(level=>level.id===levelClear.levelId))?.title||'本章')+'完成！',cy,landscape?13:16,ink,800);cy+=landscape?18:26;}
  const pieces=room?room.state.cols*room.state.rows:0,started=snap?.startedAt,finished=snap?.completedAt,members=(snap?.members??[]).filter(member=>member.name),ranking=Array.isArray(result?.ranking)?result.ranking:null,contributors=ranking??members.filter(member=>(member.contribution??0)>0),together=contributors.length||members.length;
  const meta=[pieces?pieces+' 片':'',started&&finished&&finished>started?'用时 '+Math.max(1,Math.round((finished-started)/60000))+' 分钟':'',together?together+' 人同桌':''].filter(Boolean).join(' · ');  // Story clears: chapter progress + next album reward, then a teaser of the next level. The short landscape panel
  // shows the progress line in place of the table metadata and skips the teaser.
  const story=levelClear?this.storyCompletionLines(levelClear.levelId,this.availableChapters,Math.floor(width/13)):null,storyHead=story?story.progress+(story.reward?' · '+story.reward:''):'';
  if(story&&levelLandscape){center(storyHead,cy,12,ink,700);cy+=20;}
  else{if(meta){center(meta,cy,landscape?12:13,muted,600);cy+=levelLandscape?20:landscape?25:30;}
   if(story){center(storyHead,cy-6,landscape?12:13,ink,700);cy+=landscape?18:22;if(story.teaser){center(story.teaser,cy-6,12,muted,500);cy+=landscape?18:22;}}}
  if(this.cheersEnabled&&!landscape){this.drawCompletionBar({x:left,y:cy,w:width,h:this.layout==='phonePortrait'?58:46});cy+=this.layout==='phonePortrait'?72:60;}
    const baseCoins=result?.coins??0,baseFragments=result?.fragments??0,doubled=result?.doubleClaimed===true,bonusCoins=doubled?(result?.doubleBonus?.coins??baseCoins):0,bonusFragments=doubled?(result?.doubleBonus?.fragments??baseFragments):0;
    const doubleRoomId=result?.roomId||room?.ticket?.room?.id||'',canDouble=Boolean(result&&doubleRoomId&&!this.offlineRoom&&this.supplyAdAvailable&&!doubled&&(baseCoins>0||baseFragments>0));
    if(result){
     const imageId=snap?.puzzle?.imageId,album=imageId?this.collection?.albums.find(item=>item.images.some(image=>image.id===imageId)):undefined;
     const tiles:{icon:string;label:string;gold?:boolean}[]=[{icon:'coin',label:'金币 +'+(baseCoins+bonusCoins),gold:doubled&&bonusCoins>0},{icon:'fragment',label:'碎片 +'+(baseFragments+bonusFragments),gold:doubled&&bonusFragments>0},...(this.energyEnabled&&result.energy?[{icon:'lightning',label:'体力 +'+result.energy}]:[]),...(levelClear?.firstClear&&this.energyEnabled&&levelClear.energy>0?[{icon:'lightning',label:'通关体力 +'+levelClear.energy}]:[]),...(album?[{icon:'book',label:'图集 '+album.collected+'/'+album.total}]:[]),...(landscape?[]:((result.catalog?.albumRewards??[]) as {title:string;coins?:number}[]).map(reward=>({icon:reward.coins?'coin':'leaf',label:reward.coins?'集满 +'+reward.coins:'得到装饰',gold:true})))];
     const gap=levelLandscape?6:8,columns=Math.min(tiles.length,landscape?levelClear?5:4:this.desktop||width>=420?5:4),tileH=levelLandscape?52:landscape?58:64,tw=(width-gap*(columns-1))/columns;
     const weights=levelLandscape?tiles.map(tile=>Math.max(40,s.measure(tile.label,12,700)+8)):[],total=weights.reduce((sum,value)=>sum+value,0);let tileX=left;
     tiles.forEach((tile,index)=>{const tileW=levelLandscape?(width-gap*(columns-1))*weights[index]/total:tw,r={x:levelLandscape?tileX:left+(index%columns)*(tw+gap),y:cy+Math.floor(index/columns)*(tileH+gap),w:tileW,h:tileH};tileX+=tileW+gap;s.frame(r,tile.gold?'panel-gold':'button-linen-normal');s.icon(tile.icon,{x:r.x+(tileW-26)/2,y:r.y+6,w:24,h:24});const base=levelLandscape?12:tw<84?12:13,size=Math.min(base,base*(tileW-8)/s.measure(tile.label,base,700));s.text(tile.label,r.x+Math.max(4,(tileW-s.measure(tile.label,size,700))/2),r.y+(levelLandscape?33:35),size,ink,700,tileW-8);});
     cy+=Math.ceil(tiles.length/columns)*(tileH+gap)+4;
     if(doubled&&(bonusCoins>0||bonusFragments>0)){const bonusText='已看广告双倍领取（额外 '+[bonusCoins>0?'+'+bonusCoins+' 金币':'',bonusFragments>0?'+'+bonusFragments+' 碎片':''].filter(Boolean).join('、')+'）';center(bonusText,cy,landscape?11:12,this.colors.berry,700);cy+=landscape?16:22;}
     if(result.catalog?.newlyCollected){center('这张画作已收进图集',cy,landscape?12:13,muted,600);cy+=levelLandscape?16:landscape?18:26;}
     for(const reward of result.catalog?.albumRewards??[]){center(reward.title+'：'+(reward.coins?'金币 +'+reward.coins:'专属装饰已获得'),cy,landscape?12:13,ink,700);cy+=landscape?18:24;}
    }else{cy=this.paragraph('正在同步本次收获…奖励以服务器结算为准。',left,cy,width,14)+15;}
    const tuanziOrigin=snap?.tuanziOrigin??snap?.photo?.tuanziOrigin??'';
    if(tuanziOrigin){
     const ownsTuanzi=!!snap?.puzzle?.imageId&&!!this.tuanziGalleryIds?.has(snap.puzzle.imageId);
     const head=ownsTuanzi?'团子明信片 · 已收录至你的图库':'团子明信片 · 获得方式说明';
     const body=ownsTuanzi?'通过「团子去旅行」寄回并显影解锁，随时可在图库免费再开公开房。':'获得方式：'+tuanziOrigin+'，解锁后即可在图库找到并自建房！';
     const textH=s.wrap(body,-9999,0,width-20,landscape?11:12,ink,landscape?15:17);
     const showBtn=!ownsTuanzi&&!!this.tuanziV2?.available;
     const boxH=(landscape?24:28)+textH+(showBtn?(landscape?34:42):8);
     s.frame({x:left,y:cy,w:width,h:boxH},'panel-gold');
     s.text(head,left+10,cy+(landscape?5:7),landscape?11.5:13,'#8c4a19',800,width-20);
     s.wrap(body,left+10,cy+(landscape?21:25),width-20,landscape?11:12,ink,landscape?15:17);
     if(showBtn){
      const bh=landscape?26:32;
      s.button({x:left+10,y:cy+boxH-bh-6,w:width-20,h:bh},'去团子小窝收集明信片',()=>{this.leaveRoom();this.openTuanziV2();},{tone:'gold',fontSize:landscape?11.5:13});
     }
     cy+=boxH+(landscape?6:10);
    }
    cy+=landscape?2:6;
    const extra=this.completionFlow.action(this.completionContext()),inlineDouble=canDouble&&landscape&&!extra;
    const doubleRewardParts=[baseCoins>0?'+'+baseCoins+(inlineDouble?'金':' 金币'):'',baseFragments>0?'+'+baseFragments+(inlineDouble?'碎':' 碎片'):''].filter(Boolean).join(' ');
    const doubleLabel=(inlineDouble?'看广告双倍 ':'看广告双倍领取 · ')+doubleRewardParts;
    if(canDouble&&!inlineDouble){
     const dh=landscape?34:42,df=Math.max(12,Math.min(15,15*(width-36)/Math.max(1,s.measure(doubleLabel,15,750))));
     s.button({x:left,y:cy,w:width,h:dh},doubleLabel,()=>void this.claimCompletionDouble(doubleRoomId),{tone:'gold',icon:'coin',fontSize:df,disabled:this.busy});
     cy+=dh+(landscape?6:10);
    }
    const leftAction=extra||(inlineDouble?{label:doubleLabel,tone:'gold' as const,icon:'coin' as const,action:()=>void this.claimCompletionDouble(doubleRoomId),disabled:this.busy}:null),primaryW=leftAction?(width-8)/2:width;
    if(leftAction){const minFont=inlineDouble?11:12,maxFont=inlineDouble?14:16,size=Math.max(minFont,Math.min(maxFont,maxFont*(primaryW-(inlineDouble?28:12))/Math.max(1,s.measure(leftAction.label,maxFont,750))));s.button({x:left,y:cy,w:primaryW,h:landscape?40:46},leftAction.label,leftAction.action,{tone:leftAction.tone??'gold',icon:('icon' in leftAction?leftAction.icon:undefined),fontSize:size,disabled:('disabled' in leftAction?leftAction.disabled:false)});}const pictureAlbum=(snap?.puzzle?.imageId&&this.collection?.albums.find(item=>item.images.some(image=>image.id===snap.puzzle!.imageId))?.id)||'';
    // 拼完必有下一步: next story level, else today's daily, else the albums.
    const primary=completionPrimary({levelLabel:levelClear?this.levelNextLabel(levelClear):null,dailyDone:this.dailyDoneToday(snap?.puzzle?.imageId)}),primaryRect={x:leftAction?left+primaryW+8:left,y:cy,w:primaryW,h:landscape?40:46};
    const primaryAction=()=>{if(primary.kind==='level'&&levelClear)this.continueLevel(levelClear);else if(primary.kind==='daily'){this.leaveRoom();this.launchDaily();}else{this.leaveRoom();this.openCollection('albums');if(pictureAlbum)this.openAlbum(pictureAlbum);}};
    if(primary.kind==='level')this.breathButton(primaryRect,primary.label,primaryAction);else s.button(primaryRect,primary.label,primaryAction,{tone:'berrydark',fontSize:16});cy+=landscape?46:56;
    const third=(width-16)/3,albumId=(snap?.puzzle?.imageId&&this.collection?.albums.find(item=>item.images.some(image=>image.id===snap.puzzle!.imageId))?.id)||'';
    s.button({x:left,y:cy,w:third,h:landscape?34:40},'分享成品',()=>void this.run(async()=>{const outcome=await this.shareFromGame({title:'我们拼好了「'+(snap?.title||snap?.photo?.title||'一幅画')+'」，来'+this.platform.config.gameName+'一起拼',inviteCode:this.tasks?.invitation.code});this.note(outcome==='copied'?'链接已复制，可以发给朋友':outcome==='shared'||outcome==='opened'?'已分享':outcome==='cancelled'?'本次分享已取消':'暂时无法分享');}),{fontSize:13});
    s.button({x:left+third+8,y:cy,w:third,h:landscape?34:40},'查看图集',()=>{this.leaveRoom();this.openCollection('albums');if(albumId)this.openAlbum(albumId);},{fontSize:13});
    s.button({x:left+(third+8)*2,y:cy,w:third,h:landscape?34:40},'回大厅',()=>{this.leaveRoom();this.navigate('lobby');},{fontSize:13});cy+=landscape?40:50;
    // Landscape panels are short: the line only shows when it fits above the cheers bar.
    if(!landscape||!panel||cy+14+(this.cheersEnabled?66:0)<=panel.y+panel.h-6){center(this.completionFooterText(),cy,12,muted,500);cy+=landscape?16:24;}
  if(this.cheersEnabled&&landscape&&panel){const bar={x:panel.x+16,y:Math.max(this.completionPicture.y+this.completionPicture.h+8,cy+2),w:panel.w-32,h:44};this.drawCompletionBar(bar);const hint='点一下就能喝彩，同桌都看得到';s.text(hint,bar.x+(bar.w-s.measure(hint,11))/2,bar.y+49,11,muted,500);}
  return cy;
 }

export function drawLandscapeCompletionPanel(this:AppHost){
  const s=this.stage,v=this.platform.viewport() as ReturnType<Platform['viewport']>&{left?:number;right?:number},available=s.w-(v.left??0)-(v.right??0),seatW=this.landscapeSeatWidth(available),w=Math.min(640,available-(this.completionSeats().length?2*(seatW+18):252)),panel={x:(v.left??0)+(available-w)/2,y:Math.max(8,v.top),w,h:s.h-Math.max(8,v.top)-Math.max(8,v.bottom)};
  s.ctx.fillStyle=this.colors.overlay;s.ctx.fillRect(0,0,s.w,s.h);s.hit({x:0,y:0,w:s.w,h:s.h},()=>{});s.frame(panel,'panel-cream');this.modalArea=panel;this.modalExtent=0;this.modalScroll=0;this.completionSeatRects.clear();this.drawCompletionSeats(panel);
  s.text('拼图完成',panel.x+16,panel.y+12,17,this.colors.ink,700);s.button({x:panel.x+panel.w-38,y:panel.y+7,w:28,h:28},'',()=>this.closeModal(),{icon:'close'});
  this.drawCompletionContent(panel.x+16,panel.y+40,panel.w-32,true,panel);this.drawCompletionEffects();
 }

export function drawCompletionEffectsPanel(this:AppHost){
  this.completionBubbleRects.clear();const fx=this.cheerEffects,now=Date.now();fx.update(now);const s=this.stage,c=s.ctx,p=this.completionPicture;
  // Cups meet above the image; only show them while its top is in the scroll viewport.
  if(fx.tea&&p.y>=this.modalArea.y){const t=(now-fx.tea.start)/1000,spread=40*(1-Math.min(1,t*2));for(const direction of [-1,1])drawCheerIcon(c,'tea',{x:p.x+p.w/2-16+direction*(16+spread),y:p.y-28-Math.sin(t*Math.PI)*8,w:32,h:32});}
  const outside=this.layout==='phoneLandscape'||this.completionOutsideSeats(this.modalArea.x-12,this.modalArea.w+24);
  const area=outside?{x:0,y:0,w:s.w,h:s.h}:this.modalArea,bubbleRect=(id:string)=>{const slot=this.completionSlotRects.get(id);if(slot)return !outside&&(slot.x+slot.w<=area.x||slot.x>=area.x+area.w||slot.y+slot.h<=area.y||slot.y>=area.y+area.h)?null:slot;return {x:clamp(p.x+p.w/2-21,area.x+2,area.x+area.w-44),y:clamp(p.y+p.h-48,area.y+2,area.y+area.h-40),w:42,h:38};};
  s.clip(area,()=>{
  const origin=(id:string)=>{const r=bubbleRect(id);return r?{x:r.x+r.w/2,y:r.y+r.h/2}:null;};
  for(const scene of fx.celebrations)drawCelebration(c,scene,now,{picture:this.completionPicture,field:this.modalArea,clip:area});
  for(const particle of fx.particles){const t=(now-particle.start)/particle.duration;c.save();const o=origin(particle.playerId),slot=this.completionSlotRects.get(particle.playerId),rise=slot?t*((outside?64:60)+particle.y*12):t*100+particle.y*20,dx=slot?outside?Math.sin(t*8)*(particle.x*2-1)*Math.max(0,slot.w/2-12):(.35*rise*(slot.x<p.x+p.w/2?1:-1)+Math.sin(t*8)*(particle.x*2-1)*4):(particle.x-.5)*60;c.globalAlpha=1-t;if(o)drawCheerIcon(c,'heart',{x:o.x-12+dx,y:o.y-12-rise,w:24,h:24});c.restore();}
  if(now<fx.starsUntil){const size=16+Math.round(8*Math.abs(Math.sin(now/95)));for(const [x,y] of [[p.x,p.y],[p.x+p.w,p.y],[p.x,p.y+p.h],[p.x+p.w,p.y+p.h]])drawCheerIcon(c,'star',{x:x-size/2,y:y-size/2,w:size,h:size});}
  for(const bubble of fx.bubbles){const target=bubbleRect(bubble.playerId),scale=fx.bubbleScale(bubble);if(!target||scale<=0)continue;const r={x:target.x+target.w/2*(1-scale),y:target.y+target.h/2*(1-scale),w:target.w*scale,h:target.h*scale};this.completionBubbleRects.set(bubble.playerId,r);
   // Stage.frame paints in physical pixels, so animate its rectangle explicitly.
   c.save();c.globalAlpha=fx.bubbleAlpha(bubble);s.clip(r,()=>{s.frame(r,'button-cream-normal');if(scale>.5){drawCheerIcon(c,bubble.emote,{x:r.x+(r.w-24*scale)/2,y:r.y+r.h/2-14*scale,w:24*scale,h:24*scale});if(bubble.count>=2){const badge={x:r.x+r.w-22*scale,y:r.y+r.h-14*scale,w:20*scale,h:12*scale};c.fillStyle=this.colors.berry;c.fillRect(badge.x,badge.y,badge.w,badge.h);s.text('×'+bubble.count,badge.x+2*scale,badge.y+scale,9*scale,this.colors.onAccent,800,16*scale);}}});c.restore();}
  // Portrait slots flank the picture's top edge, so the combo banner narrows to fit between them.
  if(fx.combo){const label=fx.combo.count+' 人一起喝彩！',cx=p.x+p.w/2,room=outside?Infinity:Math.min(Infinity,...[...this.completionSlotRects.values()].filter(r=>r.y<p.y+29&&r.y+r.h>p.y-3).map(r=>(r.x+r.w<=cx?cx-r.x-r.w:r.x-cx)-2)),w=Math.min(p.w+60,s.measure(label,14,800)+58,room*2),r={x:p.x+(p.w-w)/2,y:p.y-3,w,h:32};s.frame(r,'button-gold-normal');s.text(label,r.x+(w-s.measure(label,14,800))/2,r.y+8,14,this.colors.ink,800);for(const x of [r.x+5,r.x+w-21])drawCheerIcon(c,'star',{x,y:r.y+8,w:16,h:16});}
  });
 }
