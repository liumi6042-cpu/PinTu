import test from 'node:test';import assert from 'node:assert/strict';import {isTapPcHost,setTapOrientation} from '../mobile/tap-orientation.ts';
const host=call=>({setDeviceOrientation:call});
test('host success resolves at once',async()=>{let value;await setTapOrientation(host(options=>{value=options.value;options.success();}),'landscape',{stepMs:50});assert.equal(value,'landscape');});
test('silent host that turns the screen counts as switched without waiting for the timeout',async()=>{let now='portrait';const started=Date.now();await setTapOrientation(host(()=>{setTimeout(()=>now='landscape',30);}),'landscape',{current:()=>now,stepMs:2000,pollMs:10});assert.ok(Date.now()-started<1000);});
test('promise-style host answer followed by a turn resolves',async()=>{let now='landscape';await setTapOrientation(host(()=>{now='portrait';return Promise.resolve();}),'portrait',{current:()=>now,stepMs:50});});
test('fail after the screen already turned is not reported',async()=>{await setTapOrientation(host(options=>options.fail()),'landscape',{current:()=>'landscape',stepMs:50});});
test('silent host falls back to common, then to screen lock',async()=>{let now='portrait';const calls=[];
 await setTapOrientation(host(()=>{calls.push('tap');}),'landscape',{current:()=>now,common:{setDeviceOrientation:options=>{calls.push('common');options.fail({errMsg:'setDeviceOrientation:fail no permission'});}},lock:value=>{calls.push('lock:'+value);now='landscape';return Promise.resolve();},stepMs:40,pollMs:5});
 assert.deepEqual(calls,['tap','common','lock:landscape']);});
test('lock alone is used when the host has no orientation api',async()=>{let now='portrait';await setTapOrientation({},'landscape',{current:()=>now,lock:()=>{now='landscape';},stepMs:40,pollMs:5});});
test('every route silent rejects with an update hint and logs a diagnostic',async()=>{const lines=[];let error;
 try{await setTapOrientation(host(()=>{}),'landscape',{current:()=>'portrait',common:{setDeviceOrientation:options=>{options.fail({errCode:12,errMsg:'fail <b>denied</b>'});}},lock:()=>Promise.reject(Object.assign(Error('screen.orientation.lock() is not available'),{name:'NotSupportedError'})),viewport:()=>'390×844',log:line=>lines.push(line),stepMs:30,pollMs:5});}catch(caught){error=caught;}
 assert.equal(error?.message,'旋转失败，请尝试更新或重启TapTap');
 assert.equal(lines.length,1);const line=lines[0];assert.match(line,/^切换方向 landscape 旋转失败，请尝试更新或重启TapTap.*（诊断 /);
 assert.match(line,/tap✓无回应/);assert.match(line,/common✓失败:12 fail bdeniedb /);assert.match(line,/lock✓返回promise拒绝:screen.orientation.lock\(\) is not available/);assert.match(line,/视口390×844）$/);});
test('total wait stays within three steps',async()=>{const started=Date.now(),lines=[];await assert.rejects(setTapOrientation(host(()=>{}),'landscape',{current:()=>'portrait',common:{setDeviceOrientation:()=>{}},lock:()=>new Promise(()=>{}),log:line=>lines.push(line),stepMs:40,pollMs:5}),/旋转失败/);assert.ok(Date.now()-started<400);assert.match(lines[0],/诊断 tap✓无回应 common✓无回应 lock✓返回promise无回应/);});
test('missing api and throwing api reject',async()=>{const lines=[];await assert.rejects(setTapOrientation({},'landscape',{log:line=>lines.push(line)}),/^Error: 当前TapTap不支持旋转，请尝试更新TapTap$/);assert.match(lines[0],/诊断 tap✗ common✗ lock✗/);await assert.rejects(setTapOrientation(host(()=>{throw Error('x');}),'landscape',{stepMs:50,log:line=>lines.push(line)}),/旋转失败/);assert.match(lines[1],/tap✓异常:x/);});

test('TapTap PC host detection never matches a phone',()=>{
 const pcUa='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) TapTapInstantGames/2.16.25 Chrome/130.0.0.0 Electron/33.0.0 Safari/537.36';
 const refused={getSystemInfoSync:()=>({errno:1,errMsg:'bridge:fail invalid request data'})},bridge={tapCustomCommandSync(){}};
 assert.equal(isTapPcHost({host:refused,userAgent:pcUa}),true);
 assert.equal(isTapPcHost({host:refused,userAgent:'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130',bridge}),true);
 assert.equal(isTapPcHost({host:{getSystemInfoSync:()=>({platform:'windows'})}}),true);
 assert.equal(isTapPcHost({host:{getSystemInfoSync:()=>({platform:'mac'})}}),true);
 for(const platform of ['android','ios'])assert.equal(isTapPcHost({host:{getSystemInfoSync:()=>({platform})},userAgent:pcUa,bridge}),false);
 assert.equal(isTapPcHost({host:refused,userAgent:'Mozilla/5.0 (Linux; Android 14; V2309A) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36 TapTap',bridge}),false);
 assert.equal(isTapPcHost({host:refused,userAgent:'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148'}),false);
 assert.equal(isTapPcHost({host:{getSystemInfoSync(){throw Error('不可用');}},userAgent:'Mozilla/5.0 (Linux; Android 14) Mobile'}),false);
 assert.equal(isTapPcHost({}),false);
});
