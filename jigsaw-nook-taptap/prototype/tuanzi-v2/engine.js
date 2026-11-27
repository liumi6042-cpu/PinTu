// 「团子去旅行 2.0」纯函数确定性离线世界演进引擎（浏览器 & Node.js 通用）
import {
  DAY, HOUR, ITEMS, NPCS, PERSONALITIES, POSTCARD_POOL, SOUVENIRS,
  getCalendarInfo, matchSynergy,
} from './catalog.js';

/** 确定性伪随机生成器 (mulberry32) */
export function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 初始起点：设定在一个温暖的初秋午后（10月18日 15:20），方便直观体验 +30 天跨入初冬雪夜 */
export const DEFAULT_START_TS = Date.parse('2026-10-18T15:20:00+08:00');

export function createInitialState(startTs = DEFAULT_START_TS) {
  return {
    version: 2,
    startedAt: startTs,
    now: startTs,
    lastActiveAt: startTs,
    lastSimAt: startTs,
    fish: 16,
    status: 'home', // 'home' | 'away'
    pack: { food: null, tool: null, wish: null },
    pantry: ['onigiri', null, null], // 玄关备品篮（最多 3 份，离线多日自动续行）
    treatDish: 'osmanthus', // 窗台招待碟
    trip: null,
    trips: 0,
    inventory: {
      onigiri: 2,
      bento: 1,
      osmanthus: 1,
      camera: 1,
      umbrella: 1,
      'token-apang': 1,
      'wish-grandma': 1,
    },
    sill: { lastClaimedAt: startTs - 6 * HOUR }, // 初始窗台正好晒好 +4 小鱼干可领
    plantGrowth: 6, // 0..100（6=双叶小苗，45=抽枝，75=含苞，90+=垂蔓开冬花）
    dustLevel: 0, // 0..1（离家 >= 7 天浮起温暖阳光金尘，可手势拂去）
    winterScarfUnlocked: false,
    apangHouseguest: false,
    traits: { water: 1, street: 1, wild: 1, town: 2 },
    bonds: {
      apang: { xp: 0, level: 0, repliedIds: [] },
      grandpa: { xp: 15, level: 1, repliedIds: [] },
      gugu: { xp: 15, level: 1, repliedIds: [] },
      manman: { xp: 0, level: 0, repliedIds: [] },
    },
    postcards: [
      {
        uid: 'pc-init-1',
        templateId: 'grandma-shop',
        arrivedAt: startTs - 2 * HOUR,
        seasonLabel: '初秋',
        cnDate: '十月十八',
        read: false,
        developed: false,
      },
    ],
    letters: [],
    souvenirs: [], // { id, obtainedAt, tripNo, seasonLabel, placed: true }
    memories: [
      {
        id: 'mem-start',
        at: startTs,
        cnDate: '十月十八',
        title: '团子搬进奶奶小店',
        summary: '初秋的午后，小禾把绿花坐垫铺在窗下，团子蜷成一团睡着了。',
      },
    ],
    reunion: null, // { awayDays, pages: [...], giftId, seen: false, claimed: false }
    logs: ['十月十八 初秋午后 · 团子搬进了奶奶的小店。'],
    weatherOverride: null, // null = 随真实公历自动，或 'snow' | 'rain' | 'autumn' | 'sakura' | 'firefly'
  };
}

function addBondXp(state, npcId, delta) {
  const b = state.bonds[npcId];
  if (!b) return false;
  const oldLv = b.level;
  b.xp = Math.min(100, b.xp + delta);
  // 四阶羁绊阈值：10 -> Lv1, 35 -> Lv2, 65 -> Lv3, 90 -> Lv4
  const nextLv = b.xp >= 90 ? 4 : b.xp >= 65 ? 3 : b.xp >= 35 ? 2 : b.xp >= 10 ? 1 : 0;
  b.level = Math.max(oldLv, nextLv);
  if (npcId === 'apang' && b.level >= 3) state.apangHouseguest = true;
  return b.level > oldLv;
}

