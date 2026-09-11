'use client';
import { useEffect,useState } from 'react';
import { Trophy } from 'lucide-react';
import type { RoomClient } from '@/lib/room-client';
import { t } from '@/lib/i18n';
import { useLanguage } from './language-switch';
export default function CompletionRecord({client}:{client:RoomClient}){
  useLanguage();const [record,setRecord]=useState<{kind:string;improvedMs?:number}|null>(null),[error,setError]=useState(false),[version,setVersion]=useState(0);
  useEffect(()=>{let alive=true;setError(false);fetch('/api/rooms/'+client.snapshot.id+'/record',{headers:{Authorization:'Bearer '+client.ticket.token},cache:'no-store'}).then(async response=>{if(!response.ok)throw new Error();return response.json() as Promise<{kind:string;improvedMs?:number}>;}).then(data=>{if(alive)setRecord(data);}).catch(()=>{if(alive)setError(true);});return()=>{alive=false;};},[client,version]);
  if(error)return <p className="record-note">{t('个人纪录暂时无法读取')} <button className="text-button" onClick={()=>setVersion(n=>n+1)}>{t('重试')}</button></p>;
  if(!record)return <p className="record-note" role="status">{t('正在确认个人纪录…')}</p>;
  if(record.kind==='observer')return null;
  return <p className={'completion-record record-'+record.kind} role="status"><Trophy size={20}/><span>{t(record.kind==='first'?'留下了你的第一份纪录':record.kind==='improved'?'刷新个人最佳！':record.kind==='tied'?'追平个人最佳！':'又完成了一次挑战')} {record.kind==='improved'&&<small>{t('比此前最快成绩缩短')} {(record.improvedMs!/1000).toFixed(3)} {t('秒')}</small>}</span></p>;
}
