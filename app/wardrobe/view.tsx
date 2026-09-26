'use client';
import {useEffect,useState,useRef} from 'react';
import CommunityShell from '../community-shell';
import {useLanguage} from '../language-switch';
import {CosmeticBubble,CosmeticIcon} from '../cosmetic-preview';
import {styles,cosmeticsOf} from '../../public/cosmetics/catalog.mjs';
type Profile={version:number;state:Parameters<typeof cosmeticsOf>[0]};
export default function Wardrobe(){
 const zh=useLanguage()==='zh',c=(a:string,b:string)=>zh?a:b,[profile,setProfile]=useState<Profile|null>(null),[kind,setKind]=useState<'bubble'|'cursor'>('bubble'),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');const request=useRef<{item:string|null;kind:string;id:string}|null>(null);
 async function load(){const r=await fetch('/api/courtyard',{cache:'no-store'});if(!r.ok)throw Error(c('请登录后重试','Please sign in and try again'));setProfile(await r.json() as Profile);}
 useEffect(()=>{const sync=()=>{void load().catch(e=>setError(e.message));};sync();window.addEventListener('puzzle:cosmetics-changed',sync);return()=>window.removeEventListener('puzzle:cosmetics-changed',sync);},[]);
 async function equip(item:string|null){if(!profile||busy)return;setBusy(true);setError('');setNotice('');if(request.current?.item!==item||request.current?.kind!==kind)request.current={item,kind,id:crypto.randomUUID().replaceAll('-','')};try{
  const r=await fetch('/api/courtyard',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'equip',kind,item,requestId:request.current.id,version:profile.version})});
  if(!r.ok){await load();if(r.status===409)request.current=null;throw Error(c('设置未完成，请重试；未解锁的装扮无法装备。','Could not save. Try again; locked styles cannot be equipped.'));}
  setProfile(await r.json() as Profile);request.current=null;setNotice(c('装扮已保存，下次发消息或进入拼图时生效。','Saved. Applies to your next message or puzzle visit.'));
  window.dispatchEvent(new Event('puzzle:cosmetics-changed'));try{localStorage.setItem('jigsaw:cosmetics-updated',String(Date.now()));}catch{}
 }catch(e){setError((e as Error).message);}finally{setBusy(false);}}
 const wardrobe=profile?cosmeticsOf(profile.state):null,owned=kind==='bubble'?wardrobe?.bubbles:wardrobe?.cursors;
 return <CommunityShell active="wardrobe"><main className="wardrobe"><header><small>MY LITTLE COLLECTION</small><h1>{c('我的装扮','My wardrobe')}</h1><p>{c('把喜欢的颜色，带进一起拼图的时光。','Bring a little personality to your puzzle time.')}</p><p>{c('孵蛋解锁 · 永久拥有 · 气泡和指针自由搭配','Hatch to unlock · Yours forever · Mix bubbles and cursors')}</p></header>
 <div className="wardrobe-tabs"><button aria-pressed={kind==='bubble'} onClick={()=>setKind('bubble')}>{c('聊天气泡','Chat bubbles')}</button><button aria-pressed={kind==='cursor'} onClick={()=>setKind('cursor')}>{c('鼠标指针','Cursors')}</button><button disabled={!profile||busy} onClick={()=>void equip(null)}>{c('恢复此类默认','Reset this type')}</button><button onClick={()=>window.dispatchEvent(new Event('puzzle:open-hatch'))}>{c('前往孵化','Go hatch')}</button></div>
 <p className="wardrobe-note">{c('气泡用于房间聊天；图案指针只用于拼图区域，图案中心为点击位置。触屏保持原有操作。','Bubbles appear in room chat. Cursors apply only to the puzzle, with the click point at the center. Touch controls stay the same.')}</p>
 {error&&<p role="alert">{error}</p>}{notice&&<p role="status">{notice}</p>}
 <div className="wardrobe-grid">{styles.map(s=>{const unlocked=owned?.includes(s.id),equipped=wardrobe?.equipped[kind]===s.id;return <article key={s.id} className={equipped?'is-equipped':''}><h2>{zh?s.zh:s.en}</h2>{kind==='bubble'?<CosmeticBubble id={s.id}>{c('一起慢慢拼，快完成啦！','One piece at a time, together!')}</CosmeticBubble>:<div className="cursor-preview"><CosmeticIcon id={s.id} size={100}/><small>{c('图案放大预览','Enlarged preview')}</small></div>}<button disabled={!unlocked||busy||equipped} onClick={()=>void equip(s.id)}>{equipped?c('使用中','Equipped'):unlocked?c('装备','Equip'):c('未解锁 · 孵蛋获得','Locked · Hatch to unlock')}</button></article>;})}</div>
 </main></CommunityShell>;
}
