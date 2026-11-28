// 「团子去旅行 2.0」手作绘本可玩交互原型主控制器
import {
  DAY, DECOR_ITEMS, DECOR_SLOTS, GACHA_CONFIG, HOUR, ITEMS, NPCS, PET_WHISPERS, POSTCARD_POOL, SOUVENIRS,
} from './catalog.js';
import {
  buyItem, claimReunionGift, claimSill, clearDust, completePostcard,
  createInitialState, equipDecor, feedSnack, getDerivedView, packBag, replyLetter, sendOffNow,
  setTreatDish, simulateTo, spinGacha, syncWalletCoins, togglePantrySlot,
} from './engine.js';
import { NookAtmosphere } from './particles.js';
import { sound } from './audio.js';
import { mountPostcardPuzzle } from './puzzle.js';

const STORAGE_KEY = 'jigsaw:tuanzi-v2-prototype:v4';

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed?.version === 4) return parsed;
    }
  } catch {}
  return createInitialState();
}

function saveState(state) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch {}
}

let state = loadState();
let walletMeta = { linked: false, owner: '', linkedMainProfile: false };
let activeScreen = 'nook'; // 'nook' | 'bag' | 'gacha' | 'reunion' | 'mailbox' | 'shop' | 'scrapbook'

/** 直接读写主游戏统一金币钱包（host 注入 window.jigsawWallet 或本地 /api/mobile/wallet -> mobile_collection_wallets） */
async function refreshMainWallet() {
  try {
    if (window.jigsawWallet?.read) {
      const data = await window.jigsawWallet.read();
      if (typeof data?.coins === 'number') {
        walletMeta = { linked: true, owner: data.owner || 'host', linkedMainProfile: true };
        state = syncWalletCoins(state, data.coins);
        saveState(state);
        renderAll();
      }
      return;
    }
    const resp = await fetch('/api/mobile/wallet', { cache: 'no-store' });
    if (!resp.ok) return;
    const data = await resp.json();
    if (data?.ok && typeof data.coins === 'number') {
      walletMeta = { linked: true, owner: data.owner || '', linkedMainProfile: Boolean(data.linkedMainProfile) };
      state = syncWalletCoins(state, data.coins);
      saveState(state);
      renderAll();
    }
  } catch {}
}

async function pushMainWalletDelta(source, delta) {
  if (!source || !delta) return;
  try {
    if (window.jigsawWallet?.apply) {
      const data = await window.jigsawWallet.apply(source, delta);
      if (typeof data?.coins === 'number') {
        state = syncWalletCoins(state, data.coins);
        saveState(state);
        renderAll();
      }
      return;
    }
    const resp = await fetch('/api/mobile/wallet/apply', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source, delta }),
    });
    const data = await resp.json().catch(() => null);
    if (resp.ok && data?.ok && typeof data.coins === 'number') {
      walletMeta = { linked: true, owner: data.owner || walletMeta.owner, linkedMainProfile: Boolean(data.linkedMainProfile) };
      state = syncWalletCoins(state, data.coins);
      saveState(state);
      renderAll();
    } else if (resp.status === 409 && typeof data?.coins === 'number') {
      state = syncWalletCoins(state, data.coins);
      saveState(state);
      renderAll();
      showToast(data.message || '主游戏金币余额不足');
    }
  } catch {}
}
let decorMode = false;
let decorTab = 'desk'; // 'all' | 'desk' | 'shelf' | 'window' | 'outfit'
let selectedDecorSlot = 'desk'; // null or slot id
let decorNightPreview = false;
let gachaSpinning = false;
let lastGachaResults = null;
let bagSubTab = 'bag'; // 'bag' | 'pantry' | 'treat'
let mailSubTab = 'postcards'; // 'postcards' | 'letters'
let scrapSubTab = 'overview'; // 'overview' | 'souvenirs' | 'memories'
let selectedPostcardUid = null;
let selectedLetterUid = null;
let playingPuzzleUid = null;
let activePuzzleApi = null;
let reunionPageIdx = 0;
let animOverride = null; // 'departing' | 'returning' | null
let ribbonTimer = 0;
let toastTimer = 0;
let petIndex = 0;

const $ = (id) => document.getElementById(id);
const phoneEl = $('phone-root');
const canvas = $('atmosphere-canvas');

const atmosphere = new NookAtmosphere(canvas, {
  onDustCleared() {
    state = clearDust(state);
    saveState(state);
    sound.windchime();
    showToast('微尘散开了，小窝重新亮起暖光');
    renderAll();
  },
});
atmosphere.start();

function syncCanvasSize() {
  const rect = phoneEl.getBoundingClientRect();
  if (rect.width > 0 && rect.height > 0) {
    atmosphere.resize(rect.width, rect.height);
  }
}
window.addEventListener('resize', syncCanvasSize);
setTimeout(syncCanvasSize, 40);

function showToast(text) {
  $('toast-text').textContent = text;
  $('toast-ribbon').classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $('toast-ribbon').classList.remove('show'), 2500);
}

function showCatRibbon(text, ms = 3400) {
  $('tuanzi-ribbon-text').textContent = text;
  $('tuanzi-ribbon').classList.add('show');
  clearTimeout(ribbonTimer);
  if (ms > 0) {
    ribbonTimer = setTimeout(() => $('tuanzi-ribbon').classList.remove('show'), ms);
  }
}

function setScreen(next) {
  activeScreen = next;
  if (next !== 'nook') {
    decorMode = false;
    decorNightPreview = false;
  }
  playingPuzzleUid = null;
  activePuzzleApi = null;
  $('screen-nook').classList.toggle('hidden', next !== 'nook');
  $('screen-bag').classList.toggle('hidden', next !== 'bag');
  $('screen-gacha').classList.toggle('hidden', next !== 'gacha');
  const isBook = ['reunion', 'mailbox', 'shop', 'scrapbook'].includes(next);
  $('screen-book').classList.toggle('hidden', !isBook);
  sound.paperTurn();
  renderAll();
}

function enterDecorMode(slotId = 'desk') {
  activeScreen = 'nook';
  decorMode = true;
  selectedDecorSlot = slotId;
  const slotObj = DECOR_SLOTS.find(s => s.id === slotId);
  decorTab = slotObj ? slotObj.tab : 'all';
  $('screen-nook').classList.remove('hidden');
  $('screen-bag').classList.add('hidden');
  $('screen-gacha').classList.add('hidden');
  $('screen-book').classList.add('hidden');
  sound.paperTurn();
  renderAll();
}

function exitDecorMode() {
  decorMode = false;
  decorNightPreview = false;
  sound.paperTurn();
  renderAll();
}

function commit(nextState) {
  state = nextState;
  saveState(state);
  renderAll();
}

/* =========================================================
   RENDER: NOOK MAIN SCENE + IN-SITU DECOR LAYERS + LIVE TUANZI
   ========================================================= */
function renderInSituDecorLayers(showEvolved) {
  const plateEl = $('day1-plate-canvas');
  const layersEl = $('decor-layers');
  const slotsEl = $('decor-slots-overlay');
  const eq = state.equippedDecor || {};

  // Day 30 / 跨季重逢雪夜使用独立全绘雪夜底图，严禁 Day 1 原地摆件贴片透出叠压
  if (showEvolved) {
    if (plateEl) plateEl.style.opacity = '0';
    layersEl.innerHTML = '';
    slotsEl.innerHTML = '';
    return;
  }
  if (plateEl) plateEl.style.opacity = '1';

  // 渲染 7 个原地融合羽化贴片（严格锁定原生 768×1376 百分比坐标，零贴纸漂移！）
  const patchHtml = [];
  for (const slot of DECOR_SLOTS) {
    if (slot.id === 'outfit') continue;
    const itemId = eq[slot.id];
    const item = itemId ? DECOR_ITEMS[itemId] : null;
    if (!item?.patch || !item?.rect) continue;
    patchHtml.push(
      `<img class="decor-patch" src="${item.patch}" alt="${item.name}" style="left:${item.rect.left}%; top:${item.rect.top}%; width:${item.rect.width}%; height:${item.rect.height}%;" />`
    );
  }
  layersEl.innerHTML = patchHtml.join('');

  // 仅装扮模式显示「一格一位」轻盈虚线框（不遮挡摆件本体与团子眼睛）
  if (decorMode && !showEvolved) {
    slotsEl.innerHTML = DECOR_SLOTS.map(slot => {
      const isSel = selectedDecorSlot === slot.id;
      const b = slot.box;
      return `
        <button class="craft-btn slot-frame ${isSel ? 'selected' : ''}" data-select-slot="${slot.id}"
          style="left:${b.left}%; top:${b.top}%; width:${b.width}%; height:${b.height}%;"
          title="布置${slot.label}">
          <span class="sf-tag">${slot.short}${isSel ? ' · 选中' : ''}</span>
        </button>
      `;
    }).join('');
    slotsEl.querySelectorAll('[data-select-slot]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        selectedDecorSlot = btn.dataset.selectSlot;
        const slotObj = DECOR_SLOTS.find(s => s.id === selectedDecorSlot);
        if (slotObj) decorTab = slotObj.tab;
        sound.paperTurn();
        renderNook();
        renderDecorDrawer();
      });
    });
  } else {
    slotsEl.innerHTML = '';
  }
}

