import type {Platform} from './ports';

export const PLAYER_QQ_GROUP='397229653';
export const PLAYER_QQ_GROUP_COPY_HINT='已复制玩家 QQ 群号 '+PLAYER_QQ_GROUP+'，打开 QQ 搜索加群即可领兑换码或反馈问题';

export type LagEventKind='render'|'network'|'reconnect';
export type LagEvent={
 at:number;
 kind:LagEventKind;
 title:string;
 detail:string;
 peakMs:number;
};
export type LagAlert=LagEvent&{until:number};

export type LagMetricsSnapshot={
 fps:number|null;
 avgDrawMs:number;
 peakDrawMs:number;
 peakFrameMs:number;
 slowFrames5s:number;
 severeStalls5s:number;
 peakRttMs:number;
 slowNet15s:number;
 activeAlert:LagAlert|null;
 events:readonly LagEvent[];
 mutedForRoom:boolean;
};

const FRAME_WINDOW_MS=5000;
const NET_WINDOW_MS=15000;
const RTT_PEAK_WINDOW_MS=60000;
const ROOM_WARMUP_MS=2500;
const RESUME_WARMUP_MS=1500;
const ALERT_COOLDOWN_MS=180000;
const ALERT_DURATION_MS=15000;
const EVENT_THROTTLE_MS=5000;
const MAX_EVENTS=12;
const DISCONNECT_ALERT_MS=5000;

/**
 * Lightweight, allocation-minimal local lag detector.
 * Never schedules its own RAF or timer loop; fed passively by boot frame ticks,
 * RoomClient request timings, and the existing 1s visibility tick.
 */
export class LagMonitor{
 private frameSamples:Array<{at:number;gapMs:number;drawMs:number;painted:boolean;slow:boolean;severe:boolean}>=[];
 private netSamples:Array<{at:number;action:string;ms:number;status:number;slow:boolean}>=[];
 private events:LagEvent[]=[];
 private activeAlert:LagAlert|null=null;
 private lastEventByKind:Record<LagEventKind,number>={render:0,network:0,reconnect:0};
 private lastAlertAt=0;
 private roomWarmupUntil=0;
 private resumeWarmupUntil=0;
 private disconnectedSince=0;
 private mutedForRoom=false;

 resetRoom(now=Date.now()){
  this.frameSamples=[];
  this.netSamples=[];
  this.activeAlert=null;
  this.roomWarmupUntil=now+ROOM_WARMUP_MS;
  this.disconnectedSince=0;
  this.mutedForRoom=false;
  this.lastAlertAt=0;
 }

 markRoomReady(now=Date.now()){
  this.roomWarmupUntil=Math.max(this.roomWarmupUntil,now+ROOM_WARMUP_MS);
 }

 markHidden(_now=Date.now()){
  this.frameSamples=[];
  this.disconnectedSince=0;
 }

 markShown(now=Date.now()){
  this.frameSamples=[];
  this.resumeWarmupUntil=now+RESUME_WARMUP_MS;
  this.disconnectedSince=0;
 }

 dismissAlert(){
  this.activeAlert=null;
 }

 muteForRoom(){
  this.mutedForRoom=true;
  this.activeAlert=null;
 }

 pruneAlert(now=Date.now()):boolean{
  if(this.activeAlert&&now>this.activeAlert.until){
   this.activeAlert=null;
   return true;
  }
  return false;
 }

 private warmedUp(now:number){
  return now>=this.roomWarmupUntil&&now>=this.resumeWarmupUntil;
 }

 private pushEvent(kind:LagEventKind,title:string,detail:string,peakMs:number,now:number):boolean{
  if(now-this.lastEventByKind[kind]<EVENT_THROTTLE_MS)return false;
  this.lastEventByKind[kind]=now;
  const event:LagEvent={at:now,kind,title,detail,peakMs:Math.round(peakMs)};
  this.events.push(event);
  if(this.events.length>MAX_EVENTS)this.events.shift();
  if(!this.mutedForRoom&&(this.lastAlertAt===0||now-this.lastAlertAt>=ALERT_COOLDOWN_MS)){
   this.lastAlertAt=now;
   this.activeAlert={...event,until:now+ALERT_DURATION_MS};
   return true;
  }
  return false;
 }

 recordFrame(input:{now:number;gapMs:number;drawMs:number;painted:boolean;active:boolean;context?:string}):boolean{
  const {now,gapMs,drawMs,painted,active,context}=input;
  if(!Number.isFinite(gapMs)||gapMs<=0||gapMs>10000||!this.warmedUp(now))return false;
  const safeDraw=Number.isFinite(drawMs)&&drawMs>=0?drawMs:0;
  const slow=(painted&&(gapMs>=110||safeDraw>=70))||gapMs>=180;
  const severe=(painted&&safeDraw>=140)||gapMs>=420;
  this.frameSamples.push({at:now,gapMs,drawMs:safeDraw,painted,slow,severe});
  const cutoff=now-FRAME_WINDOW_MS;
  while(this.frameSamples.length&&this.frameSamples[0].at<cutoff)this.frameSamples.shift();
  if(this.frameSamples.length>360)this.frameSamples.shift();

  if(!active)return false;
  if(!slow&&!severe)return false;

  let slowCount=0,peakGap=0,peakDraw=0;
  for(const s of this.frameSamples){
   if(s.slow)slowCount++;
   if(s.gapMs>peakGap)peakGap=s.gapMs;
   if(s.drawMs>peakDraw)peakDraw=s.drawMs;
  }
  if(severe||slowCount>=3){
   const peak=Math.max(peakGap,peakDraw);
   const cause=peakDraw>=70?'绘制耗时偏高':'画面帧间隔过长';
   const title='检测到画面卡顿（峰值 '+Math.round(peak)+'ms）';
   const detail=cause+' · 帧峰 '+Math.round(peakGap)+'ms / 绘制 '+Math.round(peakDraw)+'ms · 5秒慢帧 '+slowCount+(context?' · '+context:'');
   return this.pushEvent('render',title,detail,peak,now);
  }
  return false;
 }

