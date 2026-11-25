import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
 detectIsOldUser,
 GAMEALGO_AD_PLACEMENTS,
 GameTelemetry,
} from '../mobile/telemetry.ts';

function memoryStorage(initial = {}) {
 const map = new Map(Object.entries(initial));
 return {
  get: key => map.get(key) ?? null,
  set: (key, value) => map.set(key, String(value)),
  remove: key => map.delete(key),
 };
}

function brandNewProfile(overrides = {}) {
 return {
  code: 'PLAYER01',
  name: '拼图朋友',
  level: 0,
  xp: 0,
  totalXp: 0,
  xpToNext: 100,
  energy: 0,
  energyCap: 50,
  giftProgress: 0,
  giftCount: 0,
  supply: { energy: 0, create: 3 },
  autoSupply: false,
  adEligible: false,
  newcomer: true,
  firstRoomId: null,
  ownedRooms: [],
  collection: {
   coins: 0,
   fragments: 0,
   ownedPackIds: [],
   ownedImageIds: [],
   equipped: null,
  },
  ...overrides,
 };
}

test('detectIsOldUser returns false for confirmed brand-new profile with clean storage', () => {
 const storage = memoryStorage();
 assert.equal(detectIsOldUser(brandNewProfile(), storage), false);
});

test('detectIsOldUser returns true for server-side veteran progress signals', () => {
 const storage = memoryStorage();
 assert.equal(detectIsOldUser(brandNewProfile({ level: 1 }), storage), true);
 assert.equal(detectIsOldUser(brandNewProfile({ totalXp: 12 }), storage), true);
 assert.equal(detectIsOldUser(brandNewProfile({ xp: 5 }), storage), true);
 assert.equal(detectIsOldUser(brandNewProfile({ newcomer: false }), storage), true);
 assert.equal(detectIsOldUser(brandNewProfile({ firstRoomId: 'a'.repeat(32) }), storage), true);
 assert.equal(detectIsOldUser(brandNewProfile({ supply: { energy: 1, create: 3 } }), storage), true);
 assert.equal(detectIsOldUser(brandNewProfile({ giftProgress: 1 }), storage), true);
 assert.equal(detectIsOldUser(brandNewProfile({ giftCount: 1 }), storage), true);
 assert.equal(
  detectIsOldUser(brandNewProfile({ ownedRooms: [{ id: 'a'.repeat(32) }] }), storage),
  true,
 );
 assert.equal(
  detectIsOldUser(
   brandNewProfile({
    collection: { coins: 10, fragments: 0, ownedPackIds: [], ownedImageIds: [], equipped: null },
   }),
   storage,
  ),
  true,
 );
 assert.equal(
  detectIsOldUser(
   brandNewProfile({
    collection: { coins: 0, fragments: 0, ownedPackIds: ['pack1'], ownedImageIds: [], equipped: null },
   }),
   storage,
  ),
  true,
 );
 assert.equal(
  detectIsOldUser(
   brandNewProfile({
    collection: {
     coins: 0,
     fragments: 0,
     ownedPackIds: [],
     ownedImageIds: [],
     equipped: { id: 'dec1', artKey: 'hairpin', color: '#f4a6c0' },
    },
   }),
   storage,
  ),
  true,
 );
});

test('detectIsOldUser returns true when disconnected with local offline or cached clears', () => {
 const withPendingClear = memoryStorage({
  'jigsaw:offline-clears:v1': JSON.stringify([
   {
    levelId: 'ch1-1',
    roomId: 'a'.repeat(32),
    completedAt: 1700000000000,
    elapsedMs: 12000,
    pieces: 12,
    clearId: 'b'.repeat(32),
   },
  ]),
 });
 assert.equal(detectIsOldUser(null, withPendingClear), true);

 const withCachedLevels = memoryStorage({
  'jigsaw:levels-cache:v1': JSON.stringify({
   firstClearEnergy: 10,
   current: null,
   chapters: [
    {
     id: 'ch1',
     title: '第一章',
     albumId: 'album1',
     status: 'available',
     coverImageId: null,
     coverSrc: null,
     levels: [
      {
       id: 'ch1-1',
       imageId: 'img1',
       title: '第一关',
       pieces: 12,
       status: 'cleared',
      },
     ],
    },
   ],
  }),
 });
 assert.equal(detectIsOldUser(undefined, withCachedLevels), true);
});

test('detectIsOldUser returns undefined when disconnected with no local cleared progress', () => {
 assert.equal(detectIsOldUser(null, memoryStorage()), undefined);
 assert.equal(detectIsOldUser(undefined, memoryStorage()), undefined);
});

test('GAMEALGO_AD_PLACEMENTS matches registered ad placement config', () => {
 const expected = JSON.parse(
  readFileSync(resolve(import.meta.dirname, '../config/gamealgo-ad-placement-ids.json'), 'utf8'),
 );
 assert.deepEqual(GAMEALGO_AD_PLACEMENTS, expected.ids);
 for (const key of [
  'supply_energy',
  'supply_create_ticket',
  'room_hint',
  'room_underlay',
  'daily_ad_reward',
  'unlock_album_image',
 ]) {
  assert.match(GAMEALGO_AD_PLACEMENTS[key], /^gap_[a-z0-9]+$/);
 }
});

test('GameTelemetry stays an isolated no-op outside TapTap H5', async () => {
 for (const platformId of ['web', 'wechat']) {
  const telemetry = new GameTelemetry({
   config: {
    id: platformId,
    gameName: '拼图小窝',
    apiBase: 'https://example.com',
    assetBase: 'https://example.com/assets',
    gamePropel: {
     baseUrl: 'https://game-algo-sdk.dictapis.cn',
     gameKey: 'ga_live_example123456',
     experimentIntegrationVersion: 0,
    },
   },
   storage: memoryStorage(),
  });
  telemetry.init(brandNewProfile());
  assert.equal(telemetry.adEnabled, false);
  telemetry.prepareAd('1054324');
  assert.equal(await telemetry.watchRewardedAd('supply_energy', '1054324'), 'unavailable');
  telemetry.startAttempt({
   levelId: 'ch1-1',
   levelNo: 1,
   mode: '剧情闯关',
   pieces: 12,
   randomId: () => 'c'.repeat(32),
  });
  telemetry.milestone('new_user', '进入大厅');
  telemetry.endAttempt('win');
  telemetry.close();
 }
});