function renderNook() {
  const view = getDerivedView(state);
  const eq = state.equippedDecor || {};
  const showEvolved = view.isEvolvedRoom && !decorMode;

  // 1. 装扮模式时上移整个实景舞台，露出全部木架、左桌台灯与团子
  $('nook-stage').classList.toggle('decor-mode', decorMode);
  $('nook-hud-layer').classList.toggle('hidden', decorMode);
  $('decor-ui-layer').classList.toggle('hidden', !decorMode);
  $('night-preview-veil').classList.toggle('active', decorMode && decorNightPreview);
  $('decor-night-label').textContent = decorNightPreview ? '切回初秋午后' : '试看雪夜灯效';

  // Day 1 原地融合画板 -> Day 30 重逢雪夜底图自然交叉淡入
  $('room-bg-day30').style.opacity = showEvolved ? '1' : '0';
  renderInSituDecorLayers(showEvolved);

  // 2. 更新窗外粒子气候 & 屋内动态台灯/水母光晕 & 微尘
  const deskItem = eq.desk ? DECOR_ITEMS[eq.desk] : null;
  atmosphere.setScene({
    weather: decorMode && decorNightPreview ? 'snow' : view.weather,
    isEvolved: showEvolved,
    dustLevel: decorMode ? 0 : state.dustLevel,
    lampGlow: showEvolved ? null : (deskItem?.lampGlow || null),
    hasJellyGlow: showEvolved ? false : (eq.shelf1L === 's1l-jellyfish'),
    nightPreview: decorMode && decorNightPreview,
  });
  canvas.classList.toggle('interactive-dust', !decorMode && state.dustLevel > 0);
  $('dust-cue').style.display = !decorMode && state.dustLevel > 0 ? 'flex' : 'none';

  // 3. 顶部麻绳木牌日历 & 橡木金币牌 & 右上黄铜摇奖匣挂徽
  $('plaque-date').textContent = view.cal.cnDate;
  const plaqueSub = view.hasPendingReunion
    ? `${view.cal.seasonLabel}${view.cal.isNight ? '雪夜' : view.cal.period} · 别${state.reunion.awayDays}日`
    : view.cal.plaqueSub;
  $('plaque-sub').textContent = plaqueSub;
  $('hud-coins').textContent = String(state.coins);

  $('btn-open-gacha').style.display = view.hasPendingReunion ? 'none' : 'flex';
  const tickets = state.tickets || 0;
  $('gacha-ticket-badge').style.display = tickets > 0 ? 'flex' : 'none';
  $('gacha-ticket-num').textContent = String(tickets);

  // 4. 窗台晒好的香酥小鱼干零食 + 直接投喂团子零食按钮
  if (view.sillPortions > 0 && !view.hasPendingReunion) {
    $('btn-sill').style.display = 'flex';
    $('sill-gain').textContent = `小鱼干 +${view.sillPortions}`;
  } else {
    $('btn-sill').style.display = 'none';
  }
  const fishCount = state.inventory.fish || 0;
  if (state.status === 'home' && !view.hasPendingReunion && fishCount > 0) {
    $('btn-feed-snack').style.display = 'flex';
    $('snack-count').textContent = `喂小鱼干 (${fishCount})`;
  } else {
    $('btn-feed-snack').style.display = 'none';
  }

  // 5. 门口红丝带信捆火漆（重逢或有积压未读信件时显示）
  const showBundle = showEvolved && (view.hasPendingReunion || view.unreadTotal >= 2);
  $('btn-bundle-seal').style.display = showBundle ? 'flex' : 'none';
  $('bundle-count').textContent = String(Math.max(view.unreadTotal, view.hasPendingReunion ? 5 : 0));

  // 6. 团子活态姿态与整猫无缝穿搭（零贴纸帽！）
  const actor = $('tuanzi-actor');
  const sprite = $('tuanzi-sprite');
  const zzz = $('zzz-layer');
  const outfit = DECOR_ITEMS[eq.outfit] || DECOR_ITEMS['outfit-default'];
  actor.className = 'tuanzi-actor';
  if (showEvolved) actor.classList.add('in-evolved');
  if (state.winterScarfUnlocked) actor.classList.add('has-scarf');

  if (decorMode) {
    sprite.src = outfit.waitSprite || './assets/cat/tuanzi-wait.webp';
    actor.classList.add('pose-wait');
    zzz.classList.remove('show');
  } else if (animOverride === 'departing') {
    sprite.src = './assets/cat/tuanzi-leave.webp';
    actor.classList.add('pose-departing');
    zzz.classList.remove('show');
  } else if (animOverride === 'returning') {
    sprite.src = './assets/cat/tuanzi-return.webp';
    actor.classList.add('pose-returning');
    zzz.classList.remove('show');
  } else if (state.status === 'away') {
    sprite.src = './assets/cat/tuanzi-note.webp';
    actor.classList.add('pose-note');
    zzz.classList.remove('show');
  } else if (view.hasPendingReunion) {
    sprite.src = './assets/cat/tuanzi-return.webp';
    actor.classList.add('pose-reunion');
    zzz.classList.remove('show');
    showCatRibbon('你回来啦，下雪那天我给你留了礼物。', 0);
  } else if (state.pack.food) {
    sprite.src = outfit.waitSprite || './assets/cat/tuanzi-wait.webp';
    actor.classList.add('pose-wait');
    zzz.classList.remove('show');
  } else {
    sprite.src = outfit.napSprite || './assets/cat/tuanzi-nap.webp';
    actor.classList.add('pose-nap');
    zzz.classList.add('show');
  }

  // 7. 底部导航 vs 重逢手账入口
  if (view.hasPendingReunion) {
    $('bottom-nav').style.display = 'none';
    $('rug-whisper').style.display = 'none';
    $('reunion-cta').style.display = 'flex';
    $('reunion-cta-sub').textContent = `离开的这 ${state.reunion.awayDays} 天，已被记进了手账里`;
  } else {
    $('reunion-cta').style.display = 'none';
    $('bottom-nav').style.display = 'flex';
    $('rug-whisper').style.display = 'block';
    if (state.status === 'away') {
      const foodName = ITEMS[state.trip?.food]?.name || '行囊';
      $('rug-whisper').textContent = `团子背着「${foodName}」出门旅行了，坐垫上留了一张爪印纸条。`;
    } else if (state.pack.food) {
      $('rug-whisper').textContent = '布包装好啦，你可以轻推小门送它走，或等离开后悄悄出发。';
    } else if (showEvolved) {
      $('rug-whisper').textContent = '窗外飘着微雪，阿胖在角落蹭午睡，屋里暖融融的。';
    } else if (deskItem) {
      $('rug-whisper').textContent = `${deskItem.name}亮着暖光，团子在绿花垫子上安稳打盹。`;
    } else if (outfit.id === 'outfit-postman') {
      $('rug-whisper').textContent = '团子戴着云邮局小圆帽，在午后阳光里打起了呼噜。';
    } else if (outfit.id === 'outfit-redscarf') {
      $('rug-whisper').textContent = '团子把小爪子缩进红绒围巾里，暖烘烘地眯起了眼。';
    } else {
      $('rug-whisper').textContent = '午后的阳光暖烘烘的，团子正在垫子上打盹。';
    }
  }

  // 信箱火漆未读角标
  if (view.unreadTotal > 0) {
    $('mail-badge').style.display = 'flex';
    $('mail-badge-num').textContent = String(view.unreadTotal);
  } else {
    $('mail-badge').style.display = 'none';
  }
}

/* =========================================================
   RENDER: LIVE IN-SITU DECORATION DRAWER (实景布置小窝抽屉)
   ========================================================= */
function spawnSlotSparkles(slotId) {
  const slot = DECOR_SLOTS.find(s => s.id === slotId);
  if (!slot) return;
  const cx = -3 + ((slot.box.left + slot.box.width * 0.5) / 100) * 471;
  const cy = ((slot.box.top + slot.box.height * 0.5) / 100) * 844;
  atmosphere.spawnBurst(Math.max(24, Math.min(366, cx)), Math.max(80, Math.min(720, cy)), 'reunion');
}

