import {validStyle,iconSheet,bubbleSheet,iconCrop,bubbleCrop} from '../public/cosmetics/catalog.mjs';
const images=new Map<string,Promise<HTMLImageElement>>(),urls=new Map<string,Promise<string>>();
function image(src:string){let job=images.get(src);if(!job){job=new Promise<HTMLImageElement>((resolve,reject)=>{const im=new Image();im.onload=()=>resolve(im);im.onerror=reject;im.src=src;});images.set(src,job);job.catch(()=>images.delete(src));}return job;}
// Atlas extraction happens once per equipped/previewed style, never on pointermove.
export function cosmeticUrl(kind:'bubble'|'cursor',id:string):Promise<string>{
 if(!validStyle(id))return Promise.resolve('');const key=kind+id;let job=urls.get(key);if(job)return job;
 job=(async()=>{const im=await image(kind==='cursor'?iconSheet:bubbleSheet),crop=kind==='cursor'?iconCrop(id):bubbleCrop(id),[x,y,w,h]=crop;
 const source=document.createElement('canvas');source.width=w;source.height=h;const ctx=source.getContext('2d')!;ctx.drawImage(im,x,y,w,h,0,0,w,h);
 if(kind==='bubble')return source.toDataURL('image/png');
 const pixels=ctx.getImageData(0,0,w,h).data;let left=w,top=h,right=0,bottom=0;
 for(let py=0;py<h;py++)for(let px=0;px<w;px++)if(pixels[(py*w+px)*4+3]>40){left=Math.min(left,px);top=Math.min(top,py);right=Math.max(right,px);bottom=Math.max(bottom,py);}
 const out=document.createElement('canvas');out.width=32;out.height=32;const draw=out.getContext('2d')!,scale=30/Math.max(right-left+1,bottom-top+1),dw=(right-left+1)*scale,dh=(bottom-top+1)*scale;
 draw.drawImage(source,left,top,right-left+1,bottom-top+1,(32-dw)/2,(32-dh)/2,dw,dh);return out.toDataURL('image/png');
 })();urls.set(key,job);job.catch(()=>urls.delete(key));return job;
}
