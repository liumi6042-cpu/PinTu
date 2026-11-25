'use client';
import {Coins,Gem} from 'lucide-react';
import {useManagedContent} from './managed-content';
export default function ManagedProfile({zh}:{zh:boolean}){
 const {data}=useManagedContent();if(!data?.enabled||!data.profile)return null;
 const p=data.profile,progress=Math.min(100,p.xpIntoLevel/Math.max(1,p.xpForNextLevel)*100);
 return <a className="mp-header-profile" href={zh?'/zh/tasks':'/tasks'} aria-label={zh?`等级 ${p.level}，金币 ${p.coins}，装饰碎片 ${p.fragments}`:`Level ${p.level}, ${p.coins} coins, ${p.fragments} decoration fragments`}>
  <span className="mp-header-level"><strong>Lv. {p.level}</strong><span className="mp-header-xp"><i style={{width:progress+'%'}}/></span></span>
  <span title={zh?'金币':'Coins'}><Coins size={15}/><b>{p.coins.toLocaleString()}</b></span><span title={zh?'装饰碎片':'Decoration fragments'}><Gem size={15}/><b>{p.fragments.toLocaleString()}</b></span>
 </a>;
}