function renderDecorDrawer() {
  if (!decorMode) return;
  document.querySelectorAll('#decor-tabs .d-tab').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.dtab === decorTab);
  });

  const eq = state.equippedDecor || {};
  const owned = state.ownedDecor || [];
  const allItems = Object.values(DECOR_ITEMS);

  // 若选中了具体槽位且与当前切签一致，则突出该槽位并展示该槽位的「暂空此位」按钮
  const slotObj = selectedDecorSlot ? DECOR_SLOTS.find(s => s.id === selectedDecorSlot) : null;
  let list;
  if (decorTab === 'all') {
    list = allItems;
    $('decor-slot-hint').innerHTML = `<span>全部原地融合摆件与穿搭</span><span>点屋里虚线框可按位筛选</span>`;
  } else if (slotObj && slotObj.tab === decorTab) {
    list = allItems.filter(it => it.slot === slotObj.id);
    $('decor-slot-hint').innerHTML = `<span>当前选中：<b>${slotObj.label}</b></span><span>点下方卡片立刻替换</span>`;
  } else {
    const matchingSlots = DECOR_SLOTS.filter(s => s.tab === decorTab).map(s => s.id);
    list = allItems.filter(it => matchingSlots.includes(it.slot));
    const names = DECOR_SLOTS.filter(s => s.tab === decorTab).map(s => s.short).join(' / ');
    $('decor-slot-hint').innerHTML = `<span>范围：${names}</span><span>点击即原地融合换上</span>`;
  }

  // 把已拥有且已摆放的排在前面，未获得的放后面方便浏览收集目标
  list = [...list].sort((a, b) => {
    const ea = eq[a.slot] === a.id ? 2 : owned.includes(a.id) ? 1 : 0;
    const eb = eq[b.slot] === b.id ? 2 : owned.includes(b.id) ? 1 : 0;
    return eb - ea;
  });

  const cards = list.map(item => {
    const isOwned = owned.includes(item.id);
    const isEquipped = eq[item.slot] === item.id;
    const stateCls = isEquipped ? 'on' : isOwned ? 'ready' : 'gacha';
    const stateText = isEquipped ? '已摆放' : isOwned ? '点击换上' : item.source.replace('摇奖·暖金珍品', '摇奖·金珠');
    return `
      <button class="craft-btn decor-card ${isEquipped ? 'equipped' : ''} ${!isOwned ? 'locked' : ''}"
        data-decor-id="${item.id}" data-decor-slot="${item.slot}">
        <img class="thumb" src="${item.thumb}" alt="${item.name}" />
        <div class="d-name">${item.name}</div>
        <div class="d-state ${stateCls}">${stateText}</div>
      </button>
    `;
  });

  // 针对单槽位（非团子穿搭）提供「暂空此位」一键收起
  if (slotObj && slotObj.id !== 'outfit' && slotObj.tab === decorTab) {
    const isEmpty = !eq[slotObj.id];
    cards.push(`
      <button class="craft-btn decor-card ${isEmpty ? 'equipped' : ''}" data-decor-clear="${slotObj.id}">
        <div class="empty-icon-ring">×</div>
        <div class="d-name">暂空此位</div>
        <div class="d-state empty">${isEmpty ? '已留白' : '收起摆件'}</div>
      </button>
    `);
  }

  const gridEl = $('decor-grid');
  gridEl.innerHTML = cards.join('');
  $('decor-progress').textContent = `已收集小窝珍品 ${owned.length} / ${allItems.length} 件`;

  gridEl.querySelectorAll('[data-decor-id]').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.decorId;
      const slotId = btn.dataset.decorSlot;
      const item = DECOR_ITEMS[id];
      if (!state.ownedDecor?.includes(id)) {
        showToast(`「${item.name}」可在奶奶的黄铜摇奖匣摇出哦`);
        return;
      }
      selectedDecorSlot = slotId;
      const res = equipDecor(state, slotId, id);
      if (res.ok) {
        sound.decorSnap();
        spawnSlotSparkles(slotId);
        commit(res.state);
        showToast(`已换上「${item.name}」`);
      }
    });
  });

  gridEl.querySelectorAll('[data-decor-clear]').forEach(btn => {
    btn.addEventListener('click', () => {
      const slotId = btn.dataset.decorClear;
      const res = equipDecor(state, slotId, null);
      if (res.ok) {
        sound.paperTurn();
        commit(res.state);
        showToast('已收起此处摆件，保留留白呼吸感');
      }
    });
  });
}

/* =========================================================
   RENDER: GRANDMA'S BRASS GARAPON GACHA (奶奶的黄铜摇奖匣)
   ========================================================= */
function renderGachaScreen() {
  const tickets = state.tickets || 0;
  const pityLeft = Math.max(1, GACHA_CONFIG.pityMax - (state.gachaPity || 0));

  $('gacha-tickets').textContent = `${tickets} 券`;
  $('gacha-coins').textContent = String(state.coins);
  $('gacha-pity-text').innerHTML = pityLeft <= 1
    ? `<b>下一次必出</b> 暖金·小窝珍品！`
    : `再摇 <b>${pityLeft} 次</b> 必出暖金·小窝珍品`;

  $('gacha-1-cost').innerHTML = tickets >= 1
    ? `<img src="./assets/icons/raffle-ticket.webp" alt="" />消耗 1 副券`
    : `<img src="./assets/icons/coin.webp" alt="" />${GACHA_CONFIG.singleCoins} 金币`;

  $('gacha-5-cost').innerHTML = tickets >= 5
    ? `<img src="./assets/icons/raffle-ticket.webp" alt="" />消耗 5 副券 · 必出红/金`
    : `<img src="./assets/icons/coin.webp" alt="" />${GACHA_CONFIG.fiveCoins} 金币 · 必出红/金`;

  renderGachaRevealModal();
}

function renderGachaRevealModal() {
  const modal = $('gacha-reveal-modal');
  if (!lastGachaResults || !lastGachaResults.length) {
    modal.classList.add('hidden');
    modal.innerHTML = '';
    return;
  }
  modal.classList.remove('hidden');

  if (lastGachaResults.length === 1) {
    const r = lastGachaResults[0];
    const ball = GACHA_CONFIG.balls[r.tier] || GACHA_CONFIG.balls.green;
    const isPlaceable = Boolean(r.decorId && DECOR_ITEMS[r.decorId]);
    modal.innerHTML = `
      <div class="reveal-ball-header">
        <img src="${ball.icon}" alt="${ball.name}" />
        <div class="r-title">摇出${ball.badge}</div>
      </div>
      <div class="gift-slip">
        <img class="tape-top" src="./assets/uikit/washi-tape.webp" alt="" />
        <div class="rarity-stamp ${r.tier}">${ball.badge}${r.isNew ? ' · 新收录' : ''}</div>
        <div class="gift-art-stage ${isPlaceable ? '' : 'icon-mode'}">
          <img src="${r.thumb}" alt="${r.name}" />
        </div>
        <div class="gift-name">${r.name}</div>
        <div class="gift-slot">${r.slotLabel}</div>
        <div class="gift-story">“${r.story}”</div>
        <div class="gift-bonus-note">
          <img src="./assets/icons/fish.webp" alt="" />
          <span>${r.bonusText}</span>
        </div>
      </div>
      <div class="reveal-actions">
        <button class="craft-btn btn-store-sm" id="btn-reveal-close">
          <img src="./assets/uikit/wood-oval.webp" alt="" />
          <span>${isPlaceable ? '先收进柜子' : '收进旧布包'}</span>
        </button>
        <button class="craft-btn btn-place-now" id="btn-reveal-primary">
          <img class="ribbon" src="./assets/uikit/paper-ribbon.webp" alt="" />
          <span>${isPlaceable ? '立刻摆进小窝' : '再摇一次'}</span>
          <img class="seal" src="./assets/uikit/wax-paw.webp" alt="" />
        </button>
      </div>
    `;
    $('btn-reveal-close').addEventListener('click', () => {
      lastGachaResults = null;
      sound.paperTurn();
      renderGachaRevealModal();
    });
    $('btn-reveal-primary').addEventListener('click', () => {
      if (isPlaceable) {
        const res = equipDecor(state, r.slot, r.decorId);
        lastGachaResults = null;
        if (res.ok) state = res.state;
        saveState(state);
        setScreen('nook');
        sound.decorSnap();
        spawnSlotSparkles(r.slot);
        showCatRibbon(`哇！「${r.name}」摆进小窝里真好看！`, 3600);
      } else {
        lastGachaResults = null;
        renderGachaRevealModal();
        triggerGachaDraw(1);
      }
    });
  } else {
    const newDecorList = lastGachaResults.filter(r => r.decorId && DECOR_ITEMS[r.decorId]);
    const topBall = lastGachaResults.some(r => r.tier === 'gold')
      ? GACHA_CONFIG.balls.gold
      : GACHA_CONFIG.balls.red;
    modal.innerHTML = `
      <div class="reveal-ball-header">
        <img src="${topBall.icon}" alt="" />
        <div class="r-title">五连福引礼单</div>
      </div>
      <div class="gift-slip" style="padding:18px 14px 14px;">
        <img class="tape-top" src="./assets/uikit/washi-tape.webp" alt="" />
        <div class="five-pull-list">
          ${lastGachaResults.map(r => {
            const b = GACHA_CONFIG.balls[r.tier] || GACHA_CONFIG.balls.green;
            return `
              <div class="five-row ${r.tier}">
                <img class="f-ball" src="${b.icon}" alt="${b.name}" />
                <img class="f-thumb" src="${r.thumb}" alt="${r.name}" />
                <div class="f-info">
                  <strong>${r.name}${r.isNew ? '（新）' : ''}</strong>
                  <span>${r.slotLabel} · ${r.bonusText}</span>
                </div>
              </div>
            `;
          }).join('')}
        </div>
      </div>
      <div class="reveal-actions">
        <button class="craft-btn btn-store-sm" id="btn-reveal-close">
          <img src="./assets/uikit/wood-oval.webp" alt="" />
          <span>全部收下</span>
        </button>
        <button class="craft-btn btn-place-now" id="btn-reveal-primary">
          <img class="ribbon" src="./assets/uikit/paper-ribbon.webp" alt="" />
          <span>${newDecorList.length ? '一键摆进小窝' : '再去装扮小窝'}</span>
          <img class="seal" src="./assets/uikit/wax-paw.webp" alt="" />
        </button>
      </div>
    `;
    $('btn-reveal-close').addEventListener('click', () => {
      lastGachaResults = null;
      sound.paperTurn();
      renderGachaRevealModal();
    });
    $('btn-reveal-primary').addEventListener('click', () => {
      for (const item of newDecorList) {
        const res = equipDecor(state, item.slot, item.decorId);
        if (res.ok) state = res.state;
      }
      lastGachaResults = null;
      saveState(state);
      if (newDecorList.length) {
        setScreen('nook');
        sound.celebrate();
        spawnSlotSparkles(newDecorList[0].slot);
        showCatRibbon(`小窝添了 ${newDecorList.length} 件新珍品，团子开心得转圈！`, 3800);
      } else {
        enterDecorMode('desk');
      }
    });
  }
}

