import type {TapTapIdentity} from './ports';

type MethodName='login'|'getUserInfo';
type Method=(options:Record<string,unknown>)=>unknown;
type UserInfoButton={style?:Record<string,unknown>;onTap(fn:(value:any)=>void):void;offTap?(fn:(value:any)=>void):void;show?():void;hide?():void;destroy():void};
export type TapIdentityHost={login?:Method;getUserInfo?:Method;getSetting?:Method;createUserInfoButton?:(options:Record<string,unknown>)=>UserInfoButton};
type FailureKind='timeout'|'temporary'|'denied'|'invalid'|'unavailable';
type Stage='bridge'|'authorize'|MethodName;
export type TapIdentityDiagnostic={stage:Stage;attempt:number;state:'waiting'|'requesting'|'retrying'|'ready'|'failed';kind?:FailureKind;errno?:string};
type Policy={bridgeTimeoutMs:number;pollMs:number;loginTimeoutMs:number;userInfoTimeoutMs:number;unconfirmedUserInfoTimeoutMs:number;authorizationTimeoutMs:number;retryDelaysMs:readonly number[];layoutChecksMs:readonly number[];retireDelayMs:number;retryGuardMs:number};
const defaults:Policy={bridgeTimeoutMs:5000,pollMs:100,loginTimeoutMs:16000,userInfoTimeoutMs:12000,unconfirmedUserInfoTimeoutMs:4000,authorizationTimeoutMs:120000,retryDelaysMs:[600,1200],layoutChecksMs:[300,1000,2500],retireDelayMs:1500,retryGuardMs:600};
/** Counters and the last native button seen, for the on-screen authorization diagnostic. No user data. */
export type TapAuthorizationDebug={mounts:number;forced:number;taps:number;rect:{left:number;top:number;width:number;height:number}|null;keys:string[];styleType:string;handle:string;refused:boolean};
const pause=(ms:number)=>new Promise<void>(resolve=>setTimeout(resolve,ms));
const codeOf=(value:any)=>typeof (value?.code??value?.data?.code)==='string'?String(value.code??value.data.code).trim():'';
const userOf=(value:any)=>value?.userInfo??value?.data?.userInfo;
const rectKey=(rect:{left:number;top:number;width:number;height:number})=>[rect.left,rect.top,rect.width,rect.height].map(value=>Math.round(value)).join(',');
// The PC client's H5 bridge returns a proxy whose native #CREATE was refused (handle NaN): nothing is drawn and onTap never fires.
const refusedByHost=(value:unknown)=>{const handle=(value as {$native_handle?:unknown}|null)?.$native_handle;return typeof handle==='number'&&!(handle>0);};
const nicknameOf=(value:any)=>{const user=userOf(value),name=user?.nickName??user?.nickname;return typeof name==='string'?name.trim().slice(0,16):'';};
class IdentityFailure extends Error{
 readonly stage:Stage;readonly kind:FailureKind;readonly errno?:string;
 constructor(stage:Stage,kind:FailureKind,errno?:string){
  super((kind==='denied'?'TapTap登录或昵称授权已取消，请完成授权后点“重新连接”':stage==='bridge'?'TapTap登录接口尚未就绪，请确认从TapTap内打开，并点“重新连接”':stage==='authorize'?'TapTap昵称授权未完成，请点“重新连接”后点击授权按钮':stage==='getUserInfo'?'TapTap昵称暂时未读取成功，请点“重新连接”再试':'TapTap暂时登录未成功，请点“重新连接”再试')+'（'+({bridge:'接口',login:'登录',getUserInfo:'昵称',authorize:'授权'}[stage])+(errno?' '+errno:'')+'）');this.stage=stage;this.kind=kind;this.errno=errno;
 }
}
function failure(name:MethodName,value:any){
 // Keep only the stage and a bounded error number. Native messages can contain credentials.
 const raw=value?.errno??value?.errNo??value?.errCode,errno=/^-?\d{1,12}$/.test(String(raw))?String(raw):undefined;
 const message=String(value?.errMsg??value?.message??(typeof value==='string'?value:''));
 return new IdentityFailure(name,/cancel|den(?:y|ied)|refus|拒绝|取消|未授权|permission|scope\.userInfo/i.test(message)?'denied':'temporary',errno);
}
function invoke(host:TapIdentityHost,name:MethodName,timeoutMs:number):Promise<any>{
 return new Promise((resolve,reject)=>{
  let settled=false;const timer=setTimeout(()=>finishReject(new IdentityFailure(name,'timeout')),timeoutMs);
  function finishReject(error:IdentityFailure){if(settled)return;settled=true;clearTimeout(timer);reject(error);}
  const valid=(value:any)=>name==='login'?!!codeOf(value):!!nicknameOf(value);
  const finish=(value:any)=>{if(settled)return;if(!valid(value)){finishReject(new IdentityFailure(name,'invalid'));return;}settled=true;clearTimeout(timer);resolve(value);};
  try{
   const method=host[name];if(typeof method!=='function'){finishReject(new IdentityFailure(name,'unavailable'));return;}
   const returned=method.call(host,{...(name==='login'?{timeout:Math.max(1000,timeoutMs-1000)}:{withCredentials:false,lang:'zh_CN'}),success:finish,fail:(error:unknown)=>finishReject(failure(name,error))});
   // The documented contract is callback-based. A bridge's Promise<void> or task
   // acknowledgement must never win the race against the real success callback.
   if(returned&&typeof (returned as any).then==='function')void Promise.resolve(returned).then(value=>{if(valid(value))finish(value);},error=>finishReject(failure(name,error)));
   else if(valid(returned))finish(returned);
  }catch(error){finishReject(failure(name,error));}
 });
}

