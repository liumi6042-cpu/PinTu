import type {MobileCollectionView,CollectionDecoration,CollectionAlbum} from '../../h5/mobile-collection-api';
import collectionCatalog from '../../lib/mobile-collection-catalog.json';
import {collectionDecorationRewardHints} from '../collection-copy';
import {HAIRPIN_ID} from '../retention';
import {type AppHost,clamp} from './shared';

export function drawCollectionPanel(this:AppHost){
  const s=this.stage,data=this.collection,desktop=this.desktop,landscape=this.layout==='phoneLandscape',pad=12,w=s.w-pad*2;let y=this.bodyTop;
  const tab=this.collectionTab==='decorations'?'decorations':'albums';
  if(landscape||!(tab==='albums'&&this.albumDetailOpen&&!desktop)){
   const tabs=[['albums','图集','book'],['decorations','装饰','leaf']] as const,tw=Math.min(180,(w-8)/2);
   tabs.forEach(([id,label,icon],index)=>s.button({x:pad+index*(tw+8),y,w:tw,h:landscape?32:38},label,()=>this.changeListView(()=>{this.collectionTab=id;this.albumDetailOpen=false;}),{tone:tab===id?'berry':'linen',icon,fontSize:15}));
   if(landscape&&tab==='albums'&&this.albumDetailOpen)s.button({x:pad+tw*2+24,y,w:84,h:32},'‹ 图集',()=>{this.albumDetailOpen=false;this.scroll=0;this.albumListScroll=0;this.invalidate();},{fontSize:12});
   else if(w>tw*2+200&&!(desktop&&tab==='albums'))s.text(tab==='albums'?'拼完一张图就收进图集，集满有奖励':'装饰会在拖动拼块时展示给同桌',pad+tw*2+24,y+12,13,this.colors.muted,600,w-tw*2-30);
   y+=landscape?40:50;if(!landscape&&w<=tw*2+200&&tab==='albums'){s.text('拼完一张图就收进图集，集满有奖励',pad+2,y-4,12,this.colors.muted,600,w);y+=20;}
  }
  this.bodyTop=y;if(!data){s.text('正在翻开收藏…',pad+8,y+32,15);this.extent=0;return;}
  if(tab==='decorations'){this.drawDecorations(data);return;}
  const albums=this.orderedAlbums(data),selected=albums.find(album=>album.id===this.albumId)??albums.find(album=>this.packFor(data,album.id))??albums[0];
  if(landscape){
   if(this.albumDetailOpen&&selected){
    const leftW=w*.34,gap=12,grid={x:pad+leftW+gap,y,w:w-leftW-gap,h:this.bodyBottom-y};
    this.listColumn={x:this.contentOrigin.x+pad,w:leftW};
    let bottom=y-this.scroll;
    s.clip({x:pad,y,w:leftW,h:grid.h},()=>{
     bottom=this.drawAlbumHeader(data,selected,pad,bottom,leftW,true);
     bottom=this.drawAlbumRewards(data,selected,pad,bottom+6,leftW,true);
    });this.extent=bottom+this.scroll-y+8;
    this.albumListArea={...grid,x:grid.x+this.contentOrigin.x,y:grid.y+this.contentOrigin.y};
    this.albumListExtent=this.albumImageGridHeight(selected,grid.w,3);
    this.albumListScroll=clamp(this.albumListScroll,0,Math.max(0,this.albumListExtent-grid.h));
    s.clip(grid,()=>this.drawAlbumImages(selected,grid.x,y-this.albumListScroll,grid.w,3));
   }else{
    const columns=w>=900?4:3,gap=12,cw=(w-gap*(columns-1))/columns;let bottom=y-this.scroll;
    this.scrolled(()=>{for(let row=0;row<Math.ceil(albums.length/columns);row++){
     let rowBottom=bottom;for(let col=0;col<columns;col++){const album=albums[row*columns+col];if(album)rowBottom=Math.max(rowBottom,this.drawAlbumCard(data,album,{x:pad+col*(cw+gap),y:bottom,w:cw},false,true));}bottom=rowBottom+gap;
    }},y,this.bodyBottom);this.extent=bottom+this.scroll-y;
   }return;
  }
  if(desktop){
   const listW=Math.min(560,w*.5),detail={x:pad+listW+16,y,w:w-listW-16,h:this.bodyBottom-y};
   let ly=y-this.scroll;this.listColumn={x:this.contentOrigin.x+pad-4,w:listW+8};
   this.scrolled(()=>{for(const album of albums)ly=this.drawAlbumCard(data,album,{x:pad,y:ly,w:listW},album.id===selected?.id)+12;},y,this.bodyBottom);this.extent=ly+this.scroll-y;
   if(selected){s.panel(detail);this.albumListArea={x:this.contentOrigin.x+detail.x,y:this.contentOrigin.y+detail.y+8,w:detail.w,h:detail.h-16};let dy=detail.y+16-this.albumListScroll;const inner={x:detail.x+16,w:detail.w-32};
    s.clip({x:detail.x+4,y:detail.y+6,w:detail.w-8,h:detail.h-12},()=>{dy=this.drawAlbumDetail(data,selected,inner.x,dy,inner.w,3);});this.albumListExtent=dy+this.albumListScroll-detail.y;this.albumListScroll=clamp(this.albumListScroll,0,Math.max(0,this.albumListExtent-detail.h+16));}
   return;
  }
  let cy=y-this.scroll;
  this.scrolled(()=>{
   if(this.albumDetailOpen&&selected){s.button({x:pad,y:cy,w:84,h:34},'‹ 图集',()=>{this.albumDetailOpen=false;this.scroll=0;this.invalidate();},{fontSize:14});cy=this.drawAlbumDetail(data,selected,pad,cy+46,w,2);}
   else for(const album of albums)cy=this.drawAlbumCard(data,album,{x:pad,y:cy,w},false)+12;
  },y,this.bodyBottom);this.extent=cy+this.scroll-y+12;
 }

