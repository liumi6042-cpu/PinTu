export const SNAP_SOUND_KEY='together-puzzle:snap-sound:v1';
export const SOUND_MERGE_MS=180;
export type SoundPreferences={enabled:boolean;volume:number};
export const DEFAULT_SOUND:SoundPreferences={enabled:false,volume:.25};
export function soundPreferences(raw:string|null):SoundPreferences{
 try{const value=JSON.parse(raw||'null');if(!value||typeof value.enabled!=='boolean'||typeof value.volume!=='number'||!Number.isFinite(value.volume))return {...DEFAULT_SOUND};return {enabled:value.enabled,volume:Math.max(0,Math.min(1,value.volume))};}catch{return {...DEFAULT_SOUND};}
}
// Original, dry filtered-noise transients: no downloaded recording or ringing tone.
export function cardboardSamples(sampleRate:number,variant:number){
 const length=Math.ceil(sampleRate*(.075+variant*.003)),samples=new Float32Array(length);let seed=9187+variant*13007,fast=0,slow=0;
 for(let i=0;i<length;i++){
  seed=(Math.imul(seed,1664525)+1013904223)>>>0;const noise=seed/4294967296*2-1;
  fast+=(.16+variant*.014)*(noise-fast);slow+=.022*(noise-slow);
  const time=i/sampleRate,attack=Math.min(1,time/.0015),tail=Math.max(0,1-i/(length-1));
  samples[i]=(fast-slow)*attack*Math.exp(-time/(.012+variant*.001))*tail*1.35;
 }
 return samples;
}
export class SnapSound{
 private context:AudioContext|null=null;private gain:GainNode|null=null;private buffers:AudioBuffer[]=[];private voice:AudioBufferSourceNode|null=null;
 private settings={...DEFAULT_SOUND};private last=-Infinity;private variant=0;private disposed=false;
 setPreferences(value:SoundPreferences){this.settings={...value};if(this.gain&&this.context)this.gain.gain.setValueAtTime(value.enabled?value.volume*.55:0,this.context.currentTime);if(!value.enabled)this.stop();}
 async unlock(){
  if(this.disposed||!this.settings.enabled)return;
  try{if(!this.context){this.context=new AudioContext();this.gain=this.context.createGain();this.gain.gain.value=this.settings.volume*.55;this.gain.connect(this.context.destination);
   this.buffers=Array.from({length:4},(_,variant)=>{const samples=cardboardSamples(this.context!.sampleRate,variant),buffer=this.context!.createBuffer(1,samples.length,this.context!.sampleRate);buffer.getChannelData(0).set(samples);return buffer;});}
   if(this.context.state==='suspended')await this.context.resume();
  }catch{/* A browser without audio can still play normally. */}
 }
 async play(){
  const requested=performance.now();if(this.disposed||!this.settings.enabled||!this.settings.volume||document.hidden||requested-this.last<SOUND_MERGE_MS)return;
  this.last=requested;await this.unlock();
  const context=this.context;if(this.disposed||!this.settings.enabled||document.hidden||!context||context.state!=='running'||performance.now()-requested>SOUND_MERGE_MS)return;
  try{this.stop();const voice=context.createBufferSource();voice.buffer=this.buffers[this.variant++%this.buffers.length];voice.connect(this.gain!);voice.onended=()=>{voice.disconnect();if(this.voice===voice)this.voice=null;};this.voice=voice;voice.start();}catch{/* Optional feedback never interrupts a drop. */}
 }
 private stop(){if(this.voice){this.voice.onended=null;try{this.voice.stop();}catch{}this.voice.disconnect();this.voice=null;}}
 destroy(){this.disposed=true;this.stop();this.gain?.disconnect();this.buffers=[];void this.context?.close().catch(()=>{});}
}
