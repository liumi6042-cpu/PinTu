import test from 'node:test';
import assert from 'node:assert/strict';
import { searchPaths, englishSearchPaths, isPublicSearchPage, pageMetadata, zhPageMetadata, zhPuzzleMetadata, publicMetadata, jsonLd, englishCopy, hasChineseVersion, zhPath, englishPath, SITE_URL } from '../lib/seo.ts';
import { PHOTOS, RESTORABLE_PHOTOS } from '../lib/puzzle-catalog.ts';

test('search catalog contains only stable public pages and published artwork', () => {
  const paths=searchPaths(),english=englishSearchPaths();
  assert.equal(english.length,PHOTOS.length+4);
  assert.equal(paths.length,english.length*2,'every public page has an English and a Chinese address');
  assert.equal(new Set(paths).size,paths.length);
  for(const path of paths)assert.equal(isPublicSearchPage(path),true,path);
  for(const path of ['/room/ea1b7d4200fa440dab3ac195e47aaa29','/personal','/personal/images','/account','/account/recover','/admin','/feedback','/membership/manage','/api/user-images','/puzzle/not-real','/puzzle/../room/private','/zh/room/ea1b7d4200fa440dab3ac195e47aaa29','/zh/personal','/zh/personal/images','/zh/admin','/zh/feedback','/zh/puzzle/not-real','/zh/../room/private','/zhx'])assert.equal(isPublicSearchPage(path),false,path);
  for(const photo of RESTORABLE_PHOTOS.filter(p=>p.status!=='published'))assert.equal(isPublicSearchPage('/puzzle/'+photo.id),false);
  assert.deepEqual(englishPath(zhPath('/gallery')),'/gallery');
  assert.equal(zhPath('/'),'/zh');
  assert.equal(zhPath('/puzzle/x'),'/zh/puzzle/x');
});

test('English public pages keep English titles and point at their Chinese twin', () => {
  const titles=new Set();
  for(const path of ['/','/lobby','/gallery','/help']){
    const m=pageMetadata(path);assert.equal(m.alternates.canonical,SITE_URL+path);
    assert.equal(m.robots.index,true);assert.equal(m.robots.follow,true);
    assert.ok(!titles.has(m.title.absolute));titles.add(m.title.absolute);
    // The English pages stay English. Chinese keywords go on /zh instead, because
    // this title is already as long as search results will display.
    assert.ok(!/[\u3400-\u9fff]/.test(m.title.absolute));
    assert.equal(m.openGraph.locale,'en_US');
    assert.deepEqual(m.alternates.languages,{en:SITE_URL+path,'zh-CN':SITE_URL+zhPath(path),'x-default':SITE_URL+path});
    assert.match(m.openGraph.images[0].url,/^https:\/\/jigsawnook\.online\/puzzles\/.+thumbnail-.+\.webp$/);
  }
  for(const photo of PHOTOS){assert.notEqual(englishCopy(photo.title),photo.title);const m=publicMetadata('/puzzle/'+photo.id,englishCopy(photo.title),englishCopy(photo.subtitle),photo.thumbSrc);assert.equal(m.openGraph.url,m.alternates.canonical);}
});

test('Chinese public pages carry Chinese titles and point back at the English twin', () => {
  const titles=new Set();
  for(const path of ['/','/lobby','/gallery','/help']){
    const m=zhPageMetadata(path);
    assert.equal(m.alternates.canonical,SITE_URL+zhPath(path));
    assert.equal(m.robots.index,true);
    assert.ok(/[\u3400-\u9fff]/.test(m.title.absolute),m.title.absolute);
    assert.ok(!titles.has(m.title.absolute));titles.add(m.title.absolute);
    assert.equal(m.openGraph.locale,'zh_CN');
    // Both directions must publish the identical pair; otherwise search engines
    // treat the two copies as unrelated pages competing with each other.
    assert.deepEqual(m.alternates.languages,pageMetadata(path).alternates.languages);
  }
  for(const photo of PHOTOS){
    const m=zhPuzzleMetadata(photo);
    assert.equal(m.alternates.canonical,SITE_URL+zhPath('/puzzle/'+photo.id));
    assert.ok(/[\u3400-\u9fff]/.test(m.title.absolute),photo.id);
    assert.ok(!titles.has(m.title.absolute),photo.id);titles.add(m.title.absolute);
    assert.ok(m.description.includes(photo.subtitle),photo.id);
    assert.deepEqual(m.alternates.languages,{en:SITE_URL+'/puzzle/'+photo.id,'zh-CN':SITE_URL+zhPath('/puzzle/'+photo.id),'x-default':SITE_URL+'/puzzle/'+photo.id});
  }
});

test('only routes with a real Chinese page advertise one',()=>{
  for(const path of ['/','/lobby','/gallery','/help'])assert.equal(hasChineseVersion(path),true,path);
  for(const photo of PHOTOS)assert.equal(hasChineseVersion('/puzzle/'+photo.id),true,photo.id);
  for(const path of ['/personal','/account','/membership','/room/ea1b7d4200fa440dab3ac195e47aaa29','/privacy','/feedback'])assert.equal(hasChineseVersion(path),false,path);
});

test('structured data cannot terminate its script element',()=>{
  const text='</script><img src=x onerror=alert(1)>';
  const encoded=jsonLd({name:text});assert.ok(!encoded.includes('<'));assert.equal(JSON.parse(encoded).name,text);
});
