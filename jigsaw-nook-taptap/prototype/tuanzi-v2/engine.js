// 「团子去旅行 2.0」纯函数确定性离线世界演进引擎（浏览器 & Node.js 通用）
import {
  CHINA_POSTCARD_IDS, DAY, DECOR_ITEMS, GACHA_CONFIG, HOUR, ITEMS, NPCS, PERSONALITIES, POSTCARD_POOL,
  ROOM_SCENE_MAP, SOUVENIRS, getCalendarInfo, matchSynergy,
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
    version: 4,
    startedAt: startTs,
    now: startTs,
    lastActiveAt: startTs,
    lastSimAt: startTs,
    coins: 180, // 与《拼图小窝》主游戏统一使用金币（完成一局 48 片拼图约得 72 金币）
    tickets: 3, // 奶奶摇奖匣「旅途副券」（初始赠 3 张，旅行归来/明信片显影/重逢都会送）
    gachaPity: 2, // 初始距首次保底暖金仅 3 抽，新手用自带 3 张免费副券必得 1 件珍品摆件/穿搭！
    gachaTotal: 0,
    ownedDecor: ['win-teru', 's1l-teapot', 's2l-vase', 'outfit-default'],
    equippedDecor: {
      desk: null,
      window: 'win-teru',
      shelf1L: null,
      shelf1R: null,
      shelf2L: 's2l-vase',
      shelf2R: null,
      shelf3: null,
      outfit: 'outfit-default',
    },
    status: 'home', // 'home' | 'away'
    pack: { food: null, tool: null, wish: null },
    pantry: ['onigiri', null, null], // 玄关备品篮（最多 3 份，离线多日自动续行）
    treatDish: 'fish', // 窗台招待碟（摆上小鱼干零食，最吸引大橘阿胖来串门）
    trip: null,
    trips: 0,
    inventory: {
      fish: 3, // 小鱼干现在是团子的专属零食，可投喂、装包或摆招待碟
      onigiri: 2,
      bento: 1,
      osmanthus: 1,
      camera: 1,
      umbrella: 1,
      'token-apang': 1,
      'wish-grandma': 1,
    },
    sill: { lastClaimedAt: startTs - 6 * HOUR }, // 初始窗台正好晒好 2 条香酥小鱼干零食可收
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
        uid: 'pc-init-cn-hz',
        templateId: 'cn-hangzhou',
        arrivedAt: startTs - 1 * HOUR,
        seasonLabel: '初秋',
        cnDate: '十月十八',
        read: false,
        developed: false,
      },
      {
        uid: 'pc-init-1',
        templateId: 'grandma-shop',
        arrivedAt: startTs - 3 * HOUR,
        seasonLabel: '初秋',
        cnDate: '十月十八',
        read: true,
        developed: true,
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
    sceneOverride: null, // null = 随公历与气候自动切换，或 6 套 ROOM_SCENES id 之一
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
    const unseenChina = CHINA_POSTCARD_IDS.find(id => !state.postcards.some(c => c.templateId === id));
    const unseen = unseenChina || Object.keys(POSTCARD_POOL).find(id => !state.postcards.some(c => c.templateId === id));
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

function unlockDecor(state, decorId, autoEquipIfEmpty = false) {
  if (!DECOR_ITEMS[decorId]) return false;
  if (!Array.isArray(state.ownedDecor)) state.ownedDecor = ['win-teru', 's1l-teapot', 's2l-vase', 'outfit-default'];
  const newly = !state.ownedDecor.includes(decorId);
  if (newly) state.ownedDecor.push(decorId);
  const item = DECOR_ITEMS[decorId];
  if (autoEquipIfEmpty && state.equippedDecor && !state.equippedDecor[item.slot]) {
    state.equippedDecor[item.slot] = decorId;
  }
  return newly;
}

function ensureSouvenir(state, souvenirId, at, tripNo) {
  if (!SOUVENIRS[souvenirId]) return null;
  // 旅途风物自动同步解锁对应的原地融合小窝摆件
  const linked = Object.values(DECOR_ITEMS).find(d => d.souvenirLink === souvenirId);
  if (linked) unlockDecor(state, linked.id, true);
  if (souvenirId === 'red-scarf') unlockDecor(state, 'outfit-redscarf', false);
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
    const cal = getCalendarInfo(at);
    const byFood = food.id === 'bento'
      ? ['cn-guilin', 'cn-xiamen', 'cn-harbin', 'cn-dali']
      : food.id === 'osmanthus'
        ? ['cn-hangzhou', 'cn-chengdu', 'cn-beijing', 'cn-suzhou']
        : food.id === 'fish'
          ? ['cn-chengdu', 'cn-xiamen', 'cn-suzhou', 'cn-guilin']
          : ['cn-suzhou', 'cn-dali', 'cn-hangzhou', 'cn-chengdu'];
    const seasonalLead = cal.season === 'winter' ? ['cn-beijing', 'cn-harbin'] : [];
    const candidates = [...new Set([...seasonalLead, ...byFood, ...CHINA_POSTCARD_IDS])];
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
    // 每次旅行归来获赠 1 张免费旅途副券
    state.tickets = (state.tickets || 0) + 1;
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

    if (state.postcards.length < 6) ensurePostcard(state, 'cn-beijing', state.lastActiveAt + 2 * DAY, { allowFallback: false });
    if (state.postcards.length < 6) ensurePostcard(state, 'cn-guilin', state.lastActiveAt + Math.max(3, Math.floor(awayDays * 0.45)) * DAY, { allowFallback: false });
    if (awayDays >= 14 && state.postcards.length < 6) {
      ensurePostcard(state, 'cn-harbin', targetNow - 3 * DAY, { allowFallback: false });
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
        stampTitle: '等你的礼物 · 冬日红绒围巾 & +120 金币',
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
      giftCoins: Math.min(180, 60 + Math.floor(awayDays * 2)),
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

/** 将主游戏共享钱包余额同步到团子视图状态（唯一真源为主游戏 mobile_collection_wallets） */
export function syncWalletCoins(prevState, mainGameCoins) {
  const coins = Math.max(0, Math.floor(Number(mainGameCoins) || 0));
  if (prevState.coins === coins) return prevState;
  const state = structuredClone(prevState);
  state.coins = coins;
  return state;
}

/** 玩家行为：杂货铺直接使用主游戏共享金币购买 */
export function buyItem(prevState, itemId) {
  const item = ITEMS[itemId];
  if (!item || item.price <= 0) return { state: prevState, ok: false, reason: '不可购买', coinDelta: 0, ledgerSource: null };
  if (item.permanent && prevState.inventory[itemId] > 0) return { state: prevState, ok: false, reason: '已经拥有这件器物啦', coinDelta: 0, ledgerSource: null };
  if (prevState.coins < item.price) return { state: prevState, ok: false, reason: '主游戏金币不够啦，拼一张图或显影明信片就能攒到', coinDelta: 0, ledgerSource: null };
  const state = structuredClone(prevState);
  state.coins -= item.price;
  state.inventory[itemId] = (state.inventory[itemId] || 0) + 1;
  state.walletTxSeq = (state.walletTxSeq || 0) + 1;
  const cal = getCalendarInfo(state.now);
  state.logs = [`[${cal.cnDate}] 在杂货铺换了「${item.name}」（主游戏钱包 -${item.price} 金币）。`, ...state.logs].slice(0, 16);
  return { state, ok: true, coinDelta: -item.price, ledgerSource: `tuanzi:shop:${itemId}:${state.now}:${state.walletTxSeq}` };
}

/** 玩家行为：收下窗台晒好的香酥小鱼干零食（进入零食库，不再是货币） */
export function claimSill(prevState) {
  const portions = getSillPortions(prevState);
  if (portions <= 0) return { state: prevState, gained: 0 };
  const state = structuredClone(prevState);
  const gained = portions; // 每 3 小时晒好 1 条香酥小鱼干，最多叠 3 条
  state.inventory.fish = (state.inventory.fish || 0) + gained;
  state.sill.lastClaimedAt = state.now;
  const cal = getCalendarInfo(state.now);
  state.logs = [`[${cal.cnDate}] 收下窗台晒好的 ${gained} 条香酥小鱼干零食。`, ...state.logs].slice(0, 16);
  return { state, gained };
}

/** 玩家行为：直接投喂一条香酥小鱼干零食给团子 */
export function feedSnack(prevState) {
  if (prevState.status === 'away') return { state: prevState, ok: false, reason: '团子出门旅行中，回来再喂它吃小鱼干吧' };
  if ((prevState.inventory.fish || 0) <= 0) return { state: prevState, ok: false, reason: '小鱼干零食吃完啦，等窗台晒好或去杂货铺买一点吧' };
  const state = structuredClone(prevState);
  state.inventory.fish -= 1;
  state.traits.town = (state.traits.town || 0) + 1;
  addBondXp(state, 'apang', 4);
  const cal = getCalendarInfo(state.now);
  state.logs = [`[${cal.cnDate}] 给团子喂了一条香酥小鱼干，它开心得直呼噜。`, ...state.logs].slice(0, 16);
  return { state, ok: true };
}

export function getSillPortions(state) {
  const elapsed = Math.max(0, state.now - state.sill.lastClaimedAt);
  return Math.min(3, Math.floor(elapsed / (3 * HOUR)));
}

/** 玩家行为：完成明信片显影拼图（奖励主游戏金币） */
export function completePostcard(prevState, uid) {
  const state = structuredClone(prevState);
  const card = state.postcards.find(c => c.uid === uid);
  if (!card) return { state, reward: 0 };
  const newly = !card.developed;
  card.read = true;
  card.developed = true;
  let reward = 0;
  let ticketReward = 0;
  if (newly) {
    reward = 30;
    ticketReward = 1;
    state.coins += reward;
    state.tickets = (state.tickets || 0) + ticketReward;
    const tpl = POSTCARD_POOL[card.templateId];
    if (tpl) state.traits[tpl.region] = (state.traits[tpl.region] || 0) + 1;
    const cal = getCalendarInfo(state.now);
    state.logs = [`[${cal.cnDate}] 显影完成了明信片《${tpl?.title || '旅拍'}》（+30 金币、+1 副券）。`, ...state.logs].slice(0, 16);
  }
  return {
    state,
    reward,
    ticketReward,
    coinDelta: reward,
    ledgerSource: reward > 0 ? `tuanzi:postcard:${uid}` : null,
  };
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
  if (!state.reunion || state.reunion.claimed) return { state, coins: 0, tickets: 0, coinDelta: 0, ledgerSource: null };
  state.reunion.seen = true;
  state.reunion.claimed = true;
  const coins = state.reunion.giftCoins || 120;
  const tickets = 3;
  state.coins += coins;
  state.tickets = (state.tickets || 0) + tickets;
  state.winterScarfUnlocked = true;
  unlockDecor(state, 'outfit-redscarf', false);
  if (state.equippedDecor) state.equippedDecor.outfit = 'outfit-redscarf';
  const cal = getCalendarInfo(state.now);
  state.logs = [`[${cal.cnDate}] 拆开重逢礼物：获得冬日红绒围巾、+${coins} 金币（入主游戏钱包）与 +${tickets} 张旅途副券。`, ...state.logs].slice(0, 16);
  return { state, coins, tickets, coinDelta: coins, ledgerSource: `tuanzi:reunion:${state.reunion.id}` };
}

/** 玩家行为：实时装扮小窝（原地无痕切换任意摆件或团子穿搭） */
export function equipDecor(prevState, slotId, decorId) {
  const state = structuredClone(prevState);
  if (!state.equippedDecor) state.equippedDecor = { outfit: 'outfit-default' };
  if (decorId === null || decorId === '') {
    if (slotId === 'outfit') {
      state.equippedDecor.outfit = 'outfit-default';
    } else {
      state.equippedDecor[slotId] = null;
    }
    return { state, ok: true, cleared: true };
  }
  const item = DECOR_ITEMS[decorId];
  if (!item || item.slot !== slotId) return { state: prevState, ok: false, reason: '该摆件不能放在这个位置' };
  if (!state.ownedDecor?.includes(decorId)) return { state: prevState, ok: false, reason: '尚未获得这件珍品，去奶奶摇奖匣试试手气吧' };
  state.equippedDecor[slotId] = decorId;
  const cal = getCalendarInfo(state.now);
  state.logs = [`[${cal.cnDate}] 将「${item.name}」布置到了小窝（${item.slotLabel}）。`, ...state.logs].slice(0, 16);
  return { state, ok: true, item };
}

/** 玩家行为：转动奶奶的黄铜摇奖匣（1 次或 5 连，优先消耗免费旅途副券，无券用主游戏金币） */
export function spinGacha(prevState, count = 1, randFn = null) {
  const times = count === 5 ? 5 : 1;
  const state = structuredClone(prevState);
  state.tickets = state.tickets || 0;
  state.gachaPity = state.gachaPity || 0;
  state.gachaTotal = state.gachaTotal || 0;
  if (!Array.isArray(state.ownedDecor)) state.ownedDecor = ['win-teru', 's1l-teapot', 's2l-vase', 'outfit-default'];

  let costType = 'ticket';
  let costAmount = times;
  if (state.tickets >= times) {
    state.tickets -= times;
  } else {
    costType = 'coins';
    costAmount = times === 5 ? GACHA_CONFIG.fiveCoins : GACHA_CONFIG.singleCoins;
    if (state.coins < costAmount) {
      return {
        state: prevState,
        ok: false,
        reason: times === 5
          ? `需要 5 张副券或 ${GACHA_CONFIG.fiveCoins} 金币（当前 ${state.tickets} 券 / ${state.coins} 金币）`
          : `需要 1 张副券或 ${GACHA_CONFIG.singleCoins} 金币（完成明信片显影可免费得副券和金币）`,
        results: [],
      };
    }
    state.coins -= costAmount;
  }

  const rng = randFn || seeded(((state.now & 0xffffffff) ^ ((state.gachaTotal + 17) * 2654435761)) >>> 0);
  const goldCatalog = Object.values(DECOR_ITEMS).filter(d => d.gachaGold);
  const results = [];
  let sawHighTier = false;

  for (let i = 0; i < times; i++) {
    state.gachaTotal += 1;
    state.gachaPity += 1;

    let tier = 'green';
    const roll = rng();
    if (state.gachaPity >= GACHA_CONFIG.pityMax) {
      tier = 'gold';
    } else if (times === 5 && i === 4 && !sawHighTier) {
      tier = roll < 0.45 ? 'gold' : 'red';
    } else if (roll < 0.24) {
      tier = 'gold';
    } else if (roll < 0.48) {
      tier = 'red';
    } else if (roll < 0.78) {
      tier = 'blue';
    } else {
      tier = 'green';
    }

    if (tier === 'gold' || tier === 'red') sawHighTier = true;

    if (tier === 'gold') {
      state.gachaPity = 0;
      const unowned = goldCatalog.filter(d => !state.ownedDecor.includes(d.id));
      const pool = unowned.length ? unowned : goldCatalog;
      // 优先让首次出金容易抽到超惊艳的台灯 / 邮差帽 / 八音盒 / 水母瓶
      const featured = unowned.find(d => ['lamp-mushroom', 'outfit-postman', 's1r-musicbox', 's1l-jellyfish', 'lamp-lantern'].includes(d.id));
      const picked = featured && rng() < 0.68 ? featured : pool[Math.floor(rng() * pool.length)];
      const isNew = !state.ownedDecor.includes(picked.id);
      if (isNew) {
        state.ownedDecor.push(picked.id);
        state.inventory.fish = (state.inventory.fish || 0) + 1;
      } else {
        // 重复珍品绝不空手：折算 香酥小鱼干×3 + 30 金币
        state.inventory.fish = (state.inventory.fish || 0) + 3;
        state.coins += 30;
      }
      results.push({
        tier: 'gold',
        isNew,
        decorId: picked.id,
        slot: picked.slot,
        name: picked.name,
        slotLabel: picked.slotLabel,
        thumb: picked.thumb,
        story: picked.story,
        bonusText: isNew ? '另赠附礼：香酥小鱼干零食 +1' : '已收录珍品自动折为：香酥小鱼干 ×3 与 +30 金币',
      });
    } else if (tier === 'red') {
      const picked = GACHA_CONFIG.redPool[Math.floor(rng() * GACHA_CONFIG.redPool.length)];
      if (picked.itemId && ITEMS[picked.itemId]) {
        const it = ITEMS[picked.itemId];
        if (it.permanent) {
          if ((state.inventory[picked.itemId] || 0) > 0) {
            state.inventory.fish = (state.inventory.fish || 0) + 2;
          } else {
            state.inventory[picked.itemId] = 1;
          }
        } else {
          state.inventory[picked.itemId] = (state.inventory[picked.itemId] || 0) + (picked.qty || 1);
        }
      }
      if (picked.bonusItem) state.inventory[picked.bonusItem] = (state.inventory[picked.bonusItem] || 0) + (picked.bonusQty || 1);
      if (picked.bonusTicket) state.tickets += picked.bonusTicket;
      results.push({
        tier: 'red',
        isNew: false,
        name: picked.name,
        slotLabel: '行囊心愿 / 稀有茶点',
        thumb: picked.icon,
        story: picked.story,
        bonusText: '已放入奶奶的旧布包柜子里',
      });
    } else if (tier === 'blue') {
      const picked = GACHA_CONFIG.bluePool[Math.floor(rng() * GACHA_CONFIG.bluePool.length)];
      state.inventory[picked.itemId] = (state.inventory[picked.itemId] || 0) + (picked.qty || 1);
      results.push({
        tier: 'blue',
        isNew: false,
        name: picked.name,
        slotLabel: '旅途手工口粮',
        thumb: picked.icon,
        story: picked.story,
        bonusText: '装进布包或玄关备品篮随时可用',
      });
    } else {
      const picked = GACHA_CONFIG.greenPool[0];
      state.inventory.fish = (state.inventory.fish || 0) + (picked.qty || 3);
      results.push({
        tier: 'green',
        isNew: false,
        name: picked.name,
        slotLabel: '团子的最爱零食',
        thumb: picked.icon,
        story: picked.story,
        bonusText: '回小窝就能喂团子咔哧咔哧吃小鱼干',
      });
    }
  }

  const coinsBefore = prevState.coins;
  const cal = getCalendarInfo(state.now);
  const topNames = results.map(r => r.name).slice(0, 2).join('、');
  state.logs = [`[${cal.cnDate}] 摇动奶奶的黄铜摇奖匣 ${times} 次：获得${topNames}${results.length > 2 ? '等' : ''}。`, ...state.logs].slice(0, 16);
  const coinDelta = state.coins - coinsBefore;
  state.walletTxSeq = (state.walletTxSeq || 0) + 1;
  return {
    state,
    ok: true,
    costType,
    costAmount,
    results,
    coinDelta,
    ledgerSource: coinDelta !== 0 ? `tuanzi:gacha:${times}:${state.now}:${state.walletTxSeq}` : null,
  };
}

/** 玩家行为：拂去阳光金尘 */
export function clearDust(prevState) {
  const state = structuredClone(prevState);
  state.dustLevel = 0;
  return state;
}

/** 计算《华夏行记》中国各地明信片收集进度与称号印章 */
export function getChinaCollectionStats(state) {
  const byId = new Map();
  for (const c of state.postcards || []) {
    if (!byId.has(c.templateId) || c.developed) byId.set(c.templateId, c);
  }
  const items = CHINA_POSTCARD_IDS.map(id => {
    const tpl = POSTCARD_POOL[id];
    const owned = byId.get(id) || null;
    return {
      id,
      tpl,
      owned,
      collected: Boolean(owned),
      developed: Boolean(owned?.developed),
    };
  });
  const collected = items.filter(x => x.collected).length;
  const developed = items.filter(x => x.developed).length;
  const total = items.length;
  const rankSeal = collected >= total
    ? '华夏漫游大师'
    : collected >= 4
      ? '半壁山河旅猫'
      : collected >= 1
        ? '初踏华夏行记'
        : '整装待发';
  return { total, collected, developed, items, rankSeal };
}

/** 玩家行为：手动切换小窝实景场景（null / 'auto' 恢复随四季节气自动变化） */
export function setSceneOverride(prevState, sceneId) {
  const state = structuredClone(prevState);
  if (!sceneId || sceneId === 'auto' || !ROOM_SCENE_MAP[sceneId]) {
    state.sceneOverride = null;
  } else {
    state.sceneOverride = sceneId;
  }
  return state;
}

/** 计算派生视图：主导性格、房间演化阶段、有效场景与天气、未读数等 */
export function getDerivedView(state) {
  const cal = getCalendarInfo(state.now);
  const daysTogether = Math.max(1, Math.floor((state.now - state.startedAt) / DAY) + 1);
  const isEvolvedRoom = daysTogether >= 14 || state.souvenirs.length >= 2 || state.apangHouseguest || cal.season === 'winter';
  const hasPendingReunion = Boolean(state.reunion && !state.reunion.claimed);

  // 智能解析当前实景场景：优先手动选定 -> 其次手动气候 -> 其次真实公历四季与演化阶段
  let activeSceneId = null;
  if (state.sceneOverride && ROOM_SCENE_MAP[state.sceneOverride]) {
    activeSceneId = state.sceneOverride;
  } else if (state.weatherOverride) {
    activeSceneId = {
      sakura: 'spring-sakura',
      rain: 'rainy-alley',
      firefly: 'summer-firefly',
      snow: 'winter-snow',
      autumn: 'autumn-day',
    }[state.weatherOverride] || 'autumn-day';
  } else if (hasPendingReunion || cal.season === 'winter') {
    activeSceneId = 'winter-snow';
  } else if (cal.season === 'spring') {
    activeSceneId = cal.defaultWeather === 'rain' ? 'rainy-alley' : 'spring-sakura';
  } else if (cal.season === 'summer') {
    activeSceneId = cal.isNight || cal.defaultWeather === 'firefly' ? 'summer-firefly' : 'sunset-veranda';
  } else if (cal.defaultWeather === 'rain') {
    activeSceneId = 'rainy-alley';
  } else if (isEvolvedRoom) {
    activeSceneId = 'winter-snow';
  } else {
    activeSceneId = 'autumn-day';
  }

  const activeScene = ROOM_SCENE_MAP[activeSceneId] || ROOM_SCENE_MAP['autumn-day'];
  const weather = state.weatherOverride || (state.sceneOverride ? activeScene.defaultWeather : cal.defaultWeather);

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
    activeSceneId,
    activeScene,
    weather,
    personality,
    sillPortions: getSillPortions(state),
    unreadPostcards,
    unreadLetters,
    unreadTotal: unreadPostcards + unreadLetters,
    plantStageLabel,
    synergy: matchSynergy(state.pack),
    hasPendingReunion,
  };
}
