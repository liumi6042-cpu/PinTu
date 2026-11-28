import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { MOBILE_COLLECTION_CATALOG, createMobileCollection } from '../../server/mobile-collection.mjs';
import { CHINA_POSTCARD_IDS, DAY, HOUR, NPCS, POSTCARD_POOL, ROOM_SCENES, getCalendarInfo, matchSynergy } from './catalog.js';
import {
  DEFAULT_START_TS,
  buyItem,
  claimAdChinaWish,
  claimAdGachaTicket,
  claimAdPuzzleDouble,
  claimAdSillDouble,
  claimAdTripRush,
  claimReunionGift,
  claimSill,
  clearDust,
  completePostcard,
  createInitialState,
  equipDecor,
  feedSnack,
  getAdRemaining,
  getChinaCollectionStats,
  getDerivedView,
  packBag,
  replyLetter,
  sendOffNow,
  setSceneOverride,
  simulateTo,
  spinGacha,
  syncWalletCoins,
  togglePantrySlot,
} from './engine.js';

test('real calendar season advances from early autumn (Oct 18) to early winter snow (Nov 17, +30 days)', () => {
  const day1 = getCalendarInfo(DEFAULT_START_TS);
  assert.equal(day1.season, 'autumn');
  assert.equal(day1.cnDate, '十月十八');

  const day30 = getCalendarInfo(DEFAULT_START_TS + 30 * DAY);
  assert.equal(day30.season, 'winter');
  assert.equal(day30.defaultWeather, 'snow');
  assert.equal(day30.cnDate, '十一月十七');
});

test('packing food + tool detects hidden chemistry synergy and immediate send-off departs cleanly', () => {
  let state = createInitialState();
  state = packBag(state, { food: 'bento', tool: 'camera', wish: 'token-apang' });
  assert.equal(matchSynergy(state.pack)?.id, 'bento-camera');
  assert.equal(state.inventory.bento, 0);

  const sent = sendOffNow(state);
  assert.equal(sent.departed, true);
  assert.equal(sent.state.status, 'away');
  assert.equal(sent.state.trips, 1);
  assert.equal(sent.state.trip.cardId, 'rainy-bookshop');

  // +12 hours brings Tuanzi home with postcard, bond xp, souvenir, and letter
  const after = simulateTo(sent.state, sent.state.now + 12 * HOUR).state;
  assert.equal(after.status, 'home');
  assert.ok(after.postcards.some(c => c.templateId === 'rainy-bookshop'));
  assert.ok(after.bonds.apang.level >= 1);
  assert.ok(after.souvenirs.length >= 1);
});

test('30-day offline lazy simulation evolves room, plant, bonds, scarf, reunion journal with zero punishment', () => {
  let state = createInitialState();
  state = packBag(state, { food: 'bento', tool: 'camera', wish: 'token-apang' });
  state = togglePantrySlot(state, 1, 'osmanthus');
  const initialBondSum = Object.values(state.bonds).reduce((n, b) => n + b.xp, 0);

  const { state: s30 } = simulateTo(state, state.now + 30 * DAY);
  const view = getDerivedView(s30);

  assert.equal(view.daysTogether, 31);
  assert.equal(view.cal.season, 'winter');
  assert.equal(view.weather, 'snow');
  assert.equal(view.isEvolvedRoom, true);
  assert.ok(s30.plantGrowth >= 90, 'plant grows instead of withering');
  assert.equal(s30.apangHouseguest, true);
  assert.equal(s30.winterScarfUnlocked, true);
  assert.ok(s30.dustLevel > 0, 'gentle dust waiting for interactive wipe');
  assert.ok(s30.reunion && s30.reunion.pages.length === 4);
  assert.ok(s30.postcards.length <= 6, 'curated postcards without spam overload');

  const finalBondSum = Object.values(s30.bonds).reduce((n, b) => n + b.xp, 0);
  assert.ok(finalBondSum > initialBondSum, 'bonds only grow, never punished');

  // Claim reunion gift + wipe dust + reply to letter + develop postcard
  const gifted = claimReunionGift(s30);
  assert.ok(gifted.coins >= 120);
  assert.equal(gifted.state.reunion.claimed, true);

  const wiped = clearDust(gifted.state);
  assert.equal(wiped.dustLevel, 0);

  const firstLetter = wiped.letters[0];
  assert.ok(firstLetter);
  const firstChoice = NPCS[firstLetter.npcId].letters.find(l => l.step === firstLetter.step).choices[0].id;
  const replied = replyLetter(wiped, firstLetter.uid, firstChoice);
  assert.equal(replied.ok, true);
  assert.equal(replied.state.letters[0].chosenReplyId, firstChoice);

  const undeveloped = replied.state.postcards.find(c => !c.developed);
  assert.ok(undeveloped);
  const dev = completePostcard(replied.state, undeveloped.uid);
  assert.equal(dev.reward, 30);
});

