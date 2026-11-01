import test from 'node:test';
import assert from 'node:assert/strict';
import {GameClient} from '../mobile/client.ts';

// A game that stayed open while the server switched 团子去旅行 on (or off) follows the next profile reply;
// before v54.1 only /config at start-up set the capability, so a warm session never showed the nook.
test('tuanziTravel follows the profile after start-up',async()=>{
 let offered;
 const platform={config:{id:'wechat',identityMode:'guest-device',apiBase:'/test'},storage:{get:()=>'c'.repeat(64),set(){},remove(){}},
  request:async input=>({status:200,headers:{},data:input.url.endsWith('/config')?{mobileMode:'mobile-v3-isolated',capabilities:{}}:{level:1,energy:0,energyCap:0,supply:{},...(offered===undefined?{}:{capabilities:{tuanziTravel:offered}})}})};
 const client=new GameClient(platform);await client.start();
 assert.equal(client.config.capabilities.tuanziTravel,false);
 await client.refresh();assert.equal(client.config.capabilities.tuanziTravel,false,'a profile without capabilities changes nothing');
 offered=true;await client.refresh();assert.equal(client.config.capabilities.tuanziTravel,true);
 assert.equal(client.config.capabilities.energy,true,'other capabilities stay');
 offered=false;await client.refresh();assert.equal(client.config.capabilities.tuanziTravel,false,'the kill switch reaches open games too');
});
