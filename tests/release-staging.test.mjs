import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,mkdirSync,mkdtempSync,readFileSync,rmSync,statSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {stageBuildSource,materializeRuntimeAssets} from '../scripts/release-staging.mjs';

test('isolated builds retain original artwork for validation while packaging only listed delivery assets',()=>{
 const parent=resolve('work/release-staging-tests');mkdirSync(parent,{recursive:true});
 const fixture=mkdtempSync(resolve(parent,'fixture-')),source=resolve(fixture,'source'),build=resolve(fixture,'build'),runtime=resolve(fixture,'runtime');
 for(const root of [source,build,runtime])mkdirSync(root);
 const put=(name,value)=>{const file=resolve(source,name);mkdirSync(resolve(file,'..'),{recursive:true});writeFileSync(file,value);};
 try{
  put('public/puzzles/original.png','original');put('public/puzzles/photo-optimized-0123456789ab.webp','delivery');put('content/artwork/native.png','native');put('content/puzzle-catalog.json','source-config');
  const names=['public/puzzles/original.png','public/puzzles/photo-optimized-0123456789ab.webp','content/artwork/native.png','content/puzzle-catalog.json'];
  stageBuildSource(source,build,names);
  assert.equal(statSync(resolve(source,names[0])).ino,statSync(resolve(build,names[0])).ino,'artwork is shared without another full disk copy');
  writeFileSync(resolve(build,'content/puzzle-catalog.json'),'compiler-change');assert.equal(readFileSync(resolve(source,'content/puzzle-catalog.json'),'utf8'),'source-config','build source/config stays independent');
  materializeRuntimeAssets(source,runtime,['/puzzles/photo-optimized-0123456789ab.webp']);
  assert.equal(readFileSync(resolve(runtime,'dist/client/puzzles/photo-optimized-0123456789ab.webp'),'utf8'),'delivery');
  assert.equal(existsSync(resolve(runtime,'dist/client/puzzles/original.png')),false,'original PNG is not materialized');
  assert.throws(()=>materializeRuntimeAssets(source,runtime,['/../content/puzzle-catalog.json']),/Invalid/);
  assert.throws(()=>materializeRuntimeAssets(source,runtime,['/puzzles/missing.webp']),/ENOENT/);
 }finally{assert.ok(fixture.startsWith(parent));rmSync(fixture,{recursive:true,force:true});}
});
