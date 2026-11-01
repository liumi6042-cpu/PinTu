// 团子去旅行 (TapTap v54): 团子's nook — pack its bag, it leaves while you are away, mails postcards (puzzles) and comes
// home with souvenirs. The server decides everything (/api/mobile/tuanzi, capability tuanziTravel); this file draws the
// nook, bag, shop, mailbox, postcards, album and the lobby corner, and plays the voxel 团子 sprite sheets.
import type {Rect} from './ports';
import type {Stage} from './ui';
import {drawTravelIcon,type TravelIcon} from './tuanzi-icons';

export type TuanziRegion='water'|'street'|'wild'|'town';
export type TuanziPostcard={id:string;kind:'gallery'|'rare'|'special';title:string;imageId?:string;rareId?:string;src?:string;thumbSrc?:string;width?:number;height?:number;cols:number|null;rows:number|null;pieces:number;region:TuanziRegion;regionTitle:string;place:string;date:string;sticker:string;line:string;arrivedAt:number;read:boolean;completed:boolean;roomable?:boolean;unavailable?:boolean;album?:{id:string;title:string;paid:boolean}};
type ShopItem={id:string;title:string;price:number;slot:'food'|'tool'|'charm';hours?:[number,number];cards?:[number,number];pieces?:number;region?:TuanziRegion;effect?:string};
export type TuanziView={locked:true;unlockLevelId:string}|{locked:false;status:'home'|'away';fish:number;pack:{food:string|null;tool:string|null;charm:string|null}|null;trips:number;
 trip:{id:string;first:boolean;food:string|null;tool:string|null;charm:string|null;departedAt:number;returned:boolean;returnAt?:number;region?:TuanziRegion;souvenir?:string|null;cardsSent:number;duplicates:number}|null;
 inventory:Record<string,number>;sill:{portions:number;fish:number;stack:number;amount:number;nextAt:number|null};welcome:{fish:number;itemId:string;at:number|null};
 postcards:TuanziPostcard[];unread:number;souvenirs:{id:string;count:number;firstAt:number}[];
 album:{total:number;regions:Record<TuanziRegion,number>;rare:number;rareTotal:number;rewards:{key:string;at:number;title?:string;fish?:number;decorationId?:string;itemId?:string;region?:string;taken:boolean}[]};
 catalog:{regions:{id:TuanziRegion;title:string}[];shop:ShopItem[];stickers:{id:string;title:string}[];souvenirs:{id:string;title:string;region:TuanziRegion}[];rare:{id:string;title:string;region:TuanziRegion;thumbSrc:string}[];firstTripMinutes:number;idleMinutes:number;postcardFish:number};serverTime:number};
type Open=Extract<TuanziView,{locked:false}>;
type Colors={paper:string;cream:string;ink:string;muted:string;rose:string;berry:string;gold:string;line:string;green:string;onAccent:string;overlay:string;placeholder:string};
export type TuanziHost={stage:Stage;colors:Colors;top:number;bottom:number;landscape:boolean;playerName:string;menu?:Rect|null;log?:(line:string)=>void;
 animate(ms?:number):void;createCanvas?():HTMLCanvasElement;close():void;note(text:string):void;invalidate():void;randomId():string;
 storage:{get(key:string):string|null;set(key:string,value:string):void};
 get<T>(path:string):Promise<T>;post<T>(path:string,body:unknown):Promise<T>;
 play(card:TuanziPostcard):void;together(card:TuanziPostcard):void;openAlbum(albumId:string):void};
export type TuanziScreen='nook'|'welcome'|'bag'|'shop'|'mailbox'|'postcard'|'album'|'home';

// ---------------------------------------------------------------- art (团子去旅行/体素团子 pipeline, the owner's own cat)
// WebP first; the PNG beside each one is the fallback for WebViews that cannot decode WebP.
const ART={lobby:'/mobile-icons/tuanzi-lobby.webp',lobbyFallback:'/mobile-icons/tuanzi-lobby.png',room:'/mobile-icons/tuanzi-room.webp',roomFallback:'/mobile-icons/tuanzi-room.jpg',
 items:'/mobile-icons/tuanzi-items.webp',itemsFallback:'/mobile-icons/tuanzi-items.png',stickers:'/mobile-icons/tuanzi-stickers.webp',stickersFallback:'/mobile-icons/tuanzi-stickers.png'};
/** One strip per state (tuanzi-cat-<anim>.webp/.png): 320 px frames covering 36 world units, `cols` per row; the cat's ground
 * point is at (.5, .8127). Only the state on screen is downloaded and decoded. Lobby frames are 224×128, drawn at half size. */
export const TUANZI_ANIMS={napBare:{frames:24,fps:12,cols:8,loop:true},wait:{frames:24,fps:16,cols:8,loop:true},tap:{frames:20,fps:24,cols:8,loop:false},
 leave:{frames:16,fps:20,cols:8,loop:true},walkBack:{frames:16,fps:20,cols:8,loop:true},back:{frames:16,fps:12,cols:8,loop:true},awayBare:{frames:12,fps:8,cols:8,loop:true}} as const;
type Anim=keyof typeof TUANZI_ANIMS;
const strip=(anim:Anim)=>'/mobile-icons/tuanzi-cat-'+anim;
export const TUANZI_LOBBY={nap:{y:0,frames:10,fps:6},away:{y:128,frames:6,fps:4}} as const;
const FRAME=320,UNITS=36,GROUND=.8127,ROOM_W=1600,ROOM_H=1800,ROOM_PPU=1600/92,ROOM_CORNER=502/1600;
/** Spots in the 1600×1800 room render (normalized). */
const SPOT={sill:[.51,.347],mailbox:[.875,.413],cat:[.5178,.567],bag:[.87,.533],shelf:[.756,.333],cushion:[.5178,.606]} as const;
/** Voxel icon atlas (128 px cells, 8 per row): shop items, money, mail and the 16 souvenirs. */
const ICONS=['onigiri','bento','deluxe','umbrella','ticket','tent','bell','knot','fish','envelope','bag','paw','map','stamp','frame','postcard',
 'seashell','bottle-letter','wood-boat','starfish','brass-bell','old-ticket','sugar-fish','paper-lantern','pinecone','round-pebble','pressed-flower','feather','station-badge','little-bread','stamp-sheet','key-charm'];
const STICKERS=['wave','nap','fish','paw','heart','hop'];
const REGION_ICON:Record<TuanziRegion,string>={water:'seashell',street:'brass-bell',wild:'pinecone',town:'station-badge'};
const TUTORIAL_KEY='jigsaw:tuanzi-tutorial:v1',HOME_SEEN_KEY='jigsaw:tuanzi-home-seen:v1';
const STATUS:Record<string,[string,string]>={
 nap:['团子在垫子上打盹','给它装好布包，你离开游戏一会儿，它就会自己出门旅行。'],
 wait:['团子坐着等你走开','布包装好了。你离开游戏十来分钟后，它就会出发。'],
 leave:['团子背上布包出门啦','路上看到好看的地方，它会寄明信片回来。'],
 away:['团子出门旅行中','垫子上留了一张便条。明信片会寄到信箱里，不会过期。'],
 back:['团子回来啦！','背着布包回来的，看看它带了什么。'],
 tap:['喵～','团子蹭了蹭你的手。']};

type Cat='nap'|'wait'|'leave'|'away'|'back'|'tap';
const levelName=(id:string)=>{const m=/^ch(\d+)-(\d+)$/.exec(id);return m?'故事 '+m[1]+'-'+m[2]:id;};
const hexId=(h:TuanziHost)=>{const v=h.randomId().replace(/-/g,'').toLowerCase();return /^[a-f0-9]{32}$/.test(v)?v:Array.from({length:32},()=>Math.floor(Math.random()*16).toString(16)).join('');};

