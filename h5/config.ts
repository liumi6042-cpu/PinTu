export type H5Config = { apiBase: string; assetBase?: string; rewardedAdUnitId?: string; adRewardEnabled?: boolean };
declare global { interface Window { JIGSAW_H5_CONFIG?: H5Config } }
export function h5Config(): H5Config {
  const raw = window.JIGSAW_H5_CONFIG ?? { apiBase: './h5' };
  const url = new URL(raw.apiBase, document.baseURI);
  if (!['https:', 'http:'].includes(url.protocol)) throw Error('Invalid H5 gateway URL');
  if (url.protocol !== 'https:' && !['localhost','127.0.0.1','[::1]'].includes(url.hostname)) throw Error('H5 gateway requires HTTPS');
  return { ...raw, apiBase: url.href.replace(/\/$/, '') };
}
export function assetUrl(path: string) {
  return /^\/(?:puzzles|cosmetics|intro|courtyard|flower-garden|artwork|sounds|icons|favicon|apple-touch)/.test(path)
    ? new URL(path.slice(1),h5Config().assetBase||h5Config().apiBase+'/assets/').href : path;
}
