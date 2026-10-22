import type {PlatformConfig} from './ports';

export function bundledArtworkPath(path:string,config:PlatformConfig):string|null{
 if(!path||path.startsWith('//')||config.id!=='taptap'||!config.bundledArtwork)return null;
 let key=path;
 if(path.startsWith('assets/puzzles/')&&config.bundledArtwork[path.slice('assets'.length)]===path)return path;
 if(/^https?:\/\//i.test(path)){
  const assetBase=config.assetBase.replace(/\/$/,''),apiAssets=config.apiBase.replace(/\/$/,'')+'/assets';
  if(path.startsWith(assetBase+'/'))key=path.slice(assetBase.length);
  else if(path.startsWith(apiAssets+'/'))key=path.slice(apiAssets.length);
  else{try{const url=new URL(path);if(url.origin!==new URL(config.apiBase).origin||url.search||url.hash)return null;key=url.pathname;}catch{return null;}}
 }
 key='/'+key.replace(/^\/+/, '');
 if(!/^\/puzzles\/[a-z0-9-]+-(?:thumbnail|optimized|play)-[a-f0-9]{12}\.webp$/.test(key))return null;
 const local=config.bundledArtwork[key];
 return local==='assets'+key?local:null;
}