test('sill harvests dried fish snack, feeding consumes snack, and shop spends main-game Coins', () => {
  const s0 = createInitialState();
  const sillRes = claimSill(s0);
  assert.equal(sillRes.gained, 2);
  assert.equal(sillRes.state.inventory.fish, s0.inventory.fish + 2);
  assert.equal(sillRes.state.coins, s0.coins, 'sill harvests snack, not coins');

  const fed = feedSnack(sillRes.state);
  assert.equal(fed.ok, true);
  assert.equal(fed.state.inventory.fish, sillRes.state.inventory.fish - 1);

  const bought = buyItem(fed.state, 'onigiri');
  assert.equal(bought.ok, true);
  assert.equal(bought.state.coins, fed.state.coins - 20);
  assert.equal(bought.state.inventory.onigiri, s0.inventory.onigiri + 1);
});

test('brass Garapon gacha spends tickets first, guarantees Gold within pity, and equips won in-situ decor', () => {
  let state = createInitialState();
  assert.equal(state.tickets, 3);
  assert.equal(state.gachaPity, 2, 'new players reach first pity gold within 3 free tickets');

  // Force low-tier RNG (0.95) to verify soft pity still triggers Gold on spin #3
  const fixedLow = () => 0.95;
  const r1 = spinGacha(state, 1, fixedLow);
  assert.equal(r1.ok, true);
  assert.equal(r1.costType, 'ticket');
  assert.equal(r1.state.tickets, 2);
  assert.equal(r1.results[0].tier, 'green');
  assert.equal(r1.state.inventory.fish, state.inventory.fish + 3, 'green ball rewards dried fish snacks');

  const r2 = spinGacha(r1.state, 1, fixedLow);
  assert.equal(r2.ok, true);
  assert.equal(r2.state.tickets, 1);

  const r3 = spinGacha(r2.state, 1, fixedLow);
  assert.equal(r3.ok, true);
  assert.equal(r3.state.tickets, 0);
  assert.equal(r3.results[0].tier, 'gold', 'pity guarantees a Gold room decor or outfit on 3rd free ticket');
  assert.equal(r3.state.gachaPity, 0);

  // Immediately equip won gold prize into the room!
  const won = r3.results[0];
  const eq = equipDecor(r3.state, won.slot, won.decorId);
  assert.equal(eq.ok, true);
  assert.equal(eq.state.equippedDecor[won.slot], won.decorId);

  // With 0 tickets, falls back cleanly to main-game Coins (60 coins single spin)
  const r4 = spinGacha(eq.state, 1, fixedLow);
  assert.equal(r4.ok, true);
  assert.equal(r4.costType, 'coins');
  assert.equal(r4.state.coins, eq.state.coins - 60);

  // Clearing a room slot leaves it cleanly bare
  if (won.slot !== 'outfit') {
    const cleared = equipDecor(r4.state, won.slot, null);
    assert.equal(cleared.ok, true);
    assert.equal(cleared.state.equippedDecor[won.slot], null);
  }
});

