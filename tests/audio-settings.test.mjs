import test from 'node:test';
import assert from 'node:assert/strict';
import {AudioSettings,AUDIO_SETTINGS_KEY,BACKGROUND_MUSIC,DEFAULT_MUSIC_LEVEL} from '../mobile/audio-settings.ts';

const store=(entries={})=>{const saved=new Map(Object.entries(entries)),calls=[];return {saved,calls,platform:{storage:{get:key=>saved.get(key),set:(key,value)=>saved.set(key,value)},audio:{setLevels:value=>calls.push(['levels',{...value}]),setMusic:url=>calls.push(['music',url]),unlock:()=>calls.push(['unlock'])}}};};

test('the piano playlist starts at half volume and both levels persist without player mutations',()=>{
 const {saved,calls,platform}=store();
 const prefs=new AudioSettings(platform);assert.equal(prefs.hasMusic,true);assert.deepEqual(prefs.levels,{music:DEFAULT_MUSIC_LEVEL,effects:1});assert.deepEqual(calls[1],['music',BACKGROUND_MUSIC]);
 assert.equal(BACKGROUND_MUSIC.length,3);assert.ok(BACKGROUND_MUSIC.every(url=>/^assets\/audio\/bgm-[a-z]+\.mp3$/.test(url)));
 prefs.set('music',.35);prefs.set('effects',0);assert.deepEqual(prefs.levels,{music:.35,effects:0});assert.deepEqual(calls.at(-1),['levels',{music:.35,effects:0}]);
 assert.deepEqual(new AudioSettings(platform).levels,prefs.levels);assert.equal(saved.size,1);assert.ok(saved.has(AUDIO_SETTINGS_KEY));
 const snapshot=prefs.levels;snapshot.effects=1;assert.equal(prefs.levels.effects,0,'callers cannot mutate preferences without saving');
});

test('the old forced-silent music level does not carry over, but the effect level does',()=>{
 const {platform}=store({'jigsaw:shared:audio:v1':'{"music":0,"effects":0.3}'});
 assert.deepEqual(new AudioSettings(platform).levels,{music:DEFAULT_MUSIC_LEVEL,effects:.3});
});

test('WeChat ships without music: no playlist, no slider, music stays zero',()=>{
 const {calls,platform}=store();platform.config={id:'wechat'};
 const prefs=new AudioSettings(platform);assert.equal(prefs.hasMusic,false);assert.deepEqual(calls[1],['music',null]);prefs.set('music',.8);assert.equal(prefs.levels.music,0);
});

test('bad stored values, unavailable storage, and out-of-range levels cannot break game startup',()=>{
 let raw='{"music":9,"effects":"loud"}';const platform={storage:{get:()=>raw,set(){throw Error('no storage');}}};
 let prefs=new AudioSettings(platform);assert.deepEqual(prefs.levels,{music:1,effects:1});prefs.set('music',-2);prefs.set('effects',NaN);assert.deepEqual(prefs.levels,{music:0,effects:1});
 raw='{not json';prefs=new AudioSettings(platform);assert.deepEqual(prefs.levels,{music:DEFAULT_MUSIC_LEVEL,effects:1});
});
