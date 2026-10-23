import type {Rect} from './ports';

/** Canvas path shared by the landscape room chrome and player name tags. */
export function roomRoundPath(c:CanvasRenderingContext2D,r:Rect,radius:number){
 const k=Math.min(radius,r.w/2,r.h/2),{x,y,w,h}=r;
 c.beginPath();c.moveTo(x+k,y);c.lineTo(x+w-k,y);c.quadraticCurveTo(x+w,y,x+w,y+k);
 c.lineTo(x+w,y+h-k);c.quadraticCurveTo(x+w,y+h,x+w-k,y+h);c.lineTo(x+k,y+h);
 c.quadraticCurveTo(x,y+h,x,y+h-k);c.lineTo(x,y+k);c.quadraticCurveTo(x,y,x+k,y);c.closePath();
}