function ensurePostcard(state, templateId, at, { allowFallback = true } = {}) {
  const tpl = POSTCARD_POOL[templateId];
  if (!tpl) return null;
  const cal = getCalendarInfo(at);
  const existing = state.postcards.find(c => c.templateId === templateId);
  if (existing) {
    if (!allowFallback) return null;
    const unseen = Object.keys(POSTCARD_POOL).find(id => !state.postcards.some(c => c.templateId === id));
    if (unseen) return ensurePostcard(state, unseen, at, { allowFallback: false });
    return null;
  }
  const card = {
    uid: `pc-${templateId}-${Math.floor(at / 60000)}`,
    templateId,
    arrivedAt: at,
    seasonLabel: cal.seasonLabel,
    cnDate: cal.cnDate,
    read: false,
    developed: false,
  };
  state.postcards.unshift(card);
  return card;
}

function ensureLetter(state, npcId, at) {
  const npc = NPCS[npcId];
  if (!npc) return null;
  const nextTpl = npc.letters.find(l => !state.letters.some(x => x.npcId === npcId && x.step === l.step));
  if (!nextTpl) return null;
  const cal = getCalendarInfo(at);
  const letter = {
    uid: `lt-${npcId}-${nextTpl.step}`,
    npcId,
    step: nextTpl.step,
    arrivedAt: at,
    cnDate: cal.cnDate,
    read: false,
    chosenReplyId: null,
  };
  state.letters.unshift(letter);
  return letter;
}

function ensureSouvenir(state, souvenirId, at, tripNo) {
  if (!SOUVENIRS[souvenirId]) return null;
  if (state.souvenirs.some(s => s.id === souvenirId)) return null;
  const cal = getCalendarInfo(at);
  const entry = {
    id: souvenirId,
    obtainedAt: at,
    placedAt: at,
    tripNo,
    seasonLabel: cal.seasonLabel,
    placed: true,
  };
  state.souvenirs.push(entry);
  return entry;
}

function planTrip(state, at, pack, source = 'manual') {
  const r = seeded((at & 0xffffffff) ^ (state.trips * 2654435761));
  const food = ITEMS[pack.food] || ITEMS.onigiri;
  const syn = matchSynergy(pack);
  const hours = food.hours[0] + (food.hours[1] - food.hours[0]) * r();
  const returnAt = Math.round(at + hours * HOUR);

  let cardId = syn?.cardId;
  if (!cardId) {
    const candidates = food.id === 'bento'
      ? ['misty-lake', 'rainy-bookshop', 'moon-aquarium']
      : food.id === 'osmanthus'
        ? ['breakfast-street', 'cloud-post', 'starry-camp']
        : ['misty-lake', 'breakfast-street', 'starry-camp'];
    cardId = candidates.find(id => !state.postcards.some(c => c.templateId === id))
      || candidates[Math.floor(r() * candidates.length)];
  }
  const tpl = POSTCARD_POOL[cardId];
  const souvenirOrder = ['windchime', 'sailboat', 'jellyfish'];
  const nextSouvenir = souvenirOrder.find(id => !state.souvenirs.some(s => s.id === id)) || null;

  return {
    id: `trip-${state.trips + 1}-${Math.floor(at / 60000)}`,
    source,
    food: food.id,
    tool: pack.tool || null,
    wish: pack.wish || null,
    synergyId: syn?.id || null,
    departedAt: at,
    postcardAt: Math.round(at + hours * HOUR * 0.52),
    returnAt,
    cardId,
    cardSent: false,
    npcId: syn?.npcId || tpl.npcId,
    souvenirId: nextSouvenir,
    returned: false,
  };
}

