import assert from 'node:assert/strict';
import test from 'node:test';
import { DAY, HOUR, NPCS, getCalendarInfo, matchSynergy } from './catalog.js';
import {
  DEFAULT_START_TS,
  buyItem,
  claimReunionGift,
  claimSill,
  clearDust,
  completePostcard,
  createInitialState,
  equipDecor,
  feedSnack,
  getDerivedView,
  packBag,
  replyLetter,
  sendOffNow,
  simulateTo,
  spinGacha,
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