function triggerGachaDraw(count = 1) {
  if (gachaSpinning) return;
  const res = spinGacha(state, count);
  if (!res.ok) {
    showToast(res.reason);
    return;
  }
  gachaSpinning = true;
  state = res.state;
  saveState(state);
  if (res.coinDelta && res.ledgerSource) void pushMainWalletDelta(res.ledgerSource, res.coinDelta);

  const stage = $('gacha-machine-stage');
  const trayBall = $('gacha-tray-ball');
  const bestTier = res.results.some(r => r.tier === 'gold')
    ? 'gold'
    : res.results.some(r => r.tier === 'red')
      ? 'red'
      : res.results.some(r => r.tier === 'blue')
        ? 'blue'
        : 'green';

  trayBall.src = GACHA_CONFIG.balls[bestTier].icon;
  trayBall.classList.remove('drop-in');
  trayBall.style.opacity = '0';
  stage.classList.add('spinning');
  sound.garaponCrank();
  renderGachaScreen();
  renderDebugDock();

  setTimeout(() => {
    stage.classList.remove('spinning');
    trayBall.style.opacity = '1';
    void trayBall.offsetWidth;
    trayBall.classList.add('drop-in');
    sound.ballDrop(bestTier);
  }, 660);

  setTimeout(() => {
    gachaSpinning = false;
    lastGachaResults = res.results;
    renderGachaScreen();
    renderNook();
  }, 1160);
}

/* =========================================================
   RENDER: OPEN CLOTH BAG (奶奶的旧布包 / 备品篮 / 招待碟)
   ========================================================= */
function renderBagScreen() {
  document.querySelectorAll('#bag-tabs .cloth-tab').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.bagtab === bagSubTab);
  });

  const pocketsEl = $('bag-pockets');
  const trayEl = $('bag-tray');
  const whisperEl = $('bag-whisper');
  const sendBtn = $('btn-send-off');

  const view = getDerivedView(state);

  if (bagSubTab === 'bag') {
    const slots = [
      { key: 'food', label: '口粮', empty: '必放吃的' },
      { key: 'tool', label: '器物', empty: '可放器物' },
      { key: 'wish', label: '心愿', empty: '可放信物' },
    ];
    pocketsEl.innerHTML = slots.map(sl => {
      const itemId = state.pack[sl.key];
      const item = itemId ? ITEMS[itemId] : null;
      return `
        <button class="craft-btn pocket-slot" data-unslot="${sl.key}">
          <div class="pocket-circle">
            ${item ? `<img src="${item.icon}" alt="${item.name}" />` : `<span>${sl.empty}</span>`}
          </div>
          <div class="pocket-lbl">${item ? item.name : sl.label}</div>
        </button>
      `;
    }).join('');

    pocketsEl.querySelectorAll('[data-unslot]').forEach(btn => {
      btn.addEventListener('click', () => {
        if (state.status === 'away') return showToast('团子正在外面旅行，回来再重新装包吧');
        const slot = btn.dataset.unslot;
        if (!state.pack[slot]) return;
        sound.paperTurn();
        commit(packBag(state, { ...state.pack, [slot]: null }));
      });
    });

    whisperEl.textContent = state.status === 'away'
      ? '团子正背着旧布包在外面旅行，回来再给它换新行囊'
      : view.synergy
        ? view.synergy.whisper
        : state.pack.food
          ? '已装好口粮，可再添一件器物或心愿信物试试化学反应'
          : '先放一份口粮进布包，再配器物会触发意外旅途故事';

    const order = ['fish', 'onigiri', 'bento', 'osmanthus', 'camera', 'umbrella', 'token-apang', 'wish-grandma'];
    trayEl.innerHTML = order.map(id => {
      const item = ITEMS[id];
      const inBag = state.pack[item.slot] === id;
      const count = state.inventory[id] || 0;
      const owned = item.permanent ? count > 0 : count > 0 || inBag;
      const cntLabel = inBag ? '在包里' : item.permanent ? (count > 0 ? '永久' : '未得') : `余 ${count}`;
      return `
        <button class="craft-btn tray-cell ${inBag ? 'in-bag' : ''} ${!owned ? 'depleted' : ''}" data-pick-item="${id}">
          <img src="${item.icon}" alt="${item.name}" />
          <div class="t-name">${item.name}</div>
          <div class="t-cnt">${cntLabel}</div>
        </button>
      `;
    }).join('');

    trayEl.querySelectorAll('[data-pick-item]').forEach(btn => {
      btn.addEventListener('click', () => {
        if (state.status === 'away') return showToast('团子出门中，回来后再装吧');
        const id = btn.dataset.pickItem;
        const item = ITEMS[id];
        const inBag = state.pack[item.slot] === id;
        const count = state.inventory[id] || 0;
        if (!inBag && count <= 0) return showToast('柜子里没有这件啦，去杂货铺看看吧');
        sound.waxSnap();
        commit(packBag(state, { ...state.pack, [item.slot]: inBag ? null : id }));
      });
    });

    sendBtn.style.opacity = state.status === 'away' || !state.pack.food ? '0.5' : '1';
    sendBtn.querySelector('span').textContent = state.status === 'away' ? '团子正在旅途中' : '装好，送它出门';
  } else if (bagSubTab === 'pantry') {
    pocketsEl.innerHTML = state.pantry.map((fid, idx) => {
      const item = fid ? ITEMS[fid] : null;
      return `
        <button class="craft-btn pocket-slot" data-pantry-clear="${idx}">
          <div class="pocket-circle">
            ${item ? `<img src="${item.icon}" alt="${item.name}" />` : `<span>备粮位 ${idx + 1}</span>`}
          </div>
          <div class="pocket-lbl">${item ? item.name : '空着'}</div>
        </button>
      `;
    }).join('');

    pocketsEl.querySelectorAll('[data-pantry-clear]').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = Number(btn.dataset.pantryClear);
        if (!state.pantry[idx]) return;
        sound.paperTurn();
        commit(togglePantrySlot(state, idx, state.pantry[idx]));
      });
    });

    whisperEl.textContent = '玄关备品篮：你离开多日时，团子会自己叼一份续行';
    const foods = ['fish', 'onigiri', 'bento', 'osmanthus'];
    trayEl.innerHTML = foods.map(id => {
      const item = ITEMS[id];
      const cnt = state.inventory[id] || 0;
      return `
        <button class="craft-btn tray-cell ${cnt <= 0 ? 'depleted' : ''}" data-pantry-add="${id}">
          <img src="${item.icon}" alt="${item.name}" />
          <div class="t-name">${item.name}</div>
          <div class="t-cnt">余 ${cnt}</div>
        </button>
      `;
    }).join('');
    trayEl.querySelectorAll('[data-pantry-add]').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.pantryAdd;
        const emptyIdx = state.pantry.findIndex(x => !x);
        if (emptyIdx === -1) return showToast('备品篮 3 格放满啦，点上方可取出');
        if ((state.inventory[id] || 0) <= 0) return showToast('这份口粮用完了，去杂货铺补一点吧');
        sound.waxSnap();
        commit(togglePantrySlot(state, emptyIdx, id));
      });
    });
    sendBtn.style.opacity = '1';
    sendBtn.querySelector('span').textContent = '放好备粮回小窝';
  } else {
    // 窗台招待碟
    const cur = state.treatDish ? ITEMS[state.treatDish] : null;
    pocketsEl.innerHTML = `
      <div></div>
      <button class="craft-btn pocket-slot" id="btn-clear-treat">
        <div class="pocket-circle">
          ${cur ? `<img src="${cur.icon}" alt="${cur.name}" />` : `<span>空瓷碟</span>`}
        </div>
        <div class="pocket-lbl">${cur ? cur.name : '未摆点心'}</div>
      </button>
      <div></div>
    `;
    $('btn-clear-treat')?.addEventListener('click', () => {
      if (!state.treatDish) return;
      sound.paperTurn();
      commit(setTreatDish(state, state.treatDish));
    });
    whisperEl.textContent = cur
      ? `窗台摆着「${cur.name}」，离线期间会吸引${NPCS[cur.treatTarget].name}来串门`
      : '在窗台小瓷碟放一份点心，路过的拾光镇熟人会进来留信';

    const treats = ['fish', 'onigiri', 'bento', 'osmanthus'];
    trayEl.innerHTML = treats.map(id => {
      const item = ITEMS[id];
      const cnt = state.inventory[id] || 0;
      const active = state.treatDish === id;
      return `
        <button class="craft-btn tray-cell ${active ? 'in-bag' : ''} ${cnt <= 0 && !active ? 'depleted' : ''}" data-treat-pick="${id}">
          <img src="${item.icon}" alt="${item.name}" />
          <div class="t-name">${item.name}</div>
          <div class="t-cnt">${active ? '在碟上' : `余 ${cnt}`}</div>
        </button>
      `;
    }).join('');
    trayEl.querySelectorAll('[data-treat-pick]').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.treatPick;
        if (state.treatDish !== id && (state.inventory[id] || 0) <= 0) return showToast('这份点心没有余量啦');
        sound.waxSnap();
        commit(setTreatDish(state, id));
      });
    });
    sendBtn.style.opacity = '1';
    sendBtn.querySelector('span').textContent = '摆好点心回小窝';
  }
}

/* =========================================================
   RENDER: COTTON-PAPER BOOK SCREENS
   ========================================================= */
function renderBookScreen() {
  const el = $('book-content');
  if (activeScreen === 'reunion') renderReunionBook(el);
  else if (activeScreen === 'mailbox') renderMailboxBook(el);
  else if (activeScreen === 'shop') renderShopBook(el);
  else if (activeScreen === 'scrapbook') renderScrapbookBook(el);
}

