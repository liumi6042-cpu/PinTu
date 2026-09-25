import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,stat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {GALLERY_PHOTOS,PHOTOS} from '../lib/puzzle-catalog.ts';
import {cosmeticAsset,cosmeticUrl} from '../lib/cosmetic-art.ts';
import {styles} from '../public/cosmetics/catalog.mjs';

test('gallery puts new uploads first without changing daily selection order',()=>{
 assert.deepEqual(GALLERY_PHOTOS.slice(0,10).map(p=>p.id),["riverside-park-festival-v1", "summer-night-matsuri-v1", "orbital-market-v1", "snow-village-fair-v1", "tropical-harbor-carnival-v1", "clockwork-invention-fair-v1", "enchanted-library-garden-v1", "autumn-farm-festival-v1", "underwater-city-fair-v1", "rooftop-neighborhood-festival-v1"]);
 assert.notEqual(GALLERY_PHOTOS[0].id,PHOTOS[0].id);
 assert.deepEqual(new Set(GALLERY_PHOTOS.map(p=>p.id)),new Set(PHOTOS.map(p=>p.id)));
 for(let i=1;i<GALLERY_PHOTOS.length;i++)assert.ok(Date.parse(GALLERY_PHOTOS[i-1].publishedAt)>=Date.parse(GALLERY_PHOTOS[i].publishedAt));
});
test('all cosmetic variants are small hashed runtime files, including native PNG cursors',async()=>{
 const allow=JSON.parse(await readFile(new URL('../config/runtime-assets.json',import.meta.url),'utf8')).static;
 let bytes=0;
 for(const style of styles)for(const kind of ['bubble','icon','cursor']){
  const url=cosmeticAsset(kind,style.id);assert.ok(allow.includes(url));
  const path=new URL('../public'+url,import.meta.url),data=await readFile(path);
  assert.ok(url.includes(createHash('sha256').update(data).digest('hex').slice(0,12)));
  bytes+=(await stat(path)).size;
  if(kind==='cursor'){assert.ok(url.endsWith('.png'));assert.equal(data.readUInt32BE(16),32);assert.equal(data.readUInt32BE(20),32);}
 }
 assert.ok(bytes<500_000,'entire set stays below 500 KB');
 assert.equal(cosmeticAsset('icon','__proto__'),'');assert.equal(await cosmeticUrl('cursor','invalid'),'');
});