 recordNetwork(input:{now:number;action:string;ms:number;status:number;active:boolean;context?:string}):boolean{
  const {now,action,ms,status,active,context}=input;
  if(!Number.isFinite(ms)||ms<0)return false;
  const slow=ms>=1800||status===0||status>=500;
  this.netSamples.push({at:now,action,ms,status,slow});
  const peakCutoff=now-RTT_PEAK_WINDOW_MS;
  while(this.netSamples.length&&this.netSamples[0].at<peakCutoff)this.netSamples.shift();
  if(this.netSamples.length>120)this.netSamples.shift();

  if(!active||!this.warmedUp(now)||!slow)return false;
  const netCutoff=now-NET_WINDOW_MS;
  let slowCount=0,peakMs=ms;
  for(const s of this.netSamples){
   if(s.at>=netCutoff&&s.slow){
    slowCount++;
    if(s.ms>peakMs)peakMs=s.ms;
   }
  }
  if(ms>=3500||slowCount>=2){
   const sec=(peakMs/1000).toFixed(1);
   const title=status===0?'检测到网络连接超时（'+sec+'秒）':'检测到网络延迟波动（'+sec+'秒）';
   const detail=action+'='+Math.round(ms)+'ms(status '+status+') · 15秒异常 '+slowCount+' 次'+(context?' · '+context:'');
   return this.pushEvent('network',title,detail,peakMs,now);
  }
  return false;
 }

 recordConnection(input:{now:number;connected:boolean;active:boolean;context?:string}):boolean{
  const {now,connected,active,context}=input;
  if(!active||connected){
   this.disconnectedSince=0;
   return false;
  }
  if(!this.disconnectedSince){
   this.disconnectedSince=now;
   return false;
  }
  const downMs=now-this.disconnectedSince;
  if(this.warmedUp(now)&&downMs>=DISCONNECT_ALERT_MS){
   const sec=(downMs/1000).toFixed(1);
   const title='检测到房间同步中断（'+sec+'秒）';
   const detail='连接已中断 '+sec+' 秒，正在尝试重连'+(context?' · '+context:'');
   return this.pushEvent('reconnect',title,detail,downMs,now);
  }
  return false;
 }

 snapshot(now=Date.now()):LagMetricsSnapshot{
  const frameCutoff=now-FRAME_WINDOW_MS;
  let gapSum=0,gapCount=0,drawSum=0,drawCount=0,peakFrameMs=0,peakDrawMs=0,slowFrames5s=0,severeStalls5s=0;
  for(const s of this.frameSamples){
   if(s.at<frameCutoff)continue;
   gapSum+=s.gapMs;gapCount++;
   if(s.gapMs>peakFrameMs)peakFrameMs=s.gapMs;
   if(s.painted){drawSum+=s.drawMs;drawCount++;if(s.drawMs>peakDrawMs)peakDrawMs=s.drawMs;}
   if(s.slow)slowFrames5s++;
   if(s.severe)severeStalls5s++;
  }
  const fps=gapCount>=3&&gapSum>0?Math.min(120,Math.max(1,Math.round(gapCount*1000/gapSum))):null;
  const avgDrawMs=drawCount>0?drawSum/drawCount:0;

  const netCutoff=now-NET_WINDOW_MS,peakCutoff=now-RTT_PEAK_WINDOW_MS;
  let peakRttMs=0,slowNet15s=0;
  for(const s of this.netSamples){
   if(s.at>=peakCutoff&&s.ms>peakRttMs)peakRttMs=s.ms;
   if(s.at>=netCutoff&&s.slow)slowNet15s++;
  }
  const alert=this.activeAlert&&now<=this.activeAlert.until?this.activeAlert:null;
  return {
   fps,
   avgDrawMs,
   peakDrawMs,
   peakFrameMs,
   slowFrames5s,
   severeStalls5s,
   peakRttMs,
   slowNet15s,
   activeAlert:alert,
   events:this.events,
   mutedForRoom:this.mutedForRoom,
  };
 }
}

/** Compact, privacy-safe device/environment description for diagnostic reports. */
export function deviceEnvironmentSummary(platform:Pick<Platform,'canvas'|'viewport'>|undefined){
 const ua=typeof navigator==='undefined'?'':String(navigator.userAgent||'');
 const android=/Android ([\d.]+)/.exec(ua)?.[1];
 const ios=/OS ([\d_]+) like Mac OS X/.exec(ua)?.[1]?.replace(/_/g,'.');
 const chrome=/Chrome\/([\d.]+)/.exec(ua)?.[1];
 const os=android?'Android '+android:ios?'iOS '+ios:/Windows/.test(ua)?'Windows':/Mac OS X/.test(ua)?'macOS':'未知系统';
 const view=typeof platform?.viewport==='function'?platform.viewport():undefined;
 const canvasW=platform?.canvas?.width??0,canvasH=platform?.canvas?.height??0;
 const parts=[os,chrome?'Chrome '+chrome:''].filter(Boolean);
 if(view)parts.push(`${Math.round(view.width)}×${Math.round(view.height)}@${view.dpr??1}x`);
 if(canvasW&&canvasH)parts.push(`画布${canvasW}×${canvasH}`);
 return parts.join(' · ');
}
