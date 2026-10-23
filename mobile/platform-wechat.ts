import type {Platform,PlatformConfig,HttpReply,Input,Point,Viewport} from './ports';
import {platformSocketUrl} from './ports';
import {WechatImageCache} from './wechat-image-cache';
import {createWechatSocialComponent} from './wechat-social-component';
import {AudioPlayback} from './audio-playback';
declare const requirePlugin:undefined|((name:string,options:{enableRequireHostModule:true;customEnv:{wx:Record<string,any>}})=>{default?:new(options:Record<string,unknown>)=>Record<string,any>});

// wx objects are genuine host objects. This adapter does not install window,
// document, HTML elements or a pretend browser in the Mini Game runtime.
type Host=Record<string,any>;
const queryOf=(value:unknown):Record<string,string>=>value&&typeof value==='object'?Object.fromEntries(Object.entries(value).filter((entry):entry is [string,string]=>typeof entry[1]==='string')):{};
export function createWechatPlatform(input:PlatformConfig):Platform{
 const wx=(globalThis as unknown as {wx?:Host}).wx;
 if(!wx?.createCanvas||!wx.request)throw Error('请在微信小游戏开发者工具或微信中运行');
 if(input.id!=='wechat')throw Error('微信平台配置无效');
 const config={...input,apiBase:input.apiBase.replace(/\/$/,''),assetBase:input.assetBase.replace(/\/$/,'')};
 for(const endpoint of [config.apiBase,config.assetBase])if(!/^https:\/\//.test(endpoint)&&!(config.development&&/^http:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?(?:\/|$)/.test(endpoint)))throw Error('微信网络地址必须使用 HTTPS');
 const canvas=wx.createCanvas() as HTMLCanvasElement,memory=new Map<string,string>();
 const audioPlayback=new AudioPlayback((url,loop)=>{
  if(typeof wx.createInnerAudioContext!=='function')throw Error('当前宿主不支持音频');
  const sound=wx.createInnerAudioContext(),error=()=>{};sound.src=url;sound.loop=loop;sound.autoplay=false;sound.onError?.(error);
  return {get volume(){return Number(sound.volume);},set volume(value){sound.volume=value;},play:()=>sound.play(),pause:()=>{if(typeof sound.pause==='function')sound.pause();else sound.stop?.();},rewind:()=>sound.stop?.(),dispose:()=>{sound.offError?.(error);sound.destroy?.();}};
 });
 const imageCache=new WechatImageCache(wx,config.assetBase);
 let rewardAd:Host|undefined,rewardUnit='',watching=false,prompting=false,counter=0,randomPool:number[]=[];
 const fillRandom=()=>{try{wx.getUserCryptoManager?.().getRandomValues({length:256,success:(result:{randomValues:ArrayBuffer})=>{randomPool.push(...new Uint8Array(result.randomValues));if(randomPool.length>1024)randomPool=randomPool.slice(-512);}});}catch{}};fillRandom();
 const viewport=():Viewport=>{const size=wx.getWindowInfo?.()||wx.getSystemInfoSync(),width=size.windowWidth||size.screenWidth,height=size.windowHeight||size.screenHeight,safe=size.safeArea;
  // Reserving the capsule's lower edge keeps the shared header clickable.
  let top=Math.max(0,safe?.top||size.statusBarHeight||0);try{const capsule=wx.getMenuButtonBoundingClientRect?.();if(capsule?.bottom>0&&capsule.bottom<height*.3)top=Math.max(top,capsule.bottom+4);}catch{}
  // Match the native backing pixels; a DPR cap makes high-density phones
  // enlarge the entire canvas again after we have drawn the pixel borders.
  return {width,height,dpr:Number.isFinite(size.pixelRatio)&&size.pixelRatio>0?size.pixelRatio:1,top,bottom:Math.max(0,height-(safe?.bottom??height))};
 };
 const point=(value:Host):Point=>({id:Number(value.identifier??value.id??0),x:Number(value.clientX??value.x??0),y:Number(value.clientY??value.y??0)});
 const subscribe=(on:string,off:string,listener:(value:any)=>void)=>{wx[on]?.(listener);return()=>wx[off]?.(listener);};
 const platform:Platform={config,canvas,viewport,audio:audioPlayback.audio,
  menuButtonRect(){try{const r=wx.getMenuButtonBoundingClientRect?.();return r&&[r.left,r.top,r.width,r.height].every(Number.isFinite)&&r.width>0&&r.height>0?{x:r.left,y:r.top,w:r.width,h:r.height}:null;}catch{return null;}},
  openSocket(url,handlers){
   const endpoint=platformSocketUrl(url,config);if(typeof wx.connectSocket!=='function')throw Error('当前宿主暂不支持实时连接');
   let closed=false,opened=false;const task=wx.connectSocket({url:endpoint});if(!task?.onOpen||!task?.onMessage||!task?.onClose||!task?.onError){task?.close?.({});throw Error('当前宿主暂不支持独立实时连接');}
   const detach=()=>{task.offOpen?.(open);task.offMessage?.(message);task.offClose?.(close);task.offError?.(error);};
   const open=()=>{if(!closed){opened=true;handlers.open();}},message=(event:Host)=>{if(!closed&&typeof event.data==='string')handlers.message(event.data);},error=()=>{if(!closed)handlers.error();},close=()=>{if(!closed){closed=true;opened=false;detach();handlers.close();}};
   task.onOpen(open);task.onMessage(message);task.onClose(close);task.onError(error);
   return{send(data){if(closed||!opened)throw Error('实时连接尚未就绪');task.send({data,fail:error});},close(){if(closed)return;closed=true;opened=false;detach();task.close({});}};
  },
  createImage:()=>wx.createImage(),createCanvas:()=>wx.createCanvas(),
  setImageSource:(image,src)=>imageCache.setImageSource(image,src),
  request(input){const timeout=input.timeout??12000,header={...input.headers};let data=input.body;
   if(data!==undefined&&typeof data!=='string'){data=JSON.stringify(data);if(!Object.keys(header).some(key=>key.toLowerCase()==='content-type'))header['Content-Type']='application/json';}
   // Session and admission headers are retained; browser cookies are never sent.
   for(const key of Object.keys(header))if(['cookie','referer','host'].includes(key.toLowerCase()))delete header[key];
   return new Promise<HttpReply>((resolve,reject)=>{let settled=false,task:Host|undefined;const finish=(fn:()=>void)=>{if(settled)return;settled=true;clearTimeout(timer);fn();};const timer=setTimeout(()=>finish(()=>{task?.abort?.();reject(Error('连接超时，请重试'));}),timeout+100);
    try{task=wx.request({url:input.url,method:(input.method||'GET').toUpperCase(),header,data,timeout,dataType:'text',responseType:'text',enableCache:false,
     success:(result:Host)=>finish(()=>{let body=result.data;if(typeof body==='string'){try{body=JSON.parse(body);}catch{}}resolve({status:Number(result.statusCode),data:body,headers:Object.fromEntries(Object.entries(result.header||{}).map(([key,value])=>[key.toLowerCase(),String(value)]))});}),
     fail:()=>finish(()=>reject(Error('网络连接失败，请确认服务器域名配置后重试'))),
    });}catch{finish(()=>reject(Error('网络连接失败，请重试')));}
   });
  },
  storage:{get(key){try{const value=wx.getStorageSync(key);return typeof value==='string'&&value?value:memory.get(key)??null;}catch{return memory.get(key)??null;}},set(key,value){memory.set(key,value);try{wx.setStorageSync(key,value);}catch{}},remove(key){memory.delete(key);try{wx.removeStorageSync(key);}catch{}}},
  randomId(){
   // Request IDs provide idempotency, never identity/authentication. Session and
   // room credentials are generated by the server with secure random bytes.
   if(randomPool.length>=16){const bytes=randomPool.splice(0,16);if(randomPool.length<64)fillRandom();return bytes.map(value=>value.toString(16).padStart(2,'0')).join('');}
   fillRandom();const now=Date.now().toString(16).padStart(12,'0').slice(-12),sequence=(++counter).toString(16).padStart(8,'0').slice(-8);return now+sequence+Array.from({length:6},()=>Math.floor(Math.random()*256).toString(16).padStart(2,'0')).join('');
  },
  frame(fn){const host=globalThis as unknown as Host;return host.requestAnimationFrame?host.requestAnimationFrame(fn):setTimeout(()=>fn(Date.now()),16) as unknown as number;},
  cancelFrame(id){const host=globalThis as unknown as Host;if(host.cancelAnimationFrame)host.cancelAnimationFrame(id);else clearTimeout(id);},
  onInput(fn){const handlers=([['Start','down'],['Move','move'],['End','up'],['Cancel','cancel']] as const).map(([name,type])=>{const listener=(event:Host)=>fn({type,points:(event.touches||[]).map(point),changed:(event.changedTouches||[]).map(point)} as Input);return subscribe('onTouch'+name,'offTouch'+name,listener);});return()=>handlers.forEach(off=>off());},
  onResize(fn){return subscribe('onWindowResize','offWindowResize',fn);},
  onHide(fn){return subscribe('onHide','offHide',()=>{audioPlayback.setHidden(true);fn();});},
  onShow(fn){return subscribe('onShow','offShow',result=>{audioPlayback.setHidden(false);fn(queryOf(result?.query));});},
  async share(value){if(!wx.shareAppMessage)return 'unavailable';const data={...value.query};if(value.roomId)data.room=value.roomId;if(value.inviteCode)data.ref=value.inviteCode;const query=Object.entries(data).map(([key,value])=>encodeURIComponent(key)+'='+encodeURIComponent(value)).join('&');
   try{wx.shareAppMessage({title:value.title,query});return 'opened';}catch{return 'unavailable';}
  },
  async watchAd(unit){
   // A TapTap placement must never be passed into the WeChat SDK. This platform
   // has no configured placement until one is created for its own public AppID.
   if(!config.rewardedAdUnitId||unit!==config.rewardedAdUnitId||!/^adunit-[a-z0-9]+$/i.test(unit)||!wx.createRewardedVideoAd||watching)return 'unavailable';watching=true;audioPlayback.setAdPlaying(true);
   try{if(!rewardAd||rewardUnit!==unit){rewardAd?.destroy?.();rewardAd=wx.createRewardedVideoAd({adUnitId:unit});rewardUnit=unit;}const ad=rewardAd!;
    return await new Promise<'completed'|'closed'|'failed'>(resolve=>{let done=false;const finish=(value:'completed'|'closed'|'failed')=>{if(done)return;done=true;clearTimeout(timer);ad.offClose?.(close);ad.offError?.(error);resolve(value);};const close=(result:{isEnded?:boolean})=>finish(result?.isEnded===true?'completed':'closed'),error=()=>finish('failed');const timer=setTimeout(error,180000);ad.onClose(close);ad.onError(error);void Promise.resolve(ad.load()).then(()=>{if(!done)return ad.show();}).catch(error);});
   }catch{return 'failed';}finally{watching=false;audioPlayback.setAdPlaying(false);}
  },
  copyText:text=>new Promise<boolean>(resolve=>{try{(wx as unknown as {setClipboardData(options:{data:string;success:()=>void;fail:()=>void}):void}).setClipboardData({data:text,success:()=>resolve(true),fail:()=>resolve(false)});}catch{resolve(false);}}),
  async prompt(title,value='',options){
   if(prompting)return null;prompting=true;
   try{
    if(options?.multiline&&wx.showKeyboard&&wx.onKeyboardConfirm&&wx.onKeyboardComplete){
     return await new Promise<string|null>(resolve=>{
      let settled=false,current=value;
      const finish=(text:string|null)=>{if(settled)return;settled=true;wx.offKeyboardConfirm?.(confirm);wx.offKeyboardComplete?.(complete);wx.offKeyboardInput?.(input);wx.offHide?.(hide);try{wx.hideKeyboard?.({});}catch{}resolve(text);};
      const confirm=(result:Host)=>finish(typeof result.value==='string'?result.value:current),complete=()=>finish(null),hide=()=>finish(null),input=(result:Host)=>{if(typeof result.value==='string')current=result.value;};
      wx.onKeyboardConfirm(confirm);wx.onKeyboardComplete(complete);wx.onKeyboardInput?.(input);wx.onHide?.(hide);
      try{wx.showKeyboard({defaultValue:value,maxLength:options.maxLength??2000,multiple:true,confirmHold:false,confirmType:'done',fail:()=>finish(null)});}catch{finish(null);}
     });
    }
    if(!wx.showModal)return null;
    return await new Promise<string|null>(resolve=>{wx.showModal({title,content:value,editable:true,placeholderText:title,confirmText:'确定',cancelText:'取消',success:(result:Host)=>resolve(result.confirm?String(result.content??value):null),fail:()=>resolve(null)});});
   }finally{prompting=false;}
  },
  alert(message){wx.showModal?.({title:config.gameName,content:message,showCancel:false});},
  async loadFont(url){if(!wx.loadFont)return null;try{if(!/^https?:\/\//.test(url))return wx.loadFont(url)||null;return await new Promise<string|null>(resolve=>{wx.downloadFile({url,success:(result:Host)=>{try{resolve(result.statusCode===200?wx.loadFont(result.tempFilePath)||null:null);}catch{resolve(null);}},fail:()=>resolve(null)});});}catch{return null;}},
  playSound:url=>audioPlayback.playSound(url),
  initialQuery:queryOf(wx.getLaunchOptionsSync?.()?.query),
  ...(config.nativeSocialEnabled===true?{nativeSocial:createWechatSocialComponent(wx,typeof requirePlugin==='function'?requirePlugin:undefined)}:{}),
 };
 return platform;
}
