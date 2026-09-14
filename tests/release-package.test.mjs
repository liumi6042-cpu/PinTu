import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {resolve} from 'node:path';
import {runtimeAssets,selectRuntimeFiles,inventory,inside} from '../scripts/release-files.mjs';

test('runtime artwork retains archived saves but excludes PNG originals and unpublished artwork',()=>{
  const photo=(id,status)=>({id,status,origin:'project-ai-generated',src:`/puzzles/${id}.png`,playSrc:`/puzzles/${id}-play-0123456789ab.webp`,thumbSrc:`/puzzles/${id}-thumbnail-0123456789ab.webp`,optimizedSrc:`/puzzles/${id}-optimized-0123456789ab.webp`});
  const hd={...photo('new','published'),standardSrc:'/puzzles/new-standard-0123456789ab.webp',optimizedStandardSrc:'/puzzles/new-compact-0123456789ab.webp'};
  const urls=runtimeAssets([hd,photo('old','archived'),photo('draft','draft')],{static:['/favicon.svg']});
  assert.equal(urls.length,9);assert.ok(urls.includes(hd.standardSrc));assert.ok(urls.includes(hd.optimizedStandardSrc));assert.ok(urls.includes(hd.optimizedSrc));assert.ok(urls.some(url=>url.includes('/old-')));assert.ok(!urls.some(url=>url.endsWith('.png')||url.includes('draft')));
  assert.throws(()=>runtimeAssets([{...photo('missing','published'),optimizedSrc:undefined}],{static:[]}),/Missing runtime artwork/);
  assert.throws(()=>runtimeAssets([{...hd,optimizedStandardSrc:undefined}],{static:[]}),/Missing runtime artwork/);
  assert.throws(()=>runtimeAssets([{...hd,optimizedSrc:hd.playSrc}],{static:[]}),/Missing runtime artwork/);
  assert.throws(()=>runtimeAssets([{...hd,optimizedSrc:photo('old','archived').optimizedSrc}],{static:[]}),/Missing runtime artwork/);
  assert.throws(()=>runtimeAssets([photo('bad/../../','published')],{static:[]}));
  assert.throws(()=>runtimeAssets([],{static:['/../.env']}));
});

test('release allowlist excludes source, credentials, raw images, duplicate public and build tools',()=>{
  const parent=resolve('work/release-package-tests');mkdirSync(parent,{recursive:true});
  const root=mkdtempSync(resolve(parent,'fixture-'));
  const put=name=>{mkdirSync(resolve(root,name,'..'),{recursive:true});writeFileSync(resolve(root,name),'fixture');};
  try{
    const assets=['/favicon.svg','/puzzles/new-optimized-0123456789ab.webp','/puzzles/new-compact-0123456789ab.webp','/puzzles/old-play-0123456789ab.webp'];
    const required=['server.js','package.json','dist/server/index.js','node_modules/react/index.js','drizzle/0000_tables.sql','dist/client/_next/static/chunk.js','dist/client/.vite/manifest.json',...assets.map(url=>'dist/client'+url),...['backup','migrate','public-room-cleanup','runtime.node','sqlite'].map(name=>`server/${name}.mjs`)];
    const forbidden=['.env','app/page.tsx','docs/passwords.md','tests/example.test.mjs','work/source.tar','public/favicon.svg','public/puzzles/original.png','dist/client/puzzles/original.png','dist/client/intro/unused.png','server/deploy-existing-server.py','dist/server/index.js.map','drizzle/meta/_journal.json'];
    [...required,...forbidden].forEach(put);
    const files=selectRuntimeFiles(root,assets);
    assert.deepEqual(files,[...required].sort());
    const records=inventory(root,files);assert.ok(records.every(item=>item.sha256.length===64&&item.bytes===7));
    assert.throws(()=>inside(root,resolve(root,'../outside')));
    put('node_modules/native/binding.node');assert.throws(()=>selectRuntimeFiles(root,assets),/Native runtime dependency/);
    rmSync(resolve(root,'node_modules/native/binding.node'));
    put('dist/server/.env');assert.throws(()=>selectRuntimeFiles(root,assets),/Private data/);
  }finally{assert.ok(root.startsWith(parent));rmSync(root,{recursive:true,force:true});}
});
