import test from 'node:test';
import assert from 'node:assert/strict';
import {getLanguage,setLanguage,subscribeLanguage,t,playerName} from '../lib/i18n.ts';
import {PHOTOS,CATEGORIES} from '../lib/puzzle-catalog.ts';
import {LEVELS,createPuzzle} from '../lib/puzzle-engine.ts';
test('switching language translates content and dynamic labels without changing puzzle state or identifiers',()=>{
 const state=createPuzzle('seaside',60,50,7),before=JSON.stringify(state);let updates=0;
 const unsubscribe=subscribeLanguage(()=>updates++);
 try{
  setLanguage('en');assert.equal(getLanguage(),'en');
  for(const photo of PHOTOS){assert.ok(!/[\u3400-\u9fff]/.test(t(photo.title)));assert.ok(!/[\u3400-\u9fff]/.test(t(photo.subtitle)));assert.equal(t(photo.id),photo.id);}
  for(const category of CATEGORIES)assert.ok(!/[\u3400-\u9fff]/.test(t(category)));
  for(const level of LEVELS)assert.ok(!/[\u3400-\u9fff]/.test(t(`${level.count.toLocaleString()} 片 · ${level.label}`)));
  for(const text of ['正在铺开 3,000 片拼图…','已拼 32 / 3000 片 · 01:23','珊瑚秘境完成效果预览','拉一下，开始拼，向下拉或点击','已完成','拼对了！已归位 3 / 12 片'])assert.ok(!/[\u3400-\u9fff]/.test(t(text)),text);
  assert.equal(playerName('游客 A123'),'Guest A123');assert.equal(playerName('公开大厅'),'公开大厅');
  assert.equal(t(state),state);assert.equal(JSON.stringify(state),before);
  setLanguage('en');assert.equal(updates,1);setLanguage('zh');assert.equal(t('公开大厅'),'公开大厅');assert.equal(updates,2);
 }finally{unsubscribe();setLanguage('zh');}
});
