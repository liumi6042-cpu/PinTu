import {test} from 'node:test';
import assert from 'node:assert/strict';
import {baseHatchProgress,earnedProgress,freshProgress} from '../lib/hatch-feedback.ts';
test('approved tiers and maximum first-time bonuses',()=>{assert.deepEqual([108,300,500,1000].map(baseHatchProgress),[5,10,20,30]);assert.equal(baseHatchProgress(300)+5+5,20);});
test('hatching spends progress without looking like a new reward',()=>{assert.equal(earnedProgress({progress:60,hatched:0}),earnedProgress({progress:10,hatched:1}));assert.equal(earnedProgress({progress:125,hatched:1}),earnedProgress({progress:25,hatched:2}));});
test('first load, navigation, old polls and already shown rewards do not replay',()=>{assert.equal(freshProgress(null,80,0),0);assert.equal(freshProgress(50,80,50,true),0);assert.equal(freshProgress(50,80,80),0);assert.equal(freshProgress(80,70,80),0);assert.equal(freshProgress(50,65,55),10);});
