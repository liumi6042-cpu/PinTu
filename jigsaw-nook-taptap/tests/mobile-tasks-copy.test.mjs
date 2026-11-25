import test from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import {TASK_REWARDS} from '../server/mobile-tasks.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));
const bundle=await build({absWorkingDir:root,stdin:{contents:'export {GameApp} from "./mobile/app";',resolveDir:root,loader:'ts'},bundle:true,write:false,format:'esm',platform:'node',target:'es2020'});
const {GameApp}=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
function fixture(width){
 const texts=[],ctx=new Proxy({measureText:text=>({width:String(text).length*7})},{get:(target,key)=>key in target?target[key]:()=>{}});
 const stage={w:width,h:844,ctx,palette:{ink:'#642238',muted:'#a17878',line:'#d4a399',rose:'#c8798c'},text:value=>texts.push(String(value)),icon(){},panel(){},button(){},meter(){},hit(){},clip:(_r,fn)=>fn(),measure:text=>String(text).length*7,wrap:()=>18};
 const instance=Object.create(GameApp.prototype);Object.assign(instance,{stage,client:{profile:{level:10,energy:20,energyCap:60,supply:{energy:0,create:0}},config:{capabilities:{energy:true,ads:false,albumTarget:'mobile-shared'}}},platform:{config:{id:'taptap'},viewport:()=>({top:0,bottom:0})},tasks:{giftProgress:0,giftMaximum:5,giftCount:0,tasks:TASK_REWARDS.map(task=>({...task,kind:task.id,progress:0,earned:false})),inventory:[],invitation:{requiredContributions:3,dailyLimit:3}},taskTab:'tasks',bodyTop:100,bodyBottom:10000,scroll:0,extent:0,busy:false});
 return {instance,texts};
}

test('task page and task cards draw solo daily copy while preserving friend copy',()=>{
 for(const width of [390,844])for(const method of ['drawTasks','drawTasksPage']){
  const {instance,texts}=fixture(width);instance[method]();
  assert.ok(texts.includes('今日任务'));assert.equal(texts.some(text=>text.includes('协作拼合')||text.includes('今日 · 一起拼')),false);
  for(const target of [10,30,60])assert.ok(texts.includes('完成 '+target+' 次拼合'));
  for(const target of [10,30])assert.ok(texts.includes('完成 '+target+' 次好友拼合'));
  for(const title of ['小试身手','渐入佳境','心手相合','好友相伴','好友默契'])assert.ok(texts.includes(title));
 }
});
