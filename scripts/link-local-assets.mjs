import {mkdir,readdir,link,stat,readFile} from 'node:fs/promises';
import path from 'node:path';

export async function linkLocalAssets(root) {
  const source=path.resolve(root,'public'),target=path.resolve(root,'dist/client');
  if(!(await stat(target)).isDirectory())throw new Error('Local client build is missing.');
  async function visit(from,to){
    await mkdir(to,{recursive:true});
    for(const item of await readdir(from,{withFileTypes:true})){
      const src=path.join(from,item.name),dest=path.join(to,item.name);
      if(item.isSymbolicLink())throw new Error('Local public assets must be regular files.');
      if(item.isDirectory())await visit(src,dest);
      else if(item.isFile()){
        try { await link(src,dest); }
        catch(error){
          if(error.code!=='EEXIST')throw error;
          // The Sites plugin writes merged asset headers at the end of build.
          if(path.relative(source,src)==='_headers')continue;
          if(!(await readFile(src)).equals(await readFile(dest)))throw error;
        }
      }
    }
  }
  await visit(source,target);
}
