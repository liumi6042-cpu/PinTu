// Read-only administration display of the separately registered runtime artwork.
// Never rewrites original provenance, catalogs, pending registry or source baseline.
import {existsSync,lstatSync,readFileSync,realpathSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {join,resolve,relative,sep,isAbsolute} from 'node:path';

const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const digest=/^[a-f0-9]{64}$/;
const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const fail=message=>{throw Object.assign(new Error('升级图片预览登记无效：'+message),{status:409,code:'INVALID_ARTWORK_PREVIEW'});};
const equalSnapshot=(a,b)=>['revision','src','thumbSrc','width','height'].every(key=>a?.[key]===b?.[key]);
function fileWithin(root,name){
 if(typeof name!=='string'||!name||name.includes('\\')||name.includes(':')||name.startsWith('/')||name.split('/').some(part=>!part||part==='.'||part==='..'))fail('路径必须是受控项目内的相对路径');
 const file=resolve(root,name),part=relative(root,file);
 if(!part||part==='..'||part.startsWith('..'+sep)||isAbsolute(part))fail('文件超出项目目录');
 let cursor=root;for(const segment of part.split(sep)){cursor=join(cursor,segment);if(lstatSync(cursor).isSymbolicLink())fail('文件路径包含符号链接或目录联接');}
 if(!lstatSync(file).isFile())fail('预览不是普通文件');return file;
}
function lossySize(bytes){
 if(bytes.length<20||bytes.toString('ascii',0,4)!=='RIFF'||bytes.toString('ascii',8,12)!=='WEBP'||bytes.readUInt32LE(4)+8!==bytes.length)fail('文件不是完整WebP');
 let offset=12,frame=null,canvas=null;
 while(offset+8<=bytes.length){
  const kind=bytes.toString('ascii',offset,offset+4),size=bytes.readUInt32LE(offset+4),start=offset+8,end=start+size;
  if(end+(size%2)>bytes.length||['ANIM','ANMF','VP8L'].includes(kind))fail('只允许完整静态有损WebP');
  if(kind==='VP8X'){if(canvas||size!==10||(bytes[start]&0x02))fail('WebP画布无效');canvas={width:1+bytes.readUIntLE(start+4,3),height:1+bytes.readUIntLE(start+7,3)};}
  if(kind==='VP8 '){if(frame||size<10||(bytes[start]&1)||bytes.toString('hex',start+3,start+6)!=='9d012a')fail('WebP帧无效');frame={width:bytes.readUInt16LE(start+6)&0x3fff,height:bytes.readUInt16LE(start+8)&0x3fff};}
  offset=end+(size%2);
 }
 if(offset!==bytes.length||!frame||!frame.width||!frame.height||(canvas&&(canvas.width!==frame.width||canvas.height!==frame.height)))fail('WebP尺寸不符');return frame;
}
function checkedWebp(root,facts){
 const file=fileWithin(root,'public'+facts.src),bytes=readFileSync(file);
 if(bytes.length!==facts.bytes||sha(bytes)!==facts.sha256)fail('文件摘要或大小不符');
 const size=lossySize(bytes);if(size.width!==facts.width||size.height!==facts.height)fail('文件尺寸与登记不一致');return file;
}

/** Fixed project root + trusted ID registry only; no request-supplied file paths. */
export function readActivePreviews(mobileRoot,catalog){
 const root=realpathSync(mobileRoot),registryPath=join(root,'content/artwork-revisions.json');
 if(!existsSync(registryPath))return new Map();
 const registry=JSON.parse(readFileSync(fileWithin(root,'content/artwork-revisions.json'),'utf8'));
 if(registry?.schema!=='jigsaw-artwork-revisions/v1'||!['active','versions','legacy','files'].every(key=>plain(registry[key])))fail('版本清单结构无效');
 const photos=new Map(catalog.map(photo=>[photo.id,photo])),previews=new Map();
 for(const[id,revision]of Object.entries(registry.active)){
  const photo=photos.get(id);
  if(!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)||!photo||!digest.test(revision))fail('图片ID或画质版本未登记');
  const record=JSON.parse(readFileSync(fileWithin(root,'content/image-provenance/'+id+'.json'),'utf8'));
  if(record.id!==id||record.origin!==photo.origin||record.review?.status!=='reviewed'||!digest.test(record.sha256))fail('原作品来源身份不符');
  const legacy={revision:record.sha256,src:photo.optimizedSrc??photo.playSrc,thumbSrc:photo.thumbSrc,width:record.width,height:record.height};
  const versions=registry.versions[id],active=Array.isArray(versions)?versions.filter(value=>value.revision===revision):[];
  if(!Array.isArray(versions)||!equalSnapshot(registry.legacy[id],legacy)||!versions.some(value=>equalSnapshot(value,legacy))||active.length!==1||revision===record.sha256)fail('旧图与当前画质版本不匹配');
  const snapshot=active[0];
  if(Object.keys(snapshot).sort().join(',')!=='height,revision,src,thumbSrc,width'||Object.keys(registry.legacy[id]).sort().join(',')!=='height,revision,src,thumbSrc,width'||!Number.isSafeInteger(snapshot.width)||snapshot.width<=0||!Number.isSafeInteger(snapshot.height)||snapshot.height<=0)fail('当前画质尺寸无效');
  const files={};
  for(const[kind,url]of [['preview',snapshot.src],['thumbnail',snapshot.thumbSrc]]){
   const facts=registry.files[url],suffix=kind==='preview'?'optimized':'thumbnail';
   if(!plain(facts)||facts.src!==url||!digest.test(facts.sha256)||url!==`/puzzles/${id}-${suffix}-${facts.sha256.slice(0,12)}.webp`||facts.sourceSha256!==revision||facts.format!=='webp'||facts.lossless!==false||facts.quality!==(kind==='preview'?70:82)||!Number.isSafeInteger(facts.bytes)||facts.bytes<=0||facts.bytes>2*1024*1024||!Number.isSafeInteger(facts.width)||facts.width<=0||!Number.isSafeInteger(facts.height)||facts.height<=0)fail('当前压缩图或缩略图未精确登记');
   if(kind==='preview'&&(facts.width!==snapshot.width||facts.height!==snapshot.height))fail('当前压缩图改变原生尺寸');
   if(kind==='thumbnail'&&(facts.width>480||facts.height>384||facts.width>snapshot.width||facts.height>snapshot.height||Math.abs(facts.width/facts.height/(snapshot.width/snapshot.height)-1)>.01))fail('缩略图超出尺寸或比例限制');
   checkedWebp(root,facts);files[kind]=Object.freeze({...facts});
  }
  previews.set(id,{root,files,display:Object.freeze({revision,width:snapshot.width,height:snapshot.height,direction:snapshot.width>snapshot.height?'landscape':snapshot.width<snapshot.height?'portrait':'square',quality:70,bytes:files.preview.bytes,thumbnailBytes:files.thumbnail.bytes})});
 }
 return previews;
}

export function activePreviewFile(previews,id,kind){
 const preview=previews?.get(id);if(!preview)return null;
 if(!['preview','thumbnail'].includes(kind))fail('预览类型无效');
 return checkedWebp(preview.root,preview.files[kind]);
}
