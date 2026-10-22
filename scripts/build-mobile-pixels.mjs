import {readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';

// Compile the existing B2 SVG pixel grids into host-independent drawing data.
// React border-image and both Canvas platforms therefore use the same source art.
const root=resolve(import.meta.dirname,'..');
const manifest=JSON.parse(readFileSync(resolve(root,'public/pixel-ui/manifest.json'),'utf8'));
const assets={};
for(const item of manifest.assets){
 const svg=readFileSync(resolve(root,'public/pixel-ui',item.file),'utf8');
 const rects=[...svg.matchAll(/<rect\s+([^>]+)\/?\s*>/g)].map(([,attrs])=>{
  const values=Object.fromEntries([...attrs.matchAll(/([\w-]+)="([^"]*)"/g)].map(m=>[m[1],m[2]]));
  return [Number(values.x||0),Number(values.y||0),Number(values.width),Number(values.height),values.fill];
 });
 if(!rects.length||rects.some(r=>!r[4]||r.slice(0,4).some(n=>!Number.isFinite(n))))throw Error('Invalid shared pixel source: '+item.file);
 assets[item.id]={width:item.width,height:item.height,slice:item.slice,surface:item.colors.surface,rects};
}
// The primary call-to-action reuses the berry button shapes in a deeper shade.
const berryDark={'#C8838D':'#A85567','#BE7A84':'#9E4F60','#CC8C94':'#AD5C6D','#B36E7C':'#94495A','#B06B79':'#8E4556','#B16E7B':'#954B5B','#874754':'#6F3442','#773E4D':'#66303D','#F4D8D8':'#DDA2AC','#F7E3E1':'#E4AEB6'};
for(const state of ['normal','pressed','selected','disabled']){
 const source=assets['button-berry-'+state],shade=color=>state==='disabled'?color:berryDark[color.toUpperCase()]??color;
 if(!source)throw Error('Missing berry button: '+state);
 assets['button-berrydark-'+state]={...source,surface:shade(source.surface),rects:source.rects.map(([x,y,w,h,color])=>[x,y,w,h,shade(color)])};
}
writeFileSync(resolve(root,'mobile/pixel-frame-data.json'),JSON.stringify(assets)+'\n');
console.log('Shared B2 pixel frames: '+Object.keys(assets).length);
