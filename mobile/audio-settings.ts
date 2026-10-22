import type {AudioLevels,Platform} from './ports';

// Music candidates are archived for later review, not shipped or played.
export const BACKGROUND_MUSIC=null;
export const AUDIO_SETTINGS_KEY='jigsaw:shared:audio:v1';
const level=(value:unknown,fallback:number)=>typeof value==='number'&&Number.isFinite(value)?Math.round(Math.max(0,Math.min(1,value))*100)/100:fallback;
/** Device-local preferences never change an account, wallet or room. */
export class AudioSettings{
 private value:AudioLevels={music:0,effects:1};
 private platform:Platform;
 constructor(platform:Platform){
  this.platform=platform;
  try{const saved=JSON.parse(platform.storage.get(AUDIO_SETTINGS_KEY)||'null');this.value={music:0,effects:level(saved?.effects,1)};}catch{}
  platform.audio?.setLevels(this.value);platform.audio?.setMusic(BACKGROUND_MUSIC);
 }
 get levels():Readonly<AudioLevels>{return {...this.value};}
 set(kind:keyof AudioLevels,value:number){this.value={...this.value,[kind]:kind==='music'?0:level(value,this.value[kind])};this.platform.audio?.setLevels(this.value);try{this.platform.storage.set(AUDIO_SETTINGS_KEY,JSON.stringify(this.value));}catch{}}
}
