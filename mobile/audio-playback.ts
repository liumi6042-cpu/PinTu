import type {AudioLevels} from './ports';

export type AudioVoice={volume:number;play():void|Promise<unknown>;pause():void;rewind():void;dispose():void};
export type MusicSelection=string|readonly string[]|null;
type MusicVoice={voice:AudioVoice;playing:boolean;pending:boolean;resumeRequested:boolean};
type Timers={set(fn:()=>void,ms:number):unknown;clear(id:unknown):void;random():number};
// Effects were quiet next to the host UI (user feedback 2026-10-26): doubled from .1375. Slider level still scales it; music is separate.
const effectVolume=.275;
// A playlist plays one piece, rests in silence, then picks another piece (sandbox-game style ambience).
export const MUSIC_GAP_MS={min:20000,max:45000};
const safely=(action:()=>void)=>{try{action();}catch{}};
const level=(value:number,fallback:number)=>Number.isFinite(value)?Math.max(0,Math.min(1,value)):fallback;
const tracksOf=(selection:MusicSelection)=>(typeof selection==='string'?[selection]:Array.isArray(selection)?selection:[]).filter((url):url is string=>typeof url==='string'&&!!url.trim());
const defaultTimers:Timers={set:(fn,ms)=>setTimeout(fn,ms),clear:id=>clearTimeout(id as ReturnType<typeof setTimeout>),random:()=>Math.random()};

/** Shared playback policy only; hosts supply native audio, never a DOM shim. */
export class AudioPlayback{
 private levels:AudioLevels={music:0,effects:1};
 private tracks:string[]=[];private track=0;private music:MusicVoice|null=null;
 private resting=false;private restTimer:unknown=null;
 private effects=new Map<string,AudioVoice>();
 private unlocked=false;private hidden=false;private adPlaying=false;private disposed=false;
 private createVoice:(url:string,loop:boolean,onEnded?:()=>void)=>AudioVoice;private timers:Timers;
 constructor(createVoice:(url:string,loop:boolean,onEnded?:()=>void)=>AudioVoice,timers:Partial<Timers>={}){this.createVoice=createVoice;this.timers={...defaultTimers,...timers};}
 readonly audio={
  setLevels:(levels:AudioLevels)=>this.setLevels(levels),setMusic:(selection:MusicSelection)=>this.setMusic(selection),
  unlock:()=>this.unlock(),dispose:()=>this.dispose(),
 };
 private get playlist(){return this.tracks.length>1;}
 private mayPlayMusic(){return !this.disposed&&this.unlocked&&!this.hidden&&!this.adPlaying&&!this.resting&&this.tracks.length>0&&this.levels.music>0;}
 private pauseMusic(){const music=this.music;if(!music)return;music.resumeRequested=false;if(music.playing){music.playing=false;safely(()=>music.voice.pause());}}
 private pauseEffects(){for(const voice of this.effects.values())safely(()=>voice.pause());}
 private releaseMusic(){const old=this.music;this.music=null;if(old){old.resumeRequested=false;old.playing=false;safely(()=>old.voice.pause());safely(()=>old.voice.dispose());}}
 private stopRest(){if(this.restTimer!==null)safely(()=>this.timers.clear(this.restTimer));this.restTimer=null;this.resting=false;}
 private finished(voice:AudioVoice){
  if(this.disposed||this.music?.voice!==voice||!this.playlist)return;
  this.releaseMusic();this.resting=true;
  const gap=MUSIC_GAP_MS.min+level(this.timers.random(),0)*(MUSIC_GAP_MS.max-MUSIC_GAP_MS.min);
  this.restTimer=this.timers.set(()=>{this.restTimer=null;this.resting=false;
   const next=Math.floor(level(this.timers.random(),0)*(this.tracks.length-1)*.9999);this.track=next>=this.track?next+1:next;
   this.syncMusic();},gap);
 }
 private syncMusic(){
  if(!this.mayPlayMusic()){this.pauseMusic();return;}
  if(!this.music){
   const url=this.tracks[this.track],loop=!this.playlist;let created:MusicVoice|null=null;
   try{created={voice:this.createVoice(url,loop,loop?undefined:()=>{if(created)this.finished(created.voice);}),playing:false,pending:false,resumeRequested:false};}catch{return;}
   this.music=created;
  }
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
 setMusic(selection:MusicSelection){
  if(this.disposed)return;const next=tracksOf(selection);
  if(next.join('\n')===this.tracks.join('\n'))return;
  this.stopRest();this.releaseMusic();this.tracks=next;
  this.track=next.length>1?Math.min(next.length-1,Math.floor(level(this.timers.random(),0)*next.length)):0;
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
  if(this.disposed)return;this.disposed=true;this.stopRest();this.tracks=[];this.releaseMusic();
  for(const voice of this.effects.values()){safely(()=>voice.pause());safely(()=>voice.dispose());}this.effects.clear();
 }
}
