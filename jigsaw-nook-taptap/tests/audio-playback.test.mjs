import test from 'node:test';
import assert from 'node:assert/strict';
import {AudioPlayback} from '../mobile/audio-playback.ts';
import {createWebPlatform} from '../mobile/platform-web.ts';
import {createWechatPlatform} from '../mobile/platform-wechat.ts';

const settle=async()=>{for(let n=0;n<20;n++)await Promise.resolve();};
function voiceFactory(play){const voices=[];return {voices,create:(url,loop)=>{const voice={url,loop,volume:1,position:0,plays:0,pauses:0,rewinds:0,disposed:0,play(){this.plays++;return play?.(this);},pause(){this.pauses++;},rewind(){this.rewinds++;this.position=0;},dispose(){this.disposed++;}};voices.push(voice);return voice;}};}
function globals(t,values){for(const [key,value]of Object.entries(values)){const old=Object.getOwnPropertyDescriptor(globalThis,key);Object.defineProperty(globalThis,key,{value,writable:true,configurable:true});t.after(()=>old?Object.defineProperty(globalThis,key,old):delete globalThis[key]);}}

test('music selection is silent until both a volume and user unlock exist; effects retain their original baseline',async()=>{
 const f=voiceFactory(),playback=new AudioPlayback(f.create),audio=playback.audio;
 audio.setMusic('music.mp3');audio.unlock();assert.equal(f.voices.length,0,'default music volume is zero');
 playback.playSound('snap.wav');const effect=f.voices[0];assert.equal(effect.loop,false);assert.equal(effect.volume,.275);assert.equal(effect.rewinds,1);
 audio.setLevels({music:.4,effects:.5});const music=f.voices[1];assert.equal(music.loop,true);assert.equal(music.volume,.4);assert.equal(music.plays,1);assert.equal(effect.volume,.275*.5);
 music.position=27;audio.setMusic('music.mp3');audio.setLevels({music:.7,effects:.5});audio.unlock();assert.equal(f.voices.length,2);assert.equal(music.plays,1);assert.equal(music.position,27);assert.equal(music.rewinds,0);
 playback.playSound('snap.wav');assert.equal(effect.plays,2);assert.equal(effect.rewinds,2);audio.dispose();
});

test('background, ads and mute independently gate music, preserve its position and never resume effects',()=>{
 const f=voiceFactory(),p=new AudioPlayback(f.create);p.audio.setMusic('music.mp3');p.audio.setLevels({music:.3,effects:1});assert.equal(f.voices.length,0);p.audio.unlock();const music=f.voices[0];music.position=31;
 p.playSound('snap.wav');const effect=f.voices[1];p.setAdPlaying(true);assert.equal(music.pauses,1);assert.equal(effect.pauses,1);
 p.setHidden(true);p.setAdPlaying(false);assert.equal(music.plays,1,'finishing an ad in the background must not resume');p.setHidden(false);assert.equal(music.plays,2);assert.equal(music.position,31);assert.equal(effect.plays,1);
 p.setAdPlaying(true);p.audio.setLevels({music:0,effects:0});assert.equal(music.volume,0,'music volume changes even while an ad has paused it');p.setAdPlaying(false);p.setHidden(true);p.setHidden(false);assert.equal(music.plays,2,'zero stays muted across foreground/ad changes');p.playSound('snap.wav');assert.equal(effect.plays,1);
 p.audio.setLevels({music:.5,effects:1});assert.equal(music.plays,3);assert.equal(music.position,31);p.audio.setMusic(null);assert.equal(music.disposed,1);p.setHidden(true);p.setHidden(false);assert.equal(music.plays,3);
 p.audio.dispose();assert.equal(effect.disposed,1);p.audio.setMusic('later.mp3');p.audio.unlock();p.audio.setLevels({music:1,effects:1});p.playSound('later.wav');assert.equal(f.voices.length,2);
});

test('rejected browser play promises are handled without retry loops, and late playback cannot survive hide/dispose',async()=>{
 let resolvePlay;const f=voiceFactory(voice=>voice.url==='reject.mp3'?Promise.reject(Error('autoplay denied')):new Promise(resolve=>{resolvePlay=resolve;})),p=new AudioPlayback(f.create);
 p.audio.setMusic('reject.mp3');p.audio.setLevels({music:.5,effects:1});p.audio.unlock();await settle();assert.equal(f.voices[0].plays,1);p.audio.unlock();await settle();assert.equal(f.voices[0].plays,2,'another explicit gesture may retry');
 p.audio.setMusic('deferred.mp3');const music=f.voices[1];p.setHidden(true);resolvePlay();await settle();assert.ok(music.pauses>=1);assert.equal(music.plays,1);
 p.setHidden(false);assert.equal(music.plays,2);p.audio.dispose();resolvePlay();await settle();assert.equal(music.disposed,1);p.audio.unlock();p.setHidden(false);assert.equal(music.plays,2);
});

