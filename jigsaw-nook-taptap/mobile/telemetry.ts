import {GamePropelTapTapH5Client,type EventPayload,type EventPayloadValue} from '@gamepropel/sdk-taptap-h5';
import adPlacementIds from '../config/gamealgo-ad-placement-ids.json' with { type: 'json' };
import type {MobileProfile} from '../h5/mobile-api';
import {pendingOfflineClears,readCachedServerLevels} from '../lib/offline-play';
import type {AdPlacementKey,Platform,PlatformConfig,TelemetryAttemptStart,TelemetryBridge} from './ports';

export const GAMEALGO_AD_PLACEMENTS:Readonly<Record<AdPlacementKey,string>>=Object.freeze(adPlacementIds.ids);

type ActiveAttempt={attemptId:string;levelId?:string;levelNo?:number;mode:string;pieces:number;startedAtMs:number};

function cleanPayload(input:Record<string,unknown>|undefined):EventPayload{
 const output:EventPayload={};
 if(!input)return output;
 for(const [key,value] of Object.entries(input)){
  if(value===null||typeof value==='string'||typeof value==='boolean'||(typeof value==='number'&&Number.isFinite(value))){
   output[key]=value as EventPayloadValue;
  }
 }
 return output;
}

/**
 * Determine whether the player already had game progress prior to GamePropel SDK integration.
 * Returns `true` for confirmed veterans, `false` for confirmed brand-new players,
 * and `undefined` when disconnected with no local cleared progress (omitted on SDK init).
 */
export function detectIsOldUser(profile:MobileProfile|null|undefined,storage?:Pick<Platform['storage'],'get'>):boolean|undefined{
 let hasLocalClears=false;
 if(storage){
  try{
   const adapter={get:(key:string)=>{try{return storage.get(key);}catch{return null;}},set(){},remove(){}};
   hasLocalClears=pendingOfflineClears(adapter).length>0||(readCachedServerLevels(adapter)?.chapters.some(ch=>ch.levels.some(lv=>lv.status==='cleared'))??false);
  }catch{}
 }
 if(hasLocalClears)return true;
 if(!profile)return undefined;
 if(
  profile.level>0||
  profile.totalXp>0||
  profile.xp>0||
  profile.newcomer===false||
  !!profile.firstRoomId||
  (profile.ownedRooms?.length??0)>0||
  (profile.giftProgress??0)>0||
  (profile.giftCount??0)>0||
  (profile.supply?.energy??0)>0||
  (profile.collection?.coins??0)>0||
  (profile.collection?.fragments??0)>0||
  (profile.collection?.ownedPackIds?.length??0)>0||
  (profile.collection?.ownedImageIds?.length??0)>0||
  !!profile.collection?.equipped
 ){
  return true;
 }
 return false;
}

export class GameTelemetry implements TelemetryBridge{
 private client:GamePropelTapTapH5Client|null=null;
 private initialized=false;
 private closed=false;
 private watching=false;
 private activeAttempt:ActiveAttempt|null=null;
 private queuedMilestones:Array<{type:'new_user'|'global';point:string}>=[];
 private readonly config:PlatformConfig;
 private readonly storage:Pick<Platform['storage'],'get'>;
 private readonly onAdPlaying?:(playing:boolean)=>void;
 private readonly logger?:(message:string)=>void;

 constructor(options:{config:PlatformConfig;storage:Pick<Platform['storage'],'get'>;onAdPlaying?:(playing:boolean)=>void;logger?:(message:string)=>void}){
  this.config=options.config;
  this.storage=options.storage;
  this.onAdPlaying=options.onAdPlaying;
  this.logger=options.logger;
 }

 get adEnabled():boolean{
  return !!this.client&&this.config.id==='taptap';
 }

 private get sdkConfigured():boolean{
  const key=this.config.gamePropel?.gameKey?.trim()??'';
  const baseUrl=this.config.gamePropel?.baseUrl?.trim()??'';
  return this.config.id==='taptap'&&/^ga_live_[a-zA-Z0-9]+$/.test(key)&&/^https?:\/\//.test(baseUrl);
 }

 init(profile:unknown):void{
  if(this.initialized||this.closed||!this.sdkConfigured)return;
  this.initialized=true;
  try{
   const gp=this.config.gamePropel!;
   const isOldUser=detectIsOldUser(profile as MobileProfile|null|undefined,this.storage);
   const client=GamePropelTapTapH5Client.init({
    baseUrl:gp.baseUrl,
    gameKey:gp.gameKey,
    appVersion:this.config.appVersion||'0.53.23',
    experimentIntegrationVersion:gp.experimentIntegrationVersion??0,
    isDebug:false,
    ...(isOldUser!==undefined?{isOldUser}:{}),
    ...(this.logger?{logger:this.logger}:{}),
   });
   this.client=client;
   void client.waitForReady(2000).then(()=>client.flush()).catch(()=>{});
   if(this.queuedMilestones.length){
    const queued=this.queuedMilestones.splice(0,this.queuedMilestones.length);
    for(const item of queued)this.milestone(item.type,item.point);
   }
  }catch{
   this.client=null;
  }
 }

