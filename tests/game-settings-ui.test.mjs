import test from 'node:test';
import assert from 'node:assert/strict';
import {defaultGameSettings,validateGameSettings} from '../../jigsaw-nook-taptap/server/game-settings.mjs';
import {renderGameSettings,renderGameLevelPreview,readGameSettingsForm,updateGameSettingInput,addGameMilestone,removeGameMilestone} from '../public/game-settings-ui.js';

const form=(section,elements)=>({dataset:{section},elements:elements.map(value=>({disabled:false,type:'number',...value}))});

test('each game settings page merges only its own fields while retaining reward identities and other pending edits',()=>{
 const document=defaultGameSettings();
 document.decorations[1].title='待保存蝴蝶结';
 const grown=readGameSettingsForm(form('growth',[
  {name:'progression.earlyXp.0',value:'12'},
  {name:'energy.firstRoomFree',type:'checkbox',checked:false},
  {name:'energy.naturalRecoveryMinutes',value:'0.25'},
  {name:'energy.upgradeEnergy',value:'99',disabled:true},
  {name:'decorations.1.title',value:'意外表单值',type:'text'}
 ]),document);
 assert.equal(grown.progression.earlyXp[0],12);
 assert.equal(grown.energy.firstRoomFree,false);
 assert.equal(grown.energy.naturalRecoveryMinutes,0.25);
 assert.equal(grown.energy.upgradeEnergy,document.energy.upgradeEnergy);
 assert.equal(grown.decorations[1].title,'待保存蝴蝶结');
 assert.equal(document.progression.earlyXp[0],1,'reading must not mutate the pending document');
 const decorated=readGameSettingsForm(form('decorations',[
  {name:'collection.completionCoinRatio',value:'0.33'},
  {name:'milestones.0.target',value:'4'},
  {name:'milestones.0.albumDecoration',type:'checkbox',checked:true},
  {name:'decorations.1.enabled',type:'checkbox',checked:false},
  {name:'decorations.1.description',type:'textarea',value:''},
  {name:'decorations.1.source',type:'text',value:'default'},
  {name:'energy.initial',value:'1'}
 ]),grown);
 assert.equal(decorated.energy.initial,grown.energy.initial);
 assert.equal(decorated.progression.earlyXp[0],12);
 assert.equal(decorated.collection.completionCoinRatio,0.33);
 assert.equal(decorated.milestones[0].id,'milestone-3');
 assert.equal(decorated.milestones[0].target,4);
 assert.equal(decorated.milestones[0].albumDecoration,true);
 assert.equal(decorated.decorations[1].enabled,false);
 assert.equal(decorated.decorations[1].description,'');
 assert.equal(decorated.decorations[1].source,'craft');
 assert.deepEqual(validateGameSettings(decorated),decorated);
 for(const value of ['','-1','1.5','Infinity'])assert.throws(()=>readGameSettingsForm(form('growth',[{name:'energy.initial',value}]),grown),/非负整数/);
 assert.equal(updateGameSettingInput(grown,'__proto__.polluted','yes'),false);
});

test('preview matches level thresholds; added reward tiers have stable private identities and shared save controls',()=>{
 const document=defaultGameSettings(),preview=renderGameLevelPreview(document);
 assert.match(preview,/<td>7 级<\/td><td>55<\/td><td>157<\/td><td>57<\/td>/);
 assert.match(preview,/<td>8 级<\/td><td>70<\/td><td>227<\/td><td>58<\/td>/);
 const index=addGameMilestone(document),id=document.milestones[index].id;
 assert.match(id,/^milestone-[a-f0-9-]+$/);
 assert.equal(document.milestones[index].target,7);
 updateGameSettingInput(document,'milestones.'+index+'.target','8');
 assert.equal(document.milestones[index].id,id);
 assert.equal(removeGameMilestone(document,Number.NaN),false);
 assert.equal(removeGameMilestone(document,index),true);
 while(document.milestones.length<20)addGameMilestone(document);
 assert.equal(addGameMilestone(document),false);
 for(const section of ['growth','decorations']){
  const html=renderGameSettings({document,section,dirty:true});
  assert.match(html,/id="game-settings-form"/);
  assert.match(html,/id="game-settings-save"/);
  assert.match(html,/保存游戏设置/);
  assert.doesNotMatch(html,/name="decorations\.\d+\.(?:id|source|kind|albumId)"/);
 }
 const decor=renderGameSettings({document,section:'decorations'});
 assert.match(decor,/data-action="add-game-milestone" disabled/);
 assert.match(decor,/name="decorations\.1\.description" maxlength="300"\s+aria-label/);
 assert.match(decor,/name="collection\.completionCoinRatio" type="number" min="0" max="1000"/);
 const growth=renderGameSettings({document,section:'growth'});
 assert.match(growth,/name="energy\.naturalRecoveryMinutes" type="number" min="0" max="10080" step="0.01"/);
 assert.match(growth,/name="energy\.upgradeEnergy"[^>]*disabled/);
});
