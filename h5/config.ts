import previewAssets from './preview-assets.json';
const packagedPreviews=new Set(previewAssets);
export type H5Config = { apiBase: string; gameBase?: string; assetBase?: string; rewardedAdUnitId?: string; adRewardEnabled?: boolean };
declare global { interface Window { JIGSAW_H5_CONFIG?: H5Config } }
export function h5Config(): H5Config {
  const raw = window.JIGSAW_H5_CONFIG ?? { apiBase: './h5' };
  const url = new URL(raw.apiBase, document.baseURI);
  if (!['https:', 'http:'].includes(url.protocol)) throw Error('Invalid H5 gateway URL');
  if (url.protocol !== 'https:' && !['localhost','127.0.0.1','[::1]'].includes(url.hostname)) throw Error('H5 gateway requires HTTPS');
  return { ...raw, apiBase: url.href.replace(/\/$/, '') };
}
export function assetUrl(path: string) {
  // Resolve from the bundled module, independent of the host document's base URL.
  if(packagedPreviews.has(path)){
    const dev=(import.meta as ImportMeta & {env?:{DEV?:boolean}}).env?.DEV;
    return dev ? new URL(path,location.origin).href : new URL(path.slice(1),new URL('../',import.meta.url)).href;
  }
  return /^\/(?:puzzles|cosmetics|intro|courtyard|flower-garden|artwork|sounds|icons|favicon|apple-touch)/.test(path)
    ? new URL(path.slice(1),h5Config().assetBase||h5Config().apiBase+'/assets/').href : path;
}
