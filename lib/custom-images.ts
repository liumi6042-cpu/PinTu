export const USER_IMAGE_LIMIT=10,USER_IMAGE_MAX_BYTES=1800*1024,USER_THUMB_MAX_BYTES=96*1024,USER_UPLOAD_MAX_BYTES=2*1024*1024;
export const USER_IMAGE_MAX_SIDE=3072;
export type CustomImage={id:string;title:string;width:number;height:number};
export type UserImage=CustomImage&{bytes:number;createdAt:number;src:string;thumbSrc:string};
export const isCustomImageId=(id:unknown):id is string=>typeof id==='string'&&/^custom-[a-f0-9]{32}$/.test(id);
export function customPhoto(image:CustomImage,roomId?:string){
 const query=roomId?'?room='+encodeURIComponent(roomId):'';
 const prepared=image as CustomImage & {h5Src?:string;h5ThumbSrc?:string}; const src=prepared.h5Src||'/api/user-images/'+image.id+query;
 return {...image,src,thumbSrc:prepared.h5ThumbSrc||src+(query?'&':'?')+'preview=1',subtitle:'玩家上传的图片',category:'玩家上传'};
}
