import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';

const root=fileURLToPath(new URL('../',import.meta.url));
const load=async options=>{const result=await build({absWorkingDir:root,bundle:true,write:false,format:'esm',platform:'node',target:'es2020',...options});return import('data:text/javascript;base64,'+Buffer.from(result.outputFiles[0].text).toString('base64'));};
const {GameApp}=await load({stdin:{contents:'export {GameApp} from "./mobile/app";',resolveDir:root,loader:'ts'}});
const h5=await load({stdin:{contents:`import React from 'react';import {renderToStaticMarkup} from 'react-dom/server';import {TaskRow,GiftRow,MobileInvitationSheet} from './h5/mobile-tasks';export const task=props=>renderToStaticMarkup(React.createElement(TaskRow,props));export const gift=props=>renderToStaticMarkup(React.createElement(GiftRow,props));export const invitation=props=>renderToStaticMarkup(React.createElement(MobileInvitationSheet,props));`,resolveDir:root,loader:'tsx'},loader:{'.css':'empty','.png':'empty'},banner:{js:`import {createRequire} from 'node:module';const require=createRequire(${JSON.stringify(fileURLToPath(new URL('../package.json',import.meta.url)))});`},plugins:[{name:'expose-task-rows-for-render-test',setup(build){build.onLoad({filter:/h5[\\/]mobile-tasks\.tsx$/},args=>({contents:readFileSync(args.path,'utf8')+'\nexport {TaskRow,GiftRow};',loader:'tsx'}));}}]});
const invitation={code:'a'.repeat(12),bound:false,boundToName:null,joinedCount:0,qualifiedCount:0,todayRewarded:0,dailyLimit:3,requiredContributions:3,shareDailyLimit:3,todayShared:0};
const task=(group,coins)=>({id:group,group,title:'任务',target:3,progress:0,earned:false,kind:group==='sharing'?'share-invitation':group==='invitation'?'invite-refill':'cooperation-10',energy:20,xp:10,...(coins===undefined?{}:{coins}),...(group==='invitation'?{effect:'full-energy'}:{})});
const view=()=>({profile:{level:10,energy:20,energyCap:60,xp:1,xpToNext:50},day:'2026-10-13',giftProgress:3,giftMaximum:5,giftMinimum:1,giftXp:2,giftCoins:7,giftCount:2,tasks:[task('sharing',11),task('invitation',13),task('cooperation',17)],inventory:[{kind:'cooperation-10',title:'协作礼包',count:2,energyMin:10,energyMax:20,xp:2,xpMin:2,xpMax:4,coins:6,coinsMin:0,coinsMax:9}],invitation,serverTime:1});
function app(data=view(),width=390){
 const texts=[],icons=[],panels=[],buttons=[],ctx=new Proxy({measureText:text=>({width:String(text).length*7})},{get:(target,key)=>key in target?target[key]:()=>{}});
 const stage={w:width,h:844,ctx,palette:{ink:'#642238',muted:'#a17878',line:'#d4a399',rose:'#c8798c'},text(value,...args){texts.push({value:String(value),args});},icon(kind,r){icons.push({kind,r});},panel(r){panels.push(r);},button(r,label,fn,options){buttons.push({r,label,fn,options});},meter(){},ornaments(){},hit(){},clip(_r,fn){fn();},measure:text=>String(text).length*7,color:value=>value,invalidate(){},wrap(value,_x,_y,_w,_size,_color,lineHeight){texts.push({value:String(value)});return lineHeight;}};
 const instance=Object.create(GameApp.prototype);Object.assign(instance,{stage,client:{profile:data.profile,refresh:async()=>{},config:{capabilities:{energy:true,ads:false,albumTarget:'mobile-shared'}}},platform:{config:{id:'taptap',gameName:'拼图小窝'},viewport:()=>({top:0,bottom:0}),randomId:()=> '1'.repeat(32)},tasks:data,taskTab:'tasks',taskDetailsOpen:false,bodyTop:100,bodyBottom:10000,scroll:0,extent:0,busy:false,invalidate:()=>{},attempts:new Map(),modalScroll:0,social:{title:'好友'}});
 return{instance,texts,icons,panels,buttons};
}

