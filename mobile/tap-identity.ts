import type {TapTapIdentity} from './ports';

type MethodName='login'|'getUserInfo';
type Method=(options:Record<string,unknown>)=>unknown;
type UserInfoButton={style?:Record<string,unknown>;onTap(fn:(value:any)=>void):void;offTap?(fn:(value:any)=>void):void;show?():void;hide?():void;destroy():void};
export type TapIdentityHost={login?:Method;getUserInfo?:Method;getSetting?:Method;createUserInfoButton?:(options:Record<string,unknown>)=>UserInfoButton};
type FailureKind='timeout'|'temporary'|'denied'|'invalid'|'unavailable';
type Stage='bridge'|'authorize'|MethodName;
export type TapIdentityDiagnostic={stage:Stage;attempt:number;state:'waiting'|'requesting'|'retrying'|'ready'|'failed';kind?:FailureKind;errno?:string};
type Policy={bridgeTimeoutMs:number;pollMs:number;loginTimeoutMs:number;userInfoTimeoutMs:number;authorizationTimeoutMs:number;retryDelaysMs:readonly number[]};
const defaults:Policy={bridgeTimeoutMs:5000,pollMs:100,loginTimeoutMs:16000,userInfoTimeoutMs:12000,authorizationTimeoutMs:120000,retryDelaysMs:[600,1200]};
const pause=(ms:number)=>new Promise<void>(resolve=>setTimeout(resolve,ms));
const codeOf=(value:any)=>typeof (value?.code??value?.data?.code)==='string'?String(value.code??value.data.code).trim():'';
const userOf=(value:any)=>value?.userInfo??value?.data?.userInfo;
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
export function createTapTapIdentity(readHost:()=>TapIdentityHost|undefined,report?:(event:TapIdentityDiagnostic)=>void,policy:Partial<Policy>={},buttonRect:()=>{left:number;top:number;width:number;height:number;transparent?:boolean}=()=>({left:40,top:230,width:240,height:44})){
 const settings={...defaults,...policy};let pending:Promise<TapTapIdentity>|null=null,button:UserInfoButton|null=null,cancelAuthorization:(()=>void)|null=null,hidden=false;
 const emit=(event:TapIdentityDiagnostic)=>{try{report?.(event);}catch{}};
 async function bridge(){
  emit({stage:'bridge',attempt:0,state:'waiting'});const deadline=Date.now()+settings.bridgeTimeoutMs;
  while(true){const host=readHost();if(typeof host?.login==='function'&&(typeof host.getUserInfo==='function'||typeof host.createUserInfoButton==='function'))return host;if(Date.now()>=deadline)throw new IdentityFailure('bridge','unavailable');await pause(settings.pollMs);}
 }
 async function granted(host:TapIdentityHost):Promise<boolean|null>{
  if(typeof host.getSetting!=='function')return null;
  return new Promise(resolve=>{let settled=false;const finish=(value:boolean|null)=>{if(settled)return;settled=true;clearTimeout(timer);resolve(value);},timer=setTimeout(()=>finish(null),3000);
   const receive=(value:any)=>{const auth=value?.authSetting??value?.data?.authSetting;if(auth&&typeof auth==='object')finish(auth['scope.userInfo']===true);};
   try{const returned=host.getSetting!({success:receive,fail:()=>finish(null)});if(returned&&typeof (returned as any).then==='function')void Promise.resolve(returned).then(receive,()=>finish(null));else receive(returned);}catch{finish(null);}
  });
 }
 function authorize(host:TapIdentityHost):Promise<any>{
  emit({stage:'authorize',attempt:1,state:'waiting'});
  return new Promise((resolve,reject)=>{
   let settled=false;const finish=(value?:any,error?:IdentityFailure)=>{if(settled)return;settled=true;clearTimeout(timer);cancelAuthorization=null;const current=button;button=null;try{current?.offTap?.(receive);}catch{}try{current?.destroy();}catch{}emit({stage:'authorize',attempt:1,state:error?'failed':'ready',...(error?{kind:error.kind}: {})});if(error)reject(error);else resolve(value);};
   const receive=(value:any)=>{if(nicknameOf(value))finish(value);else{const error=failure('getUserInfo',value);finish(undefined,new IdentityFailure('authorize',error.kind,error.errno));}};
   const timer=setTimeout(()=>finish(undefined,new IdentityFailure('authorize','timeout')),settings.authorizationTimeoutMs);cancelAuthorization=()=>finish(undefined,new IdentityFailure('authorize','denied'));
   try{
    if(typeof host.createUserInfoButton!=='function')throw new IdentityFailure('authorize','unavailable');
    // 未授权时只能由用户点击原生按钮授权；不会调用 tap.authorize 自动弹权限。
    const {transparent,...rect}=buttonRect();
    // 宿主不能读取包内图片且可能放大文字：画面由Canvas绘制，透明原生按钮只承接真实授权点击。
    button=host.createUserInfoButton({type:'text',text:transparent?'':'授权昵称并进入',withCredentials:false,lang:'zh_CN',style:{...rect,backgroundColor:transparent?'#00000000':'#b76c70',color:transparent?'#00000000':'#ffffff',borderColor:'#00000000',borderWidth:0,borderRadius:transparent?0:8,textAlign:'center',fontSize:transparent?1:16,lineHeight:rect.height}});
    if(!button||typeof button.onTap!=='function'||typeof button.destroy!=='function')throw new IdentityFailure('authorize','unavailable');
    button.onTap(receive);if(!settled){if(hidden)button?.hide?.();else button?.show?.();}
   }catch(error){finish(undefined,error instanceof IdentityFailure?error:new IdentityFailure('authorize','unavailable'));}
  });
 }
 async function userInfo(host:TapIdentityHost){
  const permission=await granted(host);if(permission===false||typeof host.getUserInfo!=='function')return authorize(host);
  try{return await retry(host,'getUserInfo',settings.userInfoTimeoutMs);}
  catch(error){if(error instanceof IdentityFailure&&error.kind==='denied'&&typeof host.createUserInfoButton==='function')return authorize(host);throw error;}
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
   const login=await retry(host,'login',settings.loginTimeoutMs),info=await userInfo(host);return {code:codeOf(login),nickname:nicknameOf(info)};}
   catch(error){if(error instanceof IdentityFailure&&error.stage==='bridge')emit({stage:'bridge',attempt:0,state:'failed',kind:error.kind});throw error;}
  })().finally(()=>{pending=null;});return pending;
 };
 return Object.assign(identity,{cancel(){cancelAuthorization?.();},refreshLayout(){if(!button)return;const {transparent,...rect}=buttonRect();try{button.style={...button.style,...rect};}catch{}},setHidden(value:boolean){hidden=value;try{if(value)button?.hide?.();else button?.show?.();}catch{}}});
}