/** Serial, bounded cold-start recovery. Never returns an unverified guest identity. */
export function createTapTapIdentity(readHost:()=>TapIdentityHost|undefined,report?:(event:TapIdentityDiagnostic)=>void,policy:Partial<Policy>={},buttonRect:()=>{left:number;top:number;width:number;height:number;transparent?:boolean}=()=>({left:40,top:230,width:240,height:44}),log:(text:string)=>void=()=>{}){
 const settings={...defaults,...policy};let pending:Promise<TapTapIdentity>|null=null,buttons:UserInfoButton[]=[],cancelAuthorization:(()=>void)|null=null,remount:((force:boolean)=>void)|null=null,lastForced=-Infinity,hidden=false,nicknameUnavailable=false;
 const debug:TapAuthorizationDebug={mounts:0,forced:0,taps:0,rect:null,keys:[],styleType:'',handle:'',refused:false};
 const emit=(event:TapIdentityDiagnostic)=>{try{report?.(event);}catch{}};
 const note=(text:string)=>{try{log(text);}catch{}};
 const rectText=(rect:{left:number;top:number;width:number;height:number})=>rectKey(rect);
 async function bridge(){
  emit({stage:'bridge',attempt:0,state:'waiting'});const deadline=Date.now()+settings.bridgeTimeoutMs;
  while(true){const host=readHost();if(typeof host?.login==='function'&&(typeof host.getUserInfo==='function'||typeof host.createUserInfoButton==='function')){note('平台接口就绪 · '+(['login','getSetting','getUserInfo','createUserInfoButton'] as const).map(name=>name+(typeof host[name]==='function'?'✓':'✗')).join(' '));return host;}if(Date.now()>=deadline){note('平台接口等待超时 · '+(host?'login'+(typeof host.login==='function'?'✓':'✗')+' getUserInfo'+(typeof host.getUserInfo==='function'?'✓':'✗')+' createUserInfoButton'+(typeof host.createUserInfoButton==='function'?'✓':'✗'):'无tap对象'));throw new IdentityFailure('bridge','unavailable');}await pause(settings.pollMs);}
 }
 async function granted(host:TapIdentityHost):Promise<boolean|null>{
  if(typeof host.getSetting!=='function'){note('getSetting · 不存在');return null;}
  return new Promise(resolve=>{let settled=false;const finish=(value:boolean|null)=>{if(settled)return;settled=true;clearTimeout(timer);note('getSetting · '+(value===true?'已授权昵称':value===false?'未授权昵称':'无应答/失败'));resolve(value);},timer=setTimeout(()=>finish(null),3000);
   const receive=(value:any)=>{const auth=value?.authSetting??value?.data?.authSetting;if(auth&&typeof auth==='object')finish(auth['scope.userInfo']===true);};
   try{const returned=host.getSetting!({success:receive,fail:()=>finish(null)});if(returned&&typeof (returned as any).then==='function')void Promise.resolve(returned).then(receive,()=>finish(null));else receive(returned);}catch{finish(null);}
  });
 }
 function authorize(host:TapIdentityHost):Promise<any>{
  emit({stage:'authorize',attempt:1,state:'waiting'});
  return new Promise((resolve,reject)=>{
   let settled=false,mounts=0,placed='';const checks:ReturnType<typeof setTimeout>[]=[];
   // 每个按钮各自注册回调；被替换的旧按钮先隐藏、保留回调，授权结束时才统一销毁，迟到的原生回调仍能完成授权。
   const mounted:{button:UserInfoButton;handler:(value:any)=>void;retire?:ReturnType<typeof setTimeout>;retired?:boolean}[]=[];
   const active=()=>{buttons=mounted.filter(entry=>!entry.retired).map(entry=>entry.button);};
   const release=()=>{if(mounted.length)note('原生按钮全部销毁 · '+mounted.length+'个');for(const entry of mounted.splice(0)){clearTimeout(entry.retire);try{entry.button.offTap?.(entry.handler);}catch{}try{entry.button.destroy();}catch{}}buttons=[];};
   const finish=(value?:any,error?:IdentityFailure)=>{if(settled)return;settled=true;clearTimeout(timer);for(const check of checks)clearTimeout(check);cancelAuthorization=null;remount=null;release();emit({stage:'authorize',attempt:mounts,state:error?'failed':'ready',...(error?{kind:error.kind}: {})});if(error)reject(error);else resolve(value);};
   const receive=(value:any)=>{if(nicknameOf(value))finish(value);else{const error=failure('getUserInfo',value);finish(undefined,new IdentityFailure('authorize',error.kind,error.errno));}};
   const timer=setTimeout(()=>finish(undefined,new IdentityFailure('authorize','timeout')),settings.authorizationTimeoutMs);cancelAuthorization=()=>finish(undefined,new IdentityFailure('authorize','denied'));
   // 未授权时只能由用户点击原生按钮授权；不会调用 tap.authorize 自动弹权限。
   const mount=()=>{
    if(typeof host.createUserInfoButton!=='function'){nicknameUnavailable=true;throw new IdentityFailure('authorize','unavailable');}
    const {transparent,...rect}=buttonRect();placed=rectKey(rect);mounts++;debug.mounts++;debug.rect={...rect};
    // 宿主不能读取包内图片且可能放大文字：画面由Canvas绘制，透明原生按钮只承接真实授权点击。
    const created=host.createUserInfoButton({type:'text',text:transparent?'':'授权昵称并进入',withCredentials:false,lang:'zh_CN',style:{...rect,backgroundColor:transparent?'#00000000':'#b76c70',color:transparent?'#00000000':'#ffffff',borderColor:'#00000000',borderWidth:0,borderRadius:transparent?0:8,textAlign:'center',fontSize:transparent?1:16,lineHeight:rect.height}});
    try{const handle=(created as {$native_handle?:unknown}|null)?.$native_handle;debug.keys=created?Object.keys(created).slice(0,8):[];debug.styleType=typeof created?.style;debug.handle=handle===undefined?'':String(handle);}catch{}
    debug.refused=refusedByHost(created);if(debug.refused)nicknameUnavailable=true;
    note('原生按钮#'+debug.mounts+(created?' 创建':' 创建失败')+' · '+rectText(rect)+(debug.refused?' · 宿主拒绝创建(handle '+debug.handle+')':''));
    if(!created||typeof created.onTap!=='function'||typeof created.destroy!=='function'||debug.refused){try{created?.destroy?.();}catch{}throw new IdentityFailure('authorize','unavailable');}
    const index=debug.mounts,handler=(value:any)=>{debug.taps++;const errno=String((value as any)?.errno??(value as any)?.errNo??'');note('原生按钮#'+index+' 回调 · '+(nicknameOf(value)?'ok':'失败'+(/^-?\d{1,12}$/.test(errno)?' errno '+errno:'')));receive(value);},previous=mounted.filter(entry=>!entry.retire);
    created.onTap(handler);mounted.push({button:created,handler});active();if(!settled){if(hidden)created.hide?.();else created.show?.();}
    // 新按钮先就位，旧按钮稍后才隐藏，避免停在旧位置的透明按钮挡住“暂不同意”。
    for(const entry of previous)entry.retire=setTimeout(()=>{entry.retired=true;active();note('旧原生按钮已隐藏（回调保留到授权结束）');try{entry.button.hide?.();}catch{}},settings.retireDelayMs);
   };
   // 宿主不保证跟随 style 整体替换移动原生按钮；冷启动时画布尺寸或方向可能在按钮创建后才稳定。
   // 位置变化或画布接到本应由原生按钮接住的点击时，按当前布局新建按钮（与“重新连接”相同的已验证路径）。
   remount=(force:boolean)=>{
    if(settled)return;const {transparent,...rect}=buttonRect();if(!force&&rectKey(rect)===placed)return;note((force?'强制重建':'布局变化重建')+' · '+placed+' → '+rectText(rect));
    try{mount();emit({stage:'authorize',attempt:mounts,state:'waiting'});}catch(error){finish(undefined,error instanceof IdentityFailure?error:new IdentityFailure('authorize','unavailable'));}
   };
   try{mount();if(!settled)for(const delay of settings.layoutChecksMs)checks.push(setTimeout(()=>remount?.(false),delay));}
   catch(error){finish(undefined,error instanceof IdentityFailure?error:new IdentityFailure('authorize','unavailable'));}
  });
 }
 async function userInfo(host:TapIdentityHost){
  const permission=await granted(host);if(permission===false||typeof host.getUserInfo!=='function')return authorize(host);
  // A host that never answers getSetting (the PC client) does not answer getUserInfo either: fail sooner so the caller can continue as a guest.
  try{return await retry(host,'getUserInfo',permission===null?Math.min(settings.userInfoTimeoutMs,settings.unconfirmedUserInfoTimeoutMs):settings.userInfoTimeoutMs);}
  catch(error){if(error instanceof IdentityFailure&&error.kind==='denied'&&typeof host.createUserInfoButton==='function')return authorize(host);
   // getSetting never answered and getUserInfo did not either: this host has no nickname API (TapTap PC client).
   if(permission===null&&error instanceof IdentityFailure&&(error.kind==='timeout'||error.kind==='unavailable')){nicknameUnavailable=true;note('getSetting与getUserInfo均无应答 → 判定昵称接口不可用');return null;}
   throw error;}
 }
 async function retry(host:TapIdentityHost,name:MethodName,timeoutMs:number){
  for(let attempt=1;;attempt++){
   emit({stage:name,attempt,state:'requesting'});
   try{const value=await invoke(host,name,timeoutMs);emit({stage:name,attempt,state:'ready'});return value;}
   catch(error){const detail=error instanceof IdentityFailure?error:failure(name,error),delay=settings.retryDelaysMs[attempt-1];const again=detail.kind!=='denied'&&detail.kind!=='timeout'&&detail.kind!=='unavailable'&&delay!==undefined;
    emit({stage:name,attempt,state:again?'retrying':'failed',kind:detail.kind,...(detail.errno?{errno:detail.errno}:{})});
    // A JS timeout cannot cancel native work: never start another native call
    // until it has explicitly completed. Manual reconnect remains available.
    if(!again)throw detail;await pause(delay);
   }
  }
 }
 const identity=function identity(forceAuthorization=false):Promise<TapTapIdentity>{
  if(pending)return pending;
  pending=(async()=>{try{const host=await bridge();
   // 自测重走原生按钮时先请求公开昵称，点击后再取新code，避免等待授权消耗code有效期。
   if(forceAuthorization){const info=await authorize(host),login=await retry(host,'login',settings.loginTimeoutMs);return {code:codeOf(login),nickname:nicknameOf(info)};}
   // 昵称接口不可用（PC客户端）时只用登录凭证绑定；玩家拒绝授权不走这里。凭证在本次调用里新取，不复用旧code。
   const login=await retry(host,'login',settings.loginTimeoutMs),loginOnly=()=>{note('昵称接口不可用 → 仅用登录凭证绑定');return {code:codeOf(login),nickname:'',nicknameUnavailable:true};};
   if(nicknameUnavailable)return loginOnly();
   let info:any;try{info=await userInfo(host);}catch(error){if(nicknameUnavailable&&error instanceof IdentityFailure&&error.kind==='unavailable')return loginOnly();throw error;}
   return info===null?loginOnly():{code:codeOf(login),nickname:nicknameOf(info)};}
   catch(error){if(error instanceof IdentityFailure&&error.stage==='bridge')emit({stage:'bridge',attempt:0,state:'failed',kind:error.kind});throw error;}
  })().finally(()=>{pending=null;});return pending;
 };
 return Object.assign(identity,{cancel(){cancelAuthorization?.();},refreshLayout(){remount?.(false);},
  /** 画布在授权按钮区域收到点击，说明原生透明按钮没接住；在这次点击内同步重建（与“重新连接”一致），旧按钮的回调保留到授权结束。 */
  retryButton(){if(!remount)return false;const now=Date.now();if(now-lastForced<settings.retryGuardMs){note('强制重建已在600ms内发生，跳过');return false;}lastForced=now;debug.forced++;remount(true);return true;},
  setHidden(value:boolean){if(value!==hidden&&buttons.length)note('原生按钮'+(value?'隐藏':'显示'));hidden=value;for(const current of buttons){try{if(value)current.hide?.();else current.show?.();}catch{}}},
  /** True once this host has shown it cannot provide a nickname (refused or missing button, silent getSetting/getUserInfo). */
  nicknameUnavailable(){return nicknameUnavailable;},
  debugState():TapAuthorizationDebug{return {...debug,rect:debug.rect&&{...debug.rect},keys:[...debug.keys]};}});
}
