const defs={plant:{name:'红枫盆栽',cell:0,size:155,rx:23,ry:12},chair:{name:'木扶手椅',cell:1,size:110,rx:24,ry:14},table:{name:'和风茶几',cell:2,size:160,rx:49,ry:24},cushion:{name:'坐垫',cell:3,size:83,rx:26,ry:14},lamp:{name:'和纸灯',cell:4,size:110,rx:17,ry:10},rug:{name:'编织地毯',cell:5,size:176,rx:65,ry:29}};

const additions=[
['lemon','柠檬盆栽',0,155,1,1,12,'mediterranean'],['ironChair','铁艺椅',1,112,1,1,12,'mediterranean'],['mosaicTable','花砖圆茶桌',2,145,2,2,24,'mediterranean'],['blueVase','蓝釉陶罐',3,90,1,1,8,'mediterranean'],['lantern','铁艺落地灯',4,105,1,1,20,'mediterranean'],['tileRug','蓝纹地毯',5,185,3,2,40,'mediterranean'],
['roseBox','玫瑰花箱',0,140,2,1,16,'country'],['wingChair','布艺扶手椅',1,125,2,2,20,'country'],['sideTable','乡间小茶桌',2,108,1,1,16,'country'],['bookcase','胡桃木书柜',3,165,2,1,30,'country'],['brassLamp','黄铜落地灯',4,140,1,1,24,'country'],['plaidRug','格纹地毯',5,185,3,2,40,'country']];
const botanicals=[['olive','橄榄盆栽',170,2,2,18],['bamboo','青竹石盆',175,1,1,16],['fern','翠羽蕨',115,1,1,8],['hydrangea','蓝紫绣球',125,1,1,12],['lavender','薰衣草花箱',140,2,1,14],['bougainvillea','三角梅花架',180,2,1,22]];
for(const [id,name,size,w,h,price] of botanicals)additions.push([id,name,0,size,w,h,price,'botanical']);
for(const [id,name,cell,size,w,h,price,collection] of additions)defs[id]={name,cell,size,rx:w*24,ry:h*8,price,collection,asset:'assets/furniture-'+collection+'.png',isRug:id.endsWith('Rug')};
for(const [id] of botanicals)Object.assign(defs[id],{asset:'assets/plant-'+id+'.png',crop:[0,0,1024,1024],imageWidth:1024,imageHeight:1024,anchor:.94});
defs.rug.isRug=true;
const spriteCrops={lemon:[0,0,512,528],ironChair:[530,0,480,525],mosaicTable:[1030,20,500,510],blueVase:[20,535,470,480],lantern:[580,535,350,480],tileRug:[970,580,566,420],roseBox:[30,0,470,448],wingChair:[535,0,470,490],sideTable:[1080,0,450,480],bookcase:[80,450,370,560],brassLamp:[620,500,280,500],plaidRug:[1000,550,536,390]};
for(const [id,crop] of Object.entries(spriteCrops))defs[id].crop=crop;


