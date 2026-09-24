export const styles=[
 ['leaf','森间新芽','Forest sprout'],['flower','花间来信','Blossom letter'],['moon','月光晚安','Moonlight'],['puzzle','拼图片刻','Puzzle moment'],
 ['wave','海盐微风','Sea breeze'],['maple','秋日暖茶','Autumn tea'],['mushroom','苔间蘑菇','Woodland mushroom'],['bee','蜂蜜来信','Honey letter'],
 ['ginkgo','银杏拾光','Golden ginkgo'],['pinecone','松果小径','Pinecone path'],['feather','青羽手札','Blue feather'],['strawberry','莓果午后','Strawberry afternoon']
].map(([id,zh,en],index)=>({id,zh,en,index}));
export function validStyle(id){return typeof id==='string'&&styles.some(s=>s.id===id);}
export function cosmeticsOf(state){const raw=state?.cosmetics||{};const bubbles=(raw.bubbles||[]).filter(validStyle),cursors=(raw.cursors||[]).filter(validStyle);return {bubbles,cursors,equipped:{bubble:bubbles.includes(raw.equipped?.bubble)?raw.equipped.bubble:null,cursor:cursors.includes(raw.equipped?.cursor)?raw.equipped.cursor:null}};}
export function drawCosmetic(state,random=Math.random){const c=cosmeticsOf(state),roll=random(),kind=roll<.7?'furniture':roll<.85?'bubble':'cursor';if(kind==='furniture')return null;const owned=kind==='bubble'?c.bubbles:c.cursors,pool=styles.filter(s=>!owned.includes(s.id));return pool.length?{kind,item:pool[Math.min(pool.length-1,Math.floor(random()*pool.length))].id}:null;}
export const iconSheet='/cosmetics/icons-v1.png',bubbleSheet='/cosmetics/bubbles-v1.png';
export function iconCrop(id){const i=styles.find(s=>s.id===id)?.index??0;return [i%4*362,Math.floor(i/4)*362,362,362];}
export function bubbleCrop(id){const i=styles.find(s=>s.id===id)?.index??0;return [i%3*512,[55,275,498,724][Math.floor(i/3)],512,215];}
