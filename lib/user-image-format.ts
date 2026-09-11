import { USER_IMAGE_MAX_SIDE } from './custom-images';
// Accept the still, opaque WebP subset produced by the upload canvas. Rebuild
// its container so EXIF (including location), XMP and arbitrary extra data are
// not stored. This checks structure and dimensions, not the picture's content.
// https://developers.google.com/speed/webp/docs/riff_container
export function cleanUserWebP(input:Uint8Array,maxBytes:number,maxSide=USER_IMAGE_MAX_SIDE){
 const bad=()=>{throw new Error('图片格式无效，请重新选择 JPG、PNG 或 WebP 图片。');};
 if(input.length<26||input.length>maxBytes)bad();
 const view=new DataView(input.buffer,input.byteOffset,input.byteLength),tag=(at:number)=>String.fromCharCode(...input.subarray(at,at+4));
 if(tag(0)!=='RIFF'||tag(8)!=='WEBP'||view.getUint32(4,true)+8!==input.length)bad();
 let bitstream:Uint8Array|undefined,width=0,height=0,extended:{width:number;height:number}|undefined;
 for(let at=12;at<input.length;){
  if(at+8>input.length)bad();const type=tag(at),size=view.getUint32(at+4,true),start=at+8,end=start+size;
  if(end+(size%2)>input.length||size===0||(size%2&&input[end]!==0))bad();
  if(type==='VP8 '||type==='VP8L'){
   if(bitstream)bad();
   if(type==='VP8 '){
    if(size<10||(input[start]&1)!==0||input[start+3]!==0x9d||input[start+4]!==1||input[start+5]!==0x2a)bad();
    width=view.getUint16(start+6,true)&0x3fff;height=view.getUint16(start+8,true)&0x3fff;
   }else{
    if(size<5||input[start]!==0x2f)bad();const bits=view.getUint32(start+1,true);if(bits>>>29)bad();
    width=(bits&0x3fff)+1;height=((bits>>>14)&0x3fff)+1;
   }
   bitstream=input.slice(at,end+(size%2));
  }else if(type==='VP8X'){
   // Reject animation, external alpha and unsupported reserved flags.
   if(at!==12||size!==10||(input[start]&0xd3)||input[start+1]||input[start+2]||input[start+3])bad();
   extended={width:1+input[start+4]+input[start+5]*256+input[start+6]*65536,height:1+input[start+7]+input[start+8]*256+input[start+9]*65536};
  }else if(!['EXIF','XMP ','ICCP'].includes(type))bad();
  at=end+(size%2);
 }
 if(!bitstream||width<1||height<1||width>maxSide||height>maxSide||extended&&(extended.width!==width||extended.height!==height))bad();
 const bytes=new Uint8Array(12+bitstream!.length);bytes.set([82,73,70,70,0,0,0,0,87,69,66,80]);new DataView(bytes.buffer).setUint32(4,bytes.length-8,true);bytes.set(bitstream!,12);
 return {bytes,width,height};
}