test('audio levels clamp independently and a track change releases the old native voice once',()=>{
 const f=voiceFactory(),p=new AudioPlayback(f.create);p.audio.setMusic('one.mp3');p.audio.setLevels({music:2,effects:-1});p.audio.unlock();assert.equal(f.voices[0].volume,1);p.playSound('muted.wav');assert.equal(f.voices.length,1);
 p.audio.setMusic('two.mp3');assert.equal(f.voices[0].disposed,1);assert.equal(f.voices[1].plays,1);p.audio.setLevels({music:NaN,effects:.8});assert.equal(f.voices[1].volume,1);p.playSound('snap.wav');assert.equal(f.voices[2].volume,.275*.8);p.audio.dispose();p.audio.dispose();assert.ok(f.voices.every(voice=>voice.disposed===1));
});

test('a playlist plays each piece once, rests in silence, then picks a different piece',()=>{
 const f=voiceFactory(),timers=[],rolls=[0,.5,.99,0];let cleared=0;
 const p=new AudioPlayback((url,loop,onEnded)=>{const voice=f.create(url,loop);voice.end=onEnded;return voice;},{set:(fn,ms)=>{timers.push({fn,ms});return timers.length;},clear:()=>{cleared++;},random:()=>rolls.shift()??0});
 p.audio.setMusic(['a.mp3','b.mp3','c.mp3']);p.audio.setLevels({music:.5,effects:1});p.audio.unlock();
 const first=f.voices[0];assert.equal(first.url,'a.mp3');assert.equal(first.loop,false);assert.equal(first.plays,1);
 first.end();assert.equal(first.disposed,1);assert.equal(timers.length,1);assert.equal(timers[0].ms,20000+.5*25000);
 p.setHidden(true);timers[0].fn();assert.equal(f.voices.length,1,'the next piece waits for the foreground');
 p.setHidden(false);const second=f.voices[1];assert.equal(second.url,'c.mp3');assert.equal(second.plays,1);
 first.end();assert.equal(timers.length,1,'a stale voice cannot end the current piece');
 p.audio.setLevels({music:0,effects:1});assert.equal(second.pauses,1);p.audio.setLevels({music:.5,effects:1});assert.equal(second.plays,2);
 second.end();assert.equal(timers.length,2);p.audio.setMusic('single.mp3');assert.equal(cleared,1,'changing music cancels the rest');assert.equal(f.voices.at(-1).loop,true);
 p.audio.dispose();timers[1].fn();assert.equal(f.voices.length,3);
});

test('browser adapter resolves bundled music beside game.js and restores it after cancelled/failed ads',async t=>{
 const media=[],events=new EventTarget();let closeAd,failLoad=false;
 class Audio{volume=1;loop=false;currentTime=0;plays=0;pauses=0;loads=0;constructor(src){this.src=src;media.push(this);}play(){this.plays++;return Promise.resolve();}pause(){this.pauses++;}removeAttribute(name){if(name==='src')this.src='';}load(){this.loads++;}}
 const document={baseURI:'https://wrapper.test/boot/',scripts:[{src:'https://package.test/games/game.js'}],hidden:false,addEventListener:events.addEventListener.bind(events),removeEventListener:events.removeEventListener.bind(events)};
 const ad={load:async()=>{if(failLoad)throw Error('no ad');},show:async()=>{if(failLoad)throw Error('not ready');},onClose:fn=>closeAd=fn,offClose(){},onError(){},offError(){}};
 let p,offHide,offShow;t.after(()=>{offHide?.();offShow?.();p?.audio.dispose();});
 globals(t,{document,window:{tap:{createRewardedVideoAd:()=>ad},addEventListener(){},removeEventListener(){}},location:{href:'https://wrapper.test/game',origin:'https://wrapper.test'},Audio});
 p=createWebPlatform({id:'taptap',gameName:'test',apiBase:'https://game.test/h5',assetBase:'https://game.test/assets'},{style:{}});offHide=p.onHide(()=>{});offShow=p.onShow(()=>{});
 p.audio.setMusic('assets/audio/music.mp3');p.audio.setLevels({music:.25,effects:1});p.audio.unlock();await settle();const music=media[0];assert.equal(music.src,'https://package.test/games/assets/audio/music.mp3');assert.equal(music.loop,true);music.currentTime=18;
 p.playSound('assets/audio/mobile-snap.wav');assert.equal(media[1].volume,.275);
 const watching=p.watchAd('tap-unit');assert.equal(music.pauses,1);await settle();closeAd({});assert.equal(await watching,'closed');await settle();assert.equal(music.plays,2);assert.equal(music.currentTime,18);
 failLoad=true;assert.equal(await p.watchAd('tap-unit'),'failed');await settle();assert.equal(music.plays,3);
 document.hidden=true;events.dispatchEvent(new Event('visibilitychange'));assert.ok(music.pauses>=3);document.hidden=false;events.dispatchEvent(new Event('visibilitychange'));await settle();assert.equal(music.plays,4);assert.equal(music.currentTime,18);
 p.audio.dispose();assert.equal(music.loads,1);events.dispatchEvent(new Event('visibilitychange'));assert.equal(music.plays,4);
});

