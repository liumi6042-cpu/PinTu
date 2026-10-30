import type {Platform,Rect,Input} from './ports';
import {coreBounds,taskBounds} from './art-bounds';
import cardAtlas from '../public/mobile-icons/b2-card-icons1023.json';
import pixelFrames from './pixel-frame-data.json';
import {mobileSymbolPaths} from '../h5/mobile-symbol-paths';
/** Crosshair for the room's locate-loose-pieces tool, in the same 24×24 pixel grid. */
const locateSymbol=[{d:'M8 4h8v1h2v1h1v2h1v8h-1v2h-1v1h-2v1H8v-1H6v-1H5v-2H4V8h1V6h1V5h2zM9 7v1H8v1H7v6h1v1h1v1h6v-1h1v-1h1V9h-1V8h-1V7z',fillRule:'evenodd'},{d:'M11 0h2v4h-2zM11 20h2v4h-2zM0 11h4v2H0zM20 11h4v2h-4zM10 10h4v4h-4z'}] as const;
/** View lock, closed and open, on the same grid. */
const lockSymbol=[{d:'M5 10h14v12H5zM11 13v5h2v-5z',fillRule:'evenodd'},{d:'M6 4h2v6H6zM8 2h8v2H8zM16 4h2v6h-2z'}] as const;
const unlockSymbol=[{d:'M5 10h14v12H5zM11 13v5h2v-5z',fillRule:'evenodd'},{d:'M6 4h2v6H6zM8 2h8v2H8zM16 4h2v2h-2z'}] as const;
import collectionCatalog from '../lib/mobile-collection-catalog.json';
import {lightThemeColors,themeColors,themeUiColor,themeFrameColor,themeTextColor,type ThemeId} from './theme';
import {StageImageCache} from './image-cache';
import {cropCover,type ComicCrop} from './story-comic';

// Compatibility for existing imports; each Stage owns its active theme.
export const palette=lightThemeColors;
type Hit={r:Rect;fn:()=>void};
const inside=(r:Rect,x:number,y:number)=>x>=r.x&&x<=r.x+r.w&&y>=r.y&&y<=r.y+r.h;
const intersection=(a:Rect,b:Rect):Rect=>({x:Math.max(a.x,b.x),y:Math.max(a.y,b.y),w:Math.max(0,Math.min(a.x+a.w,b.x+b.w)-Math.max(a.x,b.x)),h:Math.max(0,Math.min(a.y+a.h,b.y+b.h)-Math.max(a.y,b.y))});
const fitInside=(r:Rect,width:number,height:number):Rect=>{const scale=Math.min(r.w/width,r.h/height),w=width*scale,h=height*scale;return{x:r.x+(r.w-w)/2,y:r.y+(r.h-h)/2,w,h};};

