import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { PHOTOS, RETIRED_PHOTO_IDS } from '../lib/puzzle-catalog.ts';

const base=process.env.PUZZLE_TEST_URL||'http://localhost:3000';
test('local server serves only catalogued originals and creates rooms for replacement artwork',{skip:process.env.PUZZLE_TEST_LOCAL!=='1'},async()=>{
  for(const photo of PHOTOS){
    const response=await fetch(base+photo.src);assert.equal(response.status,200);
    assert.match(response.headers.get('content-type'),/image\/png/);
    const bytes=Buffer.from(await response.arrayBuffer());
    const record=JSON.parse(await readFile(new URL('../content/image-provenance/'+photo.id+'.json',import.meta.url),'utf8'));
    assert.equal(createHash('sha256').update(bytes).digest('hex'),record.sha256);
  }
  for(const id of RETIRED_PHOTO_IDS){
    assert.equal((await fetch(base+'/puzzles/'+id+'.jpg')).status,404);
    const response=await fetch(base+'/api/rooms',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({imageId:id,pieces:12,name:'旧图校验'})});
    assert.equal(response.status,400);
  }
  const response=await fetch(base+'/api/rooms',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({imageId:'skate-garden',pieces:5000,name:'生成图校验'})});
  assert.equal(response.status,201);
  const created=await response.json(),path=base+'/api/rooms/'+created.room.id;
  try{
    const saved=await fetch(path,{headers:{Authorization:'Bearer '+created.token}});
    assert.equal(saved.status,200);
    const room=await saved.json();
    assert.equal(room.puzzle.imageId,'skate-garden');
    assert.equal(room.puzzle.cols*room.puzzle.rows,5000);
  }finally{
    await fetch(path,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+created.token},body:JSON.stringify({type:'leave'})});
  }
});