test('shared tasks show configured coin rewards without crowding XP or action buttons, and missing coins keep old geometry',()=>{
 for(const width of [320,390,844]){
  const a=app(view(),width);a.instance.drawTasks();
  // Rewards read as one line per task (体力 · 经验 · 金币); coins only appear when configured.
  for(const amount of [11,13,17])assert.ok(a.texts.some(text=>text.value.includes('经验 +10')&&text.value.endsWith('金币 +'+amount)),'task coins '+amount);
  assert.ok(a.texts.some(text=>text.value.includes('小礼')&&text.value.includes('金币 +7')));
  const old=view();delete old.giftCoins;old.inventory.forEach(gift=>{delete gift.coins;delete gift.coinsMin;delete gift.coinsMax;});old.tasks.forEach(task=>delete task.coins);
  const b=app(old,width);b.instance.drawTasks();assert.equal(b.texts.some(text=>text.value.includes('金币')),false);assert.deepEqual(b.panels.map(panel=>panel.h),a.panels.map(panel=>panel.h),'missing coins keep the same geometry');
 }
});

test('shared gift inventory shows mixed old/new coin range and preserves refill XP and coins',()=>{
 const data=view();data.inventory.push({kind:'invite-refill',title:'补满体力包',count:1,effect:'full-energy',energyMin:0,energyMax:0,xp:3,coins:14});
 const a=app(data);a.instance.taskTab='gifts';a.instance.drawTasks();
 assert.ok(a.texts.some(text=>text.value==='金币 +0～9'));assert.ok(a.texts.some(text=>text.value==='金币 +14'));assert.ok(a.texts.some(text=>text.value==='恢复至当前体力上限'));assert.ok(a.texts.some(text=>text.value==='经验 +3'));
 assert.ok(a.panels.length>=2&&a.panels.every(panel=>panel.h===a.panels[0].h),'gift cards share one height');
});

test('shared invitation rules and actual gift/share receipts include coins only when awarded',async()=>{
 const a=app();a.instance.modal='invite';a.instance.drawModal();assert.ok(a.texts.some(text=>text.value.includes('金币 +13')));assert.ok(a.texts.some(text=>text.value.includes('金币 +11')));
 let coins=19;const response=()=>({...view(),opened:{kind:'cooperation-10',quantity:1,energy:10,xp:2,coins,levels:0}});a.instance.client.post=async()=>response();await a.instance.openGift('cooperation-10');assert.match(a.instance.message,/金币 \+19/);
 a.instance.shareReward={pending:()=>true,claim:async()=>({...view(),shared:{energy:20,xp:10,coins,levels:0,alreadyRewarded:false}})};await a.instance.shareInvitation();assert.match(a.instance.message,/金币 \+19/);
 coins=undefined;await a.instance.openGift('cooperation-10');assert.equal(a.instance.message.includes('金币'),false);await a.instance.shareInvitation();assert.equal(a.instance.message.includes('金币'),false);
});

test('H5 task and gift rows render coins including mixed inventory range, preserving old reward text',()=>{
 assert.match(h5.task({task:task('sharing',15)}),/\+15/);assert.match(h5.task({task:task('invitation',16)}),/金币 \+16/);
 const old=h5.task({task:task('sharing')});assert.equal(old.includes('mobile-art-coin'),false);assert.match(old,/\+20/);assert.match(old,/\+10/);
 const props={gift:view().inventory[0],busy:false,energyFull:false,onOpen(){}};assert.match(h5.gift(props),/金币 \+0～9/);
 assert.match(h5.gift({...props,gift:{...props.gift,kind:'invite-refill',effect:'full-energy',xp:3,xpMin:3,xpMax:3,coins:12,coinsMin:12,coinsMax:12}}),/恢复至当前体力上限 · 经验 \+3 · 金币 \+12/);
 const legacy={...props.gift};delete legacy.coins;delete legacy.coinsMin;delete legacy.coinsMax;assert.equal(h5.gift({...props,gift:legacy}).includes('金币'),false);
});