function settleTripAt(state, now, events) {
  const trip = state.trip;
  if (!trip || state.status !== 'away') return;

  if (!trip.cardSent && now >= trip.postcardAt) {
    trip.cardSent = true;
    const card = ensurePostcard(state, trip.cardId, trip.postcardAt);
    if (card) {
      const tpl = POSTCARD_POOL[card.templateId];
      events.push(`寄回了明信片《${tpl.title}》`);
    }
  }

  if (now >= trip.returnAt) {
    trip.returned = true;
    state.status = 'home';
    const tpl = POSTCARD_POOL[trip.cardId];
    if (tpl) state.traits[tpl.region] = (state.traits[tpl.region] || 0) + 3;
    if (trip.npcId) {
      const leveled = addBondXp(state, trip.npcId, 25);
      if (leveled) events.push(`与${NPCS[trip.npcId].name}的关系更近了一步`);
    }
    if (trip.souvenirId) {
      const sv = ensureSouvenir(state, trip.souvenirId, trip.returnAt, state.trips);
      if (sv) events.push(`带回了风物「${SOUVENIRS[sv.id].name}」并摆上木架`);
    }
    // 归来概率收到对应伙伴来信
    if (trip.npcId) {
      const lt = ensureLetter(state, trip.npcId, trip.returnAt + 20 * 60 * 1000);
      if (lt) events.push(`收到来自${NPCS[lt.npcId].name}的拾光来信`);
    }
    state.trip = null;
  }
}

/**
 * 核心确定性惰性演进：从 state.lastSimAt 推进到 targetNow
 * 不论离开 4 小时、7 天、30 天还是 90 天，单次 O(min(days, 60)) 平滑演进，零惩罚、零信息轰炸！
 */
