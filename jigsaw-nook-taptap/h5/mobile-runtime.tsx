import {useEffect,useState,type ReactNode} from 'react';
import {requireMobileBackend} from './mobile-api';
export function MobileRuntimeGate({children}:{children:ReactNode}){
 const [ready,setReady]=useState(false),[error,setError]=useState(''),[retry,setRetry]=useState(0);
 useEffect(()=>{let current=true;setError('');void requireMobileBackend().then(()=>{if(current)setReady(true);}).catch(e=>{if(current)setError(e instanceof Error?e.message:'暂时无法连接，请重试');});return()=>{current=false;};},[retry]);
 if(ready)return children;
 return <main className="mobile-app"><section className="mobile-empty" role="status"><h1>一起拼图</h1><p>{error||'正在连接手机版…'}</p>{error&&<button type="button" className="mobile-button mobile-primary" onClick={()=>setRetry(v=>v+1)}>重新连接</button>}</section></main>;
}
