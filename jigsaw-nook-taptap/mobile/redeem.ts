// 兑换码: pure helpers shared by the app and its tests.
export type RedeemDecoration={id:string;title?:string;kind?:string;artKey?:string;color?:string;status:'granted'|'owned'|'unavailable';fallback?:{coins:number;fragments:number}};
export type RedeemGrant={code:string;coins:number;fragments?:number;energy:number;energyPacks:number;energyPacksSkipped:number;decorations:RedeemDecoration[]};
export type RedeemCell={icon:string;label:string;extra:string|null;decoration?:{id:string;artKey:string;color:string}};

export const REDEEM_WECHAT_HINT='兑换码由游戏活动发放';
export const CAT_PAW_WECHAT_TEXT='参与游戏活动或使用兑换码获得。';
export const REDEEM_GROUP_HINT='兑换码可在玩家 QQ 群 397229653 领取';
export const REDEEM_SOON='兑换功能即将开放';
export const REDEEM_MAX_LENGTH=32;

/** What the player typed, as the server will read it: full-width → ASCII, uppercase, no spaces or dashes. */
export function redeemInput(value:string|null|undefined):string{
 if(typeof value!=='string')return '';
 return value.normalize('NFKC').toUpperCase().replace(/[\s\-‐-―−ー]/g,'').slice(0,REDEEM_MAX_LENGTH);
}

const decorationName=(item:RedeemDecoration)=>(item.title??'装饰')+(item.kind==='cursor'?'指针':'');
const amounts=(coins:number,fragments:number)=>[coins>0?coins+' 金币':'',fragments>0?fragments+' 碎片':''].filter(Boolean).join(' + ');

/** One reward card per item, in the 七日礼 card style. Fallback coins/碎片 sit on the decoration they replace. */
export function redeemCells(g:RedeemGrant):RedeemCell[]{
 const cells:RedeemCell[]=[];let fallbackCoins=0,fallbackFragments=0;
 for(const item of g.decorations??[]){
  const art=item.artKey&&item.color?{id:item.id,artKey:item.artKey,color:item.color}:undefined;
  if(item.fallback){
   fallbackCoins+=item.fallback.coins;fallbackFragments+=item.fallback.fragments;
   cells.push({icon:item.fallback.fragments>0?'fragment':'coin',label:amounts(item.fallback.coins,item.fallback.fragments),extra:item.status==='owned'?'已拥有'+(item.title??'装饰'):'代替'+(item.title??'装饰')});
  }else if(item.status==='granted')cells.push({icon:'gift',label:decorationName(item),extra:null,...(art?{decoration:art}:{})});
  else if(item.status==='owned')cells.push({icon:'gift',label:decorationName(item),extra:'已拥有',...(art?{decoration:art}:{})});
 }
 if(g.energy>0)cells.unshift({icon:'lightning',label:'体力 +'+g.energy,extra:null});
 const coins=g.coins-fallbackCoins,fragments=(g.fragments??0)-fallbackFragments;
 if(coins>0)cells.push({icon:'coin',label:'金币 +'+coins,extra:null});
 if(fragments>0)cells.push({icon:'fragment',label:'碎片 +'+fragments,extra:null});
 if(g.energyPacks>0)cells.push({icon:'energy',label:'体力包 ×'+g.energyPacks,extra:g.energyPacksSkipped>0?'库存满，少 '+g.energyPacksSkipped+' 个':null});
 else if(g.energyPacksSkipped>0)cells.push({icon:'energy',label:'体力包已满',extra:'没有发放 ×'+g.energyPacksSkipped});
 return cells;
}

/** The toast after a successful claim. */
export function redeemSummary(g:RedeemGrant):string{
 const parts=redeemCells(g).map(cell=>cell.extra&&cell.icon!=='energy'?cell.label+'（'+cell.extra+'）':cell.label);
 return parts.length?'兑换成功：'+parts.join(' · '):'兑换成功';
}

/** Server messages are shown as they are; a backend without the endpoint answers a plain 404. */
export function redeemErrorText(error:unknown):string{
 const detail=error as {status?:number;code?:string;message?:string}|null;
 if(detail?.status===404&&!String(detail.code??'').startsWith('REDEEM_'))return REDEEM_SOON;
 return typeof detail?.message==='string'&&detail.message?detail.message:'暂时无法兑换，请稍后再试';
}

/** A network failure keeps the request id so a retry replays the server's answer instead of claiming twice. */
export const redeemAnswered=(error:unknown)=>typeof (error as {status?:unknown}|null)?.status==='number';
