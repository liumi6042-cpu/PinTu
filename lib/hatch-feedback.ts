export const HATCH_SOUND_KEY='jigsaw:hatch-sound:v1';
export const HATCH_SOUND_URL='/courtyard/assets/hatch-soft-b-13142e12cef2.wav';
export function baseHatchProgress(band:number){return band>=1000?30:band>=500?20:band>=300?10:5;}
// Keep fractional contributions stable across repeated additions and hatches.
export const roundProgress=(value:number)=>Math.round(value*1000000)/1000000;
export function contributionProgress(reward:number,count:number,total:number){return total>0&&count>0?roundProgress(reward*Math.min(count/total,1)):0;}
export function earnedProgress(s:{progress:number;hatched:number}){return s.progress+(s.hatched>0?50+(s.hatched-1)*100:0);}
export function freshProgress(previous:number|null,total:number,seen:number,silent=false){return previous===null||silent?0:roundProgress(Math.max(0,total-Math.max(previous,seen)));}
export function hatchSoundEnabled(){try{return localStorage.getItem(HATCH_SOUND_KEY)!=='off';}catch{return true;}}
export function masterSoundVolume(){try{const s=JSON.parse(localStorage.getItem('together-puzzle:snap-sound:v1')||'null');return s?.enabled===false?0:typeof s?.volume==='number'?Math.max(0,Math.min(1,s.volume)):.25;}catch{return .25;}}
// Decoded only after a user gesture, never on the drag path. No queued autoplay.
export class HatchAudio{
 private context:AudioContext|null=null;private buffer:AudioBuffer|null=null;private loading=false;private voice:AudioBufferSourceNode|null=null;private closed=false;private last=0;
 unlock(){if(this.closed||!hatchSoundEnabled()||!masterSoundVolume())return;try{this.context??=new AudioContext();void this.context.resume().catch(()=>{});if(!this.buffer&&!this.loading){this.loading=true;void fetch(HATCH_SOUND_URL).then(r=>{if(!r.ok)throw Error();return r.arrayBuffer();}).then(b=>this.context!.decodeAudioData(b)).then(b=>{if(!this.closed)this.buffer=b;}).catch(()=>{}).finally(()=>{this.loading=false;});}}catch{}}
 play(){const ctx=this.context;if(this.closed||document.hidden||!hatchSoundEnabled()||!masterSoundVolume()||!ctx||ctx.state!=='running'||!this.buffer||Date.now()-this.last<1000)return;this.last=Date.now();this.stop();const voice=ctx.createBufferSource(),volume=ctx.createGain();voice.buffer=this.buffer;volume.gain.value=masterSoundVolume();voice.connect(volume);volume.connect(ctx.destination);voice.onended=()=>{voice.disconnect();volume.disconnect();if(this.voice===voice)this.voice=null;};this.voice=voice;voice.start();}
 stop(){try{this.voice?.stop();}catch{}this.voice=null;}
 destroy(){this.closed=true;this.stop();void this.context?.close().catch(()=>{});}
}
