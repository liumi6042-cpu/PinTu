import {boot} from './boot';
import {createWebPlatform} from './platform-web';
import {launchOrientation} from './orientation-choice';
import type {PlatformConfig} from './ports';
declare const __GAME_CONFIG__:PlatformConfig;
const canvas=document.getElementById('game') as HTMLCanvasElement;
const host=window as unknown as {__JIGSAW_SHARED__?:ReturnType<typeof boot>;__JIGSAW_SHARED_CONFIG__?:Partial<PlatformConfig>};
const config={...__GAME_CONFIG__,...(__GAME_CONFIG__.id==='web'?host.__JIGSAW_SHARED_CONFIG__:{}),id:__GAME_CONFIG__.id};
if(config.development&&config.identityMode!=='web-cookie'&&['127.0.0.1','localhost'].includes(location.hostname)){
 const usesOriginAssets=config.assetBase.replace(/\/$/,'')===config.apiBase.replace(/\/$/,'')+'/assets';
 config.apiBase=location.origin+'/h5';
 // A deliberately configured CDN must also work in the local shared preview.
 if(usesOriginAssets)config.assetBase=config.apiBase+'/assets';
}
host.__JIGSAW_SHARED__?.destroy();
const platform=createWebPlatform(config,canvas);
// TapTap H5 hosts may not read game.json; request the saved orientation, or portrait by default.
if(config.id==='taptap')void platform.setOrientation?.(launchOrientation(platform.storage)).catch(()=>{});
// 仅独立自测包携带房间邀请，登录后自动进入同一间测试私房。
if(config.id==='taptap'&&new URL(config.apiBase).pathname==='/h5-tap-preview'&&config.previewTestRoom&&/^[a-f0-9]{32}$/.test(config.previewTestRoom.id)&&/^[a-f0-9]{32}$/.test(config.previewTestRoom.inviteCode))platform.initialQuery={room:config.previewTestRoom.id,roomInvite:config.previewTestRoom.inviteCode};
host.__JIGSAW_SHARED__=boot(platform);