/** One immediate-mode UI renderer used by both platforms. Coordinates are logical pixels. */
export class Stage{
 readonly ctx:CanvasRenderingContext2D;
 w=0;h=0;dirty=true;font='sans-serif';
 private hits:Hit[]=[];private clips:Rect[]=[];private offset={x:0,y:0};private inputSuspended=0;
 private readonly images:StageImageCache;
 private decorationTints=new Map<string,{image:HTMLCanvasElement;art:Rect}>();
 private down:{x:number;y:number;target:Hit|undefined}|null=null;
 private pixelScaleX=1;private pixelScaleY=1;
 private currentTheme:ThemeId='light';
 constructor(readonly platform:Platform,readonly asset:(path:string)=>string){const ctx=platform.canvas.getContext('2d');if(!ctx)throw Error('画布暂不可用');this.ctx=ctx;this.images=new StageImageCache(platform,this.invalidate);this.resize();if(platform.config.id==='taptap')this.load('/mobile-icons/b2-supply-scenes.png');}
 get theme(){return this.currentTheme;}
 get palette(){return themeColors(this.currentTheme);}
 setTheme(theme:ThemeId){if(this.currentTheme===theme)return;this.currentTheme=theme;this.invalidate();}
 color(value:string){return themeUiColor(this.currentTheme,value);}
 resize(){const v=this.platform.viewport();this.w=v.width;this.h=v.height;const width=Math.round(v.width*v.dpr),height=Math.round(v.height*v.dpr);if(this.platform.canvas.width!==width)this.platform.canvas.width=width;if(this.platform.canvas.height!==height)this.platform.canvas.height=height;this.pixelScaleX=this.platform.canvas.width/Math.max(1,this.w);this.pixelScaleY=this.platform.canvas.height/Math.max(1,this.h);this.dirty=true;}
 invalidate=()=>{this.dirty=true;};
 begin(){this.images.beginFrame();const c=this.ctx;c.setTransform(this.pixelScaleX,0,0,this.pixelScaleY,0,0);c.globalAlpha=1;c.clearRect(0,0,this.w,this.h);c.fillStyle=this.palette.paper;c.fillRect(0,0,this.w,this.h);this.hits=[];this.clips=[];this.offset={x:0,y:0};this.dirty=false;}
 endFrame(){this.images.endFrame();}
 imageDiagnostics(){return this.images.diagnostics();}
 /** Paint a loading shell without registering actions for an unknown identity. */
 withoutInput(draw:()=>void){this.inputSuspended++;try{draw();}finally{this.inputSuspended--;}}
 destroy(){this.images.destroy();this.decorationTints.clear();this.hits=[];this.down=null;}
 /** Reuse a scene inside a desktop pane while retaining screen-space input. */
 withViewport(r:Rect,draw:()=>void){
  const previous={w:this.w,h:this.h,offset:this.offset};
  this.clip(r,()=>{this.ctx.translate(r.x,r.y);this.offset={x:previous.offset.x+r.x,y:previous.offset.y+r.y};this.w=r.w;this.h=r.h;
   try{draw();}finally{this.w=previous.w;this.h=previous.h;this.offset=previous.offset;}
  });
 }
 /** Draw one line centred on the vertical line cy using the font's real glyph bounds (device fonts differ).
  *  Pass the same `reference` to labels that must share one baseline (e.g. digits next to a %). */
 textMiddle(value:string|number,x:number,cy:number,size=14,color=this.palette.ink,weight:string|number=500,reference?:string){const c=this.ctx;c.save();c.font=`${weight} ${size}px ${this.font}`;c.fillStyle=themeTextColor(this.currentTheme,color);c.textBaseline='alphabetic';const text=String(value??''),m=c.measureText(reference??text),ascent=m.actualBoundingBoxAscent||size*.8,descent=m.actualBoundingBoxDescent||size*.2;c.fillText(text,x,cy+(ascent-descent)/2);c.restore();}
 text(value:string|number,x:number,y:number,size=14,color=this.palette.ink,weight:string|number=500,maxWidth?:number){const c=this.ctx;c.save();c.font=`${weight} ${size}px ${this.font}`;c.fillStyle=themeTextColor(this.currentTheme,color);c.textBaseline='top';let text=String(value??'');if(maxWidth&&c.measureText(text).width>maxWidth){while(text.length>1&&c.measureText(text+'…').width>maxWidth)text=text.slice(0,-1);text+='…';}c.fillText(text,x,y);c.restore();}
 measure(value:string,size=14,weight:string|number=500){this.ctx.font=`${weight} ${size}px ${this.font}`;return this.ctx.measureText(value).width;}
 wrap(value:string,x:number,y:number,width:number,size=14,color=this.palette.muted,lineHeight=size*1.6){let line='',row=0;for(const char of value){if(char==='\n'||this.measure(line+char,size)>width){this.text(line,x,y+row*lineHeight,size,color);row++;line=char==='\n'?'':char;}else line+=char;}if(line)this.text(line,x,y+row*lineHeight,size,color);return (row+1)*lineHeight;}
 private pixelPath(r:Rect,cut=3){const c=this.ctx;c.beginPath();c.moveTo(r.x+cut,r.y);c.lineTo(r.x+r.w-cut,r.y);c.lineTo(r.x+r.w-cut,r.y+1);c.lineTo(r.x+r.w-1,r.y+1);c.lineTo(r.x+r.w-1,r.y+cut);c.lineTo(r.x+r.w,r.y+cut);c.lineTo(r.x+r.w,r.y+r.h-cut);c.lineTo(r.x+r.w-1,r.y+r.h-cut);c.lineTo(r.x+r.w-1,r.y+r.h-1);c.lineTo(r.x+r.w-cut,r.y+r.h-1);c.lineTo(r.x+r.w-cut,r.y+r.h);c.lineTo(r.x+cut,r.y+r.h);c.lineTo(r.x+cut,r.y+r.h-1);c.lineTo(r.x+1,r.y+r.h-1);c.lineTo(r.x+1,r.y+r.h-cut);c.lineTo(r.x,r.y+r.h-cut);c.lineTo(r.x,r.y+cut);c.lineTo(r.x+1,r.y+cut);c.lineTo(r.x+1,r.y+1);c.lineTo(r.x+cut,r.y+1);c.closePath();}
 frame(r:Rect,id='panel-cream'){
  const spec=(pixelFrames as Record<string,{width:number;height:number;slice:number;surface:string;rects:(number|string)[][]}>)[id];if(!spec||r.w<1||r.h<1)return;
  const c=this.ctx,x=Math.round(r.x+this.offset.x),y=Math.round(r.y+this.offset.y),w=Math.round(r.w),h=Math.round(r.h),k=Math.min(spec.slice,Math.floor(w/2),Math.floor(h/2)),sw=spec.width,sh=spec.height;
  // Paint the SVG's solid pixel rectangles directly. Native WeChat must not
  // resample a tiny offscreen canvas to draw one-pixel highlights and borders.
  // Only the middle stretches; corners keep the same logical pixel size.
  // Frame rects use Stage coordinates (as do their hit areas), not local transforms.
  const map=(v:number,source:number,target:number)=>v<=k?v:v>=source-k?target-source+v:k+(v-k)*(target-2*k)/(source-2*k);
  const paint=(left:number,top:number,right:number,bottom:number,color:string)=>{
   const px=Math.round(left*this.pixelScaleX),py=Math.round(top*this.pixelScaleY),pw=Math.round(right*this.pixelScaleX)-px,ph=Math.round(bottom*this.pixelScaleY)-py;
   if(pw>0&&ph>0){c.fillStyle=themeFrameColor(this.currentTheme,id,color);c.fillRect(px,py,pw,ph);}
  };
  c.save();c.setTransform(1,0,0,1,0,0);
  paint(x+k,y+k,x+w-k,y+h-k,spec.surface);
  if(k===spec.slice){
   for(const [sx,sy,rw,rh,color]of spec.rects)paint(x+map(Number(sx),sw,w),y+map(Number(sy),sh,h),x+map(Number(sx)+Number(rw),sw,w),y+map(Number(sy)+Number(rh),sh,h),String(color));
  }else if(k>0){
   // Tiny frames crop the original corners, matching the old nine-slice path.
   const patches=[[0,0,k,k,x,y,k,k],[sw-k,0,k,k,x+w-k,y,k,k],[0,sh-k,k,k,x,y+h-k,k,k],[sw-k,sh-k,k,k,x+w-k,y+h-k,k,k],[k,0,1,k,x+k,y,w-2*k,k],[k,sh-k,1,k,x+k,y+h-k,w-2*k,k],[0,k,k,1,x,y+k,k,h-2*k],[sw-k,k,k,1,x+w-k,y+k,k,h-2*k]];
   for(const [sx,sy,swp,shp,dx,dy,dw,dh]of patches){if(dw<=0||dh<=0)continue;for(const [rx,ry,rw,rh,color]of spec.rects){const l=Math.max(sx,Number(rx)),t=Math.max(sy,Number(ry)),r=Math.min(sx+swp,Number(rx)+Number(rw)),b=Math.min(sy+shp,Number(ry)+Number(rh));if(r>l&&b>t)paint(dx+(l-sx)*dw/swp,dy+(t-sy)*dh/shp,dx+(r-sx)*dw/swp,dy+(b-sy)*dh/shp,String(color));}}
  }
  c.restore();
 }
 panel(r:Rect,tone='cream'){this.frame(r,tone==='gold'?'panel-gold':'panel-cream');}
 isPressed(r:Rect){return !!this.down?.target&&this.down.target.r.x===r.x+this.offset.x&&this.down.target.r.y===r.y+this.offset.y;}
 button(r:Rect,label:string,fn:()=>void,opts:{tone?:string;icon?:string;iconColor?:string;disabled?:boolean;selected?:boolean;fontSize?:number}={}){
  if(this.inputSuspended)opts={...opts,disabled:true};
  const tone=opts.tone==='green'?'berry':opts.tone||'cream',pressed=!!this.down?.target&&this.down.target.r.x===r.x+this.offset.x&&this.down.target.r.y===r.y+this.offset.y,state=opts.disabled?'disabled':pressed?'pressed':opts.selected?'selected':'normal',c=this.ctx;
  const accent=tone==='berry'||tone==='berrydark';this.frame(r,'button-'+tone+'-'+state);if(accent&&!opts.disabled){c.save();const shade=c.createLinearGradient(r.x,r.y,r.x+r.w,r.y+r.h);shade.addColorStop(0,'#ffffff17');shade.addColorStop(.62,'#ffffff00');shade.addColorStop(1,this.currentTheme==='dark'?'#160d210a':'#63283a0a');c.fillStyle=shade;c.fillRect(r.x+4,r.y+4,Math.max(0,r.w-8),Math.max(0,r.h-8));c.restore();}
  const size=opts.fontSize||13,iw=opts.icon?Math.min(19,size+5):0,tw=Math.min(this.measure(label,size,750),Math.max(0,r.w-iw-12)),start=r.x+(r.w-tw-iw)/2,ink=opts.disabled?this.palette.disabled:accent||tone==='gold'?this.palette.onAccent:this.palette.ink;
  if(opts.icon)this.icon(opts.icon,{x:start-2,y:r.y+(r.h-iw)/2,w:iw-1,h:iw},opts.iconColor||ink);this.text(label,start+iw,r.y+(r.h-size)/2-1,size,ink,750,r.w-iw-10);if(!opts.disabled)this.hit(r,fn);
 }
 segments<T extends string|number>(r:Rect,options:readonly(readonly[T,string])[],value:T,change:(value:T)=>void){
  this.frame(r,'rail-cream-normal');const inset=4,width=(r.w-inset*2)/options.length;
  options.forEach(([key,label],index)=>{const item={x:Math.round(r.x+inset+index*width),y:r.y+inset,w:Math.round(width),h:r.h-inset*2},selected=key===value;if(selected)this.frame(item,'segment-berry-selected');else if(index>0&&options[index-1][0]!==value){this.ctx.fillStyle=this.color('#d4ac99');this.ctx.fillRect(item.x,item.y+item.h*.25,1,item.h*.5);}const size=r.h>=38?14:r.h>=32?13:12;this.text(label,item.x+(item.w-this.measure(label,size,700))/2,item.y+(item.h-size)/2-1,size,selected?this.palette.onAccent:this.palette.ink,700,item.w-4);this.hit(item,()=>change(key));});
 }
 hasHit(x:number,y:number){return this.hits.some(hit=>inside(hit.r,x,y));}
 ornaments(r:Rect,size=20){const c=this.ctx;for(const [x,y,flipX,flipY]of [[r.x,r.y,1,1],[r.x+r.w,r.y,-1,1],[r.x,r.y+r.h,1,-1],[r.x+r.w,r.y+r.h,-1,-1]]){c.save();c.translate(x,y);c.scale(flipX,flipY);this.icon('frameLeaf',{x:-5,y:-5,w:size,h:size*1.1});c.restore();}}
 hit(r:Rect,fn:()=>void){if(this.inputSuspended)return;let clipped=intersection({...r,x:r.x+this.offset.x,y:r.y+this.offset.y},{...this.offset,w:this.w,h:this.h});for(const clip of this.clips)clipped=intersection(clipped,clip);if(clipped.w>0&&clipped.h>0)this.hits.push({r:clipped,fn});}
 clip(r:Rect,draw:()=>void){this.ctx.save();this.ctx.beginPath();this.ctx.rect(r.x,r.y,r.w,r.h);this.ctx.clip();this.clips.push({...r,x:r.x+this.offset.x,y:r.y+this.offset.y});try{draw();}finally{this.clips.pop();this.ctx.restore();}}
 retryImages(){this.images.retryFailed();this.invalidate();}
 private load(src:string){const ui=src.startsWith('/mobile-icons/'),extra=/b2-(supply-scenes|pixel-atlas)\.png$/.test(src);const url=ui?(extra?'art/':'assets/ui/')+src.split('/').pop():src.startsWith('/')?this.asset(src):src;return this.images.use(url,ui);}
 /** Queue without painting; callers keep their existing artwork until ready. */
 preloadComicImage(src:string,thumb:string){if(src)this.load(src);if(thumb&&thumb!==src)this.load(thumb);}
 /** Reuse either cached resolution; an unavailable image never blocks the page. */
 comicImage(src:string,thumb:string,r:Rect,crop:ComicCrop,zoom=1,decoded?:HTMLCanvasElement|null){
  const key=(value:string)=>value.startsWith('/')?this.asset(value):value;
  const cached=(src?this.images.cached(key(src)):undefined)??(thumb?this.images.cached(key(thumb)):undefined);
  const pending=!decoded&&!cached&&(thumb||src)?this.load(thumb||src):undefined;
  const image=decoded??cached?.image??(pending?.loaded?pending.image:undefined);
  if(!image){this.ctx.fillStyle=this.palette.placeholder;this.ctx.fillRect(r.x,r.y,r.w,r.h);return;}
  const iw=('naturalWidth'in image?image.naturalWidth:0)||image.width,ih=('naturalHeight'in image?image.naturalHeight:0)||image.height,cover=cropCover(iw,ih,crop,r),raw={x:crop[0]*iw,y:crop[1]*ih,w:crop[2]*iw,h:crop[3]*ih},source={x:raw.x+(cover.x-raw.x)*zoom,y:raw.y+(cover.y-raw.y)*zoom,w:raw.w+(cover.w-raw.w)*zoom,h:raw.h+(cover.h-raw.h)*zoom};
  this.clip(r,()=>this.ctx.drawImage(image,source.x,source.y,source.w,source.h,r.x,r.y,r.w,r.h));
 }
 comicImageSize(src:string,thumb:string,decoded?:HTMLCanvasElement|null){
  const key=(value:string)=>value.startsWith('/')?this.asset(value):value,image=decoded??(src?this.images.cached(key(src))?.image:undefined)??(thumb?this.images.cached(key(thumb))?.image:undefined);
  return image?{w:('naturalWidth'in image?image.naturalWidth:0)||image.width,h:('naturalHeight'in image?image.naturalHeight:0)||image.height}:null;
 }
 image(src:string,r:Rect,mode='cover'){if(!src)return;const e=this.load(src),c=this.ctx;if(!e.loaded){c.fillStyle=this.palette.placeholder;c.fillRect(r.x,r.y,r.w,r.h);if(e.failed)this.text('图片暂不可用',r.x+5,r.y+r.h/2-7,11,this.palette.muted,400,r.w-10);return;}const im=e.image,iw=im.naturalWidth||im.width||1,ih=im.naturalHeight||im.height||1;c.save();c.beginPath();c.rect(r.x,r.y,r.w,r.h);c.clip();const s=mode==='contain'?Math.min(r.w/iw,r.h/ih):Math.max(r.w/iw,r.h/ih);c.drawImage(im,r.x+(r.w-iw*s)/2,r.y+(r.h-ih*s)/2,iw*s,ih*s);c.restore();}
 /** Draw atlas art on whole device pixels; enlarged art stays hard-edged, reduced art is filtered once at high quality. */
 private sprite(image:CanvasImageSource,sx:number,sy:number,sw:number,sh:number,r:Rect){
  const c=this.ctx,box=fitInside(r,sw,sh),t=typeof c.getTransform==='function'?c.getTransform():null;let {x,y,w,h}=box;
  if(t&&typeof t.a==='number'&&!t.b&&!t.c&&t.a>0&&t.d>0){const left=Math.round(t.a*x+t.e),top=Math.round(t.d*y+t.f);w=Math.max(1,Math.round(t.a*w))/t.a;h=Math.max(1,Math.round(t.d*h))/t.d;x=(left-t.e)/t.a;y=(top-t.f)/t.d;}
  const smoothing=c.imageSmoothingEnabled,quality=c.imageSmoothingQuality,enlarged=!!t&&typeof t.a==='number'&&Math.abs(t.a)*w>=sw;
  c.imageSmoothingEnabled=!enlarged;if(!enlarged)c.imageSmoothingQuality='high';c.drawImage(image,sx,sy,sw,sh,x,y,w,h);c.imageSmoothingEnabled=smoothing;if(quality)c.imageSmoothingQuality=quality;
 }
 icon(kind:string,r:Rect,color?:string){const aliases:Record<string,string>={quick:'players',star:'xpStar',tasks:'gift',supplies:'store',puzzle:'piece',collection:'book',refill:'refillGift',energyPack:'energy'};kind=aliases[kind]||kind;const extras:Record<string,{file:string;rect:number[]}>= {...Object.fromEntries(Object.entries(cardAtlas.bounds).map(([key,rect])=>['card'+key[0].toUpperCase()+key.slice(1),{file:'b2-card-icons1023.png',rect}])),supplyEnergy:{file:'b2-supply-scenes.png',rect:[0,0,887,887]},supplyTicket:{file:'b2-supply-scenes.png',rect:[887,0,887,887]},moon:{file:'b2-pixel-atlas.png',rect:[679,955,209,243]},lantern:{file:'b2-pixel-atlas.png',rect:[988,937,188,269]}};const extra=extras[kind];if(extra){const e=this.load('/mobile-icons/'+extra.file);if(e.loaded){const[sx,sy,sw,sh]=extra.rect;this.sprite(e.image,sx,sy,sw,sh,r);}return;}const core=(coreBounds as Record<string,readonly number[]>)[kind],task=(taskBounds as Record<string,readonly number[]>)[kind],bound=core||task,c=this.ctx;if(bound){const e=this.load('/mobile-icons/'+(core?'b2-core-icons23.png':'b2-task-icons23.png'));if(e.loaded){const [sx,sy,sw,sh]=bound;this.sprite(e.image,sx,sy,sw,sh,r);}return;}
  // Utility symbols share the original 24×24 SVG viewBox, including its padding.
  const box=fitInside(r,24,24),scale=box.w/24;
  c.save();c.translate(box.x,box.y);c.scale(scale,scale);c.fillStyle=color?themeTextColor(this.currentTheme,color):(['person','players','quick'].includes(kind)?this.color('#876158'):kind==='create'?this.palette.gold:['piece','fragment'].includes(kind)?this.palette.rose:this.palette.ink);c.strokeStyle=c.fillStyle;c.lineWidth=2;
  const paths=kind==='locate'?locateSymbol:kind==='lock'?lockSymbol:kind==='unlock'?unlockSymbol:mobileSymbolPaths[kind as keyof typeof mobileSymbolPaths];
  if(paths){for(const path of paths){this.drawSvgPath(path.d);c.fill('fillRule'in path?path.fillRule:'nonzero');}}
  else if(['players','person','quick'].includes(kind)){for(const x of kind==='person'?[12]:[6,17]){c.beginPath();c.arc(x,7,3.2,0,Math.PI*2);c.fill();c.fillRect(x-4,12,8,9);}}
  else if(kind==='story'){for(const [x,y,w,h]of [[3,3,2,18],[5,3,14,2],[19,5,2,16],[5,19,14,2],[7,7,2,2],[7,11,2,2],[7,15,2,2],[11,7,6,2],[11,11,6,2],[11,15,4,2]])c.fillRect(x,y,w,h);}
  else if(kind==='orientation'){c.strokeRect(8,6,8,12);c.beginPath();c.arc(12,12,10,-Math.PI/2,0);c.moveTo(19,9);c.lineTo(22,12);c.lineTo(23,8);c.moveTo(5,15);c.lineTo(2,12);c.lineTo(1,16);c.moveTo(2,12);c.arc(12,12,10,Math.PI,Math.PI/2,true);c.stroke();}
  else if(kind==='themeSun'){c.beginPath();c.arc(12,12,4,0,Math.PI*2);c.fill();for(let i=0;i<8;i++){const angle=i*Math.PI/4;c.beginPath();c.moveTo(12+Math.cos(angle)*7,12+Math.sin(angle)*7);c.lineTo(12+Math.cos(angle)*10,12+Math.sin(angle)*10);c.stroke();}}
  else if(kind==='themeMoon'){c.beginPath();c.moveTo(17,3);c.bezierCurveTo(10,5,11,13,17,17);c.bezierCurveTo(10,22,3,17,3,11);c.bezierCurveTo(3,5,9,1,17,3);c.closePath();c.fill();}
  else if(kind==='chat'){c.beginPath();c.moveTo(3,4);c.lineTo(21,4);c.lineTo(21,17);c.lineTo(13,17);c.lineTo(8,21);c.lineTo(8,17);c.lineTo(3,17);c.closePath();c.stroke();for(const x of[7,11,15])c.fillRect(x,9,2,2);}
  else if(kind==='hint'){c.beginPath();c.arc(12,9,7,0,Math.PI*2);c.stroke();c.fillRect(9,15,6,6);c.fillRect(10,22,4,1);}
  else if(['create','plus'].includes(kind)){c.fillRect(10,3,4,18);c.fillRect(3,10,18,4);}
  else if(['back','left'].includes(kind)){c.beginPath();c.moveTo(15,4);c.lineTo(7,12);c.lineTo(15,20);c.stroke();}
  else if(['close','x'].includes(kind)){c.beginPath();c.moveTo(5,5);c.lineTo(19,19);c.moveTo(19,5);c.lineTo(5,19);c.stroke();}
  else if(kind==='filter'){c.beginPath();c.moveTo(3,4);c.lineTo(21,4);c.lineTo(14,12);c.lineTo(14,21);c.lineTo(10,18);c.lineTo(10,12);c.closePath();c.fill();}
  else if(kind==='video'){c.strokeRect(2,5,20,15);c.beginPath();c.moveTo(10,9);c.lineTo(16,13);c.lineTo(10,17);c.closePath();c.fill();}
  else if(kind==='check'){c.beginPath();c.moveTo(3,12);c.lineTo(9,18);c.lineTo(21,5);c.stroke();}
  else{c.strokeRect(4,4,16,16);c.fillRect(8,8,8,8);}c.restore();
 }
 decoration(value:{id?:string;artKey:string;color:string},r:Rect){
  const original=collectionCatalog.decorations.find(item=>item.id===value.id);
  if(original?.color.toLowerCase()===value.color.toLowerCase()&&original.artKey===value.artKey){this.icon(value.artKey,r);return;}
  const kind=value.artKey==='star'?'xpStar':value.artKey,key=kind+':'+value.color.toLowerCase();
  let tint=this.decorationTints.get(key);
  if(!tint){
   const extra=kind==='moon'?{file:'b2-pixel-atlas.png',bound:[679,955,209,243]}:kind==='lantern'?{file:'b2-pixel-atlas.png',bound:[988,937,188,269]}:null;
   const core=(coreBounds as Record<string,readonly number[]>)[kind],task=(taskBounds as Record<string,readonly number[]>)[kind],bound=extra?.bound??core??task;
   if(!bound){this.icon(value.artKey,r,value.color);return;}
   const e=this.load('/mobile-icons/'+(extra?.file??(core?'b2-core-icons23.png':'b2-task-icons23.png')));if(!e.loaded)return;
   const image=this.platform.createCanvas();image.width=96;image.height=96;const c=image.getContext('2d');if(!c)return;
   const [sx,sy,sw,sh]=bound,art=fitInside({x:0,y:0,w:96,h:96},sw,sh);c.drawImage(e.image,sx,sy,sw,sh,art.x,art.y,art.w,art.h);
   c.globalCompositeOperation='source-in';c.fillStyle=value.color;c.fillRect(0,0,96,96);c.globalCompositeOperation='source-over';
   tint={image,art};if(this.decorationTints.size>128)this.decorationTints.clear();this.decorationTints.set(key,tint);
  }
  const a=tint.art,box=fitInside(r,a.w,a.h);
  this.ctx.drawImage(tint.image,a.x,a.y,a.w,a.h,box.x,box.y,box.w,box.h);
 }
 private drawSvgPath(d:string){
  const tokens=d.match(/[a-zA-Z]|-?\d*\.?\d+(?:e[-+]?\d+)?/g)||[],c=this.ctx;
  let i=0,x=0,y=0,command='';c.beginPath();
  while(i<tokens.length){
   if(/[a-zA-Z]/.test(tokens[i]))command=tokens[i++];
   const rel=command===command.toLowerCase(),op=command.toUpperCase(),n=()=>Number(tokens[i++]);
   if(op==='Z'){c.closePath();command='';continue;}
   if(op==='M'||op==='L'){x=(rel?x:0)+n();y=(rel?y:0)+n();op==='M'?c.moveTo(x,y):c.lineTo(x,y);if(op==='M')command=rel?'l':'L';}
   else if(op==='H'){x=(rel?x:0)+n();c.lineTo(x,y);}
   else if(op==='V'){y=(rel?y:0)+n();c.lineTo(x,y);}
   else if(op==='A'){
    let rx=Math.abs(n()),ry=Math.abs(n());const rotation=n()*Math.PI/180,large=n(),sweep=n(),ex=(rel?x:0)+n(),ey=(rel?y:0)+n();
    if(!rx||!ry){c.lineTo(ex,ey);x=ex;y=ey;continue;}
    const cos=Math.cos(rotation),sin=Math.sin(rotation),dx=(x-ex)/2,dy=(y-ey)/2,px=cos*dx+sin*dy,py=-sin*dx+cos*dy;
    const scale=Math.sqrt(px*px/(rx*rx)+py*py/(ry*ry));if(scale>1){rx*=scale;ry*=scale;}
    const denominator=rx*rx*py*py+ry*ry*px*px,factor=(large===sweep?-1:1)*Math.sqrt(Math.max(0,(rx*rx*ry*ry-denominator)/Math.max(denominator,1e-12)));
    const cxp=factor*rx*py/ry,cyp=-factor*ry*px/rx,cx=cos*cxp-sin*cyp+(x+ex)/2,cy=sin*cxp+cos*cyp+(y+ey)/2;
    const a=Math.atan2((py-cyp)/ry,(px-cxp)/rx),b=Math.atan2((-py-cyp)/ry,(-px-cxp)/rx);
    c.save();c.translate(cx,cy);c.rotate(rotation);c.scale(rx,ry);c.arc(0,0,1,a,b,!sweep);c.restore();x=ex;y=ey;
   }else break;
  }
 }

