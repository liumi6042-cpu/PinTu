import { boardFor, type Piece } from './puzzle-engine';

// Clip each piece once. The atlas stays below roughly 8 million pixels.
export class PuzzleSprites {
  canvas:HTMLCanvasElement; width:number; height:number; padding:number; scale:number;
  private columns:number; private tileWidth:number; private tileHeight:number;
  constructor(picture:HTMLCanvasElement,pieces:Piece[],paths:Path2D[],cols:number,rows:number) {
    const board=boardFor(cols,rows),w=board.width/cols,h=board.height/rows;
    this.padding=Math.min(w,h)*.26+1;
    this.width=w+this.padding*2;this.height=h+this.padding*2;
    const scale=Math.min(4,Math.sqrt(7_500_000/(pieces.length*this.width*this.height)));
    this.tileWidth=Math.ceil(this.width*scale);this.tileHeight=Math.ceil(this.height*scale);
    this.scale=Math.min(this.tileWidth/this.width,this.tileHeight/this.height);
    this.columns=Math.max(1,Math.floor(2048/this.tileWidth));
    this.canvas=document.createElement('canvas');
    this.canvas.width=this.columns*this.tileWidth;this.canvas.height=Math.ceil(pieces.length/this.columns)*this.tileHeight;
    const c=this.canvas.getContext('2d')!;
    c.imageSmoothingEnabled=true;c.imageSmoothingQuality='high';
    for(const piece of pieces){
      c.save();c.translate((piece.id%this.columns)*this.tileWidth,Math.floor(piece.id/this.columns)*this.tileHeight);
      c.scale(this.tileWidth/this.width,this.tileHeight/this.height);c.translate(this.padding,this.padding);
      c.save();c.clip(paths[piece.id]);
      c.drawImage(picture,0,0,picture.width,picture.height,-piece.col*w,-piece.row*h,board.width,board.height);
      c.restore();c.strokeStyle='#fffbebaa';c.lineWidth=.6/scale;c.stroke(paths[piece.id]);c.restore();
    }
  }
  draw(c:CanvasRenderingContext2D,id:number,x:number,y:number) {
    c.drawImage(this.canvas,(id%this.columns)*this.tileWidth,Math.floor(id/this.columns)*this.tileHeight,
      this.tileWidth,this.tileHeight,x-this.padding,y-this.padding,this.width,this.height);
  }
  destroy(){this.canvas.width=0;this.canvas.height=0;}
}
