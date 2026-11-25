import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import sharp from 'sharp';
const root=fileURLToPath(new URL('..',import.meta.url));
const catalog=JSON.parse(await fs.readFile(path.join(root,'content/puzzle-catalog.json'),'utf8'));
const guidance=JSON.parse(await fs.readFile(path.join(root,'content/puzzle-guidance.json'),'utf8'));
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const plan=[['mountain-lake-reflection','20260914-mountain-lake'],['morning-meadow-tree','20260914-meadow'],['clear-sand-bay','20260914-bay']];
const newPhotos=[];
for(const [base,folder] of plan){
 const id=base+'-hd-v3',prior=catalog.find(p=>p.id===base+'-native-v2');
 if(catalog.some(p=>p.id===id)){console.log('Already registered: '+id);continue;}
 if(!prior||prior.status!=='published')throw Error('Expected active previous edition '+base);
 const input=path.resolve(root,'../artwork-experiments',folder),dest=path.join(root,'content/artwork/gallery-hd',id);
 await fs.mkdir(dest,{recursive:true});
 const assembly=JSON.parse(await fs.readFile(path.join(input,'manifest.json'),'utf8'));
 const generations=JSON.parse(await fs.readFile(path.join(input,'generation-record.json'),'utf8'));
 const png=await fs.readFile(path.join(input,'alpine-lake-four-region.png'));
 if(hash(png)!==assembly.output.png.sha256||assembly.output.losslessWebpVerified!==true)throw Error('Unverified assembly');
 for(const name of ['manifest.json','generation-record.json','seams.json','composition-guide.png',...assembly.tiles.flatMap(t=>[t.id+'-guide.png',t.id+'-native.png'])])await fs.copyFile(path.join(input,name),path.join(dest,name));
 const parts=assembly.tiles.map(t=>({id:t.id,path:`content/artwork/gallery-hd/${id}/${t.id}-native.png`,...t.native}));
 const references=[];
 for(const t of assembly.tiles){const name=`${t.id}-guide.png`,b=await fs.readFile(path.join(dest,name));references.push({origin:'project-ai-generated',path:`content/artwork/gallery-hd/${id}/${name}`,sha256:hash(b)});}
 const sourcePrompt=generations.basePrompt??await fs.readFile(path.join(root,'content/image-prompts',base+'-native-v2.txt'),'utf8');
 const promptText=`COMPOSITION GUIDE (project-generated; no external imagery)\n${sourcePrompt}\n\n`+generations.regions.map(r=>`REGION ${r.id}\n${r.prompt}`).join('\n\n');
 await fs.writeFile(path.join(root,'content/image-prompts',id+'.txt'),promptText+'\n');
 await fs.copyFile(path.join(input,'stitch.mjs'),path.join(dest,'stitch-experiment.mjs'));
 const source=`/puzzles/${id}.png`;await fs.writeFile(path.join(root,'public',source),png);
 const photo={...prior,id,src:source,status:'published',replaces:prior.id};
 const oldRecord=JSON.parse(await fs.readFile(path.join(root,'content/image-provenance',prior.id+'.json'),'utf8'));
 const record={id,origin:'project-ai-generated',width:assembly.output.width,height:assembly.output.height,sha256:hash(png),nativeResolution:false,upscaled:false,
  generation:{provider:'OpenAI',tool:'image_gen',model:null,generatedDate:'2026-09-14',dateBasis:'Built-in tool outputs and local Asia/Shanghai date',promptPath:`content/image-prompts/${id}.txt`,referenceImages:references,compositionGuide:{path:`content/artwork/gallery-hd/${id}/composition-guide.png`,sha256:assembly.original.sha256,projectImageId:generations.baseProjectImageId??null},sourceMetadata:`content/artwork/gallery-hd/${id}/generation-record.json`},
  composite:{method:'four-overlapping-project-generated-regions',parts,assemblyRecord:`content/artwork/gallery-hd/${id}/manifest.json`,finalUpscaling:false},
  resolutionNote:'Four AI-regenerated overlapping regions assembled at native tile scale, with color correction and feathered seams. Composite output is not one native model output; no final interpolation enlargement. Fine details are AI-generated, not recovered photographic detail.',
  review:{status:'reviewed',reviewedOn:'2026-09-14',reviewer:'Codex visual review',observations:['Full composition and generated regions visually inspected. Continuous natural landscape with consistent major contours; no visible panel borders, text, logos or watermarks.','Original dimensions, region provenance and final SHA verified. Lossless WebP decoded pixels match the assembled PNG.'],scope:oldRecord.review.scope},commercialUse:oldRecord.commercialUse,delivery:{sourceSha256:hash(png)}};
 for(const kind of ['play','standard','thumbnail']){
  let data,expected;
  if(kind==='play'){data=await fs.readFile(path.join(input,'alpine-lake-four-region.webp'));expected=await sharp(png).removeAlpha().raw().toBuffer();}
  else{const resized=await sharp(png).resize({width:kind==='standard'?1774:480,withoutEnlargement:true}).removeAlpha().toColourspace('srgb').raw().toBuffer({resolveWithObject:true});expected=resized.data;data=await sharp(resized.data,{raw:resized.info}).webp(kind==='thumbnail'?{quality:82,effort:6}:{lossless:true,effort:6}).toBuffer();}
  const sha=hash(data),src=`/puzzles/${id}-${kind}-${sha.slice(0,12)}.webp`,meta=await sharp(data).metadata();
  if(kind!=='thumbnail'&&!(await sharp(data).removeAlpha().raw().toBuffer()).equals(expected))throw Error('Lossless mismatch '+id+'/'+kind);
  await fs.writeFile(path.join(root,'public',src),data);
  record.delivery[kind]={src,width:meta.width,height:meta.height,sha256:sha,bytes:data.length,format:'webp',lossless:kind!=='thumbnail',quality:kind==='thumbnail'?82:null,upscaled:false,...(kind==='standard'?{downsampled:true,maximumPieces:1000}:{})};
  photo[kind==='play'?'playSrc':kind==='standard'?'standardSrc':'thumbSrc']=src;
 }
 await fs.writeFile(path.join(root,'content/image-provenance',id+'.json'),JSON.stringify(record,null,2)+'\n');
 guidance[id]={...guidance[prior.id],width:record.width,height:record.height,preferredCount:300};
 prior.status='archived';newPhotos.push(photo);
 console.log(JSON.stringify({id,width:record.width,height:record.height,playBytes:record.delivery.play.bytes,standardBytes:record.delivery.standard.bytes,thumbnailBytes:record.delivery.thumbnail.bytes}));
}
await fs.writeFile(path.join(root,'content/puzzle-catalog.json'),JSON.stringify([...newPhotos,...catalog],null,2)+'\n');
await fs.writeFile(path.join(root,'content/puzzle-guidance.json'),JSON.stringify(guidance,null,2)+'\n');
const queue={version:1,batchSize:2,updatedOn:'2026-09-14',method:'Four-region generation using only project imagery; inspect every composite before publishing',completed:plan.map(([id])=>id+'-hd-v3'),remaining:catalog.filter(p=>p.status==='published'&&!p.id.endsWith('-hd-v3')).map(p=>p.id),publication:'Incremental release; preserve old artwork and ongoing rooms; no in-request generation'};
await fs.writeFile(path.join(root,'content/artwork/gallery-hd/upgrade-queue.json'),JSON.stringify(queue,null,2)+'\n');