export function simulateTo(prevState, targetNow) {
  const state = structuredClone(prevState);
  if (targetNow <= state.now) return { state, summary: [] };

  const awayMs = targetNow - state.lastActiveAt;
  const awayDays = awayMs / DAY;
  const startCal = getCalendarInfo(state.lastActiveAt);
  const endCal = getCalendarInfo(targetNow);
  const events = [];

  // 1. 若玩家已装包在家且离开 >= 20 分钟，自动出发第一趟
  if (state.status === 'home' && state.pack.food && awayMs >= 20 * 60 * 1000) {
    const departAt = state.lastActiveAt + 18 * 60 * 1000;
    const bagCopy = { ...state.pack };
    state.pack = { food: null, tool: null, wish: null };
    state.trips += 1;
    state.trip = planTrip(state, departAt, bagCopy, 'bag');
    state.status = 'away';
    events.push(`背着「${ITEMS[bagCopy.food].name}」悄悄出发了`);
  }

  // 2. 分步推进（短离按实时，多日按天演进，上限 60 步）
  const spanDays = Math.max(0, Math.floor((targetNow - state.lastSimAt) / DAY));
  const steps = Math.min(60, Math.max(1, spanDays));

  for (let i = 1; i <= steps; i++) {
    const t = i === steps ? targetNow : Math.round(state.lastSimAt + ((targetNow - state.lastSimAt) * i) / steps);

    // 结算在途行程
    settleTripAt(state, t, events);

    // 若在家且离开多日，检查玄关备品篮自动续航
    if (state.status === 'home' && spanDays >= 1) {
      const pantryIdx = state.pantry.findIndex(Boolean);
      if (pantryIdx !== -1 && t < targetNow - 6 * HOUR) {
        const foodId = state.pantry[pantryIdx];
        state.pantry[pantryIdx] = null;
        const autoTool = state.inventory.camera ? 'camera' : state.inventory.umbrella ? 'umbrella' : null;
        state.trips += 1;
        state.trip = planTrip(state, t, { food: foodId, tool: autoTool, wish: null }, 'pantry');
        state.status = 'away';
        events.push(`从玄关备品篮叼了「${ITEMS[foodId].name}」自主出发`);
        settleTripAt(state, Math.min(targetNow, t + 14 * HOUR), events);
      }
    }

    // 窗台时光盆栽自然生长（永不枯死，离线也会悄悄抽枝开花）
    if (spanDays >= 1) {
      state.plantGrowth = Math.min(100, state.plantGrowth + (spanDays >= 20 ? 3.2 : 2.8));
    }
  }

  // 3. 中长期离线（>= 3 天）：无粮兜底自主日常 & 邻居串门 & 关系自然升温
  if (awayDays >= 3) {
    // 招待碟吸引访客
    const dishItem = state.treatDish ? ITEMS[state.treatDish] : null;
    const visitorId = dishItem?.treatTarget || 'grandpa';
    addBondXp(state, visitorId, 18);
    if (state.treatDish) {
      events.push(`${NPCS[visitorId].name}闻着窗台的「${dishItem.name}」来串了门`);
      state.treatDish = null;
    }
    ensureLetter(state, visitorId, targetNow - DAY);
    state.traits.street += 2;
    state.traits.water += 2;
  }

  // 4. 久别（>= 7 天）：阳光微尘 + 阿胖升温 + 浓缩重逢手账
  if (awayDays >= 7) {
    const roundedDays = Math.round(awayDays);
    state.dustLevel = awayDays >= 20 ? 1 : 0.65;
    state.plantGrowth = Math.min(100, Math.max(state.plantGrowth, awayDays >= 20 ? 96 : 62));

    // 确保关系演进与核心风物、跨季明信片沉淀（精选压缩，绝不垃圾轰炸）
    addBondXp(state, 'apang', awayDays >= 20 ? 70 : 35);
    addBondXp(state, 'grandpa', awayDays >= 20 ? 35 : 20);
    addBondXp(state, 'gugu', awayDays >= 20 ? 35 : 20);
    addBondXp(state, 'manman', awayDays >= 20 ? 20 : 12);

    if (state.postcards.length < 6) ensurePostcard(state, 'misty-lake', state.lastActiveAt + 2 * DAY, { allowFallback: false });
    if (state.postcards.length < 6) ensurePostcard(state, 'rainy-bookshop', state.lastActiveAt + Math.max(3, Math.floor(awayDays * 0.45)) * DAY, { allowFallback: false });
    if (awayDays >= 14 && state.postcards.length < 6) {
      ensurePostcard(state, 'starry-camp', targetNow - 3 * DAY, { allowFallback: false });
    }
    ensureSouvenir(state, 'windchime', state.lastActiveAt + 4 * DAY, Math.max(2, state.trips));
    if (awayDays >= 14) {
      ensureSouvenir(state, 'sailboat', state.lastActiveAt + 10 * DAY, Math.max(3, state.trips));
      ensureSouvenir(state, 'jellyfish', targetNow - 5 * DAY, Math.max(4, state.trips));
    }
    ensureLetter(state, 'apang', state.lastActiveAt + 5 * DAY);
    if (awayDays >= 15) {
      ensureLetter(state, 'apang', targetNow - 2 * DAY);
      ensureLetter(state, 'gugu', targetNow - DAY);
      state.winterScarfUnlocked = true;
      state.apangHouseguest = true;
      ensureSouvenir(state, 'red-scarf', targetNow - DAY, Math.max(5, state.trips));
      state.inventory['token-manman'] = 1;
    }

    // 生成 4 页浓缩绘本手账《你不在的这些日子》
    const dayMid1 = getCalendarInfo(state.lastActiveAt + Math.round(awayDays * 0.18) * DAY);
    const dayMid2 = getCalendarInfo(state.lastActiveAt + Math.round(awayDays * 0.48) * DAY);
    const dayMid3 = getCalendarInfo(state.lastActiveAt + Math.round(awayDays * 0.82) * DAY);

    const pages = [
      {
        act: '第一幕',
        dateLine: `${dayMid1.cnDate} · 雾湖码头 · 晨雾`,
        photo: './assets/postcards/misty-lake.webp',
        photoCapLeft: '雾湖码头的金光',
        photoCapRight: dayMid1.cnDate,
        prose: `你离开后的头几天，团子背着装好的旧布包去了雾湖码头。清晨湖面起雾的时候，它安静地坐在木栈道尽头，替你看了整场日出，还捡回一串会响的贝壳风铃。`,
        stampPortrait: NPCS.manman.portrait,
        stampTitle: '新风物 · 贝壳风铃已挂上顶层木架',
        stampSub: '摆满半月后，起风时团子总爱抬头拨弄它。',
      },
      {
        act: '第二幕',
        dateLine: `${dayMid2.cnDate} · 旧书巷 · 小雨`,
        photo: './assets/postcards/rainy-bookshop.webp',
        photoCapLeft: '旧书巷的屋檐下',
        photoCapRight: dayMid2.cnDate,
        prose: `备品篮里的饭团吃完了，福爷爷每天路过都留半个温包子。下雨那天在旧书巷，大橘阿胖把半条小鱼干推给我——后来你不在的日子，它常翻窗来小窝陪我打盹。`,
        stampPortrait: NPCS.apang.portrait,
        stampTitle: '新记事 · 与阿胖成了挚友',
        stampSub: '如今它常来小窝角落蒲团蹭午睡，不再怕生了。',
      },
      {
        act: '第三幕',
        dateLine: `${dayMid3.cnDate} · 星空营地 · 晚风`,
        photo: './assets/postcards/starry-camp.webp',
        photoCapLeft: '寒星下的松果营地',
        photoCapRight: dayMid3.cnDate,
        prose: `天气渐渐转凉，窗台的小苗一路爬藤开出了细白小花。咕咕局长怕信箱塞不下，把明信片和来信用红丝带扎成整齐的一捆，轻轻放在门口木凳上等你回来。`,
        stampPortrait: NPCS.gugu.portrait,
        stampTitle: `时光流转 · ${startCal.seasonLabel}悄悄走到了${endCal.seasonLabel}`,
        stampSub: '窗外景致已换季，屋里的玻璃台灯替你一直留着暖光。',
      },
      {
        act: '重逢礼',
        dateLine: `${endCal.cnDate} · 奶奶的小店 · 等你归来`,
        photo: './assets/rooms/day30-reunion-full.webp',
        photoCapLeft: '团子的重逢礼物',
        photoCapRight: endCal.cnDate,
        prose: `离开的这 ${roundedDays} 天里，团子没有一刻孤单，却一直在窗台等你推门。它和福爷爷、阿胖一起为你备好了一份重逢礼——戴上暖绒红围巾，它正跑过来蹭你的手呢。`,
        stampPortrait: NPCS.grandpa.portrait,
        stampTitle: '等你的礼物 · 冬日红绒围巾 & +18 条小鱼干',
        stampSub: '小窝已点亮所有收藏与红丝带信捆。',
        isGiftPage: true,
      },
    ];

    state.reunion = {
      id: `reunion-${Math.floor(targetNow / DAY)}`,
      awayDays: roundedDays,
      fromLabel: `${startCal.cnDate}（${startCal.seasonLabel}）`,
      toLabel: `${endCal.cnDate}（${endCal.seasonLabel}）`,
      pages,
      giftFish: Math.min(24, 10 + Math.floor(awayDays * 0.4)),
      seen: false,
      claimed: false,
    };

    state.memories.unshift({
      id: `mem-reunion-${roundedDays}-${Math.floor(targetNow / DAY)}`,
      at: targetNow,
      cnDate: endCal.cnDate,
      title: `阔别${roundedDays}日后的重逢`,
      summary: `从${startCal.seasonLabel}走到${endCal.seasonLabel}，窗台藤蔓开了花，阿胖也成了小窝常客。`,
    });
    events.push(`生成《你不在的这 ${roundedDays} 天》四幕重逢手账`);
  }

  // 离家久了团子一定在家等你推门
  if (awayDays >= 5 && state.status === 'away') {
    state.status = 'home';
    state.trip = null;
  }

  state.now = targetNow;
  state.lastSimAt = targetNow;
  state.lastActiveAt = targetNow;

  if (events.length) {
    state.logs = [`[${endCal.cnDate}] ${events.join('；')}`, ...state.logs].slice(0, 16);
  }
  return { state, summary: events };
}