export function drawAlbumCardPanel(this:AppHost,data:MobileCollectionView,album:CollectionAlbum,r:{x:number;y:number;w:number},selected:boolean,compact=false){
  const s=this.stage,pack=this.packFor(data,album.id),ink=this.colors.ink;
  if(compact){const h=164,card={...r,h};s.frame(card,selected?'panel-gold':'button-linen-normal');
   if(pack)s.image(this.client.asset(pack.coverSrc||pack.images[0]?.thumbSrc||''),{x:r.x+5,y:r.y+5,w:r.w-10,h:65},'cover');else s.icon('book',{x:r.x+12,y:r.y+12,w:46,h:46});
   s.text(album.title,r.x+10,r.y+77,15,ink,800,r.w-20);s.text('已收集 '+album.collected+'/'+album.total,r.x+10,r.y+100,12,this.colors.muted,700,r.w-20);
   s.meter({x:r.x+10,y:r.y+121,w:r.w-20,h:8},album.collected/Math.max(1,album.total));
   if(pack&&!pack.owned)s.button({x:r.x+8,y:r.y+133,w:r.w-16,h:26},this.packOfferLabel(pack),()=>this.openPackOffer(pack),{icon:pack.unlock==='ad'?'lock':'coin',fontSize:12,disabled:this.busy});
   else s.text(this.nextMilestoneText(data,album),r.x+10,r.y+140,11,this.colors.muted,600,r.w-20);
   s.hit({...card,h:130},()=>this.openAlbum(album.id));return r.y+h;
  }
  if(!pack){const h=100,card={...r,h};s.frame(card,selected?'panel-gold':'button-linen-normal');s.icon('book',{x:r.x+14,y:r.y+18,w:44,h:40});s.text(album.title,r.x+68,r.y+14,17,ink,800,r.w-170);s.text('每日拼图自动收进来',r.x+68,r.y+38,12,this.colors.muted,600,r.w-170);
   const count=album.collected+' / '+album.total;s.text(count,r.x+r.w-14-s.measure(count,15,800),r.y+16,15,ink,800);s.meter({x:r.x+68,y:r.y+60,w:r.w-84,h:9},album.collected/Math.max(1,album.total));s.text(this.nextMilestoneText(data,album),r.x+68,r.y+76,12,this.colors.muted,600,r.w-84);s.hit(card,()=>this.openAlbum(album.id));return r.y+h;}
  const coverH=Math.min(170,r.w*.42),h=coverH+52,card={...r,h},cover={x:r.x+6,y:r.y+6,w:r.w-12,h:coverH},adPack=pack.unlock==='ad',locked=!pack.owned&&album.collected===0&&!(adPack&&(pack.unlocked??0)>0);
  s.frame(card,selected?'panel-gold':'button-linen-normal');s.image(this.client.asset(pack.coverSrc||pack.images[0]?.thumbSrc||album.images[0]?.thumbSrc||''),cover,'cover');
  const c=s.ctx,shade=c.createLinearGradient(0,cover.y+coverH*.35,0,cover.y+coverH);shade.addColorStop(0,'#2a142000');shade.addColorStop(1,'#2a1420d9');c.fillStyle=shade;c.fillRect(cover.x,cover.y,cover.w,cover.h);
  s.text(album.title,cover.x+14,cover.y+coverH-52,20,'#fff8ec',800,cover.w-130);s.text(album.description,cover.x+14,cover.y+coverH-24,12,'#fff3e2',500,cover.w-28);
  const badge=adPack&&!pack.owned?'已解锁 '+(pack.unlocked??0)+'/'+album.total:locked?'未解锁':album.collected>=album.total?album.collected+' / '+album.total+' ✓':album.collected+' / '+album.total,bw=s.measure(badge,13,800)+18;c.fillStyle=s.color(locked?'#573b40':'#a85567');c.fillRect(cover.x+cover.w-bw-10,cover.y+10,bw,24);s.text(badge,cover.x+cover.w-bw+(-1),cover.y+15,13,'#fffaf0',800);
  const fy=r.y+coverH+16;s.text(this.nextMilestoneText(data,album),r.x+14,fy+2,13,ink,600,r.w-140);
  if(!pack.owned){const bw=adPack?124:104;s.button({x:r.x+r.w-bw-12,y:fy-6,w:bw,h:34},this.packOfferLabel(pack),()=>this.openPackOffer(pack),{tone:'berrydark',icon:adPack?'lock':'coin',fontSize:13,disabled:this.busy});s.hit({x:r.x,y:r.y,w:r.w-120,h},()=>this.openAlbum(album.id));}
  else{s.text('查看 ›',r.x+r.w-60,fy+2,13,this.colors.berry,700);s.hit(card,()=>this.openAlbum(album.id));}
  return r.y+h;
 }