test('H5 invitation confirmation uses current task reward coins and daily target',()=>{
 const markup=h5.invitation({code:'a'.repeat(12),onClose(){},reward:{...task('invitation',22),target:4}});assert.match(markup,/金币 \+22/);assert.match(markup,/每天最多奖励4位/);
 assert.equal(h5.invitation({code:'a'.repeat(12),onClose(){}}).includes('金币'),false);
});

test('H5 profile toast tracks actual coin changes and treats a missing legacy field as zero',async()=>{
 // Only React lifecycle is stubbed: execute the real profile apply callback,
 // including profile validation, receipt key deduplication and notice parts.
 const hooks=`export const callbacks=[],states=[];export const createContext=()=>({Provider:'provider'});export const useCallback=fn=>(callbacks.push(fn),fn);export const useEffect=()=>{};export const useContext=()=>null;export const useRef=value=>({current:value});export const useState=value=>{const index=states.length;states.push(value);return[value,next=>{states[index]=next}];};`;
 const {probe}=await load({stdin:{contents:`import {MobileProvider} from './h5/mobile-state';import {callbacks,states} from 'react';export function probe(){MobileProvider({children:null});return {apply:callbacks[0],states};}`,resolveDir:root,loader:'tsx'},loader:{'.css':'empty'},plugins:[{name:'controlled-react-lifecycle',setup(build){build.onResolve({filter:/^react(?:\/jsx-runtime)?$/},args=>({path:args.path,namespace:'probe-react'}));build.onLoad({filter:/.*/,namespace:'probe-react'},args=>({contents:args.path==='react'?hooks:`export const jsx=(type,props)=>({type,props});export const jsxs=jsx;export const Fragment='fragment';`,loader:'js'}));}}]});
 const {apply,states}=probe(),profile={...view().profile,supply:{energy:0,create:0},ownedRooms:[]};
 apply(profile);const reward={id:'receipt',type:'gift-open',quantity:1,energy:10,xp:2,coins:21};
 apply({...profile,lastReward:reward});assert.match(states[4],/开启1份礼包，体力 \+10 · 经验 \+2 · 金币 \+21/);
 apply({...profile,lastReward:{...reward,coins:22}});assert.match(states[4],/金币 \+22/,'coin-only receipt change is observed');
 const legacy={...reward};delete legacy.coins;apply({...profile,lastReward:legacy});assert.equal(states[4].includes('金币'),false);
 states[4]='dedupe sentinel';apply({...profile,lastReward:{...legacy,coins:0}});assert.equal(states[4],'dedupe sentinel','missing coins and explicit zero use the same receipt key');
});

test('gift coin sound follows a successful coin receipt and survives refresh failure without replay',async()=>{
 const a=app(),sounds=[];a.instance.platform.playSound=url=>sounds.push(url);
 let coins=12,fail=false;a.instance.client.post=async()=>{if(fail)throw Error('offline');return {...view(),opened:{kind:'cooperation-10',quantity:1,energy:10,xp:2,coins,levels:0}};};
 await a.instance.openGift('cooperation-10');assert.deepEqual(sounds,['assets/audio/mobile-coin.wav']);
 coins=0;await a.instance.openGift('cooperation-10');coins=undefined;await a.instance.openGift('cooperation-10');fail=true;await a.instance.openGift('cooperation-10');assert.equal(sounds.length,1);
 fail=false;coins=9;a.instance.client.refresh=async()=>{throw Error('refresh offline');};await a.instance.openGift('cooperation-10');assert.equal(sounds.length,2);assert.equal(a.instance.attempts.has('gift:cooperation-10'),false);
});