/** 玩家行为：装入/卸下旧布包 */
export function packBag(prevState, nextPack) {
  const state = structuredClone(prevState);
  if (state.status === 'away') return state;

  for (const slot of ['food', 'tool', 'wish']) {
    const oldId = state.pack[slot];
    const newId = nextPack[slot] ?? null;
    if (oldId === newId) continue;
    if (oldId && !ITEMS[oldId]?.permanent) {
      state.inventory[oldId] = (state.inventory[oldId] || 0) + 1;
    }
    if (newId && !ITEMS[newId]?.permanent) {
      if ((state.inventory[newId] || 0) <= 0) continue;
      state.inventory[newId] -= 1;
    }
    state.pack[slot] = newId;
  }
  return state;
}

/** 玩家行为：轻推小门，立刻送团子出发 */
export function sendOffNow(prevState) {
  const state = structuredClone(prevState);
  if (state.status === 'away' || !state.pack.food) return { state, departed: false };
  const bagCopy = { ...state.pack };
  state.pack = { food: null, tool: null, wish: null };
  state.trips += 1;
  state.trip = planTrip(state, state.now, bagCopy, 'manual');
  state.status = 'away';
  const cal = getCalendarInfo(state.now);
  state.logs = [`[${cal.cnDate}] 轻推小门，送背着「${ITEMS[bagCopy.food].name}」的团子出门旅行。`, ...state.logs].slice(0, 16);
  return { state, departed: true };
}

