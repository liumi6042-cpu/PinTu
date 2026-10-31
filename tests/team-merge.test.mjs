import test from 'node:test';
import assert from 'node:assert/strict';
import { detectTeamMerges,MergeHolderLog,TEAM_MERGE_WINDOW_MS } from '../lib/team-merge.ts';

const groups=(...sets)=>sets.map(pieces=>({id:pieces[0],pieces,dx:0,dy:0,locked:false}));
const puzzle=(...sets)=>({cols:4,rows:3,groups:groups(...sets)});
const holder=(player,releasedAt=null)=>({player,name:player,color:'#'+player.repeat(3).slice(0,3),releasedAt});

test('two players holding the two sides of a new seam make one 默契拼合 on that seam',()=>{
 const before=groups([0],[1],[2]),after=puzzle([0,1],[2]),now=50000;
 const merges=detectTeamMerges(before,after,new Map([[0,holder('a',now-800)],[1,holder('b')]]),now);
 assert.equal(merges.length,1);
 assert.deepEqual([merges[0].a,merges[0].b].sort(),[0,1],'the seam pieces are the touching pair');
 assert.deepEqual(merges[0].holders.map(h=>h.player).sort(),['a','b']);
});

test('one player, an unheld partner, an old hold or no merge are ordinary snaps',()=>{
 const before=groups([0],[1],[2]),now=50000;
 assert.equal(detectTeamMerges(before,puzzle([0,1],[2]),new Map([[0,holder('a')],[1,holder('a',now-100)]]),now).length,0,'same player twice');
 assert.equal(detectTeamMerges(before,puzzle([0,1],[2]),new Map([[0,holder('a')],[2,holder('b')]]),now).length,0,'the other holder is not on the seam');
 assert.equal(detectTeamMerges(before,puzzle([0,1],[2]),new Map([[0,holder('a',now-TEAM_MERGE_WINDOW_MS-1)],[1,holder('b')]]),now).length,0,'hold ended too long ago');
 assert.equal(detectTeamMerges(before,puzzle([0,1],[2]),new Map([[0,holder('a',now-TEAM_MERGE_WINDOW_MS)],[1,holder('b')]]),now).length,1,'window edge still counts');
 assert.equal(detectTeamMerges(before,puzzle([0],[1],[2]),new Map([[0,holder('a')],[1,holder('b')]]),now).length,0,'nothing joined');
 assert.equal(detectTeamMerges(groups([0,1],[2]),puzzle([0,1],[2]),new Map([[0,holder('a')],[1,holder('b')]]),now).length,0,'a repeated snapshot is silent');
});

test('a merge counts across non-first pieces and into a larger existing group',()=>{
 // 4x3: piece 5 sits under 1. Group [1,2] (b) joins group [4,5] (a) through the 1-5 seam.
 const before=groups([4,5],[1,2],[0]),now=9000,merges=detectTeamMerges(before,puzzle([4,5,1,2],[0]),new Map([[4,holder('a')],[1,holder('b',now-10)]]),now);
 assert.equal(merges.length,1);assert.deepEqual([merges[0].a,merges[0].b].sort((x,y)=>x-y),[1,5]);
});

test('the holder log takes remote leases and releases them when the lease is gone, never the local hold',()=>{
 const log=new MergeHolderLog(),self='\u0000self';
 log.hold(3,{player:self,name:'我',color:'#f00'});
 log.syncRemote({'1':{playerId:'b',name:'好友',color:'#0f0'}},1000,self);
 assert.equal(log.holders.get(1).releasedAt,null);assert.equal(log.holders.get(1).player,'b');
 log.syncRemote({},1500,self);
 assert.equal(log.holders.get(1).releasedAt,1500,'lease gone');assert.equal(log.holders.get(3).releasedAt,null,'the local drag ends only from the board');
 log.release(3,1600);log.syncRemote({},1600+TEAM_MERGE_WINDOW_MS+1,self);
 assert.equal(log.holders.size,0,'expired holds are pruned');
 log.syncRemote({'2':{name:'旧客户端',color:'#00f'}},2000,self);assert.equal(log.holders.get(2).player,'name:旧客户端','owners without a player id still count by name');
});