export function drawAlbumHeaderPanel(this:AppHost,data:MobileCollectionView,album:CollectionAlbum,x:number,y:number,w:number,compact=false){
  const s=this.stage,ink=this.colors.ink,stack=compact||w<430,progressW=stack?w:Math.min(200,w*.38),titleW=stack?w:w-progressW-16;
  s.icon('book',{x,y,w:compact?26:36,h:compact?28:38});s.text(album.title,x+(compact?32:44),y+4,compact?16:21,ink,800,titleW-(compact?32:44));
  const descriptionY=y+(compact?32:44),descriptionH=s.wrap(album.description,x,descriptionY,titleW,compact?11:12,this.colors.muted,16);
  const py=stack?descriptionY+descriptionH+6:y+3,px=stack?x:x+w-progressW;
  s.icon('piece',{x:px,y:py,w:18,h:20});s.text('已收集 '+album.collected+'/'+album.total,px+24,py+3,compact?12:14,ink,700,progressW-24);
  // Stage.meter clamps the fraction and paints its rounded fill inside the track.
  s.meter({x:px,y:py+27,w:progressW,h:9},album.collected/Math.max(1,album.total));
  let bottom=Math.max(descriptionY+descriptionH,py+36)+12;const pack=this.packFor(data,album.id);
  if(pack&&!pack.owned){const req=pack.adRequired??2,dailyUnlock=pack.dailyUnlockLimit??1;s.button({x,y:bottom,w:Math.min(w,228),h:compact?28:34},pack.unlock==='ad'?'每张看 '+req+' 次广告解锁 · 每日限 '+dailyUnlock+' 张':pack.price+' 金币 · 解锁图包',()=>this.openPackOffer(pack),{icon:pack.unlock==='ad'?'lock':'coin',tone:'berrydark',fontSize:12,disabled:this.busy});bottom+=compact?34:42;}
  return bottom;
 }