 prepareAd(unit:string):void{
  if(!this.client||!unit)return;
  try{
   const tap=(globalThis as {tap?:{createRewardedVideoAd?:unknown}}).tap;
   if(typeof tap?.createRewardedVideoAd!=='function')return;
   this.client.createAdSpace({adUnitId:unit});
  }catch{}
 }

 async watchRewardedAd(placementKey:AdPlacementKey,unit:string,payload?:Record<string,unknown>):Promise<'completed'|'closed'|'failed'|'unavailable'>{
  if(!this.client||!unit)return 'unavailable';
  const tap=(globalThis as {tap?:{createRewardedVideoAd?:unknown}}).tap;
  if(typeof tap?.createRewardedVideoAd!=='function')return 'unavailable';
  const adPlacementId=GAMEALGO_AD_PLACEMENTS[placementKey];
  if(!adPlacementId)return 'unavailable';
  if(this.watching)return 'failed';
  this.watching=true;
  this.onAdPlaying?.(true);
  try{
   const space=this.client.createAdSpace({adUnitId:unit});
   const clean=cleanPayload(payload);
   return await new Promise<'completed'|'closed'|'failed'>(resolve=>{
    let settled=false;
    let shown=false;
    let timer=setTimeout(()=>finish('failed'),12000);
    const finish=(outcome:'completed'|'closed'|'failed')=>{
     if(settled)return;
     settled=true;
     clearTimeout(timer);
     resolve(outcome);
    };
    void space.show(adPlacementId,{
     onClose(result){
      finish(result?.isEnded===true?'completed':'closed');
     },
     onError(){
      finish('failed');
     },
    },clean).then(()=>{
     if(settled)return;
     shown=true;
     clearTimeout(timer);
     timer=setTimeout(()=>finish('closed'),180000);
    },()=>{
     if(!shown)finish('failed');
     else finish('failed');
    });
   });
  }catch{
   return 'failed';
  }finally{
   this.watching=false;
   this.onAdPlaying?.(false);
  }
 }

 startAttempt(attempt:TelemetryAttemptStart):void{
  if(this.closed)return;
  if(this.activeAttempt)this.endAttempt('quit');
  try{
   const attemptId=attempt.randomId();
   const startedAtMs=this.client?.getForegroundTimeMs()??0;
   this.activeAttempt={
    attemptId,
    levelId:attempt.levelId,
    levelNo:attempt.levelNo,
    mode:attempt.mode,
    pieces:attempt.pieces,
    startedAtMs,
   };
   this.client?.tracker.trackLevelStart(cleanPayload({
    level_attempt_id:attemptId,
    level_id:attempt.levelId,
    level_no:attempt.levelNo,
    mode:attempt.mode,
    pieces:attempt.pieces,
   }));
  }catch{}
 }

 endAttempt(result:'win'|'quit'):void{
  const current=this.activeAttempt;
  if(!current)return;
  this.activeAttempt=null;
  try{
   if(!this.client)return;
   const nowMs=this.client.getForegroundTimeMs();
   const durationSec=Math.max(0,Math.round((nowMs-current.startedAtMs)/1000));
   this.client.tracker.trackLevelEnd(cleanPayload({
    level_attempt_id:current.attemptId,
    level_id:current.levelId,
    level_no:current.levelNo,
    result,
    mode:current.mode,
    pieces:current.pieces,
    duration_sec:durationSec,
   }));
   if(result==='win')void this.client.flush().catch(()=>{});
  }catch{}
 }

 milestone(type:'new_user'|'global',point:string):void{
  if(this.closed||!point)return;
  if(!this.client){
   if(!this.initialized&&this.sdkConfigured&&this.queuedMilestones.length<16){
    if(!this.queuedMilestones.some(item=>item.type===type&&item.point===point)){
     this.queuedMilestones.push({type,point});
    }
   }
   return;
  }
  try{
   this.client.tracker.trackMilestone(type,point);
  }catch{}
 }

 close():void{
  if(this.closed)return;
  if(this.activeAttempt)this.endAttempt('quit');
  this.closed=true;
  try{
   this.client?.close();
  }catch{}
  this.client=null;
 }
}

export function createTapTapTelemetry(options:{config:PlatformConfig;storage:Pick<Platform['storage'],'get'>;onAdPlaying?:(playing:boolean)=>void;logger?:(message:string)=>void}):TelemetryBridge{
 return new GameTelemetry(options);
}
