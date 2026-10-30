import test from 'node:test';import assert from 'node:assert/strict';import {setTapOrientation} from '../mobile/tap-orientation.ts';
const host=call=>({setDeviceOrientation:call});
test('host success resolves at once',async()=>{let value;await setTapOrientation(host(options=>{value=options.value;options.success();}),'landscape',{timeoutMs:50});assert.equal(value,'landscape');});
test('silent host that turns the screen counts as switched without waiting for the timeout',async()=>{let now='portrait';const started=Date.now();await setTapOrientation(host(()=>{setTimeout(()=>now='landscape',30);}),'landscape',{current:()=>now,timeoutMs:2000,pollMs:10});assert.ok(Date.now()-started<1000);});
test('promise-style host answer resolves',async()=>{await setTapOrientation(host(()=>Promise.resolve()),'portrait',{timeoutMs:50});});
test('fail after the screen already turned is not reported',async()=>{await setTapOrientation(host(options=>options.fail()),'landscape',{current:()=>'landscape',timeoutMs:50});});
test('silent host that never turns rejects with an update hint',async()=>{await assert.rejects(setTapOrientation(host(()=>{}),'landscape',{current:()=>'portrait',timeoutMs:40,pollMs:10}),/更新TapTap/);});
test('missing api and throwing api reject',async()=>{await assert.rejects(setTapOrientation({},'landscape'),/不支持/);await assert.rejects(setTapOrientation(host(()=>{throw Error('x');}),'landscape',{timeoutMs:50}),/没有切换/);});