/** 玩家行为：设置玄关备品篮槽位（0..2） */
export function togglePantrySlot(prevState, slotIndex, foodId) {
  const state = structuredClone(prevState);
  if (slotIndex < 0 || slotIndex > 2) return state;
  const current = state.pantry[slotIndex];
  if (current) {
    state.inventory[current] = (state.inventory[current] || 0) + 1;
    state.pantry[slotIndex] = null;
    if (current === foodId) return state;
  }
  if (foodId && (state.inventory[foodId] || 0) > 0) {
    state.inventory[foodId] -= 1;
    state.pantry[slotIndex] = foodId;
  }
  return state;
}

/** 玩家行为：放窗台招待碟 */
export function setTreatDish(prevState, foodId) {
  const state = structuredClone(prevState);
  if (state.treatDish === foodId) {
    if (foodId) state.inventory[foodId] = (state.inventory[foodId] || 0) + 1;
    state.treatDish = null;
    return state;
  }
  if (state.treatDish) {
    state.inventory[state.treatDish] = (state.inventory[state.treatDish] || 0) + 1;
  }
  if (foodId && (state.inventory[foodId] || 0) > 0) {
    state.inventory[foodId] -= 1;
    state.treatDish = foodId;
  }
  return state;
}

/** 玩家行为：杂货铺用小鱼干购买 */
export function buyItem(prevState, itemId) {
  const item = ITEMS[itemId];
  if (!item || item.price <= 0) return { state: prevState, ok: false, reason: '不可购买' };
  if (item.permanent && prevState.inventory[itemId] > 0) return { state: prevState, ok: false, reason: '已经拥有这件器物啦' };
  if (prevState.fish < item.price) return { state: prevState, ok: false, reason: '小鱼干还差一点，拼张明信片或等窗台晒好吧' };
  const state = structuredClone(prevState);
  state.fish -= item.price;
  state.inventory[itemId] = (state.inventory[itemId] || 0) + 1;
  const cal = getCalendarInfo(state.now);
  state.logs = [`[${cal.cnDate}] 在杂货铺换了「${item.name}」（-${item.price} 鱼干）。`, ...state.logs].slice(0, 16);
  return { state, ok: true };
}

/** 玩家行为：收下窗台晒好的小鱼干 */
export function claimSill(prevState) {
  const portions = getSillPortions(prevState);
  if (portions <= 0) return { state: prevState, gained: 0 };
  const state = structuredClone(prevState);
  const gained = portions * 2;
  state.fish += gained;
  state.sill.lastClaimedAt = state.now;
  return { state, gained };
}

export function getSillPortions(state) {
  const elapsed = Math.max(0, state.now - state.sill.lastClaimedAt);
  return Math.min(3, Math.floor(elapsed / (3 * HOUR)));
}

