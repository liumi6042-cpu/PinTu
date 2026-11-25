import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readdirSync, readFileSync, realpathSync } from 'node:fs';
import { resolve, relative, sep, posix } from 'node:path';
import { isPlayableOrigin, RETAINED_STATUSES } from './image-origin.mjs';
import artworkRegistry from '../content/artwork-revisions.json' with {type:'json'};

export const hash = data => createHash('sha256').update(data).digest('hex');
// Tar must be the Windows bsdtar, addressed by absolute path. Git Bash puts GNU
// tar ahead of the bundled bsdtar on PATH, and GNU tar reads the "D:" in a
// drive-letter path as a remote host ("Cannot connect to D: resolve failed"),
// which failed packaging after the (already successful) build. Resolving the
// interpreter here keeps packing, unpacking and the shell that invoked them
// independent of PATH ordering; on POSIX the system tar is already correct.
export const TAR = process.platform === 'win32'
  ? resolve(process.env.SystemRoot || 'C:\\Windows', 'System32/tar.exe')
  : 'tar';
export function inside(root, path) {
  const absolute=resolve(path),base=realpathSync(root);
  if(absolute===base||!absolute.startsWith(base+sep))throw new Error('Path must remain inside its output directory');
  if(existsSync(absolute)&&!realpathSync(absolute).startsWith(base+sep))throw new Error('Linked path escapes its output directory');
  return absolute;
}
export function walk(root) {
  const files=[];
  const visit=folder=>{for(const entry of readdirSync(folder,{withFileTypes:true})){
    const full=resolve(folder,entry.name);
    if(entry.isSymbolicLink())throw new Error('Release inputs must be independent files: '+full);
    if(entry.isDirectory())visit(full);else if(entry.isFile())files.push(relative(root,full).split(sep).join('/'));
  }};
  visit(root);return files.sort();
}
// Static files the mobile backend serves besides catalogue artwork: cosmetics, icons and the drawn
// story comic pages (config/levels.json comicPage) and 团子去旅行 postcards, both listed in config/runtime-assets.json.
export const mobileStaticAsset = path => /^\/(?:cosmetics\/|favicon|apple-touch|puzzles\/story-comic-|puzzles\/tuanzi-card-)/.test(path);
export function runtimeAssets(catalog, config) {
  const urls=new Set(config.static);
  for(const photo of catalog.filter(p=>isPlayableOrigin(p.origin)&&RETAINED_STATUSES.includes(p.status))){
    for(const name of ['playSrc','thumbSrc','optimizedSrc',...(photo.standardSrc?['standardSrc','optimizedStandardSrc']:[])]){
      const url=photo[name];
      // Uniform delivery (2026-10-17): playSrc points at the optimized build instead of a lossless play file.
      const kind=name==='playSrc'&&url===photo.optimizedSrc?'optimized':{playSrc:'play',thumbSrc:'thumbnail',standardSrc:'standard',optimizedSrc:'optimized',optimizedStandardSrc:'compact'}[name];
      if(!/^[a-z0-9-]+$/.test(photo.id)||typeof url!=='string'||!new RegExp(`^/puzzles/${photo.id}-${kind}-[a-f0-9]{12}\\.webp$`).test(url))throw new Error('Missing runtime artwork: '+photo.id);
      urls.add(url);
    }
    const retained=artworkRegistry.legacy[photo.id];
    if(retained)for(const [kind,url] of [['optimized',retained.src],['thumbnail',retained.thumbSrc]]){
      if(!new RegExp(`^/puzzles/${photo.id}-${kind}-[a-f0-9]{12}\\.webp$`).test(url))throw new Error('Invalid retained room artwork: '+photo.id);
      urls.add(url);
    }
    const activeRevision=artworkRegistry.active[photo.id];
    if(activeRevision){
      const active=artworkRegistry.versions[photo.id]?.find(item=>item.revision===activeRevision);
      if(!active)throw new Error('Missing active artwork version: '+photo.id);
      for(const [kind,url] of [['optimized',active.src],['thumbnail',active.thumbSrc]]){
        if(!new RegExp(`^/puzzles/${photo.id}-${kind}-[a-f0-9]{12}\\.webp$`).test(url))throw new Error('Invalid active room artwork: '+photo.id);
        urls.add(url);
      }
    }
  }
  for(const url of urls)if(!url.startsWith('/')||url.startsWith('//')||url.includes('\\')||posix.normalize(url)!==url||url.includes('..'))throw new Error('Invalid runtime asset path');
  return [...urls].sort();
}
export function selectRuntimeFiles(build, assets) {
  const publicPaths=new Set(assets.map(url=>'dist/client'+url));
  const helpers=new Set(['backup.mjs','migrate.mjs','public-room-cleanup.mjs','runtime.node.mjs','sqlite.mjs'].map(name=>'server/'+name));
  const files=walk(build).filter(name=>{
    if(name.endsWith('.map'))return false;
    if(['server.js','package.json','dist/vinext-client-assets.js'].includes(name)||helpers.has(name))return true;
    if(/^drizzle\/\d+_[a-zA-Z0-9_]+\.sql$/.test(name))return true;
    if(name.startsWith('dist/server/')||name.startsWith('node_modules/'))return true;
    if(name.startsWith('dist/client/_next/')||name.startsWith('dist/client/.vite/'))return true;
    return publicPaths.has(name);
  });
  for(const path of ['server.js','package.json','dist/server/index.js',...helpers,...publicPaths])if(!files.includes(path))throw new Error('Required runtime file missing: '+path);
  for(const path of files){
    if(/(?:^|\/)(?:\.env[^/]*|\.dev\.vars[^/]*|\.git|\.wrangler)(?:\/|$)|\.(?:sqlite(?:-\w+)?|db|pem|key|pfx|p12)$/i.test(path))throw new Error('Private data in build: '+path);
    // Windows builds can only be labeled portable when no native platform binaries are shipped.
    if(/\.(node|exe|dll|so|dylib)$/i.test(path))throw new Error('Native runtime dependency requires a target-platform build: '+path);
  }
  return files;
}
export function inventory(root, files) {
  return files.map(path=>{const content=readFileSync(inside(root,resolve(root,path)));return {path,bytes:content.length,sha256:hash(content)};});
}
