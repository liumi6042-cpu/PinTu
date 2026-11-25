import type { Piece } from './puzzle-engine';

export function pictureCrop(sourceWidth:number,sourceHeight:number,width:number,height:number){
  const scale=Math.min(sourceWidth/width,sourceHeight/height),sw=width*scale,sh=height*scale;
  return {x:(sourceWidth-sw)/2,y:(sourceHeight-sh)/2,width:sw,height:sh};
}

// Sample only this piece's native pixels, including its tabs, at the current zoom.
export function drawPiecePicture(c:CanvasRenderingContext2D,picture:HTMLCanvasElement,piece:Piece,cols:number,rows:number,width:number,height:number){
  const w=width/cols,h=height/rows,pad=Math.min(w,h)*.26;
  const left=Math.max(0,piece.col*w-pad),top=Math.max(0,piece.row*h-pad);
  const right=Math.min(width,(piece.col+1)*w+pad),bottom=Math.min(height,(piece.row+1)*h+pad);
  const rx=picture.width/width,ry=picture.height/height;
  c.drawImage(picture,left*rx,top*ry,(right-left)*rx,(bottom-top)*ry,left-piece.col*w,top-piece.row*h,right-left,bottom-top);
}
