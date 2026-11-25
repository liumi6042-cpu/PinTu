import { useRef } from 'react';
import { useLanguage } from '../app/language-switch';
export default function AdEntry(){
 const zh=useLanguage()==='zh',dialog=useRef<HTMLDialogElement>(null);
 return <><button type="button" className="h5-ad-entry" onClick={()=>dialog.current?.showModal()}>{zh?'广告福利':'Ad rewards'}</button><dialog ref={dialog} aria-labelledby="h5-ad-title" className="h5-ad-dialog"><h2 id="h5-ad-title">{zh?'广告福利':'Ad rewards'}</h2><p>{zh?'使用提示或底图前，完整观看一条广告，解锁一次使用。每次生效30秒。广告未开放或提前关闭时，不会解锁。':'Watch a complete rewarded video to use a hint or underlay once. Each use lasts 30 seconds. Unavailable or incomplete ads do not unlock help.'}</p><button className="primary" onClick={()=>dialog.current?.close()}>{zh?'继续拼图':'Keep playing'}</button></dialog></>;
}
