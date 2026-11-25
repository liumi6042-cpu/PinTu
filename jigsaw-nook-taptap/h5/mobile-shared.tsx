import {PixelButton} from './pixel-frame';
import { useEffect, useId, useRef, type ReactNode } from 'react';
import { LoaderCircle, X } from 'lucide-react';
import { navigate } from './navigation';
import { MobileArt, type MobileArtKind } from './mobile-icons';

export function MobileSheet({title,children,onClose,headerArt}:{title:string;children:ReactNode;onClose:()=>void;headerArt?:MobileArtKind}) {
 const ref=useRef<HTMLDialogElement>(null),heading=useId();
 useEffect(()=>{const dialog=ref.current;if(dialog&&!dialog.open)dialog.showModal();return()=>dialog?.close();},[]);
 return <dialog data-pixel-frame="panel" data-pixel-tone="cream" data-pixel-scale={1} ref={ref} className="mobile-sheet" aria-labelledby={heading} onCancel={onClose} onClick={event=>{if(event.target===event.currentTarget){const rect=event.currentTarget.getBoundingClientRect();if(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom)onClose();}}}>
  <header><h2 id={heading}>{title}</h2>{headerArt&&<MobileArt kind={headerArt} className="mobile-sheet-title-art"/>}<PixelButton tone="cream" type="button" className="mobile-icon-button" aria-label="关闭" onClick={onClose}><X size={22}/></PixelButton></header><div className="mobile-sheet-content">{children}</div>
 </dialog>;
}
export function MobilePageHeading({title,back='/zh/lobby',children}:{title:string;back?:string;children?:ReactNode}){
 return <header className="mobile-page-heading"><PixelButton tone="cream" type="button" className="mobile-icon-button" aria-label="返回大厅" onClick={()=>navigate(back)}><MobileArt kind="back"/></PixelButton><h1>{title}</h1>{children}</header>;
}
export function MobileNotice({message,onRetry}:{message:string;onRetry?:()=>void}) {
 return <div className="mobile-notice" role="alert"><span>{message}</span>{onRetry&&<button type="button" onClick={onRetry}>重试</button>}</div>;
}
export function MobileLoading({text='正在加载…'}:{text?:string}){return <div className="mobile-loading" role="status"><LoaderCircle size={22} className="mobile-spin"/><span>{text}</span></div>;}