const surfaces=[{id:2,points:[[520,290],[738,220],[1158,331],[858,415]]},{id:1,points:[[515,593],[790,505],[1170,604],[854,720]]},
// Paved ground follows the image, including the pockets beside the stairs and entrance.
{id:0,points:[[132,624],[251,580],[306,591],[365,667],[493,646],[824,752],[759,855],[639,878]]},
{id:0,points:[[898,779],[943,740],[1120,674],[1209,623],[1383,685],[967,866],[890,839]]}];
surfaces.push({id:0,points:[[739,752],[899,779],[953,847],[782,887],[664,867]]});
const obstacles=[[[1167,575],[1215,572],[1220,634],[1175,649]],[[829,700],[884,694],[886,759],[835,773]],[[947,716],[1088,662],[1114,680],[968,742]]];
let items=[],selected=null;
function inside(x,y,points){let yes=false;for(let i=0,j=points.length-1;i<points.length;j=i++){let a=points[i],b=points[j];if((a[1]>y)!==(b[1]>y)&&x<(b[0]-a[0])*(y-a[1])/(b[1]-a[1])+a[0])yes=!yes}return yes}
const sizes={plant:[1,1],lamp:[1,1],chair:[1,1],cushion:[1,1],table:[2,2],rug:[3,2]};for(const [id,name,cell,size,w,h] of additions)sizes[id]=[w,h];let preview=null;
function gridPoint(u,v){return {x:(u-v)*24,y:(u+v)*8}}
function snap(type,x,y){let [w,h]=sizes[type],u=(x/24+y/8)/2,v=(y/8-x/24)/2;let a=Math.round(u-w/2),b=Math.round(v-h/2);return {...gridPoint(a+w/2,b+h/2),u:a,v:b}}
function cells(type,x,y){let q=snap(type,x,y),[w,h]=sizes[type],out=[];for(let a=0;a<w;a++)for(let b=0;b<h;b++)out.push({u:q.u+a,v:q.v+b,...gridPoint(q.u+a+.5,q.v+b+.5)});return out}
function cellSurface(c){let samples=[[0,0],[20,0],[-20,0],[0,7],[0,-7]];return [2,1,0].find(z=>samples.every(([dx,dy])=>surfaces.some(s=>s.id===z&&inside(c.x+dx,c.y+dy,s.points)))&&!(z===1&&c.x>819&&c.x<893)&&!(z===0&&obstacles.some(o=>samples.some(([dx,dy])=>inside(c.x+dx,c.y+dy,o)))))}
function legal(t,x,y,ignore=selected){let list=cells(t,x,y),z=cellSurface(list[0]);if(z===undefined||list.some(c=>cellSurface(c)!==z))return false;return !items.some(i=>i.id!==ignore&&!defs[i.type].isRug&&!defs[t].isRug&&cells(i.type,i.x,i.y).some(a=>list.some(b=>a.u===b.u&&a.v===b.v)))}

export {defs,sizes,snap,botanicals};
export const prices={plant:5,cushion:8,chair:12,table:24,lamp:30,rug:60,...Object.fromEntries(Object.entries(defs).filter(([,d])=>d.price).map(([id,d])=>[id,d.price]))};
export const themes={wood:0,mediterranean:60,country:60};
export function validateLayout(layout,owned){
 if(!Array.isArray(layout)||layout.length>40)throw Error('Invalid layout');
 items=[];const ids=new Set(),counts={};
 try{for(const input of layout){if(!input||!Object.hasOwn(defs,input.type)||!Number.isInteger(input.id)||input.id<1||ids.has(input.id)||!Number.isFinite(input.x)||!Number.isFinite(input.y))throw Error('Invalid item');
 const q=snap(input.type,input.x,input.y);if(Math.abs(q.x-input.x)>.1||Math.abs(q.y-input.y)>.1||!legal(input.type,q.x,q.y,-1))throw Error('Invalid position');
 counts[input.type]=(counts[input.type]||0)+1;if(counts[input.type]>(owned[input.type]||0))throw Error('Item not owned');ids.add(input.id);items.push({id:input.id,type:input.type,x:q.x,y:q.y});}
 return items.map(i=>({...i}));}finally{items=[];}
}
export function initialGarden(){return {balance:0,progress:0,hatched:0,day:'',dailyHatches:0,checkinDay:'',checkins:0,firstDone:false,completionDay:'',inventoryVersion:2,owned:{},redeemed:{},layout:[],ledger:[],eggStyle:Math.floor(Math.random()*10),themes:['wood'],activeTheme:'wood'};}

// Retire legacy starter grants once, before any real hatch reward is issued.
// Version 2 inventories contain both redeemed and hatched furniture; preserve them.
export function retireStarterFurniture(state){
 if(state.inventoryVersion===2)return false;
 state.owned=Object.fromEntries(Object.entries(state.redeemed||{}).filter(([id,count])=>Object.hasOwn(defs,id)&&Number.isInteger(count)&&count>0));
 const placed={};state.layout=(state.layout||[]).filter(item=>{const n=(placed[item.type]||0)+1;if(n>(state.owned[item.type]||0))return false;placed[item.type]=n;return true;});
 state.inventoryVersion=2;return true;
}

// Furniture only: house styles are never part of this pool. All unowned types
// have equal chance; duplicates become available once every type is owned.
export function hatchFurniture(owned,random=Math.random){
 const all=Object.keys(defs),unowned=all.filter(id=>!(owned[id]>0)),pool=unowned.length?unowned:all;
 return pool[Math.min(pool.length-1,Math.max(0,Math.floor(random()*pool.length)))];
}
