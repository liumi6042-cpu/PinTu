import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwind from '@tailwindcss/postcss';
import { fileURLToPath } from 'node:url';
const root=fileURLToPath(new URL('..',import.meta.url)).replaceAll('\\','/').replace(/\/$/,'');
export default defineConfig({
  root:root+'/h5',base:'./',publicDir:root+'/work/h5-shell-public',
  resolve:{alias:{'@/lib/use-assistance':root+'/h5/use-assistance.ts','@':root,'next/navigation':root+'/h5/navigation.tsx','next/link':root+'/h5/link.tsx'}},
  plugins:[{
    name:'jigsaw-h5-client-adapter',enforce:'pre',
    transform(source,id){
      if(!/\.[jt]sx?(?:\?|$)/.test(id)||(!id.startsWith(root+'/app/')&&!id.startsWith(root+'/lib/')&&!id.startsWith(root+'/components/')))return;
      let code=source;const imports:string[]=[];
      // Isolated TapTap hosts reject no-cors preview images. Match the puzzle
      // canvas loader's anonymous CORS mode without changing the original site.
      code=code.replace(/<img(?=[\s/>])/g,'<img crossOrigin="anonymous"');
      if(/\bfetch\s*\(|=\s*fetch\b/.test(code)){code=code.replace(/(?<![\w.])fetch\s*\(/g,'__h5Fetch(').replace(/=\s*fetch\b/g,'= __h5Fetch');imports.push("import { apiFetch as __h5Fetch } from '"+root+"/h5/network';");}
      const names=new Set<string>();
      if(code.includes('window.history.replaceState(')) {code=code.replaceAll('window.history.replaceState(', 'replaceRouteHistory(');names.add('replaceRouteHistory');}
      if(/src="\/(?:intro|cosmetics|puzzles)\//.test(code)){code=code.replace(/src="(\/(?:intro|cosmetics|puzzles)\/[^"\n]+)"/g, 'src={assetUrl("$1")}');imports.push("import { assetUrl } from '"+root+"/h5/config';");}
      if(id.endsWith('/lib/cosmetic-art.ts')) {code=code.replace("delivery[id as keyof typeof delivery][kind]", "assetUrl(delivery[id as keyof typeof delivery][kind])");imports.push("import { assetUrl } from '"+root+"/h5/config';");}
      code=code.replace(/(?:window\.)?\blocation\.(assign|replace)\(/g,(_,method)=>{names.add('navigate');return method==='replace'?'__h5Replace(':'navigate(';});
      if(code.includes('__h5Replace('))imports.push('const __h5Replace=(path:string)=>navigate(path,true);');
      for(const [part,fn] of [['pathname','currentPath'],['search','currentSearch'],['href','currentHref'],['hash','currentHash']]){
        const expression=new RegExp('(?:window\\.)?\\blocation\\.'+part+'\\b','g');
        if(expression.test(code)){code=code.replace(expression,fn+'()');names.add(fn);}
      }
      if(names.size)imports.unshift("import { "+[...names].join(',')+" } from '"+root+"/h5/navigation';");
      // Catalog JSON and cosmetics definitions retain their IDs; only packaged
      // static URLs are resolved relative to the H5 entry directory.
      if(id.endsWith('/lib/puzzle-catalog.ts')){
        code=code.replace("const PLAYABLE_ORIGINS=","const PLAYABLE_ORIGINS=");
        code=code.replace('...photo,originalSrc:photo.src,src:photo.optimizedSrc??photo.playSrc,thumbSrc:photo.thumbSrc,','...photo,originalSrc:assetUrl(photo.src),src:assetUrl(photo.optimizedSrc??photo.playSrc),playSrc:assetUrl(photo.playSrc),optimizedSrc:assetUrl(photo.optimizedSrc),standardSrc:assetUrl(photo.standardSrc??photo.playSrc),optimizedStandardSrc:assetUrl(photo.optimizedStandardSrc??photo.playSrc),thumbSrc:assetUrl(photo.thumbSrc),');
        imports.push("import { assetUrl } from '"+root+"/h5/config';");
      }
      return {code:imports.join('\n')+'\n'+code,map:null};
    }
  },react()],
  css:{postcss:{plugins:[tailwind()]}},
  build:{outDir:root+'/outputs/h5',emptyOutDir:true,sourcemap:false,manifest:true},
  server:{host:'127.0.0.1',port:3210,strictPort:true},
});
