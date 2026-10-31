import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';

const bundled=await build({stdin:{contents:"export {GameApp} from './mobile/app.ts'",resolveDir:process.cwd(),loader:'ts'},bundle:true,write:false,format:'esm',platform:'node',logLevel:'silent'});
const {GameApp}=await import('data:text/javascript;base64,'+Buffer.from(bundled.outputFiles[0].text).toString('base64'));

const gift=available=>({claimed:available?2:3,loginDays:3,available,done:false,tomorrowDay:4,days:[]});
function fixture({capabilities={weeklyGift:true,dailyStreak:true},available=true,newcomer=false}={}){
 const values=new Map(),opened=[];
 const app=Object.create(GameApp.prototype);
 Object.assign(app,{
  platform:{config:{id:'taptap'},storage:{get:key=>values.get(key)??null,set:(key,value)=>values.set(key,value)},frame:()=>1,cancelFrame(){}},
  client:{config:{capabilities},profile:{newcomer,capabilities}},
  retention:{weeklyGift:gift(available),dailyStreak:{count:0,todayDone:false,day:'2026-11-01',next:null,lastAward:null}},retentionPending:null,retentionPendingSince:0,
  route:'lobby',room:null,modal:null,busy:false,ready:true,hidden:false,destroyed:false,orientationEntryPending:null,offline:{active:false,server:null,isRoom:()=>false},levels:null,levelsOwner:'',
  welcomePending:false,welcomeSkip:false,welcomeEnabled:true,welcomeLastVisit:null,welcome:null,welcomeFrame:null,
  historyRooms:[],dailyPhoto:null,serverOffset:0,
  invalidate(){},
 });
 app.showModal=modal=>{app.modal=modal;if(modal)opened.push(modal);};
 return {app,opened,values};
}

test('七日礼 opens before 欢迎回家, and the greeting follows once the gift is closed',()=>{
 const {app,opened}=fixture();
 app.welcomePending=true;
 // One lobby tick: the gift wins, the greeting keeps waiting.
 app.maybeWeeklyGift();app.maybeWelcome();
 assert.deepEqual(opened,['weeklyGift']);assert.equal(app.welcomePending,true);
 app.maybeWelcome();assert.deepEqual(opened,['weeklyGift'],'greeting never stacks on the open gift');
 app.modal=null;
 app.maybeWeeklyGift();app.maybeWelcome();
 assert.deepEqual(opened,['weeklyGift','welcome']);
});

test('the greeting waits while the retention request is still pending, not longer than 5 s',t=>{
 let now=Date.parse('2026-11-01T02:00:00Z');t.mock.method(Date,'now',()=>now);
 const {app,opened}=fixture();app.retention=null;app.retentionPending=new Promise(()=>{});app.retentionPendingSince=now;app.welcomePending=true;
 app.maybeWelcome();assert.deepEqual(opened,[]);
 now+=5001;app.maybeWelcome();assert.deepEqual(opened,['welcome']);
});

test('no gift today, a newcomer, or an old backend: the greeting is not held',()=>{
 for(const options of [{available:false},{newcomer:true},{capabilities:{}}]){
  const {app,opened}=fixture(options);if(options.newcomer)app.client.profile.newcomer=true;
  assert.equal(app.weeklyGiftHolds(),false);app.maybeWeeklyGift();assert.deepEqual(opened,[]);
 }
});

test('the gift pops at most once per Beijing day on this device',()=>{
 const {app,opened}=fixture();
 app.maybeWeeklyGift();app.modal=null;app.maybeWeeklyGift();
 assert.deepEqual(opened,['weeklyGift']);
});
