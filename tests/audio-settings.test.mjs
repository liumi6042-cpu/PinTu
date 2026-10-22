import test from 'node:test';
import assert from 'node:assert/strict';
import {AudioSettings,AUDIO_SETTINGS_KEY,BACKGROUND_MUSIC} from '../mobile/audio-settings.ts';

test('music candidates stay disabled while effect volume persists without player mutations',()=>{
 const saved=new Map(),calls=[];
 const platform={storage:{get:key=>saved.get(key),set:(key,value)=>saved.set(key,value)},audio:{setLevels:value=>calls.push(['levels',{...value}]),setMusic:url=>calls.push(['music',url]),unlock:()=>calls.push(['unlock'])}};
 const prefs=new AudioSettings(platform);assert.deepEqual(prefs.levels,{music:0,effects:1});assert.deepEqual(calls[1],['music',BACKGROUND_MUSIC]);
 assert.equal(BACKGROUND_MUSIC,null);prefs.set('music',.35);prefs.set('effects',0);assert.deepEqual(prefs.levels,{music:0,effects:0});
 assert.deepEqual(new AudioSettings(platform).levels,prefs.levels);assert.equal(saved.size,1);assert.ok(saved.has(AUDIO_SETTINGS_KEY));
 const snapshot=prefs.levels;snapshot.effects=1;assert.equal(prefs.levels.effects,0,'callers cannot mutate preferences without saving');
});

test('bad stored values, unavailable storage, and out-of-range levels cannot break game startup',()=>{
 let raw='{"music":9,"effects":"loud"}';const platform={storage:{get:()=>raw,set(){throw Error('no storage');}}};
 let prefs=new AudioSettings(platform);assert.deepEqual(prefs.levels,{music:0,effects:1});prefs.set('music',-2);prefs.set('effects',NaN);assert.deepEqual(prefs.levels,{music:0,effects:1});
 raw='{not json';prefs=new AudioSettings(platform);assert.deepEqual(prefs.levels,{music:0,effects:1});
});
