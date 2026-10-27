import { boardFor,normalizePuzzle,worldFor,piecesFor,pathFor,moveGroup,raiseGroup,visibleGroup,type PuzzleState,type Group } from '../lib/puzzle-engine';
import { pictureCrop,drawPiecePicture } from '../lib/puzzle-picture';
import { newMobileConnections,MobileContributionGate,MOBILE_REDUCED_GLOW_MS,type MobileConnectionGlow,type MobileContributionReceipt } from '../lib/connection-feedback';
import {cursorWorld,cursorScreen,type CursorPoint,type SharedCursor} from '../lib/room-cursors';
import type { RoomTable,RoomPieceOwner,RoomDecoration } from '../lib/room-client';
import type { Platform,Input,Point,Rect } from './ports';
import {boardThemeColors,landscapeRoomColors,type ThemeId} from './theme';
import {roomRoundPath} from './room-chrome';
import {gestureFrameSample,type GestureFrame} from '../lib/puzzle-gesture-cache';

type Command={op:'M'|'L'|'C'|'Z';args:number[]};
type Owner=RoomPieceOwner;
/** sx/sy is the finger's screen point at grab; live turns on once the finger passes DRAG_SLOP or another finger moves the camera. */
type Drag={id:number;pointer:number;x:number;y:number;dx:number;dy:number;serial:number;sx:number;sy:number;live:boolean};
type Pan={pointer:number;x:number;y:number;cx:number;cy:number};
type Pinch={a:number;b:number;distance:number;zoom:number;worldX:number;worldY:number;held:boolean};
const CANVAS_SNAP_FEEDBACK_MS=720;
type SnapFlash={anchor:number;ids:number[];local:boolean;startedAt:number;until:number;reduced:boolean;xp?:number};
type ImagePreparation=Readonly<{phase:'loading'|'preparing'|'ready';completed:number;total:number}>;
type DragSurface={canvas:HTMLCanvasElement;key:string};
type GestureSurface=GestureFrame&{canvas:HTMLCanvasElement;key:string;sx:number;sy:number};
type PaperSurface={canvas:HTMLCanvasElement;key:string;bytes:number;image?:CanvasImageSource;close?:()=>void};
type PlacedSurface={canvas:HTMLCanvasElement;serial:number;ids:Set<number>;scratch?:HTMLCanvasElement};
const DRAG_SURFACE_BYTES=24*1024*1024;
/** Screen distance a held finger travels before the piece follows it, so a press or a shifted grip never nudges a piece. */
export const DRAG_SLOP=8;
/** A held group grows by at most this fraction, and at most DRAG_LIFT_PX at its far edge, around the finger. */
const DRAG_LIFT_SCALE=.08,DRAG_LIFT_PX=6;
const PAPER_SURFACE_BYTES=12*1024*1024;
export const CURSOR_SMOOTHING_MS=50;
const inside=(p:Point,r:Rect)=>p.x>=r.x&&p.y>=r.y&&p.x<=r.x+r.w&&p.y<=r.y+r.h;
const cloneGroups=(groups:Group[])=>groups.map(g=>({...g,pieces:[...g.pieces]}));

/** The shared engine emits only these four SVG commands. Interpret the commands
 * directly so the same geometry works without a browser Path2D constructor. */
export function parsePuzzlePath(source:string):Command[]{
 const tokens=source.match(/[MLCZ]|[-+]?(?:\d*\.\d+|\d+\.?\d*)(?:[eE][-+]?\d+)?/g)||[];
 const result:Command[]=[];let i=0;
 while(i<tokens.length){const op=tokens[i++] as Command['op'],count=op==='C'?6:op==='M'||op==='L'?2:op==='Z'?0:-1;if(count<0||i+count>tokens.length)throw Error('Invalid puzzle geometry');const args=tokens.slice(i,i+count).map(Number);if(args.some(n=>!Number.isFinite(n)))throw Error('Invalid puzzle geometry');result.push({op,args});i+=count;}
 return result;
}
export function tracePuzzlePath(ctx:CanvasRenderingContext2D,commands:Command[]){
 ctx.beginPath();appendPuzzlePath(ctx,commands,0,0);
}
/** Add one piece outline at (x,y) to the current path, so many pieces share one clip. */
function appendPuzzlePath(ctx:CanvasRenderingContext2D,commands:Command[],x:number,y:number){
 for(const {op,args:a}of commands){if(op==='M')ctx.moveTo(x+a[0],y+a[1]);else if(op==='L')ctx.lineTo(x+a[0],y+a[1]);else if(op==='C')ctx.bezierCurveTo(x+a[0],y+a[1],x+a[2],y+a[3],x+a[4],y+a[5]);else ctx.closePath();}
}
function flattenPath(commands:Command[]){
 const points:{x:number;y:number}[]=[];let x=0,y=0;
 for(const {op,args:a}of commands){if(op==='M'||op==='L'){x=a[0];y=a[1];points.push({x,y});}else if(op==='C'){const sx=x,sy=y;for(let n=1;n<=10;n++){const t=n/10,u=1-t;points.push({x:u*u*u*sx+3*u*u*t*a[0]+3*u*t*t*a[2]+t*t*t*a[4],y:u*u*u*sy+3*u*u*t*a[1]+3*u*t*t*a[3]+t*t*t*a[5]});}x=a[4];y=a[5];}}
 return points;
}
function inPolygon(points:{x:number;y:number}[],x:number,y:number){let result=false;for(let i=0,j=points.length-1;i<points.length;j=i++){const a=points[i],b=points[j];if((a.y>y)!==(b.y>y)&&x<(b.x-a.x)*(y-a.y)/(b.y-a.y)+a.x)result=!result;}return result;}

/** One actual puzzle surface for browser/TapTap and WeChat. The RoomClient is
 * the only authority for drops, merges, stamina and rewards. */
