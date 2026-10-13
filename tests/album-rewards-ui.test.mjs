import test from 'node:test';
import assert from 'node:assert/strict';
import {ensureAlbumRewardIds,addAlbumReward,renderAlbumRewards} from '../public/album-rewards-ui.js';
import {defaultGameSettings} from '../../jigsaw-nook-taptap/server/game-settings.mjs';

test('per album rewards retain their claim identity and offer all decorations including craft items',()=>{
 const album={imageIds:[],milestones:[{target:3,coins:30,decorationId:null},{target:6,coins:60,decorationId:'cloud-moon'}]};
 ensureAlbumRewardIds(album);
 assert.equal(album.milestones[0].id,'milestone-3');
 album.milestones[0].target=4;
 ensureAlbumRewardIds(album);
 assert.equal(album.milestones[0].id,'milestone-3');
 assert.equal(addAlbumReward(album),true);
 assert.equal(album.milestones[2].target,7);
 assert.match(album.milestones[2].id,/^milestone-[a-f0-9-]+$/);
 album.milestones[2].decorationId='cream-bow';
 const html=renderAlbumRewards(album,defaultGameSettings().decorations);
 assert.match(html,/value="cream-bow" selected/);
 assert.match(html,/value="cloud-moon" selected/);
 assert.match(html,/aria-label="第 3 档赠送装饰"/);
 assert.doesNotMatch(html,/max="0"/);
});
