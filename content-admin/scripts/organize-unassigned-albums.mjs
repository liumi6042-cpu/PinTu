// Explicit local curation: preserve existing albums and metadata, fill only
// unassigned inventory, and keep historical/daily inventory hidden.
import assert from 'node:assert/strict';
import {backup} from 'node:sqlite';
import {mkdirSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {readSource} from '../source.mjs';
import {createStore} from '../store.mjs';
import {validateDraft,plannedImageVisibility,effectiveImageVisibility} from '../model.mjs';

const root=resolve(import.meta.dirname,'../..'),work=join(root,'content-admin/work');
const source=readSource(root),store=createStore(work,source),apply=process.argv.includes('--apply');
const recipes=[
 {key:'paper',id:'curated-paper-world',title:'纸艺 · 奇境旅行',styleGroupId:'paper-collage',cover:'new-ed33701d9e7980fa-v1',description:'用纸片与层叠色彩，收藏海底宫殿、森林书屋和四季庭院。',display:true},
 {key:'anime',id:'curated-anime-characters',title:'二次元 · 异想人物',styleGroupId:'anime',cover:'new-0d5e19f196b617a4-v1',description:'魔法师、兽耳伙伴与古风人物，在不同世界里相遇。',display:true},
 {key:'painted',id:'curated-painted-fantasy',title:'厚涂 · 神兽秘境',styleGroupId:'painted',cover:'new-629dfdbe43cd5b09-v1',description:'从山海神兽到魔法树屋，收集浓郁笔触中的奇幻景象。',display:true},
 {key:'mixed',id:'curated-style-studies',title:'多元画风 · 灵感小品',styleGroupId:'other',cover:'new-cadc3cceade3fdfe-v1',description:'水彩、版画、玻璃、平涂与写实，在建筑、航海和未来世界中相遇。',display:true},
 {key:'archived',id:'curated-historical-versions',title:'历史版本',styleGroupId:'other',cover:'mountain-lake-reflection',description:'保存历史归档图片和旧版本，默认两端隐藏，供对照与后续选用。',display:false},
 {key:'daily',id:'curated-daily-specials',title:'每日专用',styleGroupId:'anime',cover:'daily-moonlit-cherry-umbrella-v1',description:'单独保留每日拼图专用图片，继续使用现有每日玩法。',display:false},
];
try {
 const current=store.draft(store.activeDraftId());
 assert.equal(current.document.schemaVersion,3,'use the shared album model');
 assert.equal(current.sourceFingerprint,source.fingerprint,'source changed; merge before organizing');
 const document=structuredClone(current.document),assigned=new Set(document.albums.flatMap(album=>album.imageIds));
 const remaining=source.assets.filter(asset=>!assigned.has(asset.id));
 if(!remaining.length){console.log('所有图片已有相册归属，无需重复整理。');}
 else {
  const buckets=new Map(recipes.map(recipe=>[recipe.key,[]]));
  for(const asset of remaining){
   const flags=Object.values(asset.targets),style=document.assets[asset.id].styleGroupId;
   const key=flags.some(target=>target.dailyOnly)?'daily':asset.lifecycle!=='pending'&&flags.every(target=>target.status==='archived')?'archived':style==='paper-collage'?'paper':style==='anime'?'anime':style==='painted'?'painted':'mixed';
   buckets.get(key).push(asset.id);
  }
  const added=[];
  for(const recipe of recipes){
   const images=buckets.get(recipe.key);if(!images.length)continue;
   assert.equal(document.albums.some(album=>album.id===recipe.id),false,'curation album already exists; review before adding more');
   const album={id:recipe.id,title:recipe.title,description:recipe.description,imageIds:images,coverImageId:images.includes(recipe.cover)?recipe.cover:images[0],styleGroupId:recipe.styleGroupId,showOnPc:recipe.display,showOnMobile:recipe.display,purchasable:false,price:0,decorationId:null,milestones:[]};
   document.albums.push(album);added.push(album);
  }
  const validated=validateDraft(document,source);
  assert.deepEqual(validated.assets,current.document.assets,'preserve all titles, tags, style and history');
  assert.deepEqual(validated.styles,current.document.styles,'preserve existing taxonomy');
  assert.deepEqual(validated.albums.slice(0,current.document.albums.length),current.document.albums,'preserve user-edited albums, members, prices and rewards');
  const ids=validated.albums.flatMap(album=>album.imageIds);
  assert.equal(ids.length,new Set(ids).size,'every picture belongs to exactly one album');
  assert.equal(ids.length,source.assets.length,'organize all registered pictures');
  const summary={draftId:current.id,beforeRevision:current.revision,previousAlbums:current.document.albums.length,addedAlbums:added.map(album=>({id:album.id,title:album.title,count:album.imageIds.length,coverImageId:album.coverImageId,styleGroupId:album.styleGroupId,showOnPc:album.showOnPc,showOnMobile:album.showOnMobile,purchasable:album.purchasable,price:album.price})),totalAlbums:validated.albums.length,totalImages:source.assets.length,unassigned:0,plannedVisible:Object.fromEntries(['pc','mobile-shared'].map(target=>[target,plannedImageVisibility(validated,source,target).size])),currentlyAvailable:Object.fromEntries(['pc','mobile-shared'].map(target=>[target,effectiveImageVisibility(validated,source,target).size])),runtimeApplied:false};
  const recordDir=join(work,'album-organization-20261012');mkdirSync(recordDir,{recursive:true});
  writeFileSync(join(recordDir,'preview.json'),JSON.stringify(summary,null,2)+'\n');
  if(apply){
   const beforeCount=store.listDrafts().length,backupDir=join(work,'backups');mkdirSync(backupDir,{recursive:true});
   const backupPath=join(backupDir,`before-album-organization-${Date.now()}.sqlite`);await backup(store.db,backupPath);
   const saved=store.saveDraft(current.id,current.revision,validated,'local-album-organizer');
   assert.equal(saved.id,current.id);assert.equal(store.listDrafts().length,beforeCount);
   assert.deepEqual(saved.document,validated);
   writeFileSync(join(recordDir,'result.json'),JSON.stringify({...summary,createdAt:new Date().toISOString(),revision:saved.revision,backupPath,assignedPictures:remaining.map(asset=>({id:asset.id,title:validated.assets[asset.id].title,styleGroupId:validated.assets[asset.id].styleGroupId,subjectTags:validated.assets[asset.id].subjectTags,albumId:added.find(album=>album.imageIds.includes(asset.id)).id}))},null,2)+'\n');
   console.log(JSON.stringify({...summary,revision:saved.revision,saved:true}));
  }else console.log(JSON.stringify({...summary,saved:false}));
 }
}finally{store.close();}
