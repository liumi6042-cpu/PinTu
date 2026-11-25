import {boot} from './boot';
import {createWechatPlatform} from './platform-wechat';
import type {PlatformConfig} from './ports';
declare const __GAME_CONFIG__:PlatformConfig;
declare const GameGlobal:Record<string,any>;
const runtime=globalThis as unknown as {wx:Record<string,any>;__JIGSAW_SHARED__?:ReturnType<typeof boot>};
const platform=createWechatPlatform(__GAME_CONFIG__);
runtime.wx.showShareMenu?.({menus:['shareAppMessage']});
runtime.wx.onShareAppMessage?.(()=>({title:'来拼图小窝，一起完成一幅画'}));
// Supplemental illustrations remain in a subpackage to keep the initial code
// package below the host limit. The same file paths are used by the web build.
const ctx=platform.canvas.getContext('2d'),view=platform.viewport();
platform.canvas.width=view.width*view.dpr;platform.canvas.height=view.height*view.dpr;
if(ctx){ctx.scale(view.dpr,view.dpr);ctx.fillStyle='#fdf6ed';ctx.fillRect(0,0,view.width,view.height);ctx.fillStyle='#642238';ctx.font='20px sans-serif';ctx.fillText('拼图小窝',28,view.height*.4);ctx.font='14px sans-serif';ctx.fillText('正在准备画作与工具…',28,view.height*.4+36);}
const start=()=>{runtime.__JIGSAW_SHARED__=boot(platform);if(__GAME_CONFIG__.development&&typeof GameGlobal!=='undefined')GameGlobal.__JIGSAW_SHARED__=runtime.__JIGSAW_SHARED__;
 // Preparation runs after game boot and never opens native public chat.
 void platform.nativeSocial?.prepare().then(status=>{if(!__GAME_CONFIG__.development)return;if(status.state==='ready')console.info('[wechat-social] ready');else console.info('[wechat-social] failed',status.error?.kind??'unavailable',status.error?.code??'');});
};
runtime.wx.loadSubpackage({name:'art',success:start,fail:()=>{platform.alert('游戏素材下载失败，请检查网络后重新进入');}});
