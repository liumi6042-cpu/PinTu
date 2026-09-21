'use client';
import { useAddressCopy } from '@/lib/address-copy';
import {useId} from 'react';
import {NEW_GAME_LEVELS as LEVELS} from '@/lib/piece-policy';
import {useLanguage} from './language-switch';
import {requiresPieceAccount} from '@/lib/piece-access';
const labels:Record<number,string>={108:'入门',300:'休闲',500:'经典',1000:'挑战'};
export default function PiecePicker({count,onChange,disabled=false,roomCreation=false}:{count:number;onChange:(count:number)=>void;disabled?:boolean;roomCreation?:boolean}){
 const copy=useAddressCopy();useLanguage();const id=useId();
 return <fieldset className="piece-picker" disabled={disabled} aria-describedby={id+'-note'}>
  <legend>{copy('拼图片数')}</legend>
  <div className="piece-options">{LEVELS.map(level=><label key={level.count} className="piece-option">
   <input type="radio" name={id} value={level.count} checked={count===level.count} onChange={()=>onChange(level.count)}/>
   <span><strong>{level.count.toLocaleString()}</strong><small>{copy(labels[level.count])}{level.count===300?' · '+copy('推荐'):''}{roomCreation&&requiresPieceAccount(level.count)?' · '+copy('需登录'):''}</small></span>
  </label>)}</div>
  <p id={id+'-note'}>{copy(roomCreation?'108、300 片无需登录；创建 500 片及以上房间需登录普通账号。':'按图片实际分辨率选择片数，拼块主体保持正方形。')}</p>
 </fieldset>;
}
