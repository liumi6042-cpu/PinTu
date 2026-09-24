'use client';
import {useState} from 'react';
import {Users,Copy,Check} from 'lucide-react';
import {useAddressCopy} from '@/lib/address-copy';
import './lobby-community.css';

export default function LobbyCommunity(){
 const copy=useAddressCopy(),[status,setStatus]=useState('');
 async function copyNumber(){
  try{await navigator.clipboard.writeText('397229653');setStatus('群号已复制');}
  catch{setStatus('复制失败，请长按或选中群号复制');}
 }
 return <aside className="lobby-qq" aria-label={copy('一起拼图 · QQ 交流群')}>
  <div className="lobby-qq-icon"><Users size={27}/></div>
  <div className="lobby-qq-copy"><strong>{copy('一起拼图 · QQ 交流群')}</strong><p>{copy('找拼友、聊拼图，欢迎加入我们的 QQ 群。')}</p></div>
  <strong className="lobby-qq-number">397229653</strong>
  <button type="button" className="primary" onClick={()=>void copyNumber()}>{status==='群号已复制'?<Check size={17}/>:<Copy size={17}/>} {copy(status==='群号已复制'?'群号已复制':'复制群号')}</button>
  <span role="status" className="lobby-qq-status">{copy(status)}</span>
 </aside>;
}
