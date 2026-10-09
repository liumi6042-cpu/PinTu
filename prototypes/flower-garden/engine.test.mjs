import test from 'node:test';
import assert from 'node:assert/strict';
import {initial,act,stage} from './engine.mjs';
import {point,cell,valid,surface,size} from './catalog.mjs';
test('池塘水面开放所有品类，岸边空地开放，假山阻挡',()=>{const s=initial();assert.equal(surface(42,5),'water');assert.equal(valid(s,{id:99,kind:'flower',type:'f0'},42,5),true);assert.equal(valid(s,{id:99,kind:'bed'},42,5),true);assert.equal(valid(s,{id:99,kind:'flower',type:'f0'},38,0),true);assert.equal(valid(s,{id:99,kind:'flower',type:'f0'},46,1),false);s.owned.f0=1;const placed=command(s,'place',{kind:'flower',type:'f0'});const moved=command(placed,'move',{id:placed.items.at(-1).id,u:42,v:5});assert.equal(moved.items.at(-1).u,42);});
test('扩大的右侧与边缘可以摆放，超出52列仍阻止',()=>{const s=initial(),bed=s.items[0];assert.equal(valid(s,bed,49,18),true);assert.equal(valid(s,bed,0,0),true);assert.equal(valid(s,bed,51,18),false);});
test('正交方格：横向移动不改变纵坐标，纵向移动不改变横坐标，坐标可逆',()=>{for(const [u,v] of [[0,0],[7,9],[27,21],[3.25,8.5]]){const p=point(u,v),right=point(u+1,v),down=point(u,v+1);assert.equal(right.y,p.y);assert.equal(down.x,p.x);assert.equal(right.x-p.x,down.y-p.y);assert.deepEqual(cell(p.x,p.y),{u,v});}});
let serial=0;
const command=(s,action,args={},random=()=>.1)=>act(s,{action,...args,version:s.version,requestId:String(++serial)},Date.UTC(2026,8,24,12),random).state;
test('种子—种植—离线成熟—收获—摆放—收回，以及重复领取保护',()=>{let s=initial();s=command(s,'plant',{id:1,type:'f0'});assert.equal(s.items[0].crop.end-s.items[0].crop.start,180000);assert.throws(()=>command(s,'harvest',{id:1}));s=command(s,'testTime',{minutes:3});assert.equal(stage(s.items[0].crop,Date.UTC(2026,8,24,12)+s.offset),'可收获');s=command(s,'harvest',{id:1});assert.equal(s.album.f0,1);assert.throws(()=>command(s,'harvest',{id:1}));s=command(s,'place',{kind:'flower',type:'f0'});const id=s.items.at(-1).id;assert.throws(()=>command(s,'place',{kind:'flower',type:'f0'}));s=command(s,'store',{id});assert.equal(s.owned.f0,1);const req={action:'buySeed',type:'f0',version:s.version,requestId:'idempotent'};s=act(s,req).state;assert.deepEqual(act(s,req).state,s);});
test('稀有种子只孵蛋产出，成品花入册，日限两次',()=>{let s=initial();assert.throws(()=>command(s,'buySeed',{type:'f40'}));s.progress=300;s=command(s,'hatch',{},()=>.1);assert.equal(Object.keys(s.seeds).some(k=>Number(k.slice(1))>=40),true);assert.equal(Object.keys(s.album).length,0);s=command(s,'hatch',{},()=>.6);assert.equal(Object.keys(s.album).length,1);assert.throws(()=>command(s,'hatch'));s=command(s,'testTime',{minutes:1440});s=command(s,'hatch');assert.equal(s.hatched,3);});
test('网格阻挡和花田移动不改变生长时间；扩建上限10',()=>{let s=initial();s=command(s,'plant',{id:1,type:'f0'});const end=s.items[0].crop.end;assert.throws(()=>command(s,'move',{id:1,u:10,v:9}));assert.throws(()=>command(s,'move',{id:1,u:40,v:7}));assert.throws(()=>command(s,'move',{id:1,u:-1,v:0}));s=command(s,'move',{id:1,u:4,v:6});assert.equal(s.items[0].crop.end,end);s.coins=1000;for(let i=0;i<6;i++)s=command(s,'expand');assert.equal(s.items.length,10);assert.throws(()=>command(s,'expand'));});
test('签到防重复、种子余额、装饰兑换上限与陈旧请求',()=>{let s=command(initial(),'checkin');assert.throws(()=>command(s,'checkin'));assert.throws(()=>act(s,{action:'checkin',version:0,requestId:'stale'}));assert.throws(()=>command(s,'plant',{id:1,type:'f49'}));s.coins=1000;for(let i=0;i<10;i++)s=command(s,'buyDecor',{type:'bench'});assert.equal(s.decorOwned.bench,10);assert.throws(()=>command(s,'buyDecor',{type:'bench'}));});
test('普通/进阶/稀有成长时长和存档恢复',()=>{let s=initial();s.firstPlant=true;s.seeds={f0:1,f20:1,f40:1};for(const [id,type,min] of [[1,'f0',30],[2,'f20',120],[3,'f40',480]]){s=command(s,'plant',{id,type});const c=s.items.find(i=>i.id===id).crop;assert.equal(c.end-c.start,min*60000);}const restored=JSON.parse(JSON.stringify(s));assert.deepEqual(restored,s);});

