const names=['白雏菊','粉波斯菊','薰衣草','蜜桃玫瑰','向日葵','红郁金香','蓝绣球','白百合','万寿菊','紫罗兰','勿忘我','康乃馨','百日菊','矮牵牛','三色堇','天竺葵','旱金莲','紫菀','金鱼草','黄水仙','风信子','紫鸢尾','栀子花','金鸡菊','虞美人','红山茶','铁线莲','飞燕草','铃兰','花毛茛','银莲花','毛地黄','鲁冰花','大丽花','牡丹','倒挂金钟','秋海棠','荷包牡丹','白玉兰','番红花','黑绒玫瑰','高山蓝罂粟','金兰','雪绒花','绿嚏根草','幽灵兰','西番莲','黑紫马蹄莲','蓝心绿绒蒿','嘉兰'];
export const flowers=names.map((name,i)=>({id:'f'+i,name,index:i,tier:i>=40?'稀有':i>=20?'进阶':'普通',minutes:i>=40?480:i>=20?120:30,price:i>=20?5:2,rare:i>=40}));
export const decorations=[['bench','原木长椅',3,1,12],['fence','原木围栏',3,1,6],['stones','踏石',2,1,4],['rock','苔石小景',1,1,8],['birdhouse','林间鸟屋',1,1,10],['sign','花田木牌',1,1,3],['lamp','树桩灯',1,1,10],['logs','木桩围边',2,1,6]].map(([id,name,w,h,price],index)=>({id,name,w,h,price,index}));
export const woodlandDecorations=[['woodBench','藤叶长椅',3,1,12],['flowerArch','花藤拱门',3,2,18],['mossPath','苔石小径',1,1,4],['woodLantern','林间路灯',1,1,10],['woodFence','木桩围栏',2,1,6],['birdBath','小鸟饮水台',2,2,15],['flowerCart','花园推车',2,2,16],['clayPots','陶罐组合',2,1,9],['mushroomRock','蘑菇石景',2,2,12],['waterLily','睡莲水景',2,2,12],['woodBirdhouse','木制鸟屋',1,1,10],['teaTable','林间茶桌',3,3,20]].map(([id,name,w,h,price],index)=>({id,name,w,h,price,index,atlas:'woodland-decor',water:id==='waterLily'}));
decorations.push(...woodlandDecorations);
export const flower=id=>flowers.find(f=>f.id===id);
export const decor=id=>decorations.find(d=>d.id===id);
export const expansionPrices=[10,15,20,30,40,50];
export const pondBounds={x:1690,y:160,width:590,height:390};
export const grid={cols:52,rows:22};
export function point(u,v){return {x:145+u*42,y:160+v*42};}
export function cell(x,y){return {u:(x-145)/42,v:(y-160)/42};}
export const sideSpriteIds=['bench','woodBench','fence','woodFence','flowerArch','logs','flowerCart','sign','birdhouse','woodBirdhouse','lamp','woodLantern'];
export const flatTurnIds=['stones','mossPath','waterLily'];
export function canTurn(item){return item.kind==='decor'&&(sideSpriteIds.includes(item.type)||flatTurnIds.includes(item.type));}
export function size(item){const dims=item.kind==='bed'?[2,2]:item.kind==='decor'?[decor(item.type).w,decor(item.type).h]:[1,1];return item.orientation===1?[dims[1],dims[0]]:dims;}
const pondOutline=[[.02,.6],[.06,.42],[.23,.30],[.43,.32],[.47,.16],[.65,.04],[.84,.05],[.95,.26],[.98,.58],[.9,.83],[.7,.96],[.28,.96],[.05,.82]];
function inside(x,y,poly){let hit=false;for(let i=0,j=poly.length-1;i<poly.length;j=i++){const[a,b]=poly[i],[c,d]=poly[j];if((b>y)!==(d>y)&&x<(c-a)*(y-b)/(d-b)+a)hit=!hit;}return hit;}
function surfaceAt(px,py){const x=(px-pondBounds.x)/pondBounds.width,y=(py-pondBounds.y)/pondBounds.height;if(((x-.49)/.32)**2+((y-.64)/.18)**2<1)return 'water';return inside(x,y,pondOutline)?'rock':'land';}
export function surface(u,v){if(u<0||v<0||u>=grid.cols||v>=grid.rows)return 'outside';const samples=[[.12,.12],[.88,.12],[.12,.88],[.88,.88],[.5,.5]].map(([a,b])=>{const p=point(u+a,v+b);return surfaceAt(p.x,p.y);});return samples.every(t=>t==='land')?'land':samples.every(t=>t==='water')?'water':'rock';}
export function ground(u,v){return ['land','water'].includes(surface(u,v));}
export function valid(s,item,u,v){if(!Number.isInteger(u)||!Number.isInteger(v))return false;const[w,h]=size(item);for(let a=u;a<u+w;a++)for(let b=v;b<v+h;b++){const area=surface(a,b);if(area!=='land'&&area!=='water')return false;}return !s.items.some(o=>{if(o.id===item.id)return false;const[ow,oh]=size(o);return u<o.u+ow&&u+w>o.u&&v<o.v+oh&&v+h>o.v;});}
export function emptyPlace(s,item){for(let v=4;v<grid.rows;v++)for(let u=3;u<grid.cols;u++)if(valid(s,item,u,v))return {u,v};return null;}

// Shared series membership keeps the activity preview and warehouse in sync.
export const gardenGiftIds=['mossPath','woodFence','woodLantern','woodBench','birdBath','teaTable','flowerArch'];
export const decorSeries=[{id:'all',name:'全部装饰'}, {id:'garden-gift',name:'七日花园礼'}, {id:'woodland',name:'林间拾趣'}, {id:'basics',name:'原木与石'}];
export function inDecorSeries(item,series){return series==='all'||(series==='garden-gift'?gardenGiftIds.includes(item.id):series==='woodland'?Boolean(item.atlas)&&!gardenGiftIds.includes(item.id):series==='basics'?!item.atlas:false);}

export const activityRewards=[['mossPath',12],['woodFence',10],['woodLantern',4],['woodBench',2],['birdBath',1],['teaTable',1],['flowerArch',2]].map(([type,count],i)=>({day:i+1,type,count}));
export const cosmeticIds=['leaf','flower','moon','puzzle','wave','maple','mushroom','bee','ginkgo','pinecone','feather','strawberry'];
export const cosmeticNames=['森间新芽','花间来信','月光晚安','拼图片刻','海盐微风','秋日暖茶','苔间蘑菇','蜂蜜来信','银杏拾光','松果小径','青羽手札','莓果午后'];
export function activityState(s){return s.activity??={id:'woodland-seven-v1',startedAt:Date.now(),days:[],claimed:0,lastClaimDay:'',dismissed:false};}
export function creditActivity(s,{completedAt,pieces,contribution,total,roomId}){
 const a=activityState(s);if(!Number.isFinite(completedAt)||completedAt<a.startedAt||pieces<300||!Number.isSafeInteger(contribution)||!Number.isSafeInteger(total)||total<1||contribution<1||contribution>total)return false;
 const day=new Date(completedAt).toISOString().slice(0,10);if(a.days.includes(day)||a.days.length>=7)return false;
 a.contributions??={};a.rooms??={};const key=roomId||[completedAt,contribution,total].join(':');if(a.rooms[key])return false;a.rooms[key]=true;a.contributions[day]=Math.min(100,(a.contributions[day]||0)+contribution);
 if(contribution/total<.5&&a.contributions[day]<100)return false;a.days.push(day);a.days.sort();return true;
}
