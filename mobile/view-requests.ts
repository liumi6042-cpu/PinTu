/** Share reads only while they are in flight. Mutations invalidate older responses. */
export class ViewRequests{
 private revision=0;
 private pending=new Map<string,Promise<void>>();
 invalidate(){this.revision++;this.pending.clear();}
 run<T>(key:string,read:()=>Promise<T>,apply:(value:T)=>void,current:()=>boolean=()=>true):Promise<void>{
  const existing=this.pending.get(key);if(existing)return existing;
  const revision=this.revision;
  const request=Promise.resolve().then(read).then(value=>{if(this.revision===revision&&current())apply(value);});
  const pending=request.finally(()=>{if(this.pending.get(key)===pending)this.pending.delete(key);});
  this.pending.set(key,pending);return pending;
 }
}
