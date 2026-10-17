import { readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isPlayableOrigin, RETAINED_STATUSES } from './image-origin.mjs';
import { checkArtworkRevisions } from './check-artwork-revisions.mjs';

const fullHdOptimizedIds=new Set(['mountain-lake-reflection-hd-v3','morning-meadow-tree-hd-v3','clear-sand-bay-hd-v3']);
const OPENAI_TERMS='https://openai.com/policies/row-terms-of-use/';
const DOUBAO_TERMS='https://docs.volcengine.com/docs/ark/doubao-model-service-agreement?lang=zh';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');

/** A reference redraw is still project-generated, with both providers recorded.
 * This branch proves the actual local inputs/outputs instead of relabeling an
 * external result as image_gen or weakening the original source checks. */
export async function checkReferenceRedraw(root,photo,record){
  const fail=message=>{throw Error('参考高清来源无效：'+photo.id+' / '+message);};
  const generation=record.generation,stages=generation?.stages;
  if(generation?.method!=='builtin-original-reference-redraw'||generation.provider!=='Volcengine Ark'||generation.tool!=='images/generations'||!/^doubao-seedream-[a-z0-9-]+$/.test(generation.model??'')||!Array.isArray(stages)||stages.length!==2)fail('生成工具或阶段');
  const [original,redraw]=stages;
  if(original.role!=='original-artwork'||original.provider!=='OpenAI'||original.tool!=='image_gen'||redraw.role!=='reference-hd-redraw')fail('阶段来源');
  for(const key of ['provider','tool','model','generatedAt'])if(redraw[key]!==generation[key])fail('最终阶段 '+key);
  if(record.nativeResolution!==true||record.upscaled!==false)fail('原生输出标志');
  if(record.commercialUse?.basis!=='provider-output-terms'||record.commercialUse.termsUrl!==DOUBAO_TERMS||JSON.stringify(record.commercialUse.referenceTermsUrls)!==JSON.stringify([OPENAI_TERMS])||record.commercialUse.exclusiveRightsGuaranteed!==false)fail('双服务条款依据');
  const nativeAt=async(item,expectedPath)=>{
    if(item?.path!==expectedPath||!Number.isSafeInteger(item.width)||item.width<=0||!Number.isSafeInteger(item.height)||item.height<=0||!Number.isSafeInteger(item.bytes)||item.bytes<=0||!/^[a-f0-9]{64}$/.test(item.sha256??''))fail('原生文件记录');
    const bytes=await readFile(join(root,expectedPath));
    if(bytes.length<24||bytes.subarray(0,8).toString('hex')!=='89504e470d0a1a0a'||bytes.length!==item.bytes||bytes.readUInt32BE(16)!==item.width||bytes.readUInt32BE(20)!==item.height||sha(bytes)!==item.sha256)fail('原生PNG尺寸或哈希');
  };
  const references=generation.referenceImages;
  const originalPath='content/artwork/gallery-hd/'+photo.id+'/reference-original.png',nativePath='content/artwork/gallery-hd/'+photo.id+'/native.png';
  if(!Array.isArray(references)||references.length!==1||references[0].origin!=='project-ai-generated'||references[0].path!==originalPath||references[0].sha256!==original.native.sha256||references[0].purpose!=='same-artwork-reference-redraw')fail('参考原画');
  const receipts=[];
  for(const [index,stage] of stages.entries()){
    if(!Number.isFinite(Date.parse(stage.generatedAt))||stage.commercialUse?.basis!=='provider-output-terms'||stage.commercialUse.termsUrl!==(index?DOUBAO_TERMS:OPENAI_TERMS)||stage.commercialUse.exclusiveRightsGuaranteed!==false)fail('阶段日期或条款');
    await nativeAt(stage.native,index?nativePath:originalPath);
    const promptPath='content/image-prompts/'+photo.id+(index?'':'-original')+'.txt';
    if(stage.promptPath!==promptPath||(index&&generation.promptPath!==promptPath))fail('阶段提示词路径');
    const prompt=(await readFile(join(root,promptPath),'utf8')).trim();if(!prompt)fail('阶段提示词为空');
    if(!Array.isArray(stage.evidence)||stage.evidence.length!==(index?2:1))fail('阶段证据数量');
    const evidence=[];
    for(const [evidenceIndex,item] of stage.evidence.entries()){
      const expectedPath='content/artwork/gallery-hd/'+photo.id+'/stage-'+index+'-evidence-'+evidenceIndex+'.json';
      if(item?.path!==expectedPath||!Number.isSafeInteger(item.bytes)||item.bytes<=0||item.bytes>1024*1024||!/^[a-f0-9]{64}$/.test(item.sha256??''))fail('阶段证据路径或摘要');
      const bytes=await readFile(join(root,expectedPath));
      if(bytes.length!==item.bytes||sha(bytes)!==item.sha256)fail('阶段证据哈希');
      const text=bytes.toString('utf8');if(/ark-[a-z0-9-]{20,}|Bearer\s+[a-z0-9_-]+|"(?:api[_-]?key|authorization)"\s*:/i.test(text))fail('证据包含凭据');
      evidence.push(JSON.parse(text));
    }
    receipts.push({prompt,evidence});
  }
  for(const key of ['sha256','width','height'])if(redraw.native[key]!==record[key])fail('最终输出与原件不符');
  for(const key of ['path','sha256','width','height','bytes'])if(generation.native?.[key]!==redraw.native[key])fail('最终原生记录不符');
  const built=receipts[0].evidence[0],request=receipts[1].evidence[0],result=receipts[1].evidence[1];
  if(built.ok!==true||built.method!=='builtin'||built.prompt?.trim()!==receipts[0].prompt||built.sha256!==original.native.sha256||built.actualWidth!==original.native.width||built.actualHeight!==original.native.height||built.bytes!==original.native.bytes||built.createdAt!==original.generatedAt)fail('内置原画回执');
  if(request.endpoint!=='https://ark.cn-beijing.volces.com/api/v3/images/generations'||request.model!==redraw.model||request.prompt?.trim()!==receipts[1].prompt||request.size!==record.width+'x'+record.height||request.output_format!=='png'||request.image!=='[REFERENCE_BASE64_OMITTED]')fail('参考重绘请求');
  for(const key of ['sha256','width','height','bytes'])if(request.reference?.[key]!==original.native[key]||result.reference?.[key]!==original.native[key])fail('请求参考原画不符');
  if(result.ok!==true||result.method!=='builtin-reference-doubao-hd'||result.model!==redraw.model||result.prompt?.trim()!==receipts[1].prompt||result.requestedSize!==request.size||result.sha256!==record.sha256||result.width!==record.width||result.height!==record.height||result.bytes!==redraw.native.bytes||result.completedAt!==redraw.generatedAt)fail('参考重绘结果回执');
  return true;
}

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
      const referenceRedraw=record.generation?.method==='builtin-original-reference-redraw';
      if(referenceRedraw)await checkReferenceRedraw(root,photo,record);
      else if(record.generation.tool!=='image_gen')throw new Error(`生成来源或审核记录缺失：${photo.id}`);
      for(const reference of referenceRedraw?[]:record.generation.referenceImages){
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
      if(!referenceRedraw&&(record.commercialUse.basis!=='provider-output-terms'||!record.commercialUse.termsUrl.startsWith('https://openai.com/policies/')))throw new Error('缺少服务条款依据');
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
    // Since 2026-10-17 the playable build and the gallery build share one file:
    // playSrc === optimizedSrc. Only validate play when it is a separate file.
    for(const [kind,field] of [...(photo.playSrc&&photo.playSrc!==photo.optimizedSrc?[['play','playSrc']]:[]),['thumbnail','thumbSrc'],...(photo.standardSrc?[['standard','standardSrc']]:[])]){
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
    // One uniform delivery rule since 2026-10-17 (no separate lossless play file):
    //   optimized  Q70, longest side 2560  — rooms with 300+ pieces
    //   compact    Q60, longest side 1600  — rooms under 300 pieces
    //   thumbnail  Q82, 384 box
    for(const [kind,field] of [['optimized','optimizedSrc'],...(photo.optimizedStandardSrc?[['compact','optimizedStandardSrc']]:[])]){
      const item=record.delivery[kind],compact=kind==='compact';
      const expectedQuality=compact?60:70,cap=compact?1600:2560;
      if(!item||typeof item.src!=='string'||!/^[a-f0-9]{64}$/.test(item.sha256)||item.src!==photo[field]||item.src!==`/puzzles/${photo.id}-${kind}-${item.sha256.slice(0,12)}.webp`||item.format!=='webp'||item.lossless!==false||item.upscaled!==false||item.quality!==expectedQuality)throw new Error(`压缩交付记录无效：${photo.id}`);
      if(item.sourceSha256!==record.sha256||item.inputSha256!==record.sha256)throw new Error(`压缩交付原件关联无效：${photo.id}`);
      if(item.encoding?.library!=='sharp'||typeof item.encoding.version!=='string'||!item.encoding.version||item.encoding.effort!==6||item.encoding.smartSubsample!==true)throw new Error(`压缩交付编码记录无效：${photo.id}`);
      const data=await readFile(join(root,'public',item.src.slice(1)));
      if(createHash('sha256').update(data).digest('hex')!==item.sha256||data.length!==item.bytes)throw new Error(`压缩交付哈希或字节不一致：${photo.id}`);
      if(data.length>(compact?700*1024:2*1024*1024))throw new Error(`压缩交付超过体积预算：${photo.id}`);
      const size=lossyWebpSize(data);
      if(!size)throw new Error(`压缩交付必须是静态 VP8 有损 WebP：${photo.id}`);
      if(size.width!==item.width||size.height!==item.height)throw new Error(`压缩交付记录尺寸不一致：${photo.id}`);
      if(Math.max(size.width,size.height)!==Math.min(cap,Math.max(record.width,record.height)))throw new Error(`压缩交付长边必须为 ${cap} 或原生尺寸：${photo.id}`);
      if(size.width>record.width||size.height>record.height)throw new Error(`压缩交付不得放大：${photo.id}`);
      if(compact&&(item.downsampled!==true||item.maximumPieces!==300||size.width>1600||size.height>1600))throw new Error(`压缩小图交付记录无效：${photo.id}`);
      files.add(item.src.slice('/puzzles/'.length));
    }
  }
  const artworkOverlay=await checkArtworkRevisions(root);
  for(const file of artworkOverlay.files)files.add(file);
  const served=await readdir(join(root,'public/puzzles'));
  // Files from earlier deliveries stay on disk so rooms created before a
  // re-encode keep resolving; they are listed explicitly instead of guessed.
  let legacyFiles=new Set();
  try{legacyFiles=new Set(JSON.parse(await readFile(join(root,'content/legacy-artwork-files.json'),'utf8')).files);}catch{}
  for(const file of served)if(!files.has(file)&&!legacyFiles.has(file))throw new Error(`public/puzzles 中存在未登记或未审核素材：${file}`);
  return {published:published.length,artworkOverlay:{activeImages:artworkOverlay.activeImages,files:artworkOverlay.overlayFiles}};
}

