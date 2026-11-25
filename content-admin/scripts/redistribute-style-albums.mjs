// One-off local curation requested by the user. Default is a dry run.
import assert from 'node:assert/strict';
import {backup} from 'node:sqlite';
import {mkdirSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {readSource} from '../source.mjs';
import {createStore} from '../store.mjs';
import {validateDraft} from '../model.mjs';

const root=resolve(import.meta.dirname,'../..'),work=join(root,'content-admin/work');
const source=readSource(root),store=createStore(work,source),apply=process.argv.includes('--apply');
const sourceAlbumIds=['curated-historical-versions','everyday-gallery'];
const targets=[
 {style:'anime',id:'curated-anime-characters'},
 {style:'painted',id:'curated-painted-fantasy'},
 {style:'realistic',id:'curated-realistic-world',title:'写实 · 山海与日常',cover:'golden-alpine-valley-v1',description:'从山海与四季风景，到街巷、庭院和日常生活，收藏写实画风中的每一处光景。'},
 {style:'flat',id:'curated-flat-stories',title:'平涂 · 彩色故事',cover:'summer-night-matsuri-v1',description:'用清晰的色块记录节日、集市与邻里相遇，也留住沙丘落日和云端小屋。'},
];

try {
 const current=store.draft(store.activeDraftId());
 assert.equal(current.document.schemaVersion,3,'shared albums required');
 assert.equal(current.sourceFingerprint,source.fingerprint,'source changed; merge before organizing');
 const original=current.document,sources=sourceAlbumIds.map(id=>original.albums.find(album=>album.id===id));
 if(sources.every(album=>!album)) console.log('历史版本与日常拾光已完成分配，无需重复整理。');
 else {
  assert.ok(sources.every(Boolean),'source albums changed; review before redistributing');
  for(const album of sources){
   assert.equal(album.purchasable,false,'only free source albums are redistributed');
   assert.equal(album.price,0);assert.equal(album.decorationId,null);assert.deepEqual(album.milestones,[]);
  }
  const document=structuredClone(original),moving=sources.flatMap(album=>album.imageIds);
  assert.equal(moving.length,new Set(moving).size,'source IDs must be unique');
  const moved=new Set(moving),mapping=[],changed=new Set(sourceAlbumIds);
  for(const id of moving) assert.ok(targets.some(target=>target.style===document.assets[id].styleGroupId),'unexpected style; review first');
  for(const recipe of targets){
   const images=moving.filter(id=>document.assets[id].styleGroupId===recipe.style);
   if(!images.length)continue;
   let album=document.albums.find(item=>item.id===recipe.id);
   if(album){
    assert.equal(album.styleGroupId,recipe.style);assert.equal(album.purchasable,false);
    assert.equal(album.price,0);assert.deepEqual(album.milestones,[]);assert.equal(album.decorationId,null);
    assert.ok(album.imageIds.every(id=>!moved.has(id)),'destination overlaps sources');
    album.imageIds.push(...images);
   }else{
    assert.ok(recipe.title,'existing destination missing; review first');
    assert.ok(images.includes(recipe.cover),'cover must belong to the new album');
    album={id:recipe.id,title:recipe.title,description:recipe.description,imageIds:images,coverImageId:recipe.cover,styleGroupId:recipe.style,showOnPc:true,showOnMobile:true,purchasable:false,price:0,decorationId:null,milestones:[]};
    document.albums.push(album);
   }
   changed.add(album.id);
   mapping.push(...images.map(id=>({id,title:document.assets[id].title,fromAlbumId:sources.find(item=>item.imageIds.includes(id)).id,toAlbumId:album.id,styleGroupId:recipe.style})));
  }
  document.albums=document.albums.filter(album=>!sourceAlbumIds.includes(album.id));
  const validated=validateDraft(document,source);
  assert.deepEqual(validated.assets,original.assets,'preserve all picture metadata');
  assert.deepEqual(validated.styles,original.styles,'preserve all style groups');
  const beforeIds=original.albums.flatMap(album=>album.imageIds),afterIds=validated.albums.flatMap(album=>album.imageIds);
  assert.equal(afterIds.length,new Set(afterIds).size,'one album per picture');
  assert.deepEqual([...afterIds].sort(),[...beforeIds].sort(),'preserve every picture version');
  assert.equal(mapping.length,moving.length,'every source picture moved');
  for(const album of original.albums){
   if(!changed.has(album.id))assert.deepEqual(validated.albums.find(item=>item.id===album.id),album,'preserve unrelated albums');
   else if(!sourceAlbumIds.includes(album.id)){
    const next=validated.albums.find(item=>item.id===album.id);
    assert.deepEqual({...next,imageIds:album.imageIds},album,'existing destination settings unchanged');
    assert.deepEqual(next.imageIds.slice(0,album.imageIds.length),album.imageIds,'preserve existing order');
   }
  }
  const recordDir=join(work,'album-redistribution-20261012');mkdirSync(recordDir,{recursive:true});
  const summary={draftId:current.id,beforeRevision:current.revision,movedImages:moving.length,removedSourceAlbums:sources.map(album=>({id:album.id,title:album.title,count:album.imageIds.length})),destinations:validated.albums.filter(album=>targets.some(target=>target.id===album.id)).map(album=>({id:album.id,title:album.title,count:album.imageIds.length,added:mapping.filter(item=>item.toAlbumId===album.id).length,showOnPc:album.showOnPc,showOnMobile:album.showOnMobile})),totalAlbums:validated.albums.length,totalImages:Object.keys(validated.assets).length,assigned:afterIds.length,unassigned:Object.keys(validated.assets).length-afterIds.length,runtimeApplied:false};
  writeFileSync(join(recordDir,'preview.json'),JSON.stringify(summary,null,2)+'\n');
  if(apply){
   const beforeCount=store.listDrafts().length,backupDir=join(work,'backups');mkdirSync(backupDir,{recursive:true});
   const backupPath=join(backupDir,`before-style-redistribution-${Date.now()}.sqlite`);await backup(store.db,backupPath);
   const saved=store.saveDraft(current.id,current.revision,validated,'local-style-redistribution');
   assert.equal(saved.id,current.id);assert.equal(store.listDrafts().length,beforeCount);assert.deepEqual(saved.document,validated);
   writeFileSync(join(recordDir,'result.json'),JSON.stringify({...summary,createdAt:new Date().toISOString(),revision:saved.revision,backupPath,sourceAlbums:sources,mapping},null,2)+'\n');
   console.log(JSON.stringify({...summary,revision:saved.revision,saved:true}));
  }else console.log(JSON.stringify({...summary,saved:false}));
 }
}finally{store.close();}