export class TuanziFeature{
 view:TuanziView|null=null;
 screen:TuanziScreen='nook';
 private loading:Promise<void>|null=null;private busy=false;private loadedAt=0;
 private cardId:string|null=null;private side:'front'|'back'='front';private region:TuanziRegion='town';private albumTab:'cards'|'souvenirs'='cards';
 private draft:{food:string|null;tool:string|null;charm:string|null}={food:null,tool:null,charm:null};
 private cat:Cat='nap';private catAt=Date.now();private catBefore:Cat='nap';private lastStatus:string|null=null;
 private coachBag=false;
 /** Last load or drawing failure, shown in the nook instead of a silent blank. */
 error:string|null=null;

 // ---------------------------------------------------------------- data
 get open():Open|null{return this.view&&!this.view.locked?this.view:null;}
 get unread(){return this.open?.unread??0;}
 /** One line for 欢迎回家 when postcards are waiting. */
 welcomeLine(){const n=this.unread;return n>0?'团子寄来了 '+n+' 张明信片':null;}
 load(h:TuanziHost,force=false){
  if(this.loading)return this.loading;if(!force&&Date.now()-this.loadedAt<15000&&this.view)return Promise.resolve();
  const started=Date.now();
  this.loading=h.get<TuanziView>('/api/mobile/tuanzi').then(view=>{this.error=null;this.accept(view);this.note(h,'团子 · 能力 on · '+(view.locked?'解锁 否（未通关'+levelName(view.unlockLevelId)+'）':'解锁 是 · '+(view.status==='away'?'出门中':'在家'))+' · 请求 200',started);h.invalidate();})
   .catch(error=>{const e=error as {message?:string;status?:number;code?:string};this.error=e?.message||String(error);console.error('[tuanzi] load',error);this.note(h,'团子 · 能力 on · 请求失败 '+(e?.status??e?.code??'')+' '+this.error,started);h.invalidate();}).finally(()=>{this.loading=null;});
  return this.loading;
 }
 /** One login-log line per change of state (the lobby polls the nook every few seconds). */
 private noted='';
 private note(h:TuanziHost,line:string,started:number){if(line===this.noted)return;this.noted=line;h.log?.(line+' · '+(Date.now()-started)+'ms');}
 /** Another account on this device (e.g. after TapTap binds the guest): nothing of the previous one is kept. */
 reset(){this.noted='';this.view=null;this.loadedAt=0;this.error=null;this.lastStatus=null;this.cat='nap';this.screen='nook';this.cardId=null;this.coachBag=false;}
 private accept(view:TuanziView){
  this.view=view;this.loadedAt=Date.now();if(view.locked)return;
  const status=view.status==='away'?'away':view.trip?.returned&&!this.homeSeen(view)?'back':view.pack?.food?'wait':'nap';
  // 团子 leaving while the nook is open plays the walk-out once; otherwise the state is shown as it is.
  if(this.lastStatus&&this.lastStatus!=='away'&&status==='away')this.setCat('leave');
  else if(this.cat!=='leave'&&this.cat!=='tap'&&!(this.cat==='back'&&status==='back'))this.setCat(status as Cat);
  this.lastStatus=status;
 }
 private homeSeen(view:Open){return !view.trip||!view.trip.returned||this.readStorage(HOME_SEEN_KEY)===view.trip.id;}
 private storage:TuanziHost['storage']|null=null;
 private readStorage(key:string){try{return this.storage?.get(key)??null;}catch{return null;}}
 private writeStorage(key:string,value:string){try{this.storage?.set(key,value);}catch{}}
 private async act<T extends TuanziView>(h:TuanziHost,path:string,body:Record<string,unknown>,done?:(reply:T)=>void){
  if(this.busy)return;this.busy=true;h.invalidate();
  try{const reply=await h.post<T>(path,{...body,requestId:hexId(h)});this.accept(reply);done?.(reply);}
  catch(error){h.note((error as {message?:string})?.message||'团子没听清，再试一次');}
  finally{this.busy=false;h.invalidate();}
 }
 /** Entering the nook: the first visit after story 1-2 opens the welcome and the packing lesson. */
 enter(h:TuanziHost){
  this.storage=h.storage;this.screen='nook';void this.load(h,true).then(()=>{
   const v=this.open;if(!v)return;
   if(v.trips===0&&this.readStorage(TUTORIAL_KEY)!=='done')this.screen='welcome';
   else if(v.trip?.returned&&!this.homeSeen(v))this.screen='home';
   h.invalidate();
  });
 }
 setCat(state:Cat){if(state==='tap'&&this.cat!=='tap')this.catBefore=this.cat==='leave'||this.cat==='back'?'wait':this.cat;this.cat=state;this.catAt=Date.now();}
 back(h:TuanziHost){
  if(this.screen==='postcard'&&this.side==='back'){this.side='front';h.invalidate();return;}
  if(this.screen==='postcard'){this.screen='mailbox';h.invalidate();return;}
  if(this.screen==='welcome'){this.writeStorage(TUTORIAL_KEY,'done');}
  if(this.screen!=='nook'){this.screen='nook';this.coachBag=false;h.invalidate();return;}
  h.close();
 }
 go(screen:TuanziScreen,h:TuanziHost){
  this.screen=screen;
  if(screen==='bag'){const p=this.open?.pack;this.draft={food:p?.food??null,tool:p?.tool??null,charm:p?.charm??null};}
  h.invalidate();
 }
 openCard(h:TuanziHost,card:TuanziPostcard){
  this.cardId=card.id;this.side='front';this.screen='postcard';h.invalidate();
  if(!card.read)void this.act(h,'/api/mobile/tuanzi/postcards/read',{cardIds:[card.id]});
 }
 /** After a postcard puzzle: the card the player was looking at, with its picture now clear. */
 showCard(cardId:string){this.cardId=cardId;this.side='front';this.screen='postcard';}

