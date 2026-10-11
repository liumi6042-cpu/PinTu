import {problem} from './store.mjs';

const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const plain=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const copy=v=>v===undefined?undefined:structuredClone(v);

/** Three-way reimport: keep edited values, accept unchanged source updates,
 * and refuse conflicting edits instead of silently discarding either side. */
export function mergeDraft(base,edited,incoming){
 const conflicts=[];
 function merge(a,b,c,path){
  if(same(b,a))return copy(c);
  if(same(c,a)||same(b,c))return copy(b);
  if(plain(a)&&plain(b)&&plain(c)){
   const result={};for(const key of new Set([...Object.keys(a),...Object.keys(b),...Object.keys(c)])){const value=merge(a[key],b[key],c[key],path?path+'.'+key:key);if(value!==undefined)result[key]=value;}return result;
  }
  const keyed=values=>Array.isArray(values)&&values.every(v=>plain(v)&&typeof v.id==='string')&&new Set(values.map(v=>v.id)).size===values.length;
  if(keyed(a)&&keyed(b)&&keyed(c)){
   const am=new Map(a.map(v=>[v.id,v])),bm=new Map(b.map(v=>[v.id,v])),cm=new Map(c.map(v=>[v.id,v]));
   const common=new Set(a.map(v=>v.id).filter(id=>bm.has(id)&&cm.has(id)));
   const order=items=>items.map(v=>v.id).filter(id=>common.has(id));
   const ao=order(a),bo=order(b),co=order(c),draftReordered=!same(bo,ao),sourceReordered=!same(co,ao);
   if(draftReordered&&sourceReordered&&!same(bo,co))conflicts.push(path+'.order');
   const primary=draftReordered?b:c,secondary=draftReordered?c:b;
   const keys=[...primary.map(v=>v.id),...secondary.map(v=>v.id).filter(id=>!primary.some(v=>v.id===id))];
   return keys.map(id=>merge(am.get(id),bm.get(id),cm.get(id),path+'.'+id)).filter(v=>v!==undefined);
  }
  conflicts.push(path);return copy(b);
 }
 const document=merge(base,edited,incoming,'');
 if(conflicts.length){const e=problem(409,'来源与草稿同时修改了这些字段，请先核对并合并：'+conflicts.slice(0,8).join('、'),'MERGE_CONFLICT');e.conflicts=conflicts;throw e;}
 return document;
}