function renderReunionBook(el) {
  const r = state.reunion;
  if (!r) { setScreen('nook'); return; }
  const page = r.pages[reunionPageIdx] || r.pages[0];
  const isLast = reunionPageIdx >= r.pages.length - 1;
  const cnNum = ['一', '二', '三', '四'][reunionPageIdx] || String(reunionPageIdx + 1);

  el.innerHTML = `
    <div class="book-top-bar">
      <button class="craft-btn ink-return" id="bk-close">
        <svg viewBox="0 0 24 24"><path d="M15 6l-6 6 6 6"/></svg>
        <span>合上手账</span>
      </button>
      <div class="book-folio">第${cnNum}页 · 共四页</div>
    </div>

    <div class="book-scroll">
      <div class="book-heading">
        <h3>你不在的这 ${r.awayDays} 天</h3>
        <div class="date-line">${page.dateLine}</div>
      </div>

      <div class="ink-divider">
        <svg width="200" height="12" viewBox="0 0 200 12" fill="none">
          <path d="M8 6H82M118 6H192" stroke="#b8987d" stroke-width="1"/>
          <path d="M96 6C99 2 101 2 104 6C101 10 99 10 96 6Z" fill="#b8987d"/>
        </svg>
      </div>

      <div class="taped-photo">
        <img class="tape" src="./assets/uikit/washi-tape.webp" alt="" />
        <img class="pic" src="${page.photo}" alt="" />
        <div class="cap">
          <span>${page.photoCapLeft}</span>
          <span>${page.photoCapRight}</span>
        </div>
      </div>

      <div class="hand-prose">${page.prose}</div>

      <div class="margin-stamp-row">
        <img class="portrait" src="${page.stampPortrait}" alt="" />
        <div>
          <div class="ms-title">${page.stampTitle}</div>
          <div class="ms-sub">${page.stampSub}</div>
        </div>
      </div>
    </div>

    <div class="book-footer">
      <button class="craft-btn ink-turn" id="rn-prev" style="${reunionPageIdx === 0 ? 'opacity:0.35' : ''}">← 上一页</button>
      <button class="craft-btn wax-turn" id="rn-next">
        <span>${isLast ? (r.claimed ? '合上手账' : '收下重逢礼物') : '翻下一页'}</span>
        <img src="./assets/uikit/wax-paw.webp" alt="" />
      </button>
    </div>
  `;

  $('bk-close').addEventListener('click', () => setScreen('nook'));
  $('rn-prev').addEventListener('click', () => {
    if (reunionPageIdx > 0) {
      reunionPageIdx--;
      sound.paperTurn();
      renderReunionBook(el);
    }
  });
  $('rn-next').addEventListener('click', () => {
    if (!isLast) {
      reunionPageIdx++;
      sound.paperTurn();
      renderReunionBook(el);
    } else {
      if (!r.claimed) {
        const res = claimReunionGift(state);
        sound.celebrate();
        commit(res.state);
        if (res.coinDelta && res.ledgerSource) void pushMainWalletDelta(res.ledgerSource, res.coinDelta);
        setScreen('nook');
        atmosphere.spawnBurst(195, 580, 'reunion');
        showCatRibbon(`欢迎回家！收下红绒围巾和 +${res.coins} 主游戏金币`, 4200);
      } else {
        setScreen('nook');
      }
    }
  });
}

function renderMailboxBook(el) {
  const topTabs = `
    <div class="book-top-bar">
      <button class="craft-btn ink-return" id="bk-close">
        <svg viewBox="0 0 24 24"><path d="M15 6l-6 6 6 6"/></svg>
        <span>回小窝</span>
      </button>
      <div class="book-tabs">
        <button class="craft-btn book-tab ${mailSubTab === 'postcards' ? 'active' : ''}" data-mtab="postcards">明信片</button>
        <button class="craft-btn book-tab ${mailSubTab === 'letters' ? 'active' : ''}" data-mtab="letters">拾光来信</button>
      </div>
    </div>
  `;

  if (mailSubTab === 'postcards') {
    const cards = state.postcards;
    if (!cards.length) {
      el.innerHTML = `${topTabs}<div class="hand-prose" style="margin-top:40px; text-indent:0;">信箱还空着。给团子装好旧布包，它出门以后就会给你寄来明信片。</div>`;
      bindBookCommon(el);
      return;
    }
    const card = cards.find(c => c.uid === selectedPostcardUid) || cards[0];
    selectedPostcardUid = card.uid;
    const tpl = POSTCARD_POOL[card.templateId];

    // 正在玩 3×3 显影拼图
    if (playingPuzzleUid === card.uid) {
      el.innerHTML = `
        ${topTabs}
        <div class="book-heading">
          <h3>显影拼图 · ${tpl.title}</h3>
          <div class="date-line">点击两块互换归位，拼好即可显影清晰画面</div>
        </div>
        <div class="pc-stage-card" style="margin-top:14px;">
          <div id="puzzle-mount"></div>
        </div>
        <div class="hand-prose" style="font-size:13.5px; text-indent:0; text-align:center; color:var(--ink-mid);">
          “${tpl.line}”
        </div>
        <div class="book-footer">
          <button class="craft-btn ink-turn" id="pz-back">← 稍后再拼</button>
          <button class="craft-btn wax-turn" id="pz-quick">
            <span>一键体验显影</span>
            <img src="./assets/uikit/wax-paw.webp" alt="" />
          </button>
        </div>
      `;
      bindBookCommon(el);
      activePuzzleApi = mountPostcardPuzzle($('puzzle-mount'), {
        imageSrc: tpl.src,
        onSnap: () => sound.waxSnap(),
        onComplete: () => {
          const res = completePostcard(state, card.uid);
          playingPuzzleUid = null;
          sound.celebrate();
          commit(res.state);
          if (res.coinDelta && res.ledgerSource) void pushMainWalletDelta(res.ledgerSource, res.coinDelta);
          showToast(res.reward ? `明信片显影成功！+${res.reward} 主游戏金币、+1 副券` : '明信片重新拼好啦');
        },
      });
      $('pz-back').addEventListener('click', () => { playingPuzzleUid = null; renderMailboxBook(el); });
      $('pz-quick').addEventListener('click', () => activePuzzleApi?.autoSolve());
      return;
    }

    const cardIdx = cards.findIndex(c => c.uid === card.uid);
    el.innerHTML = `
      ${topTabs}
      <div class="book-scroll">
        <div class="book-heading" style="margin-top:10px;">
          <h3 style="font-size:22px;">${tpl.title}</h3>
          <div class="date-line">${card.seasonLabel} · ${card.cnDate} · 寄自${tpl.place}</div>
        </div>

        <div class="pc-stage-card">
          <img class="pc-tape" src="./assets/uikit/washi-tape.webp" alt="" />
          <div class="pc-photo-frame ${card.developed ? '' : 'undeveloped'}">
            <img src="${tpl.src}" alt="${tpl.title}" />
            ${card.developed ? '' : `
              <div class="pc-mist-overlay">
                <strong style="font-size:17px;">记忆尚未显影</strong>
                <span style="font-size:13px; line-height:1.5;">拼完 9 片轻拼图即可看清全画<br/>并显现背面隐藏后记</span>
              </div>
            `}
            <div class="pc-postmark-mini">
              <span>${tpl.postmark || '拾光镇'}</span>
              <span>${card.cnDate.slice(0, 4)}</span>
            </div>
          </div>
        </div>

        ${cards.length > 1 ? `
          <div class="pc-pager-row">
            <button class="craft-btn ink-turn" id="pc-prev" style="${cardIdx <= 0 ? 'opacity:0.35' : ''}">← 上一张</button>
            <span>第 ${cardIdx + 1} / ${cards.length} 张</span>
            <button class="craft-btn ink-turn" id="pc-next" style="${cardIdx >= cards.length - 1 ? 'opacity:0.35' : ''}">下一张 →</button>
          </div>
        ` : ''}

        <div class="pc-quote-card">
          <div class="pc-quote-text">“${tpl.line}”</div>
          <div class="letter-sign">—— 团子</div>
        </div>

        ${card.developed ? `
          <div class="margin-stamp-row" style="margin-top:4px; padding-top:10px;">
            <img class="portrait" src="${NPCS[tpl.npcId].portrait}" alt="" style="width:48px; height:48px;" />
            <div>
              <div class="ms-title">隐形墨水后记已显现</div>
              <div class="ms-sub">${tpl.hiddenNote}</div>
            </div>
          </div>
        ` : `
          <div class="pc-hint-strip">
            未显影明信片不耗体力，拼完后将高清收进《拾光剪贴簿》，并得 +30 金币。
          </div>
        `}
      </div>

      <div class="book-cta-center">
        <button class="craft-btn book-wax-ribbon-btn" id="btn-play-pc">
          <img class="rb" src="./assets/uikit/paper-ribbon.webp" alt="" />
          <span>${card.developed ? '再拼一次明信片' : '开始拼图显影 (+30 金币)'}</span>
          <img class="sl" src="./assets/uikit/wax-paw.webp" alt="" />
        </button>
      </div>
    `;
    bindBookCommon(el);
    $('pc-prev')?.addEventListener('click', () => {
      if (cardIdx > 0) { selectedPostcardUid = cards[cardIdx - 1].uid; sound.paperTurn(); renderMailboxBook(el); }
    });
    $('pc-next')?.addEventListener('click', () => {
      if (cardIdx < cards.length - 1) { selectedPostcardUid = cards[cardIdx + 1].uid; sound.paperTurn(); renderMailboxBook(el); }
    });
    $('btn-play-pc').addEventListener('click', () => {
      playingPuzzleUid = card.uid;
      sound.paperTurn();
      renderMailboxBook(el);
    });
  } else {
    // 拾光来信（一屏一事，真实折纸回信）
    const letters = state.letters;
    if (!letters.length) {
      el.innerHTML = `
        ${topTabs}
        <div class="book-heading"><h3>拾光来信</h3></div>
        <div class="hand-prose" style="margin-top:26px;">
          还没有收到邻居和动物伙伴的来信。试试给团子装上「鱼肉便当 + 旧相机」，或者把时光快进 +7 天 / +30 天，拾光镇的熟人们就会陆续寄来暖心的信件。
        </div>
      `;
      bindBookCommon(el);
      return;
    }
    const letter = letters.find(l => l.uid === selectedLetterUid) || letters[0];
    selectedLetterUid = letter.uid;
    const npc = NPCS[letter.npcId];
    const tpl = npc.letters.find(l => l.step === letter.step) || npc.letters[0];
    const idx = letters.findIndex(l => l.uid === letter.uid);

    el.innerHTML = `
      ${topTabs}
      <div class="book-scroll">
        <div class="letter-head">
          <div class="letter-portrait-wrap">
            <img src="${npc.portrait}" alt="${npc.name}" />
            <div class="red-postmark">
              <span>${npc.postmark}</span>
              <span>${letter.cnDate.slice(0, 2)}</span>
            </div>
          </div>
          <div class="letter-who">
            <h3>${npc.name}的来信</h3>
            <div class="scribe">
              <img src="${NPCS.gugu.portrait}" alt="" />
              <span>${npc.scribe} · 第${['一', '二', '三'][letter.step - 1] || letter.step}封</span>
            </div>
          </div>
        </div>

        <div class="ruled-letter">
          ${tpl.salutation}<br/>
          ${tpl.body}
        </div>
        <div class="letter-sign">${tpl.sign}</div>
      </div>

      <div class="reply-zone">
        <div class="reply-prompt">
          ${letter.chosenReplyId ? '已托咕咕局长带回你的小纸条：' : '折一张小纸条，托咕咕局长带回去：'}
        </div>
        <div class="paper-slips">
          ${tpl.choices.map(ch => {
            const picked = letter.chosenReplyId === ch.id;
            return `
              <button class="paper-slip ${picked ? 'picked' : ''}" data-reply="${ch.id}" ${letter.chosenReplyId ? 'disabled' : ''}>
                ${ch.label}
                ${picked ? `<img class="mini-seal" src="./assets/uikit/wax-paw.webp" alt="" />` : ''}
              </button>
            `;
          }).join('')}
        </div>
        ${letters.length > 1 ? `
          <div style="display:flex; justify-content:space-between; margin-top:10px;">
            <button class="craft-btn ink-turn" id="lt-prev" style="${idx <= 0 ? 'opacity:0.35' : ''}">← 上一封</button>
            <span class="book-folio">${idx + 1} / ${letters.length}</span>
            <button class="craft-btn ink-turn" id="lt-next" style="${idx >= letters.length - 1 ? 'opacity:0.35' : ''}">下一封 →</button>
          </div>
        ` : ''}
      </div>
    `;
    bindBookCommon(el);
    el.querySelectorAll('[data-reply]').forEach(btn => {
      btn.addEventListener('click', () => {
        const res = replyLetter(state, letter.uid, btn.dataset.reply);
        if (res.ok) {
          sound.waxSnap();
          showToast(`已盖好火漆，托咕咕把纸条带给${npc.name}`);
          commit(res.state);
        }
      });
    });
    $('lt-prev')?.addEventListener('click', () => {
      if (idx > 0) { selectedLetterUid = letters[idx - 1].uid; sound.paperTurn(); renderMailboxBook(el); }
    });
    $('lt-next')?.addEventListener('click', () => {
      if (idx < letters.length - 1) { selectedLetterUid = letters[idx + 1].uid; sound.paperTurn(); renderMailboxBook(el); }
    });
  }
}

