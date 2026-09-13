'use client';
import { memo, useEffect, useRef, useState } from 'react';
import { Ban, ChevronDown, MessageCircle, Send, X } from 'lucide-react';
import { t, playerName } from '@/lib/i18n';
import { useLanguage } from './language-switch';
import { ChatClient, type ChatState } from '@/lib/chat-client';
import { CHAT_LIMIT, chatText } from '@/lib/room-chat';
import type { RoomClient } from '@/lib/room-client';

const empty:ChatState={messages:[],loaded:false,error:'',sending:false};
export default memo(function RoomChat({client,hidden=false}:{client:RoomClient;hidden?:boolean}){
 const language=useLanguage(),[open,setOpen]=useState(true),[state,setState]=useState<ChatState>(empty);
 const [draft,setDraft]=useState(''),[sendError,setSendError]=useState(''),[unread,setUnread]=useState(0),[below,setBelow]=useState(false);
 const [muted,setMuted]=useState<string[]>([]),mutedRef=useRef<string[]>([]),openRef=useRef(false),seen=useRef(0),initialized=useRef(false);
 const channel=useRef<ChatClient|null>(null),button=useRef<HTMLButtonElement>(null),closeButton=useRef<HTMLButtonElement>(null),input=useRef<HTMLTextAreaElement>(null),list=useRef<HTMLDivElement>(null),atBottom=useRef(true);
 const panel=useRef<HTMLElement>(null);
 const focusOnOpen=useRef(false);
 const storageKey='puzzle:chat-muted:'+client.snapshot.id;
 openRef.current=open&&!hidden;mutedRef.current=muted;
 useEffect(()=>{
  try{const saved=JSON.parse(localStorage.getItem(storageKey)||'[]');if(Array.isArray(saved))setMuted(saved.filter(id=>typeof id==='string'&&/^[a-f0-9]{32}$/.test(id)).slice(0,100));}catch{}
 },[storageKey]);
 useEffect(()=>{
  let alive=true;seen.current=0;initialized.current=false;
  const chat=new ChatClient(client.snapshot.id,client.ticket.token,next=>{
   if(!alive)return;
   const added=next.messages.filter(message=>message.id>seen.current&&message.playerId!==client.ticket.playerId&&!mutedRef.current.includes(message.playerId));
   if(initialized.current&&added.length){
    if(!openRef.current||document.hidden)setUnread(count=>Math.min(99,count+added.length));
    else if(!atBottom.current)setBelow(true);
   }
   if(next.loaded)initialized.current=true;
   seen.current=Math.max(seen.current,next.messages.at(-1)?.id??0);setState(next);
  },()=>client.connected,()=>document.hidden);
  channel.current=chat;chat.start();
  const visibility=()=>chat.refresh(),unsubscribe=client.subscribe(()=>chat.refresh());
  document.addEventListener('visibilitychange',visibility);
  return()=>{alive=false;unsubscribe();chat.stop();channel.current=null;document.removeEventListener('visibilitychange',visibility);};
 },[client]);
 useEffect(()=>{channel.current?.setOpen(open&&!hidden);if(open&&!hidden){setUnread(0);setBelow(false);atBottom.current=true;
  if(focusOnOpen.current){focusOnOpen.current=false;if(window.matchMedia('(pointer:fine)').matches)input.current?.focus({preventScroll:true});else closeButton.current?.focus({preventScroll:true});}
 }},[open,hidden]);
 useEffect(()=>{
  if(!open||hidden)return;const viewport=window.visualViewport;
  const resize=()=>{const node=panel.current;if(!node)return;const height=viewport?.height??window.innerHeight;
   node.dataset.compact=String(height<550);node.style.setProperty('--chat-viewport-height',height+'px');node.style.setProperty('--chat-viewport-top',(viewport?.offsetTop??0)+'px');};
  resize();viewport?.addEventListener('resize',resize);viewport?.addEventListener('scroll',resize);window.addEventListener('resize',resize);
  return()=>{viewport?.removeEventListener('resize',resize);viewport?.removeEventListener('scroll',resize);window.removeEventListener('resize',resize);};
 },[open,hidden]);
 const scrollEnd=()=>{if(list.current)list.current.scrollTop=list.current.scrollHeight;atBottom.current=true;setBelow(false);};
 useEffect(()=>{if(open&&!hidden&&atBottom.current)scrollEnd();},[state.messages,open,hidden,muted]);
 const block=(ids:string[])=>{setMuted(ids);try{localStorage.setItem(storageKey,JSON.stringify(ids));}catch{}};
 const close=()=>{const focusInside=!!panel.current?.contains(document.activeElement);setOpen(false);if(focusInside)requestAnimationFrame(()=>button.current?.focus({preventScroll:true}));};
 async function send(){
  if(!channel.current||state.sending)return;const text=draft;setSendError('');
  try{await channel.current.send(text);setDraft(current=>current===text?'':current);atBottom.current=true;scrollEnd();}
  catch(error){setSendError(error instanceof Error?error.message:'消息未发送，请重试');}
 }
 const visible=state.messages.filter(message=>!muted.includes(message.playerId));
 return <aside className="room-chat" hidden={hidden}>
  {!open&&<button ref={button} className="room-chat-toggle" aria-expanded={false} aria-controls="room-chat-panel" onClick={()=>{focusOnOpen.current=true;setOpen(true);}}>
   <MessageCircle size={19}/><span>{t('聊天')}</span>{unread>0&&<span className="room-chat-unread" aria-label={t('未读消息')}>{unread===99?'99+':unread}</span>}
  </button>}
  {open&&<section ref={panel} id="room-chat-panel" className="room-chat-panel" aria-labelledby="room-chat-title"
   onKeyDown={event=>{event.stopPropagation();if(event.key==='Escape'&&!event.nativeEvent.isComposing){event.preventDefault();close();}}} onWheel={event=>event.stopPropagation()}>
   <header className="room-chat-heading"><div><h2 id="room-chat-title">{t('房间聊天')}</h2><p>{t('和这张桌上的朋友聊聊')}</p></div><button ref={closeButton} onClick={close} aria-label={t('收起聊天')}><X size={18}/></button></header>
   {muted.length>0&&<button className="room-chat-restore" onClick={()=>block([])}>{t('恢复已屏蔽的聊天')}</button>}
   <div ref={list} className="room-chat-messages" role="log" aria-label={t('聊天消息')} aria-live="polite" aria-relevant="additions" tabIndex={0}
    onScroll={()=>{const node=list.current;if(node){atBottom.current=node.scrollHeight-node.scrollTop-node.clientHeight<40;if(atBottom.current)setBelow(false);}}}>
    {!visible.length&&<p className="room-chat-empty">{t(state.loaded?'从一句你好开始吧。':'正在连接聊天…')}</p>}
    {visible.map(message=><article className={'room-chat-message'+(message.playerId===client.ticket.playerId?' is-own':'')} key={message.id}>
     <div className="room-chat-author"><span className="room-chat-dot" style={{backgroundColor:message.color}}/><bdi>{playerName(message.name)}</bdi><time dateTime={new Date(message.sentAt).toISOString()}>{new Date(message.sentAt).toLocaleTimeString(language==='zh'?'zh-CN':'en-US',{hour:'2-digit',minute:'2-digit'})}</time>
      {message.playerId!==client.ticket.playerId&&<button title={t('屏蔽此玩家的聊天')} aria-label={t('屏蔽此玩家的聊天')+' · '+playerName(message.name)} onClick={()=>block([...new Set([...muted,message.playerId])].slice(-100))}><Ban size={12}/></button>}
     </div><p dir="auto">{message.text}</p>
    </article>)}
   </div>
   {below&&<button className="room-chat-latest" onClick={scrollEnd}>{t('查看新消息')}<ChevronDown size={14}/></button>}
   {state.error&&<p className="room-chat-notice" role="status">{t(state.error)}</p>}
   <form className="room-chat-compose" onSubmit={event=>{event.preventDefault();void send();}}>
    <textarea ref={input} value={draft} maxLength={CHAT_LIMIT*2} rows={2} placeholder={t('说点什么…')} aria-label={t('聊天消息')} aria-describedby="room-chat-compose-note" onChange={event=>{setDraft(event.target.value);setSendError('');}}
     onKeyDown={event=>{if(event.key==='Enter'&&!event.shiftKey&&!event.nativeEvent.isComposing&&event.keyCode!==229){event.preventDefault();if(chatText(draft))void send();}}}/>
    <div className="room-chat-compose-actions"><span id="room-chat-compose-note">{Array.from(draft).length} / {CHAT_LIMIT}</span><button type="submit" disabled={state.sending||!chatText(draft)||!client.connected}><Send size={15}/>{t(state.sending?'发送中…':'发送')}</button></div>
    {sendError&&<p className="room-chat-send-error" role="alert">{t(sendError)}</p>}
   </form>
  </section>}
 </aside>;
});
