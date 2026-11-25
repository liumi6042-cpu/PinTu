import {copyFileSync,existsSync,linkSync,lstatSync,mkdirSync,readFileSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {inside} from './release-files.mjs';
import {resolveMediaDir,safeMediaFile} from './media-paths.mjs';

/** Only immutable artwork/public inputs share storage with the isolated build.
 * Source/configuration files remain independent so a compiler cannot edit them.
 */
export function stageBuildSource(sourceRoot,buildRoot,names){
  for(const name of new Set(names)){
    const source=inside(sourceRoot,resolve(sourceRoot,name));
    if(!existsSync(source))continue;
    if(!lstatSync(source).isFile())throw new Error('Build input must be a regular file: '+name);
    const target=inside(buildRoot,resolve(buildRoot,name));
    mkdirSync(dirname(target),{recursive:true});
    if(name.startsWith('public/')||name.startsWith('content/artwork/'))linkSync(source,target);
    else copyFileSync(source,target);
  }
}

/** A release skips Vite's whole-public copy, then installs the complete existing
 * runtime allowlist. Raw originals remain available to provenance validation but
 * never enter dist/client or the final runtime archive.
 */
export function materializeRuntimeAssets(sourceRoot,buildRoot,assets){
  const puzzlesDir=resolveMediaDir(sourceRoot,'puzzles');
  for(const url of assets){
    if(typeof url!=='string'||!url.startsWith('/')||url.startsWith('//')||url.includes('\\')||url.split('/').some(part=>part==='.'||part==='..'))throw new Error('Invalid runtime asset URL');
    const source=url.startsWith('/puzzles/')
      ? safeMediaFile(puzzlesDir,url.slice('/puzzles/'.length))
      : inside(sourceRoot,resolve(sourceRoot,'public'+url));
    if(!lstatSync(source).isFile())throw new Error('Runtime asset must be a regular file: '+url);
    const target=inside(buildRoot,resolve(buildRoot,'dist/client'+url));
    mkdirSync(dirname(target),{recursive:true});
    if(existsSync(target)){
      if(!readFileSync(source).equals(readFileSync(target)))throw new Error('Generated output conflicts with public runtime asset: '+url);
    }else linkSync(source,target);
  }
}
