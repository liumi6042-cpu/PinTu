import type {TapBattleManager} from './tap-preview';
export type PlatformId='web'|'taptap'|'wechat';
export type UiSize='auto'|'small'|'large'|'xlarge';
export type Viewport={width:number;height:number;dpr:number;top:number;bottom:number};
export type Point={id:number;x:number;y:number};
export type Input={
 type:'down'|'move'|'up'|'cancel'|'wheel'|'key';points:Point[];changed:Point[];
 /** Desktop wheel distances in CSS pixels; changed[0] is the canvas-local anchor. */
 deltaX?:number;deltaY?:number;
 /** Middle-button or Space + left-button gesture: pan without acquiring a piece. */
 pan?:boolean;
 key?:string;keyDown?:boolean;repeat?:boolean;
};
export type HttpInput={url:string;method?:string;headers?:Record<string,string>;body?:unknown;timeout?:number};
export type HttpReply={status:number;data:any;headers:Record<string,string>};
export type SocketHandlers={open():void;message(data:string):void;close():void;error():void};
export type PlatformSocket={send(data:string):void;close():void};
/** Keep room credentials on the API host. This parser also works in native
 * Mini Game hosts without the browser URL constructor. */
export function platformSocketUrl(url:string,config:Pick<PlatformConfig,'apiBase'|'development'>){
 const parse=(value:string)=>{const match=typeof value==='string'&&!/[\s\\]/.test(value)&&/^(https?|wss?):\/\/(\[[a-f0-9:]+\]|[a-z0-9.-]+)(?::([0-9]+))?(?:[/?][^#\s]*)?$/i.exec(value);if(!match)throw Error('实时连接地址无效');const protocol=match[1].toLowerCase(),hostname=match[2].toLowerCase(),port=match[3]?Number(match[3]):protocol==='https'||protocol==='wss'?443:80;if(!Number.isInteger(port)||port<1||port>65535)throw Error('实时连接端口无效');return{protocol,hostname,port};};
 const target=parse(url),api=parse(config.apiBase);
 if(target.protocol!=='wss'&&!(target.protocol==='ws'&&config.development&&['127.0.0.1','localhost','[::1]'].includes(target.hostname)))throw Error('实时连接必须使用 WSS');
 if(!['http','https'].includes(api.protocol)||target.hostname!==api.hostname||target.port!==api.port)throw Error('实时连接必须使用当前服务器');
 return url;
}
export type TextPromptOptions={multiline?:boolean;maxLength?:number};
export type NativeSocialStatus={state:'idle'|'loading'|'ready'|'unavailable'|'failed';error?:{kind:'plugin-unavailable'|'plugin-load-failed'|'invalid-plugin'|'initialization-error'|'initialization-timeout'|'opening-error'|'opening-timeout';code?:number}};
export type NativeSocialOpenResult='opened'|'unsupported'|'unavailable'|'failed';
export type TapTapIdentity={code:string;nickname?:string};
/** Hidden preparation and an optional official native private-chat entry. */
export type NativeSocial={prepare():Promise<NativeSocialStatus>;status():NativeSocialStatus;openPrivate?():Promise<NativeSocialOpenResult>;openFriends?():Promise<NativeSocialOpenResult>};
export type WebLinks={account?:string;security?:string;membership?:string;uploads?:string;legacyLobby?:string;legacyRoom?:string;largePuzzles?:string;terms?:string;privacy?:string;feedback?:string};
export type PlatformConfig={id:PlatformId;gameName:string;apiBase:string;assetBase:string;appId?:string;rewardedAdUnitId?:string;gameBase?:string;uiBase?:string;bundledArtwork?:Readonly<Record<string,string>>;identityMode?:'guest-device'|'web-cookie'|'taptap';webLinks?:WebLinks;development?:boolean;nativeSocialEnabled?:boolean;buildVersion?:string;tapAuthorizationTest?:boolean;previewTestRoom?:{id:string;inviteCode:string}};
export type Platform={
 config:PlatformConfig;
 canvas:HTMLCanvasElement;
 viewport():Viewport;
 /** Browser hosts: user text-size preference; the viewport follows it at once. */
 uiSize?():UiSize;
 setUiSize?(size:UiSize):void;
 createImage():HTMLImageElement;
 /** Host-managed public image loading; cancellation suppresses pending callbacks. */
 setImageSource?(image:HTMLImageElement,src:string):()=>void;
 createCanvas():HTMLCanvasElement;
 /** Materialize a static Canvas once, without retaining its drawing commands. */
 snapshotCanvas?(canvas:HTMLCanvasElement):Promise<{image:CanvasImageSource;close():void}>;
 request(input:HttpInput):Promise<HttpReply>;
 networkDiagnostics?():{http:'browser'|'native'|'undecided'};
 openSocket?(url:string,handlers:SocketHandlers):PlatformSocket;
 /** Only used after an authenticated, explicitly selected TapTap test-room admission. */
 onlineBattleManager?():TapBattleManager|undefined;
 onlineBattleDiagnostics?():{managerAvailable:boolean;tapSDKVersion?:string;clientVersion?:string};
 storage:{get(key:string):string|null;set(key:string,value:string):void;remove(key:string):void;getSession?(key:string):string|null;setSession?(key:string,value:string):void};
 /** Formal Web uses its existing account/guest cookie, never an H5 identity. */
 restoreWebIdentity?():Promise<void>;
 openUrl?(url:string):void;
 setOrientation?(value:'portrait'|'landscape'):Promise<void>;
 fullscreen?:{available():boolean;active():boolean;toggle():Promise<boolean>};
 randomId():string;
 frame(fn:(time:number)=>void):number;
 cancelFrame(id:number):void;
 onInput(fn:(input:Input)=>void):()=>void;
 inputDiagnostics?():{pointerMoves:number;touchMoves:number;mode:'pointer'|'touch'};
 setTouchInputMode?(enabled:boolean):void;
 onResize(fn:()=>void):()=>void;
 onHide(fn:()=>void):()=>void;
 onShow(fn:(query:Record<string,string>)=>void):()=>void;
 share(input:{title:string;roomId?:string;inviteCode?:string;query?:Record<string,string>}):Promise<'opened'|'shared'|'copied'|'cancelled'|'unavailable'>;
 shareDiagnostics?():string;
 /** End an unresolved native share wait; cancellation never reports a successful share. */
 cancelShare?():void;
 adDiagnostics?():string;
 watchAd(unit:string):Promise<'completed'|'closed'|'failed'|'unavailable'>;
 showInterstitialAd?(unit:string):Promise<'closed'|'failed'|'unavailable'>;
 prompt(title:string,value?:string,options?:TextPromptOptions):Promise<string|null>;
 alert(message:string):void;
 loadFont?(url:string):Promise<string|null>;
 playSound?(url:string):void;
 audio?:{setLevels(levels:AudioLevels):void;setMusic(url:string|null):void;unlock():void;dispose():void};
 initialQuery:Record<string,string>;
 nativeSocial?:NativeSocial;
 /** Resolve the TapTap identity before binding; cold-start recovery is bounded. */
 tapTapIdentity?(options?:{forceAuthorization?:boolean}):Promise<TapTapIdentity|null>;
 tapIdentityDiagnostics?():string;
 tapAuthorizationPending?():boolean;
 onIdentityChange?(fn:()=>void):()=>void;
 /** Only creates a native button; login starts after its explicit approval. */
 prepareTapConsent?(accept:()=>void,fail:(error:unknown)=>void):void;
 setIdentityButtonVisible?(visible:boolean):void;
 cancelIdentity?():void;
};
export type Rect={x:number;y:number;w:number;h:number};
export type AudioLevels={music:number;effects:number};
export type Route='lobby'|'gallery'|'room'|'tasks'|'supplies'|'collection'|'help'|'privacy'|'terms';

