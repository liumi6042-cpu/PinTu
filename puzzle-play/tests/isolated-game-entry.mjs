import assert from 'node:assert/strict';

// Redirects must be followed through the disposable loopback server, never the live host.
export function isolatedGet(base,headers){return async(path,follow=true)=>{
 for(let redirects=0;redirects<5;redirects++){
  const response=await fetch(base+path,{headers,redirect:'manual',signal:AbortSignal.timeout(10000)});
  if(!follow||![301,302,303,307,308].includes(response.status))return response;
  const target=new URL(response.headers.get('Location'),'https://jigsawnook.online');
  assert.equal(target.origin,'https://jigsawnook.online','redirects must stay on the isolated service');
  path=target.pathname+target.search;await response.arrayBuffer();
 }
 throw Error('Too many isolated redirects');
};}
export async function assertSharedEntry(get,path,expected='/play'){
 const response=await get(path,false);assert.ok([301,302,303,307,308].includes(response.status),path);
 const target=new URL(response.headers.get('Location'),'https://jigsawnook.online');
 assert.equal(target.origin,'https://jigsawnook.online');assert.equal(target.pathname+target.search,expected);await response.arrayBuffer();
 const page=await get(path);assert.equal(page.status,200,path);const html=await page.text();
 assert.ok(html.includes('shared-game-host')&&html.includes('id="game"'),path);
 assert.ok(!html.includes('使用原版大厅')&&!html.includes('返回原版大厅'),path);
}
