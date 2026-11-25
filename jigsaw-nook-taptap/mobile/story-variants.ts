import {dropGroup,snapTolerance,type PuzzleState} from '../lib/puzzle-engine';
import {clampGroupOffset} from '../lib/solo-play';

/** 回忆变奏关: some story levels play as a variant. fade = loose single pieces are grey and a piece regains its
 * colour once it is joined or placed; wind = some single pieces lie turned by 90/180/270 degrees and must be
 * turned upright (rotate button, or Space) before they join anything. Story levels only; never in rooms
 * with other players. */
export type StoryVariant='fade'|'wind'|'wind-light'|'wind-water';
export type BoardVariant={kind:'fade'}|{kind:'wind';share:number;roomId:string};
const VARIANTS:readonly StoryVariant[]=['fade','wind','wind-light','wind-water'];
/** Bundled placement, so the package needs no backend release. A level's server `variant` wins when present ('none' turns it off). */
export const DEFAULT_STORY_VARIANTS:Readonly<Record<string,StoryVariant>>={
 'ch1-3':'wind-light','ch1-5':'fade','ch2-3':'wind','ch2-5':'fade','ch3-3':'wind','ch3-5':'fade','ch4-2':'wind-water','ch4-5':'fade',
};
export function storyVariantFor(levelId:string|null|undefined,level?:{variant?:unknown}|null):StoryVariant|null{
 if(!levelId)return null;
 const server=level?.variant;
 if(server==='none')return null;
 if(typeof server==='string'&&(VARIANTS as readonly string[]).includes(server))return server as StoryVariant;
 return Object.prototype.hasOwnProperty.call(DEFAULT_STORY_VARIANTS,levelId)?DEFAULT_STORY_VARIANTS[levelId]:null;
}
export function boardVariant(variant:StoryVariant,roomId:string):BoardVariant{
 return variant==='fade'?{kind:'fade'}:{kind:'wind',share:variant==='wind-light'?.25:.5,roomId};
}
/** The sentence added to a level's intro the first time a player meets each variant. */
export const VARIANT_INTRO:Readonly<Record<'fade'|'wind'|'wind-water',string>>={
 fade:'这段回忆褪色了，拼上的地方会重新亮起来。',
 wind:'一阵风吹进来，有些碎片歪了，用旋转按钮把它们转正。',
 'wind-water':'水流把碎片冲歪了，用旋转按钮把它们转正。',
};
export const variantIntroKey=(variant:StoryVariant)=>'jigsaw:story-variant-seen:'+(variant==='fade'?'fade':variant==='wind-water'?'wind-water':'wind');
export function variantIntroSentence(variant:StoryVariant){return VARIANT_INTRO[variant==='fade'?'fade':variant==='wind-water'?'wind-water':'wind'];}

/** FNV-1a over the room id and piece id: the same room always tilts the same pieces the same way. */
function hash(text:string){let h=0x811c9dc5;for(let i=0;i<text.length;i++){h^=text.charCodeAt(i);h=Math.imul(h,0x01000193)>>>0;}h^=h>>>13;h=Math.imul(h,0x5bd1e995)>>>0;return (h^(h>>>15))>>>0;}
/** Quarter turns (1-3) for the pieces the wind tilts; about `share` of them. */
export function seededTilts(roomId:string,pieceIds:readonly number[],share:number){
 const result=new Map<number,number>();
 for(const id of pieceIds){const h=hash(roomId+':'+id);if((h%1000)/1000<share)result.set(id,1+(h>>>10)%3);}
 return result;
}

/** The faded look, applied to RGBA pixels in place: luminance * .72 + 52 with a slight warm tint. Alpha is kept. */
export function fadePixels(data:Uint8ClampedArray|number[],from=0,to=data.length){
 for(let i=from;i<to;i+=4){const l=(data[i]*.3+data[i+1]*.59+data[i+2]*.11)*.72+52;data[i]=Math.min(255,l+8);data[i+1]=Math.min(255,l+3);data[i+2]=Math.max(0,l-6);}
}

