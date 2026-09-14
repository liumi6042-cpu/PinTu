'use client';
import {useId} from 'react';
import {NEW_GAME_LEVELS as LEVELS} from '@/lib/piece-policy';
import {t} from '@/lib/i18n';
import {useLanguage} from './language-switch';
const labels:Record<number,string>={108:'入门',300:'休闲',500:'经典',1000:'挑战'};
export default function PiecePicker({count,onChange,disabled=false}:{count:number;onChange:(count:number)=>void;disabled?:boolean}){
 useLanguage();const id=useId();
 return <fieldset className="piece-picker" disabled={disabled} aria-describedby={id+'-note'}>
  <legend>{t('拼图片数')}</legend>
  <div className="piece-options">{LEVELS.map(level=><label key={level.count} className="piece-option">
   <input type="radio" name={id} value={level.count} checked={count===level.count} onChange={()=>onChange(level.count)}/>
   <span><strong>{level.count.toLocaleString()}</strong><small>{t(labels[level.count])}{level.count===300?' · '+t('推荐'):''}</small></span>
  </label>)}</div>
  <p id={id+'-note'}>{t('选好片数，点击喜欢的图片就能开始。')}</p>
 </fieldset>;
}
