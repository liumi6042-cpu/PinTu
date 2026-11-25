import delivery from '../public/cosmetics/delivery.json' with {type:'json'};
export function cosmeticAsset(kind:'bubble'|'cursor'|'icon',id:string):string {
 return Object.hasOwn(delivery,id)?delivery[id as keyof typeof delivery][kind]:'';
}
// Kept async for equipped-cursor callers; images are pre-rendered at build time.
export function cosmeticUrl(kind:'bubble'|'cursor',id:string):Promise<string>{return Promise.resolve(cosmeticAsset(kind,id));}
