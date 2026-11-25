import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {chromium} from 'file:///C:/Users/Administrator/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs';
import assert from 'node:assert/strict';
const output=resolve(process.env.MOBILE_TASKS_TEST_OUTPUT||'docs/verification/mobile-tasks-v8');mkdirSync(output,{recursive:true});
const browser=await chromium.launch({channel:'msedge',headless:true});
const results=[];
try{
 for(const [width,height] of [[320,740],[390,844],[844,390]]){
  const context=await browser.newContext({viewport:{width,height},deviceScaleFactor:2,isMobile:true,hasTouch:true});const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(process.env.MOBILE_TEST_URL||'http://127.0.0.1:3211/#/zh/lobby');
  await page.getByRole('button',{name:/任务与礼包，/}).screenshot({path:resolve(output,`tasks-entry-${width}.png`)});
  await page.getByRole('button',{name:/任务与礼包，/}).click();
  await page.getByRole('heading',{name:'今日伙伴任务'}).waitFor();
  const geometry=await page.evaluate(()=>{const panel=document.querySelector('.mobile-tasks-panel'),sheet=panel.closest('dialog'),cards=[...panel.querySelectorAll('.mobile-task-card')];return{viewport:{width:innerWidth,height:innerHeight},sheet:{left:sheet.getBoundingClientRect().left,right:sheet.getBoundingClientRect().right,top:sheet.getBoundingClientRect().top,bottom:sheet.getBoundingClientRect().bottom,width:sheet.clientWidth,scrollWidth:sheet.scrollWidth},cards:cards.map(card=>({client:card.clientWidth,scroll:card.scrollWidth})),tabs:[...panel.querySelectorAll('[role=tab]')].map(node=>({width:node.getBoundingClientRect().width,height:node.getBoundingClientRect().height})),link:panel.querySelector('input[aria-label="邀请链接"]').value};});
  assert(geometry.sheet.left>=-1&&geometry.sheet.right<=width+1,'sheet stays within viewport');assert(geometry.sheet.top>=-1&&geometry.sheet.bottom<=height+1,'sheet fits height');assert(geometry.sheet.scrollWidth<=geometry.sheet.width+1,'no horizontal sheet overflow');assert(geometry.cards.every(x=>x.scroll<=x.client+1),'task cards do not overflow');assert(geometry.tabs.every(x=>x.width>=44&&x.height>=44),'tabs touch targets >= 44px');assert(geometry.link.includes('#/zh/lobby?ref='),'share link carries ref on mobile lobby');
  await page.screenshot({path:resolve(output,`tasks-${width}.png`)});
  await page.getByRole('tab',{name:/礼包/}).click();await page.getByText('礼包正在路上',{exact:true}).waitFor();await page.screenshot({path:resolve(output,`gifts-empty-${width}.png`)});
  if(width===390){await page.getByRole('tab',{name:'任务',exact:true}).click();await page.getByRole('button',{name:'有好友的邀请码？'}).click();const code=new URL(geometry.link.split('#')[1],'https://mobile.test').searchParams.get('ref');await page.getByRole('textbox',{name:'好友邀请码',exact:true}).fill(code);await page.getByRole('button',{name:'查看邀请'}).click();await page.getByRole('heading',{name:'好友邀请',exact:true}).waitFor();await page.screenshot({path:resolve(output,'invite-confirm-390.png')});await page.getByRole('button',{name:'稍后再说，先去拼图'}).click();}
  assert.deepEqual(errors,[],'no page exceptions');results.push({width,height,geometry,errors,ok:true});await context.close();
 }
}finally{await browser.close();}
writeFileSync(resolve(output,'layout-results.json'),JSON.stringify(results,null,2));console.log(JSON.stringify({ok:true,viewports:results.length,checks:results.length*8},null,2));
