import type {PuzzleState} from './puzzle-engine';
import {boardFor} from './puzzle-engine';
import {pictureCrop} from './puzzle-picture';
export type Discovery={id:string;zh:string;en:string;box:[number,number,number,number]};
// Bounds are in the original square image, verified against the published art.
export const pictureDiscoveries:Record<string,Discovery[]>={
 'cat-lantern-market-v1':[
  {id:'boat-cat',zh:'发现了船上打盹的猫，灯火正陪着它。',en:'A cat is napping on the boat, keeping the lanterns company.',box:[.83,.81,.15,.09]},
  {id:'walking-cat',zh:'发现了提灯女孩身旁的小猫，它也来逛夜市了。',en:'A little cat beside the lantern girl is exploring the night market too.',box:[.105,.665,.1,.175]},
 ],
 'lantern-dance-v1':[
  {id:'fountain-cat',zh:'发现了喷泉边的黑白猫，它有最好的舞会座位。',en:'The black-and-white cat by the fountain has the best seat at the dance.',box:[.105,.78,.105,.115]},
  {id:'swans',zh:'发现了河上的两只天鹅，它们也来赴约。',en:'Two swans on the river have joined the evening gathering.',box:[.54,.38,.105,.095]},
 ],
 'magic-treehouse-v1':[
  {id:'owls',zh:'发现了树梢上的猫头鹰，树屋有了安静的守夜人。',en:'Owls in the branches are quietly watching over the treehouse.',box:[.40,.0,.115,.105]},
  {id:'squirrel',zh:'发现了树根旁的大尾巴松鼠，像是在等一杯热茶。',en:'A bushy-tailed squirrel by the roots seems to be waiting for tea.',box:[.02,.865,.16,.13]},
 ],
};
export function discoveryPieces(d:Discovery,cols:number,rows:number):number[]{
 const crop=pictureCrop(1,1,cols,rows),[x,y,w,h]=d.box;
 // If a legacy board crops away the subject, do not announce an unseen detail.
 if(x<crop.x-1e-8||y<crop.y-1e-8||x+w>crop.x+crop.width+1e-8||y+h>crop.y+crop.height+1e-8)return [];
 const left=Math.max(0,Math.floor((x-crop.x)/crop.width*cols)),right=Math.min(cols-1,Math.ceil((x+w-crop.x)/crop.width*cols)-1);
 const top=Math.max(0,Math.floor((y-crop.y)/crop.height*rows)),bottom=Math.min(rows-1,Math.ceil((y+h-crop.y)/crop.height*rows)-1);
 const ids:number[]=[];for(let r=top;r<=bottom;r++)for(let c=left;c<=right;c++)ids.push(r*cols+c);return ids;
}
export class DiscoveryTracker {
 private targets:{detail:Discovery;pieces:number[]}[];
 private initialized=false;
 readonly seen:Set<string>;
 constructor(state:Pick<PuzzleState,'imageId'|'cols'|'rows'>,seen:string[]=[]){this.seen=new Set(seen);this.targets=(pictureDiscoveries[state.imageId]||[]).map(detail=>({detail,pieces:discoveryPieces(detail,state.cols,state.rows)}));}
 observe(state:Pick<PuzzleState,'groups'>):Discovery[]{
  const owner=new Map<number,number>(),locked=new Set<number>();
  for(const g of state.groups)for(const id of g.pieces){if(g.locked||g.pieces.length>1)owner.set(id,g.id);if(g.locked)locked.add(id);}
  const found:Discovery[]=[];
  for(const {detail,pieces} of this.targets){if(!pieces.length||this.seen.has(detail.id))continue;
   const group=owner.get(pieces[0]);
   if(pieces.every(id=>locked.has(id))||(group!==undefined&&pieces.every(id=>owner.get(id)===group))){this.seen.add(detail.id);if(this.initialized)found.push(detail);}
  }
  this.initialized=true;return found;
 }
}

// Locate the actual assembled subject, including groups not yet on the board.
export function discoveryBounds(d:Discovery,state:Pick<PuzzleState,'cols'|'rows'|'groups'>){
 const ids=discoveryPieces(d,state.cols,state.rows);if(!ids.length)return null;
 const groups=ids.map(id=>state.groups.find(g=>g.pieces.includes(id)));if(groups.some(g=>!g))return null;
 const allLocked=groups.every(g=>g!.locked),first=groups[0]!;
 if(!allLocked&&(!groups.every(g=>g!.id===first.id)||first.pieces.length<2))return null;
 const crop=pictureCrop(1,1,state.cols,state.rows),board=boardFor(state.cols,state.rows),[x,y,w,h]=d.box;
 return {x:board.x+(x-crop.x)/crop.width*board.width+(allLocked?0:first.dx),y:board.y+(y-crop.y)/crop.height*board.height+(allLocked?0:first.dy),width:w/crop.width*board.width,height:h/crop.height*board.height};
}