export class PuzzleBoard implements RoomTable {
 readonly platform:Platform;readonly state:PuzzleState;readonly board:ReturnType<typeof boardFor>;
 network:RoomTable['network']=null;networkReady=false;
 camera={x:0,y:0,z:1};rect:Rect={x:0,y:0,w:0,h:0};
 completionReveal=0;completionSweep:number|null=null;
 pictureScreenRect():Rect{const r=this.rect,c=this.camera,b=this.board;return {x:r.x+c.x+b.x*c.z,y:r.y+c.y+b.y*c.z,w:b.width*c.z,h:b.height*c.z};}
 notice='';onNotice:((message:string)=>void)|null=null;soundUrl='';
 previewTopInset=6;
 selfDecoration:RoomDecoration|null=null;drawDecoration:((value:RoomDecoration,rect:Rect)=>void)|null=null;
 onCursor:((point:CursorPoint|null)=>void)|null=null;
 private pieces;private paths:Command[][];private polygons:{x:number;y:number}[][]|null=null;private hit:CanvasRenderingContext2D;
 private picture:HTMLCanvasElement;private atlas:HTMLCanvasElement|null=null;
 private tile={w:0,h:0,pad:0,columns:0,scale:1.5};private imageSerial=0;private ready=false;private cancelImage:(()=>void)|null=null;
 private preparation:ImagePreparation={phase:'loading',completed:0,total:0};
 private owners:Record<string,Owner>={};private pointers=new Map<number,Point>();
 private cursors=new Map<string,{value:SharedCursor;x:number;y:number}>();private ownPoint:CursorPoint|null=null;private frameAt:number|null=null;
 private tray=false;private trayPage=0;private focusedPiece:number|null=null;
 private trayTouch:{id:number;x:number;y:number;action:(()=>void)|null}|null=null;
 private drag:Drag|null=null;private pan:Pan|null=null;private pinch:Pinch|null=null;private serial=0;
 private edges=false;private backing=false;private preview=false;private hintIds:number[]=[];private hintUntil=0;private underlayUntil=0;
 private flashes:SnapFlash[]=[];private frame=0;private destroyed=false;private feedbackHidden=false;
 private contributions=new MobileContributionGate();private pendingDrops=new Map<number,number>();
 private removeHide:()=>void;private removeShow:()=>void;private timer:ReturnType<typeof setTimeout>|null=null;
 private invalidate:()=>void;
 private currentTheme:ThemeId='light';
 private dotPatterns=new WeakMap<CanvasRenderingContext2D,{theme:ThemeId;value:CanvasPattern|null}>();
 private dragSurface:DragSurface|null=null;
 private gestureSurface:GestureSurface|null=null;
 private surfaceBuffer:HTMLCanvasElement|null=null;
 private surfaceBuilds=0;private surfaceAllocations=0;
 private paperSurface:PaperSurface|null=null;
 private placedSurface:PlacedSurface|null=null;
 paperCacheEnabled=true;
 phoneLandscapeRoom=false;
 gestureCacheEnabled=true;
 setGestureCacheEnabled(value:boolean){this.gestureCacheEnabled=value;this.cancelInput(true);if(!value)this.releaseSurfaceBuffer();}
 constructor(platform:Platform,state:PuzzleState,invalidate:()=>void){
  this.platform=platform;this.state=normalizePuzzle(state);this.invalidate=invalidate;this.board=boardFor(state.cols,state.rows);
  this.pieces=piecesFor(state.cols,state.rows,state.seed);this.paths=this.pieces.map(p=>parsePuzzlePath(pathFor(p,state.cols,state.rows)));
  this.preparation={phase:'loading',completed:0,total:this.pieces.length};
  this.picture=platform.createCanvas();const hit=platform.createCanvas();hit.width=1;hit.height=1;const context=hit.getContext('2d');if(!context)throw Error('当前设备的拼图画布暂不可用');this.hit=context;
  if(typeof this.hit.isPointInPath!=='function')this.polygons=this.paths.map(flattenPath);
  this.removeHide=platform.onHide(()=>{this.feedbackHidden=true;this.flashes=[];if(this.frame)this.platform.cancelFrame(this.frame);this.frame=0;this.frameAt=null;this.cancelInput(true);this.releaseSurfaceBuffer();this.releasePaperSurface();this.changed();});
  this.removeShow=platform.onShow?.(()=>{this.feedbackHidden=false;this.frameAt=null;this.changed();this.animateFeedback();})??(()=>{});
 }
 get theme(){return this.currentTheme;}
 get backgroundPanning(){return !!this.pan&&!this.drag&&!this.pinch;}
 performanceDetails(){return {gesture:this.pinch?'缩放':this.pan?'移动背景':this.drag?'拖动碎片':'静止',cache:!!(this.dragSurface||this.gestureSurface),pieces:this.pieces.length,pointers:this.pointers.size,builds:this.surfaceBuilds,allocations:this.surfaceAllocations,bufferBytes:this.surfaceBuffer?this.surfaceBuffer.width*this.surfaceBuffer.height*4:0};}
 get imagePreparation():ImagePreparation{return this.preparation;}
 setTheme(theme:ThemeId){if(this.currentTheme===theme)return;this.currentTheme=theme;this.releasePaperSurface();this.changed();}
 get edgeOnly(){return this.edges;}set edgeOnly(value:boolean){this.cancelInput(true);this.edges=value;this.changed();}
 get trayOpen(){return this.tray;}set trayOpen(value:boolean){if(this.tray===value)return;this.cancelInput(true);this.tray=value;this.changed();}
 get underlay(){return this.backing||this.underlayUntil>Date.now();}set underlay(value:boolean){this.backing=value;if(!value)this.underlayUntil=0;this.changed();}
 get showPreview(){return this.preview;}set showPreview(value:boolean){this.preview=value;this.changed();}
 private changed(){if(!this.destroyed)this.invalidate();}
 private tell(message:string){this.notice=message;this.onNotice?.(message);this.changed();}
 async setImage(src:string){
  if(this.destroyed)return;
  this.cancelImage?.();const serial=++this.imageSerial,image=this.platform.createImage();
  let cancelled=false,cancelStep:(()=>void)|null=null,picture:HTMLCanvasElement|null=null,committed=false;
  const cancellation=()=>Object.assign(Error('已切换拼图图片'),{code:'IMAGE_LOAD_CANCELLED'});
  const checkCurrent=()=>{if(cancelled||this.destroyed||serial!==this.imageSerial)throw cancellation();};
  const cancel=()=>{cancelled=true;cancelStep?.();};this.cancelImage=cancel;
  this.releaseSurfaceBuffer();this.releasePlacedSurface();this.ready=false;if(this.atlas)this.atlas.width=this.atlas.height=1;this.atlas=null;this.preparation={phase:'loading',completed:0,total:this.pieces.length};this.cancelInput(true);
  // Timers yield to input/paint without depending on a visible RAF. A hidden
  // host may throttle timers, but show does not need to restart a lost frame.
  const yieldPreparation=()=>new Promise<void>((resolve,reject)=>{
   checkCurrent();const timer=setTimeout(()=>{cancelStep=null;resolve();},0);
   cancelStep=()=>{clearTimeout(timer);cancelStep=null;reject(cancellation());};
  });
  try{
   checkCurrent();await new Promise<void>((resolve,reject)=>{
   let done=false,cancelSource:(()=>void)|undefined;
   const finish=(error?:Error)=>{if(done)return;done=true;clearTimeout(timer);cancelSource?.();image.onload=null;image.onerror=null;cancelStep=null;if(error)reject(error);else resolve();};
   const timer=setTimeout(()=>finish(Error('图片加载超时，请重试')),20000);
   cancelStep=()=>finish(cancellation());
   image.onload=()=>finish();image.onerror=()=>finish(Error('图片暂时无法加载，请重试'));
   try{
    if(this.platform.config.id!=='wechat')image.crossOrigin='anonymous';
    if(this.platform.setImageSource){cancelSource=this.platform.setImageSource(image,src);if(done)cancelSource();}
    else image.src=src;
   }catch{finish(Error('图片暂时无法加载，请重试'));}
   });
   checkCurrent();const width=image.naturalWidth||image.width,height=image.naturalHeight||image.height;
   if(!width||!height)throw Error('拼图图片没有有效尺寸');
   const crop=pictureCrop(width,height,this.board.width,this.board.height);
   picture=this.platform.createCanvas();picture.width=Math.max(1,Math.round(crop.width));picture.height=Math.max(1,Math.round(crop.height));
   picture.getContext('2d')!.drawImage(image,crop.x,crop.y,crop.width,crop.height,0,0,picture.width,picture.height);
   this.preparation={phase:'preparing',completed:0,total:this.pieces.length};this.changed();await yieldPreparation();checkCurrent();
   const prepared=await this.makeAtlas(picture,checkCurrent,yieldPreparation);checkCurrent();
   const previous=this.picture;this.picture=picture;this.atlas=prepared.atlas;this.tile=prepared.tile;this.ready=true;committed=true;
   previous.width=previous.height=1;this.preparation={phase:'ready',completed:this.pieces.length,total:this.pieces.length};this.changed();
  }finally{
   if(this.cancelImage===cancel)this.cancelImage=null;
   if(picture&&!committed)picture.width=picture.height=1;
  }
 }
 private async makeAtlas(picture:HTMLCanvasElement,checkCurrent:()=>void,yieldPreparation:()=>Promise<void>){
  // Match the original mobile paper finish: a soft contact shadow and fine
  // inner edge, without adding the heavy bevel that was removed from B2.
  const w=this.board.width/this.state.cols,h=this.board.height/this.state.rows,unit=Math.min(w,h),edge=Math.max(.45,Math.min(1.25,unit*.012)),blur=Math.max(2,Math.min(5,unit*.055)),offsetX=Math.max(.35,Math.min(1,unit*.01)),offsetY=Math.max(1,Math.min(3,unit*.028));
  const pad=unit*.26+1+Math.ceil(blur*3+offsetY+edge*2),scale=Math.min(1.5,Math.sqrt(7_500_000/(this.pieces.length*(w+2*pad)*(h+2*pad))));
  const tileW=Math.ceil((w+2*pad)*scale),tileH=Math.ceil((h+2*pad)*scale),columns=Math.ceil(Math.sqrt(this.pieces.length));
  const atlas=this.platform.createCanvas();atlas.width=tileW*columns;atlas.height=tileH*Math.ceil(this.pieces.length/columns);const c=atlas.getContext('2d')!;
  c.imageSmoothingEnabled=true;c.imageSmoothingQuality='high';
  try{let completed=0;
  while(completed<this.pieces.length){
   checkCurrent();const started=Date.now();let batch=0;
   do{const piece=this.pieces[completed];
   c.save();c.translate((piece.id%columns)*tileW,Math.floor(piece.id/columns)*tileH);c.beginPath();c.rect(0,0,tileW,tileH);c.clip();c.scale(scale,scale);c.translate(pad,pad);tracePuzzlePath(c,this.paths[piece.id]);
   c.save();c.fillStyle='#b89573';c.shadowColor='#5a321f80';c.shadowBlur=blur*scale;c.shadowOffsetX=offsetX*scale;c.shadowOffsetY=offsetY*scale;c.fill();c.restore();
   c.save();c.clip();drawPiecePicture(c,picture,piece,this.state.cols,this.state.rows,this.board.width,this.board.height);c.lineJoin='round';c.strokeStyle='#855348bd';c.lineWidth=edge*2.4;c.stroke();
   const light=c.createLinearGradient(0,-h*.2,w*.35,h*1.15);if(typeof light?.addColorStop==='function'){light.addColorStop(0,'#fffbe8e8');light.addColorStop(.3,'#fff8dec2');light.addColorStop(.58,'#fff8de32');light.addColorStop(1,'#77513f4d');c.strokeStyle=light;}else c.strokeStyle='#fff8dec2';c.lineWidth=edge*1.2;c.stroke();c.restore();c.restore();
   completed++;batch++;
   }while(completed<this.pieces.length&&batch<16&&Date.now()-started<6);
   checkCurrent();this.preparation={phase:'preparing',completed,total:this.pieces.length};this.changed();
   if(completed<this.pieces.length)await yieldPreparation();
  }
  checkCurrent();return{atlas,tile:{w:tileW,h:tileH,pad,columns,scale}};
  }catch(error){atlas.width=atlas.height=1;throw error;}
 }
 /** Reuse the image already decoded for this puzzle, including its actual crop.
  * Completion must not depend on a second network request or image decode. */
 get comicPicture(){return !this.destroyed&&this.ready?this.picture:null;}
 drawCompletedPicture(ctx:CanvasRenderingContext2D,rect:Rect){
  if(this.destroyed||!this.ready||rect.w<=0||rect.h<=0)return false;
  const scale=Math.min(rect.w/this.board.width,rect.h/this.board.height),width=this.board.width*scale,height=this.board.height*scale;
  ctx.save();ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality='high';ctx.drawImage(this.picture,rect.x+(rect.w-width)/2,rect.y+(rect.h-height)/2,width,height);ctx.restore();return true;
 }
 setRect(rect:Rect){
  if(rect.w<1||rect.h<1)return;const old=this.rect;if(old.x===rect.x&&old.y===rect.y&&old.w===rect.w&&old.h===rect.h)return;this.rect={...rect};
  this.releaseSurfaceBuffer();this.releasePaperSurface();
  if(!old.w||!old.h)this.fit();else{this.camera.x+=(rect.w-old.w)/2;this.camera.y+=(rect.h-old.h)/2;this.changed();}
 }
 fit(completed=false,insets:{top?:number;right?:number;bottom?:number;left?:number}={}){this.cancelInput(true);const complete=completed||this.state.groups.every(g=>g.locked),bounds=complete?this.board:worldFor(this.state),left=Math.max(0,insets.left??0),top=Math.max(0,insets.top??0),width=Math.max(1,this.rect.w-left-Math.max(0,insets.right??0)),height=Math.max(1,this.rect.h-top-Math.max(0,insets.bottom??72)),z=Math.min(width/bounds.width,height/bounds.height)*(complete?.76:.94);this.camera={x:left+(width-bounds.width*z)/2-bounds.x*z,y:top+(height-bounds.height*z)/2-bounds.y*z,z:Math.max(.08,z)};this.changed();}
 /** Start with the complete target and scattered pieces visible. The previous
  * density-first crop could put half the target outside a phone's viewport.
  * Only the camera changes; pinch and the optional tray still provide close-up play. */
 openMobileView(insets:{bottom?:number}={}){
  if(!this.rect.w||!this.rect.h)return;this.cancelInput(true);
  const bottom=Math.max(0,insets.bottom??72),availableHeight=Math.max(1,this.rect.h-bottom);
  if(this.state.groups.every(g=>g.locked)){this.fit(true,{bottom});return;}
  const w=this.board.width/this.state.cols,h=this.board.height/this.state.rows,pad=Math.max(Math.min(w,h)*.27,this.tile.pad);
  let left=this.board.x,right=this.board.x+this.board.width,top=this.board.y,bottomEdge=this.board.y+this.board.height;
  for(const group of this.state.groups)for(const id of group.pieces){const piece=this.pieces[id],x=this.board.x+piece.col*w+group.dx,y=this.board.y+piece.row*h+group.dy;left=Math.min(left,x-pad);right=Math.max(right,x+w+pad);top=Math.min(top,y-pad);bottomEdge=Math.max(bottomEdge,y+h+pad);}
  const margin=Math.min(12,this.rect.w*.05,availableHeight*.05),width=right-left,height=bottomEdge-top,z=Math.max(.001,Math.min(5,(this.rect.w-2*margin)/width,(availableHeight-2*margin)/height));
  this.camera={x:(this.rect.w-width*z)/2-left*z,y:(availableHeight-height*z)/2-top*z,z};this.changed();
 }
 focusMobilePiece(pieceId:number,bottomInset=this.tray?this.trayLayout().r.h+72:72){const group=this.state.groups.find(g=>!g.locked&&g.pieces.includes(pieceId)),piece=this.pieces[pieceId];if(!group||!piece)return false;const w=this.board.width/this.state.cols,h=this.board.height/this.state.rows,z=Math.min(5,Math.max(this.camera.z,54/Math.min(w,h)));this.focusedPiece=pieceId;this.camera={x:this.rect.w/2-(this.board.x+(piece.col+.5)*w+group.dx)*z,y:Math.max(48,this.rect.h-bottomInset)/2-(this.board.y+(piece.row+.5)*h+group.dy)*z,z};this.changed();return true;}
 zoom(factor:number){if(!Number.isFinite(factor)||factor<=0)return;const center={x:this.rect.w/2,y:this.rect.h/2};this.zoomAt(center,Math.min(5,Math.max(.08,this.camera.z*factor)));this.changed();}
 private zoomAt(center:{x:number;y:number},z:number){const wx=(center.x-this.camera.x)/this.camera.z,wy=(center.y-this.camera.y)/this.camera.z;this.camera={x:center.x-wx*z,y:center.y-wy*z,z};}
 private local(p:Point){return{x:p.x-this.rect.x,y:p.y-this.rect.y};}
 private world(p:Point){const v=this.local(p);return{x:(v.x-this.camera.x)/this.camera.z,y:(v.y-this.camera.y)/this.camera.z};}
 screenToWorld(point:CursorPoint){return cursorWorld(point,{left:this.rect.x,top:this.rect.y,width:this.rect.w,height:this.rect.h},this.camera,worldFor(this.state));}
 worldToScreen(point:CursorPoint){const result=cursorScreen(point,this.camera);return{x:result.x+this.rect.x,y:result.y+this.rect.y};}
 setCursors(cursors:SharedCursor[]){
  if(this.destroyed)return;const present=new Set<string>();let changed=false;
  for(const cursor of cursors){
   if(!Number.isFinite(cursor.x)||!Number.isFinite(cursor.y)||!Number.isFinite(cursor.updatedAt)||typeof cursor.playerId!=='string')continue;
   present.add(cursor.playerId);const previous=this.cursors.get(cursor.playerId),old=previous?.value,a=old?.decoration,b=cursor.decoration;
   if(!old||old.x!==cursor.x||old.y!==cursor.y||old.name!==cursor.name||old.color!==cursor.color||(old.badge??null)!==(cursor.badge??null)||(old.cursorStyle??null)!==(cursor.cursorStyle??null)||(old.level??0)!==(cursor.level??0)||a?.id!==b?.id||a?.title!==b?.title||a?.artKey!==b?.artKey||a?.color!==b?.color||a?.kind!==b?.kind)changed=true;
   if(previous){previous.value=cursor;if(Math.hypot(previous.x-cursor.x,previous.y-cursor.y)<=.08){previous.x=cursor.x;previous.y=cursor.y;}}else this.cursors.set(cursor.playerId,{value:cursor,x:cursor.x,y:cursor.y});
  }
  for(const id of this.cursors.keys())if(!present.has(id)){this.cursors.delete(id);changed=true;}
  if(changed){this.changed();this.animateFeedback();}
 }
 private publishCursor(point:Point|null){
  // Keep the last valid room position until this board is destroyed. Pointer
  // cancellation only releases a drag; it does not mean the player left.
  const world=point?this.screenToWorld(point):null;if(!world||!point)return;
  this.ownPoint=this.world(point);this.onCursor?.(world);
 }
 private groupAt(p:Point){
  const world=this.world(p),w=this.board.width/this.state.cols,h=this.board.height/this.state.rows,pad=Math.min(w,h)*.27;
  for(let i=this.state.groups.length-1;i>=0;i--){const group=this.state.groups[i];if(group.locked||!visibleGroup(group,this.pieces,this.edges))continue;
   for(const id of group.pieces){const piece=this.pieces[id],x=world.x-this.board.x-piece.col*w-group.dx,y=world.y-this.board.y-piece.row*h-group.dy;
    if(x < -pad||x>w+pad||y < -pad||y>h+pad)continue;if(this.polygons){if(inPolygon(this.polygons[id],x,y))return group;}else{tracePuzzlePath(this.hit,this.paths[id]);if(this.hit.isPointInPath(x,y))return group;}
   }
  }
  return null;
 }
 input(input:Input):boolean{
  if(this.destroyed||!this.rect.w)return false;
  if(input.type==='key'){
   if(input.key==='Escape'&&input.keyDown&&(this.pointers.size||this.trayTouch)){this.cancelInput(true);return true;}
   return false;
  }
  if(input.type==='wheel'){
   const p=input.changed[0],delta=input.deltaY??0;if(!p||!inside(p,this.rect)||!Number.isFinite(delta)||delta===0)return false;
   // A wheel gesture cannot move the camera underneath an acquired piece.
   if(this.pointers.size||this.trayTouch)return true;
   if(this.tray&&inside(p,this.trayLayout().r))return true;
   this.zoomAt(this.local(p),Math.min(5,Math.max(.08,this.camera.z*Math.exp(-Math.max(-1000,Math.min(1000,delta))*.0018))));this.publishCursor(p);this.changed();return true;
  }
  if(input.pan&&input.type==='down'&&this.tray&&input.changed[0]&&inside(input.changed[0],this.trayLayout().r))return true;
  if(this.trayInput(input)){this.publishCursor(null);return true;}
  if(input.type==='cancel'){const active=!!this.pointers.size;this.cancelInput(true);return active;}
  if(input.type==='down'){
   const added=input.changed.filter(p=>inside(p,this.rect)&&!this.pointers.has(p.id));
   for(const p of input.changed)if(inside(p,this.rect))this.pointers.set(p.id,p);
   if(!this.pointers.size)return false;
   if(this.drag&&this.pointers.has(this.drag.pointer)){
    // While a piece is held, one more finger pans; a third finger turns that pan into a pinch. Further fingers are ignored.
    const others=[...this.pointers.values()].filter(p=>p.id!==this.drag!.pointer);if(others.length)this.drag.live=true;
    if(others.length>=2){if(!this.pinch){this.pan=null;this.pinch=this.pinchBetween(others[0],others[1],true);}}
    else if(!this.pan||this.pan.pointer===this.drag.pointer){const p=added.find(p=>p.id!==this.drag!.pointer);if(p){const v=this.local(p);this.pan={pointer:p.id,x:v.x,y:v.y,cx:this.camera.x,cy:this.camera.y};}}
    this.publishCursor(this.pointers.get(this.drag.pointer)!);this.changed();return true;
   }
   if(this.pointers.size>=2){this.beginPinch();return true;}
   const p=[...this.pointers.values()][0],world=this.world(p),group=input.pan?null:this.groupAt(p);
   this.publishCursor(p);
   if(group&&this.ready&&this.network&&this.networkReady){
    if(this.owners[group.id]){this.tell(`${this.owners[group.id].name} 正在移动这组拼块`);return true;}
    if(this.network.canAcquire?.(group.id)===false){this.tell('这组拼块还在确认位置，请稍候');return true;}
    const serial=++this.serial;this.drag={id:group.id,pointer:p.id,x:world.x,y:world.y,dx:group.dx,dy:group.dy,serial,sx:p.x,sy:p.y,live:false};raiseGroup(this.state,group.id);
    void this.network.acquire(group.id).then(ok=>{if(!ok&&this.drag?.serial===serial){this.cancelNetworkDrag(group.id);this.tell('这组拼块没能确认，已恢复服务器位置');}}).catch(()=>{if(this.drag?.serial===serial)this.cancelNetworkDrag(group.id);});
   }else{const v=this.local(p);this.pan={pointer:p.id,x:v.x,y:v.y,cx:this.camera.x,cy:this.camera.y};}
   this.changed();return true;
  }
  if(!this.pointers.size){if(input.type==='move'){const p=input.changed[0]??input.points[0];this.publishCursor(p&&inside(p,this.rect)?p:null);this.changed();}return false;}
  if(input.type==='move'){
   for(const p of input.points)if(this.pointers.has(p.id))this.pointers.set(p.id,p);
   const a=this.pinch&&this.pointers.get(this.pinch.a),b=this.pinch&&this.pointers.get(this.pinch.b);
   if(this.pinch&&a&&b){const center={x:(a.x+b.x)/2-this.rect.x,y:(a.y+b.y)/2-this.rect.y},z=Math.min(5,Math.max(.08,this.pinch.zoom*Math.hypot(a.x-b.x,a.y-b.y)/this.pinch.distance));this.camera={x:center.x-this.pinch.worldX*z,y:center.y-this.pinch.worldY*z,z};}
   else if(this.pan){const p=this.pointers.get(this.pan.pointer);if(p){const v=this.local(p);this.camera.x=this.pan.cx+v.x-this.pan.x;this.camera.y=this.pan.cy+v.y-this.pan.y;}}
   // The held piece follows its finger after the camera moves, so it stays under that finger.
   if(this.drag){const p=this.pointers.get(this.drag.pointer);if(p&&!this.drag.live&&Math.hypot(p.x-this.drag.sx,p.y-this.drag.sy)>=DRAG_SLOP)this.drag.live=true;if(p&&this.drag.live){const v=this.world(p),dx=this.drag.dx+v.x-this.drag.x,dy=this.drag.dy+v.y-this.drag.y;moveGroup(this.state,this.drag.id,dx,dy);this.network?.move(this.drag.id,dx,dy);}}
   if(this.drag)this.publishCursor(this.pointers.get(this.drag.pointer)??null);else if(this.pointers.size===1)this.publishCursor([...this.pointers.values()][0]);else this.publishCursor(null);this.changed();return true;
  }
  if(input.type==='up'){
   if(this.drag&&input.changed.some(p=>p.id===this.drag!.pointer)){const drag=this.drag,group=this.state.groups.find(g=>g.id===drag.id);this.drag=null;this.releaseDragSurface();if(group&&this.network){this.pendingDrops.set(group.id,drag.serial);void this.network.drop(group.id,group.dx,group.dy).catch(()=>{}).finally(()=>{if(this.pendingDrops.get(group.id)===drag.serial)this.pendingDrops.delete(group.id);});}}
   const heldPinch=!!this.pinch?.held;for(const p of input.changed)this.pointers.delete(p.id);this.pan=null;this.pinch=null;
   // A pinch begun while holding keeps zooming on two remaining fingers; otherwise one remaining finger pans.
   if(this.pointers.size){const others=[...this.pointers.values()].filter(p=>p.id!==this.drag?.pointer),p=others[0];if(heldPinch&&others.length>=2)this.pinch=this.pinchBetween(others[0],others[1],!!this.drag);else if(p){const v=this.local(p);this.pan={pointer:p.id,x:v.x,y:v.y,cx:this.camera.x,cy:this.camera.y};}}else this.releaseGestureSurface();
   // A release outside the board retains the last valid room position.
   const point=this.drag?this.pointers.get(this.drag.pointer):this.pointers.size===1?[...this.pointers.values()][0]:this.pointers.size===0?input.changed[0]:null;
   this.publishCursor(point&&inside(point,this.rect)?point:null);this.changed();return true;
  }
  return false;
 }
 private beginPinch(){
  this.releaseDragSurface();
  if(this.drag){this.network?.release(this.drag.id);this.drag=null;++this.serial;}this.pan=null;
  const[a,b]=[...this.pointers.values()];this.pinch=this.pinchBetween(a,b,false);this.publishCursor(null);this.changed();
 }
 private pinchBetween(a:Point,b:Point,held:boolean):Pinch{const world=this.world({id:-1,x:(a.x+b.x)/2,y:(a.y+b.y)/2});return{a:a.id,b:b.id,distance:Math.max(1,Math.hypot(a.x-b.x,a.y-b.y)),zoom:this.camera.z,worldX:world.x,worldY:world.y,held};}
 private cancelInput(release:boolean){if(release&&this.drag)this.network?.release(this.drag.id);this.releaseDragSurface();this.releaseGestureSurface();this.drag=null;this.pan=null;this.pinch=null;this.trayTouch=null;this.pointers.clear();this.publishCursor(null);++this.serial;this.changed();}
 cancelNetworkDrag(id?:number,reason?:string){if(id!==undefined&&this.drag?.id!==id)return false;const active=!!this.drag;this.releaseDragSurface();this.releaseGestureSurface();if(!this.drag||this.pan?.pointer===this.drag.pointer)this.pan=null;this.drag=null;++this.serial;if(reason)this.tell(reason);this.changed();return active;}
 syncRemote(next:PuzzleState,owners:Record<string,Owner>,protectedIds:ReadonlySet<number>,showFeedback=true){
  const before=cloneGroups(this.state.groups),previous=new Map(this.state.groups.map(g=>[g.id,g]));
  this.state.groups=next.groups.map(incoming=>{const old=previous.get(incoming.id),group={...incoming,pieces:[...incoming.pieces]};if(old&&!group.locked&&protectedIds.has(group.id)){group.dx=old.dx;group.dy=old.dy;}return group;});
  for(const id of protectedIds)raiseGroup(this.state,id);this.state.elapsed=next.elapsed;this.owners=owners;
  if(showFeedback&&!this.feedbackHidden){const localIds=new Set([...protectedIds,...this.pendingDrops.keys()]);for(const glow of newMobileConnections(before,this.state,localIds))this.addFlash(glow);}
  this.changed();this.animateFeedback();
 }
 private addFlash(glow:MobileConnectionGlow){
  const now=Date.now(),reduced=typeof globalThis.matchMedia==='function'&&globalThis.matchMedia('(prefers-reduced-motion: reduce)').matches;
  this.flashes=this.flashes.filter(flash=>flash.until>now);while(this.flashes.length>=3)this.flashes.shift();
  const flash:SnapFlash={anchor:glow.anchor,ids:glow.outlineIds,local:glow.source==='local',startedAt:now,until:now+(reduced?MOBILE_REDUCED_GLOW_MS:CANVAS_SNAP_FEEDBACK_MS),reduced};this.flashes.push(flash);return flash;
 }
 /** A local acknowledgement can follow a poll of the same merge. Promote that
  * burst, but display XP only once and only from the authoritative receipt. */
 confirmMobileContribution(receipt:MobileContributionReceipt){
  if(this.destroyed||!this.pieces[receipt?.groupId]||!this.contributions.claim(receipt)||this.feedbackHidden)return;
  const group=this.state.groups.find(g=>g.id===receipt.groupId||g.pieces.includes(receipt.groupId));if(!group)return;
  const now=Date.now();let flash=[...this.flashes].reverse().find(f=>f.until>now&&group.pieces.includes(f.anchor));
  if(!flash)flash=this.addFlash({anchor:receipt.groupId,seams:[],outlineIds:[receipt.groupId],source:'local'});
  flash.local=true;flash.xp=receipt.creditedXp;flash.startedAt=now;flash.until=now+(flash.reduced?MOBILE_REDUCED_GLOW_MS:CANVAS_SNAP_FEEDBACK_MS);this.changed();this.animateFeedback();
 }
 playConnectionSound(_source:'local'|'teammate'='local'){if(this.soundUrl)this.platform.playSound?.(this.soundUrl);}
 setHints(ids:number[],until:number){this.hintIds=ids.filter(id=>Number.isInteger(id)&&!!this.pieces[id]).slice(0,3);this.hintUntil=until;this.scheduleExpiry();this.changed();}
 setUnderlay(until:number){this.underlayUntil=until;this.scheduleExpiry();this.changed();}
 /** Highlighting only: reward/advertising eligibility is handled by the caller. */
 hint(ids?:number[],duration=30000){this.setHints(ids??this.state.groups.filter(g=>!g.locked&&!this.owners[g.id]).slice(0,3).map(g=>g.pieces[0]),Date.now()+duration);}
 find(){const group=this.state.groups.find(g=>!g.locked&&!this.owners[g.id]&&visibleGroup(g,this.pieces,this.edges));return group?this.focusMobilePiece(group.pieces[0]):false;}
 private trayLayout(){const height=Math.min(Math.max(1,this.rect.h-76),210,Math.max(100,this.rect.h*.45)),r={x:this.rect.x+5,y:this.rect.y+this.rect.h-height-75,w:Math.max(1,this.rect.w-10),h:height},columns=Math.max(1,Math.min(12,Math.floor((r.w-16)/51))),rows=Math.max(1,Math.min(Math.floor((height-55)/48),Math.floor(24/columns))),pageSize=Math.max(1,columns*rows),groups=this.state.groups.filter(g=>!g.locked&&visibleGroup(g,this.pieces,this.edges)),pages=Math.max(1,Math.ceil(groups.length/pageSize));this.trayPage=Math.min(this.trayPage,pages-1);return{r,columns,rows,pageSize,groups,pages,cellW:(r.w-16)/columns,cellH:(height-55)/rows};}
 private trayInput(input:Input){
  if(this.trayTouch){const touch=this.trayTouch,p=input.changed.find(p=>p.id===touch.id)||input.points.find(p=>p.id===touch.id);if(input.type==='cancel'){this.trayTouch=null;return true;}if(p&&Math.hypot(p.x-touch.x,p.y-touch.y)>9)touch.action=null;if(input.type==='up'&&input.changed.some(p=>p.id===touch.id)){this.trayTouch=null;touch.action?.();this.changed();}return true;}
  if(!this.tray||input.type!=='down'||this.pointers.size)return false;const p=input.changed[0],v=this.trayLayout();if(!p||!inside(p,v.r))return false;
  let action:(()=>void)|null=null;const lx=p.x-v.r.x,ly=p.y-v.r.y;
  if(ly<27&&lx>v.r.w-34)action=()=>{this.trayOpen=false;};
  else if(ly>=v.r.h-27){if(lx>v.r.w-45&&this.trayPage<v.pages-1)action=()=>{this.trayPage++;};else if(lx>v.r.w-110&&lx<v.r.w-65&&this.trayPage>0)action=()=>{this.trayPage--;};}
  else if(ly>=28){const col=Math.floor((lx-8)/v.cellW),row=Math.floor((ly-28)/v.cellH);if(col>=0&&col<v.columns&&row>=0&&row<v.rows){const group=v.groups[this.trayPage*v.pageSize+row*v.columns+col];if(group)action=()=>{if(this.focusMobilePiece(group.pieces[0]))this.tell('已定位，直接拖动画布中的拼块');else this.tell('这块刚被拼好，请选择其他碎片');};}}
  this.trayTouch={id:p.id,x:p.x,y:p.y,action};return true;
 }
 private drawTray(ctx:CanvasRenderingContext2D){const v=this.trayLayout(),r=v.r,colors=boardThemeColors(this.currentTheme);ctx.save();ctx.beginPath();ctx.rect(r.x,r.y,r.w,r.h);ctx.clip();ctx.fillStyle=colors.tray;ctx.fillRect(r.x,r.y,r.w,r.h);ctx.strokeStyle=colors.trayLine;ctx.lineWidth=1;ctx.strokeRect(r.x+.5,r.y+.5,r.w-1,r.h-1);ctx.textBaseline='top';ctx.font='bold 12px sans-serif';ctx.fillStyle=colors.trayInk;ctx.fillText(`碎片托盘 · ${v.groups.length}组`,r.x+10,r.y+8);ctx.font='11px sans-serif';ctx.fillStyle=colors.trayMuted;ctx.fillText('点选定位',r.x+r.w-103,r.y+9);ctx.font='18px sans-serif';ctx.fillText('×',r.x+r.w-25,r.y+4);
  const visible=v.groups.slice(this.trayPage*v.pageSize,(this.trayPage+1)*v.pageSize);for(let index=0;index<visible.length;index++){const group=visible[index],id=group.pieces[0],x=r.x+8+index%v.columns*v.cellW,y=r.y+28+Math.floor(index/v.columns)*v.cellH,cw=v.cellW-5,ch=v.cellH-5;ctx.fillStyle=group.pieces.includes(this.focusedPiece??-1)?colors.traySelected:colors.trayCell;ctx.fillRect(x,y,cw,ch);if(this.atlas){const t=this.tile,scale=Math.min((cw-5)/t.w,(ch-5)/t.h);ctx.drawImage(this.atlas,(id%t.columns)*t.w,Math.floor(id/t.columns)*t.h,t.w,t.h,x+(cw-t.w*scale)/2,y+(ch-t.h*scale)/2,t.w*scale,t.h*scale);}if(group.pieces.length>1){ctx.fillStyle=colors.trayCountInk;ctx.font='10px sans-serif';ctx.fillText('×'+group.pieces.length,x+2,y+ch-11);}}
  ctx.font='10px sans-serif';ctx.fillStyle=colors.trayMuted;ctx.fillText(v.groups.length?'散片保持原位':'所有拼块都已归位',r.x+10,r.y+r.h-18);ctx.font='16px sans-serif';ctx.fillStyle=this.trayPage>0?colors.trayInk:colors.trayDisabled;ctx.fillText('‹',r.x+r.w-98,r.y+r.h-22);ctx.font='11px sans-serif';ctx.fillStyle=colors.trayInk;ctx.fillText(`${this.trayPage+1}/${v.pages}`,r.x+r.w-71,r.y+r.h-18);ctx.font='16px sans-serif';ctx.fillStyle=this.trayPage<v.pages-1?colors.trayInk:colors.trayDisabled;ctx.fillText('›',r.x+r.w-27,r.y+r.h-22);ctx.restore();
 }
 private scheduleExpiry(){if(this.timer)clearTimeout(this.timer);const next=[this.hintUntil,this.underlayUntil].filter(t=>t>Date.now()).sort((a,b)=>a-b)[0];if(next)this.timer=setTimeout(()=>{this.changed();this.scheduleExpiry();},Math.max(1,next-Date.now()+1));}
 /** Only transient feedback owns a continuing animation loop. The last tick
  * also invalidates, erasing expired flashes before the room goes idle. */
 private animateFeedback(){
  const moving=[...this.cursors.values()].some(c=>Math.hypot(c.x-c.value.x,c.y-c.value.y)>.08);
  if(this.frame||this.destroyed||this.feedbackHidden)return;
  if(!this.flashes.length&&!moving){this.frameAt=null;return;}
  const queuedAt=Date.now();
  this.frame=this.platform.frame(timestamp=>{
   this.frame=0;if(this.destroyed||this.feedbackHidden)return;
   // Interpolate only toward the newest authoritative point. Elapsed frame
   // time controls the curve; hidden time never becomes movement or prediction.
   const now=Date.now(),hasTimestamp=Number.isFinite(timestamp),tick=hasTimestamp?timestamp:now,elapsed=this.frameAt===null?now-queuedAt:tick-this.frameAt,dt=Math.max(0,elapsed)||(!hasTimestamp?16:0),amount=1-Math.exp(-dt/CURSOR_SMOOTHING_MS);this.frameAt=tick;this.flashes=this.flashes.filter(f=>f.until>now);
   for(const c of this.cursors.values()){c.x+=(c.value.x-c.x)*amount;c.y+=(c.value.y-c.y)*amount;if(Math.hypot(c.x-c.value.x,c.y-c.value.y)<=.08){c.x=c.value.x;c.y=c.value.y;}}
   this.changed();this.animateFeedback();
  });
 }
 private drawPlacementGrid(ctx:CanvasRenderingContext2D){
  const {board:b,camera:cam,state,rect}=this,w=b.width/state.cols,h=b.height/state.rows,dash=4/cam.z,gap=7/cam.z,period=dash+gap;
  ctx.save();ctx.strokeStyle=boardThemeColors(this.currentTheme).targetGrid;ctx.lineWidth=.6/cam.z;ctx.lineDashOffset=0;
  // Match the PC grid's screen-sized dash/line weight. Some native Canvas
  // versions omit setLineDash; preserve its phase with visible manual segments.
  let nativeDash=false;if(typeof ctx.setLineDash==='function'){try{ctx.setLineDash([dash,gap]);nativeDash=true;}catch{}}
  ctx.beginPath();
  const segment=(x:number,y:number,length:number,vertical:boolean)=>{
   if(nativeDash){ctx.moveTo(x,y);ctx.lineTo(x+(vertical?0:length),y+(vertical?length:0));return;}
   const offset=vertical?y:x,from=Math.max(0,((vertical?-cam.y:-cam.x)/cam.z)-offset),to=Math.min(length,((vertical?rect.h-cam.y:rect.w-cam.x)/cam.z)-offset);
   for(let start=Math.floor(from/period)*period;start<to;start+=period){const end=Math.min(length,start+dash);if(end<=from)continue;ctx.moveTo(x+(vertical?0:start),y+(vertical?start:0));ctx.lineTo(x+(vertical?0:end),y+(vertical?end:0));}
  };
  for(let col=1;col<state.cols;col++){const x=b.x+col*w;if(x>=-cam.x/cam.z&&x<=(rect.w-cam.x)/cam.z)segment(x,b.y,b.height,true);}
  for(let row=1;row<state.rows;row++){const y=b.y+row*h;if(y>=-cam.y/cam.z&&y<=(rect.h-cam.y)/cam.z)segment(b.x,y,b.width,false);}
  ctx.stroke();ctx.restore();
 }
 private drawTableDots(ctx:CanvasRenderingContext2D){
  const r=this.rect,color=boardThemeColors(this.currentTheme).paperDot;
  let pattern=this.dotPatterns.get(ctx);
  if(!pattern||pattern.theme!==this.currentTheme){
   let value:CanvasPattern|null=null;
   // Cache the fixed-screen 20px tile instead of repainting thousands of dots.
   if(typeof ctx.createPattern==='function')try{const tile=this.platform.createCanvas();tile.width=tile.height=20;const c=tile.getContext('2d');if(c){c.fillStyle=color;c.beginPath();c.arc(10,10,.8,0,Math.PI*2);c.fill();value=ctx.createPattern(tile,'repeat');}}catch{}
   pattern={theme:this.currentTheme,value};this.dotPatterns.set(ctx,pattern);
  }
  if(pattern.value){ctx.fillStyle=pattern.value;ctx.fillRect(r.x,r.y,r.w,r.h);return;}
  // Older native Canvas implementations may not support repeating patterns.
  ctx.fillStyle=color;ctx.beginPath();for(let y=Math.floor(r.y/20)*20+10;y<r.y+r.h;y+=20)for(let x=Math.floor(r.x/20)*20+10;x<r.x+r.w;x+=20){ctx.moveTo(x+.8,y);ctx.arc(x,y,.8,0,Math.PI*2);}ctx.fill();
 }
 private drawSnapFeedback(ctx:CanvasRenderingContext2D,now:number){
  const {board:b,camera:cam}=this,w=b.width/this.state.cols,h=b.height/this.state.rows;
  // Bounded warm outline, expanding ring and eight small stars; no screen flash or blur.
  // Paint above all pieces, track the real group, and keep accents screen-sized.
  for(const flash of this.flashes){
   if(flash.until<=now)continue;const group=this.state.groups.find(g=>g.pieces.includes(flash.anchor));if(!group)continue;
   const t=Math.max(0,Math.min(1,(now-flash.startedAt)/(flash.until-flash.startedAt)));
   const alpha=flash.reduced?.58:flash.local?(t<.16?t/.16:t<.55?1-(t-.16)/.39*.18:.82*(1-t)/.45):(t<.18?t/.18*.6:.6*(1-t)/.82);
   ctx.save();ctx.lineJoin='round';ctx.lineCap='round';ctx.globalAlpha=alpha;
   for(const id of flash.ids){const piece=this.pieces[id];if(!piece)continue;ctx.save();ctx.translate(b.x+piece.col*w+group.dx,b.y+piece.row*h+group.dy);tracePuzzlePath(ctx,this.paths[id]);ctx.strokeStyle=flash.local?'#dab36466':'#d5c39440';ctx.lineWidth=(flash.local?6:4.16)/cam.z;ctx.stroke();ctx.strokeStyle=flash.local?'#fff2bb':'#e4d4a7b3';ctx.lineWidth=(flash.local?2.4:1.6)/cam.z;ctx.stroke();ctx.restore();}
   const focus=this.pieces[flash.anchor];ctx.translate(b.x+(focus.col+.5)*w+group.dx,b.y+(focus.row+.5)*h+group.dy);ctx.scale(1/cam.z,1/cam.z);
   if(flash.local&&!flash.reduced){
    const ease=1-(1-t)**2,spread=12+25*ease;ctx.globalAlpha=(1-t)*.85;
    ctx.strokeStyle=this.currentTheme==='dark'?'#ffe4a8':'#c18a36';ctx.lineWidth=1.7;ctx.beginPath();ctx.arc(0,0,9+25*ease,0,Math.PI*2);ctx.stroke();
    for(let i=0;i<8;i++){const angle=i*Math.PI/4,x=Math.cos(angle)*spread,y=Math.sin(angle)*spread,r=(i%2?2:3.5)*(1-t*.5);ctx.fillStyle=i%2?'#e5aa52':'#fff2b0';ctx.beginPath();ctx.moveTo(x,y-r);ctx.lineTo(x+r*.65,y);ctx.lineTo(x,y+r);ctx.lineTo(x-r*.65,y);ctx.closePath();ctx.fill();}

   }
   if(flash.xp){ctx.globalAlpha=flash.reduced?1:t<.15?t/.15:t<.7?1:(1-t)/.3;ctx.font='700 15px sans-serif';ctx.textAlign='center';ctx.textBaseline='bottom';ctx.fillStyle=this.currentTheme==='dark'?'#ffe4a8':'#896027';ctx.strokeStyle=this.currentTheme==='dark'?'#2b271d':'#fff7df';ctx.lineWidth=3;const y=-36+(flash.reduced?0:3-10*(1-(1-t)**2)),label=`+${flash.xp} XP`;ctx.strokeText(label,0,y);ctx.fillText(label,0,y);}
   ctx.restore();
  }
 }
 private paintPaper(ctx:CanvasRenderingContext2D){
  const {rect:r}=this,colors=boardThemeColors(this.currentTheme),centre=this.phoneLandscapeRoom?landscapeRoomColors.table:colors.paper,edge=this.phoneLandscapeRoom?landscapeRoomColors.tableEdge:colors.paperEdge,radius=this.phoneLandscapeRoom?Math.hypot(r.w*.5,r.h*.55):Math.max(r.w,r.h)*.75,paper=ctx.createRadialGradient(r.x+r.w*.5,r.y+r.h*.45,0,r.x+r.w*.5,r.y+r.h*.45,radius);if(typeof paper?.addColorStop==='function'){paper.addColorStop(0,centre);paper.addColorStop(1,edge);ctx.fillStyle=paper;}else ctx.fillStyle=centre;ctx.fillRect(r.x,r.y,r.w,r.h);if(!this.phoneLandscapeRoom)this.drawTableDots(ctx);
 }
 private releasePaperSurface(){const paper=this.paperSurface;this.paperSurface=null;if(paper){paper.close?.();paper.canvas.width=paper.canvas.height=1;}}
 /** The fixed-screen gradient and repeating dots do not depend on the camera.
  * Rasterize them once at the exact backing-pixel origin. In Android WebViews,
  * JS submission time can omit expensive deferred pattern rasterization. */
 private drawPaper(ctx:CanvasRenderingContext2D){
  if(!this.paperCacheEnabled||this.platform.config.id!=='taptap'||typeof ctx.getTransform!=='function'||ctx.globalAlpha!==1||ctx.globalCompositeOperation!=='source-over'){this.paintPaper(ctx);return;}
  const t=ctx.getTransform(),r=this.rect;
  if(t.b!==0||t.c!==0||!Number.isFinite(t.a)||!Number.isFinite(t.d)||t.a<=0||t.d<=0){this.paintPaper(ctx);return;}
  const x=Math.floor(r.x*t.a+t.e),y=Math.floor(r.y*t.d+t.f),width=Math.ceil((r.x+r.w)*t.a+t.e)-x,height=Math.ceil((r.y+r.h)*t.d+t.f)-y,bytes=width*height*4;
  if(width<1||height<1||width>8192||height>8192||bytes>PAPER_SURFACE_BYTES){this.releasePaperSurface();this.paintPaper(ctx);return;}
  const key=JSON.stringify([r,this.currentTheme,this.phoneLandscapeRoom,t.a,t.d,t.e,t.f,ctx.imageSmoothingEnabled,ctx.imageSmoothingQuality]);
  if(this.paperSurface?.key!==key){
   this.releasePaperSurface();let canvas:HTMLCanvasElement|undefined;
   try{
    canvas=this.platform.createCanvas();canvas.width=width;canvas.height=height;const c=canvas.getContext('2d');if(!c)throw Error('Canvas unavailable');
    c.setTransform(t.a,0,0,t.d,t.e-x,t.f-y);c.imageSmoothingEnabled=ctx.imageSmoothingEnabled;c.imageSmoothingQuality=ctx.imageSmoothingQuality;this.paintPaper(c);
    const paper:PaperSurface={canvas,key,bytes};this.paperSurface=paper;
    if(this.platform.snapshotCanvas)try{void this.platform.snapshotCanvas(canvas).then(snapshot=>{
     if(this.destroyed||this.paperSurface!==paper){snapshot.close();return;}
     paper.image=snapshot.image;paper.close=()=>snapshot.close();paper.canvas.width=paper.canvas.height=1;this.changed();
    }).catch(()=>{});}catch{}
   }catch{if(canvas)canvas.width=canvas.height=1;this.paintPaper(ctx);return;}
  }
  const paper=this.paperSurface!;ctx.save();try{ctx.setTransform(1,0,0,1,0,0);ctx.drawImage(paper.image??paper.canvas,x,y);}finally{ctx.restore();}
 }
 private drawSurface(ctx:CanvasRenderingContext2D){
  const {rect:r,camera:cam}=this,colors=boardThemeColors(this.currentTheme);
  ctx.beginPath();ctx.rect(r.x,r.y,r.w,r.h);ctx.clip();this.drawPaper(ctx);ctx.translate(r.x+cam.x,r.y+cam.y);ctx.scale(cam.z,cam.z);
  // The frame alone extends beyond the image. Grid and snap coordinates stay exact.
  const bx=this.board.x-9,by=this.board.y-9,bw=this.board.width+18,bh=this.board.height+18,radius=8;
  ctx.fillStyle=colors.target;ctx.strokeStyle=colors.targetLine;ctx.lineWidth=1/cam.z;ctx.beginPath();ctx.moveTo(bx+radius,by);ctx.lineTo(bx+bw-radius,by);ctx.quadraticCurveTo(bx+bw,by,bx+bw,by+radius);ctx.lineTo(bx+bw,by+bh-radius);ctx.quadraticCurveTo(bx+bw,by+bh,bx+bw-radius,by+bh);ctx.lineTo(bx+radius,by+bh);ctx.quadraticCurveTo(bx,by+bh,bx,by+bh-radius);ctx.lineTo(bx,by+radius);ctx.quadraticCurveTo(bx,by,bx+radius,by);ctx.closePath();ctx.fill();ctx.stroke();
  if(this.ready&&this.underlay){ctx.save();ctx.globalAlpha=.38;ctx.drawImage(this.picture,this.board.x,this.board.y,this.board.width,this.board.height);ctx.restore();}
  this.drawPlacementGrid(ctx);
 }
 private drawPieceGroups(ctx:CanvasRenderingContext2D,now:number,skipId?:number,onlyId?:number,paint:'all'|'pieces'|'overlays'='all',view:{rect:Rect;camera:{x:number;y:number;z:number}}=this){
  const {rect:r,camera:cam}=view,w=this.board.width/this.state.cols,h=this.board.height/this.state.rows,colors=boardThemeColors(this.currentTheme);
  // Keep placed pieces below every loose group without reordering synced state.
  // Within each layer, preserve the existing raiseGroup / hit-testing order.
  const placedPicture=this.ready&&!!this.atlas&&paint!=='overlays'&&onlyId===undefined;
  for(const locked of [true,false]){const layer=locked&&placedPicture?this.placedLayer():null;if(layer)ctx.drawImage(layer,this.board.x,this.board.y,this.board.width,this.board.height);
  for(const group of this.state.groups){if(group.id===skipId||(onlyId!==undefined&&group.id!==onlyId)||group.locked!==locked||!visibleGroup(group,this.pieces,this.edges))continue;const owner=this.owners[group.id];
   const lift=view===this&&this.drag?.id===group.id?this.dragLift(group):null;
   if(lift&&paint!=='overlays'){
    // One silhouette under the whole group, so seams inside it never darken.
    ctx.save();ctx.translate(lift.x+2.5/cam.z,lift.y+7/cam.z);ctx.scale(lift.s,lift.s);ctx.translate(-lift.x,-lift.y);ctx.beginPath();
    for(const id of group.pieces){const p=this.pieces[id];appendPuzzlePath(ctx,this.paths[id],this.board.x+p.col*w+group.dx,this.board.y+p.row*h+group.dy);}
    ctx.fillStyle=colors.dragShadow;ctx.fill();ctx.restore();
   }
   for(const id of group.pieces){const p=this.pieces[id],x=this.board.x+p.col*w+group.dx,y=this.board.y+p.row*h+group.dy;if(x+w+this.tile.pad<(0-cam.x)/cam.z||x-this.tile.pad>(r.w-cam.x)/cam.z||y+h+this.tile.pad<(0-cam.y)/cam.z||y-this.tile.pad>(r.h-cam.y)/cam.z)continue;
    const hintIndex=this.hintUntil>now?this.hintIds.indexOf(id):-1;
    if(paint==='overlays'&&!owner&&this.focusedPiece!==id&&hintIndex<0)continue;
    ctx.save();if(lift){ctx.translate(lift.x,lift.y);ctx.scale(lift.s,lift.s);ctx.translate(-lift.x,-lift.y);}ctx.translate(x,y);if(paint!=='overlays'&&!(locked&&layer)){if(this.atlas){const t=this.tile;ctx.drawImage(this.atlas,(id%t.columns)*t.w,Math.floor(id/t.columns)*t.h,t.w,t.h,-t.pad,-t.pad,t.w/t.scale,t.h/t.scale);}else{tracePuzzlePath(ctx,this.paths[id]);ctx.fillStyle=colors.piecePlaceholder;ctx.fill();ctx.strokeStyle=colors.pieceLine;ctx.lineWidth=.8/cam.z;ctx.stroke();}}
    if(paint!=='pieces'){
    if(owner||this.drag?.id===group.id||this.focusedPiece===id){tracePuzzlePath(ctx,this.paths[id]);ctx.strokeStyle=owner?.color||colors.focus;ctx.lineWidth=(owner&&this.phoneLandscapeRoom?2.5:2)/cam.z;ctx.stroke();}
    if(hintIndex>=0){ctx.fillStyle=colors.hint;ctx.font=`bold ${Math.max(13/cam.z,Math.min(w,h)*.3)}px sans-serif`;ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(String(hintIndex+1),w/2,h/2);}}
    ctx.restore();
   }
   if(paint!=='pieces'&&owner&&group.pieces.length){const p=this.pieces[group.pieces[0]],x=this.board.x+p.col*w+group.dx,y=this.board.y+p.row*h+group.dy;ctx.save();ctx.translate(x,y-7/cam.z);ctx.scale(1/cam.z,1/cam.z);ctx.font='11px sans-serif';const name=`${owner.name}${owner.level!==undefined?' Lv.'+owner.level:''}`,width=Math.min(190,ctx.measureText(name).width+12);
    if(this.phoneLandscapeRoom){this.drawPlayerArrow(ctx,owner.color);roomRoundPath(ctx,{x:19,y:-15,w:width,h:20},8);ctx.fillStyle=owner.color;ctx.fill();ctx.fillStyle='#ffffff';ctx.textBaseline='top';ctx.fillText(name,25,-11,width-12);}
    else{ctx.fillStyle=colors.label;ctx.fillRect(0,-15,width,19);ctx.fillStyle=colors.labelInk;ctx.textBaseline='top';ctx.fillText(name,5,-12,width-10);}ctx.restore();}
  }}
 }
 /** The held group is drawn slightly larger around the holding finger, so the
  * finger keeps its spot on the piece while the edges lift. Drawing only. */
 private dragLift(group:Group){
  const drag=this.drag,p=drag&&this.pointers.get(drag.pointer);if(!p)return null;
  const anchor=this.world(p),w=this.board.width/this.state.cols,h=this.board.height/this.state.rows;let far=0;
  for(const id of group.pieces){const piece=this.pieces[id],x=this.board.x+piece.col*w+group.dx,y=this.board.y+piece.row*h+group.dy;far=Math.max(far,Math.hypot(Math.max(Math.abs(x-anchor.x),Math.abs(x+w-anchor.x)),Math.max(Math.abs(y-anchor.y),Math.abs(y+h-anchor.y))));}
  return{x:anchor.x,y:anchor.y,s:1+Math.min(DRAG_LIFT_SCALE,DRAG_LIFT_PX/Math.max(1,far*this.camera.z))};
 }
 /** Placed pieces become the picture itself, kept in one board-sized layer at the atlas
  * scale. A snap repaints only the new pieces with their placed neighbours. Canvas clips
  * leave faint anti-aliased gaps along shared edges, so the mask is the outlines filled
  * and stroked 2 layer pixels wide, then filled from the source image (source-in): no
  * edge, seam or shadow is left between placed pieces, and a loose piece lying on top
  * keeps the only outline and shadow in sight. A restart or new image repaints it all. */
 private placedLayer():HTMLCanvasElement|null{
  const ids:number[]=[];for(const group of this.state.groups)if(group.locked)ids.push(...group.pieces);
  if(!ids.length){this.releasePlacedSurface();return null;}
  let surface=this.placedSurface,added=ids;
  if(surface&&surface.serial===this.imageSerial){const fresh=ids.filter(id=>!surface!.ids.has(id));if(surface.ids.size+fresh.length===ids.length){if(!fresh.length)return surface.canvas;added=fresh;}else surface=null;}else surface=null;
  const b=this.board,cols=this.state.cols,w=b.width/cols,h=b.height/this.state.rows,tab=Math.min(w,h)*.26;
  try{
   const full=!surface;
   if(!surface){const canvas=this.placedSurface?.canvas??this.platform.createCanvas();canvas.width=Math.max(1,Math.ceil(b.width*this.tile.scale));canvas.height=Math.max(1,Math.ceil(b.height*this.tile.scale));surface={canvas,serial:this.imageSerial,ids:new Set(),scratch:this.placedSurface?.scratch};this.placedSurface=surface;}
   const layer=surface.canvas,sx=layer.width/b.width,sy=layer.height/b.height;
   const placed=new Set(ids),paint=new Set(added);for(const id of added)for(const next of [id-cols,id+cols,...(id%cols?[id-1]:[]),...((id+1)%cols?[id+1]:[])])if(placed.has(next))paint.add(next);
   let left=Infinity,top=Infinity,right=-Infinity,bottom=-Infinity;
   for(const id of paint){const p=this.pieces[id];left=Math.min(left,p.col*w-tab);top=Math.min(top,p.row*h-tab);right=Math.max(right,(p.col+1)*w+tab);bottom=Math.max(bottom,(p.row+1)*h+tab);}
   // Whole layer pixels, so an incremental patch lands on the layer without resampling.
   const x0=Math.max(0,Math.floor(left*sx)),y0=Math.max(0,Math.floor(top*sy)),x1=Math.min(layer.width,Math.ceil(right*sx)),y1=Math.min(layer.height,Math.ceil(bottom*sy));
   if(x1<=x0||y1<=y0)throw Error('Empty placed patch');
   const target=full?layer:(surface.scratch??=this.platform.createCanvas());if(!full){target.width=x1-x0;target.height=y1-y0;}
   const c=target.getContext('2d');if(!c)throw Error('Canvas unavailable');
   c.save();c.setTransform(sx,0,0,sy,full?0:-x0,full?0:-y0);c.beginPath();
   for(const id of paint){const p=this.pieces[id];appendPuzzlePath(c,this.paths[id],p.col*w,p.row*h);}
   c.fillStyle=c.strokeStyle='#000';c.lineJoin='round';c.lineWidth=2/sx;c.fill();c.stroke();
   const px=this.picture.width/b.width,py=this.picture.height/b.height,bx=x0/sx,by=y0/sy,bw=(x1-x0)/sx,bh=(y1-y0)/sy;
   c.globalCompositeOperation='source-in';c.imageSmoothingEnabled=true;c.imageSmoothingQuality='high';c.drawImage(this.picture,bx*px,by*py,bw*px,bh*py,bx,by,bw,bh);c.restore();
   if(!full){const l=layer.getContext('2d');if(!l)throw Error('Canvas unavailable');l.save();l.setTransform(1,0,0,1,0,0);l.drawImage(target,x0,y0);l.restore();target.width=target.height=1;}
   for(const id of added)surface.ids.add(id);return layer;
  }catch{this.releasePlacedSurface();return null;}
 }
 private releasePlacedSurface(){const placed=this.placedSurface;this.placedSurface=null;if(placed){placed.canvas.width=placed.canvas.height=1;if(placed.scratch)placed.scratch.width=placed.scratch.height=1;}}
 private releaseDragSurface(){this.dragSurface=null;}
 private drawPlayerArrow(ctx:CanvasRenderingContext2D,color:string){
  ctx.beginPath();ctx.moveTo(1,1);ctx.lineTo(1,19);ctx.lineTo(6,14);ctx.lineTo(10,23);ctx.lineTo(14,21);ctx.lineTo(10,13);ctx.lineTo(18,13);ctx.closePath();ctx.fillStyle=color;ctx.fill();ctx.strokeStyle='#ffffff';ctx.lineWidth=1;ctx.stroke();
 }
 private releaseGestureSurface(){this.gestureSurface=null;}
 private releaseSurfaceBuffer(){this.dragSurface=null;this.gestureSurface=null;if(this.surfaceBuffer){this.surfaceBuffer.width=this.surfaceBuffer.height=1;this.surfaceBuffer=null;}}
 /** One GPU backing store per room, reused across both kinds of gesture.
  * Invalidating its contents never reallocates or resizes the texture. */
 private prepareSurfaceBuffer(width:number,height:number){
  if(!this.surfaceBuffer)this.surfaceBuffer=this.platform.createCanvas();
  const canvas=this.surfaceBuffer;
  if(canvas.width<width||canvas.height<height){
   const grownWidth=Math.max(canvas.width,width),grownHeight=Math.max(canvas.height,height),fits=grownWidth*grownHeight*4<=DRAG_SURFACE_BYTES;
   const nextWidth=fits?grownWidth:width,nextHeight=fits?grownHeight:height;
   if(canvas.width!==nextWidth)canvas.width=nextWidth;
   if(canvas.height!==nextHeight)canvas.height=nextHeight;
   this.surfaceAllocations++;
  }
  const c=canvas.getContext('2d');if(!c)throw Error('Canvas unavailable');
  c.setTransform(1,0,0,1,0,0);c.clearRect(0,0,canvas.width,canvas.height);
  c.globalAlpha=1;c.globalCompositeOperation='source-over';c.shadowBlur=0;c.shadowColor='rgba(0, 0, 0, 0)';if(c.filter!==undefined)c.filter='none';c.setLineDash?.([]);
  this.surfaceBuilds++;return{canvas,c};
 }
 /** Cache just piece artwork while moving the camera. Screen-sized guides,
  * ownership, hints, cursors and feedback stay live. Overscan is rebased when
  * needed so new edges never reveal an unpainted strip. Source images and
  * backing DPR stay unchanged; releasing the gesture restores direct drawing. */
 private cachedGestureSurface(ctx:CanvasRenderingContext2D,now:number):GestureSurface|null{
  if(!this.gestureCacheEnabled||!(this.pan||this.pinch)||this.drag||!this.atlas||typeof ctx.getTransform!=='function'||typeof ctx.setTransform!=='function'){this.releaseGestureSurface();return null;}
  const transform=ctx.getTransform();
  if(!transform||transform.b!==0||transform.c!==0||!Number.isFinite(transform.a)||!Number.isFinite(transform.d)||transform.a<=0||transform.d<=0||ctx.globalAlpha!==1||ctx.globalCompositeOperation!=='source-over'){this.releaseGestureSurface();return null;}
  this.releaseDragSurface();
  const {rect:r,camera:cam}=this,sx=transform.a,sy=transform.d,margin=Math.min(160,Math.max(64,Math.min(r.w,r.h)*.32));
  const mx=Math.ceil(margin*sx),my=Math.ceil(margin*sy),width=Math.ceil(r.w*sx)+mx*2,height=Math.ceil(r.h*sy)+my*2;
  if(width*height*4>DRAG_SURFACE_BYTES||width>8192||height>8192){this.releaseSurfaceBuffer();return null;}
  const key=JSON.stringify([this.imageSerial,this.currentTheme,this.edges,r,sx,sy,width,height,ctx.imageSmoothingEnabled,ctx.imageSmoothingQuality,this.state.groups]);
  let surface=this.gestureSurface;
  if(surface?.key===key&&cam.z/surface.camera.z>=.8&&cam.z/surface.camera.z<=1.25&&gestureFrameSample(surface,cam,r.w,r.h))return surface;
  try{
   const {canvas,c}=this.prepareSurfaceBuffer(width,height);
   const camera={x:cam.x+mx/sx,y:cam.y+my/sy,z:cam.z},rect={x:0,y:0,w:width/sx,h:height/sy};
   c.setTransform(sx,0,0,sy,0,0);c.imageSmoothingEnabled=ctx.imageSmoothingEnabled;c.imageSmoothingQuality=ctx.imageSmoothingQuality;
   c.save();c.translate(camera.x,camera.y);c.scale(camera.z,camera.z);this.drawPieceGroups(c,now,undefined,undefined,'pieces',{camera,rect});c.restore();
   surface={canvas,key,camera,width:rect.w,height:rect.h,sx,sy};this.gestureSurface=surface;return surface;
  }catch{this.releaseSurfaceBuffer();return null;}
 }
 /** Cache only the unchanged scene below a locally raised drag. The pixels use
  * the caller's full device transform and pixel origin, without a resample.
  * Other drag orders and Canvas implementations keep the original draw path. */
 private cachedDragSurface(ctx:CanvasRenderingContext2D,now:number):DragSurface|null{
  const drag=this.drag,groups=this.state.groups;let last:Group|undefined;for(let i=groups.length-1;i>=0;i--)if(!groups[i].locked&&visibleGroup(groups[i],this.pieces,this.edges)){last=groups[i];break;}
  if(!drag||this.pan||this.pinch||last?.id!==drag.id||!this.atlas||typeof ctx.getTransform!=='function'||typeof ctx.setTransform!=='function'||ctx.globalAlpha!==1||ctx.globalCompositeOperation!=='source-over'||ctx.shadowBlur!==0||ctx.shadowColor!=='rgba(0, 0, 0, 0)'||(ctx.filter!==undefined&&ctx.filter!=='none')){this.releaseDragSurface();return null;}
  // Stage rounds each backing dimension independently. Fractional phone DPRs
  // therefore produce slightly different X/Y scales; both remain axis-aligned
  // and can be copied exactly into the cache without resampling.
  const transform=ctx.getTransform();if(!transform||transform.b!==0||transform.c!==0||!Number.isFinite(transform.a)||!Number.isFinite(transform.d)||transform.a<=0||transform.d<=0){this.releaseDragSurface();return null;}
  const {rect:r,camera:cam}=this,width=ctx.canvas?.width??0,height=ctx.canvas?.height??0;
  if(!Number.isFinite(width*height)||width<1||height<1||width*height*4>DRAG_SURFACE_BYTES){this.releaseSurfaceBuffer();return null;}
  const paint={imageSmoothingEnabled:ctx.imageSmoothingEnabled,imageSmoothingQuality:ctx.imageSmoothingQuality,lineCap:ctx.lineCap,lineJoin:ctx.lineJoin,miterLimit:ctx.miterLimit,lineDashOffset:ctx.lineDashOffset,textAlign:ctx.textAlign,textBaseline:ctx.textBaseline,direction:ctx.direction,fontKerning:ctx.fontKerning,fontStretch:ctx.fontStretch,fontVariantCaps:ctx.fontVariantCaps,letterSpacing:ctx.letterSpacing,wordSpacing:ctx.wordSpacing,textRendering:ctx.textRendering},dash=ctx.getLineDash?.()??[];
  const activeHints=this.hintUntil>now?this.hintIds:[],key=JSON.stringify([this.imageSerial,r,cam,width,height,transform.a,transform.d,transform.e,transform.f,this.currentTheme,this.edges,this.underlay,this.focusedPiece,activeHints,paint,dash,groups.map(g=>[g.id,g.locked,g.pieces,...(g.id===drag.id?[]:[g.dx,g.dy])]),this.owners]);
  if(this.dragSurface?.key===key)return this.dragSurface;
  let surface=this.dragSurface;
  try{
   const {canvas,c}=this.prepareSurfaceBuffer(width,height);surface={canvas,key:''};
   c.setTransform(transform.a,0,0,transform.d,transform.e,transform.f);
   Object.assign(c,Object.fromEntries(Object.entries(paint).filter(([,value])=>value!==undefined)));c.setLineDash?.(dash);
   c.save();this.drawSurface(c);this.drawPieceGroups(c,now,drag.id);c.restore();
   surface.key=key;this.dragSurface=surface;return surface;
  }catch{this.releaseSurfaceBuffer();return null;}
 }
 draw(ctx:CanvasRenderingContext2D){
  if(this.destroyed||!this.rect.w)return;const {rect:r,camera:cam}=this,w=this.board.width/this.state.cols,h=this.board.height/this.state.rows,now=Date.now(),colors=boardThemeColors(this.currentTheme);
  const decorations:{value:RoomDecoration;rect:Rect}[]=[];let surface:DragSurface|null=null;
  let gesture:GestureSurface|null=null;
  try{gesture=this.cachedGestureSurface(ctx,now);}catch{this.releaseGestureSurface();}
  try{surface=this.cachedDragSurface(ctx,now);}catch{this.releaseDragSurface();}
  if(surface){ctx.save();ctx.setTransform(1,0,0,1,0,0);ctx.drawImage(surface.canvas,0,0);ctx.restore();}
  ctx.save();
  if(surface){ctx.beginPath();ctx.rect(r.x,r.y,r.w,r.h);ctx.clip();ctx.translate(r.x+cam.x,r.y+cam.y);ctx.scale(cam.z,cam.z);this.drawPieceGroups(ctx,now,undefined,this.drag!.id);}
  else{this.drawSurface(ctx);
   const sample=gesture&&gestureFrameSample(gesture,cam,r.w,r.h);
   if(gesture&&sample){
    // drawSurface leaves world coordinates active. Copy the sampled artwork
    // in local screen coordinates, then restore the exact world transform.
    ctx.save();ctx.translate(-cam.x/cam.z,-cam.y/cam.z);ctx.scale(1/cam.z,1/cam.z);
    const x=Math.max(0,sample.x),y=Math.max(0,sample.y),sw=Math.min(sample.width,gesture.width-x),sh=Math.min(sample.height,gesture.height-y);
    ctx.drawImage(gesture.canvas,x*gesture.sx,y*gesture.sy,sw*gesture.sx,sh*gesture.sy,0,0,r.w,r.h);ctx.restore();
    this.drawPieceGroups(ctx,now,undefined,undefined,'overlays');
   }else this.drawPieceGroups(ctx,now);
  }
  if(this.ready&&this.completionReveal>0){const b=this.board;ctx.save();ctx.globalAlpha=this.completionReveal;ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality='high';ctx.drawImage(this.picture,b.x,b.y,b.width,b.height);ctx.restore();
   if(this.completionSweep!==null){const slant=Math.tan(Math.PI/9),band=b.width*.35,travel=b.width+band+b.height*slant,x=b.x-band-b.height*slant+travel*this.completionSweep;ctx.save();ctx.beginPath();ctx.rect(b.x,b.y,b.width,b.height);ctx.clip();ctx.globalCompositeOperation='source-over';ctx.transform(1,0,slant,1,x,b.y);const light=ctx.createLinearGradient(0,0,band,0);light.addColorStop(0,'#fff8e000');light.addColorStop(.5,'rgba(255,248,224,.55)');light.addColorStop(1,'#fff8e000');ctx.fillStyle=light;ctx.fillRect(0,0,band,b.height);const core=b.width*.08,coreX=(band-core)/2,bright=ctx.createLinearGradient(coreX,0,coreX+core,0);bright.addColorStop(0,'#fffdf400');bright.addColorStop(.5,'rgba(255,253,244,.8)');bright.addColorStop(1,'#fffdf400');ctx.fillStyle=bright;ctx.fillRect(coreX,0,core,b.height);ctx.restore();}
  }
  for(const locked of [true,false])for(const group of this.state.groups){const owner=this.owners[group.id];if(group.locked!==locked||!owner?.decoration||!group.pieces.length||!visibleGroup(group,this.pieces,this.edges))continue;const p=this.pieces[group.pieces[0]],x=this.board.x+p.col*w+group.dx,y=this.board.y+p.row*h+group.dy;decorations.push({value:owner.decoration,rect:{x:r.x+cam.x+x*cam.z-27,y:r.y+cam.y+y*cam.z-25,w:24,h:24}});}
  this.drawSnapFeedback(ctx,now);
  if(this.completionReveal<=0&&this.hintUntil>now){for(const[idIndex,id]of this.hintIds.entries()){const p=this.pieces[id];ctx.save();ctx.translate(this.board.x+p.col*w,this.board.y+p.row*h);tracePuzzlePath(ctx,this.paths[id]);ctx.strokeStyle=colors.hintLine;ctx.lineWidth=2/cam.z;ctx.stroke();ctx.fillStyle=colors.hint;ctx.font=`bold ${14/cam.z}px sans-serif`;ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(String(idIndex+1),w/2,h/2);ctx.restore();}}
  ctx.restore();
  if(this.preview&&this.ready){const maxW=Math.min(r.w*.35,150),height=maxW*this.board.height/this.board.width,top=r.y+Math.max(6,Math.min(this.previewTopInset,r.h-height-12));ctx.save();ctx.fillStyle=colors.preview;ctx.fillRect(r.x+r.w-maxW-12,top,maxW+6,height+6);ctx.drawImage(this.picture,r.x+r.w-maxW-9,top+3,maxW,height);ctx.strokeStyle=colors.previewLine;ctx.lineWidth=1;ctx.strokeRect(r.x+r.w-maxW-12,top,maxW+6,height+6);ctx.restore();}
  ctx.save();ctx.beginPath();ctx.rect(r.x,r.y,r.w,r.h);ctx.clip();for(const cursor of this.cursors.values()){const p=this.worldToScreen(cursor),value=cursor.value;if(p.x<r.x||p.y<r.y||p.x>r.x+r.w||p.y>r.y+r.h)continue;ctx.save();ctx.translate(p.x,p.y);ctx.beginPath();ctx.moveTo(1,1);ctx.lineTo(1,19);ctx.lineTo(6,14);ctx.lineTo(10,23);ctx.lineTo(14,21);ctx.lineTo(10,13);ctx.lineTo(18,13);ctx.closePath();ctx.fillStyle=value.color;ctx.fill();ctx.strokeStyle=colors.cursorLine;ctx.lineWidth=1;ctx.stroke();ctx.font='bold 11px sans-serif';const label=`${value.name} · Lv.${value.level??0}`,width=Math.min(190,ctx.measureText(label).width+12);if(this.phoneLandscapeRoom){roomRoundPath(ctx,{x:19,y:12,w:width,h:21},8);ctx.fillStyle=value.color;ctx.fill();}else{ctx.fillStyle=colors.cursorLabel;ctx.fillRect(19,12,width,21);}ctx.fillStyle=this.phoneLandscapeRoom?'#ffffff':colors.labelInk;ctx.textBaseline='top';ctx.fillText(label,25,17,width-12);ctx.restore();if(value.decoration)decorations.push({value:value.decoration,rect:{x:p.x-12.5,y:p.y-12.5,w:25,h:25}});}ctx.restore();
  if(this.selfDecoration&&this.ownPoint){const p=this.worldToScreen(this.ownPoint);decorations.push({value:this.selfDecoration,rect:{x:p.x-12.5,y:p.y-12.5,w:25,h:25}});}
  if(this.drawDecoration&&decorations.length){ctx.save();ctx.beginPath();ctx.rect(r.x,r.y,r.w,r.h);ctx.clip();for(const d of decorations)this.drawDecoration(d.value,d.rect);ctx.restore();}
  if(this.tray)this.drawTray(ctx);
 }
 destroy(){if(this.destroyed)return;this.cancelInput(true);this.releaseSurfaceBuffer();this.releasePaperSurface();this.releasePlacedSurface();this.ownPoint=null;this.onCursor?.(null);this.destroyed=true;this.onCursor=null;this.cursors.clear();this.cancelImage?.();this.removeHide();this.removeShow();this.flashes=[];this.pendingDrops.clear();this.contributions.clear();if(this.frame)this.platform.cancelFrame(this.frame);if(this.timer)clearTimeout(this.timer);this.imageSerial++;if(this.atlas)this.atlas.width=this.atlas.height=1;this.atlas=null;this.picture.width=1;this.picture.height=1;}
}
