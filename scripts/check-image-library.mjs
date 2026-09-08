import { readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// This validates provenance records and serving rules, not a legal guarantee.
export async function checkImageLibrary(root){
  const catalog=JSON.parse(await readFile(join(root,'content/puzzle-catalog.json'),'utf8'));
  const published=catalog.filter(photo=>photo.status==='published'),restorable=catalog.filter(photo=>['published','archived'].includes(photo.status)),ids=new Set(),files=new Set();
  if(!published.length)throw new Error('图库至少需要一张已审核生成图');
  for(const photo of restorable){
    if(photo.origin!=='project-ai-generated')throw new Error(`禁止发布外部来源图片：${photo.id}`);
    if(!/^[a-z0-9-]+$/.test(photo.id)||ids.has(photo.id)||!/^\/puzzles\/[a-z0-9-]+\.png$/.test(photo.src))throw new Error('图库编号或路径无效');
    ids.add(photo.id);files.add(photo.src.slice('/puzzles/'.length));
    const record=JSON.parse(await readFile(join(root,'content/image-provenance',photo.id+'.json'),'utf8'));
    if(record.id!==photo.id||record.origin!=='project-ai-generated'||record.generation.tool!=='image_gen'||record.review.status!=='reviewed')throw new Error(`生成来源或审核记录缺失：${photo.id}`);
    if(record.generation.referenceImages.length)throw new Error(`当前图库只接收无外部参考图的生成作品：${photo.id}`);
    if(record.generation.promptPath){
      if(!/^content\/image-prompts\/[a-z0-9-]+\.txt$/.test(record.generation.promptPath))throw new Error('提示词存档路径无效');
      if(!(await readFile(join(root,record.generation.promptPath),'utf8')).trim())throw new Error('提示词为空');
    }else if(!(photo.id==='seaside'&&record.generation.legacyPromptUnavailable))throw new Error(`缺少原始提示词：${photo.id}`);
    if(record.commercialUse.basis!=='provider-output-terms'||!record.commercialUse.termsUrl.startsWith('https://openai.com/policies/'))throw new Error('缺少服务条款依据');
    const bytes=await readFile(join(root,'public',photo.src.slice(1)));
    if(bytes.subarray(0,8).toString('hex')!=='89504e470d0a1a0a')throw new Error('图片不是登记的 PNG 原件');
    if(bytes.readUInt32BE(16)!==record.width||bytes.readUInt32BE(20)!==record.height||createHash('sha256').update(bytes).digest('hex')!==record.sha256)throw new Error(`图片与原始记录不一致：${photo.id}`);
    if(record.delivery?.sourceSha256!==record.sha256)throw new Error(`衍生图片缺少原件关联：${photo.id}`);
    for(const [kind,field] of [['play','playSrc'],['thumbnail','thumbSrc']]){
      const item=record.delivery[kind];
      if(!item||item.src!==photo[field]||item.src!==`/puzzles/${photo.id}-${kind}-${item.sha256.slice(0,12)}.webp`||item.format!=='webp'||item.upscaled!==false)throw new Error(`衍生图片记录无效：${photo.id}`);
      const data=await readFile(join(root,'public',item.src.slice(1)));
      if(createHash('sha256').update(data).digest('hex')!==item.sha256||data.length!==item.bytes)throw new Error(`衍生图片哈希不一致：${photo.id}`);
      const size=webpSize(data);
      if(size.width!==item.width||size.height!==item.height)throw new Error(`衍生图片尺寸不一致：${photo.id}`);
      if(kind==='play'&&(item.lossless!==true||size.width!==record.width||size.height!==record.height))throw new Error(`游玩图片必须无损并保留原生尺寸：${photo.id}`);
      if(kind==='thumbnail'&&(size.width>480||size.height>384||size.width>record.width||size.height>record.height))throw new Error(`预览图片尺寸过大：${photo.id}`);
      files.add(item.src.slice('/puzzles/'.length));
    }
  }
  const served=await readdir(join(root,'public/puzzles'));
  for(const file of served)if(!files.has(file))throw new Error(`public/puzzles 中存在未登记或未审核素材：${file}`);
  return {published:published.length};
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
  try{const result=await checkImageLibrary(resolve(fileURLToPath(new URL('..',import.meta.url))));console.log(`图库来源校验通过：${result.published} 张项目生成图`);}
  catch(error){console.error(error.message);process.exitCode=1;}
}
