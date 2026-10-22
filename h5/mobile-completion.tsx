import {useEffect,useId,useRef,useState} from 'react';
import {ArrowRight,Check,X} from 'lucide-react';
import {MobileArt} from './mobile-icons';
import {useMobilePlayer} from './mobile-state';
import {navigate} from './navigation';
import {readCollection,type CollectionAlbum} from './mobile-collection-api';
import './mobile-completion.css';

export type MobileCompletionResult={
 roomId?:string;contribution:number;xp?:number;energy:number;coins?:number;fragments?:number;
 catalog?:null|{imageId:string;qualified:boolean;minimumContributions?:number;newlyCollected:boolean;difficulty:number|null;albumRewards:Array<{albumId:string;title:string;target:number;coins:number;decorationId?:string}>};
};
export type MobileCompletionProps={
 open:boolean;onOpenChange:(open:boolean)=>void;title:string;imageSource:string;total:number;elapsed:number;
 result?:MobileCompletionResult|null;onNext?:()=>void;nextBusy?:boolean;nextError?:string;onLeave:()=>void;
};
export function MobileCompletion({open,onOpenChange,title,imageSource,total,elapsed,result,onNext,nextBusy=false,nextError,onLeave}:MobileCompletionProps){
 const ref=useRef<HTMLDialogElement>(null),heading=useId(),{profile}=useMobilePlayer(),[album,setAlbum]=useState<CollectionAlbum|null>(null);
 useEffect(()=>{const dialog=ref.current;if(open&&!dialog?.open)dialog?.showModal();if(!open&&dialog?.open)dialog.close();},[open]);
 useEffect(()=>{if(!open||!result?.catalog?.qualified){setAlbum(null);return;}let active=true;void readCollection().then(data=>{if(active)setAlbum(data.albums.find(item=>item.images.some(image=>image.id===result.catalog?.imageId))??null);}).catch(()=>{});return()=>{active=false;};},[open,result?.roomId,result?.catalog?.imageId,result?.catalog?.qualified]);
 const mins=Math.floor(elapsed/60),seconds=Math.floor(elapsed%60),milestones=result?.catalog?.albumRewards??[];
 return <dialog ref={ref} className="mobile-completion" aria-labelledby={heading} onCancel={event=>{event.preventDefault();onOpenChange(false);}}>
  <div className="mobile-completion-inner">
   <header className="mobile-completion-player"><span className="mobile-completion-avatar"><MobileArt kind="avatar"/></span><span className="mobile-completion-level"><strong>Lv.{profile?.level??'—'}</strong><span className="mobile-completion-meter"><i style={{width:profile?Math.min(100,profile.xp/Math.max(1,profile.xpToNext)*100)+'%':'0%'}}/></span><small>{profile?profile.xp+' / '+profile.xpToNext:'经验加载中'}</small></span><span className="mobile-completion-energy"><MobileArt kind="lightning"/><b>{profile?profile.energy+'/'+profile.energyCap:'—/—'}</b><button type="button" className="mobile-completion-energy-plus" aria-label="打开体力补给" onClick={()=>{onOpenChange(false);navigate('/zh/supplies?returnTo='+encodeURIComponent(result?.roomId?'/room/'+result.roomId:'/zh/lobby'));}}><MobileArt kind="create"/></button></span><button type="button" className="mobile-completion-close" aria-label="收起完成结算，查看拼图" onClick={()=>onOpenChange(false)}><X size={27} strokeWidth={3}/></button></header>
   <div className="mobile-completion-body"><div className="mobile-completion-picture">
   <h2 id={heading}><MobileArt kind="sprig"/><MobileArt kind="piece"/>拼图完成<MobileArt kind="flower"/></h2>
   <figure className="mobile-completion-art"><img src={imageSource} alt={title} crossOrigin="anonymous"/><MobileArt kind="frameLeaf" className="mobile-completion-leaf-first"/><MobileArt kind="frameLeaf" className="mobile-completion-leaf-last"/><MobileArt kind="frameLeaf" className="mobile-completion-leaf-upper"/><MobileArt kind="frameLeaf" className="mobile-completion-leaf-lower"/><span>{total}片</span><figcaption className="sr-only">{title}，用时{mins}分{seconds}秒</figcaption></figure>
   <div className="mobile-completion-contribution"><MobileArt kind="person"/><span>我的贡献</span><b>{result?result.contribution:'—'}次有效拼合</b></div>
   </div><div className="mobile-completion-summary">
   <div className="mobile-completion-divider"><span/><h3>获得奖励</h3><span/></div>
   {result?<><div className="mobile-completion-rewards"><div><MobileArt kind="coin"/><span>完图金币<strong>+{result.coins??0}</strong></span></div><div><MobileArt kind="fragment"/><span>装饰碎片<strong>+{result.fragments??0}</strong></span></div><div><MobileArt kind="lightning"/><span>体力<strong>+{result.energy}</strong></span></div></div>
   {result.catalog?.qualified&&<section className="mobile-completion-collection"><div className="mobile-completion-stamp"><img src={imageSource} alt="" crossOrigin="anonymous"/></div><div><h3>{result.catalog.newlyCollected?'新收藏':'图鉴已记录'}{album?' · '+album.title:''}<MobileArt kind="sprig"/></h3>{album?<><p className="mobile-completion-album-progress"><strong>{album.collected}<small>/{album.total}</small></strong></p><span className="mobile-completion-meter"><i style={{width:Math.min(100,album.collected/Math.max(1,album.total)*100)+'%'}}/></span></>:<p>{title}</p>}<p className="mobile-completion-catalog-note"><Check size={16}/>{result.catalog.newlyCollected?'画作已点亮，收藏永久保留':'本次难度已计入收藏'}</p></div></section>}
   {milestones.length>0&&<div className="mobile-completion-milestones">{milestones.map(item=><p key={item.albumId+':'+item.target}><MobileArt kind="book"/><span>「{item.title}」收集{item.target}张</span><b>{item.coins>0?'金币 +'+item.coins:''}{item.coins>0&&item.decorationId?' · ':''}{item.decorationId?'专属装饰已获得':''}</b></p>)}</div>}
   {!result.catalog?.qualified&&result.catalog&&<p className="mobile-completion-note">本局有效拼合未满{result.catalog.minimumContributions??3}次，继续参与下一局即可收集画作。</p>}</>:<p className="mobile-completion-note" role="status">正在同步本次收获…</p>}
   {nextError&&<p className="mobile-completion-error" role="alert">{nextError}</p>}
   <footer className="mobile-completion-actions"><button type="button" onClick={()=>{onOpenChange(false);navigate('/zh/collection');}}><MobileArt kind="book"/>查看收藏</button><button type="button" className="is-primary" disabled={nextBusy} onClick={onNext??onLeave}><MobileArt kind="piece"/>{nextBusy?'正在准备…':'再拼一局'}</button></footer>
   </div></div>
   <button type="button" className="mobile-completion-lobby" onClick={onLeave}>返回大厅 <ArrowRight size={15}/></button>
  </div>
 </dialog>;
}