function renderShopBook(el) {
  const shopIds = ['fish', 'onigiri', 'bento', 'osmanthus', 'camera', 'umbrella'];
  el.innerHTML = `
    <div class="book-top-bar">
      <button class="craft-btn ink-return" id="bk-close">
        <svg viewBox="0 0 24 24"><path d="M15 6l-6 6 6 6"/></svg>
        <span>回小窝</span>
      </button>
      <div class="book-folio">现有金币 · ${state.coins}</div>
    </div>
    <div class="book-heading">
      <h3>拾光杂货铺</h3>
      <div class="date-line">通用主游戏金币 · 小鱼干可作团子零食</div>
    </div>
    <div class="book-scroll">
      <div class="shop-grid">
        ${shopIds.map(id => {
          const item = ITEMS[id];
          const owned = state.inventory[id] || 0;
          const lockedPerm = item.permanent && owned > 0;
          const poor = state.coins < item.price;
          return `
            <div class="shop-card">
              ${lockedPerm ? `<span class="sc-tag owned">已拥有</span>` : owned > 0 ? `<span class="sc-tag">余 ${owned}</span>` : ''}
              <img class="sc-ico" src="${item.icon}" alt="${item.name}" />
              <h4>${item.name}</h4>
              <p>${item.shortDesc}</p>
              <button class="craft-btn shop-buy-btn ${lockedPerm || poor ? 'disabled' : ''}" data-buy="${id}">
                <img class="bg" src="./assets/uikit/wood-oval.webp" alt="" />
                ${lockedPerm ? `<span>已备妥</span>` : `<img class="f" src="./assets/icons/coin.webp" alt="" /><span>${item.price} 金币</span>`}
              </button>
            </div>
          `;
        }).join('')}
      </div>
    </div>
  `;
  $('bk-close').addEventListener('click', () => setScreen('nook'));
  el.querySelectorAll('[data-buy]').forEach(btn => {
    btn.addEventListener('click', () => {
      const res = buyItem(state, btn.dataset.buy);
      if (res.ok) {
        sound.fishChime();
        showToast(`换好了「${ITEMS[btn.dataset.buy].name}」`);
        commit(res.state);
        if (res.coinDelta && res.ledgerSource) void pushMainWalletDelta(res.ledgerSource, res.coinDelta);
      } else {
        showToast(res.reason);
      }
    });
  });
}

function renderScrapbookBook(el) {
  const view = getDerivedView(state);
  const topTabs = `
    <div class="book-top-bar">
      <button class="craft-btn ink-return" id="bk-close">
        <svg viewBox="0 0 24 24"><path d="M15 6l-6 6 6 6"/></svg>
        <span>回小窝</span>
      </button>
      <div class="book-tabs">
        <button class="craft-btn book-tab ${scrapSubTab === 'overview' ? 'active' : ''}" data-stab="overview">拾光记</button>
        <button class="craft-btn book-tab ${scrapSubTab === 'souvenirs' ? 'active' : ''}" data-stab="souvenirs">风物</button>
        <button class="craft-btn book-tab ${scrapSubTab === 'memories' ? 'active' : ''}" data-stab="memories">经历</button>
      </div>
    </div>
  `;

  if (scrapSubTab === 'overview') {
    const uniqueTemplates = [...new Set(state.postcards.map(c => c.templateId))];
    const firstCard = POSTCARD_POOL[uniqueTemplates[uniqueTemplates.length - 1] || 'grandma-shop'];
    const secondCard = uniqueTemplates.length >= 2 ? POSTCARD_POOL[uniqueTemplates[0]] : null;
    const firstSouv = state.souvenirs[0];
    const souvInfo = firstSouv ? SOUVENIRS[firstSouv.id] : SOUVENIRS.windchime;
    const heldDays = firstSouv ? Math.floor((state.now - firstSouv.placedAt) / DAY) : 0;

    el.innerHTML = `
      ${topTabs}
      <div class="book-scroll">
        <div class="clipped-spread">
          <img class="brass-clip-overlay" src="./assets/uikit/paperclip.webp" alt="" />
          <div class="scrap-photo left">
            <img src="${firstCard.src}" alt="" />
            <span>${firstCard.seasonTag} · ${firstCard.postmark}</span>
          </div>
          <div class="scrap-photo right">
            ${secondCard
              ? `<img src="${secondCard.src}" alt="" /><span>${secondCard.seasonTag} · ${secondCard.postmark}</span>`
              : `<div class="empty-photo">下一段季节<br/>等待启程</div><span>跨季留白位</span>`}
          </div>
        </div>

        <div class="keepsake-note">
          <img src="${souvInfo.icon}" alt="${souvInfo.name}" />
          <div>
            <div style="display:flex; align-items:center; gap:7px;">
              <h4>${souvInfo.name}</h4>
              <span class="ink-seal-box">${firstSouv ? (heldDays >= souvInfo.agedDays ? `已摆${heldDays}日` : '新入木架') : '尚未拾得'}</span>
            </div>
            <p>${firstSouv ? (heldDays >= souvInfo.agedDays ? souvInfo.agedNote : souvInfo.originText) : '装好行囊出门旅行，团子会把旅途风物带回摆在木架上。'}</p>
          </div>
        </div>

        <div style="margin:6px 2px 4px; display:flex; justify-content:space-between; align-items:baseline; font-family:var(--font-ui);">
          <span style="font-size:15.5px; font-weight:800; color:#3a2115;">拾光镇的熟人们</span>
          <small style="color:var(--ink-mid); font-size:12.5px; font-weight:600;">相伴第 ${view.daysTogether} 日</small>
        </div>

        <div class="cast-grid">
          ${Object.values(NPCS).map(npc => {
            const b = state.bonds[npc.id];
            const stage = npc.stageTitles[b.level] || npc.stageTitles[0];
            return `
              <div class="cast-item">
                <img src="${npc.portrait}" alt="${npc.name}" />
                <div>
                  <div class="c-name">${npc.name}</div>
                  <div class="c-rel">${stage}</div>
                  <div class="paw-dots">
                    ${[1, 2, 3, 4].map(n => `<i class="${b.level >= n ? 'on' : ''}"></i>`).join('')}
                  </div>
                </div>
              </div>
            `;
          }).join('')}
        </div>

        ${state.memories[0] ? `
          <div class="pc-hint-strip" style="margin-top:16px;">
            <strong style="color:#3a2115;">最近手账 · ${state.memories[0].title}</strong><br/>
            ${state.memories[0].summary}
          </div>
        ` : ''}
      </div>

      <div class="personality-stamp-foot">
        <div class="ps-txt">
          <strong>${view.plantStageLabel}</strong><br/>
          ${view.personality.desc}
        </div>
        <div class="ps-seal">${view.personality.seal}</div>
      </div>
    `;
  } else if (scrapSubTab === 'souvenirs') {
    el.innerHTML = `
      ${topTabs}
      <div class="book-heading">
        <h3>风物来历铭牌</h3>
        <div class="date-line">每件风物摆久了，都会长出新的时光附记</div>
      </div>
      <div class="book-scroll" style="margin-top:8px;">
        ${Object.values(SOUVENIRS).map(sv => {
          const owned = state.souvenirs.find(s => s.id === sv.id);
          const days = owned ? Math.floor((state.now - owned.placedAt) / DAY) : 0;
          const aged = owned && days >= sv.agedDays;
          return `
            <div class="keepsake-note" style="${owned ? '' : 'opacity:0.48;'}">
              <img src="${sv.icon}" alt="${sv.name}" />
              <div>
                <div style="display:flex; align-items:center; gap:6px;">
                  <h4>${sv.name}</h4>
                  <span class="ink-seal-box">${owned ? (aged ? '时光附记' : sv.slotName) : '未拾得'}</span>
                </div>
                <p>${owned ? `第 ${owned.tripNo || 1} 次旅行 · ${owned.seasonLabel}带回。${aged ? sv.agedNote : sv.originText}` : sv.originText}</p>
              </div>
            </div>
          `;
        }).join('')}
      </div>
    `;
  } else {
    el.innerHTML = `
      ${topTabs}
      <div class="book-heading">
        <h3>拾光人生切片</h3>
        <div class="date-line">那些无法复制的相遇与重逢</div>
      </div>
      <div class="book-scroll" style="margin-top:10px;">
        ${state.memories.map(m => `
          <div style="padding:10px 0; border-bottom:1px dashed rgba(133,94,66,0.24);">
            <div style="display:flex; justify-content:space-between; font-family:var(--font-hand);">
              <strong style="font-size:15px; color:#3e2417;">${m.title}</strong>
              <span style="font-size:11.5px; color:var(--ink-light);">${m.cnDate}</span>
            </div>
            <div style="margin-top:4px; font-family:var(--font-hand); font-size:13px; line-height:1.6; color:var(--ink-mid);">${m.summary}</div>
          </div>
        `).join('')}
      </div>
    `;
  }

  bindBookCommon(el);
}

