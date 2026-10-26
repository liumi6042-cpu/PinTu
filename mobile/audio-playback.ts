import type {AudioLevels} from './ports';

export type AudioVoice={volume:number;play():void|Promise<unknown>;pause():void;rewind():void;dispose():void};
type MusicVoice={voice:AudioVoice;playing:boolean;pending:boolean;resumeRequested:boolean};
// Effects were quiet next to the host UI (user feedback 2026-10-26): doubled from .1375. Slider level still scales it; music is separate.
const effectVolume=.275;
const safely=(action:()=>void)=>{try{action();}catch{}};
const level=(value:number,fallback:number)=>Number.isFinite(value)?Math.max(0,Math.min(1,value)):fallback;

/** Shared playback policy only; hosts supply native audio, never a DOM shim. */
export class AudioPlayback{
 private levels:AudioLevels={music:0,effects:1};
 private selected:string|null=null;private music:MusicVoice|null=null;
 private effects=new Map<string,AudioVoice>();
 private unlocked=false;private hidden=false;private adPlaying=false;private disposed=false;
 private createVoice:(url:string,loop:boolean)=>AudioVoice;
 constructor(createVoice:(url:string,loop:boolean)=>AudioVoice){this.createVoice=createVoice;}
 readonly audio={
  setLevels:(levels:AudioLevels)=>this.setLevels(levels),setMusic:(url:string|null)=>this.setMusic(url),
  unlock:()=>this.unlock(),dispose:()=>this.dispose(),
 };
 private mayPlayMusic(){return !this.disposed&&this.unlocked&&!this.hidden&&!this.adPlaying&&!!this.selected&&this.levels.music>0;}
 private pauseMusic(){const music=this.music;if(!music)return;music.resumeRequested=false;if(music.playing){music.playing=false;safely(()=>music.voice.pause());}}
 private pauseEffects(){for(const voice of this.effects.values())safely(()=>voice.pause());}
 private syncMusic(){
  if(!this.mayPlayMusic()){this.pauseMusic();return;}
  if(!this.music){try{this.music={voice:this.createVoice(this.selected!,true),playing:false,pending:false,resumeRequested:false};}catch{return;}}
  const music=this.music;safely(()=>{music.voice.volume=this.levels.music;});
  if(music.pending){if(!music.playing)music.resumeRequested=true;return;}
  if(music.playing)return;
  music.playing=true;music.pending=true;
  try{
   const result=music.voice.play();
   if(result&&typeof result.then==='function'){
    void Promise.resolve(result).then(()=>{if(this.music!==music||!this.mayPlayMusic()){music.playing=false;safely(()=>music.voice.pause());}},()=>{music.playing=false;}).finally(()=>{
     music.pending=false;const resume=music.resumeRequested;music.resumeRequested=false;
     if(resume&&this.music===music&&this.mayPlayMusic())this.syncMusic();
    });
   }else music.pending=false;
  }catch{music.playing=false;music.pending=false;}
 }
 setLevels(input:AudioLevels){
  if(this.disposed)return;
  this.levels={music:level(input.music,this.levels.music),effects:level(input.effects,this.levels.effects)};
  if(this.music)safely(()=>{this.music!.voice.volume=this.levels.music;});
  for(const voice of this.effects.values())safely(()=>{voice.volume=effectVolume*this.levels.effects;});
  if(this.levels.effects===0)this.pauseEffects();
  this.syncMusic();
 }
 setMusic(url:string|null){
  if(this.disposed)return;const next=typeof url==='string'&&url.trim()?url:null;
  if(this.selected===next)return;
  this.selected=next;const old=this.music;this.music=null;
  if(old){old.resumeRequested=false;old.playing=false;safely(()=>old.voice.pause());safely(()=>old.voice.dispose());}
  this.syncMusic();
 }
 unlock(){if(this.disposed)return;this.unlocked=true;this.syncMusic();}
 setHidden(hidden:boolean){if(this.disposed||this.hidden===hidden)return;this.hidden=hidden;if(hidden)this.pauseEffects();this.syncMusic();}
 setAdPlaying(playing:boolean){if(this.disposed||this.adPlaying===playing)return;this.adPlaying=playing;if(playing)this.pauseEffects();this.syncMusic();}
 playSound(url:string){
  if(this.disposed||this.hidden||this.adPlaying||this.levels.effects<=0||!url)return;
  try{
   let voice=this.effects.get(url);if(!voice){voice=this.createVoice(url,false);this.effects.set(url,voice);}
   voice.volume=effectVolume*this.levels.effects;voice.rewind();const playing=voice.play();
   if(playing&&typeof playing.then==='function'){const current=voice;void Promise.resolve(playing).then(()=>{if(this.disposed||this.hidden||this.adPlaying||this.levels.effects<=0)safely(()=>current.pause());},()=>{});}
  }catch{}
 }
 dispose(){
  if(this.disposed)return;this.disposed=true;this.selected=null;const music=this.music;this.music=null;
  if(music){music.resumeRequested=false;music.playing=false;safely(()=>music.voice.pause());safely(()=>music.voice.dispose());}
  for(const voice of this.effects.values()){safely(()=>voice.pause());safely(()=>voice.dispose());}this.effects.clear();
 }
}
