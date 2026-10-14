import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {DEFAULT_GAME_SETTINGS} from '../server/game-settings.mjs';
import {DEFAULT_TASK_REWARD_SETTINGS} from '../server/task-reward-settings.mjs';
import {newManagedProfile,recordManagedRoom,managedReward,claimManagedGift,purchaseManagedAlbum,craftManagedDecoration,shareManagedInvitation,managedDay,awardManagedMilestones} from '../lib/managed-economy-model.mjs';
const settings=structuredClone(DEFAULT_GAME_SETTINGS),rewards=structuredClone(DEFAULT_TASK_REWARD_SETTINGS),now=Date.parse('2026-10-13T08:00:00Z');
settings.collection.contributionCoins=2;settings.energy.contributionXp=3;settings.collection.catalogMinimumContributions=2;
for(const task of rewards.tasks){task.coins=11;task.xp=5;}
rewards.tenGrid.coins=9;rewards.tenGrid.xp=4;rewards.invitationShare.coins=7;rewards.invitationShare.xp=6;rewards.invitationFriend.coins=13;rewards.invitationFriend.xp=8;
const album={id:'test-album',title:'相册',imageIds:['a','b'],showOnPc:true,purchasable:true,price:10,milestones:[{id:'milestone-stable',target:1,coins:17,decorationId:'cloud-moon'}]};
const options={settings,rewards,now,albums:[album],pieces:108,availableImage:true,activationAt:now-1};
const room=(count,completedAt=null)=>({id:'room-a',imageId:'a',count,completedAt});
test('only new committed snap deltas reward; old baseline and duplicate recovery do not',()=>{
 const state=newManagedProfile();recordManagedRoom(state,room(20),{...options,baseline:20});assert.equal(state.coins,0);assert.equal(state.totalXp,0);
 recordManagedRoom(state,room(22),{...options,baseline:20});assert.equal(state.coins,4);assert.equal(state.totalXp,6);assert.equal(state.giftProgress,2);
 recordManagedRoom(state,room(22),options);assert.equal(state.coins,4);assert.equal(state.totalXp,6);assert.equal(state.rooms['room-a'].rewarded,2);
});
test('completion, album reward and task gifts retain snapshots and never pay twice',()=>{
 const state=newManagedProfile();recordManagedRoom(state,room(10,now),{...options,cooperation:true});
 const expected=20+Math.ceil(10*settings.collection.completionCoinRatio)+17;assert.equal(state.coins,expected);assert.deepEqual(state.artworks.a,[108]);assert.ok(state.decorations.includes('cloud-moon'));
 const dailyId='daily:'+managedDay(now)+':cooperation-10';assert.equal(state.gifts[dailyId].coins,11);assert.equal(state.gifts['ten:1'].coins,9);
 const changed=structuredClone(settings);changed.collection.contributionCoins=1000;const updatedAlbum={...album,milestones:[{id:'milestone-stable',target:2,coins:999,decorationId:'mountain-leaf'}]};
 recordManagedRoom(state,room(10,now),{...options,settings:changed,albums:[updatedAlbum]});assert.equal(state.coins,expected);assert.equal(state.milestones[album.id]['milestone-stable'].coins,17);
 claimManagedGift(state,dailyId,settings,now+1);claimManagedGift(state,dailyId,settings,now+2);assert.equal(state.coins,expected+11);assert.equal(state.totalXp,35);
 assert.equal(JSON.stringify(state).includes('energy'),false);
});
test('paid album rights survive membership moves; craft purchase cannot overdraft',()=>{
 const state=newManagedProfile();assert.throws(()=>purchaseManagedAlbum(state,album,settings,now),/金币不足/);assert.equal(state.coins,0);assert.deepEqual(state.ownedAlbums,{});
 managedReward(state,'test-seed',{coins:10,fragments:30},settings,now);purchaseManagedAlbum(state,album,settings,now);purchaseManagedAlbum(state,album,settings,now);assert.equal(state.coins,0);assert.equal(state.ownedImages.a,true);
 const next={...album,imageIds:['c']};assert.deepEqual(state.ownedAlbums[album.id].imageIds,['a','b']);assert.equal(state.ownedImages.c,undefined);
 const bow=settings.decorations.find(item=>item.id==='cream-bow');craftManagedDecoration(state,bow,settings,now);craftManagedDecoration(state,bow,settings,now);assert.equal(state.fragments,0);assert.equal(state.decorations.filter(id=>id===bow.id).length,1);
 assert.throws(()=>craftManagedDecoration(state,settings.decorations.find(item=>item.id==='rose-butterfly'),settings,now),/碎片不足/);assert.equal(state.fragments,0);
});