export function drawAlbumRewardsPanel(this:AppHost,data:MobileCollectionView,album:CollectionAlbum,x:number,y:number,w:number,compact=false){
  if(!album.milestones.length)return y;
  const s=this.stage,ink=this.colors.ink,final=[...album.milestones].reverse().find(m=>m.decorationId),decoration=data.decorations.find(d=>d.id===final?.decorationId),tagW=decoration?Math.min(compact?80:150,w*.38):0,h=138;
  s.panel({x,y,w,h});const left=x+22,right=x+w-tagW-26,trackW=Math.max(1,right-left),ty=y+28,total=Math.max(1,album.total,...album.milestones.map(m=>m.target));
  s.meter({x:left,y:ty,w:trackW,h:9},album.collected/total);
  for(const milestone of album.milestones){const nx=left+trackW*clamp(milestone.target/total,0,1),reached=album.collected>=milestone.target;
   s.frame({x:nx-11,y:ty-7,w:22,h:22},reached?'segment-berry-selected':'button-linen-normal');
   if(reached)s.icon('check',{x:nx-7,y:ty-3,w:14,h:14});else s.icon('lock',{x:nx-6,y:ty-2,w:12,h:14});
   s.text(milestone.target+'张',nx-s.measure(milestone.target+'张',11,700)/2,ty+22,11,ink,700);
   const reward=data.decorations.find(d=>d.id===milestone.decorationId);
   if(milestone.coins){s.icon('coin',{x:nx-9,y:ty+42,w:18,h:20});s.text(milestone.coins,nx-s.measure(String(milestone.coins),10,700)/2,ty+65,10,ink,700);}
   if(reward)s.decoration(reward,{x:nx-12,y:ty+(milestone.coins?80:43),w:24,h:26});
  }
  if(decoration){const tx=x+w-tagW;s.frame({x:tx,y:y+10,w:tagW-8,h:24},'segment-berry-selected');s.text('集齐可得',tx+5,y+16,compact?10:12,this.colors.onAccent,700,tagW-18);
   s.decoration(decoration,{x:tx+4,y:y+40,w:28,h:30});s.text(decoration.title,tx+2,y+76,compact?10:13,ink,800,tagW-10);
   s.clip({x:tx,y:y+94,w:tagW-8,h:h-98},()=>s.wrap(decoration.description,tx+2,y+96,tagW-12,10,this.colors.muted,14));
  }return y+h+12;
 }

export function drawAlbumImagesPanel(this:AppHost,album:CollectionAlbum,x:number,y:number,w:number,columns:number){
  const s=this.stage,ink=this.colors.ink,gap=12,cw=(w-gap*(columns-1))/columns,ih=cw*.72,ch=ih+66;
  album.images.forEach((image,index)=>{const cx=x+(index%columns)*(cw+gap),cy=y+Math.floor(index/columns)*(ch+gap),r={x:cx,y:cy,w:cw,h:ch},art={x:cx+5,y:cy+5,w:cw-10,h:ih};if(cy+ch<0||cy>s.h)return;
   s.frame(r,'button-linen-normal');s.image(this.client.asset(image.thumbSrc),art,'cover');
   s.text(image.title,cx+9,cy+ih+13,12,image.collected?ink:this.colors.muted,700,cw-18);
   const pill={x:cx+8,y:cy+ih+34,w:cw-16,h:24};s.frame(pill,'button-linen-normal');s.icon(image.collected?'leaf':'lock',{x:pill.x+6,y:pill.y+4,w:15,h:16});s.text(image.collected?'已收藏':'未收集',pill.x+25,pill.y+6,11,this.colors.muted,700,pill.w-28);
   if(image.difficulties.length){const badge=String(Math.max(...image.difficulties)),bw=Math.min(art.w-8,s.measure(badge,11,700)+28);s.frame({x:art.x+art.w-bw-4,y:art.y+4,w:bw,h:22},'button-linen-normal');s.icon('piece',{x:art.x+art.w-bw,y:art.y+8,w:13,h:14});s.text(badge,art.x+art.w-bw+16,art.y+9,11,ink,700,bw-20);}
   if(!image.collected)s.hit(r,()=>this.playImage(image.id));
  });return y+this.albumImageGridHeight(album,w,columns);
 }

