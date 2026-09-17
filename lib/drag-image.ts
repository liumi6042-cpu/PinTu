import type { Group,Piece } from './puzzle-engine';

// Cache only the groups in the player's hand, at the actual display resolution.
// Oversized selections use the existing renderer instead of allocating huge
// bitmaps or reducing picture resolution. Moving them never changes this key:
// the key is topology plus appearance, never position.
export const DRAG_IMAGE_PIXELS=3_000_000;
// A multi-selection can carry several non-adjacent groups. They are rasterized
// into one local space anchored on the selection's own bounding box, and that
// origin is handed to the painter once per rebuild. The presentation transform
// then only needs the origin, never the individual group offsets.
export type DragOrigin={x:number;y:number};
export class DragImage {
 private image:HTMLCanvasElement|null=null;
 private pieces:readonly number[]|null=null;
 private key='';private left=0;private top=0;private width=0;private height=0;private offset='';
 draw(c:CanvasRenderingContext2D,groups:readonly Group[],pieces:Piece[],w:number,h:number,scale:number,padding:number,appearance:string,paint:(c:CanvasRenderingContext2D,origin:DragOrigin)=>void,presentation?:{host:HTMLElement;camera:{x:number;y:number;z:number}}){
  // Offsets the painter wrote into the bitmap, relative to its top-left corner.
  // They are the anchor for the drawing target, so a cached bitmap can be reused
  // for any later position without re-rasterizing it.
  const layout=groups.map(group=>`${group.dx},${group.dy}`).join('|');
  const identity=groups.map(group=>`${group.id}/${group.pieces.length}/${group.pieces[0]}`).join('|');
  const key=`${identity}:${scale}:${padding}:${appearance}`;
  if(this.key!==key||this.pieces!==groups[0]?.pieces){
   this.clear();this.key=key;this.pieces=groups[0]?.pieces;this.offset=layout;
   let left=Infinity,top=Infinity,right=-Infinity,bottom=-Infinity;
   for(const group of groups)for(const id of group.pieces){const p=pieces[id];left=Math.min(left,p.col*w+group.dx);top=Math.min(top,p.row*h+group.dy);right=Math.max(right,(p.col+1)*w+group.dx);bottom=Math.max(bottom,(p.row+1)*h+group.dy);}
   this.left=left-padding;this.top=top-padding;this.width=right-left+padding*2;this.height=bottom-top+padding*2;
   const width=Math.ceil(this.width*scale),height=Math.ceil(this.height*scale);
   if(width>0&&height>0&&width*height<=DRAG_IMAGE_PIXELS){
    const image=document.createElement('canvas');image.width=width;image.height=height;
    const context=image.getContext('2d');
    // The bitmap is at device scale, so the painter needs a device-space
    // transform and the origin it is handed must be in those same units.
    if(context){context.scale(scale,scale);context.translate(-this.left,-this.top);paint(context,{x:this.left,y:this.top});this.image=image;}
   }
  }
  if(!this.image)return false;
  // How far the selection moved since the bitmap was rasterized, in device units.
  const moved=this.offset===layout?[0,0]:this.drift(groups);
  if(presentation){
   const {host,camera}=presentation;
   if(this.image.parentElement!==host){this.image.className='dragged-piece-image';this.image.setAttribute('aria-hidden','true');host.appendChild(this.image);}
   this.image.style.width=`${this.image.width/scale}px`;this.image.style.height=`${this.image.height/scale}px`;
   this.image.style.transform=`translate3d(${camera.x+(this.left+moved[0])*camera.z}px,${camera.y+(this.top+moved[1])*camera.z}px,0) scale(${camera.z})`;
   return true;
  }
  // Source dimensions are rounded up. Use the matching logical size so there is
  // no additional stretch of the cached image or its antialiased border.
  c.drawImage(this.image,this.left+moved[0],this.top+moved[1],this.image.width/scale,this.image.height/scale);
  return true;
 }
 // Every carried group moves by the same delta, so any one of them reports how
 // far the cached bitmap has to shift. `this.offset` is the layout string frozen
 // at rasterization time; comparing it to the group's *current* position gives the
 // real delta. (Passing the live `layout` here instead was a bug: it is built from
 // the same current positions as `groups[0]`, so the subtraction was always zero
 // and the floating overlay never moved during a drag.)
 private drift(groups:readonly Group[]){
  const before=this.offset.split('|')[0].split(',').map(Number),first=groups[0];
  return Number.isFinite(before[0])&&first?[first.dx-before[0],first.dy-before[1]]:[0,0];
 }
 clear(){if(this.image){this.image.remove?.();this.image.width=0;this.image.height=0;}this.image=null;this.pieces=null;this.key='';this.offset='';}
}
