import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {readSource} from '../source.mjs';
import {createStore} from '../store.mjs';
import {createAdminServer} from '../server.mjs';

test('new source entries preserve saved drafts and edits from an open older browser',async()=>{
 const parent=await realpath(tmpdir()),dataDir=await mkdtemp(join(parent,'jigsaw-import-draft-'));
 const base=readSource(),incoming={...base,assets:[...base.assets],baseline:structuredClone(base.baseline),fingerprint:base.fingerprint+'-new'};
 Object.defineProperty(incoming,'_private',{value:base._private});
 const id='test-new-art-v1',config={title:'新画面',subtitle:'',styleGroupId:'anime',subjectTags:['人物'],targets:{pc:{status:'draft',galleryVisible:false,dailyOnly:false,category:'illustration'},'mobile-shared':{status:'draft',galleryVisible:false,dailyOnly:false,category:'illustration'}}};
 incoming.assets.push({id,lifecycle:'pending'});incoming.baseline.assets[id]=config;
 const store=createStore(dataDir,base),old=store.draft(store.activeDraftId());
 const edited=structuredClone(old.document),first=base.assets[0].id;edited.assets[first].subjectTags=['已经整理'];
 const saved=store.saveDraft(old.id,old.revision,edited,'test');store.close();
 const app=createAdminServer({dataDir,source:incoming});await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
 try{
  const origin='http://127.0.0.1:'+app.server.address().port;
  const setup=await fetch(origin+'/api/setup',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify({username:'local-test',password:'Local-test-1234567890'})});
  assert.equal(setup.status,200);const auth=await setup.json(),cookie=setup.headers.getSetCookie().map(c=>c.split(';')[0]).join('; ');
  const loadResponse=await fetch(origin+'/api/drafts/'+saved.id,{headers:{cookie}});assert.equal(loadResponse.status,200);const loaded=await loadResponse.json();
  assert.equal(loaded.sourceNeedsMerge,true);assert.ok(loaded.document.assets[id]);assert.deepEqual(loaded.document.assets[first].subjectTags,['已经整理']);
  assert.equal(app.store.draft(saved.id).sourceFingerprint,base.fingerprint,'read does not overwrite saved draft');
  const openBrowser=structuredClone(saved.document);openBrowser.assets[first].subjectTags.push('浏览器未保存编辑');
  const response=await fetch(origin+'/api/drafts/'+saved.id,{method:'PUT',headers:{cookie,origin,'content-type':'application/json','x-csrf-token':auth.csrfToken},body:JSON.stringify({revision:saved.revision,document:openBrowser})});
  assert.equal(response.status,200);const result=await response.json();assert.equal(result.sourceFingerprint,incoming.fingerprint);assert.ok(result.document.assets[id]);assert.deepEqual(result.document.assets[first].subjectTags,['已经整理','浏览器未保存编辑']);
  const next=structuredClone(result.document);next.name='新图整理';const copy=app.store.importPendingDraft(result.id,result.revision,next,incoming,'用户要求导入新图');
  assert.notEqual(copy.id,result.id);assert.equal(app.store.draft(result.id).document.name,result.document.name);assert.equal(copy.document.name,'新图整理');
 }finally{await app.close();assert.equal(dirname(await realpath(dataDir)),parent);await rm(dataDir,{recursive:true});}
});