/** Rotation and kept-local positions of one wind room, stored on the device until the room is finished. */
export type WindSave={rot:Map<number,number>;pos:Map<number,{dx:number;dy:number;bx:number;by:number}>};
export const windStorageKey=(roomId:string)=>'jigsaw:story-wind:v1:'+roomId;
export function readWindSave(raw:string|null):WindSave|null{
 if(!raw)return null;
 try{
  const value=JSON.parse(raw);if(!value||value.v!==1||typeof value.rot!=='object'||!value.rot)return null;
  const rot=new Map<number,number>(),pos=new Map<number,{dx:number;dy:number;bx:number;by:number}>();
  for(const key of Object.keys(value.rot)){const id=Number(key),q=value.rot[key];if(Number.isInteger(id)&&id>=0&&Number.isInteger(q)&&q>=0&&q<=3)rot.set(id,q);}
  if(value.pos&&typeof value.pos==='object')for(const key of Object.keys(value.pos)){const id=Number(key),p=value.pos[key];if(Number.isInteger(id)&&Array.isArray(p)&&p.length===4&&p.every(n=>typeof n==='number'&&Number.isFinite(n)))pos.set(id,{dx:p[0],dy:p[1],bx:p[2],by:p[3]});}
  return {rot,pos};
 }catch{return null;}
}
export function writeWindSave(save:WindSave){
 const rot:Record<string,number>={},pos:Record<string,number[]>={};
 save.rot.forEach((q,id)=>{rot[id]=q;});save.pos.forEach((p,id)=>{pos[id]=[p.dx,p.dy,p.bx,p.by];});
 return JSON.stringify({v:1,rot,pos});
}

/** Would the room's own drop of group `id` at dx/dy join any of `shadows` (groups the room sees at a different
 * place than the player does: tilted pieces, kept local)? Runs the shared engine's drop on a copy laid out as
 * the room has it, so the answer matches the server and a solo batch replay exactly. */
export function dropJoinsShadow(state:PuzzleState,id:number,dx:number,dy:number,shadows:ReadonlyMap<number,{dx:number;dy:number}>,blocked:ReadonlySet<number>=new Set()){
 if(!shadows.size||!state.groups.some(g=>g.id===id&&!g.locked))return false;
 const copy:PuzzleState={...state,groups:state.groups.map(g=>{const s=g.id!==id?shadows.get(g.id):undefined;return {...g,pieces:[...g.pieces],...(s?{dx:s.dx,dy:s.dy}:{})};})};
 const offset=clampGroupOffset(copy,id,dx,dy),active=copy.groups.find(g=>g.id===id)!;active.dx=offset.dx;active.dy=offset.dy;
 dropGroup(copy,id,snapTolerance(copy),new Set(blocked));
 const left=new Set(copy.groups.map(g=>g.id));
 for(const shadow of shadows.keys())if(shadow!==id&&!left.has(shadow)&&state.groups.some(g=>g.id===shadow))return true;
 return false;
}
/** The drop offset nearest dx/dy that joins no shadow group, or null when none is within reach. */
export function safeDropOffset(state:PuzzleState,id:number,dx:number,dy:number,shadows:ReadonlyMap<number,{dx:number;dy:number}>,blocked:ReadonlySet<number>=new Set()){
 if(!dropJoinsShadow(state,id,dx,dy,shadows,blocked))return {dx,dy};
 const tolerance=snapTolerance(state);
 for(const radius of [1.15,1.6,2.2,3])for(let i=0;i<8;i++){const angle=i*Math.PI/4,x=dx+Math.cos(angle)*tolerance*radius,y=dy+Math.sin(angle)*tolerance*radius;if(!dropJoinsShadow(state,id,x,y,shadows,blocked))return {dx:x,dy:y};}
 return null;
}
