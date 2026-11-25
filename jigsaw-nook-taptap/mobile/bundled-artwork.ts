import type {PlatformConfig} from './ports';

const localArtwork=/^assets\/puzzles\/[a-z0-9-]+-(?:thumbnail|optimized|play|thumb2x)-[a-f0-9]{12}\.webp$/;
export function isBundledArtworkFile(path:string,config:PlatformConfig):boolean{
 return config.id==='taptap'&&localArtwork.test(path)&&!!config.bundledArtwork&&Object.values(config.bundledArtwork).includes(path);
}

export function bundledArtworkPath(path:string,config:PlatformConfig):string|null{
 if(!path||path.startsWith('//')||config.id!=='taptap'||!config.bundledArtwork)return null;
 let key=path;
 if(isBundledArtworkFile(path,config))return path;
 if(/^https?:\/\//i.test(path)){
  const assetBase=config.assetBase.replace(/\/$/,''),apiAssets=config.apiBase.replace(/\/$/,'')+'/assets';
  if(path.startsWith(assetBase+'/'))key=path.slice(assetBase.length);
  else if(path.startsWith(apiAssets+'/'))key=path.slice(apiAssets.length);
  else{try{const url=new URL(path);if(url.origin!==new URL(config.apiBase).origin||url.search||url.hash)return null;key=url.pathname;}catch{return null;}}
 }
 key='/'+key.replace(/^\/+/, '');
 if(!/^\/puzzles\/[a-z0-9-]+-(?:thumbnail|optimized|play)-[a-f0-9]{12}\.webp$/.test(key))return null;
 const local=config.bundledArtwork[key];
 return local&&(local==='assets'+key||/^assets\/puzzles\/[a-z0-9-]+-thumb2x-[a-f0-9]{12}\.webp$/.test(local))?local:null;
}