export function drawAlbumDetailPanel(this:AppHost,data:MobileCollectionView,album:CollectionAlbum,x:number,y:number,w:number,columns:number){
  y=this.drawAlbumHeader(data,album,x,y,w);
  y=this.drawAlbumImages(album,x,y+4,w,columns);
  return this.drawAlbumRewards(data,album,x,y+8,w);
 }

export function drawDecorationsPanel(this:AppHost,data:MobileCollectionView){
  // The server lists gift rewards only to owners; show the rest as locked cards from the bundled catalogue.
  const gifts:CollectionDecoration[]=collectionCatalog.rewardDecorations.filter(item=>!data.decorations.some(d=>d.id===item.id)).map(item=>({...item,kind:'cursor',source:'gift',owned:false,equipped:false}));
  const s=this.stage,pad=12,w=s.w-24,ink=this.colors.ink,filter=this.decorationFilter,all=[...data.decorations,...gifts];
  const matches=(item:CollectionDecoration)=>filter==='owned'?item.owned:filter==='craft'?!item.owned&&item.source==='craft':filter==='album'?item.source==='album':true;
  const decorations=all.filter(matches),selected=all.find(item=>item.id===this.decorationId)??all.find(item=>item.equipped)??all[0],hints=selected&&!selected.owned?collectionDecorationRewardHints(selected,data.albums):[];let y=this.bodyTop-this.scroll;
  this.scrolled(()=>{
   if(selected){const wide=w>=560,h=wide?190:280,r={x:pad,y,w,h};s.panel(r);
    const mock={x:pad+12,y:y+12,w:wide?w*.42:w-24,h:wide?h-24:120};s.ctx.fillStyle=this.colors.placeholder;s.ctx.fillRect(mock.x,mock.y,mock.w,mock.h);s.text('同桌看到的样子',mock.x+10,mock.y+8,12,this.colors.muted,700);
    const cx=mock.x+mock.w*.42,cy=mock.y+mock.h*.5;s.decoration(selected,{x:cx-34,y:cy-30,w:40,h:44});const tag={x:cx+6,y:cy+6,w:Math.min(150,mock.w*.5),h:34};s.frame(tag,'button-linen-normal');s.icon('avatar',{x:tag.x+4,y:tag.y+3,w:24,h:27});s.text(data.profile.name,tag.x+32,tag.y+4,12,ink,700,tag.w-36);s.text('Lv.'+data.profile.level,tag.x+32,tag.y+18,11,this.colors.muted,600);
    const tx=wide?mock.x+mock.w+16:pad+14,ty=wide?y+16:mock.y+mock.h+12,tw=wide?w-mock.w-40:w-28;s.text(selected.title,tx,ty,18,ink,800,tw);let dy=ty+28+s.wrap(this.decorationText(selected),tx,ty+28,tw,12,ink,18);for(const hint of hints)dy+=s.wrap(hint,tx,dy,tw,12,this.colors.muted,17);
    const label=selected.equipped?'取下装饰':selected.owned?'使用这个装饰':selected.source==='gift'?(selected.id==='cat-paw'?(this.platform.config?.id==='wechat'?'活动或兑换码获得':'论坛反馈或群兑换码获得'):selected.description||'限定礼物'):selected.source==='album'?'集齐图集获得':data.wallet.fragments<selected.cost?'碎片不足 · '+data.wallet.fragments+'/'+selected.cost:'制作 · '+selected.cost+' 碎片',disabled=!selected.owned&&(selected.source!=='craft'||selected.enabled===false||data.wallet.fragments<selected.cost);
    s.button({x:tx,y:y+h-52,w:Math.min(240,tw),h:40},label,()=>void this.collectionAction(selected.owned?'equip':'craft',selected.equipped?null:selected.id),{tone:selected.equipped?'cream':'berrydark',fontSize:14,disabled:disabled||this.busy});y+=h+12;}
   const tuning=data.tuning;y=this.paragraph('碎片来自拼图：每拼合 '+(tuning?.fragmentContributionStep??10)+' 块得 1 片，拼完一张最多 '+(tuning?.completionFragmentMaximum??10)+' 片 · 现有 '+data.wallet.fragments+' 片',pad+2,y,w,12)+12;
   const chip=(value:typeof filter,label:string):[string,boolean,()=>void]=>[label,filter===value,()=>this.changeListView(()=>{this.decorationFilter=value;})];
   y=this.drawChips(pad,y,Math.min(w,440),32,[chip('all','全部 '+all.length),chip('owned','已拥有'),chip('craft','可制作'),chip('album','图集奖励')])+12;
   const columns=w>=760?4:w>=520?3:2,gap=12,cw=(w-gap*(columns-1))/columns,h=112,base=y;
   decorations.forEach((item,index)=>{const x=pad+index%columns*(cw+gap),cy=base+Math.floor(index/columns)*(h+gap),r={x,y:cy,w:cw,h};if(cy+h<this.bodyTop||cy>this.bodyBottom)return;
    s.frame(r,selected?.id===item.id?'panel-gold':'button-linen-normal');s.decoration(item,{x:x+10,y:cy+12,w:44,h:50});s.text(item.title,x+62,cy+14,14,ink,800,cw-70);
    let status=item.equipped?'使用中':item.owned?'已拥有':'',tone=item.equipped?'#a85567':'#879864';
    if(!status&&item.source==='craft'){s.icon('fragment',{x:x+62,y:cy+38,w:16,h:18});s.text(item.cost+' 碎片',x+82,cy+40,13,ink,700);}
    else if(!status&&item.source==='gift')s.wrap(item.id==='cat-paw'?(this.platform.config?.id==='wechat'?'活动或\n兑换码获得':'论坛/评论区\n反馈获得'):item.id===HAIRPIN_ID?'七日礼\n第 7 天获得':item.description||'限定礼物',x+62,cy+40,cw-70,12,'#8a5a5f',17);
    else if(!status){const album=data.albums.find(a=>a.id===item.albumId);status='集齐「'+(album?.title??'图集')+'」获得';tone='#8a5a5f';if(album){s.meter({x:x+62,y:cy+64,w:cw-74,h:7},album.collected/Math.max(1,album.total));s.text(album.collected+'/'+album.total,x+62,cy+76,12,this.colors.muted,700);}}
    if(status)s.text(status,x+62,cy+40,13,tone,700,cw-70);
    s.hit(r,()=>{this.decorationId=item.id;this.scroll=0;this.invalidate();});});
   y=base+Math.ceil(decorations.length/columns)*(h+gap)+8;
  });this.extent=y-(this.bodyTop-this.scroll);
 }