test('池塘新位置禁止摆放，旧位置释放',()=>{const s=initial();assert.equal(valid(s,s.items[0],40,7),false);assert.equal(valid(s,s.items[0],25,0),true);});

 test('全部装饰测试权限、兑换与孵化不混用额度，睡莲可放水面',async()=>{
 const {decorations,woodlandDecorations}=await import('./catalog.mjs');
 const {grantDecor}=await import('./engine.mjs');
 let s=initial();const before=structuredClone(s.items);grantDecor(s);grantDecor(s);
 assert.deepEqual(s.items,before);assert.equal(s.coins,20);assert.deepEqual(s.redeemed,{});
 for(const d of decorations)assert.equal(s.decorOwned[d.id],10);
 for(const d of woodlandDecorations){s=command(s,'place',{kind:'decor',type:d.id});s=command(s,'store',{id:s.items.at(-1).id});}
 assert.equal(valid(s,{id:999,kind:'decor',type:'waterLily'},41,5),true);
 assert.equal(valid(s,{id:999,kind:'decor',type:'bench'},41,5),true);
 s.progress=100;s=command(s,'hatch',{},()=>.25);assert.equal(Object.values(s.decorOwned).reduce((a,b)=>a+b,0),201);assert.deepEqual(s.redeemed,{});
 s.coins=1000;for(let i=0;i<10;i++)s=command(s,'buyDecor',{type:'flowerCart'});
 assert.throws(()=>command(s,'buyDecor',{type:'flowerCart'}));assert.equal(s.decorOwned.flowerCart,20);
 });

test('水面允许花田与普通装饰，仍阻止重叠和越界',()=>{
 let s=initial();s=command(s,'move',{id:1,u:42,v:5});assert.equal(s.items[0].u,42);
 s.decorOwned.bench=1;s=command(s,'place',{kind:'decor',type:'bench'});const id=s.items.at(-1).id;
 assert.throws(()=>command(s,'move',{id,u:42,v:5}));
 s=command(s,'move',{id:1,u:7,v:9});s=command(s,'move',{id,u:41,v:5});assert.equal(s.items.at(-1).u,41);
 assert.throws(()=>command(s,'move',{id,u:51,v:5}));
});

test('转向交换横纵占地，保留坐标库存，重试和保存不重复转向',()=>{
 let s=initial();s.decorOwned.fence=1;s=command(s,'place',{kind:'decor',type:'fence'});const item=s.items.at(-1),id=item.id,inventory=JSON.stringify(s.decorOwned);
 assert.deepEqual(size(item),[3,1]);const cmd={action:'rotate',id,version:s.version,requestId:'rotate-once'};
 s=act(s,cmd).state;assert.deepEqual(size(s.items.at(-1)),[1,3]);assert.equal(s.items.at(-1).u,item.u);assert.equal(s.items.at(-1).v,item.v);assert.deepEqual(act(s,cmd).state,s);
 s=JSON.parse(JSON.stringify(s));assert.deepEqual(size(s.items.at(-1)),[1,3]);s=command(s,'rotate',{id});assert.deepEqual(size(s.items.at(-1)),[3,1]);assert.equal(JSON.stringify(s.decorOwned),inventory);
});
test('转向遇到物品、边界或岩石时拒绝且不修改原存档',()=>{
 let s=initial();s.decorOwned.fence=1;s=command(s,'place',{kind:'decor',type:'fence'});const fence=s.items.at(-1),id=fence.id;
 s=command(s,'move',{id,u:3,v:21});let before=JSON.stringify(s);assert.throws(()=>command(s,'rotate',{id}),/空间不足/);assert.equal(JSON.stringify(s),before);
 s=command(s,'move',{id,u:3,v:4});s.items.push({id:100,kind:'flower',type:'f0',u:3,v:6});before=JSON.stringify(s);assert.throws(()=>command(s,'rotate',{id}),/空间不足/);assert.equal(JSON.stringify(s),before);
 s.items=s.items.filter(i=>i.id!==100);
 let rockPos=null;for(let u=0;u<52;u++)for(let v=0;v<20;v++)if(valid(s,{...fence,orientation:0},u,v)&&!valid(s,{...fence,orientation:1},u,v)&&[1,2].some(d=>surface(u,v+d)==='rock'))rockPos={u,v};
 assert.ok(rockPos);s=command(s,'move',{id,...rockPos});assert.throws(()=>command(s,'rotate',{id}),/空间不足/);
});
test('旧镜像存档默认横向，转向清掉镜像且不影响种花',()=>{
 let s=initial();s=command(s,'plant',{id:1,type:'f0'});const crop=structuredClone(s.items[0].crop);s.decorOwned.bench=1;s=command(s,'place',{kind:'decor',type:'bench'});s.items.at(-1).flipped=true;
 assert.deepEqual(size(s.items.at(-1)),[3,1]);s=command(s,'rotate',{id:s.items.at(-1).id});assert.equal(s.items.at(-1).flipped,undefined);assert.deepEqual(s.items[0].crop,crop);
 assert.throws(()=>command(s,'rotate',{id:999}));assert.throws(()=>command(s,'rotate',{id:1}),/没有横纵朝向/);
});
