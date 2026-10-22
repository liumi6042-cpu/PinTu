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
writeFileSync(resolve(root,'mobile/pixel-frame-data.json'),JSON.stringify(assets)+'\n');
console.log('Shared B2 pixel frames: '+Object.keys(assets).length);
