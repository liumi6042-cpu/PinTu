import { boardFor,normalizePuzzle,worldFor,piecesFor,pathFor,moveGroup,raiseGroup,visibleGroup,neighbors,snapTolerance,type PuzzleState,type Group } from '../lib/puzzle-engine';
import { pictureCrop,drawPiecePicture } from '../lib/puzzle-picture';
import { newMobileConnections,MobileContributionGate,MOBILE_REDUCED_GLOW_MS,type MobileConnectionGlow,type MobileContributionReceipt } from '../lib/connection-feedback';
import {cursorWorld,cursorScreen,type CursorPoint,type SharedCursor} from '../lib/room-cursors';
import type { RoomTable,RoomPieceOwner,RoomDecoration } from '../lib/room-client';
import type { Platform,Input,Point,Rect } from './ports';
import {boardThemeColors,landscapeRoomColors,type ThemeId} from './theme';
import {roomRoundPath} from './room-chrome';
import {gestureFrameSample,type GestureFrame} from '../lib/puzzle-gesture-cache';
import {MergeHolderLog,detectTeamMerges} from '../lib/team-merge';
import {fadePixels,seededTilts,readWindSave,writeWindSave,windStorageKey,dropJoinsShadow,safeDropOffset,type BoardVariant} from './story-variants';

type Command={op:'M'|'L'|'C'|'Z';args:number[]};
type Owner=RoomPieceOwner;
/** sx/sy is the finger's screen point at grab; live turns on once the finger passes DRAG_SLOP or another finger moves the camera. */
type Drag={id:number;pointer:number;x:number;y:number;dx:number;dy:number;serial:number;sx:number;sy:number;live:boolean;at:number;local?:boolean};
type Pan={pointer:number;x:number;y:number;cx:number;cy:number};
type Pinch={a:number;b:number;distance:number;zoom:number;worldX:number;worldY:number;held:boolean};
/** The large reference view: z multiplies the fitted size, x/y move its centre in screen pixels. */
type PreviewView={z:number;x:number;y:number};
type PreviewTouch={points:Map<number,Point>;start:Map<number,Point>;view:PreviewView;moved:boolean};
/** The corner map: frame and inner are screen rects; inner shows the table from world x/y at scale. */
type MinimapLayout={frame:Rect;inner:Rect;x:number;y:number;scale:number};
const MINIMAP_MARK_MS=60000,MINIMAP_REDRAW_MS=300;
const PREVIEW_MAX_ZOOM=8,PREVIEW_DOUBLE_TAP_MS=320;
const CANVAS_SNAP_FEEDBACK_MS=720;
/** The locate glow pulses four times, then fades out. */
const LOCATE_MS=3600,LOCATE_PULSE_MS=900;
// setTimeout overflows past ~24.8 days and fires at once; lasting tool grants expire far later than that.
const MAX_TIMER_MS=2147483647;
// Hints pulse (continuous frames) for their first 30 s only; a lasting hint then stays drawn without animating.
const HINT_PULSE_MS=30000;
type SnapFlash={anchor:number;ids:number[];local:boolean;startedAt:number;until:number;reduced:boolean;xp?:number};
/** 默契拼合: hearts and sparkles in both players' colours at the seam two players just joined. */
type TeamBurst={a:number;b:number;colors:[string,string];names:string;startedAt:number;until:number;reduced:boolean};
const TEAM_BURST_MS=1500,TEAM_REDUCED_MS=600,SELF_HOLDER='\u0000self';
type ImagePreparation=Readonly<{phase:'loading'|'preparing'|'ready';completed:number;total:number}>;
type DragSurface={canvas:HTMLCanvasElement;key:string};
type GestureSurface=GestureFrame&{canvas:HTMLCanvasElement;key:string;sx:number;sy:number};
type PaperSurface={canvas:HTMLCanvasElement;key:string;bytes:number;image?:CanvasImageSource;close?:()=>void};
type PlacedSurface={canvas:HTMLCanvasElement;serial:number;ids:Set<number>;scratch?:HTMLCanvasElement};
const DRAG_SURFACE_BYTES=24*1024*1024;
/** Screen distance a held finger travels before the piece follows it, so a press or a shifted grip never nudges a piece. */
export const DRAG_SLOP=8;
/** A second finger this soon after the first lands on a piece, before the piece moved, starts a pinch: the piece stays put. */
export const PINCH_GRACE_MS=250;
/** A finger held still this long, or one that landed this close to the board's left, right or bottom edge and has not
 * moved, is a grip (a thumb or palm holding the phone). It does not turn the next touch into a pinch. */
export const GRIP_MS=350,GRIP_EDGE_PX=16;
/** A held group grows by at most this fraction, and at most DRAG_LIFT_PX at its far edge, around the finger. */
const DRAG_LIFT_SCALE=.08,DRAG_LIFT_PX=6;
/** A finger covers the piece it drops, so a release within DROP_ASSIST of a piece from the board spot or a
 * matching neighbour is aligned exactly before the drop is sent. The server keeps its own tolerance,
 * and an exact offset always passes it. */
const DROP_ASSIST=.375;
/** While a group dragged out of the tray is held, the tray shrinks to a strip this tall; letting go on it puts the group back. */
export const TRAY_STRIP_PX=28;
/** A finger held still this long on a tray cell lifts its group: any movement after that pulls it out, and lifting the finger does nothing. */
export const TRAY_LIFT_MS=300;
/** Tray grid: a portrait page is 5 x 4 (more columns only on wide screens), a landscape row is cut into cells about
 * as wide as a portrait one. Cells are at most square (pieces are), rows never under TRAY_ROW_MIN, and the tray takes at
 * most TRAY_HEIGHT_PORTRAIT / TRAY_HEIGHT_LANDSCAPE of the table's height. */
export const TRAY_COLUMNS_PORTRAIT=5,TRAY_ROWS_PORTRAIT=4,TRAY_CELL_LANDSCAPE=72,TRAY_ROW_MIN=36,TRAY_HEIGHT_PORTRAIT=.37,TRAY_HEIGHT_LANDSCAPE=.45;
/** The tray's one control row (pager left, hint, × right) and the padding under the grid. A portrait row is wider than tall,
 * so a piece may reach TRAY_ROW_POKE past its cell's top and bottom: opposite tabs of neighbouring rows at most just touch.
 * The pager arrows also take taps TRAY_PAGER_REACH above the tray, so they are 44 pt tall. */
export const TRAY_HEAD_PX=32,TRAY_FOOT_PX=6,TRAY_ROW_POKE=2,TRAY_PAGER_REACH=12;
/** A tray piece, tabs included, fills its cell (the cells keep a 5 pt gap between them). */
export const TRAY_PIECE_FILL=1;
/** A tray piece is never drawn larger than this many screen pixels per pixel of the picture, so it stays sharp:
 * in 300+ piece rooms the picture, not the cell, sets the size. */
export const TRAY_SOURCE_ZOOM=1.15;
/** The margin around a piece that holds its tabs (.23 deep) and their edge line, as a share of the smaller piece side. */
const TRAY_TAB_MARGIN=.25;
/** Tray pictures kept for redraws: about three pages, and never more than TRAY_TILE_BYTES of pixels (RGBA). */
export const TRAY_TILE_CACHE=60,TRAY_TILE_BYTES=8*1024*1024;
/** With the tray open on a landscape phone the 原图 thumbnail moves up beside the corner tool toggle, this far from the right edge. */
const THUMB_TOGGLE_PX=50;
/** A 32-bit hash of text (FNV-1a with a murmur finaliser): the tray's shuffle key. Math.imul only, for old WebViews. */
export function trayHash(text:string){
 let h=0x811c9dc5;for(let i=0;i<text.length;i++){h^=text.charCodeAt(i);h=Math.imul(h,0x01000193);}
 h^=h>>>16;h=Math.imul(h,0x85ebca6b);h^=h>>>13;h=Math.imul(h,0xc2b2ae35);h^=h>>>16;return h>>>0;
}
/** A drop still unanswered after this long no longer holds back the stranded-piece check. */
const STRANDED_PENDING_MS=10000;
/** 回忆变奏关: a faded piece regains its colour over FADE_IN_MS; one press of the rotate button turns a piece in TURN_MS. */
export const FADE_IN_MS=800,TURN_MS=200;
/** The round 「旋转」 button: radius, and its gap from the piece's corner. */
export const ROTATE_BUTTON_R=23;
const ROTATE_BUTTON_GAP=4,SETTLE_RETRY_MS=700,SETTLE_TRIES=8;
const reducedMotion=()=>typeof globalThis.matchMedia==='function'&&globalThis.matchMedia('(prefers-reduced-motion: reduce)').matches;
/** Adds a piece outline turned by `degrees` about the centre (cx,cy) of its cell at (x,y). */
function appendTurnedPath(ctx:CanvasRenderingContext2D,commands:Command[],x:number,y:number,degrees:number,cx:number,cy:number){
 if(!degrees){appendPuzzlePath(ctx,commands,x,y);return;}
 const a=degrees*Math.PI/180,cos=Math.cos(a),sin=Math.sin(a),px=(u:number,v:number)=>x+cx+(u-cx)*cos-(v-cy)*sin,py=(u:number,v:number)=>y+cy+(u-cx)*sin+(v-cy)*cos;
 for(const {op,args:a}of commands){if(op==='M')ctx.moveTo(px(a[0],a[1]),py(a[0],a[1]));else if(op==='L')ctx.lineTo(px(a[0],a[1]),py(a[0],a[1]));else if(op==='C')ctx.bezierCurveTo(px(a[0],a[1]),py(a[0],a[1]),px(a[2],a[3]),py(a[2],a[3]),px(a[4],a[5]),py(a[4],a[5]));else ctx.closePath();}
}
/** The nearest offset within reach that the server's drop would snap or join to, or null. */
export function dropAssistOffset(state:PuzzleState,id:number,reach:number,blocked:ReadonlySet<number>=new Set()):{dx:number;dy:number}|null{
 const active=state.groups.find(g=>g.id===id);if(!active||active.locked)return null;
 const owner=new Map<number,Group>();for(const group of state.groups)for(const piece of group.pieces)owner.set(piece,group);
 let best:{dx:number;dy:number}|null=null,nearest=reach;
 const consider=(dx:number,dy:number)=>{const distance=Math.hypot(dx-active.dx,dy-active.dy);if(distance<=nearest){nearest=distance;best={dx,dy};}};
 consider(0,0);
 for(const piece of active.pieces)for(const neighbor of neighbors(piece,state.cols,state.rows)){const target=owner.get(neighbor);if(target&&target!==active&&!blocked.has(target.id))consider(target.dx,target.dy);}
 return best;
}
const PAPER_SURFACE_BYTES=12*1024*1024;
export const CURSOR_SMOOTHING_MS=50;
const inside=(p:Point,r:Rect)=>p.x>=r.x&&p.y>=r.y&&p.x<=r.x+r.w&&p.y<=r.y+r.h;
const cloneGroups=(groups:Group[])=>groups.map(g=>({...g,pieces:[...g.pieces]}));

/** Resolve a grant against device progress. Only a new grant may fill vacancies;
 * subsequent snapshots remove unavailable pieces without spending another hint. */
