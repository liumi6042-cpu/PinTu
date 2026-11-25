import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {cleanUserWebP} from '../lib/user-image-format.ts';
import {USER_IMAGE_MAX_BYTES,USER_THUMB_MAX_BYTES,isCustomImageId,customPhoto} from '../lib/custom-images.ts';
import catalog from '../content/puzzle-catalog.json' with {type:'json'};
const source=new Uint8Array(readFileSync('public'+catalog.find(p=>p.id==='mountain-lake-reflection').thumbSrc));
function withChunk(source,type,payload){const chunk=new Uint8Array(8+payload.length+(payload.length%2));chunk.set(new TextEncoder().encode(type));new DataView(chunk.buffer).setUint32(4,payload.length,true);chunk.set(payload,8);const out=new Uint8Array(source.length+chunk.length);out.set(source);out.set(chunk,source.length);new DataView(out.buffer).setUint32(4,out.length-8,true);return out;}
test('accepts actual WebP thumbnails and strips metadata without resampling pixels',()=>{
 const image=cleanUserWebP(source,USER_THUMB_MAX_BYTES,480);assert.equal(Math.max(image.width,image.height),480);
 const tagged=withChunk(image.bytes,'EXIF',new TextEncoder().encode('GPS and other private metadata'));
 assert.deepEqual(cleanUserWebP(tagged,USER_IMAGE_MAX_BYTES).bytes,image.bytes);
 assert.deepEqual(cleanUserWebP(image.bytes,USER_IMAGE_MAX_BYTES).bytes,image.bytes);
});
test('rejects invalid, oversized, animated and multi-image containers',()=>{
 assert.throws(()=>cleanUserWebP(source,4));assert.throws(()=>cleanUserWebP(source,USER_IMAGE_MAX_BYTES,10));
 assert.throws(()=>cleanUserWebP(source.slice(0,-1),USER_IMAGE_MAX_BYTES));
 const forged=source.slice();forged.set(new TextEncoder().encode('<svg'),0);assert.throws(()=>cleanUserWebP(forged,USER_IMAGE_MAX_BYTES));
 assert.throws(()=>cleanUserWebP(withChunk(source,'ANIM',new Uint8Array(6)),USER_IMAGE_MAX_BYTES));
 assert.throws(()=>cleanUserWebP(withChunk(source,'VP8L',new Uint8Array([0x2f,0,0,0,0])),USER_IMAGE_MAX_BYTES));
 const trailing=new Uint8Array(source.length+2);trailing.set(source);assert.throws(()=>cleanUserWebP(trailing,USER_IMAGE_MAX_BYTES));
});
test('custom image links stay in the authenticated endpoint and out of the public catalogue',()=>{
 const image={id:'custom-'+'a'.repeat(32),title:'My photo',width:1200,height:960};assert.ok(isCustomImageId(image.id));assert.ok(!isCustomImageId('custom-../../file'));
 const photo=customPhoto(image,'b'.repeat(32));assert.equal(photo.src,'/api/user-images/'+image.id+'?room='+'b'.repeat(32));assert.equal(photo.thumbSrc,photo.src+'&preview=1');assert.ok(!catalog.some(p=>p.id===image.id));
});