test('Tuanzi coin earn/spend flows directly through the main game mobile_collection_wallets ledger', () => {
  const db = new DatabaseSync(':memory:');
  const photos = [...new Set(MOBILE_COLLECTION_CATALOG.packs.flatMap(p => p.imageIds))]
    .map(id => ({ id, title: id, src: `/${id}.webp`, thumbSrc: `/${id}-t.webp` }));
  const collection = createMobileCollection({ db, photos });
  const owner = 'shared-player-001';
  const now = DEFAULT_START_TS;

  // 1. Main game puzzle completion credits the shared collection wallet
  collection.awardCoins(owner, 'completion:room-1', 150, now);
  assert.equal(collection.coinsOf(owner), 150);

  // 2. Tuanzi syncs directly from the main game wallet (no separate coin balance!)
  let state = syncWalletCoins(createInitialState(), collection.coinsOf(owner));
  assert.equal(state.coins, 150);

  // 3. Buying in Tuanzi shop spends directly from main game's mobile_collection_wallets
  const bought = buyItem(state, 'bento');
  assert.equal(bought.ok, true);
  assert.equal(bought.coinDelta, -45);
  assert.ok(bought.ledgerSource.startsWith('tuanzi:shop:bento:'));
  assert.equal(collection.spendCoins(owner, bought.ledgerSource, -bought.coinDelta, now + 1000), 45);
  assert.equal(collection.coinsOf(owner), 105);
  // Idempotent replay does not double-spend
  assert.equal(collection.spendCoins(owner, bought.ledgerSource, -bought.coinDelta, now + 2000), 0);
  assert.equal(collection.coinsOf(owner), 105);

  // 4. Developing a postcard credits directly back into the same main game wallet
  const dev = completePostcard(bought.state, bought.state.postcards[0].uid);
  assert.equal(dev.coinDelta, 30);
  assert.equal(collection.awardCoins(owner, dev.ledgerSource, dev.coinDelta, now + 3000), 30);
  assert.equal(collection.coinsOf(owner), 135);

  // 5. Spending more than main game wallet balance is rejected cleanly with COINS_INSUFFICIENT
  assert.throws(
    () => collection.spendCoins(owner, 'tuanzi:gacha:5:overdraft', 280, now + 4000),
    err => err.code === 'COINS_INSUFFICIENT' && err.status === 409,
  );
  assert.equal(collection.coinsOf(owner), 135);
  db.close();
});

test('6 hand-painted storybook room scenes auto-resolve by season/weather and support manual switching', () => {
  assert.equal(ROOM_SCENES.length, 6);

  // Spring morning -> spring-sakura
  const springState = createInitialState(Date.parse('2026-04-08T09:30:00+08:00'));
  assert.equal(getDerivedView(springState).activeSceneId, 'spring-sakura');

  // Summer afternoon -> sunset-veranda; Summer evening -> summer-firefly
  const summerDay = createInitialState(Date.parse('2026-07-15T16:30:00+08:00'));
  assert.equal(getDerivedView(summerDay).activeSceneId, 'sunset-veranda');
  const summerNight = createInitialState(Date.parse('2026-07-15T20:30:00+08:00'));
  assert.equal(getDerivedView(summerNight).activeSceneId, 'summer-firefly');

  // Manual override switches directly to any of the 6 scenes with matching default weather
  let s = createInitialState();
  s = setSceneOverride(s, 'rainy-alley');
  assert.equal(getDerivedView(s).activeSceneId, 'rainy-alley');
  assert.equal(getDerivedView(s).weather, 'rain');

  s = setSceneOverride(s, 'sunset-veranda');
  assert.equal(getDerivedView(s).activeSceneId, 'sunset-veranda');

  s = setSceneOverride(s, 'auto');
  assert.equal(s.sceneOverride, null);
  assert.equal(getDerivedView(s).activeSceneId, 'autumn-day');
});

