import {createRequire} from 'node:module';
import {readFileSync,writeFileSync,mkdirSync,copyFileSync} from 'node:fs';
import {resolve,dirname,relative} from 'node:path';
import {createHash} from 'node:crypto';

const root=resolve(import.meta.dirname,'..');
const source=resolve(process.argv.find(value=>value.startsWith('--source='))?.slice(9)||'../../jigsaw-nook-taptap');
const require=createRequire(resolve(source,'package.json')),{build}=require('esbuild');
const config={id:'web',gameName:'拼图小窝',development:false,identityMode:'web-cookie',apiBase:'/api/shared',assetBase:'',gameBase:'/play',uiBase:''};
const result=await build({absWorkingDir:source,entryPoints:['mobile/entry-web.ts'],bundle:true,write:false,format:'iife',target:'es2020',platform:'browser',minify:true,legalComments:'eof',define:{__GAME_CONFIG__:JSON.stringify(config)},metafile:true});
if(Object.keys(result.metafile.inputs).some(path=>/node_modules\/(react|react-dom)\//.test(path)))throw Error('Shared game unexpectedly imports React');
const bundle=result.outputFiles[0].contents;
const assets=[...['mobile-snap.wav','mobile-coin.wav'].map(name=>['public/audio/'+name,'assets/audio/'+name]),...['b2-card-icons1023.png','b2-core-icons23.png','b2-task-icons23.png'].map(name=>['public/mobile-icons/'+name,'assets/ui/'+name]),...['b2-supply-scenes.png','b2-pixel-atlas.png'].map(name=>['public/mobile-icons/'+name,'art/'+name]),...['OFL-NotoSansSC.txt','FONT-NOTICES.md','jigsaw-ui-sc.woff2'].map(name=>['public/fonts/'+name,'assets/fonts/'+name])];
const digest=createHash('sha256').update(bundle);for(const [from]of assets)digest.update(readFileSync(resolve(source,from)));
const id=digest.digest('hex').slice(0,16),url='/shared-client/'+id+'/',out=resolve(root,'public'+url);
mkdirSync(out,{recursive:true});writeFileSync(resolve(out,'game.js'),bundle);
for(const [from,to]of assets){mkdirSync(dirname(resolve(out,to)),{recursive:true});copyFileSync(resolve(source,from),resolve(out,to));}
const inputs=Object.keys(result.metafile.inputs).filter(path=>!path.startsWith('<')).map(path=>({path,sha256:createHash('sha256').update(readFileSync(resolve(source,path))).digest('hex')}));
writeFileSync(resolve(root,'app/shared-client-build.json'),JSON.stringify({id,uiBase:url,script:url+'game.js'},null,2)+'\n');
const runtimePath=resolve(root,'config/runtime-assets.json'),runtime=JSON.parse(readFileSync(runtimePath,'utf8'));
runtime.static=[...runtime.static.filter(path=>!path.startsWith('/shared-client/')),url+'game.js',...assets.map(([,to])=>url+to)];
writeFileSync(runtimePath,JSON.stringify(runtime,null,2)+'\n');
mkdirSync(resolve(root,'work'),{recursive:true});writeFileSync(resolve(root,'work/shared-client-export.json'),JSON.stringify({createdAt:new Date().toISOString(),id,source:relative(root,source),config,inputs,files:runtime.static.filter(path=>path.startsWith(url))},null,2)+'\n');
console.log(JSON.stringify({id,uiBase:url,bytes:bundle.length,files:assets.length+1}));