export function selectHintPieceIds(state:Pick<PuzzleState,'cols'|'rows'|'groups'>,ids:readonly number[],owners:Readonly<Record<string,Owner>>={},options:{count?:number;topUp?:boolean}={}):number[]{
 const count=Math.min(3,Math.max(0,Math.floor(options.count??ids.length))),groups=new Map<number,Group>(),selected:number[]=[];
 for(const group of state.groups)for(const id of group.pieces)groups.set(id,group);
 const available=(id:number)=>{const group=groups.get(id);return Number.isInteger(id)&&id>=0&&id<state.cols*state.rows&&group&&!group.locked&&!owners[group.id];};
 for(const id of ids)if(selected.length<count&&available(id)&&!selected.includes(id))selected.push(id);
 if(options.topUp!==false&&selected.length<count){
  const candidates=state.groups.filter(g=>!g.locked&&!owners[g.id]&&g.pieces.length).sort((a,b)=>a.pieces.length-b.pieces.length);
  for(const group of candidates){if(selected.length>=count)break;if(group.pieces.some(id=>selected.includes(id)))continue;const id=group.pieces[0];if(available(id))selected.push(id);}
 }
 return selected;
}

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
 /** Thumbnail top when a floating control sits in the top-right corner; null keeps previewTopInset. */
 previewThumbInset:number|null=null;
 /** Corner map of the whole table while zoomed in. Opt-in under 更多; phones only. */
 minimapEnabled=false;
 selfDecoration:RoomDecoration|null=null;drawDecoration:((value:RoomDecoration,rect:Rect)=>void)|null=null;
 onCursor:((point:CursorPoint|null)=>void)|null=null;
 private pieces;private paths:Command[][];private polygons:{x:number;y:number}[][]|null=null;private hit:CanvasRenderingContext2D;
 private picture:HTMLCanvasElement;private atlas:HTMLCanvasElement|null=null;
 private tile={w:0,h:0,pad:0,columns:0,scale:1.5};private imageSerial=0;private ready=false;private cancelImage:(()=>void)|null=null;
 private preparation:ImagePreparation={phase:'loading',completed:0,total:0};
 private owners:Record<string,Owner>={};private pointers=new Map<number,Point>();
 private cursors=new Map<string,{value:SharedCursor;x:number;y:number}>();private ownPoint:CursorPoint|null=null;private frameAt:number|null=null;
 private tray=false;private focusedPiece:number|null=null;
 /** The tray lists groups in a shuffled order that is fixed per room (players placed them one by one in solved order).
  * A group's place comes from its smallest piece, so a merge only moves the merged group. trayKey is the room id. */
 trayKey='';
 private trayOrder:{groups:Group[];length:number;edges:boolean;key:string;list:Group[];rank:Map<Group,number>}|null=null;
 /** The group the current tray page starts with (rank, smallest piece); placing groups before it keeps the page in place. */
 private trayAnchor:{rank:number;min:number}|null=null;
 private trayTiles=new Map<string,HTMLCanvasElement>();private trayTileBytes=0;
 /** The tray draw each picture was last used in: pictures on screen now are never dropped, even past the byte budget. */
 private trayTileUsed=new Map<string,number>();private trayDraws=0;
 private trayTouch:{id:number;x:number;y:number;action:(()=>void)|null;group?:number;lift?:ReturnType<typeof setTimeout>|null;lifted?:boolean}|null=null;
 /** A group pulled out of the tray: the finger holding it and the spot it came from. */
 private trayDrag:{id:number;pointer:number;ox:number;oy:number}|null=null;
 private drag:Drag|null=null;private pan:Pan|null=null;private pinch:Pinch|null=null;private serial=0;
 /** Where and when each board finger landed, and whether it has travelled DRAG_SLOP; gripping fingers are left out of gestures until they lift. */
 private touchStarts=new Map<number,{x:number;y:number;at:number;moved:boolean}>();private gripping=new Set<number>();
 /** A finger on the 原图 thumbnail opens the large view only when it lifts without moving; a drag hands it to the table. */
 private thumbTouch:{id:number;x:number;y:number}|null=null;private thumbHandoff=false;
 /** When locked, one finger on empty table no longer moves the view; a second finger still pans and zooms. */
 viewLocked=false;
 private lockedTouch:{id:number;x:number;y:number}|null=null;private lockTold=false;
 private previewLarge=false;private previewView:PreviewView={z:1,x:0,y:0};private previewTouch:PreviewTouch|null=null;private previewThumb:Rect|null=null;private previewTap:{at:number;x:number;y:number}|null=null;
 private minimap:MinimapLayout|null=null;private minimapTouch:number|null=null;private minimapWorld:{x0:number;y0:number;x1:number;y1:number}|null=null;
 private minimapCache:{canvas:HTMLCanvasElement;key:string;at:number}|null=null;private minimapTimer:ReturnType<typeof setTimeout>|null=null;private locatedMarks:{ids:number[];until:number}|null=null;
 private edges=false;private backing=false;private preview=false;private hintIds:number[]=[];private hintUntil=0;private hintPulseUntil=0;private hintGrant:string|number|null=null;private underlayUntil=0;
 private flashes:SnapFlash[]=[];private locateStartedAt=0;private locateUntil=0;private frame=0;private destroyed=false;private feedbackHidden=false;
 private contributions=new MobileContributionGate();private pendingDrops=new Map<number,number>();private pendingDropAt=new Map<number,number>();private strandedResynced=new Set<number>();
 private mergeLog=new MergeHolderLog();private teamBursts:TeamBurst[]=[];
 /** 回忆变奏关 (story levels only, see story-variants.ts). fade: grayAtlas, and when each piece regained its colour.
  * wind: quarter turns of tilted pieces (piece id → 1-3), running turn animations in degrees, and groups kept
  * where the player put them while the room still has them at bx/by: a tilted piece never reaches the room
  * until it is upright, so no server drop or solo batch replay can join or place it. */
 private variant:BoardVariant|null=null;private grayAtlas:HTMLCanvasElement|null=null;private colorAt=new Map<number,number>();
 private rot=new Map<number,number>();private turning=new Map<number,{from:number;to:number;at:number}>();
 private kept=new Map<number,{dx:number;dy:number;bx:number;by:number}>();private roomOffsets=new Map<number,{dx:number;dy:number}>();
 private selected:number|null=null;private rotateRect:{x:number;y:number;r:number}|null=null;private rotateTouch:number|null=null;
 private settleTimers=new Map<number,ReturnType<typeof setTimeout>>();private settleTries=new Map<number,number>();
 /** The local player's name and room colour for 默契拼合; chimeUrl plays once per burst. */
 selfPlayer:{name:string;color:string}|null=null;chimeUrl='';
 private removeHide:()=>void;private removeShow:()=>void;private timer:ReturnType<typeof setTimeout>|null=null;private strandedTimer:ReturnType<typeof setTimeout>|null=null;private strandedTries=new Map<number,number>();
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
  this.removeHide=platform.onHide(()=>{this.feedbackHidden=true;this.flashes=[];this.teamBursts=[];this.locateUntil=0;if(this.frame)this.platform.cancelFrame(this.frame);this.frame=0;this.frameAt=null;this.cancelInput(true);this.releaseSurfaceBuffer();this.releasePaperSurface();this.releaseTrayTiles();this.changed();});
  this.removeShow=platform.onShow?.(()=>{this.feedbackHidden=false;this.frameAt=null;this.changed();this.animateFeedback();})??(()=>{});
 }
 get theme(){return this.currentTheme;}
 get backgroundPanning(){return !!this.pan&&!this.drag&&!this.pinch;}
 /** One finger on empty table, whether or not the view lock stops it from panning. */
 get backgroundTouch(){return (!!this.pan||!!this.lockedTouch)&&!this.drag&&!this.pinch;}
 performanceDetails(){return {gesture:this.pinch?'缩放':this.pan?'移动背景':this.drag?'拖动碎片':'静止',cache:!!(this.dragSurface||this.gestureSurface),pieces:this.pieces.length,pointers:this.pointers.size,builds:this.surfaceBuilds,allocations:this.surfaceAllocations,bufferBytes:this.surfaceBuffer?this.surfaceBuffer.width*this.surfaceBuffer.height*4:0};}
 get imagePreparation():ImagePreparation{return this.preparation;}
 setTheme(theme:ThemeId){if(this.currentTheme===theme)return;this.currentTheme=theme;this.releasePaperSurface();this.changed();}
 get edgeOnly(){return this.edges;}set edgeOnly(value:boolean){this.cancelInput(true);this.edges=value;this.changed();}
 get trayOpen(){return this.tray;}set trayOpen(value:boolean){if(this.tray===value)return;this.cancelInput(true);this.tray=value;this.changed();}
 get underlay(){return this.backing||this.underlayUntil>Date.now();}set underlay(value:boolean){this.backing=value;if(!value)this.underlayUntil=0;this.changed();}
 get showPreview(){return this.preview;}set showPreview(value:boolean){this.preview=value;if(!value)this.previewLarge=false;this.changed();}
 get previewZoomed(){return this.previewLarge;}
 /** The corner map's screen rect from the last draw, or null while it is hidden. */
 get minimapFrame(){return this.minimap?.frame??null;}
 openPreviewZoom(){if(!this.ready)return false;this.cancelInput(true);this.previewLarge=true;this.previewView={z:1,x:0,y:0};this.previewTap=null;this.changed();return true;}
 closePreviewZoom(){if(!this.previewLarge)return;this.previewLarge=false;this.previewTouch=null;this.previewTap=null;this.changed();}
 private changed(){if(!this.destroyed)this.invalidate();}
 private tell(message:string){this.notice=message;this.onNotice?.(message);this.changed();}
 async setImage(src:string){
  if(this.destroyed)return;
  this.cancelImage?.();const serial=++this.imageSerial,image=this.platform.createImage();
  let cancelled=false,cancelStep:(()=>void)|null=null,picture:HTMLCanvasElement|null=null,committed=false;
  const cancellation=()=>Object.assign(Error('已切换拼图图片'),{code:'IMAGE_LOAD_CANCELLED'});
  const checkCurrent=()=>{if(cancelled||this.destroyed||serial!==this.imageSerial)throw cancellation();};
  const cancel=()=>{cancelled=true;cancelStep?.();};this.cancelImage=cancel;
  this.releaseSurfaceBuffer();this.releasePlacedSurface();this.ready=false;if(this.atlas)this.atlas.width=this.atlas.height=1;this.atlas=null;this.releaseGrayAtlas();this.preparation={phase:'loading',completed:0,total:this.pieces.length};this.cancelInput(true);
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
   const gray=this.variant?.kind==='fade'?await this.makeGrayAtlas(prepared.atlas,checkCurrent,yieldPreparation):null;checkCurrent();
   const previous=this.picture;this.releaseTrayTiles();this.picture=picture;this.atlas=prepared.atlas;this.grayAtlas=gray;this.tile=prepared.tile;this.ready=true;committed=true;
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
   c.save();c.translate((piece.id%columns)*tileW,Math.floor(piece.id/columns)*tileH);c.beginPath();c.rect(0,0,tileW,tileH);c.clip();c.scale(scale,scale);c.translate(pad,pad);this.paintPiece(c,piece.id,picture,scale);c.restore();
   completed++;batch++;
   }while(completed<this.pieces.length&&batch<16&&Date.now()-started<6);
   checkCurrent();this.preparation={phase:'preparing',completed,total:this.pieces.length};this.changed();
   if(completed<this.pieces.length)await yieldPreparation();
  }
  checkCurrent();return{atlas,tile:{w:tileW,h:tileH,pad,columns,scale}};
  }catch(error){atlas.width=atlas.height=1;throw error;}
 }
 /** Paints one piece with its paper finish (contact shadow, picture, inner edge) on a context already scaled by `scale`
  * and moved to the piece's corner. The atlas and the tray pictures share it. */
 private paintPiece(c:CanvasRenderingContext2D,id:number,picture:HTMLCanvasElement,scale:number){
  const w=this.board.width/this.state.cols,h=this.board.height/this.state.rows,unit=Math.min(w,h),edge=Math.max(.45,Math.min(1.25,unit*.012)),blur=Math.max(2,Math.min(5,unit*.055)),offsetX=Math.max(.35,Math.min(1,unit*.01)),offsetY=Math.max(1,Math.min(3,unit*.028));
  tracePuzzlePath(c,this.paths[id]);
  c.save();c.fillStyle='#b89573';c.shadowColor='#5a321f80';c.shadowBlur=blur*scale;c.shadowOffsetX=offsetX*scale;c.shadowOffsetY=offsetY*scale;c.fill();c.restore();
  c.save();c.clip();drawPiecePicture(c,picture,this.pieces[id],this.state.cols,this.state.rows,this.board.width,this.board.height);c.lineJoin='round';c.strokeStyle='#855348bd';c.lineWidth=edge*2.4;c.stroke();
  const light=c.createLinearGradient(0,-h*.2,w*.35,h*1.15);if(typeof light?.addColorStop==='function'){light.addColorStop(0,'#fffbe8e8');light.addColorStop(.3,'#fff8dec2');light.addColorStop(.58,'#fff8de32');light.addColorStop(1,'#77513f4d');c.strokeStyle=light;}else c.strokeStyle='#fff8dec2';c.lineWidth=edge*1.2;c.stroke();c.restore();
 }
 /** A tray picture of one piece with its tabs, `width` device pixels wide, painted from the full picture. Atlas tiles of
  * big puzzles are small, and the tray enlarged them into a blur. Kept per size; the oldest are dropped first. */
 private trayTile(id:number,width:number){
  // Most recently drawn last, so the page on screen is never what gets dropped.
  const key=id+':'+width,cached=this.trayTiles.get(key);this.trayTileUsed.set(key,this.trayDraws);if(cached){this.trayTiles.delete(key);this.trayTiles.set(key,cached);return cached;}if(!this.ready)return null;
  const w=this.board.width/this.state.cols,h=this.board.height/this.state.rows,m=Math.min(w,h)*TRAY_TAB_MARGIN,k=width/(w+2*m),canvas=this.platform.createCanvas();
  canvas.width=Math.max(1,width);canvas.height=Math.max(1,Math.round((h+2*m)*k));const c=canvas.getContext('2d');if(!c)return null;
  c.imageSmoothingEnabled=true;c.imageSmoothingQuality='high';c.scale(k,k);c.translate(m,m);this.paintPiece(c,id,this.picture,k);
  this.trayTiles.set(key,canvas);this.trayTileBytes+=canvas.width*canvas.height*4;
  while(this.trayTiles.size>1&&(this.trayTiles.size>TRAY_TILE_CACHE||this.trayTileBytes>TRAY_TILE_BYTES)){const oldest=this.trayTiles.keys().next().value as string;if(this.trayTileUsed.get(oldest)===this.trayDraws)break;const tile=this.trayTiles.get(oldest);if(tile){this.trayTileBytes-=tile.width*tile.height*4;tile.width=tile.height=1;}this.trayTiles.delete(oldest);this.trayTileUsed.delete(oldest);}
  return canvas;
 }
 private releaseTrayTiles(){for(const tile of this.trayTiles.values())tile.width=tile.height=1;this.trayTiles.clear();this.trayTileUsed.clear();this.trayTileBytes=0;}
 /** The faded copy of the piece atlas, made once in bands of pixels so a low-end phone keeps answering (no ctx.filter:
  * older Android WebViews ignore it). Null when the pixels cannot be read: the level then plays in colour. */
 private async makeGrayAtlas(atlas:HTMLCanvasElement,checkCurrent:()=>void,yieldPreparation:()=>Promise<void>){
  let gray:HTMLCanvasElement|null=null;
  try{
   gray=this.platform.createCanvas();gray.width=atlas.width;gray.height=atlas.height;const c=gray.getContext('2d');
   if(!c||typeof c.getImageData!=='function'||typeof c.putImageData!=='function')throw Error('No pixel access');
   c.drawImage(atlas,0,0);const band=Math.max(1,Math.floor(262144/Math.max(1,gray.width)));
   for(let y=0;y<gray.height;y+=band){
    checkCurrent();const rows=Math.min(band,gray.height-y),image=c.getImageData(0,y,gray.width,rows);if(!image||!image.data)throw Error('No pixel access');
    fadePixels(image.data);c.putImageData(image,0,y);if(y+band<gray.height)await yieldPreparation();
   }
   return gray;
  }catch(error){if(gray)gray.width=gray.height=1;if((error as {code?:string})?.code==='IMAGE_LOAD_CANCELLED')throw error;return null;}
 }
 private releaseGrayAtlas(){if(this.grayAtlas)this.grayAtlas.width=this.grayAtlas.height=1;this.grayAtlas=null;}
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
 /** Turns this table into a 回忆变奏关. Call before the room attaches: a wind room restores its tilts and kept
  * positions from the device (or seeds them from the room id), and drops what no longer fits the room's state. */
 setVariant(variant:BoardVariant|null){
  this.variant=variant;this.rot.clear();this.turning.clear();this.colorAt.clear();this.kept.clear();this.selected=null;this.clearSettles();
  for(const group of this.state.groups)if(!this.roomOffsets.has(group.id))this.roomOffsets.set(group.id,{dx:group.dx,dy:group.dy});
  if(variant?.kind==='wind'){
   const singles=this.state.groups.filter(g=>!g.locked&&g.pieces.length===1);let save=null;
   try{save=readWindSave(this.platform.storage?.get(windStorageKey(variant.roomId))??null);}catch{}
   if(save){for(const group of singles){const id=group.pieces[0],q=save.rot.get(id),keep=save.pos.get(group.id);if(q)this.rot.set(id,q);if(keep&&this.sameOffset(group,keep.bx,keep.by)){this.kept.set(group.id,keep);group.dx=keep.dx;group.dy=keep.dy;}}}
   else if(!this.state.groups.every(g=>g.locked))seededTilts(variant.roomId,singles.map(g=>g.pieces[0]),variant.share).forEach((q,id)=>this.rot.set(id,q));
   this.saveWind();
  }
  if(variant?.kind!=='fade')this.releaseGrayAtlas();
  else if(this.ready&&this.atlas&&!this.grayAtlas){
   // Set after the picture was prepared: fade it now, in the same bands.
   const serial=this.imageSerial,cancelled=()=>{if(serial!==this.imageSerial||this.destroyed||this.variant!==variant)throw Object.assign(Error('已切换拼图图片'),{code:'IMAGE_LOAD_CANCELLED'});};
   void this.makeGrayAtlas(this.atlas,cancelled,()=>new Promise<void>(resolve=>setTimeout(resolve,0))).then(gray=>{if(!gray)return;if(serial===this.imageSerial&&!this.destroyed&&this.variant===variant){this.grayAtlas=gray;this.changed();}else gray.width=gray.height=1;}).catch(()=>{});
  }
  this.releaseGestureSurface();this.releaseDragSurface();this.changed();
 }
 /** Another player joined: the level carries on as a normal one. Every piece turns upright, and pieces kept
  * where the player put them are dropped there for the room. */
 suspendVariant(){
  const variant=this.variant;if(!variant)return;
  if(this.drag?.local)this.cancelInput(true);
  this.variant=null;this.rot.clear();this.turning.clear();this.colorAt.clear();this.selected=null;this.rotateRect=null;this.rotateTouch=null;this.releaseGrayAtlas();
  if(variant.kind==='wind'){this.saveWindTo(variant.roomId);for(const id of this.kept.keys())this.queueSettle(id,0);}
  this.releaseGestureSurface();this.releaseDragSurface();this.changed();
 }
 get variantKind(){return this.variant?.kind??null;}
 private sameOffset(group:{dx:number;dy:number},dx:number,dy:number){return Math.abs(group.dx-dx)<.01&&Math.abs(group.dy-dy)<.01;}
 private saveWind(){if(this.variant?.kind==='wind')this.saveWindTo(this.variant.roomId);}
 private saveWindTo(roomId:string){
  const key=windStorageKey(roomId);
  try{if(this.state.groups.every(g=>g.locked))this.platform.storage?.remove(key);else this.platform.storage?.set(key,writeWindSave({rot:this.rot,pos:this.kept}));}catch{}
 }
 /** Quarter turns of a piece lying alone, else 0: a joined or placed piece is always upright. */
 private turnsOf(group:Group){return this.variant?.kind==='wind'&&!group.locked&&group.pieces.length===1?this.rot.get(group.pieces[0])??0:0;}
 private tilted(group:Group){return this.turnsOf(group)!==0;}
 private rotatable(group:Group|undefined):group is Group{return !!group&&this.variant?.kind==='wind'&&!group.locked&&group.pieces.length===1&&!this.owners[group.id];}
 /** The drawn angle of a piece in degrees, following a running turn. */
 private angleOf(id:number,now:number){
  const turn=this.turning.get(id);
  if(turn){const k=(now-turn.at)/TURN_MS;if(k<1)return turn.from+(turn.to-turn.from)*(1-(1-k)*(1-k));this.turning.delete(id);}
  return (this.rot.get(id)??0)*90;
 }
 /** 1 = drawn grey, 0 = in colour, between = regaining its colour. */
 private fadeOf(group:Group,id:number,now:number){
  if(this.variant?.kind!=='fade'||!this.grayAtlas)return 0;
  if(!group.locked&&group.pieces.length===1)return 1;
  const at=this.colorAt.get(id);if(at===undefined)return 0;
  const k=(now-at)/FADE_IN_MS;if(k>=1){this.colorAt.delete(id);return 0;}return 1-Math.max(0,k);
 }
 private variantAnimating(now:number){
  for(const turn of this.turning.values())if(now-turn.at<TURN_MS)return true;
  for(const at of this.colorAt.values())if(now-at<FADE_IN_MS)return true;
  return false;
 }
 /** What the cached surfaces must notice: tilts and the selection. */
 private variantKey(){if(!this.variant)return '';let key=this.variant.kind+(this.grayAtlas?'g':'')+':'+this.selected;this.rot.forEach((q,id)=>{key+=','+id+'='+q;});return key;}
 /** Groups the room has somewhere other than where they are drawn, at the room's own offsets, for the drop check. */
 private shadowOffsets(except?:number){
  const result=new Map<number,{dx:number;dy:number}>();
  for(const group of this.state.groups){if(group.id===except||group.locked)continue;const keep=this.kept.get(group.id);if(keep)result.set(group.id,{dx:keep.bx,dy:keep.by});else if(this.tilted(group))result.set(group.id,this.roomOffsets.get(group.id)??{dx:group.dx,dy:group.dy});}
  return result;
 }
 /** A tilted group stays where the player put it; the room keeps its own offset until the piece is upright. */
 private keepLocal(group:Group){
  const room=this.roomOffsets.get(group.id)??{dx:group.dx,dy:group.dy},old=this.kept.get(group.id),bx=old?old.bx:room.dx,by=old?old.by:room.dy;
  if(this.sameOffset(group,bx,by))this.kept.delete(group.id);else this.kept.set(group.id,{dx:group.dx,dy:group.dy,bx,by});
  this.saveWind();this.changed();
 }
 /** One press of 「旋转」 (or Space): the selected piece turns a quarter clockwise; once upright it is dropped where it lies. */
 rotateSelected(){const group=this.selected===null?undefined:this.state.groups.find(g=>g.id===this.selected);return this.rotateGroup(group);}
 private rotateGroup(group:Group|undefined){
  if(!this.rotatable(group)||this.drag?.id===group.id)return false;
  const id=group.pieces[0],q=this.rot.get(id)??0,next=(q+1)%4,now=Date.now();
  let from=this.angleOf(id,now);if(q===0&&from>180)from-=360;
  if(!reducedMotion())this.turning.set(id,{from,to:q*90+90,at:now});else this.turning.delete(id);
  if(next)this.rot.set(id,next);else this.rot.delete(id);
  this.saveWind();if(!next)this.queueSettle(group.id,TURN_MS+20);
  this.releaseGestureSurface();this.releaseDragSurface();this.changed();this.animateFeedback();return true;
 }
 /** Turns a tilted piece straight upright (the hint does this before pointing at it). */
 private uprightPiece(id:number){
  const group=this.state.groups.find(g=>g.pieces.length===1&&g.pieces[0]===id);if(!group||!this.tilted(group))return;
  const now=Date.now(),from=this.angleOf(id,now);if(!reducedMotion())this.turning.set(id,{from,to:360,at:now});
  this.rot.delete(id);this.saveWind();this.queueSettle(group.id,TURN_MS+20);
 }
 private clearSettles(){for(const timer of this.settleTimers.values())clearTimeout(timer);this.settleTimers.clear();this.settleTries.clear();}
 private queueSettle(id:number,delay:number){
  const old=this.settleTimers.get(id);if(old)clearTimeout(old);
  this.settleTimers.set(id,setTimeout(()=>{this.settleTimers.delete(id);void this.settleUpright(id);},delay));
 }
 /** An upright single piece just turned (or drawn where the room does not have it yet) is dropped where it lies, so
  * it can join and lock. Busy (another drop or drag being confirmed): it tries again shortly, a few times. */
 private async settleUpright(id:number){
  const group=this.state.groups.find(g=>g.id===id),network=this.network;
  if(this.destroyed||!group||group.locked||this.tilted(group)||this.drag?.id===id)return;
  const retry=()=>{const tries=(this.settleTries.get(id)??0)+1;this.settleTries.set(id,tries);if(tries<SETTLE_TRIES)this.queueSettle(id,SETTLE_RETRY_MS);};
  if(!network||!this.networkReady||!this.ready||this.owners[id]||network.canAcquire?.(id)===false){retry();return;}
  let held=false;
  try{held=await network.acquire(id);}catch{held=false;}
  if(!held){retry();return;}
  const now=this.state.groups.find(g=>g.id===id);
  if(this.destroyed||this.network!==network||!now||now.locked||this.tilted(now)||this.drag?.id===id){network.release(id);return;}
  this.settleTries.delete(id);this.commitDrop(now,{serial:++this.serial,live:true});this.changed();
 }
 private groupAt(p:Point){
  const world=this.world(p),w=this.board.width/this.state.cols,h=this.board.height/this.state.rows,pad=Math.min(w,h)*.27;
  for(let i=this.state.groups.length-1;i>=0;i--){const group=this.state.groups[i];if(group.locked||!this.groupVisible(group))continue;
   for(const id of group.pieces){const piece=this.pieces[id];let x=world.x-this.board.x-piece.col*w-group.dx,y=world.y-this.board.y-piece.row*h-group.dy;
    // A turned piece is tested in its own upright frame.
    const angle=group.pieces.length===1?this.angleOf(id,Date.now()):0;if(angle){const a=-angle*Math.PI/180,u=x-w/2,v=y-h/2;x=w/2+u*Math.cos(a)-v*Math.sin(a);y=h/2+u*Math.sin(a)+v*Math.cos(a);}
    if(x < -pad||x>w+pad||y < -pad||y>h+pad)continue;if(this.polygons){if(inPolygon(this.polygons[id],x,y))return group;}else{tracePuzzlePath(this.hit,this.paths[id]);if(this.hit.isPointInPath(x,y))return group;}
   }
  }
  return null;
 }
 input(input:Input):boolean{
  if(this.destroyed||!this.rect.w)return false;
  if(input.type==='key'){
   if(input.key==='Escape'&&input.keyDown&&this.previewLarge){this.closePreviewZoom();return true;}
   if(input.key==='Escape'&&input.keyDown&&(this.pointers.size||this.trayTouch)){this.cancelInput(true);return true;}
   // Space turns the selected piece (R is already 整理).
   if(input.key===' '&&input.keyDown&&this.variant?.kind==='wind'&&this.selected!==null&&!this.previewLarge){if(!input.repeat)this.rotateSelected();return true;}
   return false;
  }
  if(this.previewInput(input))return true;
  if(this.minimapInput(input))return true;
  if(this.rotateInput(input))return true;
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
  if(input.type==='up')for(const p of input.changed){this.gripping.delete(p.id);if(!this.pointers.has(p.id))this.touchStarts.delete(p.id);}
  if(input.type==='down'){
   const now=Date.now(),added=input.changed.filter(p=>inside(p,this.rect)&&!this.pointers.has(p.id)&&!this.gripping.has(p.id));
   for(const p of added){this.pointers.set(p.id,p);this.touchStarts.set(p.id,{x:p.x,y:p.y,at:now,moved:false});}
   if(!this.pointers.size)return false;
   if(this.drag&&this.pointers.has(this.drag.pointer)){
    // While a piece is held, one more finger pans; a third finger turns that pan into a pinch. Further fingers are ignored.
    const others=[...this.pointers.values()].filter(p=>p.id!==this.drag!.pointer);
    // Two fingers landing together mean zoom, even when the first one happened to land on a piece.
    if(others.length===1&&!this.drag.live&&now-this.drag.at<=PINCH_GRACE_MS){this.beginPinch();return true;}
    if(others.length)this.drag.live=true;
    if(others.length>=2){if(!this.pinch){this.pan=null;this.pinch=this.pinchBetween(others[0],others[1],true);}}
    else if(!this.pan||this.pan.pointer===this.drag.pointer){const p=added.find(p=>p.id!==this.drag!.pointer);if(p){const v=this.local(p);this.pan={pointer:p.id,x:v.x,y:v.y,cx:this.camera.x,cy:this.camera.y};}}
    this.publishCursor(this.pointers.get(this.drag.pointer)!);this.changed();return true;
   }
   if(this.pointers.size>=2){
    // A still thumb or palm already on the table must not turn this touch into a pinch: set it aside until it lifts.
    const grip=this.pointers.size===2&&added.length===1?[...this.pointers.keys()].find(id=>id!==added[0].id&&this.gripFinger(id,now)):undefined;
    if(grip===undefined){this.beginPinch();return true;}
    this.pointers.delete(grip);this.gripping.add(grip);this.pan=null;this.lockedTouch=null;
   }
   const p=[...this.pointers.values()][0],world=this.world(p),locked=this.viewLocked&&!input.pan,group=input.pan?null:this.groupAt(p)??(locked?this.groupNear(p):null);
   this.publishCursor(p);
   if(group&&this.ready&&this.network&&this.networkReady){
    const refusal=this.holdRefusal(group);if(refusal){this.tell(refusal);return true;}
    this.startDrag(group,p,world,now,false);
   }else if(locked)this.lockedTouch={id:p.id,x:p.x,y:p.y};
   else{const v=this.local(p);this.pan={pointer:p.id,x:v.x,y:v.y,cx:this.camera.x,cy:this.camera.y};}
   this.changed();return true;
  }
  if(!this.pointers.size){if(input.type==='move'){const p=input.changed[0]??input.points[0];this.publishCursor(p&&inside(p,this.rect)?p:null);this.changed();}return false;}
  if(input.type==='move'){
   for(const p of input.points)if(this.pointers.has(p.id)){this.pointers.set(p.id,p);const s=this.touchStarts.get(p.id);if(s&&!s.moved&&Math.hypot(p.x-s.x,p.y-s.y)>=DRAG_SLOP)s.moved=true;}
   // The first swipe on a locked table explains why the view stays put.
   const held=this.lockedTouch&&this.pointers.get(this.lockedTouch.id);if(held&&!this.lockTold&&Math.hypot(held.x-this.lockedTouch!.x,held.y-this.lockedTouch!.y)>=DRAG_SLOP*2){this.lockTold=true;this.tell('画面已锁定：双指可移动和缩放，点锁可解开');}
   const a=this.pinch&&this.pointers.get(this.pinch.a),b=this.pinch&&this.pointers.get(this.pinch.b);
   if(this.pinch&&a&&b){const center={x:(a.x+b.x)/2-this.rect.x,y:(a.y+b.y)/2-this.rect.y},z=Math.min(5,Math.max(.08,this.pinch.zoom*Math.hypot(a.x-b.x,a.y-b.y)/this.pinch.distance));this.camera={x:center.x-this.pinch.worldX*z,y:center.y-this.pinch.worldY*z,z};}
   else if(this.pan){const p=this.pointers.get(this.pan.pointer);if(p){const v=this.local(p);this.camera.x=this.pan.cx+v.x-this.pan.x;this.camera.y=this.pan.cy+v.y-this.pan.y;}}
   // The held piece follows its finger after the camera moves, so it stays under that finger.
   if(this.drag){const p=this.pointers.get(this.drag.pointer);if(p&&!this.drag.live&&Math.hypot(p.x-this.drag.sx,p.y-this.drag.sy)>=DRAG_SLOP)this.drag.live=true;if(p&&this.drag.live){const v=this.world(p),dx=this.drag.dx+v.x-this.drag.x,dy=this.drag.dy+v.y-this.drag.y;moveGroup(this.state,this.drag.id,dx,dy);if(!this.drag.local)this.network?.move(this.drag.id,dx,dy);}}
   if(this.drag)this.publishCursor(this.pointers.get(this.drag.pointer)??null);else if(this.pointers.size===1)this.publishCursor([...this.pointers.values()][0]);else this.publishCursor(null);this.changed();return true;
  }
  if(input.type==='up'){
   if(this.drag&&input.changed.some(p=>p.id===this.drag!.pointer)){
    const drag=this.drag,group=this.state.groups.find(g=>g.id===drag.id),tray=this.trayDrag,lift=input.changed.find(p=>p.id===drag.pointer)!;
    // Let go on the tray strip: the group goes back to the spot it was pulled from, without drop assist.
    const back=!!tray&&tray.id===drag.id&&inside(lift,this.trayLayout().r);this.trayDrag=null;this.drag=null;this.releaseDragSurface();
    if(group&&back){moveGroup(this.state,group.id,tray!.ox,tray!.oy);this.commitDrop(group,{serial:drag.serial,live:false,local:drag.local});}else if(group)this.commitDrop(group,drag);
   }
   // A tap on empty table puts the selected piece down (its 「旋转」 button goes away).
   if(this.selected!==null&&!this.pinch&&input.changed.some(p=>(this.pan?.pointer===p.id||this.lockedTouch?.id===p.id)&&this.touchStarts.get(p.id)?.moved===false))this.selected=null;
   const heldPinch=!!this.pinch?.held;for(const p of input.changed){this.pointers.delete(p.id);this.touchStarts.delete(p.id);}this.pan=null;this.pinch=null;this.lockedTouch=null;
   // A pinch begun while holding keeps zooming on two remaining fingers; otherwise one remaining finger pans.
   if(this.pointers.size){const others=[...this.pointers.values()].filter(p=>p.id!==this.drag?.pointer),p=others[0];if(heldPinch&&others.length>=2)this.pinch=this.pinchBetween(others[0],others[1],!!this.drag);else if(p){const v=this.local(p);this.pan={pointer:p.id,x:v.x,y:v.y,cx:this.camera.x,cy:this.camera.y};}}else this.releaseGestureSurface();
   // A release outside the board retains the last valid room position.
   const point=this.drag?this.pointers.get(this.drag.pointer):this.pointers.size===1?[...this.pointers.values()][0]:this.pointers.size===0?input.changed[0]:null;
   this.publishCursor(point&&inside(point,this.rect)?point:null);this.changed();return true;
  }
  return false;
 }
 /** Why this group cannot be picked up right now, or null when it can. */
 private holdRefusal(group:Group){
  if(this.owners[group.id])return `${this.owners[group.id].name} 正在移动这组拼块`;
  if(!this.tilted(group)&&this.network?.canAcquire?.(group.id)===false)return '这组拼块还在确认位置，请稍候';
  return null;
 }
 /** Holds a group under finger p and asks the room for it. A refused claim puts it back where the room has it. */
 private startDrag(group:Group,p:Point,world:{x:number;y:number},now:number,live:boolean){
  // A tilted piece moves on this device only: the room hears of it once it is upright.
  const network=this.network!,serial=++this.serial,local=this.tilted(group);this.drag={id:group.id,pointer:p.id,x:world.x,y:world.y,dx:group.dx,dy:group.dy,serial,sx:p.x,sy:p.y,live,at:now,local};raiseGroup(this.state,group.id);
  if(this.variant?.kind==='wind'&&group.pieces.length===1)this.selected=group.id;
  const settle=this.settleTimers.get(group.id);if(settle){clearTimeout(settle);this.settleTimers.delete(group.id);}
  if(local)return;
  this.mergeLog.hold(group.id,{player:SELF_HOLDER,name:this.selfPlayer?.name??'我',color:this.selfPlayer?.color??'#f08aa6'});
  void network.acquire(group.id).then(ok=>{if(!ok&&this.drag?.serial===serial){this.cancelNetworkDrag(group.id);this.tell('这组拼块没能确认，已恢复服务器位置');}}).catch(()=>{if(this.drag?.serial===serial)this.cancelNetworkDrag(group.id);});
 }
 /** A tray cell dragged past DRAG_SLOP: the group leaves its spot and is held with the cell's piece centred under the finger. */
 private beginTrayDrag(id:number,p:Point){
  const group=this.state.groups.find(g=>g.id===id&&!g.locked);
  if(!group){this.tell('这块刚被拼好，请选择其他碎片');return;}
  if(!this.ready||!this.network||!this.networkReady)return;
  const refusal=this.holdRefusal(group);if(refusal){this.tell(refusal);return;}
  const piece=this.pieces[group.pieces[0]],w=this.board.width/this.state.cols,h=this.board.height/this.state.rows,world=this.world(p),now=Date.now();
  const dx=world.x-this.board.x-(piece.col+.5)*w,dy=world.y-this.board.y-(piece.row+.5)*h;
  this.trayDrag={id:group.id,pointer:p.id,ox:group.dx,oy:group.dy};this.pointers.set(p.id,p);this.touchStarts.set(p.id,{x:p.x,y:p.y,at:now,moved:true});
  moveGroup(this.state,group.id,dx,dy);this.startDrag(group,p,world,now,true);if(!this.drag?.local)this.network.move(group.id,dx,dy);this.publishCursor(p);
 }
 private beginPinch(){
  this.releaseDragSurface();
  this.endDrag();this.pan=null;this.lockedTouch=null;
  const[a,b]=[...this.pointers.values()];this.pinch=this.pinchBetween(a,b,false);this.publishCursor(null);this.changed();
 }
 private pinchBetween(a:Point,b:Point,held:boolean):Pinch{const world=this.world({id:-1,x:(a.x+b.x)/2,y:(a.y+b.y)/2});return{a:a.id,b:b.id,distance:Math.max(1,Math.hypot(a.x-b.x,a.y-b.y)),zoom:this.camera.z,worldX:world.x,worldY:world.y,held};}
 /** Ends the held group. A moved group is dropped where it lies: when the WebView cancels the touch
  * instead of reporting the lift (or a modal, resize or pinch ends it), the piece must not stay drawn
  * on its spot while the room never hears of it. An unmoved group is only released. */
 private endDrag(){const drag=this.drag;if(!drag)return;this.drag=null;this.trayDrag=null;++this.serial;this.mergeLog.release(drag.id,Date.now());const group=this.state.groups.find(g=>g.id===drag.id);if(drag.local){if(drag.live&&group&&!this.destroyed)this.commitDrop(group,drag);return;}if(drag.live&&group&&!this.destroyed)this.commitDrop(group,drag);else{this.network?.release(drag.id);this.queueStrandedCheck();}}
 private commitDrop(group:Group,drag:{serial:number;live:boolean;local?:boolean}){
  // A tilted piece stays where it was put, on this device only.
  if(drag.local||this.tilted(group)){this.keepLocal(group);if(!this.tilted(group))this.queueSettle(group.id,0);return;}
  const network=this.network;if(!network)return;this.mergeLog.release(group.id,Date.now());if(drag.live)this.assistDrop(group);
  // The room must never join a group to a piece it holds somewhere else (a tilted one): such a drop is moved
  // just out of reach. With no such spot nearby nothing is sent, and the group waits on this device.
  const shadows=this.shadowOffsets(group.id);
  if(shadows.size){
   const safe=safeDropOffset(this.state,group.id,group.dx,group.dy,shadows,new Set(Object.keys(this.owners).map(Number)));
   if(!safe){network.release(group.id);this.keepLocal(group);this.queueSettle(group.id,SETTLE_RETRY_MS);return;}
   if(!this.sameOffset(group,safe.dx,safe.dy)){moveGroup(this.state,group.id,safe.dx,safe.dy);this.tell('歪着的碎片要先转正才能拼上');}
  }
  if(this.kept.delete(group.id))this.saveWind();
  this.pendingDrops.set(group.id,drag.serial);this.pendingDropAt.set(group.id,Date.now());
  void network.drop(group.id,group.dx,group.dy).catch(()=>{}).finally(()=>{if(this.pendingDrops.get(group.id)===drag.serial){this.pendingDrops.delete(group.id);this.pendingDropAt.delete(group.id);}this.queueStrandedCheck();});
 }
 /** A loose group left within snap reach of its spot looks placed but never counts (its drop was lost
  * or ignored on the way). Once things are quiet it is dropped on its spot again, at most twice. */
 private queueStrandedCheck(delay=1200){if(this.strandedTimer||this.destroyed)return;this.strandedTimer=setTimeout(()=>{this.strandedTimer=null;void this.settleStranded();},delay);}
 private async settleStranded(){
  const network=this.network;if(this.destroyed||!network||!this.networkReady)return;
  // A drop whose reply never comes must not hold the check back for good.
  const now=Date.now();if(this.drag||[...this.pendingDrops.keys()].some(id=>now-(this.pendingDropAt.get(id)??now)<STRANDED_PENDING_MS)){this.queueStrandedCheck();return;}
  const reach=snapTolerance(this.state),stranded=this.state.groups.filter(g=>!g.locked&&!this.owners[g.id]&&!this.kept.has(g.id)&&!this.tilted(g)&&Math.hypot(g.dx,g.dy)<=reach);
  // Dropped on its spot twice and still not placed: draw the room's own position, so the table never
  // shows a placement the room did not accept (it looked finished at 0 / 12).
  if(stranded.some(g=>(this.strandedTries.get(g.id)??0)>=2&&!this.strandedResynced.has(g.id))){for(const g of stranded)this.strandedResynced.add(g.id);network.resync?.();return;}
  // Collect them all first: the room's reply to the first drop redraws the others from its own state.
  const ids=stranded.filter(g=>(this.strandedTries.get(g.id)??0)<2).map(g=>g.id);let deferred=false;
  for(const id of ids){
   if(this.destroyed||this.drag||this.network!==network)return;
   if(network.canAcquire?.(id)===false){deferred=true;continue;}
   if(dropJoinsShadow(this.state,id,0,0,this.shadowOffsets(id),new Set(Object.keys(this.owners).map(Number))))continue;
   this.strandedTries.set(id,(this.strandedTries.get(id)??0)+1);
   const serial=++this.serial;this.pendingDrops.set(id,serial);this.pendingDropAt.set(id,Date.now());
   try{if(await network.acquire(id)&&!this.destroyed){moveGroup(this.state,id,0,0);this.changed();await network.drop(id,0,0);}else network.release(id);}
   catch{}finally{if(this.pendingDrops.get(id)===serial){this.pendingDrops.delete(id);this.pendingDropAt.delete(id);}}
  }
  // Busy now (a reconnect, a save in progress): look again shortly instead of only after the next drop.
  if(deferred)this.queueStrandedCheck(2400);
 }
 private cancelInput(release:boolean){if(release)this.endDrag();this.rotateTouch=null;this.releaseDragSurface();this.releaseGestureSurface();this.drag=null;this.pan=null;this.pinch=null;this.lockedTouch=null;this.previewTouch=null;this.endTrayTouch();this.trayDrag=null;this.thumbTouch=null;this.pointers.clear();this.touchStarts.clear();this.gripping.clear();this.publishCursor(null);++this.serial;this.changed();}
 cancelNetworkDrag(id?:number,reason?:string){if(id!==undefined&&this.drag?.id!==id)return false;const active=!!this.drag;
  // A tilted piece held on this device only is not the room's to cancel: it stays where it is.
  if(this.drag?.local){const group=this.state.groups.find(g=>g.id===this.drag!.id);this.drag=null;this.trayDrag=null;if(group)this.keepLocal(group);}
  // A group pulled out of the tray springs back to its spot; the room's next state confirms it.
  const tray=this.trayDrag;this.trayDrag=null;if(tray&&tray.id===this.drag?.id)moveGroup(this.state,tray.id,tray.ox,tray.oy);if(this.drag)this.mergeLog.release(this.drag.id,Date.now());this.releaseDragSurface();this.releaseGestureSurface();if(!this.drag||this.pan?.pointer===this.drag.pointer)this.pan=null;this.drag=null;++this.serial;if(reason)this.tell(reason);this.changed();return active;}
 syncRemote(next:PuzzleState,owners:Record<string,Owner>,protectedIds:ReadonlySet<number>,showFeedback=true){
  const before=cloneGroups(this.state.groups),previous=new Map(this.state.groups.map(g=>[g.id,g])),localDrag=this.drag?.local?this.drag.id:null;let keptChanged=false;
  this.roomOffsets=new Map(next.groups.map(g=>[g.id,{dx:g.dx,dy:g.dy}]));
  this.state.groups=next.groups.map(incoming=>{const old=previous.get(incoming.id),group={...incoming,pieces:[...incoming.pieces]};if(old&&!group.locked&&(protectedIds.has(group.id)||group.id===localDrag)){group.dx=old.dx;group.dy=old.dy;}
   else{
    // A kept piece is drawn where the player put it while the room still has it where it was; once the room
    // moves it (整理) or it is no longer a loose single piece, the room's state wins.
    const keep=this.kept.get(group.id);if(keep){if(!group.locked&&group.pieces.length===1&&this.sameOffset(group,keep.bx,keep.by)){group.dx=keep.dx;group.dy=keep.dy;}else{this.kept.delete(group.id);keptChanged=true;}}
   }return group;});
  for(const id of protectedIds)raiseGroup(this.state,id);if(localDrag!==null)raiseGroup(this.state,localDrag);this.state.elapsed=next.elapsed;this.owners=owners;
  this.syncVariant(before,showFeedback&&!this.feedbackHidden,keptChanged);
  this.pruneHints();
  if(showFeedback&&!this.feedbackHidden){const localIds=new Set([...protectedIds,...this.pendingDrops.keys()]);for(const glow of newMobileConnections(before,this.state,localIds))this.addFlash(glow);}
  // Judge a merge by who held its parts before this snapshot, then take the snapshot's holds.
  const now=Date.now(),merges=detectTeamMerges(before,this.state,this.mergeLog.holders,now);this.mergeLog.syncRemote(owners,now,SELF_HOLDER);
  if(merges.length&&showFeedback&&!this.feedbackHidden)this.addTeamBursts(merges.map(m=>({a:m.a,b:m.b,colors:[m.holders[0].color,m.holders[1].color],names:`${m.holders[0].name} × ${m.holders[1].name}`})),now);
  this.changed();this.animateFeedback();
  // A room state that arrives with a loose group on its spot (opened again, or redrawn after a lost drop) is checked too.
  const reach=snapTolerance(this.state);if(this.state.groups.some(g=>!g.locked&&Math.hypot(g.dx,g.dy)<=reach))this.queueStrandedCheck();
 }
 /** Joined or placed pieces regain their colour (fade) or lose any tilt (wind); a finished room forgets its tilts. */
 private syncVariant(before:Group[],feedback:boolean,changed:boolean){
  if(!this.variant)return;const now=Date.now();
  if(this.variant.kind==='fade'){
   const loose=new Set<number>();for(const group of before)if(!group.locked&&group.pieces.length===1)loose.add(group.pieces[0]);
   for(const group of this.state.groups)if(group.locked||group.pieces.length>1)for(const id of group.pieces)if(loose.has(id))this.colorAt.set(id,feedback&&!reducedMotion()?now:now-FADE_IN_MS);
   return;
  }
  for(const group of this.state.groups)if(group.locked||group.pieces.length>1)for(const id of group.pieces)if(this.rot.delete(id)){this.turning.delete(id);changed=true;}
  if(changed||this.state.groups.every(g=>g.locked))this.saveWind();
 }
 private addTeamBursts(merges:{a:number;b:number;colors:[string,string];names:string}[],now:number){
  const reduced=typeof globalThis.matchMedia==='function'&&globalThis.matchMedia('(prefers-reduced-motion: reduce)').matches;
  this.teamBursts=this.teamBursts.filter(burst=>burst.until>now);
  for(const merge of merges){while(this.teamBursts.length>=2)this.teamBursts.shift();this.teamBursts.push({...merge,startedAt:now,until:now+(reduced?TEAM_REDUCED_MS:TEAM_BURST_MS),reduced});}
  if(this.chimeUrl)try{this.platform.playSound?.(this.chimeUrl);}catch{}
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
 setHints(ids:number[],until:number,grantId:string|number=until){
  const active=Number.isFinite(until)&&until>Date.now(),activated=active&&this.hintGrant!==grantId;
  if(!active){this.hintIds=[];this.hintGrant=null;this.hintUntil=0;}
  else{this.hintIds=activated?selectHintPieceIds(this.state,ids,this.owners):selectHintPieceIds(this.state,this.hintIds,this.owners,{topUp:false});this.hintGrant=grantId;this.hintUntil=until;if(activated)this.hintPulseUntil=Math.min(until,Date.now()+HINT_PULSE_MS);
   // A hinted piece lying tilted turns upright first, so the hint points at a piece that can go there.
   if(activated)for(const id of this.hintIds)if(this.drag?.id!==id)this.uprightPiece(id);}
  this.scheduleExpiry();this.changed();this.animateFeedback();return activated;
 }
 private pruneHints(){if(this.hintIds.length)this.hintIds=this.hintUntil>Date.now()?selectHintPieceIds(this.state,this.hintIds,this.owners,{topUp:false}):[];}
 private groupVisible(group:Group){return visibleGroup(group,this.pieces,this.edges)||(this.hintUntil>Date.now()&&group.pieces.some(id=>this.hintIds.includes(id)));}
 /** True while a hint still points at an unplaced piece (lasting hints end this way instead of by time). */
 get hintsShowing(){this.pruneHints();return this.hintUntil>Date.now()&&this.hintIds.length>0;}
 setUnderlay(until:number){this.underlayUntil=until;this.scheduleExpiry();this.changed();}
 /** Highlighting only: reward/advertising eligibility is handled by the caller. */
 hint(ids?:number[],duration=30000){this.setHints(ids??selectHintPieceIds(this.state,[],this.owners,{count:3}),Date.now()+duration);}
 /** Show both ends of every hint, leaving an already visible camera untouched. */
 locateHints(insets:{top?:number;right?:number;bottom?:number;left?:number}={}){
  this.pruneHints();if(!this.hintIds.length||!this.rect.w||!this.rect.h)return false;
  const w=this.board.width/this.state.cols,h=this.board.height/this.state.rows,pad=Math.min(w,h)*.27,cam=this.camera;
  let left=Infinity,top=Infinity,right=-Infinity,bottom=-Infinity,cxMin=Infinity,cyMin=Infinity,cxMax=-Infinity,cyMax=-Infinity;
  for(const id of this.hintIds){const group=this.state.groups.find(g=>g.pieces.includes(id))!,piece=this.pieces[id],x=this.board.x+piece.col*w,y=this.board.y+piece.row*h;
   for(const [dx,dy]of [[0,0],[group.dx,group.dy]]){left=Math.min(left,x+dx-pad);top=Math.min(top,y+dy-pad);right=Math.max(right,x+dx+w+pad);bottom=Math.max(bottom,y+dy+h+pad);cxMin=Math.min(cxMin,x+dx+w/2);cyMin=Math.min(cyMin,y+dy+h/2);cxMax=Math.max(cxMax,x+dx+w/2);cyMax=Math.max(cyMax,y+dy+h/2);}
  }
  const trayBottom=this.tray?this.rect.y+this.rect.h-this.trayLayout().r.y:0,l=Math.max(0,insets.left??0),t=Math.max(0,insets.top??0),vw=Math.max(1,this.rect.w-l-Math.max(0,insets.right??0)),vh=Math.max(1,this.rect.h-t-Math.max(trayBottom,insets.bottom??0)),margin=Math.min(14,vw*.1,vh*.1);
  // Check the actual outline/badge extents, not the optional framing margin.
  // A tiny tolerance prevents another camera change at a fitted boundary.
  if(Math.min(cam.x+left*cam.z-2,cam.x+cxMin*cam.z-11)>=l-.01&&Math.min(cam.y+top*cam.z-2,cam.y+cyMin*cam.z-11)>=t-.01&&Math.max(cam.x+right*cam.z+2,cam.x+cxMax*cam.z+11)<=l+vw+.01&&Math.max(cam.y+bottom*cam.z+2,cam.y+cyMax*cam.z+11)<=t+vh+.01)return false;
  this.cancelInput(true);const z=Math.max(.001,Math.min(cam.z,(vw-2*margin)/(right-left),(vh-2*margin)/(bottom-top)));
  this.camera={x:l+vw/2-(left+right)/2*z,y:t+vh/2-(top+bottom)/2*z,z};this.changed();return true;
 }
 /** Rings every loose piece for a few seconds, including pieces lying on the placed
  * picture. The camera moves only when some of them are outside the given view: it
  * centres on them and zooms out just enough. Returns the number of pieces marked. */
 locateLoose(insets:{top?:number;right?:number;bottom?:number;left?:number}={}){
  const groups=this.state.groups.filter(g=>!g.locked&&g.pieces.length&&visibleGroup(g,this.pieces,this.edges));
  if(!groups.length){this.locateUntil=0;this.locatedMarks=null;this.changed();return 0;}
  this.locatedMarks={ids:groups.map(group=>group.pieces[0]),until:Date.now()+MINIMAP_MARK_MS};
  const w=this.board.width/this.state.cols,h=this.board.height/this.state.rows,pad=Math.min(w,h)*.27,cam=this.camera;let left=Infinity,top=Infinity,right=-Infinity,bottom=-Infinity,count=0;
  for(const group of groups)for(const id of group.pieces){const p=this.pieces[id],x=this.board.x+p.col*w+group.dx,y=this.board.y+p.row*h+group.dy;left=Math.min(left,x-pad);top=Math.min(top,y-pad);right=Math.max(right,x+w+pad);bottom=Math.max(bottom,y+h+pad);count++;}
  const l=Math.max(0,insets.left??0),t=Math.max(0,insets.top??0),vw=Math.max(1,this.rect.w-l-Math.max(0,insets.right??0)),vh=Math.max(1,this.rect.h-t-Math.max(0,insets.bottom??0));
  if(cam.x+left*cam.z<l||cam.y+top*cam.z<t||cam.x+right*cam.z>l+vw||cam.y+bottom*cam.z>t+vh){
   this.cancelInput(true);const bw=right-left,bh=bottom-top,z=Math.max(.08,Math.min(cam.z,vw*.94/bw,vh*.94/bh));
   this.camera={x:l+vw/2-(left+bw/2)*z,y:t+vh/2-(top+bh/2)*z,z};
  }
  const now=Date.now();this.locateStartedAt=now;this.locateUntil=now+LOCATE_MS;this.changed();this.animateFeedback();return count;
 }
 get locating(){return this.locateUntil>Date.now();}
 find(){const group=this.state.groups.find(g=>!g.locked&&!this.owners[g.id]&&visibleGroup(g,this.pieces,this.edges));return group?this.focusMobilePiece(group.pieces[0]):false;}
 /** The tray and its controls (close/prev/next are relative to r). A landscape tray is compact: its page arrows sit in the
  * header row and it has no footer. full=true ignores the strip a drag-out shrinks it to, so what sits above it stays put. */
 private trayLayout(full=false){
  const rect=this.rect,compact=rect.w>rect.h,w=Math.max(1,rect.w-10),inner=Math.max(1,w-16),top=TRAY_HEAD_PX,chrome=top+TRAY_FOOT_PX;
  const columns=compact?Math.max(1,Math.min(16,Math.floor(inner/TRAY_CELL_LANDSCAPE))):Math.max(TRAY_COLUMNS_PORTRAIT,Math.floor(inner/80)),cellW=inner/columns;
  const limit=Math.min(Math.max(1,rect.h-76),Math.max(100,rect.h*(compact?TRAY_HEIGHT_LANDSCAPE:TRAY_HEIGHT_PORTRAIT))),room=Math.max(1,limit-chrome);
  // Portrait keeps 4 rows; landscape takes the row count whose cells come closest to square.
  const rows=Math.max(1,Math.min(compact?3:TRAY_ROWS_PORTRAIT,Math.floor(room/TRAY_ROW_MIN),compact?Math.round(room/cellW):TRAY_ROWS_PORTRAIT));
  const cellH=Math.max(1,Math.min(cellW,room/rows)),tall=chrome+rows*cellH,height=this.trayDrag&&!full?Math.min(tall,TRAY_STRIP_PX):tall;
  const r={x:rect.x+5,y:rect.y+rect.h-height-75,w,h:height},prev={x:4,y:0,w:48,h:top},next={x:92,y:0,w:48,h:top},close={x:w-38,y:0,w:38,h:top};
  const pageSize=Math.max(1,columns*rows),groups=this.trayGroups(),start=this.trayStart(groups,pageSize),page=Math.ceil(start/pageSize),pages=Math.max(1,page+Math.ceil((groups.length-start)/pageSize));
  return{r,top,columns,rows,pageSize,groups,start,page,pages,cellW,cellH,compact,close,prev,next};
 }
 /** Loose visible groups in this room's tray order. Cached until the room state or the edge filter changes. */
 private trayGroups(){
  const key=this.trayKey||'seed:'+this.state.seed,order=this.trayOrder,all=this.state.groups;
  if(order&&order.groups===all&&order.length===all.length&&order.edges===this.edges&&order.key===key&&order.list.every(g=>!g.locked))return order.list;
  const rank=new Map<Group,number>(),list:Group[]=[];
  for(const group of all){if(group.locked||!visibleGroup(group,this.pieces,this.edges))continue;let min=Infinity;for(const id of group.pieces)if(id<min)min=id;rank.set(group,min);list.push(group);}
  const keys=new Map<Group,{rank:number;min:number}>();for(const [group,min]of rank)keys.set(group,{rank:trayHash(key+'|'+min),min});
  list.sort((a,b)=>{const x=keys.get(a)!,y=keys.get(b)!;return x.rank-y.rank||x.min-y.min;});
  for(const [group,k]of keys)rank.set(group,k.rank);
  this.trayOrder={groups:all,length:all.length,edges:this.edges,key,list,rank};return list;
 }
 private trayKeyOf(group:Group){let min=Infinity;for(const id of group.pieces)if(id<min)min=id;return{rank:this.trayOrder?.rank.get(group)??trayHash((this.trayKey||'seed:'+this.state.seed)+'|'+min),min};}
 /** Index of the first group on the current page: the anchor group, or the one that now follows it. */
 private trayStart(list:Group[],pageSize:number){
  const a=this.trayAnchor;if(!a||!list.length)return 0;let i=0;
  while(i<list.length){const k=this.trayKeyOf(list[i]);if(k.rank>a.rank||k.rank===a.rank&&k.min>=a.min)break;i++;}
  return i<list.length?i:Math.max(0,Math.floor((list.length-1)/pageSize)*pageSize);
 }
 /** The tray page number; setting it starts that page at a multiple of the page size. */
 get trayPage(){return this.trayLayout().page;}
 set trayPage(page:number){const v=this.trayLayout(),group=v.groups[Math.max(0,Math.floor(page))*v.pageSize];this.trayAnchor=page>0&&group?this.trayKeyOf(group):null;}
 private turnTrayPage(delta:number){const v=this.trayLayout(),start=Math.max(0,Math.min(v.start+delta*v.pageSize,v.groups.length-1)),group=v.groups[start];this.trayAnchor=start>0&&group?this.trayKeyOf(group):null;}
 /** The open tray's screen rect as drawn now (the strip during a drag-out), or null while it is closed. */
 get trayFrame():Rect|null{return this.tray?this.trayLayout().r:null;}
 /** Screen y where the table stops being visible: the top of an open tray (at full height), else the bottom of the board. */
 private viewBottom(){return this.tray?this.trayLayout(true).r.y:this.rect.y+this.rect.h;}
 private gripFinger(id:number,now:number){const s=this.touchStarts.get(id),r=this.rect;if(!s||s.moved)return false;return now-s.at>=GRIP_MS||s.x-r.x<=GRIP_EDGE_PX||r.x+r.w-s.x<=GRIP_EDGE_PX||r.y+r.h-s.y<=GRIP_EDGE_PX;}
 /** A locked table forgives a near miss: the touch picks up a loose piece within a fingertip of it. */
 private groupNear(p:Point){for(const r of [6,12,18])for(let i=0;i<8;i++){const a=i*Math.PI/4,group=this.groupAt({id:p.id,x:p.x+Math.cos(a)*r,y:p.y+Math.sin(a)*r});if(group)return group;}return null;}
 /** The 原图 thumbnail in the top-right corner: its picture size, top and right edge. Above an open tray it shrinks to fit;
  * when it would start below the corner tool toggle and not fit there, it moves up beside the toggle instead. Null: no room. */
 private thumbLayout(){
  const r=this.rect,ratio=this.board.height/this.board.width;let w=Math.min(r.w*.35,150),h=w*ratio,inset=this.previewThumbInset??this.previewTopInset,shift=0;
  if(this.tray){
   const bottom=this.viewBottom()-r.y-8;if(this.previewThumbInset!==null&&Math.max(6,inset)+Math.min(h,48)+6>bottom){inset=this.previewTopInset;shift=THUMB_TOGGLE_PX;}
   const room=bottom-Math.max(6,inset)-6;if(h>room){h=Math.max(0,room);w=h/ratio;}if(h<30)return null;
  }
  return{w,h,top:r.y+Math.max(6,Math.min(inset,r.h-h-12)),right:r.x+r.w-6-shift};
 }
 /** The large reference fills the table below any floating header; the picture is fitted inside a margin. */
 private previewLayout(){
  const r=this.rect,top=r.y+Math.max(12,Math.min(this.previewTopInset,r.h*.4)),area={x:r.x+12,y:top+40,w:r.w-24,h:r.y+r.h-top-40-34},scale=Math.max(.01,Math.min(area.w/this.board.width,area.h/this.board.height)),w=this.board.width*scale,h=this.board.height*scale;
  return{area,close:{x:r.x+r.w-50,y:top,w:38,h:38},fit:{x:area.x+(area.w-w)/2,y:area.y+(area.h-h)/2,w,h}};
 }
 private previewImageRect(){const {fit}=this.previewLayout(),v=this.previewView,w=fit.w*v.z,h=fit.h*v.z;return{x:fit.x+fit.w/2+v.x-w/2,y:fit.y+fit.h/2+v.y-h/2,w,h};}
 /** Keeps a zoomed reference covering its area; a fitted one stays centred. */
 private clampPreview(view:PreviewView):PreviewView{const {area,fit}=this.previewLayout(),z=Math.min(PREVIEW_MAX_ZOOM,Math.max(1,view.z)),mx=Math.max(0,(fit.w*z-area.w)/2),my=Math.max(0,(fit.h*z-area.h)/2);return{z,x:Math.min(mx,Math.max(-mx,view.x)),y:Math.min(my,Math.max(-my,view.y))};}
 /** Zooms the reference about a screen point, keeping that spot of the picture under it. */
 private zoomPreviewAt(from:PreviewView,anchor:{x:number;y:number},target:{x:number;y:number},z:number){const {fit}=this.previewLayout(),cx=fit.x+fit.w/2,cy=fit.y+fit.h/2,next=Math.min(PREVIEW_MAX_ZOOM,Math.max(1,z)),k=next/from.z;return this.clampPreview({z:next,x:target.x-cx-(anchor.x-cx-from.x)*k,y:target.y-cy-(anchor.y-cy-from.y)*k});}
 private previewInput(input:Input){
  if(input.type==='key')return false;
  if(!this.previewLarge){
   // A tap on the corner thumbnail opens the large reference when the finger lifts. A finger that moves
   // first was reaching for the table underneath: replay its landing there and let the move continue.
   const t=this.thumbTouch;
   if(t){
    if(input.type==='cancel'){this.thumbTouch=null;return false;}
    const p=input.changed.find(q=>q.id===t.id)??input.points.find(q=>q.id===t.id);
    if(input.type==='up'&&input.changed.some(q=>q.id===t.id)){this.thumbTouch=null;if(p&&!this.pointers.size&&this.previewThumb&&inside(p,this.previewThumb))this.openPreviewZoom();return !this.pointers.size;}
    if(input.type==='move'&&p&&Math.hypot(p.x-t.x,p.y-t.y)>=DRAG_SLOP){
     this.thumbTouch=null;const origin={id:t.id,x:t.x,y:t.y};this.thumbHandoff=true;
     try{this.input({type:'down',points:[origin],changed:[origin]});}finally{this.thumbHandoff=false;}return false;
    }
    return input.type==='move'&&!this.pointers.size;
   }
   if(this.thumbHandoff||input.type!=='down'||this.pointers.size||this.trayTouch||!this.preview||!this.previewThumb)return false;
   const p=input.changed[0];if(!p||!inside(p,this.previewThumb))return false;this.thumbTouch={id:p.id,x:p.x,y:p.y};return true;
  }
  if(input.type==='wheel'){const p=input.changed[0],delta=input.deltaY??0;if(!p||!Number.isFinite(delta)||delta===0)return true;this.previewView=this.zoomPreviewAt(this.previewView,p,p,this.previewView.z*Math.exp(-Math.max(-1000,Math.min(1000,delta))*.0018));this.changed();return true;}
  if(input.type==='cancel'){this.previewTouch=null;return true;}
  const rebase=(t:PreviewTouch)=>{t.start=new Map(t.points);t.view={...this.previewView};};
  if(input.type==='down'){
   const t=this.previewTouch??(this.previewTouch={points:new Map(),start:new Map(),view:{...this.previewView},moved:false});
   for(const p of input.changed)t.points.set(p.id,p);if(t.points.size>1)t.moved=true;rebase(t);return true;
  }
  const t=this.previewTouch;if(!t)return true;
  if(input.type==='move'){
   for(const p of input.points)if(t.points.has(p.id))t.points.set(p.id,p);
   const ids=[...t.start.keys()].filter(id=>t.points.has(id)).slice(0,2);
   if(ids.length===2){const [a0,b0]=ids.map(id=>t.start.get(id)!),[a,b]=ids.map(id=>t.points.get(id)!),mid0={x:(a0.x+b0.x)/2,y:(a0.y+b0.y)/2},mid={x:(a.x+b.x)/2,y:(a.y+b.y)/2};
    this.previewView=this.zoomPreviewAt(t.view,mid0,mid,t.view.z*Math.hypot(a.x-b.x,a.y-b.y)/Math.max(1,Math.hypot(a0.x-b0.x,a0.y-b0.y)));}
   else if(ids.length===1){const s0=t.start.get(ids[0])!,p=t.points.get(ids[0])!;if(Math.hypot(p.x-s0.x,p.y-s0.y)>=DRAG_SLOP)t.moved=true;if(t.moved)this.previewView=this.clampPreview({...t.view,x:t.view.x+p.x-s0.x,y:t.view.y+p.y-s0.y});}
   this.changed();return true;
  }
  if(input.type==='up'){
   for(const p of input.changed)t.points.delete(p.id);
   if(t.points.size){rebase(t);return true;}
   this.previewTouch=null;const p=input.changed[0];if(t.moved||!p)return true;
   const {close}=this.previewLayout(),image=this.previewImageRect();
   if(inside(p,close)||!inside(p,image)){this.closePreviewZoom();return true;}
   // Double tap zooms in on that spot, or back out to the whole picture.
   const now=Date.now(),last=this.previewTap;
   if(last&&now-last.at<=PREVIEW_DOUBLE_TAP_MS&&Math.hypot(p.x-last.x,p.y-last.y)<30){this.previewTap=null;this.previewView=this.previewView.z>1.2?{z:1,x:0,y:0}:this.zoomPreviewAt(this.previewView,p,p,3);}
   else this.previewTap={at:now,x:p.x,y:p.y};
   this.changed();return true;
  }
  return true;
 }
 /** The table area the corner map shows: the board and every piece, clamped to the world.
  * It only grows, so the map never rescales while pieces are gathered in. */
 private minimapBounds(){
  const b=this.board,w=b.width/this.state.cols,h=b.height/this.state.rows,pad=Math.min(w,h)*.6,world=worldFor(this.state);
  let x0=b.x-pad,y0=b.y-pad,x1=b.x+b.width+pad,y1=b.y+b.height+pad;
  for(const group of this.state.groups)for(const id of group.pieces){const p=this.pieces[id],x=b.x+p.col*w+group.dx,y=b.y+p.row*h+group.dy;x0=Math.min(x0,x-pad);y0=Math.min(y0,y-pad);x1=Math.max(x1,x+w+pad);y1=Math.max(y1,y+h+pad);}
  const old=this.minimapWorld;if(old){x0=Math.min(x0,old.x0);y0=Math.min(y0,old.y0);x1=Math.max(x1,old.x1);y1=Math.max(y1,old.y1);}
  x0=Math.max(world.x,x0);y0=Math.max(world.y,y0);x1=Math.max(x0+1,Math.min(world.x+world.width,x1));y1=Math.max(y0+1,Math.min(world.y+world.height,y1));
  return this.minimapWorld={x0,y0,x1,y1};
 }
 /** Top-left on phones, opposite the 原图 thumbnail, and only while the view no longer holds the whole table. */
 private minimapLayout():MinimapLayout|null{
  const r=this.rect,cam=this.camera;
  if(!this.minimapEnabled||!this.ready||this.previewLarge||this.completionReveal>0||r.w<160||r.h<160||this.state.groups.every(g=>g.locked))return null;
  // An open tray covers the bottom of the table: the view, and the room for the map, end at its top.
  const bottom=this.viewBottom()-r.y,m=this.minimapBounds(),slack=Math.min(m.x1-m.x0,m.y1-m.y0)*.03,vx0=-cam.x/cam.z,vy0=-cam.y/cam.z,vx1=(r.w-cam.x)/cam.z,vy1=(bottom-cam.y)/cam.z;
  if(this.minimapTouch===null&&vx0<=m.x0+slack&&vy0<=m.y0+slack&&vx1>=m.x1-slack&&vy1>=m.y1-slack)return null;
  const room=this.tray?bottom-Math.max(6,this.previewTopInset)-14:Infinity;if(room<34)return null;
  const maxW=Math.min(r.w*.34,this.phoneLandscapeRoom?134:120),maxH=Math.min(r.h*.3,this.phoneLandscapeRoom?96:100,room),scale=Math.min(maxW/(m.x1-m.x0),maxH/(m.y1-m.y0)),w=(m.x1-m.x0)*scale,h=(m.y1-m.y0)*scale,top=r.y+Math.max(6,Math.min(this.previewTopInset,r.h-h-14));
  return{frame:{x:r.x+12,y:top,w:w+6,h:h+6},inner:{x:r.x+15,y:top+3,w,h},x:m.x0,y:m.y0,scale};
 }
 /** Table artwork for the map. While pieces move it is redrawn at most every MINIMAP_REDRAW_MS. */
 private minimapPicture(ctx:CanvasRenderingContext2D,m:MinimapLayout,now:number){
  const t=typeof ctx.getTransform==='function'?ctx.getTransform():null,density=Math.max(1,Math.min(3,t?Math.abs(t.a):1)),width=Math.max(1,Math.round(m.inner.w*density)),height=Math.max(1,Math.round(m.inner.h*density));
  let sum=0;for(const g of this.state.groups)sum=(sum*31+g.id*7+(g.locked?1:0)+Math.round(g.dx)*3+Math.round(g.dy)*5+g.pieces.length)%2147483647;
  const key=[width,height,m.x,m.y,m.scale,this.edges?1:0,this.currentTheme,this.state.groups.length,sum,this.variantKey(),this.variantAnimating(now)?Math.floor(now/MINIMAP_REDRAW_MS):''].join('|'),cache=this.minimapCache;
  if(cache&&cache.key===key)return cache.canvas;
  if(cache&&now-cache.at<MINIMAP_REDRAW_MS){if(!this.minimapTimer)this.minimapTimer=setTimeout(()=>{this.minimapTimer=null;this.changed();},MINIMAP_REDRAW_MS);return cache.canvas;}
  const canvas=cache?.canvas??this.platform.createCanvas();canvas.width=width;canvas.height=height;const c=canvas.getContext('2d');if(!c)return null;
  const colors=boardThemeColors(this.currentTheme),b=this.board,s=m.scale*width/m.inner.w;
  c.setTransform(1,0,0,1,0,0);c.fillStyle=this.phoneLandscapeRoom?landscapeRoomColors.table:colors.paper;c.fillRect(0,0,width,height);
  c.setTransform(s,0,0,s,-m.x*s,-m.y*s);c.fillStyle=colors.target;c.fillRect(b.x-9,b.y-9,b.width+18,b.height+18);c.strokeStyle=colors.targetLine;c.lineWidth=1.5/s;c.strokeRect(b.x-9,b.y-9,b.width+18,b.height+18);
  this.drawPieceGroups(c,now,undefined,undefined,'pieces',{rect:{x:0,y:0,w:width,h:height},camera:{x:-m.x*s,y:-m.y*s,z:s}});
  this.minimapCache={canvas,key,at:now};return canvas;
 }
 /** Pieces found by 定位 keep a ring on the map until they are picked up or placed, or MINIMAP_MARK_MS passes. */
 private minimapMarks(now:number){
  const marks=this.locatedMarks;if(!marks)return[];if(marks.until<=now){this.locatedMarks=null;return[];}
  const w=this.board.width/this.state.cols,h=this.board.height/this.state.rows,groupOf=new Map<number,Group>(),points:{x:number;y:number}[]=[];
  for(const group of this.state.groups)for(const id of group.pieces)groupOf.set(id,group);
  marks.ids=marks.ids.filter(id=>{const group=groupOf.get(id);if(!group||group.locked||this.owners[group.id]||this.drag?.id===group.id)return false;const p=this.pieces[id];points.push({x:this.board.x+(p.col+.5)*w+group.dx,y:this.board.y+(p.row+.5)*h+group.dy});return true;});
  if(!marks.ids.length)this.locatedMarks=null;return points;
 }
 private drawMinimap(ctx:CanvasRenderingContext2D,now:number){
  const m=this.minimap=this.minimapLayout();if(!m)return;
  const {frame:f,inner:i}=m,colors=boardThemeColors(this.currentTheme),cam=this.camera,r=this.rect,map=this.minimapPicture(ctx,m,now),at=(x:number,y:number)=>({x:i.x+(x-m.x)*m.scale,y:i.y+(y-m.y)*m.scale});
  ctx.save();ctx.fillStyle=colors.preview;ctx.fillRect(f.x,f.y,f.w,f.h);if(map)ctx.drawImage(map,i.x,i.y,i.w,i.h);
  ctx.beginPath();ctx.rect(i.x,i.y,i.w,i.h);ctx.clip();
  // The current view stays clear and framed; the rest of the table is dimmed a little.
  const v=at(-cam.x/cam.z,-cam.y/cam.z),vw=Math.max(6,r.w/cam.z*m.scale),vh=Math.max(6,(this.viewBottom()-r.y)/cam.z*m.scale),l=Math.min(i.x+i.w,Math.max(i.x,v.x)),t=Math.min(i.y+i.h,Math.max(i.y,v.y)),rr=Math.min(i.x+i.w,Math.max(l,v.x+vw)),bb=Math.min(i.y+i.h,Math.max(t,v.y+vh));
  ctx.fillStyle='rgba(60,40,34,.22)';ctx.fillRect(i.x,i.y,i.w,t-i.y);ctx.fillRect(i.x,bb,i.w,i.y+i.h-bb);ctx.fillRect(i.x,t,l-i.x,bb-t);ctx.fillRect(rr,t,i.x+i.w-rr,bb-t);
  // Rings follow the piece size on the map so many marks do not bury it; the view frame is drawn over them.
  const marks=this.minimapMarks(now);if(marks.length){const ring=Math.max(2.5,Math.min(5,Math.min(this.board.width/this.state.cols,this.board.height/this.state.rows)*m.scale*.6)),line=ring/5;ctx.beginPath();for(const mark of marks){const p=at(mark.x,mark.y);ctx.moveTo(p.x+ring,p.y);ctx.arc(p.x,p.y,ring,0,Math.PI*2);}ctx.strokeStyle='#3d1d0cb3';ctx.lineWidth=3.2*line;ctx.stroke();ctx.strokeStyle='#ffd447';ctx.lineWidth=1.8*line;ctx.stroke();}
  ctx.strokeStyle='#8c3b4f';ctx.lineWidth=2;ctx.strokeRect(v.x,v.y,vw,vh);ctx.strokeStyle='rgba(255,255,255,.75)';ctx.lineWidth=1;ctx.strokeRect(v.x+2,v.y+2,vw-4,vh-4);
  for(const cursor of this.cursors.values()){const p=at(cursor.x,cursor.y);ctx.beginPath();ctx.arc(p.x,p.y,3.5,0,Math.PI*2);ctx.fillStyle=cursor.value.color;ctx.fill();ctx.strokeStyle='#ffffff';ctx.lineWidth=1.2;ctx.stroke();}
  ctx.restore();ctx.strokeStyle=colors.previewLine;ctx.lineWidth=1;ctx.strokeRect(f.x+.5,f.y+.5,f.w-1,f.h-1);
 }
 /** A finger that lands on the map moves the view there, keeping the zoom, and the view follows it until it lifts. */
 private minimapInput(input:Input){
  if(input.type==='key'||input.type==='wheel')return false;
  const touch=this.minimapTouch;
  if(touch===null){
   if(input.type!=='down'||this.pointers.size||this.trayTouch||!this.minimap)return false;
   const p=input.changed[0];if(!p||!inside(p,this.minimap.frame))return false;
   this.minimapTouch=p.id;this.minimapJump(p);return true;
  }
  if(input.type==='move'){const p=input.points.find(point=>point.id===touch);if(p)this.minimapJump(p);return true;}
  if(input.type==='cancel'||input.type==='up'&&input.changed.some(point=>point.id===touch)){this.minimapTouch=null;this.changed();}
  return true;
 }
 private minimapJump(p:Point){
  const m=this.minimap;if(!m)return;const i=m.inner,x=m.x+(Math.min(i.x+i.w,Math.max(i.x,p.x))-i.x)/m.scale,y=m.y+(Math.min(i.y+i.h,Math.max(i.y,p.y))-i.y)/m.scale,z=this.camera.z;
  this.camera={x:this.rect.w/2-x*z,y:(this.viewBottom()-this.rect.y)/2-y*z,z};this.changed();
 }
 private drawPreviewZoom(ctx:CanvasRenderingContext2D){
  const r=this.rect,{area,close}=this.previewLayout(),image=this.previewImageRect();
  ctx.save();ctx.beginPath();ctx.rect(r.x,r.y,r.w,r.h);ctx.clip();ctx.fillStyle='rgba(28,22,18,.82)';ctx.fillRect(r.x,r.y,r.w,r.h);
  ctx.save();ctx.beginPath();ctx.rect(area.x,area.y,area.w,area.h);ctx.clip();ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality='high';ctx.drawImage(this.picture,image.x,image.y,image.w,image.h);ctx.restore();
  ctx.strokeStyle='rgba(255,248,236,.5)';ctx.lineWidth=1;ctx.strokeRect(Math.max(area.x,image.x)+.5,Math.max(area.y,image.y)+.5,Math.min(area.x+area.w,image.x+image.w)-Math.max(area.x,image.x)-1,Math.min(area.y+area.h,image.y+image.h)-Math.max(area.y,image.y)-1);
  ctx.textBaseline='top';ctx.fillStyle='#fff8ec';ctx.font='bold 15px sans-serif';ctx.fillText('原图',r.x+16,close.y+10);
  ctx.font='12px sans-serif';ctx.fillStyle='rgba(255,248,236,.78)';const tip=this.previewView.z>1.01?'双指缩放 · 拖动查看 · 双击还原':'双指或双击放大 · 点空白处关闭',tw=ctx.measureText(tip).width;ctx.fillText(tip,r.x+(r.w-tw)/2,area.y+area.h+11);
  ctx.fillStyle='rgba(255,248,236,.94)';ctx.beginPath();ctx.arc(close.x+close.w/2,close.y+close.h/2,close.w/2,0,Math.PI*2);ctx.fill();ctx.strokeStyle='#5b4337';ctx.lineWidth=2.4;ctx.lineCap='round';ctx.beginPath();const cx=close.x+close.w/2,cy=close.y+close.h/2;ctx.moveTo(cx-6,cy-6);ctx.lineTo(cx+6,cy+6);ctx.moveTo(cx+6,cy-6);ctx.lineTo(cx-6,cy+6);ctx.stroke();
  ctx.restore();
 }
 private trayInput(input:Input){
  if(this.trayTouch){const touch=this.trayTouch,p=input.changed.find(p=>p.id===touch.id)||input.points.find(p=>p.id===touch.id),moved=p?Math.hypot(p.x-touch.x,p.y-touch.y):0;if(input.type==='cancel'){this.endTrayTouch();return true;}
   // Another finger means a pinch or a grip, never a long press.
   if(input.type==='down'&&input.changed.some(q=>q.id!==touch.id))this.stopTrayLift(touch);
   // A finger that slides off a cell, or moves at all once a long press lifted it, pulls that group out onto the table.
   if(input.type==='move'&&p&&touch.group!==undefined&&(moved>=DRAG_SLOP||touch.lifted&&moved>0)){this.endTrayTouch();this.beginTrayDrag(touch.group,p);this.changed();return true;}
   if(moved>9){touch.action=null;this.stopTrayLift(touch);}if(input.type==='up'&&input.changed.some(p=>p.id===touch.id)){this.endTrayTouch();touch.action?.();this.changed();}return true;}
  if(!this.tray||input.type!=='down'||this.pointers.size)return false;const p=input.changed[0],v=this.trayLayout();if(!p)return false;
  const reach=(b:Rect)=>!this.trayDrag&&inside(p,{x:v.r.x+b.x,y:v.r.y+b.y-TRAY_PAGER_REACH,w:b.w,h:b.h+TRAY_PAGER_REACH});if(!inside(p,v.r)&&!reach(v.prev)&&!reach(v.next))return false;
  let action:(()=>void)|null=null,drag:number|undefined;const lx=p.x-v.r.x,ly=p.y-v.r.y,on=(b:Rect)=>lx>=b.x&&lx<=b.x+b.w&&ly>=b.y-(b===v.close?0:TRAY_PAGER_REACH)&&ly<=b.y+b.h;
  if(on(v.close))action=()=>{this.trayOpen=false;};
  else if(on(v.next)){if(v.page<v.pages-1)action=()=>{this.turnTrayPage(1);};}
  else if(on(v.prev)){if(v.start>0)action=()=>{this.turnTrayPage(-1);};}
  else if(ly>=v.top&&ly<v.top+v.rows*v.cellH){const col=Math.floor((lx-8)/v.cellW),row=Math.floor((ly-v.top)/v.cellH);if(col>=0&&col<v.columns&&row>=0&&row<v.rows){const group=v.groups[v.start+row*v.columns+col];
   // A group another player holds can still be located, but not pulled out.
   if(group&&this.owners[group.id]){this.tell(`${this.owners[group.id].name} 正在移动这组拼块`);action=()=>{this.focusMobilePiece(group.pieces[0]);};}
   else if(group){drag=group.id;action=()=>{if(this.variant?.kind==='wind'&&group.pieces.length===1)this.selected=group.id;if(this.focusMobilePiece(group.pieces[0])){this.locatedMarks={ids:[group.pieces[0]],until:Date.now()+MINIMAP_MARK_MS};this.tell('已定位，直接拖动画布中的拼块');}else this.tell('这块刚被拼好，请选择其他碎片');};}}}
  const touch:NonNullable<PuzzleBoard['trayTouch']>=this.trayTouch={id:p.id,x:p.x,y:p.y,action,group:drag};
  // Held still: the group lifts (the cell pops) and the lift replaces the tap's locate.
  if(drag!==undefined)touch.lift=setTimeout(()=>{touch.lift=null;if(this.trayTouch!==touch||this.destroyed)return;touch.lifted=true;touch.action=null;this.changed();},TRAY_LIFT_MS);
  return true;
 }
 private stopTrayLift(touch:NonNullable<PuzzleBoard['trayTouch']>){if(touch.lift)clearTimeout(touch.lift);touch.lift=null;}
 private endTrayTouch(){const touch=this.trayTouch;if(touch)this.stopTrayLift(touch);this.trayTouch=null;}
 private drawTray(ctx:CanvasRenderingContext2D){this.trayDraws++;const v=this.trayLayout(),r=v.r,colors=boardThemeColors(this.currentTheme),now=Date.now(),transform=typeof ctx.getTransform==='function'?ctx.getTransform():null,density=Math.max(1,Math.min(3,transform?Math.abs(transform.a):1));ctx.save();ctx.beginPath();ctx.rect(r.x,r.y,r.w,r.h);ctx.clip();
  const tray=this.trayDrag,held=tray&&this.pointers.get(tray.pointer);ctx.fillStyle=held&&inside(held,r)?colors.traySelected:colors.tray;ctx.fillRect(r.x,r.y,r.w,r.h);ctx.strokeStyle=colors.trayLine;ctx.lineWidth=1;ctx.strokeRect(r.x+.5,r.y+.5,r.w-1,r.h-1);ctx.textBaseline='top';
  if(tray){const text='放回这里 = 回到原位';ctx.font='bold 12px sans-serif';ctx.fillStyle=colors.trayInk;ctx.fillText(text,r.x+(r.w-ctx.measureText(text).width)/2,r.y+(r.h-12)/2);ctx.restore();return;}
  ctx.font='11px sans-serif';ctx.fillStyle=colors.trayMuted;const hint='点选定位 · 拖出放置';ctx.fillText(hint,r.x+v.close.x-4-ctx.measureText(hint).width,r.y+v.top/2-6);ctx.font='18px sans-serif';ctx.fillText('×',r.x+r.w-25,r.y+v.top/2-10);
  const visible=v.groups.slice(v.start,v.start+v.pageSize);for(let index=0;index<visible.length;index++){const group=visible[index],id=group.pieces[0],x=r.x+8+index%v.columns*v.cellW,y=r.y+v.top+Math.floor(index/v.columns)*v.cellH,cw=v.cellW-5,ch=v.cellH-5;const lifted=!!this.trayTouch?.lifted&&this.trayTouch.group===group.id;
   // Pieces lie straight on the tray. A soft spot behind one marks it lifted by a long press or just located.
   if(lifted||group.pieces.includes(this.focusedPiece??-1)){ctx.fillStyle=colors.traySelected;ctx.beginPath();ctx.arc(x+cw/2,y+ch/2,Math.min(cw,ch)*.52,0,Math.PI*2);ctx.fill();}
   ctx.globalAlpha=this.owners[group.id]?.35:1;if(this.atlas){const pw=this.board.width/this.state.cols,ph=this.board.height/this.state.rows,m=Math.min(pw,ph)*TRAY_TAB_MARGIN,fit=Math.min(cw*TRAY_PIECE_FILL/(pw+2*m),Math.max(ch,v.cellH+2*TRAY_ROW_POKE)*TRAY_PIECE_FILL/(ph+2*m),TRAY_SOURCE_ZOOM*this.picture.width/this.board.width/density)*(lifted?1.06:1),dw=(pw+2*m)*fit,dh=(ph+2*m)*fit,angle=group.pieces.length===1?this.angleOf(id,now):0;
   // The tray shows a piece as it lies: grey while faded (from the faded atlas), turned while tilted; otherwise sharp at the screen's pixel size.
   const faded=!!this.grayAtlas&&this.fadeOf(group,id,now)>=.5,tile=faded?null:this.trayTile(id,Math.ceil(dw*density)),source=tile??(faded?this.grayAtlas!:this.atlas),s=tile?{x:0,y:0,w:tile.width,h:tile.height}:this.trayPieceSource(id);
   if(angle){ctx.save();ctx.translate(x+cw/2,y+ch/2);ctx.rotate(angle*Math.PI/180);ctx.drawImage(source,s.x,s.y,s.w,s.h,-dw/2,-dh/2,dw,dh);ctx.restore();}
   else ctx.drawImage(source,s.x,s.y,s.w,s.h,x+(cw-dw)/2,y+(ch-dh)/2,dw,dh);}ctx.globalAlpha=1;if(group.pieces.length>1){ctx.fillStyle=colors.trayCountInk;ctx.font='10px sans-serif';ctx.fillText('×'+group.pieces.length,x+2,y+ch-11);}}
  if(!v.groups.length){ctx.font='12px sans-serif';ctx.fillStyle=colors.trayMuted;const done='所有拼块都已归位';ctx.fillText(done,r.x+(r.w-ctx.measureText(done).width)/2,r.y+v.top+(v.rows*v.cellH)/2-6);}
  const py=r.y+v.prev.y;ctx.font='16px sans-serif';ctx.fillStyle=v.start>0?colors.trayInk:colors.trayDisabled;ctx.fillText('‹',r.x+v.prev.x+19,py+v.prev.h/2-8);ctx.font='11px sans-serif';ctx.fillStyle=colors.trayInk;const label=`${v.page+1}/${v.pages}`;ctx.fillText(label,r.x+(v.prev.x+v.prev.w+v.next.x-ctx.measureText(label).width)/2,py+v.prev.h/2-6);ctx.font='16px sans-serif';ctx.fillStyle=v.page<v.pages-1?colors.trayInk:colors.trayDisabled;ctx.fillText('›',r.x+v.next.x+19,py+v.next.h/2-8);ctx.restore();
 }
 /** The atlas area of one piece with its tabs: the tile without the shadow margin around them. */
 private trayPieceSource(id:number){
  const t=this.tile,w=this.board.width/this.state.cols,h=this.board.height/this.state.rows,m=Math.min(w,h)*TRAY_TAB_MARGIN,inset=Math.max(0,t.pad-m)*t.scale;
  return{x:(id%t.columns)*t.w+inset,y:Math.floor(id/t.columns)*t.h+inset,w:Math.max(1,t.w-2*inset),h:Math.max(1,t.h-2*inset)};
 }
 private scheduleExpiry(){if(this.timer)clearTimeout(this.timer);const next=[this.hintUntil,this.underlayUntil].filter(t=>t>Date.now()).sort((a,b)=>a-b)[0];if(next&&next-Date.now()<MAX_TIMER_MS)this.timer=setTimeout(()=>{this.changed();this.scheduleExpiry();},Math.max(1,next-Date.now()+1));}
 /** Only transient feedback owns a continuing animation loop. The last tick
  * also invalidates, erasing expired flashes before the room goes idle. */
 private animateFeedback(){
  const moving=[...this.cursors.values()].some(c=>Math.hypot(c.x-c.value.x,c.y-c.value.y)>.08);
  if(this.frame||this.destroyed||this.feedbackHidden)return;
  if(!this.flashes.length&&!this.teamBursts.length&&!moving&&this.locateUntil<=Date.now()&&!(this.hintIds.length&&Math.min(this.hintUntil,this.hintPulseUntil)>Date.now())&&!this.variantAnimating(Date.now())){this.frameAt=null;return;}
  const queuedAt=Date.now();
  this.frame=this.platform.frame(timestamp=>{
   this.frame=0;if(this.destroyed||this.feedbackHidden)return;
   // Interpolate only toward the newest authoritative point. Elapsed frame
   // time controls the curve; hidden time never becomes movement or prediction.
   const now=Date.now(),hasTimestamp=Number.isFinite(timestamp),tick=hasTimestamp?timestamp:now,elapsed=this.frameAt===null?now-queuedAt:tick-this.frameAt,dt=Math.max(0,elapsed)||(!hasTimestamp?16:0),amount=1-Math.exp(-dt/CURSOR_SMOOTHING_MS);this.frameAt=tick;this.flashes=this.flashes.filter(f=>f.until>now);if(this.teamBursts.length&&this.teamBursts[0].until<=now)this.teamBursts=this.teamBursts.filter(f=>f.until>now);
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
 /** Dark halo plus a bright line around every loose piece, drawn above everything so a
  * piece resting on the finished area stands out. Too small on screen, each group also
  * gets a screen-sized ring. One path for all pieces keeps a 500-piece table cheap. */
 private drawLocateGlow(ctx:CanvasRenderingContext2D,now:number){
  if(this.locateUntil<=now||this.completionReveal>0)return;
  const {board:b,camera:cam,rect:r}=this,w=b.width/this.state.cols,h=b.height/this.state.rows,elapsed=now-this.locateStartedAt;
  const pulse=.5+.5*Math.cos(elapsed/LOCATE_PULSE_MS*Math.PI*2),alpha=Math.max(0,Math.min(1,elapsed/120,(this.locateUntil-now)/450))*(.5+.5*pulse);
  const x0=-cam.x/cam.z,y0=-cam.y/cam.z,x1=(r.w-cam.x)/cam.z,y1=(r.h-cam.y)/cam.z,small=Math.min(w,h)*cam.z<26,rings:{x:number;y:number}[]=[];
  ctx.save();ctx.beginPath();
  for(const group of this.state.groups){if(group.locked||!visibleGroup(group,this.pieces,this.edges))continue;let gx=0,gy=0;
   for(const id of group.pieces){const p=this.pieces[id],x=b.x+p.col*w+group.dx,y=b.y+p.row*h+group.dy;gx+=x+w/2;gy+=y+h/2;if(x+w<x0||x>x1||y+h<y0||y>y1)continue;appendTurnedPath(ctx,this.paths[id],x,y,group.pieces.length===1?this.angleOf(id,now):0,w/2,h/2);}
   if(small&&group.pieces.length)rings.push({x:gx/group.pieces.length,y:gy/group.pieces.length});}
  ctx.lineJoin='round';ctx.globalAlpha=alpha;ctx.strokeStyle='#3d1d0cb3';ctx.lineWidth=(4.5+2.5*pulse)/cam.z;ctx.stroke();ctx.strokeStyle='#ffd447';ctx.lineWidth=2.2/cam.z;ctx.stroke();
  if(rings.length){const radius=(13+7*(1-pulse))/cam.z;ctx.beginPath();for(const ring of rings){if(ring.x+radius<x0||ring.x-radius>x1||ring.y+radius<y0||ring.y-radius>y1)continue;ctx.moveTo(ring.x+radius,ring.y);ctx.arc(ring.x,ring.y,radius,0,Math.PI*2);}
   ctx.strokeStyle='#3d1d0c99';ctx.lineWidth=4/cam.z;ctx.stroke();ctx.strokeStyle='#ffd447';ctx.lineWidth=2/cam.z;ctx.stroke();}
  ctx.restore();
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
  for(const group of this.state.groups){if(group.id===skipId||(onlyId!==undefined&&group.id!==onlyId)||group.locked!==locked||!this.groupVisible(group))continue;const owner=this.owners[group.id];
   const lift=view===this&&this.drag?.id===group.id?this.dragLift(group):null;
   if(lift&&paint!=='overlays'){
    // One silhouette under the whole group, so seams inside it never darken.
    ctx.save();ctx.translate(lift.x+2.5/cam.z,lift.y+7/cam.z);ctx.scale(lift.s,lift.s);ctx.translate(-lift.x,-lift.y);ctx.beginPath();
    for(const id of group.pieces){const p=this.pieces[id];appendTurnedPath(ctx,this.paths[id],this.board.x+p.col*w+group.dx,this.board.y+p.row*h+group.dy,group.pieces.length===1?this.angleOf(id,now):0,w/2,h/2);}
    ctx.fillStyle=colors.dragShadow;ctx.fill();ctx.restore();
   }
   for(const id of group.pieces){const p=this.pieces[id],x=this.board.x+p.col*w+group.dx,y=this.board.y+p.row*h+group.dy;if(x+w+this.tile.pad<(0-cam.x)/cam.z||x-this.tile.pad>(r.w-cam.x)/cam.z||y+h+this.tile.pad<(0-cam.y)/cam.z||y-this.tile.pad>(r.h-cam.y)/cam.z)continue;
    if(paint==='overlays'&&!owner&&this.focusedPiece!==id&&this.selected!==group.id)continue;
    ctx.save();if(lift){ctx.translate(lift.x,lift.y);ctx.scale(lift.s,lift.s);ctx.translate(-lift.x,-lift.y);}ctx.translate(x,y);
    const angle=group.pieces.length===1?this.angleOf(id,now):0;if(angle){ctx.translate(w/2,h/2);ctx.rotate(angle*Math.PI/180);ctx.translate(-w/2,-h/2);}
    if(paint!=='overlays'){
     // Faded: the grey tile instead of the colour one, or over it while the colour comes back.
     const fade=this.fadeOf(group,id,now),t=this.tile;
     if(!(locked&&layer)&&fade<1){if(this.atlas){ctx.drawImage(this.atlas,(id%t.columns)*t.w,Math.floor(id/t.columns)*t.h,t.w,t.h,-t.pad,-t.pad,t.w/t.scale,t.h/t.scale);}else{tracePuzzlePath(ctx,this.paths[id]);ctx.fillStyle=colors.piecePlaceholder;ctx.fill();ctx.strokeStyle=colors.pieceLine;ctx.lineWidth=.8/cam.z;ctx.stroke();}}
     if(fade>0&&this.grayAtlas){const alpha=ctx.globalAlpha;if(fade<1)ctx.globalAlpha=alpha*fade;ctx.drawImage(this.grayAtlas,(id%t.columns)*t.w,Math.floor(id/t.columns)*t.h,t.w,t.h,-t.pad,-t.pad,t.w/t.scale,t.h/t.scale);ctx.globalAlpha=alpha;}
    }
    if(paint!=='pieces'){
    if(owner||this.drag?.id===group.id||this.focusedPiece===id){tracePuzzlePath(ctx,this.paths[id]);ctx.strokeStyle=owner?.color||colors.focus;ctx.lineWidth=(owner&&this.phoneLandscapeRoom?2.5:2)/cam.z;ctx.stroke();}
    else if(this.selected===group.id&&this.rotatable(group)){tracePuzzlePath(ctx,this.paths[id]);ctx.strokeStyle='#f0b44c';ctx.lineWidth=3/cam.z;ctx.stroke();}
    }
    ctx.restore();
   }
   if(paint!=='pieces'&&owner&&group.pieces.length&&!this.cursorShown(owner)){const p=this.pieces[group.pieces[0]],x=this.board.x+p.col*w+group.dx,y=this.board.y+p.row*h+group.dy;ctx.save();ctx.translate(x,y-7/cam.z);ctx.scale(1/cam.z,1/cam.z);ctx.font='11px sans-serif';const name=`${owner.name}${owner.level!==undefined?' Lv.'+owner.level:''}`,width=Math.min(190,ctx.measureText(name).width+12);
    if(this.phoneLandscapeRoom){this.drawPlayerArrow(ctx,owner.color);roomRoundPath(ctx,{x:19,y:-15,w:width,h:20},8);ctx.fillStyle=owner.color;ctx.fill();ctx.fillStyle='#ffffff';ctx.textBaseline='top';ctx.fillText(name,25,-11,width-12);}
    else{ctx.fillStyle=colors.label;ctx.fillRect(0,-15,width,19);ctx.fillStyle=colors.labelInk;ctx.textBaseline='top';ctx.fillText(name,5,-12,width-10);}ctx.restore();}
  }}
 }
 /** A live world overlay shared by direct, gesture-cache and drag-cache drawing.
  * Nothing animated is baked into the cached piece artwork. */
 private drawHintFeedback(ctx:CanvasRenderingContext2D,now:number){
  if(this.completionReveal>0||this.hintUntil<=now||!this.hintIds.length)return;
  const z=this.camera.z,w=this.board.width/this.state.cols,h=this.board.height/this.state.rows,colors=boardThemeColors(this.currentTheme),badgeColor=this.currentTheme==='dark'?boardThemeColors('light').hint:colors.hint;
  const badge=(x:number,y:number,index:number,scale=1)=>{ctx.save();ctx.translate(x,y);ctx.scale(1/(z*scale),1/(z*scale));ctx.globalAlpha=1;ctx.beginPath();ctx.arc(0,0,11,0,Math.PI*2);ctx.fillStyle=badgeColor;ctx.fill();ctx.fillStyle='#ffffff';ctx.font='bold 13px sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(String(index+1),0,0);ctx.restore();};
  for(const [index,id]of this.hintIds.entries()){
   const group=this.state.groups.find(g=>g.pieces.includes(id));if(!group||group.locked)continue;
   const p=this.pieces[id],x=this.board.x+p.col*w,y=this.board.y+p.row*h,lift=this.drag?.id===group.id?this.dragLift(group):null,cx=x+group.dx+w/2,cy=y+group.dy+h/2,from=lift?{x:lift.x+(cx-lift.x)*lift.s,y:lift.y+(cy-lift.y)*lift.s}:{x:cx,y:cy},to={x:x+w/2,y:y+h/2};
   ctx.save();ctx.strokeStyle=colors.hintLine;ctx.lineWidth=1/z;ctx.globalAlpha=.6;ctx.lineDashOffset=0;
   let dashed=false;if(typeof ctx.setLineDash==='function')try{ctx.setLineDash([5/z,4/z]);dashed=true;}catch{}
   ctx.beginPath();if(dashed){ctx.moveTo(from.x,from.y);ctx.lineTo(to.x,to.y);}else{const dx=to.x-from.x,dy=to.y-from.y,length=Math.hypot(dx,dy);for(let start=0;start<length;start+=9/z){const end=Math.min(length,start+5/z);ctx.moveTo(from.x+dx*start/length,from.y+dy*start/length);ctx.lineTo(from.x+dx*end/length,from.y+dy*end/length);}}ctx.stroke();ctx.restore();
   ctx.save();ctx.translate(x,y);tracePuzzlePath(ctx,this.paths[id]);ctx.strokeStyle=colors.hintLine;ctx.lineWidth=2/z;ctx.stroke();badge(w/2,h/2,index);ctx.restore();
   ctx.save();if(lift){ctx.translate(lift.x,lift.y);ctx.scale(lift.s,lift.s);ctx.translate(-lift.x,-lift.y);}ctx.translate(x+group.dx,y+group.dy);{const angle=group.pieces.length===1?this.angleOf(id,now):0;if(angle){ctx.translate(w/2,h/2);ctx.rotate(angle*Math.PI/180);ctx.translate(-w/2,-h/2);}}tracePuzzlePath(ctx,this.paths[id]);ctx.strokeStyle=colors.hintLine;ctx.lineWidth=3.5/(z*(lift?.s??1));ctx.globalAlpha=.65+.35*(.5+.5*Math.sin(now*Math.PI*2/1200));ctx.stroke();badge(w/2,h/2,index,lift?.s??1);ctx.restore();
  }
 }
 private assistDrop(group:Group){
  const unit=Math.min(this.board.width/this.state.cols,this.board.height/this.state.rows),reach=unit*DROP_ASSIST;
  // Never pulled toward a piece the room holds somewhere else (tilted, or kept on this device).
  const blocked=new Set(Object.keys(this.owners).map(Number));for(const id of this.shadowOffsets(group.id).keys())blocked.add(id);
  const to=dropAssistOffset(this.state,group.id,reach,blocked);if(to)moveGroup(this.state,group.id,to.dx,to.dy);
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
 /** While a player holds a group, their shared cursor carries the one name and pointer;
  * the group keeps only its coloured outline. Without an on-screen cursor the group is labelled. */
 private cursorShown(owner:Owner){
  const cursor=owner.playerId?this.cursors.get(owner.playerId):undefined;if(!cursor)return false;
  const p=this.worldToScreen(cursor),r=this.rect;return p.x>=r.x&&p.y>=r.y&&p.x<=r.x+r.w&&p.y<=r.y+r.h;
 }
 private drawTeamBursts(ctx:CanvasRenderingContext2D,now:number){
  if(!this.teamBursts.length||this.completionReveal>0)return;
  const {board:b,camera:cam}=this,w=b.width/this.state.cols,h=b.height/this.state.rows,dark=this.currentTheme==='dark';
  for(const burst of this.teamBursts){
   if(burst.until<=now)continue;const group=this.state.groups.find(g=>g.pieces.includes(burst.a)),pa=this.pieces[burst.a],pb=this.pieces[burst.b];if(!group||!pa||!pb)continue;
   const t=Math.max(0,Math.min(1,(now-burst.startedAt)/(burst.until-burst.startedAt))),ease=1-(1-t)**3,radius=14+(burst.reduced?0:16*ease);
   ctx.save();ctx.translate(b.x+((pa.col+pb.col)/2+.5)*w+group.dx,b.y+((pa.row+pb.row)/2+.5)*h+group.dy);ctx.scale(1/cam.z,1/cam.z);
   // A soft two-colour halo on the seam; reduced motion keeps only this, briefly.
   ctx.globalAlpha=burst.reduced?.7*(1-t):Math.min(1,t/.08)*(1-t)*.8;ctx.lineWidth=4;
   ctx.strokeStyle=burst.colors[0];ctx.beginPath();ctx.arc(0,0,radius,Math.PI*.5,Math.PI*1.5);ctx.stroke();
   ctx.strokeStyle=burst.colors[1];ctx.beginPath();ctx.arc(0,0,radius,-Math.PI*.5,Math.PI*.5);ctx.stroke();
   if(!burst.reduced){
    // Twelve fixed particles: hearts and diamond sparkles alternate, two of each colour in turn.
    ctx.globalAlpha=t<.1?t/.1:t>.65?(1-t)/.35:1;
    for(let i=0;i<12;i++){
     const angle=i*Math.PI/6+.26,reach=18+(i%3)*9+34*ease,x=Math.cos(angle)*reach,y=Math.sin(angle)*reach-22*t,size=(i%2?3.2:6.2)*(1-.35*t);
     ctx.fillStyle=burst.colors[i%4<2?0:1];ctx.beginPath();
     if(i%2){ctx.moveTo(x,y-size);ctx.lineTo(x+size*.6,y);ctx.lineTo(x,y+size);ctx.lineTo(x-size*.6,y);ctx.closePath();}
     else{ctx.moveTo(x,y+size*.9);ctx.bezierCurveTo(x-size*1.4,y-size*.1,x-size*.6,y-size*1.2,x,y-size*.35);ctx.bezierCurveTo(x+size*.6,y-size*1.2,x+size*1.4,y-size*.1,x,y+size*.9);}
     ctx.fill();
    }
    const rise=-40-14*ease;ctx.textAlign='center';ctx.textBaseline='bottom';ctx.lineJoin='round';
    ctx.font='800 17px sans-serif';ctx.lineWidth=4;ctx.strokeStyle=dark?'#2b271d':'#fff7ef';ctx.fillStyle=dark?'#ffd3de':'#d2547a';ctx.strokeText('默契拼合！',0,rise);ctx.fillText('默契拼合！',0,rise);
    ctx.font='700 11px sans-serif';ctx.lineWidth=3;ctx.fillStyle=dark?'#f4e6d4':'#6b4a3a';ctx.strokeText(burst.names,0,rise+15,180);ctx.fillText(burst.names,0,rise+15,180);
   }
   ctx.restore();
  }
 }
 /** A few small sparkles over a piece while it regains its colour. */
 private drawFadeSparkles(ctx:CanvasRenderingContext2D,now:number){
  if(this.variant?.kind!=='fade'||!this.colorAt.size||this.completionReveal>0||reducedMotion())return;
  const {board:b,camera:cam}=this,w=b.width/this.state.cols,h=b.height/this.state.rows;
  this.colorAt.forEach((at,id)=>{
   const k=(now-at)/FADE_IN_MS,piece=this.pieces[id];if(k<0||k>=1||!piece)return;const group=this.state.groups.find(g=>g.pieces.includes(id));if(!group)return;
   ctx.save();ctx.translate(b.x+(piece.col+.5)*w+group.dx,b.y+(piece.row+.5)*h+group.dy);ctx.scale(1/cam.z,1/cam.z);ctx.globalAlpha=Math.sin(k*Math.PI);ctx.fillStyle='#fff3c4';
   for(let i=0;i<3;i++){const a=id*1.7+i*2.1,r=6+10*k+i*3,x=Math.cos(a)*r,y=Math.sin(a)*r-10*k,s=(i?2.4:3.6)*(1-k*.4);ctx.beginPath();ctx.moveTo(x,y-s);ctx.lineTo(x+s*.6,y);ctx.lineTo(x,y+s);ctx.lineTo(x-s*.6,y);ctx.closePath();ctx.fill();}
   ctx.restore();
  });
 }
 /** The round honey 「旋转」 button beside the selected piece's top-right corner, inside the table and clear of the
  * piece (on its left when the right side has no room). Hidden while nothing that can turn is selected. */
 private drawRotateButton(ctx:CanvasRenderingContext2D){
  this.rotateRect=null;const group=this.selected===null?undefined:this.state.groups.find(g=>g.id===this.selected);
  if(!this.rotatable(group)||!this.ready||this.previewLarge||this.completionReveal>0||this.trayDrag||this.drag?.id===group.id&&this.drag.live)return;
  const r=this.rect,cam=this.camera,b=this.board,w=b.width/this.state.cols,h=b.height/this.state.rows,p=this.pieces[group.pieces[0]],z=cam.z,R=ROTATE_BUTTON_R,bottom=this.viewBottom();
  const cx=r.x+cam.x+(b.x+(p.col+.5)*w+group.dx)*z,cy=r.y+cam.y+(b.y+(p.row+.5)*h+group.dy)*z,half=(Math.max(w,h)/2+Math.min(w,h)*.27)*z;
  if(cx<r.x||cx>r.x+r.w||cy<r.y||cy>bottom)return;
  let x=cx+half+ROTATE_BUTTON_GAP+R;if(x+R>r.x+r.w-4)x=cx-half-ROTATE_BUTTON_GAP-R;
  x=Math.max(r.x+R+4,Math.min(r.x+r.w-R-4,x));const y=Math.max(r.y+R+4,Math.min(bottom-R-4,cy-half+R));
  this.rotateRect={x,y,r:R};
  ctx.save();ctx.shadowColor='rgba(0,0,0,.3)';ctx.shadowBlur=12;ctx.shadowOffsetY=4;ctx.beginPath();ctx.arc(x,y,R,0,Math.PI*2);ctx.fillStyle=this.rotateTouch!==null?'#a9611a':'#c9781f';ctx.fill();ctx.restore();
  ctx.save();ctx.beginPath();ctx.arc(x,y,R-1,0,Math.PI*2);ctx.strokeStyle='#ffffff';ctx.lineWidth=2;ctx.stroke();
  // A clockwise arrow as a path: older system fonts lack ⟳.
  const ay=y-5,ar=7,end=Math.PI*1.3,ex=x+Math.cos(end)*ar,ey=ay+Math.sin(end)*ar,tx=-Math.sin(end),ty=Math.cos(end);
  ctx.lineWidth=2.2;ctx.lineCap='round';ctx.beginPath();ctx.arc(x,ay,ar,-Math.PI*.3,end);ctx.stroke();
  ctx.fillStyle='#ffffff';ctx.beginPath();ctx.moveTo(ex+tx*4.5,ey+ty*4.5);ctx.lineTo(ex-ty*3.6-tx*1.2,ey+tx*3.6-ty*1.2);ctx.lineTo(ex+ty*3.6-tx*1.2,ey-tx*3.6-ty*1.2);ctx.closePath();ctx.fill();
  ctx.font='bold 10px sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText('旋转',x,y+11);ctx.restore();
 }
 /** A finger on 「旋转」 turns the selected piece when it lifts there; it never reaches the table. */
 private rotateInput(input:Input){
  if(input.type==='key'||input.type==='wheel')return false;
  const touch=this.rotateTouch;
  if(touch!==null){
   if(input.type==='cancel'){this.rotateTouch=null;this.changed();return false;}
   if(input.type==='up'&&input.changed.some(p=>p.id===touch)){const p=input.changed.find(q=>q.id===touch)!,b=this.rotateRect;this.rotateTouch=null;if(b&&Math.hypot(p.x-b.x,p.y-b.y)<=b.r+12)this.rotateSelected();this.changed();return true;}
   return input.type==='move'&&input.points.every(p=>p.id===touch);
  }
  if(input.type!=='down'||!this.rotateRect||this.pointers.size||this.trayTouch)return false;
  const p=input.changed[0],b=this.rotateRect;if(!p||Math.hypot(p.x-b.x,p.y-b.y)>b.r+6)return false;
  this.rotateTouch=p.id;this.changed();return true;
 }
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
  if(!this.gestureCacheEnabled||!(this.pan||this.pinch)||this.drag||!this.atlas||this.variantAnimating(now)||typeof ctx.getTransform!=='function'||typeof ctx.setTransform!=='function'){this.releaseGestureSurface();return null;}
  const transform=ctx.getTransform();
  if(!transform||transform.b!==0||transform.c!==0||!Number.isFinite(transform.a)||!Number.isFinite(transform.d)||transform.a<=0||transform.d<=0||ctx.globalAlpha!==1||ctx.globalCompositeOperation!=='source-over'){this.releaseGestureSurface();return null;}
  this.releaseDragSurface();
  const {rect:r,camera:cam}=this,sx=transform.a,sy=transform.d,margin=Math.min(160,Math.max(64,Math.min(r.w,r.h)*.32));
  const mx=Math.ceil(margin*sx),my=Math.ceil(margin*sy),width=Math.ceil(r.w*sx)+mx*2,height=Math.ceil(r.h*sy)+my*2;
  if(width*height*4>DRAG_SURFACE_BYTES||width>8192||height>8192){this.releaseSurfaceBuffer();return null;}
  const key=JSON.stringify([this.imageSerial,this.currentTheme,this.edges,this.edges?this.hintIds:[],r,sx,sy,width,height,ctx.imageSmoothingEnabled,ctx.imageSmoothingQuality,this.state.groups,this.variantKey()]);
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
  const drag=this.drag,groups=this.state.groups;let last:Group|undefined;for(let i=groups.length-1;i>=0;i--)if(!groups[i].locked&&this.groupVisible(groups[i])){last=groups[i];break;}
  if(!drag||this.pan||this.pinch||last?.id!==drag.id||!this.atlas||this.variantAnimating(now)||typeof ctx.getTransform!=='function'||typeof ctx.setTransform!=='function'||ctx.globalAlpha!==1||ctx.globalCompositeOperation!=='source-over'||ctx.shadowBlur!==0||ctx.shadowColor!=='rgba(0, 0, 0, 0)'||(ctx.filter!==undefined&&ctx.filter!=='none')){this.releaseDragSurface();return null;}
  // Stage rounds each backing dimension independently. Fractional phone DPRs
  // therefore produce slightly different X/Y scales; both remain axis-aligned
  // and can be copied exactly into the cache without resampling.
  const transform=ctx.getTransform();if(!transform||transform.b!==0||transform.c!==0||!Number.isFinite(transform.a)||!Number.isFinite(transform.d)||transform.a<=0||transform.d<=0){this.releaseDragSurface();return null;}
  const {rect:r,camera:cam}=this,width=ctx.canvas?.width??0,height=ctx.canvas?.height??0;
  if(!Number.isFinite(width*height)||width<1||height<1||width*height*4>DRAG_SURFACE_BYTES){this.releaseSurfaceBuffer();return null;}
  const paint={imageSmoothingEnabled:ctx.imageSmoothingEnabled,imageSmoothingQuality:ctx.imageSmoothingQuality,lineCap:ctx.lineCap,lineJoin:ctx.lineJoin,miterLimit:ctx.miterLimit,lineDashOffset:ctx.lineDashOffset,textAlign:ctx.textAlign,textBaseline:ctx.textBaseline,direction:ctx.direction,fontKerning:ctx.fontKerning,fontStretch:ctx.fontStretch,fontVariantCaps:ctx.fontVariantCaps,letterSpacing:ctx.letterSpacing,wordSpacing:ctx.wordSpacing,textRendering:ctx.textRendering},dash=ctx.getLineDash?.()??[];
  const activeHints=this.hintUntil>now?this.hintIds:[],key=JSON.stringify([this.imageSerial,r,cam,width,height,transform.a,transform.d,transform.e,transform.f,this.currentTheme,this.edges,this.underlay,this.focusedPiece,activeHints,paint,dash,groups.map(g=>[g.id,g.locked,g.pieces,...(g.id===drag.id?[]:[g.dx,g.dy])]),this.owners,Object.keys(this.owners).filter(id=>this.cursorShown(this.owners[id])),this.variantKey()]);
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
  this.pruneHints();
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
  for(const locked of [true,false])for(const group of this.state.groups){const owner=this.owners[group.id];if(group.locked!==locked||!owner?.decoration||!group.pieces.length||!visibleGroup(group,this.pieces,this.edges)||this.cursorShown(owner))continue;const p=this.pieces[group.pieces[0]],x=this.board.x+p.col*w+group.dx,y=this.board.y+p.row*h+group.dy;decorations.push({value:owner.decoration,rect:{x:r.x+cam.x+x*cam.z-27,y:r.y+cam.y+y*cam.z-25,w:24,h:24}});}
  this.drawSnapFeedback(ctx,now);this.drawFadeSparkles(ctx,now);this.drawTeamBursts(ctx,now);this.drawLocateGlow(ctx,now);
  this.drawHintFeedback(ctx,now);
  ctx.restore();
  this.previewThumb=null;
  const thumb=this.preview&&this.ready&&!this.previewLarge?this.thumbLayout():null;
  if(thumb){const maxW=thumb.w,height=thumb.h,top=thumb.top,right=thumb.right;ctx.save();ctx.fillStyle=colors.preview;ctx.fillRect(right-maxW-6,top,maxW+6,height+6);ctx.drawImage(this.picture,right-maxW-3,top+3,maxW,height);ctx.strokeStyle=colors.previewLine;ctx.lineWidth=1;ctx.strokeRect(right-maxW-6,top,maxW+6,height+6);
   // A magnifier in the corner says the thumbnail opens a large, zoomable view.
   const mx=right-maxW-3+11,my=top+height-8;ctx.fillStyle='rgba(255,250,243,.92)';ctx.beginPath();ctx.arc(mx,my,9,0,Math.PI*2);ctx.fill();ctx.strokeStyle='#5b4337';ctx.lineWidth=1.6;ctx.beginPath();ctx.arc(mx-1.5,my-1.5,4,0,Math.PI*2);ctx.moveTo(mx+1.5,my+1.5);ctx.lineTo(mx+5,my+5);ctx.stroke();
   ctx.restore();this.previewThumb={x:right-maxW-6,y:top,w:maxW+6,h:height+6};}
  ctx.save();ctx.beginPath();ctx.rect(r.x,r.y,r.w,r.h);ctx.clip();for(const cursor of this.cursors.values()){const p=this.worldToScreen(cursor),value=cursor.value;if(p.x<r.x||p.y<r.y||p.x>r.x+r.w||p.y>r.y+r.h)continue;ctx.save();ctx.translate(p.x,p.y);ctx.beginPath();ctx.moveTo(1,1);ctx.lineTo(1,19);ctx.lineTo(6,14);ctx.lineTo(10,23);ctx.lineTo(14,21);ctx.lineTo(10,13);ctx.lineTo(18,13);ctx.closePath();ctx.fillStyle=value.color;ctx.fill();ctx.strokeStyle=colors.cursorLine;ctx.lineWidth=1;ctx.stroke();ctx.font='bold 11px sans-serif';const label=`${value.name} · Lv.${value.level??0}`,width=Math.min(190,ctx.measureText(label).width+12);if(this.phoneLandscapeRoom){roomRoundPath(ctx,{x:19,y:12,w:width,h:21},8);ctx.fillStyle=value.color;ctx.fill();}else{ctx.fillStyle=colors.cursorLabel;ctx.fillRect(19,12,width,21);}ctx.fillStyle=this.phoneLandscapeRoom?'#ffffff':colors.labelInk;ctx.textBaseline='top';ctx.fillText(label,25,17,width-12);ctx.restore();if(value.decoration)decorations.push({value:value.decoration,rect:{x:p.x-12.5,y:p.y-12.5,w:25,h:25}});}ctx.restore();
  if(this.selfDecoration&&this.ownPoint){const p=this.worldToScreen(this.ownPoint);decorations.push({value:this.selfDecoration,rect:{x:p.x-12.5,y:p.y-12.5,w:25,h:25}});}
  if(this.drawDecoration&&decorations.length){ctx.save();ctx.beginPath();ctx.rect(r.x,r.y,r.w,r.h);ctx.clip();for(const d of decorations)this.drawDecoration(d.value,d.rect);ctx.restore();}
  this.drawRotateButton(ctx);
  this.drawMinimap(ctx,now);
  if(this.tray)this.drawTray(ctx);
  if(this.previewLarge&&this.ready)this.drawPreviewZoom(ctx);
 }
 destroy(){if(this.destroyed)return;if(this.drag)this.drag.live=false;this.cancelInput(true);this.clearSettles();this.releaseGrayAtlas();this.releaseTrayTiles();if(this.strandedTimer)clearTimeout(this.strandedTimer);this.strandedTimer=null;if(this.minimapTimer)clearTimeout(this.minimapTimer);this.minimapTimer=null;if(this.minimapCache)this.minimapCache.canvas.width=this.minimapCache.canvas.height=1;this.minimapCache=null;this.releaseSurfaceBuffer();this.releasePaperSurface();this.releasePlacedSurface();this.ownPoint=null;this.onCursor?.(null);this.destroyed=true;this.onCursor=null;this.cursors.clear();this.cancelImage?.();this.removeHide();this.removeShow();this.flashes=[];this.teamBursts=[];this.mergeLog.clear();this.pendingDrops.clear();this.pendingDropAt.clear();this.contributions.clear();if(this.frame)this.platform.cancelFrame(this.frame);if(this.timer)clearTimeout(this.timer);this.imageSerial++;if(this.atlas)this.atlas.width=this.atlas.height=1;this.atlas=null;this.picture.width=1;this.picture.height=1;}
}
