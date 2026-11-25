import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import promises from 'node:fs/promises';
import {resolve} from 'node:path';
import {withReleaseCleanup} from '../scripts/release-cleanup.mjs';

function fixture(t){
  const parent=resolve('work/release-cleanup-tests');fs.mkdirSync(parent,{recursive:true});
  const root=fs.mkdtempSync(resolve(parent,'fixture-'));
  t.after(()=>promises.rm(root,{recursive:true,force:true}));
  const receipt=()=>{
    const folder=resolve(root,'work/release-cleanup');
    return JSON.parse(fs.readFileSync(resolve(folder,fs.readdirSync(folder).find(name=>name.endsWith('.json'))),'utf8'));
  };
  return {root,receipt};
}

test('only this invocation outputs are removed; previous directories and archives stay intact',async t=>{
  const {root,receipt}=fixture(t),previous=resolve(root,'releases/staging-previous'),archive=resolve(root,'releases/latest.tar.gz');
  fs.mkdirSync(previous,{recursive:true});fs.writeFileSync(archive,'retained package');
  const {value,cleanup}=await withReleaseCleanup(root,attempt=>{
    const build=attempt.buildDirectory(),stage=attempt.stageDirectory();
    fs.mkdirSync(build);fs.writeFileSync(resolve(build,'output'),'small fixture');
    fs.writeFileSync(resolve(stage,'release.json'),'{}');
    return 'verified';
  });
  assert.equal(value,'verified');assert.equal(cleanup.ok,true);
  assert.equal(fs.existsSync(previous),true);assert.equal(fs.readFileSync(archive,'utf8'),'retained package');
  assert.deepEqual(receipt().residualPaths,[]);assert.equal(receipt().directories.length,2);
});

test('an early build failure still cleans its partial output and preserves original diagnostics',async t=>{
  const {root,receipt}=fixture(t),original=new Error('compiler failed');let build;
  await assert.rejects(()=>withReleaseCleanup(root,attempt=>{
    build=attempt.buildDirectory();fs.mkdirSync(build);fs.writeFileSync(resolve(build,'partial'),'partial');throw original;
  }),error=>error===original);
  assert.equal(fs.existsSync(build),false);assert.equal(receipt().operation,'failed');
  assert.equal(receipt().error.message,'compiler failed');assert.equal(receipt().ok,true);
});

test('one cleanup failure cannot prevent other outputs being cleaned and cannot report success',async t=>{
  const {root,receipt}=fixture(t),remove=promises.rm;let build,stage;
  const mock=t.mock.method(promises,'rm',async (path,options)=>{
    if(path===stage)throw Object.assign(new Error('file in use'),{code:'EBUSY'});
    return remove(path,options);
  });
  try{
    await assert.rejects(()=>withReleaseCleanup(root,attempt=>{
      build=attempt.buildDirectory();fs.mkdirSync(build);stage=attempt.stageDirectory();return 'verified';
    }),/cleanup incomplete/);
    assert.equal(fs.existsSync(build),false);assert.equal(fs.existsSync(stage),true);
    assert.equal(receipt().ok,false);assert.deepEqual(receipt().residualPaths,[stage]);
    assert.equal(receipt().directories.find(item=>item.path===stage).error.code,'EBUSY');
  }finally{mock.mock.restore();}
});

test('silent no-op deletion is detected as a residual instead of a successful release',async t=>{
  const {root,receipt}=fixture(t),mock=t.mock.method(promises,'rm',async ()=>{});
  try{
    await assert.rejects(()=>withReleaseCleanup(root,attempt=>{attempt.stageDirectory();}),/cleanup incomplete/);
    assert.equal(receipt().ok,false);assert.equal(receipt().residualPaths.length,1);
    assert.match(receipt().directories[0].error.message,/still exists/);
  }finally{mock.mock.restore();}
});

test('a junction output parent is refused without touching its external target',async t=>{
  const {root}=fixture(t),outside=resolve(root,'retained'),marker=resolve(outside,'marker');
  fs.mkdirSync(outside);fs.writeFileSync(marker,'keep');
  fs.symlinkSync(outside,resolve(root,'releases'),process.platform==='win32'?'junction':'dir');
  await assert.rejects(()=>withReleaseCleanup(root,attempt=>attempt.stageDirectory()),/Linked release output refused/);
  assert.equal(fs.readFileSync(marker,'utf8'),'keep');
});

test('isolated source cleanup unlinks dependency junctions without traversing their target',async t=>{
  const {root,receipt}=fixture(t),dependencies=resolve(root,'retained-dependencies');
  fs.mkdirSync(dependencies);fs.writeFileSync(resolve(dependencies,'marker'),'keep');let source;
  await withReleaseCleanup(root,attempt=>{
    source=attempt.sourceDirectory();
    fs.symlinkSync(dependencies,resolve(source,'node_modules'),process.platform==='win32'?'junction':'dir');
  });
  assert.equal(fs.existsSync(source),false);
  assert.equal(fs.readFileSync(resolve(dependencies,'marker'),'utf8'),'keep');
  assert.equal(receipt().directories[0].role,'source');
});
