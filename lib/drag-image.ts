import type { Group,Piece } from './puzzle-engine';

// Cache only the group in the player's hand, at the actual display resolution.
// Oversized groups use the existing renderer instead of allocating huge bitmaps
// or reducing picture resolution. Moving the group never changes this cache key.
export const DRAG_IMAGE_PIXELS=3_000_000;
export class DragImage {
 private image:HTMLCanvasElement|null=null;
 private pieces:readonly number[]|null=null;
 private key='';private left=0;private top=0;private width=0;private height=0;
 draw(c:CanvasRenderingContext2D,group:Group,pieces:Piece[],w:number,h:number,board:{x:number;y:number},scale:number,padding:number,appearance:string,paint:(c:CanvasRenderingContext2D)=>void,presentation?:{host:HTMLElement;camera:{x:number;y:number;z:number}}){
  const key=`${group.id}:${group.pieces.length}:${scale}:${padding}:${appearance}`;
  if(this.key!==key||this.pieces!==group.pieces){
   this.clear();this.key=key;this.pieces=group.pieces;
   let left=Infinity,top=Infinity,right=-Infinity,bottom=-Infinity;
   for(const id of group.pieces){const p=pieces[id];left=Math.min(left,p.col*w);top=Math.min(top,p.row*h);right=Math.max(right,(p.col+1)*w);bottom=Math.max(bottom,(p.row+1)*h);}
   this.left=left-padding;this.top=top-padding;this.width=right-left+padding*2;this.height=bottom-top+padding*2;
   const width=Math.ceil(this.width*scale),height=Math.ceil(this.height*scale);
   if(width>0&&height>0&&width*height<=DRAG_IMAGE_PIXELS){
    const image=document.createElement('canvas');image.width=width;image.height=height;
    const context=image.getContext('2d');
    if(context){context.scale(scale,scale);context.translate(-board.x-group.dx-this.left,-board.y-group.dy-this.top);paint(context);this.image=image;}
   }
  }
  if(!this.image)return false;
  if(presentation){
   const {host,camera}=presentation;
   if(this.image.parentElement!==host){this.image.className='dragged-piece-image';this.image.setAttribute('aria-hidden','true');host.appendChild(this.image);}
   this.image.style.width=`${this.image.width/scale}px`;this.image.style.height=`${this.image.height/scale}px`;
   this.image.style.transform=`translate3d(${camera.x+(board.x+group.dx+this.left)*camera.z}px,${camera.y+(board.y+group.dy+this.top)*camera.z}px,0) scale(${camera.z})`;
   return true;
  }
  // Source dimensions are rounded up. Use the matching logical size so there is
  // no additional stretch of the cached image or its antialiased border.
  c.drawImage(this.image,board.x+group.dx+this.left,board.y+group.dy+this.top,this.image.width/scale,this.image.height/scale);
  return true;
 }
 clear(){if(this.image){this.image.remove?.();this.image.width=0;this.image.height=0;}this.image=null;this.pieces=null;this.key='';}
}
