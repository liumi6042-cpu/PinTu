type Orientation='portrait'|'landscape';
type OrientationCall=(options:{value:Orientation;success:()=>void;fail:(error?:unknown)=>void;complete?:()=>void})=>unknown;
export type TapOrientationHost={setDeviceOrientation?:OrientationCall;onDeviceOrientationChange?:(listener:()=>void)=>void;offDeviceOrientationChange?:(listener:()=>void)=>void};
export type TapOrientationOptions={current?:()=>Orientation|null;common?:{setDeviceOrientation?:OrientationCall};lock?:(value:Orientation)=>unknown;viewport?:()=>string;log?:(line:string)=>void;stepMs?:number;pollMs?:number};
const failedText='旋转失败，请尝试更新或重启TapTap',missingText='当前TapTap不支持旋转，请尝试更新TapTap';
const clean=(text:unknown)=>String(text??'').replace(/\s+/g,' ').replace(/[^\w一-鿿 :.,\-()]/g,'').trim().slice(0,60);
const errorDetail=(error:unknown)=>{if(error===undefined||error===null)return '';const value=error as {errCode?:unknown;errno?:unknown;code?:unknown;errMsg?:unknown;message?:unknown;name?:unknown};const code=value.errCode??value.errno??value.code;return clean([code,value.errMsg??value.message??(typeof error==='string'?error:value.name)].filter(part=>part!==undefined&&part!==null&&part!=='').join(' '));};
const returned=(result:unknown)=>result&&typeof (result as PromiseLike<unknown>).then==='function'?'promise':result===null?'null':typeof result;
/** Manual host rotation only; never rotates the Canvas or changes puzzle data.
 * Some TapTap clients ignore tap.setDeviceOrientation (no callback, no turn), so the switch falls back to a global common.setDeviceOrientation and then screen.orientation.lock,
 * giving each route stepMs to turn the window. Any success callback or the window turning counts as done; otherwise the player sees a short update hint and the login log gets a diagnostic. */
export function setTapOrientation(host:TapOrientationHost|undefined,value:Orientation,options:TapOrientationOptions={}):Promise<void>{
 const {current,common,lock,viewport,log,stepMs=1500,pollMs=200}=options;
 const routes:{name:string;call?:(route:{success:()=>void;fail:(error?:unknown)=>void;complete:()=>void})=>unknown}[]=[
  {name:'tap',call:host?.setDeviceOrientation?callbacks=>host.setDeviceOrientation!({value,...callbacks}):undefined},
  {name:'common',call:common?.setDeviceOrientation?callbacks=>common.setDeviceOrientation!({value,...callbacks}):undefined},
  {name:'lock',call:lock?()=>lock(value):undefined},
 ];
 const notes=routes.map(route=>route.name+(route.call?'✓':'✗')),diagnostic=()=>{let size='';try{size=viewport?.()??'';}catch{}return '（诊断 '+notes.join(' ')+(size?' 视口'+size:'')+'）';};
 const turned=()=>{try{return current?.()===value;}catch{return false;}};
 if(!routes.some(route=>route.call)){log?.('切换方向 '+value+' '+missingText+diagnostic());return Promise.reject(Error(missingText));}
 return new Promise((resolve,reject)=>{let done=false,step=-1,timer:ReturnType<typeof setTimeout>|undefined;
  const poll=current?setInterval(()=>{if(turned())finish(true);},pollMs):undefined;
  function finish(ok:boolean){if(done)return;done=true;clearTimeout(timer);if(poll)clearInterval(poll);if(ok||turned()){log?.('切换方向 '+value+' 完成 '+notes.join(' '));resolve();return;}log?.('切换方向 '+value+' '+failedText+diagnostic());reject(Error(failedText));}
  function next(){if(done)return;clearTimeout(timer);if(turned()){finish(true);return;}
   step=routes.findIndex((route,index)=>index>step&&!!route.call);if(step<0){finish(false);return;}
   const index=step,route=routes[index],note=(text:string)=>{notes[index]=notes[index]+text;},live=()=>!done&&step===index;
   timer=setTimeout(()=>{if(!live())return;note('无回应');next();},stepMs);
   try{const result=route.call!({success:()=>{if(!done)finish(true);},fail:error=>{if(!live())return;const detail=errorDetail(error);note('失败'+(detail?':'+detail:''));next();},complete:()=>{if(turned())finish(true);}});
    const kind=returned(result);if(kind!=='undefined')note('返回'+kind);
    if(kind==='promise')(result as PromiseLike<unknown>).then(()=>{if(turned())finish(true);},error=>{if(!live())return;const detail=errorDetail(error);note('拒绝'+(detail?':'+detail:''));next();});}
   catch(error){const detail=errorDetail(error);note('异常'+(detail?':'+detail:''));next();}
  }
  next();
 });
}
