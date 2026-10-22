import assert from 'node:assert/strict';import {mkdirSync,writeFileSync} from 'node:fs';import {resolve} from 'node:path';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'file:///C:/Users/Administrator/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs');
const base=process.env.MOBILE_TEST_BASE||'http://127.0.0.1:3211/',out=resolve('outputs/mobile-v3-qa');mkdirSync(out,{recursive:true});
const browser=await chromium.launch({channel:'msedge',headless:true}),context=await browser.newContext(),page=await context.newPage(),checks=[],errors=[];page.on('pageerror',e=>errors.push(String(e)));
try{
 await page.addInitScript(()=>{window.tap={};localStorage.setItem('jigsaw:h5-display-mode','portrait');});
 for(const [width,height] of [[320,568],[568,320],[390,844],[844,390]]){
  await page.setViewportSize({width,height});
  for(const route of ['lobby','gallery','supplies']){
   await page.goto(base+'#/zh/'+route);await page.waitForFunction(()=>document.querySelector('.mobile-app')&&document.documentElement.dataset.h5Host==='taptap'&&!document.body.textContent.includes('正在连接手机版'));
   if(route==='gallery')await page.locator('.mobile-photo-card').first().waitFor();else await page.locator('.mobile-player[aria-label*="等级"]').waitFor();
   const sizes=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth,dock:[...document.querySelectorAll('.mobile-create-dock,.mobile-create-dock>.mobile-button,.mobile-create-options')].map(e=>{const r=e.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom};}),store:(()=>{const r=document.querySelector('.mobile-store-entry')?.getBoundingClientRect();return r?{top:r.top,right:r.right,bottom:r.bottom}:null;})()}));
   assert.ok(sizes.scroll<=width+1,`${route} ${width} overflows: ${sizes.scroll}`);
   assert.ok(sizes.dock.every(r=>r.left>=-1&&r.right<=width+1&&r.bottom<=height+1),`${route} ${width} dock overflows`);
   if(route==='lobby'&&width===568)assert.ok(sizes.store.top>=44,'small Tap landscape capsule overlaps supply entry');
   if(route==='lobby'&&width===390){await page.locator('.mobile-player').click();const select=page.getByLabel('屏幕方向',{exact:true});assert.equal(await select.inputValue(),'auto');await page.getByRole('button',{name:'关闭',exact:true}).click();checks.push('legacy orientation preference ignored; explicit auto/portrait/landscape control available');}
   await page.screenshot({path:resolve(out,`taptap-${route}-${width}x${height}.png`)});checks.push(`${route} ${width}x${height} Tap safe area and dock bounds`);
  }
 }
 assert.deepEqual(errors,[]);writeFileSync(resolve(out,'responsive-report.json'),JSON.stringify({checks,errors},null,2));console.log(JSON.stringify({passed:checks.length,checks},null,2));
}finally{await browser.close();}
