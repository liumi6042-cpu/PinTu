import test from 'node:test';
import assert from 'node:assert/strict';
import {createWebPlatform} from '../mobile/platform-web.ts';

function fixture(t,tap){
 const globals={window:{tap},document:{baseURI:'https://package.test/game/',scripts:[]},location:{href:'https://package.test/game/',origin:'https://package.test'}};
 for(const [key,value]of Object.entries(globals)){const before=Object.getOwnPropertyDescriptor(globalThis,key);Object.defineProperty(globalThis,key,{configurable:true,writable:true,value});t.after(()=>before?Object.defineProperty(globalThis,key,before):delete globalThis[key]);}
 return createWebPlatform({id:'taptap',gameName:'测试',apiBase:'https://game.test/h5-tap-preview',assetBase:'https://game.test/assets'},{style:{}});
}

test('host capability diagnostics report only versions and API presence without acquiring a multiplayer singleton',t=>{
 let acquired=0;const host={getOnlineBattleManager(){acquired++;},getSystemInfoSync:()=>({tapSDKVersion:'2.7.1',version:'2.91.0',model:'private-device',deviceId:'never-retain'})};
 const port=fixture(t,host);assert.deepEqual(port.onlineBattleDiagnostics(),{managerAvailable:true,tapSDKVersion:'2.7.1',clientVersion:'2.91.0'});assert.equal(acquired,0);
});

test('missing capability and unavailable version information remain unknown rather than becoming fabricated versions',t=>{
 const port=fixture(t,{getSystemInfoSync(){throw Error('private error');}});assert.deepEqual(port.onlineBattleDiagnostics(),{managerAvailable:false,tapSDKVersion:undefined,clientVersion:undefined});
});
