import test from 'node:test';
import assert from 'node:assert/strict';
import {mergeDraft} from '../merge.mjs';

test('source reimport preserves edits, adopts new source fields, and rejects conflicts',()=>{
 const base={name:'草稿',assets:{a:{title:'原题',tags:[]}},styles:[{id:'paper',name:'纸艺'}]};
 const edited=structuredClone(base);edited.assets.a.tags=['动物'];
 const incoming=structuredClone(base);incoming.assets.a.title='源新增标题';incoming.assets.b={title:'新图',tags:[]};
 const result=mergeDraft(base,edited,incoming);
 assert.deepEqual(result.assets.a,{title:'源新增标题',tags:['动物']});assert.equal(result.assets.b.title,'新图');
 assert.deepEqual(base.assets.a,{title:'原题',tags:[]});
 edited.assets.a.title='草稿标题';
 assert.throws(()=>mergeDraft(base,edited,incoming),e=>e.status===409&&e.code==='MERGE_CONFLICT');
});

test('source reimport keeps locally added style groups and prevents competing names',()=>{
 const base={styles:[{id:'paper',name:'纸艺'}]};
 const edited={styles:[{id:'paper',name:'纸艺'},{id:'ink',name:'水墨'}]};
 const incoming={styles:[{id:'paper',name:'纸艺'},{id:'photo',name:'摄影'}]};
 assert.deepEqual(mergeDraft(base,edited,incoming).styles.map(v=>v.id),['paper','photo','ink']);
 edited.styles[0].name='纸艺拼贴';incoming.styles[0].name='手工纸';
 assert.throws(()=>mergeDraft(base,edited,incoming),e=>e.code==='MERGE_CONFLICT');
});

test('reimport retains draft ordering when source edits only entity fields',()=>{
 const base={packs:[{id:'a',v:1},{id:'b',v:1},{id:'c',v:1}]};
 const edited={packs:[{id:'b',v:1},{id:'a',v:1},{id:'c',v:1}]};
 const incoming={packs:[{id:'a',v:2},{id:'b',v:1},{id:'c',v:1}]};
 assert.deepEqual(mergeDraft(base,edited,incoming).packs,[{id:'b',v:1},{id:'a',v:2},{id:'c',v:1}]);
 incoming.packs=[{id:'a',v:2},{id:'c',v:1},{id:'b',v:1}];
 assert.throws(()=>mergeDraft(base,edited,incoming),e=>e.code==='MERGE_CONFLICT');
});