test('WeChat uses native loop audio without DOM and resumes only when foreground, unmuted and unlocked',async t=>{
 const media=[],hooks=new Map();let closeAd,failLoad=false;
 const wx={createCanvas:()=>({}),request(){},createInnerAudioContext(){const sound={volume:1,currentTime:0,plays:0,pauses:0,stops:0,destroys:0,play(){this.plays++;},pause(){this.pauses++;},stop(){this.stops++;this.currentTime=0;},destroy(){this.destroys++;},onError(){},offError(){}};media.push(sound);return sound;},createRewardedVideoAd:()=>({load:async()=>{if(failLoad)throw Error('load failed');},show:async()=>{},onClose:fn=>closeAd=fn,offClose(){},onError(){},offError(){}})};
 for(const name of ['Hide','Show']){wx['on'+name]=fn=>hooks.set(name,fn);wx['off'+name]=fn=>{if(hooks.get(name)===fn)hooks.delete(name);};}
 let p,offHide,offShow;t.after(()=>{offHide?.();offShow?.();p?.audio.dispose();});
 globals(t,{wx,document:undefined,window:undefined,Audio:undefined});
 p=createWechatPlatform({id:'wechat',gameName:'test',apiBase:'https://game.test/h5',assetBase:'https://game.test/assets',rewardedAdUnitId:'adunit-123abc'});offHide=p.onHide(()=>{});offShow=p.onShow(()=>{});
 p.audio.setMusic('assets/audio/music.mp3');p.audio.setLevels({music:.4,effects:.5});assert.equal(media.length,0);p.audio.unlock();const music=media[0];assert.equal(music.src,'assets/audio/music.mp3');assert.equal(music.loop,true);assert.equal(music.volume,.4);music.currentTime=22;
 p.playSound('assets/audio/mobile-snap.wav');assert.equal(media[1].volume,.275*.5);assert.equal(media[1].stops,1);
 const watching=p.watchAd('adunit-123abc');hooks.get('Hide')();await settle();closeAd({});assert.equal(await watching,'closed');assert.equal(music.plays,1);hooks.get('Show')({query:{}});assert.equal(music.plays,2);assert.equal(music.currentTime,22);
 failLoad=true;assert.equal(await p.watchAd('adunit-123abc'),'failed');assert.equal(music.plays,3);p.audio.setLevels({music:0,effects:1});hooks.get('Hide')();hooks.get('Show')({});assert.equal(music.plays,3);
 p.audio.dispose();assert.ok(media.every(sound=>sound.destroys===1));hooks.get('Show')({});p.playSound('late.wav');assert.equal(media.length,2);
});

test('TapTap ad diagnostics preserve failing stage and error code, redact tokens and permit retry on one instance',async t=>{
 let mode='load',destroyed=0,created=0,close;
 const ad=()=>({load:async()=>{if(mode==='load')throw {errCode:1003,errMsg:'内部错误adnCode=12345, adnMsg=trace-placeholder token=private-value code=login-private https://private.test'};},show:async()=>{if(mode==='load')throw {errCode:1004,errMsg:'not ready'};if(mode==='show')throw {errno:2001,adnCode:23456,errMsg:'show denied'};setTimeout(()=>close({isEnded:true}),0);},onClose:fn=>close=fn,offClose(){},onError(){},offError(){},destroy(){destroyed++;}});
 globals(t,{document:{baseURI:'https://wrapper.test/',scripts:[{src:'https://package.test/game.js'}],hidden:false},window:{tap:{createRewardedVideoAd:()=>{created++;return ad();}}},location:{href:'https://wrapper.test/',origin:'https://wrapper.test'}});
 const p=createWebPlatform({id:'taptap',gameName:'test',apiBase:'https://game.test/h5',assetBase:'https://game.test/assets'},{style:{}});
 assert.equal(await p.watchAd('1071218'),'failed');assert.match(p.adDiagnostics(),/推广位:1071218 · 加载失败.*1003.*adnCode:12345/);assert.doesNotMatch(p.adDiagnostics(),/private-value|private.test|login-private/);assert.equal(p.adFailure(),'错误码 1003 内部错误');
 mode='show';assert.equal(await p.watchAd('1071218'),'failed');assert.match(p.adDiagnostics(),/展示失败.*2001.*adnCode:23456/);
 mode='success';assert.equal(await p.watchAd('1071218'),'completed');assert.match(p.adDiagnostics(),/完整观看/);assert.equal(p.adFailure(),'');assert.equal(created,1);assert.equal(destroyed,0);p.audio.dispose();
});
