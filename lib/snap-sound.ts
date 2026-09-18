import { DOUBLE_CLICK_PCM16,DOUBLE_CLICK_SAMPLE_RATE } from './double-click-data';

export const SNAP_SOUND_KEY='together-puzzle:snap-sound:v1';
export const SOUND_MERGE_MS=180;
export type SoundSource='local'|'teammate';
export type SoundPreferences={enabled:boolean;teammates:boolean;volume:number};
export const DEFAULT_SOUND:SoundPreferences={enabled:true,teammates:true,volume:.25};
export function soundPreferences(raw:string|null):SoundPreferences{
 try{const value=JSON.parse(raw||'null');if(!value||typeof value.enabled!=='boolean'||typeof value.volume!=='number'||!Number.isFinite(value.volume))return {...DEFAULT_SOUND};return {enabled:value.enabled,teammates:typeof value.teammates==='boolean'?value.teammates:true,volume:Math.max(0,Math.min(1,value.volume))};}catch{return {...DEFAULT_SOUND};}
}
// Exact PCM from the chosen C audition, decoded once when audio is enabled.
// Keep the source sample rate; AudioContext resamples for the output device.
export function doubleClickSamples(variant:number){
 const bytes=atob(DOUBLE_CLICK_PCM16[variant%DOUBLE_CLICK_PCM16.length]),samples=new Float32Array(bytes.length/2);
 for(let i=0;i<samples.length;i++){const word=bytes.charCodeAt(i*2)|(bytes.charCodeAt(i*2+1)<<8);samples[i]=(word>=32768?word-65536:word)/32768;}
 return samples;
}
export class SnapSound{
 private context:AudioContext|null=null;private gain:GainNode|null=null;private buffers:AudioBuffer[]=[];private voice:AudioBufferSourceNode|null=null;
 private settings={...DEFAULT_SOUND};private last=-Infinity;private variant=0;private disposed=false;
 setPreferences(value:SoundPreferences){this.settings={...value};if(this.gain&&this.context)this.gain.gain.setValueAtTime(value.enabled?value.volume*.55:0,this.context.currentTime);if(!value.enabled)this.stop();}
 async unlock(){
  if(this.disposed||!this.settings.enabled)return;
  try{if(!this.context){this.context=new AudioContext();this.gain=this.context.createGain();this.gain.gain.value=this.settings.volume*.55;this.gain.connect(this.context.destination);
   this.buffers=Array.from({length:4},(_,variant)=>{const samples=doubleClickSamples(variant),buffer=this.context!.createBuffer(1,samples.length,DOUBLE_CLICK_SAMPLE_RATE);buffer.getChannelData(0).set(samples);return buffer;});}
   if(this.context.state==='suspended')await this.context.resume();
  }catch{/* A browser without audio can still play normally. */}
 }
 async play(source:SoundSource='local'){
  const requested=performance.now();if(this.disposed||!this.settings.enabled||(source==='teammate'&&!this.settings.teammates)||!this.settings.volume||document.hidden||requested-this.last<SOUND_MERGE_MS)return;
  this.last=requested;await this.unlock();
  const context=this.context;if(this.disposed||!this.settings.enabled||document.hidden||!context||context.state!=='running'||performance.now()-requested>SOUND_MERGE_MS)return;
  try{this.stop();const voice=context.createBufferSource();voice.buffer=this.buffers[this.variant++%this.buffers.length];voice.connect(this.gain!);voice.onended=()=>{voice.disconnect();if(this.voice===voice)this.voice=null;};this.voice=voice;voice.start();}catch{/* Optional feedback never interrupts a drop. */}
 }
 private stop(){if(this.voice){this.voice.onended=null;try{this.voice.stop();}catch{}this.voice.disconnect();this.voice=null;}}
 destroy(){this.disposed=true;this.stop();this.gain?.disconnect();this.buffers=[];void this.context?.close().catch(()=>{});}
}