function bindBookCommon(el) {
  el.querySelector('#bk-close')?.addEventListener('click', () => setScreen('nook'));
  el.querySelectorAll('[data-mtab]').forEach(btn => {
    btn.addEventListener('click', () => {
      mailSubTab = btn.dataset.mtab;
      playingPuzzleUid = null;
      sound.paperTurn();
      renderMailboxBook(el);
    });
  });
  el.querySelectorAll('[data-stab]').forEach(btn => {
    btn.addEventListener('click', () => {
      scrapSubTab = btn.dataset.stab;
      sound.paperTurn();
      renderScrapbookBook(el);
    });
  });
}

/* =========================================================
   RENDER: DEBUG PANEL
   ========================================================= */
function renderDebugDock() {
  const view = getDerivedView(state);
  $('dbg-days').textContent = `相伴第 ${view.daysTogether} 天 · ${view.cal.shortDate}`;
  $('dbg-weather').textContent = state.weatherOverride ? `手动：${state.weatherOverride}` : `自动：${view.cal.weatherLabel}`;
  $('dbg-plant').textContent = `${view.plantStageLabel} (${Math.round(state.plantGrowth)}%)`;
  $('dbg-decor-cnt').textContent = `${(state.ownedDecor || []).length} / ${Object.keys(DECOR_ITEMS).length} 件`;
  const wBadge = $('dbg-wallet-state');
  if (wBadge) {
    wBadge.textContent = walletMeta.linked
      ? `已直连主库 · ${state.coins} 金币`
      : `本地钱包 · ${state.coins} 金币`;
  }

  document.querySelectorAll('[data-weather]').forEach(btn => {
    const val = btn.dataset.weather;
    const isAct = val === 'auto' ? !state.weatherOverride : state.weatherOverride === val;
    btn.classList.toggle('active', isAct);
  });

  $('dbg-log').innerHTML = state.logs.map(line => `<div>${line}</div>`).join('');
}

function renderAll() {
  renderNook();
  if (decorMode) renderDecorDrawer();
  if (activeScreen === 'bag') renderBagScreen();
  if (activeScreen === 'gacha') renderGachaScreen();
  if (['reunion', 'mailbox', 'shop', 'scrapbook'].includes(activeScreen)) renderBookScreen();
  renderDebugDock();
}

/* =========================================================
   INTERACTIVE EVENTS & ANIMATION TRIGGERS
   ========================================================= */
function triggerPetCat() {
  const actor = $('tuanzi-actor');
  const view = getDerivedView(state);
  if (state.status === 'away') {
    sound.paperTurn();
    showCatRibbon('坐垫纸条：团子正在路上，晚些寄明信片回来。');
    return;
  }
  actor.classList.remove('petting');
  void actor.offsetWidth;
  actor.classList.add('petting');
  sound.petCat();

  const rect = actor.getBoundingClientRect();
  const phoneRect = phoneEl.getBoundingClientRect();
  atmosphere.spawnBurst(rect.left - phoneRect.left + rect.width * 0.5, rect.top - phoneRect.top + rect.height * 0.35, 'pet');

  const pool = PET_WHISPERS[view.cal.season] || PET_WHISPERS.autumn;
  showCatRibbon(pool[petIndex++ % pool.length]);
}

function playDepartureAnimation() {
  setScreen('nook');
  animOverride = 'departing';
  renderNook();
  sound.petCat();
  showCatRibbon('喵～背好奶奶的旧布包，我出门旅行啦！', 2400);
  setTimeout(() => {
    animOverride = null;
    renderAll();
  }, 2650);
}

function playReturnAnimation() {
  setScreen('nook');
  animOverride = 'returning';
  renderNook();
  sound.celebrate();
  atmosphere.spawnBurst(210, 560, 'reunion');
  showCatRibbon('团子背着装满贝壳挂饰的布包小跑回来啦！', 3200);
  setTimeout(() => {
    animOverride = null;
    renderAll();
  }, 2350);
}

function skipTimeMs(deltaMs) {
  const target = state.now + deltaMs;
  const wasAway = state.status === 'away';
  const res = simulateTo(state, target);
  state = res.state;
  saveState(state);
  setScreen('nook');
  if (state.reunion && !state.reunion.claimed) {
    reunionPageIdx = 0;
    sound.windchime();
    atmosphere.spawnBurst(195, 520, 'reunion');
    showToast(`时光流转了 ${state.reunion.awayDays} 天，小窝已悄悄改变`);
  } else if (wasAway && state.status === 'home') {
    playReturnAnimation();
  } else if (res.summary.length) {
    sound.fishChime();
    showToast(res.summary[0]);
  }
  renderAll();
}

// 绑定主场景点击交互
$('tuanzi-actor').addEventListener('click', triggerPetCat);
$('btn-sill').addEventListener('click', () => {
  const res = claimSill(state);
  if (res.gained > 0) {
    sound.fishChime();
    atmosphere.spawnBurst(96, 372, 'fish');
    showToast(`收下窗台晒好的 +${res.gained} 条香酥小鱼干零食`);
    commit(res.state);
  }
});

$('btn-feed-snack').addEventListener('click', () => {
  const res = feedSnack(state);
  if (!res.ok) return showToast(res.reason);
  const actor = $('tuanzi-actor');
  actor.classList.remove('petting');
  void actor.offsetWidth;
  actor.classList.add('petting');
  sound.petCat();
  const rect = actor.getBoundingClientRect();
  const phoneRect = phoneEl.getBoundingClientRect();
  atmosphere.spawnBurst(rect.left - phoneRect.left + rect.width * 0.5, rect.top - phoneRect.top + rect.height * 0.35, 'pet');
  showCatRibbon('咔哧咔哧……窗台晒好的小鱼干最香啦！', 3400);
  commit(res.state);
});

$('hotspot-windchime').addEventListener('click', () => {
  if (decorMode) return;
  const view = getDerivedView(state);
  const hasPlaced = state.equippedDecor?.window === 'win-windchime';
  if (!view.isEvolvedRoom && !hasPlaced) return;
  sound.windchime();
  atmosphere.spawnBurst(154, 240, 'chime');
  showToast('叮当——海湾贝壳风铃在阳光里轻轻摇晃');
});

$('hotspot-musicbox').addEventListener('click', () => {
  if (decorMode) return;
  if (state.equippedDecor?.shelf1R !== 's1r-musicbox') return;
  sound.musicBox();
  atmosphere.spawnBurst(328, 232, 'reunion');
  showToast('叮叮咚咚……三花猫黄铜八音盒奏起一小段摇篮曲');
});