 // ---------------------------------------------------------------- art helpers
 private art(s:Stage,src:string,fallback?:string):HTMLImageElement|null{const e=(s as unknown as {load(src:string):{loaded:boolean;failed:boolean;image:HTMLImageElement}}).load(src);return e.loaded?e.image:e.failed&&fallback?this.art(s,fallback):null;}
 /** Draws a part of the feature; a failure is logged and shown, never left as a blank screen. */
 guard(h:TuanziHost,part:'nook'|'lobby',draw:()=>void){
  try{draw();}catch(error){
   const message=(error as {message?:string})?.message||String(error);if(this.error!==message){this.error=message;console.error('[tuanzi] draw '+part,error);}
   if(part==='nook'){const s=h.stage;s.ctx.fillStyle=h.colors.paper;s.ctx.fillRect(0,0,s.w,s.h);s.hit({x:0,y:0,w:s.w,h:s.h},()=>{});s.button({x:12,y:h.top+10,w:40,h:40},'',()=>h.close(),{icon:'back'});
    s.text('团子的小窝暂时打不开',24,s.h/2-30,16,h.colors.ink,800,s.w-48);this.wrap(s,'错误：'+message,24,s.h/2,s.w-48,12,h.colors.muted,18);}
  }
 }
 private icon(h:TuanziHost,id:string,r:Rect,fade=false){
  const s=h.stage,index=ICONS.indexOf(id),atlas=index>=0?this.art(s,ART.items,ART.itemsFallback):null;
  if(atlas){const size=Math.min(r.w,r.h),c=s.ctx;c.save();if(fade)c.globalAlpha*=.35;c.imageSmoothingEnabled=true;c.drawImage(atlas,(index%8)*128,Math.floor(index/8)*128,128,128,r.x+(r.w-size)/2,r.y+(r.h-size)/2,size,size);c.restore();return;}
  const fallback=(['onigiri','bento','deluxe','umbrella','ticket','tent','bell','knot','fish','envelope','bag','paw','shell'] as string[]).includes(id)?id:id==='seashell'?'shell':'paw';
  drawTravelIcon(s.ctx,fallback as TravelIcon,r,fade);
 }
 private sticker(h:TuanziHost,id:string,r:Rect){
  const s=h.stage,index=STICKERS.indexOf(id),sheet=this.art(s,ART.stickers,ART.stickersFallback);
  if(sheet&&index>=0){const size=Math.min(r.w,r.h);s.ctx.drawImage(sheet,index*160,0,160,160,r.x+(r.w-size)/2,r.y+(r.h-size)/2,size,size);}
  else drawTravelIcon(s.ctx,'paw',r);
 }
 /** Frame index from the time spent in the state (never from the number of redraws). */
 private frameOf(anim:Anim,elapsed:number){const a=TUANZI_ANIMS[anim],n=Math.floor(Math.max(0,elapsed)*a.fps/1000);return a.loop?n%a.frames:Math.min(n,a.frames-1);}
 /** Milliseconds until the next frame of `anim` is due. */
 private nextFrameIn(anim:Anim,elapsed:number){const step=1000/TUANZI_ANIMS[anim].fps;return Math.max(4,step-(Math.max(0,elapsed)%step));}
 private catArt(s:Stage,anim:Anim){return this.art(s,strip(anim)+'.webp',strip(anim)+'.png');}
 /** One cat frame with its ground point at (x, y), fractional positions allowed; ppu = screen px per world unit. */
 private catFrame(h:TuanziHost,anim:Anim,frame:number,x:number,y:number,ppu:number){
  const im=this.catArt(h.stage,anim);if(!im)return false;const a=TUANZI_ANIMS[anim],size=UNITS*ppu,c=h.stage.ctx;
  c.save();c.imageSmoothingEnabled=true;c.drawImage(im,(frame%a.cols)*FRAME,Math.floor(frame/a.cols)*FRAME,FRAME,FRAME,x-size/2,y-size*GROUND,size,size);c.restore();return true;
 }
 /** Starts downloading the strips the nook is about to need (images stay cached for the session). */
 warm(h:TuanziHost,anims:Anim[]){for(const anim of anims)this.catArt(h.stage,anim);}
 private drawCat(h:TuanziHost,cushion:{x:number;y:number},ppu:number,scene:Rect){
  const now=Date.now();
  const tap=TUANZI_ANIMS.tap;if(this.cat==='tap'&&now-this.catAt>tap.frames*1000/tap.fps+300){this.cat=this.catBefore;this.catAt=now;}
  const el=now-this.catAt,span=scene.x+scene.w+20*ppu-cushion.x;
  // Walking moves every display frame (at most 60 a second); standing states redraw only when their next frame is due.
  if(this.cat==='leave'){const p=Math.min(1,el/3400);if(p>=1){this.cat='away';this.catAt=now;}this.catFrame(h,'leave',this.frameOf('leave',el),cushion.x+span*p,cushion.y+span*p*.18,ppu);h.animate(16);this.warm(h,['awayBare']);return;}
  if(this.cat==='back'){const walk=2800,p=Math.min(1,el/walk),from=cushion.x-scene.x+20*ppu;this.warm(h,['back']);if(p<1){this.catFrame(h,'walkBack',this.frameOf('walkBack',el),cushion.x-from*(1-p),cushion.y,ppu);h.animate(16);return;}this.catFrame(h,'back',this.frameOf('back',el-walk),cushion.x,cushion.y,ppu);h.animate(this.nextFrameIn('back',el-walk));return;}
  const anim:Anim=this.cat==='nap'?'napBare':this.cat==='away'?'awayBare':this.cat;
  // The room is already on screen while the state's strip arrives; then only that state's frames are redrawn on time.
  if(!this.catFrame(h,anim,this.frameOf(anim,el),cushion.x,cushion.y,ppu))h.animate(120);
  else{h.animate(this.nextFrameIn(anim,el));if(anim!=='tap')this.warm(h,['tap']);}
  if(this.cat==='tap'&&el<1100){const s=h.stage,label='喵～',bw=s.measure(label,14,800)+20,b={x:Math.round(cushion.x+8*ppu),y:Math.round(cushion.y-30*ppu),w:bw,h:30};s.frame(b,'button-cream-normal');s.text(label,b.x+10,b.y+7,14,h.colors.ink,800);}
 }
 private badge(h:TuanziHost,x:number,y:number,label:string){const s=h.stage,c=s.ctx,w=Math.max(20,s.measure(label,12,800)+12);c.fillStyle='#d9485f';c.fillRect(Math.round(x-w/2),Math.round(y-10),Math.round(w),20);c.fillStyle='#5a2232';c.fillRect(Math.round(x-w/2),Math.round(y+10),Math.round(w),2);s.text(label,x-s.measure(label,12,800)/2,y-7,12,'#fffaf0',800);}
 private fishPill(h:TuanziHost,right:number,y:number){
  const s=h.stage,label=(this.open?.fish??0)+' 条',w=s.measure(label,14,800)+52,r={x:right-w,y,w,h:36};s.frame(r,'button-linen-normal');this.icon(h,'fish',{x:r.x+6,y:r.y+2,w:32,h:32});s.text(label,r.x+40,r.y+10,14,h.colors.ink,800);
  s.hit(r,()=>h.note('小鱼干：拼每日拼图、故事关、明信片都会得到，窗台每 3 小时也会晒好一些'));return r;
 }
 /** Floating surface over the room: translucent cream, soft shadow. */
 private float(h:TuanziHost,r:Rect,radius=14,alpha=.9){
  // The blurred shadow is costly to paint every frame: each size is painted once into a small canvas and reused.
  const c=h.stage.ctx,scale=c.getTransform().a||1,pad=20,w=Math.round(r.w),hh=Math.round(r.h),key=[w,hh,radius,alpha,scale].join(':');
  let cached=this.floats.get(key);
  if(!cached&&h.createCanvas){const canvas=h.createCanvas();canvas.width=Math.ceil((w+pad*2)*scale);canvas.height=Math.ceil((hh+pad*2)*scale);const g=canvas.getContext('2d');
   if(g){g.scale(scale,scale);g.shadowColor='rgba(92,52,40,.22)';g.shadowBlur=14*scale;g.shadowOffsetY=3*scale;g.fillStyle=`rgba(255,248,236,${alpha})`;g.beginPath();g.roundRect(pad,pad,w,hh,radius);g.fill();
    g.shadowColor='transparent';g.strokeStyle='rgba(150,96,76,.28)';g.lineWidth=1;g.stroke();if(this.floats.size>40)this.floats.clear();this.floats.set(key,cached=canvas);}}
  if(cached){c.drawImage(cached,r.x-pad,r.y-pad,w+pad*2,hh+pad*2);return;}
  c.save();c.shadowColor='rgba(92,52,40,.22)';c.shadowBlur=14;c.shadowOffsetY=3;c.fillStyle=`rgba(255,248,236,${alpha})`;
  c.beginPath();c.roundRect(r.x,r.y,r.w,r.h,radius);c.fill();c.shadowColor='transparent';c.strokeStyle='rgba(150,96,76,.28)';c.lineWidth=1;c.stroke();c.restore();
 }
 private floats=new Map<string,HTMLCanvasElement>();
 /** The room scaled to the screen once (walls, picture), redrawn only when the size or the picture changes. */
 private roomLayer:{key:string;canvas:HTMLCanvasElement}|null=null;
 /** Line breaks that never start a line with closing punctuation (it hangs at the end of the line before). */
 private lines(s:Stage,text:string,width:number,size:number){
  const rows:string[]=[];let line='';
  for(const char of text){if(char==='\n'){rows.push(line);line='';continue;}if(line&&s.measure(line+char,size)>width&&!'，。、！？；：）」』…'.includes(char)){rows.push(line);line=char;}else line+=char;}
  if(line)rows.push(line);return rows;
 }
 /** Stage.wrap with the same line breaks as lines(); returns the height used. */
 private wrap(s:Stage,text:string,x:number,y:number,width:number,size=14,color?:string,lineHeight=size*1.6){
  const rows=this.lines(s,text,width,size);rows.forEach((row,i)=>s.text(row,x,y+i*lineHeight,size,color));return rows.length*lineHeight;
 }
 /** Right edge for top-row items: left of TapTap's ••• capsule when it shares the row. */
 private rightEdge(h:TuanziHost,y:number,rowH:number){const m=h.menu,w=h.stage.w;return m&&m.y<y+rowH&&y<m.y+m.h?Math.min(w-12,m.x-8):w-12;}
 /** Back, title and fish float on the room; returns the y below them. */
 private header(h:TuanziHost,title:string,sub?:string){
  const s=h.stage,y=h.top+8;s.button({x:12,y:y+2,w:40,h:40},'',()=>this.back(h),{icon:'back'});
  const right=this.rightEdge(h,y,44),fishW=s.measure((this.open?.fish??0)+' 条',14,800)+52;
  // Beside the capsule on narrow phones the title keeps its full name: smaller, without the subtitle.
  const maxW=Math.max(80,right-fishW-8-60),roomy=s.measure(title,18,800)+24<=maxW,size=roomy?18:16;if(!roomy)sub=undefined;
  const tw=Math.min(maxW,Math.max(s.measure(title,size,800),sub?s.measure(sub,11,600):0)+24),pill={x:58,y,w:tw,h:44};
  this.float(h,pill,14);s.text(title,pill.x+12,pill.y+(sub?5:(44-size)/2),size,h.colors.ink,800,tw-24);if(sub)s.text(sub,pill.x+12,pill.y+27,11,h.colors.muted,600,tw-24);
  this.fishPill(h,right,y+4);return y+52;
 }
 private dim(h:TuanziHost){const s=h.stage;s.ctx.fillStyle=h.colors.overlay;s.ctx.fillRect(0,0,s.w,s.h);s.hit({x:0,y:0,w:s.w,h:s.h},()=>{});}
 private sheet(h:TuanziHost,title:string,maxW:number,height:number,sub?:string){
  const s=h.stage,w=Math.min(maxW,s.w-24),hh=Math.min(height,h.bottom-h.top-16),x=(s.w-w)/2,y=h.top+Math.max(8,(h.bottom-h.top-hh)/2);
  s.panel({x,y,w,h:hh});s.text(title,x+18,y+16,19,h.colors.ink,800,w-90);if(sub)s.text(sub,x+18,y+42,12,h.colors.muted,600,w-90);
  s.button({x:x+w-42,y:y+10,w:30,h:30},'',()=>this.back(h),{icon:'close'});
  return {x:x+16,y:y+(sub?66:52),w:w-32,h:hh-(sub?78:64)};
 }
 private tile(h:TuanziHost,r:Rect,icon:string,label:string,action:()=>void,badge?:string){
  const s=h.stage;this.float(h,r,16,.88);const size=Math.min(40,r.h-28);this.icon(h,icon,{x:r.x+(r.w-size)/2,y:r.y+4,w:size,h:size});
  s.text(label,r.x+(r.w-s.measure(label,12,750))/2,r.y+r.h-19,12,h.colors.ink,750,r.w-6);if(badge)this.badge(h,r.x+r.w-10,r.y+6,badge);s.hit(r,action);
 }
 private postmark(h:TuanziHost,cx:number,cy:number,place:string,date:string,r=36){
  const s=h.stage,c=s.ctx,ink='#b05a5a';c.save();c.strokeStyle=ink;c.lineWidth=2.5;c.beginPath();c.arc(cx,cy,r,0,Math.PI*2);c.stroke();c.lineWidth=1.2;c.beginPath();c.arc(cx,cy,r-6,0,Math.PI*2);c.stroke();
  for(let i=0;i<4;i++){c.beginPath();c.moveTo(cx+r+6,cy-12+i*8);c.bezierCurveTo(cx+r+26,cy-18+i*8,cx+r+40,cy-6+i*8,cx+r+64,cy-12+i*8);c.stroke();}c.restore();
  const short=place.length>5?place.slice(0,5):place;
  s.text(short,cx-s.measure(short,11,800)/2,cy-15,11,ink,800);s.text(date,cx-s.measure(date,12,800)/2,cy+3,12,ink,800);
 }
 private itemOf(id:string|null|undefined){return id?this.open?.catalog.shop.find(item=>item.id===id)??null:null;}

