import type {AudioLevels,Platform} from './ports';

// Original piano pieces (content/music/bgm). They play in turn with quiet gaps between them.
export const BACKGROUND_MUSIC:readonly string[]=['assets/audio/bgm-morning.mp3','assets/audio/bgm-rain.mp3','assets/audio/bgm-starlight.mp3'];
export const AUDIO_SETTINGS_KEY='jigsaw:shared:audio:v2';
// v1 forced music to zero, so only its effect level carries over.
const LEGACY_AUDIO_SETTINGS_KEY='jigsaw:shared:audio:v1';
export const DEFAULT_MUSIC_LEVEL=.5;
const level=(value:unknown,fallback:number)=>typeof value==='number'&&Number.isFinite(value)?Math.round(Math.max(0,Math.min(1,value))*100)/100:fallback;
const read=(platform:Platform,key:string)=>{try{return JSON.parse(platform.storage.get(key)||'null');}catch{return null;}};
/** Device-local preferences never change an account, wallet or room. */
export class AudioSettings{
 private value:AudioLevels={music:DEFAULT_MUSIC_LEVEL,effects:1};
 private platform:Platform;
 /** The WeChat package is size-capped and ships without music. */
 readonly hasMusic:boolean;
 constructor(platform:Platform){
  this.platform=platform;this.hasMusic=platform.config?.id!=='wechat';
  const saved=read(platform,AUDIO_SETTINGS_KEY),legacy=saved?null:read(platform,LEGACY_AUDIO_SETTINGS_KEY);
  this.value={music:this.hasMusic?level(saved?.music,DEFAULT_MUSIC_LEVEL):0,effects:level((saved??legacy)?.effects,1)};
  platform.audio?.setLevels(this.value);platform.audio?.setMusic(this.hasMusic?BACKGROUND_MUSIC:null);
 }
 get levels():Readonly<AudioLevels>{return {...this.value};}
 set(kind:keyof AudioLevels,value:number){this.value={...this.value,[kind]:kind==='music'&&!this.hasMusic?0:level(value,this.value[kind])};this.platform.audio?.setLevels(this.value);try{this.platform.storage.set(AUDIO_SETTINGS_KEY,JSON.stringify(this.value));}catch{}}
}
