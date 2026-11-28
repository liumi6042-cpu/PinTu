import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createMobileService} from '../server/mobile-service.mjs';

function fixture(t){
 let now=Date.parse('2026-11-28T10:00:00Z');
 const dir=mkdtempSync(join(tmpdir(),'tuanzi-v2-')),databasePath=join(dir,'mobile.sqlite');
 const make=()=>createMobileService({now:()=>now,randomInt:min=>min,databasePath});
 let service=make();
 t.after(()=>{service.close();rmSync(dir,{recursive:true,force:true});});
 const owner=randomBytes(32).toString('hex');
 const call=(url,body,method)=>service.handle({identity:owner,url,method:method??(body===undefined?'GET':'POST'),body,artworkSnapshot:true});
 const ok=(url,body,method)=>{const r=call(url,body,method);assert.ok([200,201].includes(r.status),JSON.stringify(r).slice(0,300));return r.data;};
 return {owner,call,ok,restart:()=>{service.close();service=make();},advance:ms=>{now+=ms;}};
}

test('Tuanzi 2.0 state persists across restarts and shares main-game collection wallet coins idempotently',t=>{
 const f=fixture(t);
 const profile=f.ok('/api/mobile/profile');
 assert.equal(profile.capabilities.tuanziTravel,true);

 const init=f.ok('/api/mobile/tuanzi-v2/state');
 assert.equal(init.ok,true);
 assert.equal(init.state,null);
 assert.equal(init.coins,profile.collection.coins);

 // Earn coins from postcard puzzle -> reflects immediately in main-game profile.collection.coins
 const earn1=f.ok('/api/mobile/tuanzi-v2/wallet',{source:'puzzle:cn-hangzhou:24',delta:50});
 assert.equal(earn1.coins,init.coins+50);
 assert.equal(earn1.applied,50);
 assert.equal(earn1.profile.collection.coins,init.coins+50);

 // Replaying the exact same ledger source is idempotent (applied=0, balance unchanged)
 const replay=f.ok('/api/mobile/tuanzi-v2/wallet',{source:'puzzle:cn-hangzhou:24',delta:50});
 assert.equal(replay.coins,init.coins+50);
 assert.equal(replay.applied,0);

 // Spending coins deducts from the exact same main-game wallet
 const spend=f.ok('/api/mobile/tuanzi-v2/wallet',{source:'shop:bento:1',delta:-30});
 assert.equal(spend.coins,init.coins+20);
 assert.equal(spend.applied,-30);

 // Overspending returns 409 COINS_INSUFFICIENT
 const short=f.call('/api/mobile/tuanzi-v2/wallet',{source:'gacha:overspend',delta:-500});
 assert.equal(short.status,409);
 assert.equal(short.data.code,'COINS_INSUFFICIENT');

 // Syncing Tuanzi 2.0 state survives a full server restart
 const saved=f.ok('/api/mobile/tuanzi-v2/sync',{state:{version:4,sceneOverride:'sunset-veranda',chinaCollected:['cn-hangzhou','cn-lhasa']}});
 assert.equal(saved.ok,true);
 f.restart();
 const reloaded=f.ok('/api/mobile/tuanzi-v2/state');
 assert.deepEqual(reloaded.state,{version:4,sceneOverride:'sunset-veranda',chinaCollected:['cn-hangzhou','cn-lhasa']});
 assert.equal(reloaded.coins,init.coins+20);
});