 // ---------------------------------------------------------------- screens
 draw(h:TuanziHost){
  this.storage=h.storage;const v=this.open;
  if(!v){this.drawWaiting(h);return;}
  this.drawNook(h,v);if(this.screen==='nook')return;
  this.dim(h);
  if(this.screen==='welcome')this.drawWelcome(h,v);else if(this.screen==='bag')this.drawBag(h,v);else if(this.screen==='shop')this.drawShop(h,v);
  else if(this.screen==='mailbox')this.drawMailbox(h,v);else if(this.screen==='postcard')this.drawPostcard(h,v);else if(this.screen==='album')this.drawAlbum(h,v);else this.drawHome(h,v);
 }
 private drawWaiting(h:TuanziHost){
  const s=h.stage;s.ctx.fillStyle=h.colors.paper;s.ctx.fillRect(0,0,s.w,s.h);s.hit({x:0,y:0,w:s.w,h:s.h},()=>{});
  s.button({x:12,y:h.top+10,w:40,h:40},'',()=>h.close(),{icon:'back'});
  const t=this.view?.locked?'通关故事 1-2 后，团子就会搬进小窝':this.error?'团子没连上，点一下再试':'团子正在整理小窝…';s.text(t,(s.w-s.measure(t,16,700))/2,s.h/2-10,16,h.colors.muted,700);
  if(this.error&&!this.view){const e='错误：'+this.error;this.wrap(s,e,24,s.h/2+18,s.w-48,12,h.colors.muted,18);s.hit({x:0,y:h.top+60,w:s.w,h:s.h-h.top-60},()=>{this.error=null;void this.load(h,true);h.invalidate();});}
 }
 private drawNook(h:TuanziHost,v:Open){
  const s=h.stage,c=h.colors;s.ctx.fillStyle='#f6e7d2';s.ctx.fillRect(0,0,s.w,s.h);s.hit({x:0,y:0,w:s.w,h:s.h},()=>{});
  // The room covers the whole screen; the crop keeps the cushion, the sill and the mailbox in view. Tall phones see the
  // room a little smaller, standing on the bottom edge, with its two walls carried on up to the top.
  const scene={x:0,y:0,w:s.w,h:s.h},k=Math.max(s.w/ROOM_W,s.h/ROOM_H*(h.landscape?1:.88)),dw=ROOM_W*k,dh=ROOM_H*k;
  const dx=Math.round(Math.min(0,Math.max(s.w-dw,s.w/2-dw*(h.landscape?.665:.64)))),dy=Math.round(dh<s.h?s.h-dh:Math.min(0,Math.max(s.h-dh,s.h/2-dh*.47)));
  const at=(nx:number,ny:number)=>({x:dx+nx*dw,y:dy+ny*dh});
  const im=this.art(s,ART.room,ART.roomFallback),paint=(g:CanvasRenderingContext2D)=>{
   if(dy>0){const corner=Math.round(dx+ROOM_CORNER*dw);g.fillStyle='#e6c69c';g.fillRect(0,0,s.w,dy+1);g.fillStyle='#be9d79';if(corner>0)g.fillRect(0,0,corner,dy+1);}
   if(im){g.save();g.imageSmoothingEnabled=true;g.drawImage(im,dx,dy,dw,dh);g.restore();}};
  const scale=s.ctx.getTransform().a||1,key=[s.w,s.h,scale,dx,dy,dw,!!im].join(':');
  if(im&&h.createCanvas&&this.roomLayer?.key!==key){const canvas=this.roomLayer?.canvas??h.createCanvas();canvas.width=Math.round(s.w*scale);canvas.height=Math.round(s.h*scale);const g=canvas.getContext('2d');if(g){g.setTransform(scale,0,0,scale,0,0);g.fillStyle='#f6e7d2';g.fillRect(0,0,s.w,s.h);paint(g);this.roomLayer={key,canvas};}}
  if(this.roomLayer?.key===key)s.ctx.drawImage(this.roomLayer.canvas,0,0,s.w,s.h);else paint(s.ctx);
  // Souvenirs stand on the shelf, newest last.
  const shelf=at(...SPOT.shelf),size=Math.max(18,Math.min(30,dw*.024));v.souvenirs.slice(-5).forEach((item,i)=>this.icon(h,item.id,{x:shelf.x-size*2.6+i*size*1.05,y:shelf.y-size*1.05,w:size,h:size}));
  const cushion=at(...SPOT.cushion);this.drawCat(h,cushion,ROOM_PPU*k,scene);
  const mail=at(...SPOT.mailbox);if(v.unread)this.badge(h,mail.x+26,mail.y-8,String(v.unread));s.hit({x:mail.x-40,y:mail.y-30,w:80,h:70},()=>this.go('mailbox',h));
  const cat=at(...SPOT.cat);s.hit({x:cat.x-70,y:cat.y-50,w:140,h:90},()=>{if(this.cat!=='away'&&this.cat!=='leave'){this.setCat('tap');h.invalidate();}else this.go('mailbox',h);});
  const bag=at(...SPOT.bag);s.hit({x:bag.x-36,y:bag.y-50,w:72,h:100},()=>this.go('bag',h));
  s.hit({x:shelf.x-size*3,y:shelf.y-size*1.4,w:size*6,h:size*1.8},()=>{this.albumTab='souvenirs';this.go('album',h);});
  if(v.sill.portions){const sill=at(...SPOT.sill),bubble={x:sill.x-38,y:sill.y-56,w:76,h:34};s.frame(bubble,'button-gold-normal');this.icon(h,'fish',{x:bubble.x+4,y:bubble.y+1,w:32,h:32});s.text('+'+v.sill.fish,bubble.x+40,bubble.y+9,14,c.onAccent,800);s.hit(bubble,()=>void this.act(h,'/api/mobile/tuanzi/sill',{},()=>h.note('收下 '+v.sill.fish+' 条小鱼干')));}
  // Floating layer: header, the status note under it, the four buttons along the bottom.
  const top=this.header(h,'团子的小窝','奶奶拼图小店的一角');
  const [line,sub]=STATUS[this.cat]??STATUS.nap;
  const detail=this.cat==='away'&&v.trip?(v.trip.first?'第一次出门，一会儿就回来。':'带着'+(this.itemOf(v.trip.food)?.title??'吃的')+'出发的，吃完就回家。')+(v.trip.cardsSent?' 已经寄来 '+v.trip.cardsSent+' 张。':''):sub;
  const noteW=Math.min(h.landscape?320:300,s.w-24),rows=this.lines(s,detail,noteW-28,12),note={x:12,y:top,w:noteW,h:36+rows.length*17};
  this.float(h,note,14,.86);s.text(line,note.x+14,note.y+10,15,c.ink,800,note.w-28);rows.forEach((row,i)=>s.text(row,note.x+14,note.y+31+i*17,12,c.muted));
  const actions:[string,string,TuanziScreen,string?][]=[['bag','布包','bag'],['bento','杂货铺','shop'],['envelope','信箱','mailbox',v.unread?String(v.unread):undefined],['postcard','明信片册','album']];
  const gap=10,bh=68,bw=h.landscape?76:Math.min(84,(s.w-24-gap*3)/4),rowW=bw*4+gap*3,bx=h.landscape?12:Math.round((s.w-rowW)/2),by=h.bottom-bh-10;
  actions.forEach(([icon,label,screen,badge],i)=>this.tile(h,{x:bx+i*(bw+gap),y:by,w:bw,h:bh},icon,label,()=>this.go(screen,h),badge));
 }
 private drawWelcome(h:TuanziHost,v:Open){
  const s=h.stage,c=h.colors,area=this.sheet(h,'团子搬进小窝啦',h.landscape?560:400,h.landscape?320:420);
  let y=area.y;const art={x:area.x,y,w:area.w,h:Math.min(130,area.h*.34)};
  const im=this.catArt(s,'wait');if(im){const size=Math.min(art.h*1.25,art.w*.5);s.ctx.drawImage(im,0,0,FRAME,FRAME,art.x+(art.w-size)/2,art.y-size*.12,size,size);}
  y+=art.h+8;
  y+=this.wrap(s,'奶奶给团子准备了一个旧布包。放进吃的，团子就会趁你离开的时候出门旅行，一路给你寄明信片——每一张都能拼。',area.x,y,area.w,13,c.ink,20)+10;
  const gift={x:area.x,y,w:area.w,h:48};s.frame(gift,'panel-gold');this.icon(h,'fish',{x:gift.x+8,y:gift.y+4,w:40,h:40});s.text(v.welcome.fish+' 条小鱼干',gift.x+52,gift.y+15,14,c.onAccent,800);
  this.icon(h,v.welcome.itemId,{x:gift.x+gift.w/2+8,y:gift.y+4,w:40,h:40});s.text('一个'+(this.itemOf(v.welcome.itemId)?.title??'饭团'),gift.x+gift.w/2+52,gift.y+15,14,c.onAccent,800);
  s.button({x:area.x,y:area.y+area.h-46,w:area.w,h:44},'去装包',()=>{this.writeStorage(TUTORIAL_KEY,'done');this.coachBag=true;this.go('bag',h);},{tone:'berrydark',fontSize:16});
 }
 private slot(h:TuanziHost,r:Rect,label:string,need:string,item:ShopItem|null,clear:()=>void){
  const s=h.stage,c=h.colors;s.frame(r,item?'panel-gold':'button-linen-disabled');
  s.text(label,r.x+(r.w-s.measure(label,13,800))/2,r.y+8,13,c.ink,800);s.text(need,r.x+(r.w-s.measure(need,10,600))/2,r.y+26,10,c.muted,600);
  if(item){this.icon(h,item.id,{x:r.x+(r.w-52)/2,y:r.y+40,w:52,h:52});s.hit(r,clear);}else{s.ctx.strokeStyle=c.line;s.ctx.setLineDash([4,4]);s.ctx.strokeRect(Math.round(r.x+(r.w-44)/2)+.5,Math.round(r.y+44)+.5,44,44);s.ctx.setLineDash([]);}
  const name=item?.title??'空着';s.text(name,r.x+(r.w-s.measure(name,12,700))/2,r.y+r.h-22,12,item?c.ink:c.muted,700,r.w-6);
 }
 private drawBag(h:TuanziHost,v:Open){
  this.warm(h,['leave']);
  const s=h.stage,c=h.colors,area=this.sheet(h,'奶奶的旧布包',h.landscape?680:420,h.landscape?370:520,'吃的决定走多远，道具决定去哪里，护身符可以带一个');
  if(v.status==='away'){this.wrap(s,'团子正背着布包在外面旅行，回来以后再装吧。',area.x,area.y+8,area.w,14,c.muted,22);return;}
  const gap=10,sw=h.landscape?Math.min(130,(area.w*.52-gap*2)/3):(area.w-gap*2)/3,sh=132,d=this.draft;
  const slots:[string,string,'food'|'tool'|'charm'][]=[['吃的','必须放','food'],['道具','可以空着','tool'],['护身符','可以空着','charm']];
  slots.forEach(([label,need,slot],i)=>this.slot(h,{x:area.x+i*(sw+gap),y:area.y,w:sw,h:sh},label,need,this.itemOf(d[slot]),()=>{d[slot]=null;h.invalidate();}));
  // The shelf: everything the player owns, plus what is already in the bag.
  const listX=h.landscape?area.x+sw*3+gap*3+6:area.x,listY=h.landscape?area.y:area.y+sh+14,listW=h.landscape?area.x+area.w-listX:area.w;
  s.text('柜子里的东西',listX,listY,14,c.ink,800);
  const owned=v.catalog.shop.map(item=>({item,count:(v.inventory[item.id]??0)+(v.pack&&(v.pack as Record<string,string|null>)[item.slot]===item.id?1:0)})).filter(e=>e.count>0);
  const cols=h.landscape?3:4,cw=(listW-(cols-1)*8)/cols,ch=78;
  if(!owned.length)this.wrap(s,'柜子空空的，去杂货铺买点吃的吧。',listX,listY+26,listW,12,c.muted,18);
  owned.forEach(({item,count},i)=>{
   const r={x:listX+(i%cols)*(cw+8),y:listY+24+Math.floor(i/cols)*(ch+8),w:cw,h:ch},inBag=d[item.slot]===item.id,left=count-(inBag?1:0);
   s.frame(r,inBag?'panel-gold':left?'button-cream-normal':'button-cream-disabled');this.icon(h,item.id,{x:r.x+(r.w-36)/2,y:r.y+5,w:36,h:36},!left&&!inBag);
   s.text(item.title,r.x+(r.w-s.measure(item.title,12,700))/2,r.y+44,12,c.ink,700,r.w-4);const n=inBag?'在包里':'×'+left;s.text(n,r.x+(r.w-s.measure(n,11,600))/2,r.y+60,11,c.muted,600);
   s.hit(r,()=>{d[item.slot]=inBag?null:item.id;this.coachBag=false;h.invalidate();});
   if(this.coachBag&&item.slot==='food'&&!d.food&&i===owned.findIndex(e=>e.item.slot==='food')){s.ctx.strokeStyle=c.berry;s.ctx.lineWidth=3;s.ctx.strokeRect(r.x-3,r.y-3,r.w+6,r.h+6);s.text('点一下放进去',r.x,r.y+r.h+6,12,c.berry,800);}
  });
  const by=area.y+area.h-46,first=v.trips===0;
  this.wrap(s,first?'第一次出门很快：放好吃的点「装好了」，团子马上出发，20 分钟后回来。':'装好后，你离开游戏十来分钟，团子就会出发。没有惩罚，明信片也不会过期。',area.x,by-36,area.w,12,c.muted,16);
  const changed=JSON.stringify(d)!==JSON.stringify(v.pack??{food:null,tool:null,charm:null});
  s.button({x:area.x,y:by,w:area.w,h:44},this.busy?'正在装…':first?'装好了，出发！':changed?'装好了':'就这样',()=>{
   if(!d.food&&(d.tool||d.charm)){h.note('先放一份吃的');return;}
   if(!changed){this.back(h);return;}
   void this.act(h,'/api/mobile/tuanzi/pack',{...d},reply=>{const packed=(reply as unknown as {packed?:{departed:boolean}}).packed;this.screen='nook';if(packed?.departed){this.setCat('leave');h.note('团子第一次出门啦！'+v.catalog.firstTripMinutes+' 分钟后回来，路上会寄一张明信片');}else if(d.food)h.note('装好啦，你离开一会儿团子就出发');});
  },{tone:'berrydark',fontSize:16,disabled:this.busy||(first&&!d.food)});
 }
 private drawShop(h:TuanziHost,v:Open){
  const s=h.stage,c=h.colors,area=this.sheet(h,'杂货铺',h.landscape?820:420,h.landscape?380:680,'用小鱼干换东西，买好放进布包');
  this.fishPill(h,area.x+area.w-38,area.y-60);
  const items=v.catalog.shop,cols=h.landscape?4:2,gap=8,cw=(area.w-gap*(cols-1))/cols,rows=Math.ceil(items.length/cols),ch=Math.min(h.landscape?146:136,(area.h-gap*(rows-1))/rows);
  const desc=(item:ShopItem)=>item.slot==='food'?`走 ${item.hours![0]}–${item.hours![1]} 小时，寄 ${item.cards![0]===item.cards![1]?item.cards![0]:item.cards![0]+'–'+item.cards![1]} 张（${item.pieces} 片）`:item.slot==='tool'?'去'+(v.catalog.regions.find(r=>r.id===item.region)?.title??'远方'):item.effect==='rare-double'?'稀有明信片的机会翻倍':'一定会带纪念品回来';
  items.forEach((item,i)=>{
   const r={x:area.x+(i%cols)*(cw+gap),y:area.y+Math.floor(i/cols)*(ch+gap),w:cw,h:ch};s.frame(r,'button-cream-normal');
   const size=h.landscape?40:44;this.icon(h,item.id,{x:r.x+6,y:r.y+6,w:size,h:size});
   const have=(v.inventory[item.id]??0);
   s.text(item.title,r.x+size+12,r.y+10,14,c.ink,800,r.w-size-18);s.text({food:'吃的',tool:'道具',charm:'护身符'}[item.slot]+(have?' · 已有 '+have:''),r.x+size+12,r.y+29,11,c.muted,600,r.w-size-18);
   this.wrap(s,desc(item),r.x+10,r.y+size+12,r.w-20,11,c.muted,15);
   const b={x:r.x+8,y:r.y+r.h-38,w:r.w-16,h:32},label=String(item.price),poor=v.fish<item.price;s.frame(b,poor||this.busy?'button-gold-disabled':'button-gold-normal');
   const tw=s.measure(label,15,800),bx=b.x+(b.w-tw-36)/2;this.icon(h,'fish',{x:bx,y:b.y,w:32,h:32});s.text(label,bx+36,b.y+8,15,c.ink,800);
   s.hit(b,()=>{if(poor){h.note('小鱼干不够，拼一张图再来吧');return;}void this.act(h,'/api/mobile/tuanzi/buy',{itemId:item.id},()=>h.note('买好了：'+item.title));});
  });
 }
 private drawMailbox(h:TuanziHost,v:Open){
  const s=h.stage,c=h.colors,area=this.sheet(h,'信箱',h.landscape?600:420,h.landscape?360:560,'团子寄来的明信片，不会过期');
  const list=v.postcards,rowH=78,rows=Math.max(1,Math.floor(area.h/(rowH+8)));
  if(!list.length){this.wrap(s,'还没有明信片。给团子装好布包，它出门以后就会寄来。',area.x,area.y+8,area.w,13,c.muted,20);return;}
  list.slice(0,rows).forEach((card,i)=>{
   const r={x:area.x,y:area.y+i*(rowH+8),w:area.w,h:rowH};s.frame(r,card.read?'button-linen-disabled':'button-cream-normal');
   this.icon(h,'envelope',{x:r.x+8,y:r.y+7,w:62,h:62});
   s.text(card.read?card.title:'团子寄来的明信片',r.x+80,r.y+13,15,c.ink,800,r.w-160);
   s.text(card.regionTitle+(card.kind==='rare'?' · 稀有':'')+(card.completed?' · 拼好了':''),r.x+80,r.y+38,12,c.muted,600,r.w-160);
   this.postmark(h,r.x+r.w-42,r.y+39,card.place,card.date.slice(5),26);
   if(!card.read)this.badge(h,r.x+r.w-14,r.y+8,'新');s.hit(r,()=>this.openCard(h,card));
  });
  if(list.length>rows)s.text('还有 '+(list.length-rows)+' 张在明信片册里',area.x,area.y+rows*(rowH+8),12,c.muted,600);
 }
 private drawPostcard(h:TuanziHost,v:Open){
  const s=h.stage,c=h.colors,card=v.postcards.find(item=>item.id===this.cardId);if(!card){this.screen='mailbox';return;}
  const w=Math.min(600,s.w-36,(h.bottom-h.top-110)*1.5),ch=w/1.5,x=(s.w-w)/2,y=h.top+Math.max(14,(h.bottom-h.top-ch-80)/2),r={x,y,w,h:ch};
  s.button({x:12,y:h.top+10,w:40,h:40},'',()=>this.back(h),{icon:'back'});
  if(this.side==='front'){
   s.ctx.fillStyle='#fffdf7';s.ctx.fillRect(r.x-8,r.y-8,r.w+16,r.h+16);s.frame({x:r.x-10,y:r.y-10,w:r.w+20,h:r.h+20},'panel-cream');
   const src=card.completed?card.src:card.thumbSrc;
   if(src){if(!card.completed){s.ctx.save();s.ctx.filter='blur(6px) saturate(.6)';}s.image(src,r,'cover');if(!card.completed){s.ctx.restore();s.ctx.fillStyle='#fff8ee99';s.ctx.fillRect(r.x,r.y,r.w,r.h);}}
   if(card.kind!=='gallery'){const tag=card.kind==='rare'?'稀有 · 团子在这里':'第一次出门',tw=s.measure(tag,12,800)+20;s.frame({x:r.x+8,y:r.y+8,w:tw,h:28},'button-gold-normal');s.text(tag,r.x+18,r.y+15,12,c.onAccent,800);}
   if(!card.completed){const t='拼完就能看清',tw=s.measure(t,16,800);s.text(t,r.x+(r.w-tw)/2,r.y+r.h/2-20,16,c.ink,800);const p=card.pieces+' 片 · 拼完 +'+v.catalog.postcardFish+' 条小鱼干';s.text(p,r.x+(r.w-s.measure(p,12,600))/2,r.y+r.h/2+4,12,c.muted,600,r.w-20);}
   if(card.album){const t='来自「'+card.album.title+'」'+(card.album.paid?' · 图包':''),tw=s.measure(t,11,700)+16,b={x:r.x+r.w-tw-8,y:r.y+r.h-32,w:tw,h:24};s.frame(b,'button-linen-normal');s.text(t,b.x+8,b.y+5,11,c.ink,700);s.hit(b,()=>h.openAlbum(card.album!.id));}
   const by=r.y+r.h+22,bw=(w-10)/2;
   s.button({x,y:by,w:bw,h:44},'翻到背面',()=>{this.side='back';h.invalidate();},{fontSize:15});
   const playable=!card.unavailable&&card.cols&&card.rows;
   s.button({x:x+bw+10,y:by,w:bw,h:44},card.completed?'再拼一次':'拼这张',()=>{if(playable)h.play(card);else h.note('这张图暂时不能拼');},{tone:'berrydark',fontSize:15,disabled:!playable});
   return;
  }
  s.ctx.fillStyle='#fbf2e2';s.ctx.fillRect(r.x,r.y,r.w,r.h);s.frame({x:r.x-10,y:r.y-10,w:r.w+20,h:r.h+20},'panel-cream');
  s.ctx.strokeStyle='#e2cdb6';s.ctx.lineWidth=1;s.ctx.beginPath();s.ctx.moveTo(r.x+r.w*.56+.5,r.y+18);s.ctx.lineTo(r.x+r.w*.56+.5,r.y+r.h-18);s.ctx.stroke();
  s.ctx.save();s.ctx.beginPath();s.ctx.rect(r.x,r.y,r.w,r.h);s.ctx.clip();
  const stamp={x:r.x+r.w-76,y:r.y+14,w:60,h:72};s.ctx.fillStyle='#fffaf0';s.ctx.fillRect(stamp.x-4,stamp.y-4,stamp.w+8,stamp.h+8);if(card.thumbSrc)s.image(card.thumbSrc,stamp,'cover');
  this.postmark(h,stamp.x-12,stamp.y+50,card.place,card.date.slice(5),34);s.ctx.restore();
  const lx=r.x+16,lw=r.w*.56-28,ly=r.y+r.h*.18,size=Math.min(16,Math.floor(lw/11));
  const end=ly+this.wrap(s,card.line,lx,ly,lw,size,c.ink,size*1.55);s.text('—— 团子',lx+lw-s.measure('—— 团子',12,700),end+6,12,c.muted,700);
  this.sticker(h,card.sticker,{x:lx,y:end+6,w:64,h:64});
  const ax=r.x+r.w*.56+14,aw=r.w*.44-28;['拾光镇 奶奶的小店',h.playerName+' 收'].forEach((line,i)=>{const yy=r.y+r.h*.62+i*30;s.text(line,ax,yy,12,c.ink,700,aw);s.ctx.strokeStyle='#d8bfa6';s.ctx.setLineDash([3,3]);s.ctx.beginPath();s.ctx.moveTo(ax,yy+22.5);s.ctx.lineTo(ax+aw,yy+22.5);s.ctx.stroke();s.ctx.setLineDash([]);});
  const by=r.y+r.h+22,bw=(w-10)/2,playable=!card.unavailable&&card.cols&&card.rows;
  s.button({x,y:by,w:bw,h:44},card.completed?'再拼一次':'拼这张',()=>{if(playable)h.play(card);},{tone:'berrydark',fontSize:15,disabled:!playable});
  s.button({x:x+bw+10,y:by,w:bw,h:44},'和拼友一起拼',()=>{if(card.roomable)h.together(card);else h.note(card.kind==='gallery'?'这张图暂时不能开房':'这张明信片只能自己拼');},{icon:'invite',fontSize:14,disabled:!card.roomable});
 }
 private drawAlbum(h:TuanziHost,v:Open){
  const s=h.stage,c=h.colors,area=this.sheet(h,'明信片册',h.landscape?840:420,h.landscape?390:680,'共 '+v.album.total+' 张 · 稀有 '+v.album.rare+'/'+v.album.rareTotal);
  s.segments({x:area.x,y:area.y,w:area.w,h:36},[['cards','明信片'],['souvenirs','纪念品']] as const,this.albumTab,key=>{this.albumTab=key;h.invalidate();});
  let y=area.y+46;
  if(this.albumTab==='souvenirs'){
   const have=new Map(v.souvenirs.map(item=>[item.id,item.count])),cols=h.landscape?8:4,gap=8,cw=(area.w-gap*(cols-1))/cols,chh=Math.min(96,(area.y+area.h-y)/Math.ceil(16/cols)-gap);
   v.catalog.souvenirs.forEach((item,i)=>{const r={x:area.x+(i%cols)*(cw+gap),y:y+Math.floor(i/cols)*(chh+gap),w:cw,h:chh},n=have.get(item.id)??0;s.frame(r,n?'button-cream-normal':'button-linen-disabled');this.icon(h,item.id,{x:r.x+(r.w-44)/2,y:r.y+4,w:44,h:44},!n);const t=n?item.title+(n>1?' ×'+n:''):'？';s.text(t,r.x+(r.w-s.measure(t,11,700))/2,r.y+r.h-20,11,n?c.ink:c.muted,700,r.w-4);});
   return;
  }
  s.segments({x:area.x,y,w:area.w,h:34},v.catalog.regions.map(r=>[r.id,r.title+' '+v.album.regions[r.id]] as const),this.region,key=>{this.region=key;h.invalidate();});
  y+=44;
  // Rewards on one track: 5 / 15 / 30 postcards in all, plus this region's stamp at 10.
  const totals=v.album.rewards.filter(r=>r.key.startsWith('total-')),regional=v.album.rewards.find(r=>r.key==='region-'+this.region),end=Math.max(30,v.album.total);
  s.meter({x:area.x,y,w:area.w,h:10},Math.min(1,v.album.total/end));
  totals.forEach(reward=>{const mx=area.x+area.w*(reward.at/end);s.ctx.fillStyle=reward.taken?c.gold:c.line;s.ctx.fillRect(Math.round(mx)-2,y-4,4,18);const t=reward.at+' · '+(reward.fish?reward.fish+' 条':reward.decorationId?'邮差团子':'旅行地图'),tw=s.measure(t,10,600);s.text(t,Math.min(area.x+area.w-tw,Math.max(area.x,mx-tw/2)),y+16,10,reward.taken?c.ink:c.muted,600);});
  y+=34;if(regional){const t=(regional.taken?'已得到 ':'集满 10 张：')+(regional.title??'邮票');s.text(t,area.x,y,12,regional.taken?c.ink:c.muted,700,area.w);}
  y+=22;const cards=v.postcards.filter(card=>card.region===this.region),cols=h.landscape?6:3,gap=8,cw=(area.w-gap*(cols-1))/cols,chh=cw/1.5,rows=Math.max(1,Math.floor((area.y+area.h-y+gap)/(chh+gap)));
  for(let i=0;i<cols*rows;i++){
   const r={x:area.x+(i%cols)*(cw+gap),y:y+Math.floor(i/cols)*(chh+gap),w:cw,h:chh},card=cards[i];
   if(card){s.ctx.fillStyle='#fffdf7';s.ctx.fillRect(r.x-3,r.y-3,r.w+6,r.h+6);if(card.thumbSrc){if(!card.completed){s.ctx.save();s.ctx.globalAlpha*=.55;}s.image(card.thumbSrc,r,'cover');if(!card.completed)s.ctx.restore();}if(card.kind!=='gallery'){s.ctx.strokeStyle=c.gold;s.ctx.lineWidth=3;s.ctx.strokeRect(r.x-1.5,r.y-1.5,r.w+3,r.h+3);}s.hit(r,()=>this.openCard(h,card));}
   else{s.ctx.strokeStyle=c.line;s.ctx.setLineDash([4,4]);s.ctx.lineWidth=1;s.ctx.strokeRect(Math.round(r.x)+.5,Math.round(r.y)+.5,Math.round(r.w)-1,Math.round(r.h)-1);s.ctx.setLineDash([]);}
  }
 }
 private drawHome(h:TuanziHost,v:Open){
  const s=h.stage,c=h.colors,trip=v.trip;if(!trip){this.screen='nook';return;}
  const area=this.sheet(h,'团子回来啦！',h.landscape?640:400,h.landscape?340:480);
  const souvenir=trip.souvenir?v.catalog.souvenirs.find(item=>item.id===trip.souvenir):null;
  let y=area.y;const art={x:area.x,y,w:area.w,h:Math.min(150,area.h*.36)},im=this.catArt(s,'back');
  if(im){const size=art.h*1.25;s.ctx.drawImage(im,0,0,FRAME,FRAME,art.x+(art.w-size)/2,art.y-size*.12,size,size);}
  y+=art.h+8;
  const box={x:area.x,y,w:area.w,h:76};s.frame(box,souvenir?'panel-gold':'button-linen-normal');
  if(souvenir){this.icon(h,souvenir.id,{x:box.x+8,y:box.y+6,w:64,h:64});s.text('带回了纪念品',box.x+80,box.y+12,11,c.onAccent,700);s.text(souvenir.title,box.x+80,box.y+30,18,c.onAccent,800,box.w-90);}
  else{this.icon(h,'paw',{x:box.x+8,y:box.y+6,w:64,h:64});this.wrap(s,'这趟没带纪念品，不过玩得很开心。',box.x+80,box.y+18,box.w-90,13,c.ink,19);}
  y+=box.h+12;this.icon(h,'envelope',{x:area.x,y:y-6,w:32,h:32});s.text('这趟寄回 '+trip.cardsSent+' 张明信片'+(trip.duplicates?'（重复的换成了 '+trip.duplicates*3+' 条小鱼干）':''),area.x+38,y+2,13,c.ink,700,area.w-40);
  const done=()=>{this.writeStorage(HOME_SEEN_KEY,trip.id);this.setCat(v.pack?.food?'wait':'nap');};
  const by=area.y+area.h-46,bw=(area.w-10)/2;
  s.button({x:area.x,y:by,w:bw,h:44},'看看信箱',()=>{done();this.go('mailbox',h);},{fontSize:15});
  s.button({x:area.x+bw+10,y:by,w:bw,h:44},'再装个包',()=>{done();this.go('bag',h);},{tone:'berrydark',fontSize:15});
 }
 /** 大厅团子角落: the nap / away cut, the status, unread postcards and the windowsill. */
 drawLobbyCorner(h:TuanziHost,r:Rect,open:()=>void,story?:()=>void){
  // Before story 1-2 the corner says what brings 团子 in and leads to the story.
  if(this.view?.locked){
   const s=h.stage,c=h.colors,lock=this.view.unlockLevelId;s.frame(r,'button-linen-normal');s.hit(r,story??open);
   const art={x:r.x+4,y:r.y+2,w:120,h:r.h-4},sheet=this.art(s,ART.lobby,ART.lobbyFallback),anim=TUANZI_LOBBY.away;
   if(sheet){const w=112,hh=64;s.ctx.save();s.ctx.globalAlpha=.55;s.ctx.imageSmoothingEnabled=true;s.ctx.drawImage(sheet,0,anim.y,224,128,Math.round(art.x+(art.w-w)/2),Math.round(r.y+r.h-hh-4),w,hh);s.ctx.restore();}
   const tx=art.x+art.w+6,textW=r.x+r.w-10-tx;
   s.text('团子的小窝',tx,r.y+(r.h>70?14:9),15,c.ink,800,textW);s.text('通关'+levelName(lock)+'，团子就会搬进来',tx,r.y+(r.h>70?38:31),12,c.muted,600,textW);return;
  }
  const v=this.open;if(!v)return;
  const s=h.stage,c=h.colors;s.frame(r,'button-linen-normal');s.hit(r,open);
  const art={x:r.x+4,y:r.y+2,w:120,h:r.h-4},away=v.status==='away',anim=away?TUANZI_LOBBY.away:TUANZI_LOBBY.nap,sheet=this.art(s,ART.lobby,ART.lobbyFallback);
  if(sheet){h.animate();const frame=Math.floor(Date.now()*anim.fps/1000)%anim.frames,w=112,hh=64;s.ctx.save();s.ctx.imageSmoothingEnabled=true;s.ctx.drawImage(sheet,frame*224,anim.y,224,128,Math.round(art.x+(art.w-w)/2),Math.round(r.y+r.h-hh-4),w,hh);s.ctx.restore();}
  const tx=art.x+art.w+6,right=r.x+r.w-10,textW=right-tx-(v.sill.portions?84:46);
  const line=away?'团子出门旅行了':v.trip?.returned&&!this.homeSeen(v)?'团子回来啦，带了东西':v.pack?.food?'团子装好包，在等你走开':'团子在垫子上打盹';
  s.text('团子的小窝',tx,r.y+(r.h>70?14:9),15,c.ink,800,textW);s.text(line,tx,r.y+(r.h>70?38:31),12,c.muted,600,textW);
  const mail={x:right-38,y:r.y+(r.h-36)/2,w:36,h:36};this.icon(h,'envelope',mail);if(v.unread)this.badge(h,mail.x+mail.w-2,mail.y+4,String(v.unread));
  if(v.sill.portions){const f={x:mail.x-40,y:mail.y,w:36,h:36};this.icon(h,'fish',f);this.badge(h,f.x+f.w-2,f.y+4,'+'+v.sill.fish);}
  // Once the lobby's own pictures are in, fetch what the nook opens with (room, icons, the state's strip) so it appears at once.
  const now=Date.now();if(this.warmAt===0)this.warmAt=now+2500;
  if(now<this.warmAt||!h.stage.imagesIdle())h.animate(Math.max(500,this.warmAt-now));
  else{this.art(s,ART.room,ART.roomFallback);this.art(s,ART.items,ART.itemsFallback);this.warm(h,[away?'awayBare':v.trip?.returned&&!this.homeSeen(v)?'walkBack':v.pack?.food?'wait':'napBare']);}
 }
 private warmAt=0;
}
