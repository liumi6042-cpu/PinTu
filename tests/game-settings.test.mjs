import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdirSync,mkdtempSync,renameSync,rmSync,writeFileSync} from 'node:fs';
import {join,resolve,sep} from 'node:path';
import catalog from '../lib/mobile-collection-catalog.json' with {type:'json'};
import {DEFAULT_GAME_SETTINGS,defaultGameSettings,validateGameSettings,buildGameConfiguration,validateGameConfiguration,createGameSettings} from '../server/game-settings.mjs';

test('game settings defaults preserve the existing economy and all decoration identities',()=>{
 const document=defaultGameSettings();assert.deepEqual(document,DEFAULT_GAME_SETTINGS);
 assert.deepEqual(document.progression,{earlyXp:[1,5,10,18,28,40,55,70,90,110],laterXpStep:10,laterXpMaximum:300});
 assert.equal(document.energy.initial,50);assert.equal(document.energy.upgradeRefill,'full');assert.equal(document.energy.naturalRecoveryMinutes,5);
 assert.deepEqual(document.collection,{...catalog.tuning,completionFragmentMinimum:1});
 assert.deepEqual(document.decorations,catalog.decorations.map(item=>({...item,enabled:!['berry-spark','honey-star'].includes(item.id)})));
 assert.deepEqual(document.milestones,catalog.milestones.map(item=>({id:'milestone-'+item.target,...item,albumDecoration:!!item.albumDecoration})));
 assert.equal(Object.isFrozen(DEFAULT_GAME_SETTINGS.decorations[0]),true);
 document.progression.earlyXp[0]=99;assert.equal(DEFAULT_GAME_SETTINGS.progression.earlyXp[0],1);
});

test('game settings reject incompatible rights, invalid bounds and incomplete documents',()=>{
 const mutate=[
  d=>{d.schema='other';},d=>{d.progression.earlyXp.pop();},d=>{d.progression.earlyXp[0]=0;},d=>{d.progression.laterXpMaximum=109;},
  d=>{d.energy.maximumCap=49;},d=>{d.energy.initial=51;},d=>{d.energy.contributionXp=NaN;},d=>{d.energy.contributionCost=1.2;},d=>{d.energy.naturalRecoveryMinutes=-1;},d=>{d.energy.upgradeRefill='bonus';},
  d=>{d.energy.completionPools['48']='10';},d=>{d.collection.completionFragmentMaximum=0;},d=>{d.collection.fragmentContributionStep=0;},
  d=>{d.milestones.push({...d.milestones[0]});},d=>{d.milestones[0].id='';},d=>{d.milestones[1].id=d.milestones[0].id;},d=>{d.decorations[0].source='craft';},d=>{d.decorations[5].albumId='another-album';},
  d=>{d.decorations[1].artKey='remote-image';},d=>{d.decorations[1].color='javascript:bad';},d=>{d.decorations[1].enabled='false';},
  d=>{d.decorations[1].id=d.decorations[0].id;},d=>{d.decorations.pop();},d=>{d.secret='not-public';},
 ];
 for(const change of mutate){const document=defaultGameSettings();change(document);assert.throws(()=>validateGameSettings(document),error=>error.code==='INVALID_GAME_SETTINGS');}
 const document=defaultGameSettings();Object.assign(document.energy,{contributionCost:0,contributionXp:0,naturalRecoveryMinutes:0,firstRoomFree:false,upgradeRefill:'none'});
 document.collection.completionFragmentMinimum=0;document.collection.completionFragmentMaximum=0;document.milestones=[];document.decorations[1].enabled=false;
 assert.deepEqual(validateGameSettings(document),document);
});

test('configuration reloads atomic updates and fails closed for bad configured files',t=>{
 const parent=resolve(import.meta.dirname,'../work');mkdirSync(parent,{recursive:true});const directory=mkdtempSync(join(parent,'qa-game-settings-'));
 t.after(()=>{assert.ok(resolve(directory).startsWith(parent+sep));rmSync(directory,{recursive:true,force:true});});
 const path=join(directory,'configuration.json'),reader=createGameSettings({configurationPath:path});
 const write=document=>{writeFileSync(path+'.new',JSON.stringify(buildGameConfiguration(document)));renameSync(path+'.new',path);};
 assert.throws(()=>reader.read(),error=>error.status===503&&error.code==='GAME_SETTINGS_UNAVAILABLE');
 write(defaultGameSettings());assert.deepEqual(reader.read(),DEFAULT_GAME_SETTINGS);assert.equal(reader.read(),reader.read());
 const changed=defaultGameSettings();changed.energy.upgradeRefill='none';changed.progression.earlyXp[0]=20;write(changed);assert.deepEqual(reader.read(),changed);
 const bad=buildGameConfiguration(changed);bad.energy.contributionCost=99;writeFileSync(path,JSON.stringify(bad));
 assert.throws(()=>validateGameConfiguration(bad),error=>error.code==='INVALID_GAME_SETTINGS');
 assert.throws(()=>reader.read(),error=>error.status===503&&error.code==='GAME_SETTINGS_UNAVAILABLE');
 write(changed);assert.deepEqual(reader.read(),changed);assert.deepEqual(createGameSettings().read(),DEFAULT_GAME_SETTINGS);
});
