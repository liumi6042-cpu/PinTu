import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {randomBytes} from 'node:crypto';

const origin='https://jigsawnook.online',marker='deploy-qa-'+randomBytes(12).toString('hex');
const boot=await fetch(origin+'/api/feedback');assert.equal(boot.status,200);assert.equal((await boot.json()).ready,true);
const guest=boot.headers.getSetCookie()[0].split(';')[0];assert.match(boot.headers.get('set-cookie'),/Secure/);
const catalog=JSON.parse(readFileSync('content/puzzle-catalog.json','utf8'));
const photo=catalog.find(p=>p.status==='published'),picture=readFileSync('public'+photo.thumbSrc);
const idem=randomBytes(24).toString('hex');
const payload=()=>{const f=new FormData();f.append('payload',JSON.stringify({idem,category:'bug',description:'Deployment verification fixture '+marker,email:'',context:{page:'/feedback',language:'en'}}));f.append('images',new Blob([picture],{type:'image/webp'}),'qa.webp');return f;};
const send=()=>fetch(origin+'/api/feedback',{method:'POST',headers:{Origin:origin,Cookie:guest},body:payload()});
const submitted=await send();assert.equal(submitted.status,201);const receipt=await submitted.json();
// Retain exact identifiers privately so failed checks never leave an untraceable fixture.
writeFileSync('work/deploy/feedback-fixture.json',JSON.stringify({id:receipt.id,marker}),{mode:0o600});
const repeated=await send();assert.equal(repeated.status,201);assert.equal((await repeated.json()).id,receipt.id);
const access=await fetch(origin+'/api/feedback/access',{method:'POST',headers:{Origin:origin,Cookie:guest,'Content-Type':'application/json'},body:JSON.stringify({id:receipt.id,token:receipt.token})});assert.equal(access.status,200);
const viewer=guest+'; '+access.headers.getSetCookie()[0].split(';')[0];
const detail=await fetch(origin+'/api/feedback/ticket/'+receipt.id,{headers:{Cookie:viewer}});assert.equal(detail.status,200);const item=await detail.json();assert.equal(item.attachments.length,1);
const image=await fetch(origin+'/api/feedback/ticket/'+receipt.id+'/'+item.attachments[0].id,{headers:{Cookie:viewer}});assert.equal(image.status,200);assert.equal(image.headers.get('content-type'),'image/webp');await image.arrayBuffer();
assert.equal((await fetch(origin+'/api/feedback/ticket/'+receipt.id)).status,403);
assert.equal((await fetch(origin+'/api/feedback/access',{method:'POST',headers:{Origin:'https://untrusted.invalid',Cookie:guest,'Content-Type':'application/json'},body:JSON.stringify({id:receipt.id,token:receipt.token})})).status,403);
console.log('Public HTTPS feedback passed: screenshot, idempotent retry, private receipt, image access and cross-origin denial.');