test('8 China travel postcards collect cleanly via travel synergies and track album milestones', () => {
  assert.equal(CHINA_POSTCARD_IDS.length, 8);
  for (const id of CHINA_POSTCARD_IDS) {
    const p = POSTCARD_POOL[id];
    assert.ok(p?.isChina && p.province && p.city && p.postmark && p.hint);
  }

  let s = createInitialState();
  const initialStats = getChinaCollectionStats(s);
  assert.equal(initialStats.collected, 1, 'starts with Hangzhou West Lake ready to develop');
  assert.equal(initialStats.developed, 0);

  // Packing Osmanthus Cake + Camera guides Tuanzi to Chengdu Bamboo Teahouse
  s = packBag(s, { food: 'osmanthus', tool: 'camera', wish: null });
  const sent = sendOffNow(s);
  assert.equal(sent.state.trip.cardId, 'cn-chengdu');
  const after = simulateTo(sent.state, sent.state.now + 15 * HOUR).state;
  const stats2 = getChinaCollectionStats(after);
  assert.equal(stats2.collected, 2);
  assert.ok(stats2.items.find(i => i.id === 'cn-chengdu')?.collected);
});

test('24-piece postcard completion unlocks 48-piece & main-game gallery, and all 5 rewarded ads respect daily caps', () => {
  let s = createInitialState();
  const hzUid = s.postcards[0].uid;

  // 1. 24-piece develop grants +30 coins, +1 ticket, and unlocks higher pieces / main gallery
  const dev24 = completePostcard(s, hzUid, 24);
  assert.equal(dev24.reward, 30);
  assert.equal(dev24.unlockedHigherPieces, true);
  assert.ok(dev24.state.unlockedMainGallery.includes('cn-hangzhou'));

  // 2. Completing unlocked 48-piece tier grants +50 bonus coins
  const dev48 = completePostcard(dev24.state, hzUid, 48);
  assert.equal(dev48.reward, 50);
  assert.ok(dev48.state.cleared48Postcards.includes('cn-hangzhou'));

  // 3. Ad P0: Puzzle double reward & Gacha free ticket
  const dbl = claimAdPuzzleDouble(dev48.state, hzUid, 30);
  assert.equal(dbl.ok, true);
  assert.equal(dbl.coinDelta, 30);
  assert.equal(getAdRemaining(dbl.state, 'puzzleDouble'), 2);

  const gAd = claimAdGachaTicket(dbl.state);
  assert.equal(gAd.ok, true);
  assert.equal(gAd.state.tickets, dbl.state.tickets + 1);
  assert.equal(getAdRemaining(gAd.state, 'gachaFree'), 2);

  // 4. Ad P1: China destination wish guarantees next trip goes to Harbin + Gugu express rush settles instantly
  const wished = claimAdChinaWish(gAd.state, 'cn-harbin');
  assert.equal(wished.ok, true);
  assert.equal(wished.state.nextGuaranteedCardId, 'cn-harbin');
  assert.equal(getAdRemaining(wished.state, 'chinaWish'), 0);
  assert.equal(claimAdChinaWish(wished.state, 'cn-beijing').ok, false, 'respects daily cap 1/day');

  const packed = packBag(wished.state, { food: 'onigiri', tool: null, wish: null });
  const sent = sendOffNow(packed);
  assert.equal(sent.state.trip.cardId, 'cn-harbin', 'guaranteed wish overrides default destination');

  const rushed = claimAdTripRush(sent.state);
  assert.equal(rushed.ok, true);
  assert.equal(rushed.state.status, 'home');
  assert.ok(rushed.state.postcards.some(c => c.templateId === 'cn-harbin'));

  // 5. Ad P2: Sill double fish snack
  const sillDbl = claimAdSillDouble(rushed.state);
  assert.equal(sillDbl.ok, true);
  assert.equal(sillDbl.gained, 4);
});
