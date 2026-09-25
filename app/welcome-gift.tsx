'use client';
import {useEffect,useRef,useState} from 'react';
type Gift={item:string;claimed:boolean;fragments?:number};
const art:Record<string,{zh:string;en:string;file:string;box:string;width:number;height:number}>={
 fern:{zh:'翠羽蕨',en:'Fern',file:'plant-fern-91a761680cc9.webp',box:'0 0 1024 1024',width:1024,height:1024},
 cushion:{zh:'坐垫',en:'Cushion',file:'furniture-dd687198a215.webp',box:'0 512 512 512',width:1536,height:1024},
 blueVase:{zh:'蓝釉陶罐',en:'Blue vase',file:'furniture-mediterranean-2f0a1951c728.webp',box:'20 535 470 480',width:1536,height:1024}
};
export default function WelcomeGift({accountId,ready,zh,room,blocked,onClaim}:{accountId?:string;ready:boolean;zh:boolean;room:boolean;blocked:boolean;onClaim:()=>void}){
 const [gift,setGift]=useState<Gift|null>(null),[open,setOpen]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[received,setReceived]=useState(false);
 const dialog=useRef<HTMLDialogElement>(null),shown=useRef(new Set<string>());
 const dismissalKey='jigsaw:gift-presented:'+(accountId||'guest')+':'+(gift?.item||'');
 function dismiss(){setOpen(false);if(received)setReceived(false);}
 useEffect(()=>{
  if(!gift||gift.claimed||blocked||shown.current.has(dismissalKey))return;
  try{if(sessionStorage.getItem(dismissalKey)==='1')return;}catch{}
  const present=()=>{if(shown.current.has(dismissalKey)||document.hidden||document.querySelector('dialog[open]'))return;shown.current.add(dismissalKey);try{sessionStorage.setItem(dismissalKey,'1');}catch{}setOpen(true);};
  const timer=setTimeout(present,250),observer=new MutationObserver(present);
  observer.observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['open']});
  document.addEventListener('visibilitychange',present);
  return()=>{clearTimeout(timer);observer.disconnect();document.removeEventListener('visibilitychange',present);};
 },[gift,blocked,dismissalKey]);
 useEffect(()=>{const el=dialog.current;if(!el)return;if(open&&!blocked&&!el.open)el.showModal();else if((!open||blocked)&&el.open)el.close();},[open,blocked,gift]);
 const known=useRef<Gift|null>(null),working=useRef(false),generation=useRef(0),c=(a:string,b:string)=>zh?a:b;
 useEffect(()=>{
  if(!ready)return;const version=++generation.current;known.current=null;setGift(null);setOpen(false);setReceived(false);setError('');
  const accept=(g:Gift|null)=>{if(version===generation.current&&(!known.current||g)){known.current=g;setGift(g);}};
  void fetch('/api/welcome-gift',{cache:'no-store'}).then(async r=>{if(r.ok)accept(((await r.json()) as {gift:Gift|null}).gift);}).catch(()=>{});
  const snapped=async(e:Event)=>{if(known.current||working.current)return;working.current=true;try{
   const r=await fetch('/api/welcome-gift',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'offer',roomId:(e as CustomEvent).detail.roomId})});
   if(r.ok)accept(((await r.json()) as {gift:Gift|null}).gift);
  }catch{}finally{working.current=false;}};
  window.addEventListener('puzzle:successful-drop',snapped);
  const sync=()=>{void fetch('/api/welcome-gift',{cache:'no-store'}).then(async r=>{if(r.ok)accept(((await r.json()) as {gift:Gift|null}).gift);}).catch(()=>{});};
  window.addEventListener('focus',sync);
  return()=>{generation.current++;window.removeEventListener('puzzle:successful-drop',snapped);window.removeEventListener('focus',sync);};
 },[accountId,ready]);
 async function claim(){if(busy)return;setBusy(true);setError('');try{
  const r=await fetch('/api/welcome-gift',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'claim'})});
  if(!r.ok)throw Error(c('领取未完成，请稍后重试。奖励会为你保留。','Please try again. Your gift is saved for you.'));
  const data=await r.json() as {gift:Gift};known.current=data.gift;setGift(data.gift);setOpen(false);setReceived(false);onClaim();
 }catch(e){setError((e as Error).message);}finally{setBusy(false);}}
 if(!gift||gift.claimed&&!received||!art[gift.item])return null;
 const item=art[gift.item],name=zh?item.zh:item.en;
 return <aside className={'welcome-gift '+(room?'in-puzzle':'')} aria-label={c('拼图见面礼','Your first puzzle gift')}>
  <button className="welcome-gift-badge" aria-expanded={open} onClick={()=>setOpen(!open)}><span aria-hidden="true">✦</span> {c(received?'已收下见面礼':'拼合成功 · 有份小礼物',received?'Gift received':'A little gift for your first connection')}</button>
  <dialog ref={dialog} className="daily-checkin-dialog welcome-gift-panel" aria-label={c('拼图见面礼','Your first puzzle gift')} onCancel={e=>{e.preventDefault();dismiss();}}><button className="welcome-gift-close" onClick={dismiss} aria-label={c('关闭','Close')}>×</button>
   <h2>{c(received?'小礼物已放入庭院库存':'为你的庭院添一份温暖',received?'Added to your courtyard inventory':'A little warmth for your courtyard')}</h2>
   {gift.fragments?<strong>{gift.fragments} {c('碎片','fragments')}</strong>:<><svg viewBox={item.box} role="img" aria-label={name}><image href={'/courtyard/assets/'+item.file} width={item.width} height={item.height}/></svg><strong>{name} ×1</strong></>}
   {gift.fragments&&<p>{c('原庭院见面礼已折算为碎片，可兑换花种和装饰。','Your original courtyard gift is converted to fragments for seeds and decor.')}</p>}<p>{c(received?'可以继续拼图，闲下来再去摆放。':'谢谢你拼下第一步，这件小礼物送给你。',received?'Keep puzzling and place it whenever you like.':'Thank you for making your first connection. This little gift is yours.')}</p>
   {received?<a href="/courtyard">{c('去庭院摆放','Place in courtyard')}</a>:accountId?<button className="welcome-gift-claim" disabled={busy} onClick={()=>void claim()}>{c(busy?'正在收下…':'收下礼物',busy?'Claiming…':'Claim gift')}</button>:<a href={'/account?returnTo='+encodeURIComponent(location.pathname)}>{c('登录收下这件礼物','Sign in to claim this gift')}</a>}
   <small>{c('每个账号一次 · 无需碎片 · 不占兑换次数','Once per account · Free · No exchange quota used')}</small>{error&&<p role="alert">{error}</p>}
   <button onClick={dismiss}>{c('稍后领取','Maybe later')}</button>
  </dialog>
 </aside>;
}
