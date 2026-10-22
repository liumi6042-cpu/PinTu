import { boardFor, type Piece } from './puzzle-engine';

export type PuzzleSpriteOptions={mobilePaper?:boolean};
type PaperFinish={edge:number;blur:number;offsetX:number;offsetY:number};

// Clip each piece once. The atlas stays below roughly 8 million pixels.
export class PuzzleSprites {
  canvas:HTMLCanvasElement; width:number; height:number; padding:number; scale:number;
  private columns:number; private tileWidth:number; private tileHeight:number;
  private paths:Path2D[];private pieceWidth:number;private pieceHeight:number;private paper:PaperFinish|null;
  constructor(picture:HTMLCanvasElement,pieces:Piece[],paths:Path2D[],cols:number,rows:number,options:PuzzleSpriteOptions={}) {
    const board=boardFor(cols,rows),w=board.width/cols,h=board.height/rows,unit=Math.min(w,h);
    this.paths=paths;this.pieceWidth=w;this.pieceHeight=h;
    this.paper=options.mobilePaper?{
      edge:Math.max(.45,Math.min(1.25,unit*.012)),
      blur:Math.max(2,Math.min(5,unit*.055)),
      offsetX:Math.max(.35,Math.min(1,unit*.01)),
      offsetY:Math.max(1,Math.min(3,unit*.028))
    }:null;
    // Keep the tab allowance plus the complete baked shadow inside each tile.
    const finishMargin=this.paper?Math.ceil(this.paper.blur*3+this.paper.offsetY+this.paper.edge*2):0;
    this.padding=unit*.26+1+finishMargin;
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
      if(this.paper){c.beginPath();c.rect(0,0,this.tileWidth,this.tileHeight);c.clip();}
      c.scale(this.tileWidth/this.width,this.tileHeight/this.height);c.translate(this.padding,this.padding);
      if(this.paper){
        c.save();c.fillStyle='#b89573';c.shadowColor='#70432845';
        // Canvas shadow radii/offsets use device pixels, independent of its transform.
        c.shadowBlur=this.paper.blur*this.scale;c.shadowOffsetX=this.paper.offsetX*this.scale;c.shadowOffsetY=this.paper.offsetY*this.scale;
        c.fill(paths[piece.id]);c.restore();
      }
      c.save();c.clip(paths[piece.id]);
      c.drawImage(picture,0,0,picture.width,picture.height,-piece.col*w,-piece.row*h,board.width,board.height);
      c.restore();
      if(this.paper)this.drawPaperFinish(c,piece.id);
      else{c.strokeStyle='#fffbebaa';c.lineWidth=.6/scale;c.stroke(paths[piece.id]);}
      c.restore();
    }
  }
  /** Reapply the same inner edge over the full-resolution picture on settled frames. */
  drawPaperFinish(c:CanvasRenderingContext2D,id:number){
    if(!this.paper)return;
    const path=this.paths[id],{edge}=this.paper;
    c.save();c.clip(path);c.lineJoin='round';
    c.strokeStyle='#855348bd';c.lineWidth=edge*2.4;c.stroke(path);
    const light=c.createLinearGradient(0,-this.pieceHeight*.2,this.pieceWidth*.35,this.pieceHeight*1.15);
    light.addColorStop(0,'#fffbe8e8');light.addColorStop(.3,'#fff8dec2');
    light.addColorStop(.58,'#fff8de32');light.addColorStop(1,'#77513f4d');
    c.strokeStyle=light;c.lineWidth=edge*1.2;c.stroke(path);c.restore();
  }

  draw(c:CanvasRenderingContext2D,id:number,x:number,y:number) {
    c.drawImage(this.canvas,(id%this.columns)*this.tileWidth,Math.floor(id/this.columns)*this.tileHeight,
      this.tileWidth,this.tileHeight,x-this.padding,y-this.padding,this.width,this.height);
  }
  destroy(){this.canvas.width=0;this.canvas.height=0;}
}