test('retired decorations preserve old ownership and receipts without crafting or new album grants',()=>{
 const state=newManagedProfile();state.fragments=500;state.decorations=['honey-star'];state.equipped='honey-star';state.artworks.a=[108];
 const historical={target:1,coins:13,decorationId:'honey-star',at:now-1};state.milestones.old={done:historical};
 for(const id of ['berry-spark','honey-star'])assert.throws(()=>craftManagedDecoration(state,settings.decorations.find(item=>item.id===id),settings,now),/已移除/);
 assert.equal(state.fragments,500);assert.deepEqual(state.decorations,['honey-star']);assert.equal(state.equipped,'honey-star');
 const updated={...album,milestones:[{id:'retired-reward',target:1,coins:17,decorationId:'berry-spark'}]};
 awardManagedMilestones(state,[updated],settings,now);awardManagedMilestones(state,[updated],settings,now+1);
 assert.equal(state.coins,17);assert.equal(state.milestones[album.id]['retired-reward'].decorationId,null);
 assert.deepEqual(state.decorations,['honey-star']);assert.deepEqual(state.milestones.old.done,historical);
});
test('invites require three successful contributions and retain the configured gift',()=>{
 const state=newManagedProfile(),binding={inviter:'friend',bound_at:now-1};recordManagedRoom(state,room(2),{...options,invitation:binding});assert.equal(state.invitation.qualifiedAt,null);
 recordManagedRoom(state,room(3),{...options,invitation:binding});assert.equal(state.invitation.qualifiedAt,now);assert.deepEqual(state.invitation.reward,{coins:13,xp:8});
 recordManagedRoom(state,room(3),{...options,invitation:binding});assert.equal(state.invitation.contributions,3);
});
test('share receipts prevent concurrent replays and carry across Beijing days',()=>{
 const state=newManagedProfile();shareManagedInvitation(state,'receipt-1',settings,rewards,now);shareManagedInvitation(state,'receipt-1',settings,rewards,now+86400000);assert.equal(state.coins,7);assert.equal(state.totalXp,6);
 for(let i=2;i<=5;i++)shareManagedInvitation(state,'receipt-'+i,settings,rewards,now);assert.equal(state.coins,7*rewards.invitationShare.dailyLimit);
});
test('migration and CAS preserve legacy assets and competing rewards cannot overwrite',()=>{
 const db=new DatabaseSync(':memory:');db.exec("CREATE TABLE puzzle_courtyards(user_id TEXT PRIMARY KEY,data TEXT);INSERT INTO puzzle_courtyards VALUES('old','{\"balance\":55,\"cosmetics\":{\"cursors\":[\"9\"]}}')");
 const original=db.prepare('SELECT data FROM puzzle_courtyards').get().data;
 db.exec(readFileSync(new URL('../drizzle/0015_managed_content_economy.sql',import.meta.url),'utf8'));
 db.prepare('INSERT INTO puzzle_managed_players VALUES(?,?,?,?)').run('player',0,JSON.stringify(newManagedProfile()),now);
 const first=newManagedProfile(),second=newManagedProfile();managedReward(first,'one',{coins:10},settings,now);managedReward(second,'two',{coins:20},settings,now);
 const update=db.prepare('UPDATE puzzle_managed_players SET data=?,version=version+1 WHERE owner=? AND version=?');assert.equal(update.run(JSON.stringify(first),'player',0).changes,1);assert.equal(update.run(JSON.stringify(second),'player',0).changes,0);
 const reread=JSON.parse(db.prepare('SELECT data FROM puzzle_managed_players').get().data);managedReward(reread,'two',{coins:20},settings,now);assert.equal(update.run(JSON.stringify(reread),'player',1).changes,1);assert.equal(JSON.parse(db.prepare('SELECT data FROM puzzle_managed_players').get().data).coins,30);
 assert.equal(db.prepare('SELECT data FROM puzzle_courtyards').get().data,original);db.close();
});
