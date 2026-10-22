import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {createMobileCollection,MOBILE_COLLECTION_CATALOG as catalog} from '../server/mobile-collection.mjs';
import {defaultGameSettings,buildGameConfiguration,validateGameConfiguration} from '../server/game-settings.mjs';

const now=1800000000000,owner='a'.repeat(64);
const photos=[...new Set(catalog.packs.flatMap(pack=>pack.imageIds))].map(id=>({id,title:id,src:id,thumbSrc:id,status:'published'}));

test('retired IDs stay schema-compatible but are absent from new and old-owned collection views',()=>{
 const settings=defaultGameSettings();assert.equal(settings.decorations.length,8);
 for(const id of ['berry-spark','honey-star'])assert.equal(settings.decorations.find(item=>item.id===id).enabled,false);
 assert.deepEqual(validateGameConfiguration(buildGameConfiguration(settings)),settings);
 for(const managed of [false,true]){
  const db=new DatabaseSync(':memory:'),c=createMobileCollection({db,photos,readAlbums:()=>managed?{albums:[]}:null});
  try{
   assert.equal(c.equipped(owner),null);c.contribution(owner,'room','request',now);
   assert.equal(db.prepare('SELECT equipped FROM mobile_collection_wallets WHERE owner=?').get(owner).equipped,null);
   for(const id of ['berry-spark','honey-star']){
    db.prepare('INSERT INTO mobile_collection_owned VALUES(?,?,?,?)').run(owner,'decoration',id,now-1);
    db.prepare('UPDATE mobile_collection_wallets SET equipped=? WHERE owner=?').run(id,owner);
    assert.equal(c.equipped(owner),null);
    assert.equal(c.view(owner,now).decorations.some(item=>item.id===id),false);
    assert.throws(()=>c.craft(owner,id,now),{code:'DECORATION_RETIRED'});
    assert.throws(()=>c.equip(owner,id),{code:'DECORATION_RETIRED'});
    assert.equal(db.prepare('SELECT equipped FROM mobile_collection_wallets WHERE owner=?').get(owner).equipped,id);
    assert.ok(db.prepare("SELECT 1 FROM mobile_collection_owned WHERE owner=? AND kind='decoration' AND item_id=?").get(owner,id));
   }
   c.equip(owner,null);assert.equal(c.summary(owner).equipped,null);
  }finally{db.close();}
 }
});

test('retired album decorations are skipped while coins and stable old reward receipts remain intact',()=>{
 const db=new DatabaseSync(':memory:'),imageId=photos[0].id,album={id:'retirement-album',title:'相册',description:'',imageIds:[imageId],showOnMobile:true,showOnPc:true,purchasable:false,milestones:[{id:'old',target:1,coins:500,decorationId:'berry-spark'},{id:'new',target:1,coins:17,decorationId:'honey-star'}]};
 const c=createMobileCollection({db,photos,readAlbums:()=>({albums:[album]})});
 try{
  const old=JSON.stringify({target:1,coins:13,decorationId:'berry-spark'});
  db.prepare('INSERT INTO mobile_collection_milestone_rewards VALUES(?,?,?,?,?)').run(owner,album.id,'old',old,now-1);
  const room={id:'retired-room',completedAt:now,puzzle:{imageId},mobilePieces:48},reward=c.complete(owner,room,3,now);
  assert.deepEqual(reward.catalog.albumRewards,[{albumId:album.id,title:album.title,target:1,coins:17}]);
  const coins=c.summary(owner).coins;c.complete(owner,room,3,now+1);assert.equal(c.summary(owner).coins,coins);
  assert.equal(db.prepare('SELECT data FROM mobile_collection_milestone_rewards WHERE owner=? AND milestone_id=?').get(owner,'old').data,old);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM mobile_collection_owned WHERE kind='decoration'").get().n,0);
  const shown=c.view(owner,now).albums[0].milestones;assert.equal(shown[0].coins,13);assert.ok(shown.every(item=>!item.decorationId&&item.claimed));
 }finally{db.close();}
});
