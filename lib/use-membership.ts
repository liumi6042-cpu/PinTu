'use client';
import { useCallback,useEffect,useState } from 'react';
import type { MembershipSummary } from './membership-policy';
import { apiJson } from './community-client';
export type MembershipOrder={id:string;amountMinor:number;currency:string;status:string;createdAt:number};
export function useMembership(enabled=true){
  const [data,setData]=useState<{summary:MembershipSummary;orders:MembershipOrder[]}|null>(null),[loading,setLoading]=useState(enabled),[error,setError]=useState(''),[version,setVersion]=useState(0);
  const reload=useCallback(()=>setVersion(n=>n+1),[]);
  useEffect(()=>{
    if(!enabled)return;let alive=true;setLoading(true);setError('');
    apiJson<{summary:MembershipSummary;orders:MembershipOrder[]}>('/api/membership').then(value=>{if(alive)setData(value);}).catch(()=>{if(alive)setError('会员信息暂时无法读取，请重试。');}).finally(()=>{if(alive)setLoading(false);});
    return()=>{alive=false;};
  },[enabled,version]);
  useEffect(()=>{if(!enabled)return;window.addEventListener('focus',reload);return()=>window.removeEventListener('focus',reload);},[enabled,reload]);
  return {data,loading,error,reload};
}
