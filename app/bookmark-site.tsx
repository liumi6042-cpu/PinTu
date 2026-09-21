'use client';
import { useAddressCopy } from '@/lib/address-copy';
import {useEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {usePathname} from 'next/navigation';
import {Bookmark,Check,Copy,X} from 'lucide-react';
import {Dialog,DialogContent,DialogTitle,DialogDescription} from '@/components/ui/dialog';
import {useLanguage} from './language-switch';
import {BOOKMARK_KEY,BOOKMARK_REMINDER_DELAY,bookmarkPlatform,parseBookmarkPreference,recordBookmarkVisit,shouldRemindBookmark,type BookmarkPreference} from '@/lib/bookmark-preference';

const SITE_URL='https://jigsawnook.online/';
function readPreference(){try{return parseBookmarkPreference(localStorage.getItem(BOOKMARK_KEY));}catch{return null;}}
function writePreference(value:BookmarkPreference){try{localStorage.setItem(BOOKMARK_KEY,JSON.stringify(value));return true;}catch{return false;}}

export default function BookmarkSite(){
 const copy=useAddressCopy();
 useLanguage();
 const pathname=usePathname();
 const [open,setOpen]=useState(false),[reminder,setReminder]=useState(false),[platform,setPlatform]=useState<ReturnType<typeof bookmarkPlatform>>('desktop'),[copyState,setCopyState]=useState<'idle'|'copied'|'manual'>('idle');
 const trigger=useRef<HTMLButtonElement|null>(null),urlField=useRef<HTMLInputElement|null>(null),dialogOpen=useRef(false);
 useEffect(()=>{
  setPlatform(bookmarkPlatform(navigator.userAgent,navigator.platform,navigator.maxTouchPoints));
  setReminder(false);
  if(!['/lobby','/gallery'].includes(pathname))return;
  const existing=readPreference();if(!existing)return;
  if(!writePreference(recordBookmarkVisit(existing,Date.now())))return;
  let timer:ReturnType<typeof setTimeout>|undefined;
  function schedule(){
   clearTimeout(timer);
   if(document.visibilityState!=='visible'){setReminder(false);return;}
   timer=setTimeout(()=>{
    const current=readPreference(),now=Date.now();
    if(!dialogOpen.current&&document.visibilityState==='visible'&&current&&shouldRemindBookmark(current,now)&&writePreference({...current,remindAfter:now+BOOKMARK_REMINDER_DELAY}))setReminder(true);
   },15000);
  }
  function sync(event:StorageEvent){if(event.key===BOOKMARK_KEY||event.key===null)setReminder(false);}
  schedule();document.addEventListener('visibilitychange',schedule);window.addEventListener('storage',sync);
  return()=>{clearTimeout(timer);document.removeEventListener('visibilitychange',schedule);window.removeEventListener('storage',sync);};
 },[pathname]);
 function dismissReminder(permanent=false){
  setReminder(false);const current=readPreference();if(current)writePreference({...current,remindAfter:Date.now()+BOOKMARK_REMINDER_DELAY,dismissed:current.dismissed||permanent});
 }
 function changeOpen(next:boolean){
  dialogOpen.current=next;setOpen(next);setCopyState('idle');
  if(next)dismissReminder();
 }
 const instruction=platform==='ios'?'在 Safari 中打开浏览器菜单或分享菜单，选择“添加书签”。其他浏览器可在菜单中找到书签或收藏。':platform==='android'?'打开浏览器菜单，点击星标，或选择“添加书签 / 收藏”。':'按下快捷键，或打开浏览器菜单，选择“添加书签 / 收藏”。';
 return <>
  <button type="button" ref={trigger} className="bookmark-site-button" aria-haspopup="dialog" onClick={()=>changeOpen(true)}><Bookmark size={16} aria-hidden="true"/><span>{copy('收藏本站')}</span></button>
  {reminder&&!open&&createPortal(<aside className="bookmark-reminder" aria-label={copy('收藏提醒')}>
   <button type="button" className="bookmark-reminder-close" aria-label={copy('关闭收藏提醒')} onClick={()=>dismissReminder()}><X size={17}/></button>
   <Bookmark size={23} aria-hidden="true"/><div><p>{copy('喜欢这里的拼图片刻？')}</p><span>{copy('把网站加入收藏，下次更容易找到。')}</span><div className="bookmark-reminder-actions"><button type="button" onClick={()=>changeOpen(true)}>{copy('收藏本站')}</button><button type="button" onClick={()=>dismissReminder(true)}>{copy('不再提醒')}</button></div></div>
  </aside>,document.body)}
  <Dialog open={open} onOpenChange={changeOpen}><DialogContent className="bookmark-dialog" showCloseButton={false} finalFocus={trigger}>
   <button type="button" className="bookmark-dialog-close" aria-label={copy('关闭收藏说明')} onClick={()=>changeOpen(false)}><X size={20}/></button>
   <Bookmark className="bookmark-dialog-icon" size={30} aria-hidden="true"/>
   <DialogTitle>{copy('把拼图时光留在收藏夹')}</DialogTitle>
   <DialogDescription>{copy('收藏后，下次可以从浏览器书签直接回来。')}</DialogDescription>
   {(platform==='desktop'||platform==='mac')&&<div className="bookmark-shortcut"><kbd>{platform==='mac'?'⌘ Command':'Ctrl'}</kbd><span>+</span><kbd>D</kbd></div>}
   <p className="bookmark-instruction">{copy(instruction)}</p>
   <label className="bookmark-url-label" htmlFor="bookmark-home-url">{copy('网站首页')}</label>
   <div className="bookmark-url"><input id="bookmark-home-url" ref={urlField} readOnly value={SITE_URL} onFocus={e=>e.currentTarget.select()}/><button type="button" aria-label={copy('复制网站地址')} onClick={async()=>{try{if(!navigator.clipboard?.writeText)throw new Error('clipboard unavailable');await navigator.clipboard.writeText(SITE_URL);setCopyState('copied');}catch{setCopyState('manual');urlField.current?.focus();urlField.current?.select();}}}>{copyState==='copied'?<Check size={18}/>:<Copy size={18}/>}</button></div>
   <p className="bookmark-copy-status" role="status">{copyState==='copied'?copy('网站地址已复制'):copyState==='manual'?copy('请长按或手动复制上方地址。'):copy('书签由浏览器保存，请在浏览器中完成收藏。')}</p>
   <div className="bookmark-dialog-actions"><button type="button" className="bookmark-confirm" onClick={()=>{dismissReminder(true);changeOpen(false);}}>{copy('已收藏，不再提醒')}</button><button type="button" onClick={()=>changeOpen(false)}>{copy('稍后再说')}</button></div>
  </DialogContent></Dialog>
 </>;
}
