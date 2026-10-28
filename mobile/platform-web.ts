import {createTapTapIdentity} from './tap-identity';
import {createLoginLog} from './login-log';
import {isBundledArtworkFile} from './bundled-artwork';
import {createTapInterstitial,type TapInterstitialHost} from './tap-interstitial';
import {tapAuthorizationLayout} from './tap-authorization-layout';
import {setTapOrientation,type TapOrientationHost} from './tap-orientation';
import {webFullscreen} from './web-fullscreen';
import type {Platform,PlatformConfig,HttpInput,HttpReply,Input,Point,UiSize,Viewport} from './ports';
import {platformSocketUrl} from './ports';
import {themeColors} from './theme';
import {AudioPlayback} from './audio-playback';
import {shareOnTapTap,subscribeTapShareReturn,tapShareScene,type TapShareHost} from './taptap-share';
import type {TapBattleManager} from './tap-preview';

type RewardedVideo={load():Promise<unknown>;show():Promise<unknown>;onClose(fn:(result:{isEnded?:boolean})=>void):void;offClose?(fn:(result:{isEnded?:boolean})=>void):void;onError(fn:(error:unknown)=>void):void;offError?(fn:(error:unknown)=>void):void;destroy?():void};
type TapHost=TapShareHost&TapOrientationHost&TapInterstitialHost&{getMenuButtonBoundingClientRect?:()=>{left:number;top:number;width:number;height:number};getLaunchOptionsSync?:()=>any;getEnterOptionsSync?:()=>any;request?:(options:Record<string,unknown>)=>{abort?():void};createRewardedVideoAd?:(options:{adUnitId:string})=>RewardedVideo;openFriendList?:()=>void;login?:(options?:Record<string,unknown>)=>unknown;getUserInfo?:(options?:Record<string,unknown>)=>unknown};
/** Use the original site's persistent identity, including on a first guest visit. */
export async function webGuestSecret():Promise<string>{
 const valid=(value:unknown):value is string=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
 const newSecret=()=>Array.from(crypto.getRandomValues(new Uint8Array(32)),value=>value.toString(16).padStart(2,'0')).join('');
 let fallback:string|null=null;try{const value=localStorage.getItem('puzzle:guest-fallback');if(valid(value))fallback=value;}catch{}
 let stored:string|null=null;
 if(typeof indexedDB!=='undefined')stored=await new Promise<string|null>(resolve=>{
  let settled=false,db:IDBDatabase|undefined,tx:IDBTransaction|undefined;
  const finish=(value:string|null)=>{if(settled)return;settled=true;clearTimeout(timer);db?.close();resolve(value);};
  const timer=setTimeout(()=>{try{tx?.abort();}catch{}finish(null);},2000);
  try{const request=indexedDB.open('together-puzzle-identity',1);
   request.onupgradeneeded=()=>{if(settled){request.transaction?.abort();return;}if(!request.result.objectStoreNames.contains('identity'))request.result.createObjectStore('identity');};
   request.onerror=()=>finish(null);request.onblocked=()=>finish(null);
   request.onsuccess=()=>{db=request.result;if(settled){db.close();return;}try{
    // Serialize first visits across tabs, and only authenticate after the write commits.
    tx=db.transaction('identity','readwrite');const store=tx.objectStore('identity'),read=store.get('guest');let secret:string|null=null;
    read.onsuccess=()=>{try{secret=valid(read.result)?read.result:fallback??newSecret();if(secret!==read.result)store.put(secret,'guest');}catch{tx?.abort();}};
    tx.oncomplete=()=>finish(secret);tx.onabort=()=>finish(null);
   }catch{finish(null);}};
  }catch{finish(null);}
 });
 if(stored)return stored;
 try{const saved=localStorage.getItem('puzzle:guest-fallback');if(valid(saved))return saved;const secret=fallback??newSecret();localStorage.setItem('puzzle:guest-fallback',secret);if(localStorage.getItem('puzzle:guest-fallback')===secret)return secret;}catch{}
 throw Error('浏览器无法保存游客进度，请允许网站存储或登录原站账号');
}

const uiSizeKey='jn-ui-size',uiSizeFactor:Record<UiSize,number>={auto:1,small:.9,large:1.15,xlarge:1.3};
export function readUiSize():UiSize{try{const value=localStorage.getItem(uiSizeKey);if(value&&Object.hasOwn(uiSizeFactor,value))return value as UiSize;}catch{}return 'auto';}
/** Logical zoom for large browser windows. Phones (below 1366×768) stay at 1; only 'small' may shrink. */
export function uiScale(size:UiSize=readUiSize(),width=window.innerWidth,height=window.innerHeight){const k=Math.min(2,Math.max(1,Math.min(width/1366,height/768)))*uiSizeFactor[size];return size==='small'?k:Math.max(1,k);}

