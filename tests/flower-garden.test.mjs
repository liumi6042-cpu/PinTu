import test from 'node:test';
import assert from 'node:assert/strict';
import {initialGarden,prices} from '../lib/courtyard-model.mjs';
import {migrateFlowerGarden,applyFlowerAction,flowerState,creditFlowerActivity} from '../lib/flower-garden-model.mjs';
import {gardenGiftIds,activityRewards} from '../public/flower-garden/catalog.mjs';
const today=Date.UTC(2026,8,26,12),DAY=86400000;let serial=0;
const run=(s,action,args={},at=today,r=()=>.1)=>applyFlowerAction(s,{action,version:++serial,requestId:String(serial).padStart(32,'0'),...args},at,r);
const make=()=>{const s=initialGarden();migrateFlowerGarden(s,today);s.balance=10000;return s;};
test('旧库存与已摆放不重复计价，主题折算一次，保留进度装扮',()=>{
 const s=initialGarden();s.balance=8;s.owned={chair:2,plant:3};s.layout=[{type:'chair'}];s.themes=['wood','country','country'];s.progress=37;s.cosmetics={bubbles:['leaf'],cursors:[],equipped:{bubble:'leaf',cursor:null}};
 assert.equal(migrateFlowerGarden(s,today),true);assert.equal(s.balance,8+2*prices.chair+3*prices.plant+60);assert.equal(s.progress,37);assert.equal(s.cosmetics.equipped.bubble,'leaf');assert.equal(s.flowerGarden.items.length,4);assert.equal(Object.keys(s.flowerGarden.decorOwned).length,0);
 const snapshot=JSON.stringify(s);assert.equal(migrateFlowerGarden(s,today+DAY),false);assert.equal(JSON.stringify(s),snapshot);assert.deepEqual(s.owned,{});
});
test('蛋池保留装扮且排除活动物品，稀有种子不能兑换，孵化扣费限额',()=>{
 for(const [roll,kind] of [[.1,'seed'],[.25,'decor'],[.6,'flower'],[.75,'bubble'],[.95,'cursor']]){
 const s=make();s.progress=250;const out=run(s,'hatch',{},today,()=>roll);assert.equal(out.kind,kind);assert.equal(s.progress,200);assert.equal(s.hatched,1);assert.equal(s.dailyHatches,1);assert.ok(!gardenGiftIds.includes(out.type));run(s,'hatch',{},today,()=>roll);assert.equal(s.progress,100);assert.throws(()=>run(s,'hatch',{},today),/已孵化/);
 }
 const s=make();for(const id of gardenGiftIds)assert.throws(()=>run(s,'buyDecor',{type:id}),/活动/);assert.throws(()=>run(s,'buySeed',{type:'f40'}),/稀有/);assert.throws(()=>run(s,'testCoins'),/不支持/);assert.throws(()=>run(s,'testActivity'),/不支持/);
});
test('七天活动按服务器贡献达成、按日一次、足量发放且不清零',()=>{
 const s=make();assert.throws(()=>run(s,'activityClaim'),/完成拼图/);
 assert.equal(creditFlowerActivity(s,{completedAt:today,pieces:300,contribution:49,total:100}),false);
 assert.equal(creditFlowerActivity(s,{completedAt:today,pieces:108,contribution:100,total:100}),false);
 assert.equal(creditFlowerActivity(s,{completedAt:today-1,pieces:300,contribution:100,total:100}),false);
 for(let i=0;i<7;i++){const at=today+i*2*DAY;assert.equal(creditFlowerActivity(s,{completedAt:at,pieces:300,contribution:50,total:100}),true);assert.equal(creditFlowerActivity(s,{completedAt:at,pieces:300,contribution:50,total:100}),false);const out=run(s,'activityClaim',{},at);assert.equal(out.count,activityRewards[i].count);assert.equal(s.flowerGarden.decorOwned[out.type],out.count);assert.throws(()=>run(s,'activityClaim',{},at));}
 assert.equal(s.flowerGarden.activity.claimed,7);assert.equal(s.flowerGarden.activity.days.length,7);run(s,'activityDismiss');assert.equal(flowerState(s).activity.dismissed,true);
});
test('正式花园播种离线成长收获摆放与碎片余额同步',()=>{
 const s=make();run(s,'buySeed',{type:'f0'});assert.equal(s.balance,9998);run(s,'plant',{id:1,type:'f0'});assert.throws(()=>run(s,'harvest',{id:1},today+1000),/还在生长/);run(s,'harvest',{id:1},today+180000);assert.equal(s.flowerGarden.album.f0,1);run(s,'place',{kind:'flower',type:'f0'});assert.equal(s.flowerGarden.items.at(-1).type,'f0');assert.equal(s.balance,9998);
});
