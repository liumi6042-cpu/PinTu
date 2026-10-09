import { readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isPlayableOrigin, RETAINED_STATUSES } from './image-origin.mjs';

const fullHdOptimizedIds=new Set(['mountain-lake-reflection-hd-v3','morning-meadow-tree-hd-v3','clear-sand-bay-hd-v3']);

// This validates provenance records and serving rules, not a legal guarantee.
//
// Two origins are accepted, and they are validated differently on purpose:
//   project-ai-generated — we made it, so we prove how: tool, prompt, reference
//     hashes, provider terms. The prompt archive is what lets anyone reproduce it.
//   user-provided — someone gave it to us, so we prove the right to use it:
//     where it came from and on what basis. There is no prompt to record, and
//     demanding one would only teach people to fabricate it.
// Both are still held to the same non-negotiable rules: a real PNG original that
// matches its record, a complete derived-delivery record, and no unregistered
// file sitting in public/puzzles.
export async function checkImageLibrary(root){
  const catalog=JSON.parse(await readFile(join(root,'content/puzzle-catalog.json'),'utf8'));
  // Check origins before filtering, so an unregistered origin is reported as itself
  // rather than silently vanishing from every downstream list.
  for(const photo of catalog)if(!isPlayableOrigin(photo.origin))throw new Error(`禁止发布未登记来源的图片：${photo.id}`);
  const published=catalog.filter(photo=>isPlayableOrigin(photo.origin)&&photo.status==='published'),restorable=catalog.filter(photo=>isPlayableOrigin(photo.origin)&&RETAINED_STATUSES.includes(photo.status)),ids=new Set(),files=new Set();
  if(!published.length)throw new Error('图库至少需要一张已审核生成图');
  for(const photo of published)if(!photo.publishedAt||!Number.isFinite(Date.parse(photo.publishedAt)))throw new Error(`缺少有效上架时间 publishedAt：${photo.id}`);
  for(const photo of restorable){
    if(!/^[a-z0-9-]+$/.test(photo.id)||ids.has(photo.id)||!/^\/puzzles\/[a-z0-9-]+\.png$/.test(photo.src))throw new Error('图库编号或路径无效');
    ids.add(photo.id);files.add(photo.src.slice('/puzzles/'.length));
    const record=JSON.parse(await readFile(join(root,'content/image-provenance',photo.id+'.json'),'utf8'));
    if(record.id!==photo.id||record.origin!==photo.origin||record.review.status!=='reviewed')throw new Error(`生成来源或审核记录缺失：${photo.id}`);
    if(photo.origin==='project-ai-generated'){
      if(record.generation.tool!=='image_gen')throw new Error(`生成来源或审核记录缺失：${photo.id}`);
      for(const reference of record.generation.referenceImages){
        if(!reference||!/^[a-f0-9]{64}$/.test(reference.sha256))throw new Error(`图片参考来源或用途未获登记：${photo.id}`);
        const legacyProject=reference.origin==='project-ai-generated'&&/^content\/artwork\/gallery-hd\/[a-z0-9-]+\/[a-z0-9-]+\.png$/.test(reference.path);
        const parent=restorable.find(item=>item.id===reference.imageId);
        const catalogProject=reference.origin==='project-ai-generated'&&parent&&parent.id!==photo.id&&reference.path==='public'+parent.src&&reference.purpose==='rendering-style-only';
        // The user supplied these two references and explicitly approved the resulting
        // illustrations. Preserve that provenance; do not call the reference our art.
        let approvedStyle=false;
        if(reference.origin==='user-provided-style-reference'&&['painted-moonlit-portrait-v1','cel-sunset-train-v1'].includes(photo.id)&&/^content\/artwork\/painted-cel-20260914\/style-references\/(painted|cel)-reference\.png$/.test(reference.path)&&reference.purpose==='rendering-style-only'&&reference.authorization==='user-request-2026-09-14'){
          const approvals=JSON.parse(await readFile(join(root,'content/artwork/painted-cel-20260914/approved-style-references.json'),'utf8'));
          approvedStyle=['origin','path','sha256','purpose','authorization'].every(key=>approvals[photo.id]?.[key]===reference[key]);
        }
        if(!legacyProject&&!catalogProject&&!approvedStyle)throw new Error(`图片参考来源或用途未获登记：${photo.id}`);
        if(createHash('sha256').update(await readFile(join(root,reference.path))).digest('hex')!==reference.sha256)throw new Error(`生成参考图哈希不一致：${photo.id}`);
      }
      if(record.generation.promptPath){
        if(!/^content\/image-prompts\/[a-z0-9-]+\.txt$/.test(record.generation.promptPath))throw new Error('提示词存档路径无效');
        if(!(await readFile(join(root,record.generation.promptPath),'utf8')).trim())throw new Error('提示词为空');
      }else if(!(photo.id==='seaside'&&record.generation.legacyPromptUnavailable))throw new Error(`缺少原始提示词：${photo.id}`);
      if(record.commercialUse.basis!=='provider-output-terms'||!record.commercialUse.termsUrl.startsWith('https://openai.com/policies/'))throw new Error('缺少服务条款依据');
    }else{
      // user-provided: the right to publish must be stated, not assumed.
      if(!record.source?.description?.trim())throw new Error(`缺少图片来源说明：${photo.id}`);
      if(!record.rights?.basis?.trim()||!record.rights?.statement?.trim())throw new Error(`缺少使用授权说明：${photo.id}`);
      if(record.generation)throw new Error(`用户提供图片不得伪造生成记录：${photo.id}`);
    }
    const bytes=await readFile(join(root,'public',photo.src.slice(1)));
    if(bytes.subarray(0,8).toString('hex')!=='89504e470d0a1a0a')throw new Error('图片不是登记的 PNG 原件');
    if(bytes.readUInt32BE(16)!==record.width||bytes.readUInt32BE(20)!==record.height||createHash('sha256').update(bytes).digest('hex')!==record.sha256)throw new Error(`图片与原始记录不一致：${photo.id}`);
    if(record.composite){
      if(record.nativeResolution!==false||record.composite.finalUpscaling!==false||record.composite.parts?.length!==4)throw new Error(`拼接来源说明无效：${photo.id}`);
      for(const part of record.composite.parts){
        if(!/^content\/artwork\/gallery-hd\/[a-z0-9-]+\/[a-z0-9-]+\.png$/.test(part.path))throw new Error('拼接分区路径无效');
        const b=await readFile(join(root,part.path));
        if(b.subarray(0,8).toString('hex')!=='89504e470d0a1a0a'||b.readUInt32BE(16)!==part.width||b.readUInt32BE(20)!==part.height||createHash('sha256').update(b).digest('hex')!==part.sha256)throw new Error(`拼接分区来源不一致：${photo.id}`);
      }
    }
    if(record.delivery?.sourceSha256!==record.sha256)throw new Error(`衍生图片缺少原件关联：${photo.id}`);
    for(const [kind,field] of [['play','playSrc'],['thumbnail','thumbSrc'],...(photo.standardSrc?[['standard','standardSrc']]:[])]){
      const item=record.delivery[kind];
      if(!item||item.src!==photo[field]||item.src!==`/puzzles/${photo.id}-${kind}-${item.sha256.slice(0,12)}.webp`||item.format!=='webp'||item.upscaled!==false)throw new Error(`衍生图片记录无效：${photo.id}`);
      const data=await readFile(join(root,'public',item.src.slice(1)));
      if(createHash('sha256').update(data).digest('hex')!==item.sha256||data.length!==item.bytes)throw new Error(`衍生图片哈希不一致：${photo.id}`);
      const size=webpSize(data);
      if(size.width!==item.width||size.height!==item.height)throw new Error(`衍生图片尺寸不一致：${photo.id}`);
      if(kind==='play'&&(item.lossless!==true||!losslessWebp(data)||size.width!==record.width||size.height!==record.height))throw new Error(`游玩图片必须无损并保留原生尺寸：${photo.id}`);
      if(kind==='thumbnail'&&(size.width>480||size.height>384||size.width>record.width||size.height>record.height))throw new Error(`预览图片尺寸过大：${photo.id}`);
      if(kind==='standard'&&(item.lossless!==true||!losslessWebp(data)||item.downsampled!==true||size.width>1774||size.height>1774||size.width>record.width||size.height>record.height))throw new Error(`小片数图片交付记录无效：${photo.id}`);
      files.add(item.src.slice('/puzzles/'.length));
    }
    if(!photo.standardSrc&&(photo.optimizedStandardSrc||record.delivery.compact))throw new Error(`压缩小图缺少标准图来源：${photo.id}`);
    for(const [kind,field] of [['optimized','optimizedSrc'],...(photo.standardSrc?[['compact','optimizedStandardSrc']]:[])]){
      const item=record.delivery[kind],compact=kind==='compact',source=compact?record.delivery.standard:record;
      const expectedQuality=compact?84:fullHdOptimizedIds.has(photo.id)?88:84;
      if(!item||typeof item.src!=='string'||!/^[a-f0-9]{64}$/.test(item.sha256)||item.src!==photo[field]||item.src!==`/puzzles/${photo.id}-${kind}-${item.sha256.slice(0,12)}.webp`||item.format!=='webp'||item.lossless!==false||item.upscaled!==false||item.quality!==expectedQuality)throw new Error(`压缩交付记录无效：${photo.id}`);
      if(item.sourceSha256!==record.sha256||item.inputSha256!==source.sha256)throw new Error(`压缩交付原件关联无效：${photo.id}`);
      if(item.encoding?.library!=='sharp'||typeof item.encoding.version!=='string'||!item.encoding.version||item.encoding.effort!==5||item.encoding.smartSubsample!==true)throw new Error(`压缩交付编码记录无效：${photo.id}`);
      const data=await readFile(join(root,'public',item.src.slice(1)));
      if(createHash('sha256').update(data).digest('hex')!==item.sha256||data.length!==item.bytes)throw new Error(`压缩交付哈希或字节不一致：${photo.id}`);
      if(data.length>(compact?700*1024:2*1024*1024))throw new Error(`压缩交付超过体积预算：${photo.id}`);
      const size=lossyWebpSize(data);
      if(!size)throw new Error(`压缩交付必须是静态 VP8 有损 WebP：${photo.id}`);
      if(size.width!==item.width||size.height!==item.height||size.width!==source.width||size.height!==source.height)throw new Error(`压缩交付不得改变来源像素尺寸：${photo.id}`);
      if(compact&&(item.downsampled!==true||item.maximumPieces!==1000||size.width>1774||size.height>1774))throw new Error(`压缩小图交付记录无效：${photo.id}`);
      files.add(item.src.slice('/puzzles/'.length));
    }
  }
  const served=await readdir(join(root,'public/puzzles'));
  for(const file of served)if(!files.has(file))throw new Error(`public/puzzles 中存在未登记或未审核素材：${file}`);
  return {published:published.length};
}

