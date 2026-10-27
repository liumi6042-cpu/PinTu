import type {Platform,Rect} from './ports';
import type {Stage} from './ui';
import type {GameClient} from './client';
import type {MobileLevelsView} from '../h5/mobile-api';
import type {RoomTicket,RoomClientDependencies} from '../lib/room-client';
import {readOfflineCatalog} from '../lib/offline-catalog-types';
import {cacheServerLevels,createOfflineRoomServer,offlineLevelsView,pendingOfflineClears,readCachedServerLevels,syncOfflineClears} from '../lib/offline-play';

export type OfflineInput={kind:'level';levelId:string}|{kind:'free';imageId:string;pieces:number};
export const OFFLINE_REQUIRED='需要联网才能使用';

/** Packaged content and local rooms never borrow the online room transport/outbox. */
export class OfflineMode{
 readonly catalog;
 readonly server;
 active=false;
 private selected:string|null=null;
 private syncing=false;
 constructor(private readonly platform:Platform){
  const catalog=readOfflineCatalog(platform.config.offlineCatalog);
  this.catalog=platform.config.id==='taptap'?catalog:null;
  this.server=this.catalog?createOfflineRoomServer({catalog:this.catalog,storage:platform.storage,now:()=>Date.now(),randomId:()=>platform.randomId()}):null;
 }
 get view(){return this.catalog?offlineLevelsView(this.catalog,readCachedServerLevels(this.platform.storage),this.platform.storage):null;}
 isRoom(id?:string){return !!id&&this.server?.isOfflineRoom(id)===true;}
 onlineFetch(fetch:NonNullable<RoomClientDependencies['fetch']>):NonNullable<RoomClientDependencies['fetch']>{
  return (url,init)=>{
   const id=String(url).match(/\/api\/rooms\/([a-f0-9]{32})(?:[/?]|$)/)?.[1];
   if(this.isRoom(id))return Promise.reject(new TypeError('offline room'));
   return fetch(url,init);
  };
 }
 createRoom(input:OfflineInput){
  if(!this.server)throw Error('离线拼图暂不可用');
  if(input.kind==='level'){
   const level=this.view?.chapters.flatMap(chapter=>chapter.levels).find(level=>level.id===input.levelId);
   if(!level||!['unlocked','cleared'].includes(level.status))throw Error('先拼完前面的格子，就能解锁这里');
  }
  return this.server.createRoom(input);
 }
 async sync(client:GameClient,apply:(levels:MobileLevelsView)=>void,note:(message:string)=>void){
  if(this.syncing||!this.catalog||client.config.capabilities.offlineLevelClears!==true||!pendingOfflineClears(this.platform.storage).length)return;
  this.syncing=true;
  try{
   const result=await syncOfflineClears({storage:this.platform.storage,catalog:this.catalog,randomId:()=>this.platform.randomId(),request:async(path,body)=>({status:200,data:await client.post(path,body)})});
   if(!result)return;
   client.acceptOfflineProfile(result.profile);cacheServerLevels(this.platform.storage,result.levels);apply(result.levels);
   if(result.accepted)note(result.energy>0?'离线通关已同步，体力 +'+result.energy:'离线通关已同步');
  }catch{}finally{this.syncing=false;}
 }
 drawPage(s:Stage,scroll:number,actions:{paragraph:(text:string,x:number,y:number,w:number,size:number)=>number;chapter:(chapter:MobileLevelsView['chapters'][number],view:MobileLevelsView,height:number)=>void;asset:(src:string)=>string;reconnect:()=>void;launch:(input:OfflineInput)=>void;invalidate:()=>void}){
  const view=this.view;if(!view)return 0;
  const portrait=s.h>s.w,x=12,w=s.w-24,top=this.platform.viewport().top+12;
  let y=top-scroll;
  y=actions.paragraph('离线模式：故事关卡和免费图片可以直接玩，联网后自动同步通关',x,y,w,14)+12;
  s.button({x,y,w:132,h:36},'重新连接',actions.reconnect,{fontSize:13});y+=48;
  for(const chapter of view.chapters){
   const height=portrait?Math.ceil(chapter.levels.length/2)*((w-28)/2/1.5+8)+350:Math.max(300,s.h-top-70);
   s.withViewport({x:0,y,w:s.w,h:height},()=>actions.chapter(chapter,view,height));y+=height+18;
  }
  s.text('离线图片',x,y,22,s.palette.ink,800,w);y+=38;
  const cols=portrait?2:3,gap=12,cw=(w-gap*(cols-1))/cols;
  this.catalog!.free.forEach((picture,index)=>{
   const px=x+index%cols*(cw+gap),py=y+Math.floor(index/cols)*(cw*.65+106),photo=this.catalog!.photos[picture.imageId],r={x:px,y:py,w:cw,h:cw*.65};
   s.image(actions.asset(photo.thumbSrc),r,'cover');s.text(picture.title,px,py+r.h+8,13,s.palette.ink,700,cw);
   s.hit(r,()=>{this.selected=picture.imageId;actions.invalidate();});
   if(this.selected===picture.imageId){
    [48,108].forEach((pieces,i)=>s.button({x:px+i*(cw+8)/2,y:py+r.h+32,w:(cw-8)/2,h:36},pieces+' 片',()=>actions.launch({kind:'free',imageId:picture.imageId,pieces}),{tone:'berrydark',fontSize:13}));
   }else s.button({x:px,y:py+r.h+32,w:cw,h:36},'选择图片',()=>{this.selected=picture.imageId;actions.invalidate();},{fontSize:13});
  });
  return y+Math.ceil(this.catalog!.free.length/cols)*(cw*.65+106)+scroll-top+16;
 }
 drawCompletion(s:Stage,ticket:RoomTicket,left:number,y:number,width:number,landscape:boolean,panel:Rect|undefined,actions:{picture:(rect:Rect)=>void;paragraph:(text:string,x:number,y:number,w:number,size:number)=>number;launch:(input:OfflineInput)=>void;back:()=>void;comic?:{available:(levelId:string)=>boolean;open:(levelId:string)=>void}}){
  const levels=this.view?.chapters.flatMap(chapter=>chapter.levels)??[],levelId=(ticket.room as RoomTicket['room']&{levelId?:string}).levelId,index=levels.findIndex(level=>level.id===levelId),level=levels[index],next=levels[index+1];
  if(landscape&&panel){const side=Math.min(240,panel.h-90,panel.w*.43);actions.picture({x:panel.x+16,y:panel.y+45,w:side,h:side});left=panel.x+side+32;width=panel.x+panel.w-left-16;y=panel.y+48;}
  else{const h=Math.min(width*.62,240);actions.picture({x:left,y,w:width,h});y+=h+16;}
  y=actions.paragraph(level?.title??ticket.room.title??'拼图完成',left,y,width,20)+12;
  if(level?.line)y=actions.paragraph(level.line,left,y,width,14)+14;
  y=actions.paragraph('离线完成 · 联网后同步通关',left,y,width,14)+18;
  // Story levels open their comic page offline too; the page needs no network.
  if(level&&actions.comic?.available(level.id)){s.button({x:left,y,w:width,h:40},'翻开这一页',()=>actions.comic!.open(level.id),{tone:'gold',fontSize:16});y+=48;}
  if(level&&next&&['unlocked','cleared'].includes(next.status)){s.button({x:left,y,w:width,h:40},'下一关',()=>actions.launch({kind:'level',levelId:next.id}),{tone:'berrydark',fontSize:16});y+=48;}
  s.button({x:left,y,w:width,h:40},'返回',actions.back,{fontSize:16});return y+48;
 }
}
