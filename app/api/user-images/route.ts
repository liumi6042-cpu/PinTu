import { requireAccount } from '@/lib/account-store';
import { failure,json } from '@/lib/room-store';
import { RoomError } from '@/lib/room-engine';
import { userImages,storeUserImage } from '@/lib/user-image-store';
import { cleanUserWebP } from '@/lib/user-image-format';
import { USER_UPLOAD_MAX_BYTES,USER_IMAGE_MAX_BYTES,USER_THUMB_MAX_BYTES } from '@/lib/custom-images';
export async function GET(request:Request){try{return json({images:await userImages((await requireAccount(request)).id)});}catch(e){return failure(e);}}
export async function POST(request:Request){try{
 if(request.headers.get('Origin')!==new URL(request.url).origin)throw new RoomError('请从本网站上传图片',403);
 const account=await requireAccount(request);
 const type=request.headers.get('Content-Type')||'';
 if(!type.startsWith('multipart/form-data;'))throw new RoomError('上传格式无效');
 if(Number(request.headers.get('Content-Length'))>USER_UPLOAD_MAX_BYTES)throw new RoomError('图片文件过大，请选择小一些的图片。',413);
 const reader=request.body?.getReader(),chunks:Uint8Array[]=[];let size=0;
 if(reader)try{for(;;){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>USER_UPLOAD_MAX_BYTES){await reader.cancel();throw new RoomError('图片文件过大，请选择小一些的图片。',413);}chunks.push(part.value);}}finally{reader.releaseLock();}
 const bytes=new Uint8Array(size);let at=0;for(const chunk of chunks){bytes.set(chunk,at);at+=chunk.length;}
 let form:FormData;try{form=await new Response(bytes,{headers:{'Content-Type':type}}).formData();}catch{throw new RoomError('上传格式无效');}
 const title=String(form.get('title')||'').trim();if(!title||title.length>60||/[\u0000-\u001f\u007f]/.test(title))throw new RoomError('图片名称需为 1–60 个字符');
 if(form.get('rights')!=='yes')throw new RoomError('请确认你有权使用这张图片。');
 const file=form.get('image'),thumbnail=form.get('preview');if(!(file instanceof File)||!(thumbnail instanceof File)||file.type!=='image/webp'||thumbnail.type!=='image/webp')throw new RoomError('上传格式无效');
 let image:ReturnType<typeof cleanUserWebP>,preview:ReturnType<typeof cleanUserWebP>;
 try{
  image=cleanUserWebP(new Uint8Array(await file.arrayBuffer()),USER_IMAGE_MAX_BYTES);preview=cleanUserWebP(new Uint8Array(await thumbnail.arrayBuffer()),USER_THUMB_MAX_BYTES,480);
  if(Math.min(image.width,image.height)<240)throw new RoomError('图片太小，请选择短边至少 240 像素的图片。');
  if(Math.abs(image.width/image.height-preview.width/preview.height)>.03)throw new RoomError('预览图片比例不匹配，请重新上传。');
 }catch(e){if(e instanceof RoomError)throw e;throw new RoomError(e instanceof Error?e.message:'图片格式无效');}
 return json({image:await storeUserImage(account.id,title,image,preview.bytes)},201);
}catch(e){return failure(e);}}
