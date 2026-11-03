import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {readFileSync} from 'node:fs';
import {REDEEM_GROUP_HINT,REDEEM_SOON,redeemAnswered,redeemCells,redeemErrorText,redeemInput,redeemSummary} from '../mobile/redeem.ts';
const bundle=await build({stdin:{contents:'export {GameApp} from "./mobile/app";',resolveDir:process.cwd(),loader:'ts'},bundle:true,write:false,format:'esm',platform:'node',target:'es2020'});
const {GameApp}=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text+'\n//# sourceURL=mobile-redeem-client-test-bundle.mjs').toString('base64'));

const paw={id:'cat-paw',title:'猫爪',kind:'cursor',artKey:'paw',color:'#f0a0a8'};
const grant=extra=>({code:'RF87JBT5',coins:0,fragments:0,energy:0,energyPacks:0,energyPacksSkipped:0,decorations:[],...extra});

test('typed codes are normalized like the server reads them',()=>{
 assert.equal(redeemInput(' rf87-jbt5 '),'RF87JBT5');
 assert.equal(redeemInput('ＲＦ８７　ｊｂｔ５'),'RF87JBT5');
 assert.equal(redeemInput(null),'');assert.equal(redeemInput('a'.repeat(40)).length,32);
 assert.equal(REDEEM_GROUP_HINT,'兑换码可在玩家 QQ 群 397229653 领取');
});

test('the group code shows 猫爪指针, or 20 碎片 when 猫爪 is already owned',()=>{
 const fresh=grant({energy:50,decorations:[{...paw,status:'granted'}]});
 assert.deepEqual(redeemCells(fresh).map(cell=>[cell.icon,cell.label,cell.extra]),[['lightning','体力 +50',null],['gift','猫爪指针',null]]);
 assert.deepEqual(redeemCells(fresh)[1].decoration,{id:'cat-paw',artKey:'paw',color:'#f0a0a8'});
 assert.equal(redeemSummary(fresh),'兑换成功：体力 +50 · 猫爪指针');
 const owned=grant({energy:50,fragments:20,decorations:[{...paw,status:'owned',fallback:{coins:0,fragments:20}}]});
 assert.deepEqual(redeemCells(owned).map(cell=>[cell.icon,cell.label,cell.extra]),[['lightning','体力 +50',null],['fragment','20 碎片','已拥有猫爪']]);
 assert.equal(redeemSummary(owned),'兑换成功：体力 +50 · 20 碎片（已拥有猫爪）');
});

test('coins, 碎片, packs (with a full stock) and decorations each get a card',()=>{
 const all=grant({coins:305,fragments:7,energyPacks:1,energyPacksSkipped:2,decorations:[{id:'cream-bow',title:'奶油蝴蝶结',kind:'cursor',artKey:'bow',color:'#fff',status:'granted'},{...paw,status:'owned',fallback:{coins:5,fragments:0}},{id:'old',status:'unavailable'}]});
 assert.deepEqual(redeemCells(all).map(cell=>[cell.icon,cell.label,cell.extra]),[['gift','奶油蝴蝶结指针',null],['coin','5 金币','已拥有猫爪'],['coin','金币 +300',null],['fragment','碎片 +7',null],['energy','体力包 ×1','库存满，少 2 个']]);
 assert.deepEqual(redeemCells(grant({energyPacksSkipped:3})).map(cell=>[cell.label,cell.extra]),[['体力包已满','没有发放 ×3']]);
 assert.equal(redeemSummary(grant({})),'兑换成功');
});

test('errors: server text as is, a missing endpoint says 即将开放, network failures keep the request id',()=>{
 const error=(message,status,code)=>Object.assign(Error(message),{status,code});
 assert.equal(redeemErrorText(error('你已经兑换过这个兑换码啦',409,'REDEEM_ALREADY_CLAIMED')),'你已经兑换过这个兑换码啦');
 assert.equal(redeemErrorText(error('兑换码不存在，请检查后重新输入',404,'REDEEM_CODE_NOT_FOUND')),'兑换码不存在，请检查后重新输入');
 assert.equal(redeemErrorText(error('接口不存在',404,'NOT_FOUND')),REDEEM_SOON);
 assert.equal(redeemErrorText(error('接口不存在',404,undefined)),REDEEM_SOON);
 assert.equal(redeemErrorText(Error('')),'暂时无法兑换，请稍后再试');
 assert.equal(redeemAnswered(error('x',409,'REDEEM_CODE_EXPIRED')),true);assert.equal(redeemAnswered(Error('timeout')),false);
});

