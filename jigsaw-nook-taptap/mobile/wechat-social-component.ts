import type {NativeSocial,NativeSocialOpenResult,NativeSocialStatus} from './ports';

type Host=Record<string,any>;
type PluginLoader=(name:string,options:{enableRequireHostModule:true;customEnv:{wx:Host}})=>{default?:new(options:Record<string,unknown>)=>Host};
type Options={timeoutMs?:number;openTimeoutMs?:number};
const services=new WeakMap<Host,NativeSocial>();
const safeCode=(error:unknown)=>{
 const code=error&&typeof error==='object'?(error as {errCode?:unknown}).errCode:undefined;
 return typeof code==='number'&&Number.isSafeInteger(code)?code:undefined;
};

/** Keep the official component hidden, exposing only its documented private entry. */
export function createWechatSocialComponent(wx:Host,load?:PluginLoader,options:Options={}):NativeSocial{
 const saved=services.get(wx);if(saved)return saved;
 let state:NativeSocialStatus={state:'idle'},pending:Promise<NativeSocialStatus>|undefined,initializing=false;
 let instance:Host|undefined,openPending:Promise<NativeSocialOpenResult>|undefined;
 let finishOpening:((result:NativeSocialOpenResult)=>void)|undefined;
 const status=():NativeSocialStatus=>({...state,...(state.error?{error:{...state.error}}:{})});
 // hide() affects the launcher; calling close() from its close event would recurse.
 const hide=()=>{try{instance?.hide?.();}catch{}};
 const openingFailure=(kind:'opening-error'|'opening-timeout',error?:unknown)=>{
  state={state:'failed',error:{kind,...(safeCode(error)!==undefined?{code:safeCode(error)}:{})}};
  hide();finishOpening?.('failed');
 };
 const prepare=():Promise<NativeSocialStatus>=>{
  // A settled promise contains an older snapshot after a runtime error.
  if(pending)return initializing?pending:Promise.resolve(status());
  state={state:'loading'};initializing=true;
  // Promise callbacks isolate every plugin failure from the game's boot path.
  pending=new Promise<NativeSocialStatus>(resolve=>{
   let settled=false,timer:ReturnType<typeof setTimeout>|undefined;
   const finish=(next:NativeSocialStatus)=>{if(settled)return;settled=true;initializing=false;if(timer)clearTimeout(timer);hide();state=next;resolve(status());};
   if(!load){finish({state:'unavailable',error:{kind:'plugin-unavailable'}});return;}
   let Chat:new(options:Record<string,unknown>)=>Host;
   try{const plugin=load('MiniGameChat',{enableRequireHostModule:true,customEnv:{wx}});if(typeof plugin?.default!=='function'){finish({state:'failed',error:{kind:'invalid-plugin'}});return;}Chat=plugin.default;}
   catch(error){finish({state:'failed',error:{kind:'plugin-load-failed',...(safeCode(error)!==undefined?{code:safeCode(error)}:{})}});return;}
   try{
    instance=new Chat({x:0,y:0,autoShow:false,logoUrl:'',movable:false,enableSnap:false,scale:1});
    if(typeof instance?.on!=='function'){finish({state:'failed',error:{kind:'invalid-plugin'}});return;}
    timer=setTimeout(()=>finish({state:'failed',error:{kind:'initialization-timeout'}}),options.timeoutMs??12000);
    instance.on('ready',()=>{
     if(settled)return;hide();
     if(typeof instance?.setTabs!=='function'){finish({state:'failed',error:{kind:'invalid-plugin'}});return;}
     try{
      // The verified official private key is the complete whitelist.
      void Promise.resolve(instance.setTabs(['private'])).then(()=>finish({state:'ready'})).catch(error=>finish({state:'failed',error:{kind:'initialization-error',...(safeCode(error)!==undefined?{code:safeCode(error)}:{})}}));
     }catch(error){finish({state:'failed',error:{kind:'initialization-error',...(safeCode(error)!==undefined?{code:safeCode(error)}:{})}});}
    });
    instance.on('open',()=>finishOpening?.('opened'));
    instance.on('close',hide);
    instance.on('error',(error:unknown)=>{
     if(finishOpening){openingFailure('opening-error',error);return;}
     hide();const next:NativeSocialStatus={state:'failed',error:{kind:'initialization-error',...(safeCode(error)!==undefined?{code:safeCode(error)}:{})}};
     // Keep safe runtime diagnostics without retaining raw account data.
     if(settled)state=next;else finish(next);
    });
   }catch(error){finish({state:'failed',error:{kind:'initialization-error',...(safeCode(error)!==undefined?{code:safeCode(error)}:{})}});}
  });
  return pending;
 };
 const openPrivate=():Promise<NativeSocialOpenResult>=>{
  if(openPending)return openPending;
  openPending=(async():Promise<NativeSocialOpenResult>=>{
   await prepare();
   // Runtime events can invalidate the preparation snapshot before this resumes.
   if(state.state==='unavailable')return 'unavailable';
   if(state.state!=='ready')return 'failed';
   try{if(wx.getSystemInfoSync?.()?.platform==='devtools')return 'unsupported';}catch{return 'unsupported';}
   if(typeof instance?.openPrivate!=='function'){state={state:'failed',error:{kind:'invalid-plugin'}};hide();return 'failed';}
   return new Promise<NativeSocialOpenResult>(resolve=>{
    let settled=false;
    const timer=setTimeout(()=>openingFailure('opening-timeout'),options.openTimeoutMs??8000);
    finishOpening=result=>{if(settled)return;settled=true;clearTimeout(timer);finishOpening=undefined;resolve(result);};
    try{
     // Official openPrivate takes no arguments. Only its open event confirms success.
     void Promise.resolve(instance!.openPrivate()).catch(error=>{if(!settled)openingFailure('opening-error',error);});
    }catch(error){openingFailure('opening-error',error);}
   });
  })().finally(()=>{openPending=undefined;});
  return openPending;
 };
 const service={prepare,status,openPrivate};services.set(wx,service);return service;
}
