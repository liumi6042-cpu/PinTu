import {USER_IMAGE_MAX_BYTES,USER_IMAGE_MAX_SIDE,USER_THUMB_MAX_BYTES} from './custom-images';
const encode=(canvas:HTMLCanvasElement,quality:number)=>new Promise<Blob>((resolve,reject)=>canvas.toBlob(blob=>blob&&blob.type==='image/webp'?resolve(blob):reject(new Error('浏览器无法处理这张图片，请尝试其他浏览器。')),'image/webp',quality));
export async function prepareUserImage(file:File){
 if(!['image/jpeg','image/png','image/webp'].includes(file.type))throw new Error('请选择 JPG、PNG 或 WebP 图片。');
 if(file.size>12*1024*1024)throw new Error('原图不能超过 12 MB，请选择小一些的图片。');
 const url=URL.createObjectURL(file),image=new Image(),canvas=document.createElement('canvas'),thumb=document.createElement('canvas');
 try{
  image.src=url;await image.decode();const sourceWidth=image.naturalWidth,sourceHeight=image.naturalHeight;
  if(Math.min(sourceWidth,sourceHeight)<240||sourceWidth*sourceHeight>40_000_000)throw new Error('请选择短边至少 240 像素、总像素不超过 4000 万的图片。');
  const scale=Math.min(1,USER_IMAGE_MAX_SIDE/Math.max(sourceWidth,sourceHeight));canvas.width=Math.round(sourceWidth*scale);canvas.height=Math.round(sourceHeight*scale);
  const context=canvas.getContext('2d')!;context.fillStyle='#f6f0e3';context.fillRect(0,0,canvas.width,canvas.height);context.drawImage(image,0,0,canvas.width,canvas.height);
  let main=await encode(canvas,.94);for(const q of [.88,.8,.72]){if(main.size<=USER_IMAGE_MAX_BYTES)break;main=await encode(canvas,q);}
  if(main.size>USER_IMAGE_MAX_BYTES)throw new Error('图片细节过多，请选择小一些的图片。');
  const ratio=Math.min(1,480/Math.max(canvas.width,canvas.height));thumb.width=Math.round(canvas.width*ratio);thumb.height=Math.round(canvas.height*ratio);thumb.getContext('2d')!.drawImage(canvas,0,0,thumb.width,thumb.height);
  const preview=await encode(thumb,.8);if(preview.size>USER_THUMB_MAX_BYTES)throw new Error('图片预览过大，请换一张图片。');
  return {image:main,preview,width:canvas.width,height:canvas.height,sourceWidth,sourceHeight};
 }catch(e){throw new Error(e instanceof Error&&e.name!=='EncodingError'?e.message:'无法读取图片，请换一张有效图片。');}
 finally{URL.revokeObjectURL(url);canvas.width=0;canvas.height=0;thumb.width=0;thumb.height=0;}
}