function fixture({reply,prompt='ab23-cd45'}={}){
 const texts=[],buttons=[],hits=[],posts=[],notes=[],prompts=[];
 const stage={w:390,h:844,palette:{overlay:'#000',ink:'#111',muted:'#666',rose:'#c00'},ctx:{fillRect(){},set fillStyle(_v){}},measure:text=>String(text).length*12,panel(){},frame(){},icon(){},decoration(){},
  hit(r,fn){hits.push({r,fn});},text(label){texts.push(String(label));},button(r,label,fn,options){buttons.push({label,fn,disabled:options?.disabled===true});}};
 const app=Object.create(GameApp.prototype);
 let id=0;
 Object.assign(app,{stage,attempts:new Map(),busy:false,modal:null,collection:{cached:true},redeemCode:'',redeemError:null,redeemGrant:null,
  platform:{viewport:()=>({top:20,bottom:0}),randomId:()=>'r'+(++id),playSound(){},prompt:async(title,value,options)=>{prompts.push({title,value,options});return prompt;}},
  client:{post:async(path,body)=>{posts.push({path,body});return reply(body);}},
  invalidate(){},note:text=>notes.push(text),showModal(modal){this.modal=modal;},closeModal(){this.modal=null;}});
 const draw=()=>{texts.length=0;buttons.length=0;hits.length=0;app.drawRedeem();return {texts:[...texts],buttons:[...buttons],hits:[...hits]};};
 return {app,posts,notes,prompts,draw};
}

test('settings → 兑换码 → type → claim shows the reward popup and refreshes the collection',async()=>{
 const f=fixture({reply:body=>({redeemed:grant({code:body.code,energy:50,decorations:[{...paw,status:'granted'}]}),profile:{}})});
 f.app.openRedeem();assert.equal(f.app.modal,'redeem');
 let view=f.draw();
 assert.ok(view.texts.includes('兑换码'));assert.ok(view.texts.includes(REDEEM_GROUP_HINT));assert.ok(view.texts.includes('点这里输入兑换码'));
 view.hits.at(-1).fn();await new Promise(resolve=>setTimeout(resolve,0));
 assert.equal(f.prompts.length,1);assert.equal(f.prompts[0].options.singleLine,true);assert.equal(f.prompts[0].options.hint,REDEEM_GROUP_HINT);assert.equal(f.prompts[0].options.confirmLabel,'兑换');
 assert.deepEqual(f.posts.map(post=>[post.path,post.body.code]),[['/api/mobile/redeem','AB23CD45']]);assert.match(f.posts[0].body.requestId,/^r\d+$/);
 assert.equal(f.app.collection,null,'decorations reload with the collection');
 assert.deepEqual(f.notes,['兑换成功：体力 +50 · 猫爪指针']);
 view=f.draw();
 assert.ok(view.texts.includes('兑换成功'));assert.ok(view.texts.includes('体力 +50'));assert.ok(view.texts.includes('猫爪指针'));
 assert.deepEqual(view.buttons.map(button=>button.label).filter(Boolean),['好的']);
 view.buttons.find(button=>button.label==='好的').fn();assert.equal(f.app.modal,null);
});

test('a rejected code stays in the dialog with the server message; a retry after a network error reuses the request id',async()=>{
 let mode='network';
 const f=fixture({prompt:'zzzz9999',reply:()=>{if(mode==='network')throw Error('连接超时');throw Object.assign(Error('兑换码不存在，请检查后重新输入'),{status:404,code:'REDEEM_CODE_NOT_FOUND'});}});
 f.app.openRedeem();await f.app.promptRedeemCode();
 assert.equal(f.app.redeemError,'连接超时');
 mode='server';await f.app.submitRedeem();
 assert.equal(f.posts[0].body.requestId,f.posts[1].body.requestId,'same request id after a network failure');
 const view=f.draw();
 assert.ok(view.texts.includes('ZZZZ9999'));assert.ok(view.texts.includes('兑换码不存在，请检查后重新输入'));
 assert.equal(view.buttons.find(button=>button.label==='兑换')?.disabled,false);
 mode='server';await f.app.submitRedeem();assert.notEqual(f.posts[2].body.requestId,f.posts[1].body.requestId,'an answered error frees the id');
});

test('an old backend without the endpoint shows 兑换功能即将开放',async()=>{
 const f=fixture({reply:()=>{throw Object.assign(Error('接口不存在'),{status:404,code:'NOT_FOUND'});}});
 f.app.openRedeem();await f.app.promptRedeemCode();
 assert.equal(f.app.redeemError,REDEEM_SOON);assert.ok(f.draw().texts.includes(REDEEM_SOON));
});

test('the settings entry is TapTap-only and the package says v53.7',()=>{
 const source=readFileSync(new URL('../mobile/app.ts',import.meta.url),'utf8');
 assert.match(source,/const CLIENT_PACKAGE_VERSION='v53\.7';/);
 const settings=source.slice(source.indexOf("case'settings':{"),source.indexOf("heading('测试与诊断')"));
 assert.match(settings,/if\(!this\.formalWeb\)\{s\.button\(\{x:left,y:cy,w:width,h:39\},'兑换码',\(\)=>this\.openRedeem\(\)/);
 assert.ok(settings.indexOf("'兑换码'")>settings.indexOf("heading('账号与记录')"),'listed under 账号与记录');
});
