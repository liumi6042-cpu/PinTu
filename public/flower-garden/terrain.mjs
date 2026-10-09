import {pondBounds} from './catalog.mjs';
// Ground repeats independently; scenery uses transparent image sprites.
export const world={width:2474,height:1280};
let grass,edge,pattern;
const load=src=>new Promise((resolve,reject)=>{const image=new Image();image.onload=()=>resolve(image);image.onerror=()=>reject(Error('场景素材加载失败'));image.src=src;});
export async function loadTerrain(){
 const [texture,scenery]=await Promise.all([load('assets/grass-soft-v2.webp'),load('assets/pond-warm-v2.webp')]);
 // Reflect neighboring tiles so their edge pixels match without seams.
 grass=document.createElement('canvas');grass.width=grass.height=1024;const g=grass.getContext('2d');
 for(let y=0;y<2;y++)for(let x=0;x<2;x++){g.save();g.translate(x?1024:0,y?1024:0);g.scale(x?-1:1,y?-1:1);g.drawImage(texture,0,0,512,512);g.restore();}
 edge=document.createElement('canvas');edge.width=world.width;edge.height=world.height;const e=edge.getContext('2d');
 e.drawImage(scenery,pondBounds.x,pondBounds.y,pondBounds.width,pondBounds.height);
 pattern=null;
}
export function drawTerrain(ctx,view,width,height){if(!grass)return;pattern??=ctx.createPattern(grass,'repeat');ctx.fillStyle=pattern;ctx.fillRect(-view.x/view.scale,-view.y/view.scale,width/view.scale,height/view.scale);ctx.drawImage(edge,0,0);}