 background(){const c=this.ctx;c.fillStyle=this.palette.paper;c.fillRect(0,0,this.w,this.h);const g=c.createRadialGradient(this.w*.24,this.h*.15,0,this.w*.24,this.h*.15,Math.max(this.w,this.h)*.68);g.addColorStop(0,this.palette.highlight);g.addColorStop(1,this.palette.highlight+'00');c.fillStyle=g;c.fillRect(0,0,this.w,this.h);}
 meter(r:Rect,value:number,_color=this.palette.rose){
  const c=this.ctx,path=(x:number,y:number,w:number,h:number)=>{const radius=Math.min(h/2,w/2);c.beginPath();c.moveTo(x+radius,y);c.lineTo(x+w-radius,y);c.quadraticCurveTo(x+w,y,x+w,y+radius);c.lineTo(x+w,y+h-radius);c.quadraticCurveTo(x+w,y+h,x+w-radius,y+h);c.lineTo(x+radius,y+h);c.quadraticCurveTo(x,y+h,x,y+h-radius);c.lineTo(x,y+radius);c.quadraticCurveTo(x,y,x+radius,y);c.closePath();};
  c.save();path(r.x+.5,r.y+.5,r.w-1,r.h-1);const track=c.createLinearGradient(0,r.y,0,r.y+r.h);track.addColorStop(0,this.color('#fffdf6'));track.addColorStop(1,this.color('#fff6eb'));c.fillStyle=track;c.fill();c.strokeStyle=this.color('#c49a8d');c.lineWidth=1;c.stroke();c.clip();const fill=Math.max(0,Math.min(1,value))*(r.w-2);if(fill>0){path(r.x+1,r.y+1,fill,r.h-2);const tint=c.createLinearGradient(0,r.y,0,r.y+r.h);tint.addColorStop(0,this.color('#d99ba4'));tint.addColorStop(1,this.palette.rose);c.fillStyle=tint;c.fill();c.save();c.clip();c.fillStyle=this.color('#efc6c9');c.fillRect(r.x+2,r.y+1,Math.max(0,fill-2),1);c.fillStyle=this.color('#a862732b');c.fillRect(r.x+2,r.y+r.h-2,Math.max(0,fill-2),1);c.restore();}c.restore();
 }

 input(event:Input){if(event.type==='cancel'){this.down=null;this.invalidate();return false;}const p=event.changed[0]||event.points[0];if(!p)return false;if(event.type==='down'){const target=[...this.hits].reverse().find(hit=>inside(hit.r,p.x,p.y));this.down={x:p.x,y:p.y,target};this.invalidate();return !!target;}if(event.type==='move'){if(this.down&&Math.hypot(p.x-this.down.x,p.y-this.down.y)>8)this.down.target=undefined;return false;}if(event.type==='up'){const target=this.down?.target;this.down=null;this.invalidate();if(target&&inside(target.r,p.x,p.y)){target.fn();this.invalidate();return true;}}return false;}
}
