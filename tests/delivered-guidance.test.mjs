import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import {mergeDeliveredGuidance} from '../server/delivered-guidance.mjs';
import {deliveredGuidancePlugin} from '../server/delivered-guidance-plugin.mjs';

test('delivered photos absent from bundled guidance receive measured dimensions',()=>{
 const result=mergeDeliveredGuidance({},[{id:'daily-new',width:2400,height:1800}]);
 assert.deepEqual(result['daily-new'],{width:2400,height:1800,complexity:2,preferredCount:108,reason:'已交付图片实测尺寸'});
});

test('invalid identities and nonpositive or invalid dimensions are ignored',()=>{
 const photos=[{id:'zero',width:0,height:900},{id:'negative',width:900,height:-1},{id:'fraction',width:1.5,height:900},{id:'infinite',width:Infinity,height:900},{id:'missing',width:900},{id:'string',width:'900',height:900},{id:'BAD',width:900,height:900},null];
 assert.deepEqual(mergeDeliveredGuidance({},photos),{});
});

test('editorial guidance is preserved and inputs are not mutated',()=>{
 const editorial=Object.freeze({width:100,height:200,complexity:4,preferredCount:500,reason:'editorial'});
 const seed=Object.freeze({existing:editorial}),photos=Object.freeze([Object.freeze({id:'existing',width:2400,height:1800})]);
 const result=mergeDeliveredGuidance(seed,photos);
 assert.deepEqual(result.existing,{...editorial,width:2400,height:1800});
 assert.equal(seed.existing,editorial);assert.equal(seed.existing.width,100);
 assert.notEqual(result,seed);assert.notEqual(result.existing,editorial);
 assert.equal(photos[0].width,2400);
});

test('Node server resolution checks see delivered dimensions; client guidance stays untouched',async()=>{
 const file=new URL('../lib/play-guidance.ts',import.meta.url),source=readFileSync(file,'utf8'),plugin=deliveredGuidancePlugin();
 const id=fileURLToPath(file);
 assert.equal(plugin.transform.call({environment:{name:'client'}},source,id,{ssr:false}),undefined);
 const transformed=plugin.transform.call({environment:{name:'rsc'}},source,id,{});
 assert.ok(transformed.code.includes('mergeDeliveredGuidance(guidance, deliveredPhotos)'));
 const built=await build({stdin:{contents:'export {supportsPieceCount} from "./lib/piece-policy.ts";export {photoGuidance} from "./lib/play-guidance.ts";',resolveDir:process.cwd(),loader:'ts'},bundle:true,write:false,platform:'node',format:'esm',plugins:[{name:'server-guidance-test',setup(b){
  b.onLoad({filter:/[\\/]lib[\\/]play-guidance\.ts$/},args=>({contents:plugin.transform.call({},readFileSync(args.path,'utf8'),args.path,{ssr:true}).code,loader:'ts',resolveDir:fileURLToPath(new URL('../lib/',import.meta.url))}));
  b.onResolve({filter:/managed-content\.node\.mjs$/},()=>({path:'delivered',namespace:'test'}));
  b.onLoad({filter:/.*/,namespace:'test'},()=>({contents:'export const managedPhotos=[{id:"daily-new",width:2400,height:1800}];'}));
 }}]});
 const api=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'));
 assert.equal(api.photoGuidance('daily-new').width,2400);
 assert.equal(api.supportsPieceCount('daily-new',108),true);
 assert.equal(api.supportsPieceCount('daily-new',300),true);
});
