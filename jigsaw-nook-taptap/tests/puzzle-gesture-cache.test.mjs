import test from 'node:test';
import assert from 'node:assert/strict';
import { gestureFrameSample } from '../lib/puzzle-gesture-cache.ts';

const close=(actual,expected)=>assert.ok(Math.abs(actual-expected)<1e-6,`${actual} should equal ${expected}`);

test('gesture cache samples panning from an overscanned frame without a redraw',()=>{
  const frame={camera:{x:142,y:112,z:.85},width:520,height:930};
  const sample=gestureFrameSample(frame,{x:72,y:32,z:.85},390,800);
  assert.ok(sample);
  close(sample.x,70);close(sample.y,80);close(sample.width,390);close(sample.height,800);
});

test('gesture cache covers the mobile 79 to 95 percent zoom band',()=>{
  const frame={camera:{x:85,y:85,z:.85},width:560,height:970};
  for(const zoom of [.79,.85,.95]){
    const sample=gestureFrameSample(frame,{x:0,y:0,z:zoom},390,800);
    assert.ok(sample,`${Math.round(zoom*100)}% stays inside the cached frame`);
    close(sample.width,390*.85/zoom);
    close(sample.height,800*.85/zoom);
  }
});

test('gesture cache asks for one new frame only after the overscan is exhausted',()=>{
  const frame={camera:{x:70,y:70,z:.85},width:530,height:940};
  assert.ok(gestureFrameSample(frame,{x:55,y:35,z:.85},390,800));
  assert.equal(gestureFrameSample(frame,{x:180,y:35,z:.85},390,800),null);
});