// Read the actual VP8 key-frame dimensions, not just an optional VP8X canvas.
// No animated, lossless or alpha payload can masquerade as optimized delivery.
function lossyWebpSize(data){
  if(data.length<30||data.toString('ascii',0,4)!=='RIFF'||data.toString('ascii',8,12)!=='WEBP'||data.readUInt32LE(4)+8!==data.length)return null;
  let frame=null,canvas=null,offset=12;
  while(offset+8<=data.length){
    const kind=data.toString('ascii',offset,offset+4),length=data.readUInt32LE(offset+4),start=offset+8,end=start+length;
    if(end+(length%2)>data.length)return null;
    if(kind==='VP8 '){
      if(frame||length<10||(data[start]&1)!==0||data.toString('hex',start+3,start+6)!=='9d012a')return null;
      const partitionSize=data.readUIntLE(start,3)>>>5;
      if(partitionSize>length-10)return null;
      frame={width:data.readUInt16LE(start+6)&0x3fff,height:data.readUInt16LE(start+8)&0x3fff};
      if(!frame.width||!frame.height)return null;
    }else if(kind==='VP8X'){
      if(canvas||length!==10||(data[start]&0x12)!==0)return null;
      canvas={width:1+data.readUIntLE(start+4,3),height:1+data.readUIntLE(start+7,3)};
    }else if(['VP8L','ANIM','ANMF','ALPH'].includes(kind))return null;
    offset=end+(length%2);
  }
  if(offset!==data.length||!frame||canvas&&(canvas.width!==frame.width||canvas.height!==frame.height))return null;
  return frame;
}
function losslessWebp(data){
  let lossless=false;
  for(let offset=12;offset+8<=data.length;){
    const kind=data.toString('ascii',offset,offset+4),length=data.readUInt32LE(offset+4);
    if(offset+8+length>data.length)return false;
    if(kind==='VP8 '||kind==='ANIM'||kind==='ANMF')return false;
    if(kind==='VP8L')lossless=true;
    offset+=8+length+(length%2);
  }
  return lossless;
}
function webpSize(data){
  if(data.toString('ascii',0,4)!=='RIFF'||data.toString('ascii',8,12)!=='WEBP')throw new Error('衍生图片不是 WebP');
  for(let offset=12;offset+8<=data.length;){
    const kind=data.toString('ascii',offset,offset+4),length=data.readUInt32LE(offset+4),start=offset+8;
    if(start+length>data.length)break;
    if(kind==='VP8X'&&length>=10)return{width:1+data.readUIntLE(start+4,3),height:1+data.readUIntLE(start+7,3)};
    if(kind==='VP8L'&&length>=5){const bits=data.readUInt32LE(start+1);return{width:1+(bits&0x3fff),height:1+((bits>>>14)&0x3fff)};}
    if(kind==='VP8 '&&length>=10)return{width:data.readUInt16LE(start+6)&0x3fff,height:data.readUInt16LE(start+8)&0x3fff};
    offset=start+length+(length%2);
  }
  throw new Error('无法读取 WebP 尺寸');
}

if(process.argv[1]&&fileURLToPath(import.meta.url)===resolve(process.argv[1])){
  try{const result=await checkImageLibrary(resolve(fileURLToPath(new URL('..',import.meta.url))));console.log(`图库来源校验通过：${result.published} 张已审核图片`);}
  catch(error){console.error(error.message);process.exitCode=1;}
}