export function drawPackPreviewPanel(this:AppHost){
  const pack=this.previewPack;if(!pack)return;
  const s=this.stage,v=this.platform.viewport(),w=Math.min(920,s.w-24),columns=w>=720?4:2,gap=w>=720?16:12,pad=20,cw=(w-pad*2-gap*(columns-1))/columns,rowH=cw+36,rows=Math.ceil(pack.images.length/columns),h=Math.min(s.h-v.top-v.bottom-28,84+Math.min(rows,3)*(rowH+gap)+94),x=(s.w-w)/2,y=v.top+(s.h-v.top-v.bottom-h)/2,footerY=y+h-(this.previewReadOnly?10:80);
  s.ctx.fillStyle=this.colors.overlay;s.ctx.fillRect(0,0,s.w,s.h);s.hit({x:0,y:0,w:s.w,h:s.h},()=>{});s.panel({x,y,w,h});
  s.text(pack.title,x+20,y+18,21,this.colors.ink,800,w-80);s.button({x:x+w-45,y:y+12,w:30,h:30},'',()=>this.showModal(null));s.icon('close',{x:x+w-42,y:y+15,w:24,h:24},this.colors.ink);
  this.modalStart=y+80;this.modalArea={x:x+14,y:this.modalStart,w:w-28,h:Math.max(20,footerY-this.modalStart-14)};
  if(this.previewIndex<0){
   const req=pack.adRequired??2,dailyUsed=pack.dailyUsed??0,dailyLimit=pack.dailyLimit??2;
   s.text(pack.unlock==='ad'?'已解锁 '+pack.images.filter(image=>image.owned).length+'/'+pack.images.length+' · 今日解锁广告 '+dailyUsed+'/'+dailyLimit+' · 每张看 '+req+' 次解锁':pack.images.length+' 张主题图片 · 点击缩略图查看大图',x+20,y+51,w<400?11:13,this.colors.muted,500,w-40);
   this.modalExtent=rows*(rowH+gap)-gap+8;this.modalScroll=clamp(this.modalScroll,0,Math.max(0,this.modalExtent-this.modalArea.h));
   s.clip(this.modalArea,()=>{pack.images.forEach((image,index)=>{
    const cx=x+pad+index%columns*(cw+gap),cy=this.modalStart+4+Math.floor(index/columns)*(rowH+gap)-this.modalScroll;if(cy+rowH<this.modalArea.y||cy>this.modalArea.y+this.modalArea.h)return;
    const art={x:cx,y:cy,w:cw,h:cw};s.frame(art,'panel-cream');s.image(this.client.asset(image.thumbSrc||image.src),{x:cx+5,y:cy+5,w:cw-10,h:cw-10},'contain');
    s.text(image.title,cx+3,cy+cw+12,w<400?12:14,this.colors.ink,700,cw-6);
    if(pack.unlock==='ad'){
     const imgReq=image.adRequired??req,imgProg=image.owned?imgReq:(image.adProgress??0);
     if(!image.owned&&imgProg>0){const tag=imgProg+'/'+imgReq,tw=Math.max(32,s.measure(tag,11,800)+12);s.frame({x:cx+9,y:cy+9,w:tw,h:24},'panel-gold');s.text(tag,cx+9+(tw-s.measure(tag,11,800))/2,cy+14,11,this.colors.ink,800);}
     else{s.frame({x:cx+9,y:cy+9,w:27,h:27},image.owned?'segment-berry-selected':'plus-cream-normal');s.icon(image.owned?'check':'lock',{x:cx+14,y:cy+14,w:17,h:17},image.owned?'#fff9ed':this.colors.muted);}
    }
    s.hit({x:cx,y:cy,w:cw,h:rowH},()=>{this.previewGridScroll=this.modalScroll;this.previewIndex=index;this.modalScroll=0;this.stage.retryImages();this.invalidate();});
   });});
   if(this.modalExtent>this.modalArea.h){const track=this.modalArea,thumbH=Math.max(24,track.h*track.h/this.modalExtent),thumbY=track.y+(track.h-thumbH)*this.modalScroll/(this.modalExtent-track.h);s.ctx.fillStyle=this.colors.rose;s.ctx.fillRect(x+w-9,thumbY,3,thumbH);}
  }else{
   if(!this.previewReadOnly)s.button({x:x+20,y:y+45,w:138,h:28},'‹ 返回全部图片',()=>this.returnToPackGrid(),{fontSize:12});
   this.modalExtent=0;this.modalScroll=0;const image=pack.images[this.previewIndex],area=this.modalArea,art={x:x+20,y:area.y+2,w:w-40,h:Math.max(20,area.h-54)};
   s.frame(art,'panel-cream');s.image(this.client.asset(image.src||image.thumbSrc),{x:art.x+5,y:art.y+5,w:art.w-10,h:art.h-10},'contain');s.ornaments(art,16);
   const captionY=art.y+art.h+12;s.text(image.title,x+20,captionY,14,this.colors.ink,700,w-190);
   const counter=(this.previewIndex+1)+' / '+pack.images.length;s.text(counter,x+w-104-s.measure(counter,12,700)/2,captionY+3,12,this.colors.muted,700);
   s.button({x:x+w-167,y:captionY-4,w:31,h:28},'‹',()=>this.stepPackPreview(-1),{disabled:this.previewIndex===0,fontSize:19});s.button({x:x+w-72,y:captionY-4,w:31,h:28},'›',()=>this.stepPackPreview(1),{disabled:this.previewIndex===pack.images.length-1,fontSize:19});
  }
  if(this.previewReadOnly)return;
  s.ctx.fillStyle=this.colors.rose;s.ctx.fillRect(x+20,footerY, w-40,1);
  const buttonW=Math.min(265,w-40),buttonX=x+(w-buttonW)/2;
  if(pack.unlock==='ad'){
   const image=this.previewIndex>=0?pack.images[this.previewIndex]:null,firstLocked=pack.images.findIndex(item=>!item.owned);
   const req=image?.adRequired??pack.adRequired??2,prog=image?(image.owned?req:(image.adProgress??0)):0;
   const dailyUsed=pack.dailyUsed??0,dailyLimit=pack.dailyLimit??2,dailyUnlocked=pack.dailyUnlocked??0,dailyUnlockLimit=pack.dailyUnlockLimit??1;
   const dailyBlocked=image&&!image.owned&&(dailyUsed>=dailyLimit||(prog+1>=req&&dailyUnlocked>=dailyUnlockLimit));
   const label=image?(image.owned?'已解锁 · 去建房':dailyBlocked?'今日次数已用完 · 明天再来':prog>0?'再看 '+(req-prog)+' 次广告解锁（'+prog+'/'+req+'）':'看广告解锁（0/'+req+'）'):firstLocked<0?'已全部解锁 · 去建房':dailyUsed>=dailyLimit?'今日次数已用完（'+dailyUsed+'/'+dailyLimit+'）':'挑一张看广告解锁';
   s.button({x:buttonX,y:footerY+13,w:buttonW,h:36},label,()=>{if(image&&!image.owned)void this.unlockAdImage(image.id);else if(image||firstLocked<0)this.openPackGallery(pack.id);else{this.previewGridScroll=this.modalScroll;this.previewIndex=firstLocked;this.modalScroll=0;this.stage.retryImages();this.invalidate();}},{tone:'berry',icon:image?(image.owned?'check':'lock'):firstLocked<0?'check':'lock',fontSize:13,disabled:this.busy||Boolean(dailyBlocked)});
   const hint='每张图看 '+req+' 次广告永久解锁 · 每日限解锁 '+dailyUnlockLimit+' 张（'+dailyLimit+' 次广告）';s.text(hint,x+(w-s.measure(hint,11))/2,footerY+58,11,this.colors.muted,500,w-24);return;
  }
  s.button({x:buttonX,y:footerY+13,w:buttonW,h:36},pack.owned?'已拥有 · 去建房':pack.price+' 金币 · 解锁图包',()=>{if(pack.owned)this.openPackGallery(pack.id);else{this.purchase=pack;this.showModal('purchase');}},{tone:'berry',icon:pack.owned?'check':'coin',fontSize:14,disabled:this.busy});
  const hint=pack.owned?'随时选择喜欢的图片开拼':'永久解锁 · 免费公开建房';s.text(hint,x+(w-s.measure(hint,11))/2,footerY+58,11,this.colors.muted);
 }
