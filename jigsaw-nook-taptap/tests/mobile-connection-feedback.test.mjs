import test from 'node:test';
import assert from 'node:assert/strict';
import { createPuzzle, dropGroup, piecesFor } from '../lib/puzzle-engine.ts';
import { newConnections, newMobileConnections, MobileContributionGate, MOBILE_CONNECTION_GLOW_MS, MOBILE_REDUCED_GLOW_MS } from '../lib/connection-feedback.ts';
import { ConnectionGlowRenderer } from '../lib/connection-glow.ts';
import { PuzzleTable } from '../lib/puzzle-table.ts';

function singlePlacement() {
 const state=createPuzzle('test',12,9,91),before=structuredClone(state.groups);
 const piece=state.groups.find(g=>g.id===0);piece.dx=0;piece.dy=0;dropGroup(state,0,4);
 return {state,before};
}

test('mobile covers direct single-piece placement; classic behaviour stays unchanged',()=>{
 const {state,before}=singlePlacement();
 assert.equal(state.groups.length,before.length);
 assert.deepEqual(newConnections(before,state),[]);
 const effects=newMobileConnections(before,state,new Set([0]));
 assert.equal(effects.length,1);assert.deepEqual(effects[0].outlineIds,[0]);assert.equal(effects[0].source,'local');
 assert.equal(newMobileConnections(before,state)[0].source,'teammate');
 assert.deepEqual(newMobileConnections(state.groups,structuredClone(state)),[],'poll echoes cannot replay effects');
 const moved=structuredClone(state);moved.groups[1].dx+=30;assert.deepEqual(newMobileConnections(state.groups,moved),[],'movement produces no success effect');
});

test('mobile highlights an already connected loose group when it is placed; large merges have one bounded burst',()=>{
 const state=createPuzzle('test',12,9,91);
 state.groups[0]={id:0,pieces:[0,1],dx:100,dy:100,locked:false};state.groups=state.groups.filter(g=>g.id!==1);
 const before=structuredClone(state.groups);Object.assign(state.groups[0],{dx:0,dy:0,locked:true});
 const effects=newMobileConnections(before,state);assert.equal(effects.length,1);assert.deepEqual(effects[0].outlineIds,[0,1]);
 const many=createPuzzle('test',20,15,91),original=structuredClone(many.groups);
 many.groups=[{id:0,pieces:original.flatMap(g=>g.pieces),dx:0,dy:0,locked:true}];
 const merged=newMobileConnections(original,many,new Set([0]));assert.equal(merged.length,1);assert.equal(merged[0].outlineIds.length,3);
 const several=structuredClone({ ...many,groups:original });
 for(const g of several.groups.slice(0,8))g.locked=true;
 assert.equal(newMobileConnections(original,several).length,3,'bulk catch-up is limited to three bursts');
});

test('only positive acknowledged XP receipts pass once',()=>{
 const gate=new MobileContributionGate();
 assert.equal(gate.claim({requestId:'a',groupId:0,creditedXp:0}),false);
 assert.equal(gate.claim({requestId:'a',groupId:0,creditedXp:1}),true);
 assert.equal(gate.claim({requestId:'a',groupId:0,creditedXp:1}),false);
 assert.equal(gate.claim({requestId:'b',groupId:0,creditedXp:2}),true,'text uses real credited amount');
 for(const bad of [{requestId:'',groupId:0,creditedXp:1},{requestId:'c',groupId:-1,creditedXp:1},{requestId:'d',groupId:0,creditedXp:NaN}])assert.equal(gate.claim(bad),false);
});

function withDom(run,{reduced=false}={}) {
 const keys=['window','document','devicePixelRatio','Path2D','setTimeout','clearTimeout'],saved=Object.fromEntries(keys.map(key=>[key,globalThis[key]]));
 const timers=new Map(),events=new Map(),mediaEvents=new Map();let serial=0,paints=0;
 const context={setTransform(){},clearRect(){},scale(){},translate(){},save(){},restore(){},stroke(){paints++;}};
 class Node {
  constructor(tag){this.tag=tag;this.children=[];this.parent=null;this.className='';this.style={setProperty(key,value){this[key]=value;}};this.width=0;this.height=0;}
  setAttribute(key,value){this[key]=value;}
  appendChild(child){child.parent=this;this.children.push(child);return child;}
  remove(){if(this.parent)this.parent.children=this.parent.children.filter(child=>child!==this);this.parent=null;}
  getContext(){return context;}
  querySelector(selector){return this.all().find(node=>node.className.split(' ').includes(selector.slice(1)))??null;}
  all(){return this.children.flatMap(child=>[child,...child.all()]);}
 }
 const host=new Node('div');globalThis.devicePixelRatio=2;globalThis.Path2D=class{};
 globalThis.setTimeout=(fn,ms)=>{timers.set(++serial,{fn,ms});return serial;};globalThis.clearTimeout=id=>timers.delete(id);
 const media={matches:reduced,addEventListener:(name,fn)=>mediaEvents.set(name,fn),removeEventListener:name=>mediaEvents.delete(name)};
 globalThis.window={matchMedia:()=>media};
 globalThis.document={hidden:false,addEventListener:(name,fn)=>events.set(name,fn),removeEventListener:name=>events.delete(name),createElement:tag=>new Node(tag)};
 try{run({host,timers,events,media,mediaEvents,paintCount:()=>paints,count:className=>host.all().filter(node=>node.className.split(' ').includes(className)).length});}
 finally{for(const key of keys){if(saved[key]===undefined)delete globalThis[key];else globalThis[key]=saved[key];}}
}

