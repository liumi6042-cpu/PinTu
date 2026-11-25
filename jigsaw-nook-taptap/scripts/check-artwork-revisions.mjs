// Strict supplementary validation of the runtime artwork overlay. Base catalog,
// source authorization, PNG provenance and derivatives remain checked separately.
import {readFile,lstat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {join,relative,resolve,sep,isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
import {resolveMediaDir,safeMediaFile} from './media-paths.mjs';

const digest=/^[a-f0-9]{64}$/;
const idPattern=/^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const fail=message=>{throw Error('Artwork revision validation: '+message);};
const sameSnapshot=(a,b)=>['revision','src','thumbSrc','width','height'].every(key=>a?.[key]===b?.[key]);
async function fileWithin(root,name){
 if(typeof name!=='string'||!name||name.includes('\\')||name.includes(':')||name.startsWith('/')||name.split('/').some(part=>!part||part==='.'||part==='..'))fail('unsafe relative file');
 const file=resolve(root,name),part=relative(root,file);
 if(!part||part==='..'||part.startsWith('..'+sep)||isAbsolute(part))fail('file escaped project root');
 let cursor=root;for(const segment of part.split(sep)){cursor=join(cursor,segment);if((await lstat(cursor)).isSymbolicLink())fail('symlink or junction in artwork path');}
 if(!(await lstat(file)).isFile())fail('artwork is not a regular file');
 return file;
}
async function jsonAt(root,name){return JSON.parse(await readFile(await fileWithin(root,name),'utf8'));}
function lossySize(bytes){
 if(bytes.length<20||bytes.toString('ascii',0,4)!=='RIFF'||bytes.toString('ascii',8,12)!=='WEBP'||bytes.readUInt32LE(4)+8!==bytes.length)fail('overlay must be a complete WebP');
 let offset=12,frame=null,canvas=null;
 while(offset+8<=bytes.length){
  const kind=bytes.toString('ascii',offset,offset+4),size=bytes.readUInt32LE(offset+4),start=offset+8,end=start+size;
  if(end+(size%2)>bytes.length)fail('incomplete WebP chunk');
  if(['ANIM','ANMF','VP8L'].includes(kind))fail('overlay must be static lossy WebP');
  if(kind==='VP8X'){
   if(canvas||size!==10||(bytes[start]&0x02))fail('invalid or animated WebP canvas');
   canvas={width:1+bytes.readUIntLE(start+4,3),height:1+bytes.readUIntLE(start+7,3)};
  }
  if(kind==='VP8 '){
   if(frame||size<10||(bytes[start]&1)||bytes.toString('hex',start+3,start+6)!=='9d012a')fail('invalid lossy WebP key frame');
   frame={width:bytes.readUInt16LE(start+6)&0x3fff,height:bytes.readUInt16LE(start+8)&0x3fff};
  }
  offset=end+(size%2);
 }
 if(offset!==bytes.length||!frame||!frame.width||!frame.height||(canvas&&(canvas.width!==frame.width||canvas.height!==frame.height)))fail('WebP frame/canvas dimensions differ');
 return frame;
}

/** Returns exactly the new hash-validated puzzle filenames the base checker may allow. */
export async function checkArtworkRevisions(root){
 root=resolve(root);
 let registry;
 try{registry=await jsonAt(root,'content/artwork-revisions.json');}catch(error){if(error.code==='ENOENT')return{files:[],activeImages:0,overlayFiles:0};throw error;}
 if(!plain(registry)||registry.schema!=='jigsaw-artwork-revisions/v1'||!['legacy','versions','active','files'].every(key=>plain(registry[key])))fail('invalid registry schema');
 const catalog=await jsonAt(root,'content/puzzle-catalog.json');
 if(!Array.isArray(catalog)||new Set(catalog.map(photo=>photo.id)).size!==catalog.length)fail('invalid base catalog');
 const byId=new Map(catalog.map(photo=>[photo.id,photo])),expected=new Map();
 for(const id of [...Object.keys(registry.versions),...Object.keys(registry.legacy),...Object.keys(registry.active)])if(!idPattern.test(id)||!byId.has(id))fail('unknown image ID: '+id);
 for(const photo of catalog){
  const record=await jsonAt(root,'content/image-provenance/'+photo.id+'.json');
  const base={revision:record.sha256,src:photo.optimizedSrc??photo.playSrc,thumbSrc:photo.thumbSrc,width:record.width,height:record.height};
  const compact=photo.optimizedStandardSrc&&record.delivery?.compact?{revision:record.sha256,src:photo.optimizedStandardSrc,thumbSrc:photo.thumbSrc,width:record.delivery.compact.width,height:record.delivery.compact.height}:null;
  const versions=registry.versions[photo.id];
  if(!Array.isArray(versions)||!versions.length||!versions.some(item=>sameSnapshot(item,base)))fail('missing base revision: '+photo.id);
  const keys=new Set();
  for(const snapshot of versions){
   if(!plain(snapshot)||Object.keys(snapshot).sort().join(',')!=='height,revision,src,thumbSrc,width'||!digest.test(snapshot.revision)||!Number.isSafeInteger(snapshot.width)||snapshot.width<=0||!Number.isSafeInteger(snapshot.height)||snapshot.height<=0)fail('invalid room snapshot: '+photo.id);
   const key=JSON.stringify(['revision','src','thumbSrc','width','height'].map(field=>snapshot[field]));if(keys.has(key))fail('duplicate room snapshot: '+photo.id);keys.add(key);
   if(sameSnapshot(snapshot,base)||(compact&&sameSnapshot(snapshot,compact)))continue;
   if(snapshot.revision===record.sha256)fail('unknown file under an existing base revision: '+photo.id);
   for(const[kind,url]of [['optimized',snapshot.src],['thumbnail',snapshot.thumbSrc]]){
    const facts=registry.files[url];
    if(!plain(facts)||facts.src!==url||!digest.test(facts.sha256)||url!==`/puzzles/${photo.id}-${kind}-${facts.sha256.slice(0,12)}.webp`||facts.format!=='webp'||facts.lossless!==false||facts.quality!==(kind==='optimized'?70:82)||facts.sourceSha256!==snapshot.revision||!Number.isSafeInteger(facts.bytes)||facts.bytes<=0||facts.bytes>2*1024*1024||!Number.isSafeInteger(facts.width)||facts.width<=0||!Number.isSafeInteger(facts.height)||facts.height<=0)fail('invalid overlay delivery facts: '+photo.id+'/'+kind);
    if(kind==='optimized'&&(facts.width!==snapshot.width||facts.height!==snapshot.height))fail('overlay changes native output dimensions: '+photo.id);
    if(kind==='thumbnail'&&(facts.width>480||facts.height>384||facts.width>snapshot.width||facts.height>snapshot.height||Math.abs(facts.width/facts.height/(snapshot.width/snapshot.height)-1)>.01))fail('invalid overlay thumbnail dimensions: '+photo.id);
    const prior=expected.get(url);if(prior&&JSON.stringify(prior)!==JSON.stringify(facts))fail('conflicting overlay URL facts');expected.set(url,facts);
   }
  }
  if(registry.legacy[photo.id]&&(!plain(registry.legacy[photo.id])||Object.keys(registry.legacy[photo.id]).sort().join(',')!=='height,revision,src,thumbSrc,width'||!versions.some(item=>sameSnapshot(item,registry.legacy[photo.id]))))fail('legacy fallback is not an exact known snapshot: '+photo.id);
  if(registry.legacy[photo.id]&&!sameSnapshot(registry.legacy[photo.id],base))fail('legacy fallback differs from untouched base artwork: '+photo.id);
  if(Object.hasOwn(registry.active,photo.id)){
   const active=registry.active[photo.id];
   if(!digest.test(active)||!registry.legacy[photo.id]||versions.filter(item=>item.revision===active).length!==1||active===record.sha256)fail('active revision is not an unambiguous new candidate: '+photo.id);
  }
 }
 if(Object.keys(registry.files).length!==expected.size||Object.keys(registry.files).some(url=>!expected.has(url)))fail('unreferenced or missing overlay file metadata');
 const files=[],puzzlesDir=resolveMediaDir(root,'puzzles');
 for(const[url,facts]of expected){
  const bytes=await readFile(safeMediaFile(puzzlesDir,url.slice('/puzzles/'.length)));
  if(bytes.length!==facts.bytes||sha(bytes)!==facts.sha256)fail('overlay file hash/size differs: '+url);
  const size=lossySize(bytes);if(size.width!==facts.width||size.height!==facts.height)fail('overlay file dimensions differ: '+url);
  files.push(url.slice('/puzzles/'.length));
 }
 return{files,activeImages:Object.keys(registry.active).length,overlayFiles:files.length};
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{console.log(JSON.stringify(await checkArtworkRevisions(resolve(import.meta.dirname,'..'))));}catch(error){console.error(error.message);process.exitCode=1;}
}