// Read the actual VP8 key-frame dimensions, not just an optional VP8X canvas.
// Static lossy VP8 may have the standard VP8X + ALPH wrapper. Animation and
// lossless color frames still cannot masquerade as optimized delivery.
function lossyWebpSize(data){
  if(data.length<30||data.toString('ascii',0,4)!=='RIFF'||data.toString('ascii',8,12)!=='WEBP'||data.readUInt32LE(4)+8!==data.length)return null;
  let frame=null,canvas=null,alpha=null,alphaFlag=false,offset=12;
  while(offset+8<=data.length){
    const kind=data.toString('ascii',offset,offset+4),length=data.readUInt32LE(offset+4),start=offset+8,end=start+length;
    if(end+(length%2)>data.length||(length%2&&data[end]!==0))return null;
    if(kind==='VP8 '){
      if(frame||length<10||(data[start]&1)!==0||data.toString('hex',start+3,start+6)!=='9d012a')return null;
      const partitionSize=data.readUIntLE(start,3)>>>5;
      if(partitionSize>length-10)return null;
      frame={width:data.readUInt16LE(start+6)&0x3fff,height:data.readUInt16LE(start+8)&0x3fff};
      if(!frame.width||!frame.height)return null;
    }else if(kind==='VP8X'){
      if(offset!==12||canvas||length!==10||(data[start]&0xc3)!==0||data.readUIntLE(start+1,3)!==0)return null;
      alphaFlag=(data[start]&0x10)!==0;
      canvas={width:1+data.readUIntLE(start+4,3),height:1+data.readUIntLE(start+7,3)};
    }else if(kind==='ALPH'){
      if(!canvas||!alphaFlag||alpha||frame||length<2)return null;
      const header=data[start],compression=header&3;
      if((header&0xc0)!==0||((header>>>4)&3)>1||compression>1)return null;
      if(compression===0&&length!==1+canvas.width*canvas.height)return null;
      alpha={compression};
    }else if(['VP8L','ANIM','ANMF'].includes(kind))return null;
    offset=end+(length%2);
  }
  if(offset!==data.length||!frame||alphaFlag!==!!alpha||canvas&&(canvas.width!==frame.width||canvas.height!==frame.height))return null;
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
