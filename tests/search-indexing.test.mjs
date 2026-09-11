import test from 'node:test';
import assert from 'node:assert/strict';
import { searchPaths, isPublicSearchPage, pageMetadata, publicMetadata, jsonLd, englishCopy, SITE_URL } from '../lib/seo.ts';
import { PHOTOS, RESTORABLE_PHOTOS } from '../lib/puzzle-catalog.ts';

test('search catalog contains only stable public pages and published artwork', () => {
  const paths=searchPaths();
  assert.equal(paths.length,PHOTOS.length+4);
  assert.equal(new Set(paths).size,paths.length);
  for(const path of paths)assert.equal(isPublicSearchPage(path),true,path);
  for(const path of ['/room/ea1b7d4200fa440dab3ac195e47aaa29','/personal','/personal/images','/account','/account/recover','/admin','/feedback','/membership/manage','/api/user-images','/puzzle/not-real','/puzzle/../room/private'])assert.equal(isPublicSearchPage(path),false,path);
  for(const photo of RESTORABLE_PHOTOS.filter(p=>p.status!=='published'))assert.equal(isPublicSearchPage('/puzzle/'+photo.id),false);
});

test('public metadata has distinct titles, canonical URLs and real preview assets', () => {
  const titles=new Set();
  for(const path of ['/','/lobby','/gallery','/help']){
    const m=pageMetadata(path);assert.equal(m.alternates.canonical,SITE_URL+path);
    assert.equal(m.robots.index,true);assert.equal(m.robots.follow,true);
    assert.ok(!titles.has(m.title.absolute));titles.add(m.title.absolute);
    assert.ok(!/[\u3400-\u9fff]/.test(m.title.absolute));assert.match(m.openGraph.images[0].url,/^https:\/\/jigsawnook\.online\/puzzles\/.+thumbnail-.+\.webp$/);
  }
  for(const photo of PHOTOS){assert.notEqual(englishCopy(photo.title),photo.title);const m=publicMetadata('/puzzle/'+photo.id,englishCopy(photo.title),englishCopy(photo.subtitle),photo.thumbSrc);assert.equal(m.openGraph.url,m.alternates.canonical);}
});

test('structured data cannot terminate its script element',()=>{
  const text='</script><img src=x onerror=alert(1)>';
  const encoded=jsonLd({name:text});assert.ok(!encoded.includes('<'));assert.equal(JSON.parse(encoded).name,text);
});
