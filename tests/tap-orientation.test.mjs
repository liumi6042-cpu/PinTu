import test from 'node:test';import assert from 'node:assert/strict';import {setTapOrientation} from '../mobile/tap-orientation.ts';
const host=call=>({setDeviceOrientation:call});
test('host success resolves at once',async()=>{let value;await setTapOrientation(host(options=>{value=options.value;options.success();}),'landscape',{stepMs:50});assert.equal(value,'landscape');});
test('silent host that turns the screen counts as switched without waiting for the timeout',async()=>{let now='portrait';const started=Date.now();await setTapOrientation(host(()=>{setTimeout(()=>now='landscape',30);}),'landscape',{current:()=>now,stepMs:2000,pollMs:10});assert.ok(Date.now()-started<1000);});
test('promise-style host answer followed by a turn resolves',async()=>{let now='landscape';await setTapOrientation(host(()=>{now='portrait';return Promise.resolve();}),'portrait',{current:()=>now,stepMs:50});});
test('fail after the screen already turned is not reported',async()=>{await setTapOrientation(host(options=>options.fail()),'landscape',{current:()=>'landscape',stepMs:50});});
test('silent host falls back to common, then to screen lock',async()=>{let now='portrait';const calls=[];
 await setTapOrientation(host(()=>{calls.push('tap');}),'landscape',{current:()=>now,common:{setDeviceOrientation:options=>{calls.push('common');options.fail({errMsg:'setDeviceOrientation:fail no permission'});}},lock:value=>{calls.push('lock:'+value);now='landscape';return Promise.resolve();},stepMs:40,pollMs:5});
 assert.deepEqual(calls,['tap','common','lock:landscape']);});
test('lock alone is used when the host has no orientation api',async()=>{let now='portrait';await setTapOrientation({},'landscape',{current:()=>now,lock:()=>{now='landscape';},stepMs:40,pollMs:5});});
test('every route silent rejects with an update hint and a diagnostic',async()=>{const lines=[];let error;
 try{await setTapOrientation(host(()=>{}),'landscape',{current:()=>'portrait',common:{setDeviceOrientation:options=>{options.fail({errCode:12,errMsg:'fail <b>denied</b>'});}},lock:()=>Promise.reject(Object.assign(Error('screen.orientation.lock() is not available'),{name:'NotSupportedError'})),viewport:()=>'390×844',log:line=>lines.push(line),stepMs:30,pollMs:5});}catch(caught){error=caught;}
 assert.match(error?.message??'',/^TapTap没有切换屏幕方向，请更新TapTap后重试（诊断 /);
 assert.match(error.message,/tap✓无回应/);assert.match(error.message,/common✓失败:12 fail bdeniedb /);assert.match(error.message,/lock✓返回promise拒绝:screen.orientation.lock\(\) is not available/);assert.match(error.message,/视口390×844）$/);
 assert.equal(lines.length,1);assert.ok(lines[0].includes(error.message));});
test('total wait stays within three steps',async()=>{const started=Date.now();await assert.rejects(setTapOrientation(host(()=>{}),'landscape',{current:()=>'portrait',common:{setDeviceOrientation:()=>{}},lock:()=>new Promise(()=>{}),stepMs:40,pollMs:5}),/诊断 tap✓无回应 common✓无回应 lock✓返回promise无回应/);assert.ok(Date.now()-started<400);});
test('missing api and throwing api reject',async()=>{await assert.rejects(setTapOrientation({},'landscape'),/不支持.*诊断 tap✗ common✗ lock✗/);await assert.rejects(setTapOrientation(host(()=>{throw Error('x');}),'landscape',{stepMs:50}),/没有切换.*tap✓异常:x/);});
