import test from 'node:test';
import assert from 'node:assert/strict';
import {collectionDecorationRewardHints} from '../mobile/collection-copy.ts';

test('decoration hints follow configured albums instead of the original source album',()=>{
 const legacyAlbums=[{id:'cloud-wonders',title:'云端奇遇',milestones:[{target:5,decorationId:'cursor-star'}]}];
 const moved={id:'cursor-star',source:'album',albumId:'cloud-wonders',rewardAlbums:[{id:'custom-album',title:'动物世界',target:3}]};
 assert.deepEqual(collectionDecorationRewardHints(moved,legacyAlbums),['收集「动物世界」3 张可获得']);
 assert.deepEqual(collectionDecorationRewardHints({...moved,rewardAlbums:[]},legacyAlbums),[]);
 assert.deepEqual(collectionDecorationRewardHints({id:'cursor-star',source:'album'},legacyAlbums),['收集「云端奇遇」5 张可获得']);
 const craft={id:'cursor-leaf',source:'craft',rewardAlbums:[{id:'custom-album',title:'动物世界',target:2},{id:'holiday',title:'节日',target:1}]};
 assert.deepEqual(collectionDecorationRewardHints(craft,[]),['收集「动物世界」2 张可获得','收集「节日」1 张可获得']);
});