// 实景装扮入口与抽屉事件
$('btn-open-decor').addEventListener('click', () => enterDecorMode('desk'));
$('btn-decor-done').addEventListener('click', () => exitDecorMode());
$('btn-decor-night').addEventListener('click', () => {
  decorNightPreview = !decorNightPreview;
  sound.paperTurn();
  renderNook();
});
$('btn-decor-to-gacha').addEventListener('click', () => {
  decorMode = false;
  decorNightPreview = false;
  setScreen('gacha');
});
document.querySelectorAll('#decor-tabs .d-tab').forEach(btn => {
  btn.addEventListener('click', () => {
    decorTab = btn.dataset.dtab;
    const firstSlot = DECOR_SLOTS.find(s => s.tab === decorTab);
    selectedDecorSlot = decorTab === 'all' ? null : (firstSlot ? firstSlot.id : null);
    sound.paperTurn();
    renderNook();
    renderDecorDrawer();
  });
});

// 奶奶的黄铜摇奖匣入口与摇把交互
$('btn-open-gacha').addEventListener('click', () => setScreen('gacha'));
$('btn-gacha-crank').addEventListener('click', () => triggerGachaDraw(1));
$('btn-gacha-1').addEventListener('click', () => triggerGachaDraw(1));
$('btn-gacha-5').addEventListener('click', () => triggerGachaDraw(5));

$('hotspot-apang').addEventListener('click', () => {
  if (!getDerivedView(state).isEvolvedRoom) return;
  sound.petCat();
  atmosphere.spawnBurst(316, 750, 'pet');
  showToast('大橘阿胖在角落蒲团上翻了个身，呼噜呼噜睡得正香');
});

$('btn-bundle-seal').addEventListener('click', () => {
  if (state.reunion && !state.reunion.claimed) {
    reunionPageIdx = 0;
    setScreen('reunion');
  } else {
    mailSubTab = 'letters';
    setScreen('mailbox');
  }
});

$('btn-open-reunion').addEventListener('click', () => {
  reunionPageIdx = 0;
  setScreen('reunion');
});

$('btn-mute').addEventListener('click', () => {
  sound.muted = !sound.muted;
  $('icon-sound').style.opacity = sound.muted ? '0.45' : '1';
  showToast(sound.muted ? '已静音' : '已开启治愈微音效');
});

$('btn-coins-tip').addEventListener('click', () => {
  showToast(walletMeta.linked
    ? '已直接关联《拼图小窝》主游戏金币钱包（mobile_collection_wallets），与拼图和图包共用同一笔金币'
    : '通用主游戏金币：与《拼图小窝》拼图、图鉴、任务共用同一套金币');
});

// 手势滑动拂去阳光金尘
let wiping = false;
function handleWipeEvent(e) {
  if (state.dustLevel <= 0) return;
  const rect = phoneEl.getBoundingClientRect();
  const pt = e.touches ? e.touches[0] : e;
  const x = pt.clientX - rect.left;
  const y = pt.clientY - rect.top;
  atmosphere.wipeAt(x, y);
}
canvas.addEventListener('pointerdown', (e) => { wiping = true; handleWipeEvent(e); });
canvas.addEventListener('pointermove', (e) => { if (wiping) handleWipeEvent(e); });
window.addEventListener('pointerup', () => { wiping = false; });

// 底部导航与布包页签
document.querySelectorAll('[data-open]').forEach(btn => {
  btn.addEventListener('click', () => {
    const target = btn.dataset.open;
    if (target === 'bag') bagSubTab = 'bag';
    setScreen(target);
  });
});
document.querySelectorAll('[data-close]').forEach(btn => {
  btn.addEventListener('click', () => setScreen(btn.dataset.close));
});
document.querySelectorAll('#bag-tabs .cloth-tab').forEach(btn => {
  btn.addEventListener('click', () => {
    bagSubTab = btn.dataset.bagtab;
    sound.paperTurn();
    renderBagScreen();
  });
});

$('btn-send-off').addEventListener('click', () => {
  if (bagSubTab !== 'bag') {
    setScreen('nook');
    return;
  }
  if (state.status === 'away') return showToast('团子已经在旅途中啦');
  if (!state.pack.food) return showToast('请先往左边的口粮袋放一份吃的');
  const res = sendOffNow(state);
  if (res.departed) {
    state = res.state;
    saveState(state);
    playDepartureAnimation();
  }
});

// 右侧时光控制台事件
document.querySelectorAll('[data-skip-hours]').forEach(btn => {
  btn.addEventListener('click', () => skipTimeMs(Number(btn.dataset.skipHours) * HOUR));
});
document.querySelectorAll('[data-skip-days]').forEach(btn => {
  btn.addEventListener('click', () => skipTimeMs(Number(btn.dataset.skipDays) * DAY));
});
$('btn-reset-day1').addEventListener('click', () => {
  const liveCoins = state.coins;
  state = syncWalletCoins(createInitialState(), liveCoins);
  saveState(state);
  animOverride = null;
  $('tuanzi-ribbon').classList.remove('show');
  setScreen('nook');
  showToast('已回到 Day 1（保留主游戏共享金币余额）');
});

document.querySelectorAll('[data-weather]').forEach(btn => {
  btn.addEventListener('click', () => {
    const w = btn.dataset.weather;
    state.weatherOverride = w === 'auto' ? null : w;
    saveState(state);
    renderAll();
  });
});

$('btn-demo-pet').addEventListener('click', () => {
  if (activeScreen !== 'nook') setScreen('nook');
  triggerPetCat();
});
$('btn-demo-depart').addEventListener('click', () => playDepartureAnimation());
$('btn-demo-return').addEventListener('click', () => playReturnAnimation());
$('btn-demo-day30').addEventListener('click', () => {
  state = createInitialState();
  state = packBag(state, { food: 'bento', tool: 'camera', wish: 'token-apang' });
  state = togglePantrySlot(state, 1, 'osmanthus');
  skipTimeMs(30 * DAY + 6 * HOUR);
});

$('btn-demo-tickets').addEventListener('click', async () => {
  state = structuredClone(state);
  state.tickets = (state.tickets || 0) + 5;
  state.coins = (state.coins || 0) + 72;
  saveState(state);
  sound.fishChime();
  renderAll();
  await pushMainWalletDelta(`completion:demo-48p-${Date.now()}`, 72);
  showToast('主游戏拼完 48 片拼图入账 +72 金币，并赠 +5 旅途副券');
});

$('btn-demo-unlock-decor').addEventListener('click', () => {
  state = structuredClone(state);
  state.ownedDecor = Object.keys(DECOR_ITEMS);
  state.equippedDecor = {
    desk: 'lamp-mushroom',
    window: 'win-windchime',
    shelf1L: 's1l-jellyfish',
    shelf1R: 's1r-musicbox',
    shelf2L: 's2l-vase',
    shelf2R: 's2r-sailboat',
    shelf3: 's3-map',
    outfit: 'outfit-postman',
  };
  saveState(state);
  sound.celebrate();
  enterDecorMode('desk');
  showToast('已解锁全部 18 件原地融合摆件与团子穿搭，自由混搭吧！');
});

// 支持 URL ?demo=day30|decorated 和 ?screen=gacha|decor|shop|mailbox|scrapbook|bag 直接预览指定页
const urlParams = new URLSearchParams(location.search);
if (urlParams.get('demo') === 'day30') {
  state = createInitialState();
  state = packBag(state, { food: 'bento', tool: 'camera', wish: 'token-apang' });
  state = togglePantrySlot(state, 1, 'osmanthus');
  state = simulateTo(state, state.now + 30 * DAY + 6 * HOUR).state;
} else if (urlParams.get('demo') === 'decorated') {
  state = createInitialState();
  state.ownedDecor = Object.keys(DECOR_ITEMS);
  state.equippedDecor = {
    desk: 'lamp-mushroom',
    window: 'win-windchime',
    shelf1L: 's1l-jellyfish',
    shelf1R: 's1r-musicbox',
    shelf2L: 's2l-vase',
    shelf2R: 's2r-sailboat',
    shelf3: 's3-map',
    outfit: 'outfit-postman',
  };
} else if (urlParams.get('demo') === 'crossmix') {
  state = createInitialState();
  state.ownedDecor = Object.keys(DECOR_ITEMS);
  state.equippedDecor = {
    desk: 'lamp-lantern',
    window: 'win-herbs',
    shelf1L: 's1l-teapot',
    shelf1R: 's1r-camera',
    shelf2L: 's2l-globe',
    shelf2R: 's2r-journals',
    shelf3: 's3-keepsakes',
    outfit: 'outfit-redscarf',
  };
}
const initScreen = urlParams.get('screen');
if (initScreen === 'decor') {
  decorMode = true;
  decorNightPreview = urlParams.get('night') === '1';
  selectedDecorSlot = 'desk';
  decorTab = 'desk';
} else if (['bag', 'gacha', 'shop', 'mailbox', 'scrapbook', 'reunion'].includes(initScreen)) {
  activeScreen = initScreen;
  $('screen-nook').classList.toggle('hidden', true);
  $('screen-bag').classList.toggle('hidden', initScreen !== 'bag');
  $('screen-gacha').classList.toggle('hidden', initScreen !== 'gacha');
  $('screen-book').classList.toggle('hidden', !['shop', 'mailbox', 'scrapbook', 'reunion'].includes(initScreen));
}

renderAll();
void refreshMainWallet();
window.addEventListener('focus', () => { void refreshMainWallet(); });
requestAnimationFrame(() => {
  $('room-bg-day30').classList.add('smooth-fade');
  $('tuanzi-actor').classList.add('smooth-actor');
  document.querySelectorAll('.screen-layer').forEach(el => el.classList.add('smooth-layer'));
});
