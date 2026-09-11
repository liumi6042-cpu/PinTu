import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {randomBytes} from 'node:crypto';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {parseEnv} from 'node:util';
import path from 'node:path';

test('local puzzle feedback: screenshot, retry, staff resolution and private result',{skip:process.env.PUZZLE_TEST_FEEDBACK!=='1'},async()=>{
  const root=fileURLToPath(new URL('../',import.meta.url)),env=parseEnv(await readFile(path.join(root,'.env.feedback'),'utf8'));
  assert.equal(env.FEEDBACK_URL,'http://127.0.0.1:3210');
  const project=path.resolve(root,env.FEEDBACK_LOCAL_PROJECT),service=path.join(project,'services/feedback-center');
  const config=JSON.parse(await readFile(path.join(project,'work/feedback-center/config.json'),'utf8'));
  assert.equal(config.host,'127.0.0.1');assert.equal(config.port,3210);
  const password=(await readFile(path.join(project,'work/feedback-center/管理员登录.txt'),'utf8')).match(/^初始密码：(.*)$/m)?.[1];assert.ok(password);
  const sharp=createRequire(pathToFileURL(path.join(service,'package.json')))('sharp');
  const {Store}=await import(pathToFileURL(path.join(service,'store.mjs')));
  const admin='http://localhost:3210',origin='http://localhost:3000',created=[],marker='puzzle-integration-'+randomBytes(12).toString('hex');let adminCookie;
  try{
    const login=await fetch(admin+'/feedback-admin/api/login',{method:'POST',headers:{Origin:admin,'Content-Type':'application/json'},body:JSON.stringify({username:config.adminUsername,password})});
    assert.equal(login.status,200);adminCookie=login.headers.get('set-cookie').split(';')[0];
    const boot=await fetch(origin+'/api/feedback');assert.equal(boot.status,200);assert.equal((await boot.json()).ready,true);
    const guest=boot.headers.get('set-cookie').split(';')[0],idem=randomBytes(24).toString('hex');
    const image=await sharp(randomBytes(600*300*3),{raw:{width:600,height:300,channels:3}}).png().toBuffer();assert.ok(image.length>16384);
    const payload=()=>{const form=new FormData();form.append('payload',JSON.stringify({idem,category:'bug',description:'独立拼图反馈验收 '+marker,email:'',context:{page:'/feedback',language:'zh'}}));form.append('images',new Blob([image],{type:'image/png'}),'check.png');return form;};
    const send=()=>fetch(origin+'/api/feedback',{method:'POST',headers:{Origin:origin,Cookie:guest},body:payload()});
    const response=await send();assert.equal(response.status,201);const receipt=await response.json();created.push(receipt.id);
    const retry=await send();assert.equal(retry.status,201);assert.equal((await retry.json()).id,receipt.id);
    const detailResponse=await fetch(admin+'/feedback-admin/api/items/'+receipt.id,{headers:{Cookie:adminCookie}});assert.equal(detailResponse.status,200);const detail=await detailResponse.json();
    assert.equal(detail.site,'puzzle');assert.equal(detail.attachments.length,1);
    const saved=await fetch(admin+'/feedback-admin/api/items/'+receipt.id,{method:'PATCH',headers:{Origin:admin,Cookie:adminCookie,'Content-Type':'application/json'},body:JSON.stringify({version:detail.version,status:'resolved',message:'已解决，结果查询正常。',note:'PRIVATE-INTEGRATION-NOTE'})});assert.equal(saved.status,200);
    const access=await fetch(origin+'/api/feedback/access',{method:'POST',headers:{Origin:origin,Cookie:guest,'Content-Type':'application/json'},body:JSON.stringify({id:receipt.id,token:receipt.token})});assert.equal(access.status,200);
    const viewer=guest+'; '+access.headers.get('set-cookie').split(';')[0];
    const result=await fetch(origin+'/api/feedback/ticket/'+receipt.id,{headers:{Cookie:viewer}});assert.equal(result.status,200);const user=await result.json();assert.equal(user.status,'resolved');assert.ok(!JSON.stringify(user).includes('PRIVATE-INTEGRATION-NOTE'));
    const picture=await fetch(origin+'/api/feedback/ticket/'+receipt.id+'/'+user.attachments[0].id,{headers:{Cookie:viewer}});assert.equal(picture.status,200);assert.equal(picture.headers.get('content-type'),'image/webp');await picture.arrayBuffer();
    assert.equal((await fetch(admin+'/feedback-admin/api/items')).status,401);
    const rejected=await fetch(origin+'/api/feedback/access',{method:'POST',headers:{Origin:'https://untrusted.invalid',Cookie:guest,'Content-Type':'application/json'},body:JSON.stringify({id:receipt.id,token:receipt.token})});assert.equal(rejected.status,403);
  }finally{
    const store=new Store(config);
    try{for(const id of created){const row=store.db.prepare('SELECT description FROM items WHERE id=?').get(id);if(row?.description.includes(marker))store.erase(id);}}finally{store.close();}
    if(adminCookie)await fetch(admin+'/feedback-admin/api/logout',{method:'POST',headers:{Origin:admin,Cookie:adminCookie}});
  }
});
