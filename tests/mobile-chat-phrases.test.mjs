import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import phrases from '../config/social-phrases.json' with {type:'json'};
const bundle=await build({stdin:{contents:'export {GameApp} from "./mobile/app";',resolveDir:process.cwd(),loader:'ts'},bundle:true,write:false,format:'esm',platform:'node',target:'es2020'});
const {GameApp}=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text+'\n//# sourceURL=mobile-chat-phrases-test-bundle.mjs').toString('base64'));

test('the five 心情 lines are appended after the original sixteen ids',()=>{
 assert.equal(phrases.length,21);assert.equal(phrases[15],'🧩');
 assert.deepEqual(phrases.slice(16),['晚安~','困了~','有点难哦~','明天再来','明天见~']);
});

test('心情 shows only once the server lists the new phrases, and never sends one it would reject',async()=>{
 const render=serverPhrases=>{
  const tabs=[],buttons=[],posts=[],stage={w:390,h:844,palette:{},ctx:{fillRect(){}},measure:text=>String(text).length*12,panel(){},hit(){},clip(_area,fn){fn();},icon(){},text(){},segments(_r,options){tabs.push(options.map(o=>o[1]));},button(_r,label){buttons.push(label);}};
  const app=Object.create(GameApp.prototype);
  Object.assign(app,{stage,platform:{viewport:()=>({top:0,bottom:0})},client:{profile:{code:'self'},json:async(path,method,body)=>{posts.push(body);return {};}},social:{blockedCodes:[]},roomArea:{y:63},messages:[],phraseGroup:3,modalScroll:0,busy:false,serverPhrases,room:{ticket:{room:{id:'r'},token:'t'},snapshot:{members:[]}},attempts:new Map(),attempt:()=>'req',run:async fn=>fn(),loadChat:async()=>{}});
  app.drawPublicChat();return {app,tabs:tabs.at(-1),buttons,posts};
 };
 const old=render(new Set(phrases.slice(0,16)));
 assert.deepEqual(old.tabs,['协作','鼓励','表情'],'live backend without the new lines');assert.equal(old.app.phraseGroup,0,'a stale 心情 tab falls back to the first group');
 await old.app.say(18);assert.equal(old.posts.length,0);await old.app.say(10);assert.equal(old.posts[0].phraseId,10);
 const fresh=render(new Set(phrases));
 assert.deepEqual(fresh.tabs,['协作','鼓励','表情','心情']);assert.deepEqual(fresh.buttons.slice(-5),phrases.slice(16));assert.equal(fresh.app.phraseGroup,3);
 await fresh.app.say(18);assert.equal(fresh.posts[0].phraseId,18);
});
