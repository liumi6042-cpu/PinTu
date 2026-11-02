/** Built-ins newer than the oldest WebViews players still use (Huawei/HarmonyOS and un-updated Android System
 * WebView before Chrome 92-97). The bundle targets es2020 syntax, but esbuild never adds a missing built-in:
 * Array.prototype.at threw inside every solo-local drop, so pieces stayed drawn on their spots at 0 / 12 and
 * the level never cleared (2026-11-02). Imported first by every entry. Keep the names in step with
 * scripts/legacy-api-check.mjs, which fails the build when the bundle uses a newer built-in not listed there. */
const define=(target:object,name:string,value:unknown)=>{
 if(!(name in target))Object.defineProperty(target,name,{value,writable:true,configurable:true,enumerable:false});
};
function at(this:ArrayLike<unknown>,index:number){
 const length=this.length>>>0;let i=Math.trunc(Number(index))||0;if(i<0)i+=length;
 return i<0||i>=length?undefined:this[i];
}
function findLastIndex<T>(this:ArrayLike<T>,test:(value:T,index:number,array:ArrayLike<T>)=>unknown,thisArg?:unknown){
 for(let i=(this.length>>>0)-1;i>=0;i--)if(test.call(thisArg,this[i],i,this))return i;
 return -1;
}
define(Array.prototype,'at',at);
define(String.prototype,'at',function(this:string,index:number){return at.call(String(this),index);});
const typedArray=Object.getPrototypeOf(Int8Array.prototype);if(typedArray)define(typedArray,'at',at);
define(Object,'hasOwn',(value:object,key:PropertyKey)=>Object.prototype.hasOwnProperty.call(Object(value),key));
define(Array.prototype,'findLastIndex',findLastIndex);
define(Array.prototype,'findLast',function<T>(this:ArrayLike<T>,test:(value:T,index:number,array:ArrayLike<T>)=>unknown,thisArg?:unknown){
 const index=findLastIndex.call(this,test as (value:unknown,index:number,array:ArrayLike<unknown>)=>unknown,thisArg);return index<0?undefined:this[index];
});
export const LEGACY_BUILT_INS=['Array.prototype.at','String.prototype.at','TypedArray.prototype.at','Object.hasOwn','Array.prototype.findLast','Array.prototype.findLastIndex'] as const;