/** Browser/TapTap shell for the shared game. No game rules belong in this file. */
export function createWebPlatform(input:PlatformConfig,canvas:HTMLCanvasElement):Platform{
 const config={...input,apiBase:new URL(input.apiBase,document.baseURI).href.replace(/\/$/,''),assetBase:new URL(input.assetBase,document.baseURI).href.replace(/\/$/,'')};
 const cookieIdentity=config.id==='web'&&config.identityMode==='web-cookie';
 if(cookieIdentity&&new URL(config.apiBase).origin!==location.origin)throw Error('账号连接必须使用当前网站');
 // TapTap may execute the package with a wrapper document whose base URI is
 // outside the uploaded H5 directory. Resolve bundled UI files beside the
 // actual game.js script so icons/audio/fonts remain package-local.
 const packageBase=(()=>{try{
  const scripts=[...document.scripts].filter(script=>!!script.src);
  const current=document.currentScript as HTMLScriptElement|null;
  const source=current?.src||scripts.at(-1)?.src;
  return source?new URL('./',source).href:document.baseURI;
 }catch{return document.baseURI;}})();
 const uiUrl=(path:string)=>{
  if(/^(?:[a-z]+:|\/)/i.test(path))return path;
  if(config.uiBase)return new URL(path,new URL(config.uiBase.endsWith('/')?config.uiBase:config.uiBase+'/',document.baseURI)).href;
  try{return new URL(path,packageBase).href;}catch{return path;}
 };
 const nativeSocial=config.id==='taptap'?(()=>{const openFriends=async()=>{const host=tap();if(typeof host?.openFriendList!=='function')return 'unavailable';try{host.openFriendList();return 'opened';}catch{return 'failed';}};return{prepare:async()=>({state:typeof tap()?.openFriendList==='function'?'ready':'unavailable'} as const),status:()=>({state:typeof tap()?.openFriendList==='function'?'ready':'unavailable'} as const),openFriends};})():undefined;
 const storageMemory=new Map<string,string>();
 // Every pointer, touch and wheel position is divided by the same zoom used for the viewport.
 let uiSize=readUiSize(),scale=uiScale(uiSize);const resizeListeners=new Set<()=>void>();
 let shareDiagnostic='尚未尝试分享';
 let shareController:AbortController|undefined;
 const tap=()=>config.id==='taptap'?(window as unknown as {tap?:TapHost}).tap:undefined;
 const loginLog=createLoginLog();
 let identityDiagnostic='尚未开始',authorizationPending=false,identityVisible=true,consentRequest:{accept:()=>void;fail:(error:unknown)=>void}|null=null;const identityListeners=new Set<()=>void>();
 const identityController=config.id==='taptap'?createTapTapIdentity(tap,event=>{if(event.stage==='authorize'&&event.state==='ready'&&consentRequest){const request=consentRequest;consentRequest=null;request.accept();}authorizationPending=event.stage==='authorize'&&event.state==='waiting';for(const listener of identityListeners)listener();identityDiagnostic=({bridge:'等待平台接口',login:'获取登录凭证',getUserInfo:'读取已授权昵称',authorize:'原生昵称授权按钮'}[event.stage])+' · '+({waiting:'等待',requesting:'请求中',retrying:'重试中',ready:'完成',failed:'失败'}[event.state])+(event.kind?' · '+event.kind:'')+(event.errno?' · 码 '+event.errno:'');if(event.state==='failed')console.warn('[TapTap login]',event);if(event.stage!=='authorize'||event.state!=='waiting')loginLog.add(identityDiagnostic);},{},()=>{const r=canvas.getBoundingClientRect(),button=tapAuthorizationLayout(r.width/scale,r.height/scale).button;return {left:r.left+button.left*scale,top:r.top+button.top*scale,width:button.width*scale,height:button.height*scale,transparent:true};},text=>loginLog.add(text)):undefined;
 // Host and layout snapshot for the login trail. Only sizes, element names and host API presence; nothing from the player.
 const tapAuthorizationDebug=()=>{
  const round=(value:number)=>Math.round(value),host=tap() as (TapHost&Record<string,unknown>)|undefined,state=identityController?.debugState(),r=canvas.getBoundingClientRect(),safe=(value:unknown)=>typeof value==='string'&&/^[\w.\- ]{1,24}$/.test(value)?value:'?';
  let element='none';try{const b=state?.rect;if(b){const hit=document.elementFromPoint(b.left+b.width/2,b.top+b.height/2);if(hit)element=hit.tagName.toLowerCase()+(hit.id?'#'+hit.id:'')+(typeof hit.className==='string'&&hit.className?'.'+hit.className.split(/\s+/).slice(0,2).join('.'):'');}}catch{}
  let system='系统信息无';try{const info=typeof host?.getSystemInfoSync==='function'?(host.getSystemInfoSync as ()=>any)():null;if(info&&typeof info==='object'&&!info.errMsg)system='系统 '+safe(info.platform)+'/'+safe(info.SDKVersion)+'/'+safe(info.version);}catch{}
  const apis=(['login','getSetting','getUserInfo','createUserInfoButton'] as const).map(name=>name+(typeof host?.[name]==='function'?'✓':'✗')).join(' ');
  return '视口 '+innerWidth+'×'+innerHeight+(innerWidth>innerHeight?' 横':' 竖')+' dpr '+devicePixelRatio+' 屏 '+screen.width+'×'+screen.height+' · 画布 '+[r.left,r.top,r.width,r.height].map(round).join(',')+' · 按钮 '+(state?.rect?[state.rect.left,state.rect.top,state.rect.width,state.rect.height].map(round).join(','):'无')+' 建'+(state?.mounts??0)+'/重建'+(state?.forced??0)+'/回调'+(state?.taps??0)+' · 中心元素 '+element+' · body子节点 '+document.body.childElementCount+' · 按钮键 '+(state?.keys.join('/')||'无')+' style '+(state?.styleType||'?')+(state?.handle?' handle '+state.handle:'')+' · '+system+' · '+apis;
 };
 const tapTapIdentity=(options?:{forceAuthorization?:boolean})=>identityController?.(config.tapAuthorizationTest===true&&options?.forceAuthorization===true)??Promise.resolve(null);
 let ad:RewardedVideo|undefined,adUnit='',watching=false,adDiagnostic='尚未请求广告';
 const reportAd=(stage:string,unit:string,error?:unknown)=>{const value=error as any;const raw=String(value?.errMsg??value?.message??(typeof error==='string'?error:''));
  // adnCode 是广告平台子错误码，不是登录 code。先提取数值，再对原说明脱敏。
  const subcode=value?.adnCode??raw.match(/\badnCode\s*[=:]\s*(-?\d{1,12})\b/i)?.[1],safeSubcode=typeof subcode==='number'&&Number.isSafeInteger(subcode)||typeof subcode==='string'&&/^-?\d{1,12}$/.test(subcode)?String(subcode):'';
  const message=raw.replace(/https?:\/\/\S+/gi,'[URL]').replace(/(?:bearer\s+|(?:token|secret|session|openid|code)[=:]\s*)[^\s,;]+/gi,'[已隐藏]').slice(0,220);
  adDiagnostic='推广位:'+unit+' · '+stage+(error?' · 错误码:'+String(value?.errCode??value?.errno??value?.errNo??value?.code??'无').slice(0,30)+(safeSubcode?' · adnCode:'+safeSubcode:'')+' · '+message:'');};
 const interstitial=createTapInterstitial(tap,(stage,unit,error)=>reportAd('插屏 · '+stage,unit,error));
 const audioPlayback=new AudioPlayback((url,loop,onEnded)=>{
  const sound=new Audio(uiUrl(url));sound.loop=loop;const ended=()=>onEnded?.();if(onEnded)sound.addEventListener?.('ended',ended);
  return {get volume(){return sound.volume;},set volume(value){sound.volume=value;},play:()=>sound.play(),pause:()=>sound.pause(),rewind:()=>{sound.currentTime=0;},dispose:()=>{sound.removeEventListener?.('ended',ended);sound.pause();sound.removeAttribute('src');sound.load();}};
 });
 audioPlayback.setHidden(document.hidden===true);
 // Browsers only start music from a user gesture; every tap retries a play the host refused.
 for(const type of ['pointerdown','touchend','keydown'])window.addEventListener?.(type,()=>audioPlayback.unlock(),{capture:true,passive:true});
 let textPromptOpen=false;
 let rawPointerMoves=0,rawTouchMoves=0,touchInputMode=false,resetInput:(()=>void)|null=null;
 const textPrompt=(title:string,value:string,maxLength:number)=>new Promise<string|null>(resolve=>{
  if(textPromptOpen){resolve(null);return;}textPromptOpen=true;
  const colors=themeColors(canvas.style.colorScheme==='dark'?'dark':'light'),dialog=document.createElement('dialog'),form=document.createElement('form'),heading=document.createElement('h3'),field=document.createElement('textarea'),actions=document.createElement('div'),cancel=document.createElement('button'),send=document.createElement('button');
  dialog.setAttribute('aria-label',title);dialog.style.cssText=`position:fixed;inset:0;margin:auto;box-sizing:border-box;width:min(420px,calc(100vw - 30px));max-height:calc(100dvh - 30px);padding:18px;background:${colors.cream};color:${colors.ink};border:3px solid ${colors.line};box-shadow:4px 4px 0 ${colors.muted};font-family:inherit;`;
  form.method='dialog';heading.textContent=title;heading.style.cssText='font-size:18px;margin:0 0 14px';
  field.value=value;field.maxLength=maxLength;field.rows=5;field.placeholder='输入消息…';field.setAttribute('aria-label',title);field.style.cssText=`box-sizing:border-box;width:100%;min-height:110px;resize:vertical;padding:12px;font:16px sans-serif;line-height:1.55;color:${colors.ink};background:${colors.paper};border:1px solid ${colors.line};`;
  actions.style.cssText='display:flex;justify-content:flex-end;gap:10px;margin-top:14px';cancel.type='button';cancel.textContent='取消';send.type='submit';send.textContent='发送';
  for(const button of[cancel,send])button.style.cssText=`min-width:78px;min-height:40px;border:2px solid ${colors.line};color:${button===send?colors.onAccent:colors.ink};background:${button===send?colors.rose:colors.paper};font:700 15px sans-serif;cursor:pointer;`;
  let settled=false;const finish=(text:string|null)=>{if(settled)return;settled=true;textPromptOpen=false;dialog.close();dialog.remove();resolve(text);};
  cancel.onclick=()=>finish(null);form.onsubmit=event=>{event.preventDefault();finish(field.value);};dialog.oncancel=event=>{event.preventDefault();finish(null);};
  actions.appendChild(cancel);actions.appendChild(send);form.appendChild(heading);form.appendChild(field);form.appendChild(actions);dialog.appendChild(form);document.body.appendChild(dialog);dialog.showModal();field.focus();
 });
 const viewport=():Viewport=>{const rect=canvas.getBoundingClientRect();scale=uiScale(uiSize);return {width:(rect.width||window.innerWidth)/scale,height:(rect.height||window.innerHeight)/scale,dpr:(window.devicePixelRatio||1)*scale,top:0,bottom:0};};
 function query(){const url=new URL(location.href),hash=url.hash.slice(1),at=hash.indexOf('?'),result=Object.fromEntries([...url.searchParams,...new URLSearchParams(at<0?'':hash.slice(at+1))]);try{const native=tap()?.getEnterOptionsSync?.()??tap()?.getLaunchOptionsSync?.();return {...result,...tapShareScene(native?.query?.sceneParam)};}catch{return result;}}
 let apiTransport:'undecided'|'browser'|'native'='undecided';
 let apiProbe:Promise<HttpReply>|null=null;
 async function request(input:HttpInput):Promise<HttpReply>{
  const method=(input.method||'GET').toUpperCase(),host=tap(),timeout=input.timeout??12000;
  const headers={...input.headers};const body=input.body===undefined?undefined:typeof input.body==='string'?input.body:JSON.stringify(input.body);
  if(body!==undefined&&!Object.keys(headers).some(k=>k.toLowerCase()==='content-type'))headers['Content-Type']='application/json';
  const nativeRequest=():Promise<HttpReply>=>{
   return new Promise((resolve,reject)=>{let settled=false,task:{abort?():void}|undefined;
    const finish=(fn:()=>void)=>{if(settled)return;settled=true;clearTimeout(timer);fn();};
    const timer=setTimeout(()=>finish(()=>{task?.abort?.();reject(new Error('连接超时，请重试'));}),timeout+100);
    try{task=host!.request!({url:input.url,method,header:headers,data:body,dataType:'text',responseType:'text',timeout,enableCache:false,
     success:(result:{statusCode:number;data:any;header?:Record<string,string>})=>finish(()=>{let data=result.data;if(typeof data==='string'){try{data=JSON.parse(data);}catch{}}resolve({status:result.statusCode,data,headers:lowerHeaders(result.header)});}),
     fail:()=>finish(()=>reject(new Error('网络连接失败，请重试'))),
    });}catch{finish(()=>reject(new Error('网络连接失败，请重试')));}
   });
  };
  const browserRequest=async(probe=false):Promise<HttpReply>=>{
   const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),probe?Math.min(timeout,2500):timeout);
   // Probe the same preflight header names used by gameplay, without credentials.
   const requestHeaders=probe?{...headers,'Content-Type':'application/json',Authorization:'','X-Jigsaw-H5-Session':'','X-Jigsaw-Artwork-Snapshot':'1'}:headers;
   try{const result=await fetch(input.url,{method,headers:requestHeaders,body,credentials:cookieIdentity?'same-origin':'omit',cache:'no-store',signal:controller.signal});const text=await result.text();let data:any=text;try{data=JSON.parse(text);}catch{}return {status:result.status,data,headers:Object.fromEntries(result.headers)};}
   catch(error){throw new Error(controller.signal.aborted?'连接超时，请重试':error instanceof Error?error.message:'网络连接失败，请重试');}
   finally{clearTimeout(timer);}
  };
  if(!host?.request)return browserRequest();
  // Only race a credential-free config GET. Never race or replay a room action,
  // reward, login, purchase, or other mutation across the two transports.
  if(apiTransport==='undecided'&&method==='GET'&&body===undefined&&!Object.keys(input.headers??{}).length&&input.url===config.apiBase+'/config'){
   if(!apiProbe){
    const native=nativeRequest();
    const eligible=(reply:HttpReply,transport:'browser'|'native')=>{
     if(reply.status!==200||reply.data?.mobileMode!=='mobile-v3-isolated')throw Error('游戏连接检查未通过');
     return {reply,transport};
    };
    apiProbe=Promise.any([browserRequest(true).then(reply=>eligible(reply,'browser')),native.then(reply=>eligible(reply,'native'))])
     .then(result=>{apiTransport=result.transport;return result.reply;})
     .catch(()=>{apiTransport='native';return native;});
   }
   return apiProbe;
  }
  if(apiTransport==='browser'){
   try{return await browserRequest();}
   catch(error){apiTransport='native';if(method==='GET'&&body===undefined)return nativeRequest();throw error;}
  }
  return nativeRequest();
 }
 // The login trail records connection steps that decide whether the player gets in: path, status and duration only.
 const loggedRequest=async(input:HttpInput):Promise<HttpReply>=>{
  let path='';try{path=new URL(input.url,location.href).pathname;}catch{}
  if(config.id!=='taptap'||!/\/(?:session|config|api\/taptap\/[\w-]+|api\/mobile\/profile)$/.test(path))return request(input);
  const started=Date.now(),label=(input.method||'GET').toUpperCase()+' '+path.replace(/^.*?(\/(?:session|config|api\/.*))$/,'$1');
  try{const reply=await request(input);loginLog.add(label+' · '+reply.status+' · '+(Date.now()-started)+'ms');return reply;}
  catch(error){loginLog.add(label+' · 网络失败 · '+(Date.now()-started)+'ms');throw error;}
 };
 const platform:Platform={config,canvas,viewport,request:loggedRequest,audio:audioPlayback.audio,loginLog,...(config.id==='taptap'?{tapAuthorizationDebug,tapNicknameUnavailable:()=>identityController?.nicknameUnavailable()===true}:{}),
  uiSize:()=>uiSize,setUiSize(size){if(!Object.hasOwn(uiSizeFactor,size))return;uiSize=size;try{localStorage.setItem(uiSizeKey,size);}catch{}for(const fn of resizeListeners)fn();},
  networkDiagnostics:()=>({http:config.id==='taptap'&&tap()?.request?apiTransport:'browser'}),
  openSocket(url,handlers){
   const socket=new WebSocket(platformSocketUrl(url,config));let closed=false;
   socket.onopen=()=>{if(!closed)handlers.open();};socket.onmessage=event=>{if(!closed&&typeof event.data==='string')handlers.message(event.data);};socket.onerror=()=>{if(!closed)handlers.error();};socket.onclose=()=>{if(!closed){closed=true;socket.onopen=socket.onmessage=socket.onerror=socket.onclose=null;handlers.close();}};
   return{send(data){if(closed||socket.readyState!==WebSocket.OPEN)throw Error('实时连接尚未就绪');if(socket.bufferedAmount>16*1024)throw Error('实时连接发送拥堵，请重连');socket.send(data);},close(){if(closed)return;closed=true;socket.onopen=socket.onmessage=socket.onerror=socket.onclose=null;socket.close();}};
  },
  prepareTapConsent(accept,fail){if(!identityController||consentRequest)return;consentRequest={accept,fail};void identityController(true).catch(error=>{const request=consentRequest;consentRequest=null;request?.fail(error);});},setIdentityButtonVisible(visible){identityVisible=visible;identityController?.setHidden(document.hidden||!visible);},tapAuthorizationPending:()=>authorizationPending,onIdentityChange(fn){identityListeners.add(fn);return()=>identityListeners.delete(fn);},tapTapIdentity,cancelIdentity:()=>identityController?.cancel(),retryTapAuthorizationButton:()=>identityController?.retryButton(),...(config.tapAuthorizationTest?{tapIdentityDiagnostics:()=>identityDiagnostic+' · 原生按钮接口'+(typeof (tap() as any)?.createUserInfoButton==='function'?'已提供':'未提供')} :{}),
  ...(config.id==='taptap'?{onlineBattleManager:()=>{const host=tap() as (TapHost&{getOnlineBattleManager?:()=>TapBattleManager})|undefined;return host?.getOnlineBattleManager?.();},onlineBattleDiagnostics:()=>{
   const host=tap() as (TapHost&{getOnlineBattleManager?:unknown;getSystemInfoSync?:()=>{tapSDKVersion?:unknown;version?:unknown}})|undefined;
   let info:{tapSDKVersion?:unknown;version?:unknown}={};try{info=host?.getSystemInfoSync?.()??{};}catch{}
   const version=(value:unknown)=>typeof value==='string'&&/^[0-9][0-9A-Za-z.+_-]{0,39}$/.test(value)?value:undefined;
   return {managerAvailable:typeof host?.getOnlineBattleManager==='function',tapSDKVersion:version(info.tapSDKVersion),clientVersion:version(info.version)};
  }}:{}),
  createImage(){return new Image();},
  setImageSource(image,src){
   const resolved=uiUrl(src);
   const bundled=isBundledArtworkFile(src,config);
   let remoteArtwork=false;try{const url=new URL(resolved);remoteArtwork=!bundled&&url.origin!==location.origin&&/(?:^|\/)puzzles\//i.test(url.pathname);}catch{}
   // The uploaded sprite sheets are package-local and may be served by a
   // wrapper without CORS headers. Keep anonymous CORS for remote artwork,
   // but remove it before loading local UI art.
   if(remoteArtwork)image.crossOrigin='anonymous';else try{image.removeAttribute('crossorigin');}catch{try{image.crossOrigin='';}catch{}}
   // The mobile artwork host is fronted by a CDN. Keep the TapTap shell on a
   // fresh cache key when the public response headers are repaired, so an
   // older cached image without CORS headers cannot poison Canvas decoding.
   if(config.id==='taptap'){
    const url=new URL(resolved);
    // Collection responses can contain either the mobile asset base or a
    // legacy public /puzzles/ URL. Both are public artwork and must use a
    // fresh cache key after the CDN CORS headers are repaired.
    if(!bundled&&url.hostname.toLowerCase()==='jigsawnook.online'&&/(?:^|\/)puzzles\//i.test(url.pathname)){
     url.searchParams.set('corsfix','20261019b');image.src=url.href;
    }else image.src=resolved;
   }else image.src=resolved;
   return()=>{};
  },
  createCanvas:()=>document.createElement('canvas'),
  ...(config.id==='taptap'&&typeof createImageBitmap==='function'?{snapshotCanvas:async(source:HTMLCanvasElement)=>{const image=await createImageBitmap(source);return{image,close:()=>image.close()};}}:{}),
  storage:{get(key){try{return localStorage.getItem(key)??storageMemory.get(key)??null;}catch{return storageMemory.get(key)??null;}},set(key,value){storageMemory.set(key,value);try{localStorage.setItem(key,value);}catch{}},remove(key){storageMemory.delete(key);try{localStorage.removeItem(key);}catch{}},getSession(key){try{return sessionStorage.getItem(key);}catch{return null;}},setSession(key,value){try{sessionStorage.setItem(key,value);}catch{}}},
  async restoreWebIdentity(){if(!cookieIdentity)return;const reply=await request({url:new URL('/api/auth/me',location.href).href});if(reply.status!==200)throw Error('暂时无法确认网站账号，请重试');if(reply.data?.account)return;const secret=await webGuestSecret();const restored=await request({url:new URL('/api/guest',location.href).href,method:'POST',body:{secret}});if(restored.status<200||restored.status>=300)throw Error('游客进度暂时无法连接，请重试');},
  openUrl(path){const url=new URL(path,location.href);if(url.origin!==location.origin||!['http:','https:'].includes(url.protocol))throw Error('链接必须属于当前网站');location.assign(url.href);},
  randomId(){return Array.from(crypto.getRandomValues(new Uint8Array(16)),value=>value.toString(16).padStart(2,'0')).join('');},
  frame:fn=>requestAnimationFrame(fn),cancelFrame:id=>cancelAnimationFrame(id),
  inputDiagnostics:()=>({pointerMoves:rawPointerMoves,touchMoves:rawTouchMoves,mode:touchInputMode?'touch':'pointer'}),
  setTouchInputMode(enabled){if(touchInputMode===enabled)return;resetInput?.();touchInputMode=enabled;},
  onInput(fn){const active=new Map<number,Point>(),panPointers=new Set<number>();const restore=canvas.style.touchAction,tabIndex=canvas.getAttribute('tabindex');let space=false;canvas.style.touchAction='none';if(tabIndex===null)canvas.tabIndex=0;
   const handle=(type:'down'|'move'|'up'|'cancel')=>(event:PointerEvent)=>{if(type==='move')rawPointerMoves++;if(touchInputMode&&event.pointerType==='touch')return;if(type==='down'&&event.button!==0&&event.button!==1)return;const hover=type==='move'&&event.pointerType==='mouse'&&!active.has(event.pointerId);if(type!=='down'&&!active.has(event.pointerId)&&!hover)return;event.preventDefault();const r=canvas.getBoundingClientRect(),point={id:event.pointerId,x:(event.clientX-r.left)/scale,y:(event.clientY-r.top)/scale};
    if(hover){fn({type,points:[],changed:[point]});return;}
    if(type==='down'){canvas.focus({preventScroll:true});if(event.button===1||(event.pointerType==='mouse'&&space))panPointers.add(event.pointerId);}
    const pan=panPointers.has(event.pointerId);
    if(type==='down'||type==='move')active.set(event.pointerId,point);else active.delete(event.pointerId);
    if(type==='down')try{canvas.setPointerCapture(event.pointerId);}catch{}
    fn({type,points:[...active.values()],changed:[point],...(pan?{pan:true}:{})});
    if(type==='up'||type==='cancel'){panPointers.delete(event.pointerId);try{canvas.releasePointerCapture(event.pointerId);}catch{}}
   };
   const down=handle('down'),move=handle('move'),up=handle('up'),cancel=handle('cancel');
   const leave=(event:PointerEvent)=>{if(event.pointerType==='mouse'&&!active.has(event.pointerId))fn({type:'cancel',points:[],changed:[{id:event.pointerId,x:0,y:0}]});};
   const wheel=(event:WheelEvent)=>{event.preventDefault();const r=canvas.getBoundingClientRect(),unit=event.deltaMode===1?16:event.deltaMode===2?Math.max(1,r.height):1;fn({type:'wheel',points:[],changed:[{id:-1,x:(event.clientX-r.left)/scale,y:(event.clientY-r.top)/scale}],deltaX:event.deltaX*unit,deltaY:event.deltaY*unit});};
   const key=(keyDown:boolean)=>(event:KeyboardEvent)=>{
    if(!keyDown&&event.code==='Space')space=false;
    // Native text dialogs own their keyboard; game shortcuts must not consume typing.
    const target=document.activeElement;if(textPromptOpen||(target&&target!==canvas&&target!==document.body)||event.ctrlKey||event.metaKey||event.altKey)return;
    if(event.code!=='Space'&&event.key!=='Escape'&&!/^Key[EHBFRT]$/.test(event.code)&&!/^Digit[1-6]$/.test(event.code))return;
    event.preventDefault();if(event.code==='Space')space=keyDown;
    fn({type:'key',points:[],changed:[],key:event.code==='Space'?' ':event.code.startsWith('Key')?event.code.slice(3).toLowerCase():event.code.startsWith('Digit')?event.code.slice(5):event.key,keyDown,repeat:event.repeat});
   };
   const keyDown=key(true),keyUp=key(false),reset=()=>{space=false;const changed=[...active.values()],ids=[...active.keys()];active.clear();panPointers.clear();for(const id of ids)try{canvas.releasePointerCapture(id);}catch{}if(changed.length)fn({type:'cancel',points:[],changed});};
   const lost=(event:PointerEvent)=>{if(active.has(event.pointerId))reset();};
   resetInput=reset;
   // A diagnostic alternative to the WebView's pointer-event conversion.
   // Only one touch path feeds the game; mouse/pen pointer input is preserved.
   const touch=(type:'down'|'move'|'up'|'cancel')=>(event:TouchEvent)=>{
    if(type==='move')rawTouchMoves++;
    if(!touchInputMode)return;
    if(event.cancelable)event.preventDefault();
    if(type==='cancel'){reset();return;}
    const r=canvas.getBoundingClientRect(),point=(t:Touch)=>({id:-t.identifier-1,x:(t.clientX-r.left)/scale,y:(t.clientY-r.top)/scale});
    const changed=Array.from(event.changedTouches).map(point);
    if(type==='down')for(const p of changed)active.set(p.id,p);
    if(type==='move')for(const t of Array.from(event.touches)){const p=point(t);if(active.has(p.id))active.set(p.id,p);}
    if(type==='up')for(const p of changed)active.delete(p.id);
    if(changed.length)fn({type,points:[...active.values()],changed});
   };
   const touchDown=touch('down'),touchMove=touch('move'),touchUp=touch('up'),touchCancel=touch('cancel');
   const hide=()=>{if(document.hidden)reset();};
   canvas.addEventListener('pointerdown',down);canvas.addEventListener('pointermove',move);canvas.addEventListener('pointerup',up);canvas.addEventListener('pointercancel',cancel);canvas.addEventListener('pointerleave',leave);canvas.addEventListener('lostpointercapture',lost);
   canvas.addEventListener('touchstart',touchDown,{passive:false});canvas.addEventListener('touchmove',touchMove,{passive:false});canvas.addEventListener('touchend',touchUp,{passive:false});canvas.addEventListener('touchcancel',touchCancel,{passive:false});
   canvas.addEventListener('wheel',wheel,{passive:false});window.addEventListener('keydown',keyDown);window.addEventListener('keyup',keyUp);window.addEventListener('blur',reset);document.addEventListener('visibilitychange',hide);
   return()=>{reset();resetInput=null;canvas.style.touchAction=restore;if(tabIndex===null)canvas.removeAttribute('tabindex');else canvas.setAttribute('tabindex',tabIndex);canvas.removeEventListener('pointerdown',down);canvas.removeEventListener('pointermove',move);canvas.removeEventListener('pointerup',up);canvas.removeEventListener('pointercancel',cancel);canvas.removeEventListener('pointerleave',leave);canvas.removeEventListener('lostpointercapture',lost);canvas.removeEventListener('touchstart',touchDown);canvas.removeEventListener('touchmove',touchMove);canvas.removeEventListener('touchend',touchUp);canvas.removeEventListener('touchcancel',touchCancel);canvas.removeEventListener('wheel',wheel);window.removeEventListener('keydown',keyDown);window.removeEventListener('keyup',keyUp);window.removeEventListener('blur',reset);document.removeEventListener('visibilitychange',hide);};
  },
  ...(config.id==='web'?{fullscreen:webFullscreen(document)}:{}),
  ...(config.id==='taptap'?{setOrientation:(value:'portrait'|'landscape')=>setTapOrientation(tap(),value)}:{}),
  onResize(fn){const host=tap(),nativeChange=()=>{identityController?.refreshLayout();fn();};let nativeListening=false;if(host?.onDeviceOrientationChange&&host.offDeviceOrientationChange){try{host.onDeviceOrientationChange(nativeChange);nativeListening=true;}catch{}}window.addEventListener('resize',nativeChange);document.addEventListener('fullscreenchange',nativeChange);const observer=typeof ResizeObserver==='function'?new ResizeObserver(nativeChange):null;observer?.observe(canvas);resizeListeners.add(nativeChange);return()=>{resizeListeners.delete(nativeChange);window.removeEventListener('resize',nativeChange);document.removeEventListener('fullscreenchange',nativeChange);if(nativeListening)try{host?.offDeviceOrientationChange?.(nativeChange);}catch{}observer?.disconnect();};},
  onHide(fn){const hide=()=>{if(document.hidden){identityController?.setHidden(true);audioPlayback.setHidden(true);fn();}};document.addEventListener('visibilitychange',hide);return()=>document.removeEventListener('visibilitychange',hide);},
  onShow(fn){const show=()=>{if(!document.hidden){identityController?.refreshLayout();identityController?.setHidden(!identityVisible);audioPlayback.setHidden(false);fn(query());}};document.addEventListener('visibilitychange',show);window.addEventListener('hashchange',show);return()=>{document.removeEventListener('visibilitychange',show);window.removeEventListener('hashchange',show);};},
  shareDiagnostics:()=>shareDiagnostic,
  ...(config.id==='taptap'?{cancelShare:()=>shareController?.abort()}:{}),
  adDiagnostics:()=>adDiagnostic,
  async showInterstitialAd(unit){if(watching){reportAd('上一条广告仍在处理中',unit);return 'unavailable';}watching=true;audioPlayback.setAdPlaying(true);try{return await interstitial(unit);}finally{watching=false;audioPlayback.setAdPlaying(false);}},
  async share(input){const url=new URL(config.gameBase||location.href,document.baseURI),params=new URLSearchParams(input.query);if(input.roomId)params.set('room',input.roomId);if(input.inviteCode)params.set('ref',input.inviteCode);for(const [key,value]of params)url.searchParams.set(key,value);
   if(config.id==='taptap'){
    if(shareController)return 'unavailable';const controller=new AbortController();shareController=controller;
    try{return await shareOnTapTap(tap(),Object.fromEntries(params),45000,detail=>{shareDiagnostic=detail;},{signal:controller.signal,subscribeReturn:returned=>subscribeTapShareReturn(tap(),{window,document,canvas},returned)});}finally{if(shareController===controller)shareController=undefined;}
   }
   try{if(navigator.share){await navigator.share({title:input.title,url:url.href});return 'shared';}if(navigator.clipboard){await navigator.clipboard.writeText(url.href);return 'copied';}return 'unavailable';}
   catch(error){return (error as {name?:string}).name==='AbortError'?'cancelled':'unavailable';}
  },
  async watchAd(unit){const host=tap();if(!unit||!host?.createRewardedVideoAd||watching){reportAd(!unit?'广告位为空':watching?'上一条广告仍在处理中':'TapTap广告接口不可用',unit);return 'unavailable';}watching=true;audioPlayback.setAdPlaying(true);
   let outcome:'completed'|'closed'|'failed'='failed';
   try{reportAd('创建广告',unit);if(!ad||adUnit!==unit){ad?.destroy?.();ad=host.createRewardedVideoAd({adUnitId:unit});adUnit=unit;}const instance=ad;
    outcome=await new Promise<'completed'|'closed'|'failed'>(resolve=>{let done=false,stage='加载';const finish=(result:'completed'|'closed'|'failed')=>{if(done)return;done=true;clearTimeout(timer);try{instance.offClose?.(close);instance.offError?.(error);}catch{}resolve(result);};const close=(result:{isEnded?:boolean})=>{if(done)return;reportAd(result?.isEnded===true?'完整观看':'提前关闭或未提供完播标记',unit);finish(result?.isEnded===true?'completed':'closed');};const error=(detail?:unknown)=>{if(done)return;reportAd(stage+'失败',unit,detail);finish('failed');};const timer=setTimeout(()=>{reportAd(stage+'超时（180秒）',unit);finish('failed');},180000);
     try{instance.onClose(close);instance.onError(error);reportAd('加载中',unit);void Promise.resolve(instance.load()).then(()=>{if(done)return;stage='展示';reportAd('展示中',unit);return instance.show();}).catch(error);}catch(detail){error(detail);}
    });return outcome;
   }catch(detail){reportAd('创建广告异常',unit,detail);return 'failed';}finally{if(outcome==='failed'){try{ad?.destroy?.();}catch{}ad=undefined;adUnit='';}watching=false;audioPlayback.setAdPlaying(false);}
  },
  async prompt(title,value='',options){return options?.multiline?textPrompt(title,value,options.maxLength??2000):window.prompt(title,value);},alert:message=>window.alert(message),
  async copyText(text){
   // TapTap first (tt.setClipboardData), then the async clipboard, then a selected textarea.
   const host=(globalThis as unknown as {tt?:{setClipboardData?:(options:{data:string;success:()=>void;fail:()=>void})=>void}}).tt;
   if(config.id==='taptap'&&host?.setClipboardData){const ok=await new Promise<boolean>(resolve=>{try{host.setClipboardData!({data:text,success:()=>resolve(true),fail:()=>resolve(false)});}catch{resolve(false);}});if(ok)return true;}
   try{await navigator.clipboard.writeText(text);return true;}catch{}
   try{const area=document.createElement('textarea');area.value=text;area.setAttribute('readonly','');area.style.position='fixed';area.style.opacity='0';document.body.appendChild(area);area.select();const ok=document.execCommand('copy');area.remove();return ok;}catch{return false;}
  },
  async loadFont(url){try{const name='JigsawSharedFont',face=await new FontFace(name,'url("'+uiUrl(url).replace(/["\\]/g,'')+'")').load();document.fonts.add(face);return name;}catch{return null;}},
  playSound:url=>audioPlayback.playSound(url),
  initialQuery:query(),
  ...(nativeSocial?{nativeSocial}:{}),
 };
 return platform;
}
function lowerHeaders(headers?:Record<string,string>){return Object.fromEntries(Object.entries(headers||{}).map(([key,value])=>[key.toLowerCase(),String(value)]));}