test('mobile paints bounded nonblocking bursts, promotes own ACK, and never gives teammates XP',()=>withDom(({host,timers,count,paintCount,events,mediaEvents})=>{
 const {state,before}=singlePlacement(),camera={x:10,y:20,z:.4},renderer=new ConnectionGlowRenderer(host,state,piecesFor(12,9,91),()=>camera,true);
 renderer.show(newMobileConnections(before,state));
 assert.equal(count('mobile-snap-outline'),1);assert.equal(count('mobile-snap-spark'),0);assert.equal(count('mobile-snap-xp'),0);
 assert.equal([...timers.values()][0].ms,MOBILE_CONNECTION_GLOW_MS);
 renderer.confirmContribution({requestId:'local-a',groupId:0,creditedXp:1});
 assert.equal(count('mobile-snap-outline'),1);assert.equal(count('mobile-snap-spark'),4);assert.equal(host.querySelector('.mobile-snap-xp').textContent,'+1 XP');
 const timerCount=timers.size,painted=paintCount();renderer.confirmContribution({requestId:'local-a',groupId:0,creditedXp:1});
 assert.equal(timers.size,timerCount);assert.equal(paintCount(),painted,'duplicate acknowledgements cannot replay or repaint');
 const previous=host.querySelector('.mobile-snap-accent').style.transform;camera.x+=40;renderer.update();
 assert.notEqual(host.querySelector('.mobile-snap-accent').style.transform,previous);assert.equal(paintCount(),painted,'camera tracking does not repaint');
 const glow=newMobileConnections(before,state,new Set([0]))[0];renderer.show([glow,glow,glow,glow]);
 assert.equal(count('mobile-snap-outline'),3);assert.equal(count('mobile-snap-spark'),12);assert.equal(timers.size,3);
 for(const {fn} of [...timers.values()])fn();assert.equal(host.all().length,0);assert.equal(timers.size,0);
 renderer.show([glow]);renderer.destroy();assert.equal(host.all().length,0);assert.equal(timers.size,0);assert.equal(events.size,0);assert.equal(mediaEvents.size,0);
}));

test('reduced motion has short static feedback and no sparks; hidden receipts never replay',()=>withDom(({host,timers,count,events})=>{
 const {state,before}=singlePlacement(),renderer=new ConnectionGlowRenderer(host,state,piecesFor(12,9,91),()=>({x:0,y:0,z:1}),true);
 renderer.show(newMobileConnections(before,state,new Set([0])));
 assert.equal([...timers.values()][0].ms,MOBILE_REDUCED_GLOW_MS);assert.equal(count('is-reduced'),1);assert.equal(count('mobile-snap-spark'),0);
 renderer.confirmContribution({requestId:'reduced',groupId:0,creditedXp:1});assert.equal(count('mobile-snap-xp'),1);assert.equal(count('is-reduced'),2);
 globalThis.document.hidden=true;events.get('visibilitychange')();assert.equal(host.all().length,0);
 renderer.confirmContribution({requestId:'hidden',groupId:0,creditedXp:1});globalThis.document.hidden=false;
 renderer.confirmContribution({requestId:'hidden',groupId:0,creditedXp:1});assert.equal(host.all().length,0);renderer.destroy();
},{reduced:true}));

test('PuzzleTable enables mobile direct-placement effects only through explicit mobile option',()=>{
 const {state,before}=singlePlacement();
 function fixture(mobileFeedback){const effects=[];const table=Object.create(PuzzleTable.prototype);Object.assign(table,{state:{...structuredClone(state),groups:structuredClone(before)},pieces:piecesFor(12,9,91),mobileFeedback,remoteOwners:{},feedback:{show:value=>effects.push(...value)},update(){},notice(){},draw(){}});return{table,effects};}
 const classic=fixture(false);classic.table.syncRemote(state,{},new Set());assert.equal(classic.effects.length,0);
 const mobile=fixture(true);mobile.table.syncRemote(state,{},new Set([0]));assert.equal(mobile.effects.length,1);assert.equal(mobile.effects[0].source,'local');
 mobile.table.syncRemote(state,{},new Set());assert.equal(mobile.effects.length,1);
 const initial=fixture(true);initial.table.syncRemote(state,{},new Set(),false);assert.equal(initial.effects.length,0,'initial/recovered snapshot must not celebrate historical progress');
});