/** 玩家行为：完成明信片显影拼图 */
export function completePostcard(prevState, uid) {
  const state = structuredClone(prevState);
  const card = state.postcards.find(c => c.uid === uid);
  if (!card) return { state, reward: 0 };
  const newly = !card.developed;
  card.read = true;
  card.developed = true;
  let reward = 0;
  if (newly) {
    reward = 4;
    state.fish += reward;
    const tpl = POSTCARD_POOL[card.templateId];
    if (tpl) state.traits[tpl.region] = (state.traits[tpl.region] || 0) + 1;
    const cal = getCalendarInfo(state.now);
    state.logs = [`[${cal.cnDate}] 显影完成了明信片《${tpl?.title || '旅拍'}》（+4 小鱼干）。`, ...state.logs].slice(0, 16);
  }
  return { state, reward };
}

/** 玩家行为：给拾光来信贴上折纸回信 */
export function replyLetter(prevState, uid, choiceId) {
  const state = structuredClone(prevState);
  const letter = state.letters.find(l => l.uid === uid);
  if (!letter || letter.chosenReplyId) return { state, ok: false };
  const npc = NPCS[letter.npcId];
  const tpl = npc?.letters.find(l => l.step === letter.step);
  const choice = tpl?.choices.find(c => c.id === choiceId);
  if (!choice) return { state, ok: false };
  letter.read = true;
  letter.chosenReplyId = choiceId;
  addBondXp(state, choice.bonusNpc || letter.npcId, 16);
  const cal = getCalendarInfo(state.now);
  state.memories.unshift({
    id: `mem-reply-${uid}`,
    at: state.now,
    cnDate: cal.cnDate,
    title: `回信给${npc.name}`,
    summary: choice.memory,
  });
  state.logs = [`[${cal.cnDate}] 折好纸条托咕咕寄给了${npc.name}：${choice.label}`, ...state.logs].slice(0, 16);
  return { state, ok: true };
}

/** 玩家行为：拆开重逢手账礼物 */
export function claimReunionGift(prevState) {
  const state = structuredClone(prevState);
  if (!state.reunion || state.reunion.claimed) return { state, fish: 0 };
  state.reunion.seen = true;
  state.reunion.claimed = true;
  const fish = state.reunion.giftFish || 18;
  state.fish += fish;
  state.winterScarfUnlocked = true;
  const cal = getCalendarInfo(state.now);
  state.logs = [`[${cal.cnDate}] 拆开重逢礼物：获得冬日红绒围巾与 +${fish} 条小鱼干。`, ...state.logs].slice(0, 16);
  return { state, fish };
}

/** 玩家行为：拂去阳光金尘 */
export function clearDust(prevState) {
  const state = structuredClone(prevState);
  state.dustLevel = 0;
  return state;
}

/** 计算派生视图：主导性格、房间演化阶段、有效天气、未读数等 */
export function getDerivedView(state) {
  const cal = getCalendarInfo(state.now);
  const daysTogether = Math.max(1, Math.floor((state.now - state.startedAt) / DAY) + 1);
  const isEvolvedRoom = daysTogether >= 14 || state.souvenirs.length >= 2 || state.apangHouseguest || cal.season === 'winter';
  const weather = state.weatherOverride || cal.defaultWeather;

  // 主导气质（用于手盖红泥印章，摒弃冰冷百分比）
  const entries = Object.entries(state.traits);
  entries.sort((a, b) => b[1] - a[1]);
  const topTrait = entries[0]?.[0] || 'town';
  const personality = PERSONALITIES[topTrait] || PERSONALITIES.town;

  const unreadPostcards = state.postcards.filter(c => !c.read || !c.developed).length;
  const unreadLetters = state.letters.filter(l => !l.chosenReplyId).length;

  const plantStageLabel =
    state.plantGrowth >= 90 ? '垂蔓已开冬花'
      : state.plantGrowth >= 60 ? '青藤爬上窗格'
        : state.plantGrowth >= 30 ? '抽出嫩绿新枝'
          : '双叶时光小苗';

  return {
    cal,
    daysTogether,
    isEvolvedRoom,
    weather,
    personality,
    sillPortions: getSillPortions(state),
    unreadPostcards,
    unreadLetters,
    unreadTotal: unreadPostcards + unreadLetters,
    plantStageLabel,
    synergy: matchSynergy(state.pack),
    hasPendingReunion: Boolean(state.reunion && !state.reunion.claimed),
  };
}
