// 「团子去旅行 2.0」手作绘本可玩交互原型主控制器
import {
  AD_PLACEMENTS, CHINA_POSTCARD_IDS, CHINA_REGIONS, DAY, DECOR_ITEMS, DECOR_SLOTS, GACHA_CONFIG, HOUR,
  ITEMS, NPCS, PET_WHISPERS, POSTCARD_POOL, ROOM_SCENES, ROOM_SCENE_MAP, SOUVENIRS,
} from './catalog.js';
import {
  buyItem, claimAdChinaWish, claimAdGachaTicket, claimAdPuzzleDouble, claimAdPuzzleHint, claimAdSillDouble,
  claimAdTripRush, claimReunionGift, claimSill, clearDust, completePostcard, createInitialState, equipDecor,
  feedSnack, getAdRemaining, getChinaCollectionStats, getDerivedView, packBag, replyLetter, sendOffNow,
  setSceneOverride, setTreatDish, simulateTo, spinGacha, syncWalletCoins, togglePantrySlot,
} from './engine.js';
import { NookAtmosphere } from './particles.js';
import { sound } from './audio.js';
import { PUZZLE_TIERS, mountWorkbenchPuzzle } from './puzzle.js';

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
let scrapSubTab = 'china'; // 'china' | 'overview' | 'souvenirs' | 'memories'
let chinaRegionFilter = 'all'; // 'all' | 'jiangnan' | 'southwest' | 'north' | 'coast'
let selectedPostcardUid = null;
let selectedLetterUid = null;
let activeWorkbench = null; // { uid, pieceCount, returnScreen, freeHintUsed, doubleClaimed, lastResult, api }
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

function destroyWorkbench() {
  if (activeWorkbench?.api) {
    activeWorkbench.api.destroy();
  }
  activeWorkbench = null;
  $('wb-complete-modal')?.classList.add('hidden');
  $('wb-stamp-pop')?.classList.add('hidden');
}

function setScreen(next) {
  if (next !== 'puzzle') destroyWorkbench();
  activeScreen = next;
  if (next !== 'nook') {
    decorMode = false;
    decorNightPreview = false;
  }
  $('screen-nook').classList.toggle('hidden', next !== 'nook');
  $('screen-bag').classList.toggle('hidden', next !== 'bag');
  $('screen-gacha').classList.toggle('hidden', next !== 'gacha');
  $('screen-puzzle').classList.toggle('hidden', next !== 'puzzle');
  const isBook = ['reunion', 'mailbox', 'shop', 'scrapbook'].includes(next);
  $('screen-book').classList.toggle('hidden', !isBook);
  sound.paperTurn();
  renderAll();
}

/** 统一激励视频桥接：宿主已接 TapTap/微信 tap-rewarded.ts 时直调真广告，原型预览时展示可交互模拟播放器 */
function watchRewardedAd(placementId, customDesc = null) {
  const cfg = AD_PLACEMENTS[placementId];
  if (!cfg) return Promise.resolve({ completed: false });
  if (getAdRemaining(state, placementId) <= 0) {
    showToast('今日该点位激励视频次数已达上限，明天再来吧');
    return Promise.resolve({ completed: false });
  }
  if (window.jigsawRewardedAd?.watch) {
    return Promise.resolve(window.jigsawRewardedAd.watch(cfg.adUnitId, placementId))
      .then(outcome => ({ completed: outcome === 'completed' || outcome === true }));
  }

  return new Promise((resolve) => {
    const modal = $('ad-sim-modal');
    modal.classList.remove('hidden');
    let left = 3;
    let settled = false;
    const rewardText = customDesc || cfg.rewardLabel;

    modal.innerHTML = `
      <div class="ad-sim-box">
        <div class="ad-sim-badge">▶ 激励视频预览 · TapTap / 微信位 ${cfg.adUnitId}</div>
        <h3>${cfg.title}</h3>
        <div class="ad-sim-reward">${rewardText}</div>
        <div class="ad-sim-screen">
          <div class="ad-sim-timer" id="ad-sim-timer">${left}s</div>
          <div class="ad-sim-bar"><div class="ad-sim-fill" id="ad-sim-fill" style="width:8%;"></div></div>
          <div class="ad-sim-meta" id="ad-sim-meta">正在播放绘本治愈赞助短片，完播即可领奖（正式包自动接 tap-rewarded.ts）</div>
        </div>
        <div class="ad-sim-actions">
          <button class="craft-btn ad-sim-btn" id="ad-sim-close">提前关闭（无奖励）</button>
          <button class="craft-btn ad-sim-btn ready" id="ad-sim-claim" disabled>等待完播 (${left}s)</button>
        </div>
      </div>
    `;

    const finish = (completed) => {
      if (settled) return;
      settled = true;
      clearInterval(iv);
      modal.classList.add('hidden');
      modal.innerHTML = '';
      resolve({ completed });
    };

    const claimBtn = $('ad-sim-claim');
    const timerEl = $('ad-sim-timer');
    const fillEl = $('ad-sim-fill');
    const metaEl = $('ad-sim-meta');

    const iv = setInterval(() => {
      left = Math.max(0, left - 1);
      const pct = Math.round(((3 - left) / 3) * 100);
      if (fillEl) fillEl.style.width = `${pct}%`;
      if (left > 0) {
        if (timerEl) timerEl.textContent = `${left}s`;
        if (claimBtn) claimBtn.textContent = `等待完播 (${left}s)`;
      } else {
        clearInterval(iv);
        if (timerEl) timerEl.textContent = '已完播 ✓';
        if (metaEl) metaEl.textContent = '完播校验已通过（isEnded: true），点击立即领奖！';
        if (claimBtn) {
          claimBtn.disabled = false;
          claimBtn.textContent = '领取奖励';
        }
      }
    }, 900);

    $('ad-sim-close')?.addEventListener('click', () => {
      showToast('提前关闭视频，未发放奖励');
      finish(false);
    });
    claimBtn?.addEventListener('click', () => finish(true));
  });
}

/** 启动独立全屏异形拼图工作台（默认 24 片显影 / 已解锁可玩 48 片进阶！） */
function openPuzzleWorkbench(uid, pieceCount = 24, returnScreen = 'mailbox') {
  const card = state.postcards.find(c => c.uid === uid);
  if (!card) return;
  const tpl = POSTCARD_POOL[card.templateId];
  if (!tpl) return;
  const tier = PUZZLE_TIERS[pieceCount] || PUZZLE_TIERS[24];

  destroyWorkbench();
  activeScreen = 'puzzle';
  decorMode = false;
  decorNightPreview = false;
  $('screen-nook').classList.add('hidden');
  $('screen-bag').classList.add('hidden');
  $('screen-gacha').classList.add('hidden');
  $('screen-book').classList.add('hidden');
  $('screen-puzzle').classList.remove('hidden');

  $('wb-title').textContent = tpl.fullTitle || tpl.title;
  $('wb-tier-pill').textContent = tier.label;
  $('wb-progress').textContent = `${tier.count} 片异形拼图 · 已归位 0 / ${tier.count}`;
  $('wb-stamp-city').textContent = tpl.postmark || '拾光镇';
  $('wb-stamp-pop').classList.add('hidden');
  $('wb-complete-modal').classList.add('hidden');

  let edgeOnly = false;
  let ghostStep = 1; // 0: 0, 1: 0.24, 2: 0.46
  const ghostLevels = [0, 0.24, 0.46];
  const ghostLabels = ['底图关闭', '底图透视', '高清底图'];

  const wb = {
    uid,
    templateId: card.templateId,
    pieceCount: tier.count,
    returnScreen,
    freeHintUsed: false,
    doubleClaimed: false,
    lastResult: null,
    api: null,
  };
  activeWorkbench = wb;

  const updateHintBtn = () => {
    const btn = $('btn-wb-hint');
    if (!btn) return;
    if (!wb.freeHintUsed) {
      btn.textContent = '免费提示 1 块';
      btn.classList.add('accent');
    } else {
      const rem = getAdRemaining(state, 'puzzleHint');
      btn.textContent = rem > 0 ? `▶ 广告 +2块 (${rem})` : '今日提示已完';
      btn.classList.toggle('accent', rem > 0);
    }
  };

  $('btn-wb-ghost').textContent = ghostLabels[ghostStep];
  $('btn-wb-ghost').classList.add('active');
  $('btn-wb-edges').classList.remove('active');
  updateHintBtn();

  sound.paperTurn();
  wb.api = mountWorkbenchPuzzle({
    canvas: $('workbench-canvas'),
    trayEl: $('workbench-tray'),
    imageSrc: tpl.src,
    seedKey: `${card.templateId}:${tier.count}`,
    cols: tier.cols,
    rows: tier.rows,
    onSnap: () => sound.waxSnap(),
    onProgress: (placed, total) => {
      $('wb-progress').textContent = `${total} 片异形拼图 · 已归位 ${placed} / ${total}`;
    },
    onComplete: () => {
      const res = completePostcard(state, uid, tier.count);
      wb.lastResult = res;
      sound.celebrate();
      $('wb-stamp-pop').classList.remove('hidden');
      commit(res.state);
      if (res.coinDelta && res.ledgerSource) void pushMainWalletDelta(res.ledgerSource, res.coinDelta);
      setTimeout(() => {
        if (activeWorkbench === wb) renderWorkbenchCompleteModal(wb, tpl);
      }, 620);
    },
  });

  // 绑定工具栏按钮（用 onclick 覆盖旧监听，干净无泄漏）
  $('btn-wb-back').onclick = () => setScreen(wb.returnScreen || 'mailbox');
  $('btn-wb-ghost').onclick = () => {
    ghostStep = (ghostStep + 1) % ghostLevels.length;
    wb.api?.setGhostMode(ghostLevels[ghostStep]);
    $('btn-wb-ghost').textContent = ghostLabels[ghostStep];
    $('btn-wb-ghost').classList.toggle('active', ghostStep > 0);
    sound.paperTurn();
  };
  $('btn-wb-edges').onclick = () => {
    edgeOnly = !edgeOnly;
    wb.api?.setEdgeOnly(edgeOnly);
    $('btn-wb-edges').classList.toggle('active', edgeOnly);
    sound.paperTurn();
  };
  $('btn-wb-hint').onclick = async () => {
    if (!wb.freeHintUsed) {
      const placed = wb.api?.hint(1) || 0;
      if (placed > 0) {
        wb.freeHintUsed = true;
        sound.fishChime();
        updateHintBtn();
        showToast('团子帮你把 1 块异形拼图归位啦！');
      }
      return;
    }
    const ad = await watchRewardedAd('puzzleHint');
    if (!ad.completed) return;
    const res = claimAdPuzzleHint(state);
    if (!res.ok) return showToast(res.reason);
    commit(res.state);
    wb.api?.hint(res.hintPieces);
    sound.celebrate();
    updateHintBtn();
    showToast('团子伸爪一口气帮你拼好了 2 块！');
  };
  $('btn-wb-solve').onclick = () => wb.api?.autoSolve();
}

function renderWorkbenchCompleteModal(wb, tpl) {
  const modal = $('wb-complete-modal');
  if (!modal) return;
  const res = wb.lastResult || { reward: 0, ticketReward: 0, pieceCount: wb.pieceCount };
  const adRem = getAdRemaining(state, 'puzzleDouble');
  const baseCoins = Math.max(30, res.reward || (wb.pieceCount >= 48 ? 50 : 30));
  const cleared48 = (state.cleared48Postcards || []).includes(tpl.id);

  modal.classList.remove('hidden');
  modal.innerHTML = `
    <div class="wb-complete-card">
      <h3>${wb.pieceCount >= 48 ? '48 片进阶通关！' : '记忆显影完成！'}</h3>
      <div class="wb-complete-sub">${tpl.fullTitle || tpl.title} · 已盖「${tpl.postmark || '拾光镇'}」邮戳</div>
      <div class="wb-complete-photo">
        <img src="${tpl.src}" alt="${tpl.title}" />
      </div>
      <div class="wb-reward-strip">
        ${res.reward > 0
          ? `<span class="wb-reward-chip"><img src="./assets/icons/coin.webp" alt="" />+${res.reward} 主游戏金币</span>
             <span class="wb-reward-chip"><img src="./assets/icons/raffle-ticket.webp" alt="" />+${res.ticketReward} 旅途副券</span>`
          : `<span class="wb-reward-chip">温故知新 · 记忆愈发清晰</span>`}
      </div>

      <button class="craft-btn wb-ad-double-btn ${wb.doubleClaimed || adRem <= 0 ? 'claimed' : ''}" id="btn-wb-ad-double" ${wb.doubleClaimed || adRem <= 0 ? 'disabled' : ''}>
        <span class="ad-play-dot">▶</span>
        <span>${wb.doubleClaimed
          ? '已领取双倍邮戳奖励 ✓'
          : adRem > 0
            ? `咕咕加盖双倍邮戳：再得 +${baseCoins} 金币 & +1 副券 (${adRem}/3)`
            : '今日双倍邮戳次数已用完'}</span>
      </button>

      <div class="wb-unlock-box">
        <div class="u-head">已解锁该明信片更多片数拼图</div>
        <div class="u-desc">
          24 片显影后已自动入库《拼图小窝》主大厅《华夏行记》图集（支持 108 / 300 / 500 片大画布），也可在此直接挑战 48 片异形拼图！
        </div>
        <div class="wb-unlock-btns">
          <button class="craft-btn wb-u-btn" id="btn-wb-try-48">${cleared48 ? '再玩 48 片异形' : '挑战 48 片 (+50币)'}</button>
          <button class="craft-btn wb-u-btn main-sync" id="btn-wb-open-main">去主大厅拼 108/300 片</button>
        </div>
      </div>

      <div class="wb-complete-foot">
        <button class="craft-btn wb-foot-btn" id="btn-wb-to-mail">查看手记后记</button>
        <button class="craft-btn wb-foot-btn primary" id="btn-wb-to-china">收进《华夏集》</button>
      </div>
    </div>
  `;

  $('btn-wb-ad-double')?.addEventListener('click', async () => {
    const ad = await watchRewardedAd('puzzleDouble', `咕咕加盖双倍邮戳：额外获赠 +${baseCoins} 主游戏金币与 +1 旅途副券`);
    if (!ad.completed) return;
    const dRes = claimAdPuzzleDouble(state, wb.uid, baseCoins);
    if (!dRes.ok) return showToast(dRes.reason);
    wb.doubleClaimed = true;
    sound.celebrate();
    commit(dRes.state);
    if (dRes.coinDelta && dRes.ledgerSource) void pushMainWalletDelta(dRes.ledgerSource, dRes.coinDelta);
    showToast(`双倍邮戳生效！额外入账 +${dRes.extraCoins} 主游戏金币与 +1 副券`);
    renderWorkbenchCompleteModal(wb, tpl);
  });

  $('btn-wb-try-48')?.addEventListener('click', () => {
    openPuzzleWorkbench(wb.uid, 48, wb.returnScreen);
  });

  $('btn-wb-open-main')?.addEventListener('click', () => {
    if (window.jigsawHost?.openPuzzle) {
      window.jigsawHost.openPuzzle({ photoId: tpl.id, title: tpl.fullTitle || tpl.title, imageSrc: tpl.src, pieces: 108 });
      return;
    }
    sound.fishChime();
    showToast(`「${tpl.fullTitle || tpl.title}」已同步至《拼图小窝》主大厅图库，可开 108 / 300 / 500 片房间！`);
  });

  $('btn-wb-to-mail')?.addEventListener('click', () => {
    selectedPostcardUid = wb.uid;
    mailSubTab = 'postcards';
    setScreen('mailbox');
  });

  $('btn-wb-to-china')?.addEventListener('click', () => {
    scrapSubTab = 'china';
    setScreen('scrapbook');
  });
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
   RENDER: NOOK MAIN SCENE + 6 SCENES + IN-SITU DECOR + LIVE TUANZI
   ========================================================= */
function renderInSituDecorLayers(activeScene) {
  const plateEl = $('day1-plate-canvas');
  const plateImg = $('room-bg-day1');
  const coverImg = $('room-bg-day30');
  const layersEl = $('decor-layers');
  const slotsEl = $('decor-slots-overlay');
  const eq = state.equippedDecor || {};

  if (activeScene.layout === 'cover') {
    if (coverImg.getAttribute('src') !== activeScene.bg) coverImg.setAttribute('src', activeScene.bg);
    coverImg.style.opacity = '1';
    if (plateEl) plateEl.style.opacity = '0';
    layersEl.innerHTML = '';
    slotsEl.innerHTML = '';
    return;
  }

  // 同视角 768×1376 室内画板（初秋 / 仲春樱窗 / 雨巷听雨 / 盛夏萤夜 共用同一精确坐标系）
  if (plateImg.getAttribute('src') !== activeScene.bg) plateImg.setAttribute('src', activeScene.bg);
  if (plateEl) plateEl.style.opacity = '1';
  coverImg.style.opacity = '0';

  if (!activeScene.supportsDecor) {
    layersEl.innerHTML = '';
    slotsEl.innerHTML = '';
    return;
  }

  // 仅初秋自由装扮画板渲染 7 个原地融合羽化贴片（严格锁定原生 768×1376 百分比坐标，零贴纸漂移！）
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

  // 仅装扮模式（切到摆件页签时）显示「一格一位」轻盈虚线框
  if (decorMode && decorTab !== 'scene' && decorTab !== 'outfit') {
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
  // 在装扮抽屉编辑家具摆件时，自动展示「初秋午后」可摆件底图；在「场景 / 穿搭」页签下则实时预览当前选定场景！
  const activeScene = (decorMode && decorTab !== 'scene' && decorTab !== 'outfit')
    ? ROOM_SCENE_MAP['autumn-day']
    : view.activeScene;
  const isSnowRoom = activeScene.id === 'winter-snow';

  // 1. 装扮模式时上移整个实景舞台，露出全部木架、左桌台灯与团子
  $('screen-nook').classList.toggle('is-veranda', activeScene.id === 'sunset-veranda');
  $('nook-stage').classList.toggle('decor-mode', decorMode);
  $('nook-hud-layer').classList.toggle('hidden', decorMode);
  $('decor-ui-layer').classList.toggle('hidden', !decorMode);
  const canNightPreview = activeScene.supportsDecor;
  $('btn-decor-night').style.display = canNightPreview ? 'inline-flex' : 'none';
  $('night-preview-veil').classList.toggle('active', decorMode && canNightPreview && decorNightPreview);
  $('decor-night-label').textContent = decorNightPreview ? '切回初秋午后' : '试看雪夜灯效';

  renderInSituDecorLayers(activeScene);

  // 2. 更新窗外粒子气候 & 屋内动态台灯/廊灯/水母光晕 & 微尘
  const deskItem = eq.desk ? DECOR_ITEMS[eq.desk] : null;
  const effectiveLampGlow = activeScene.supportsDecor ? (deskItem?.lampGlow || null) : activeScene.lampGlow;
  const effectiveJellyGlow = activeScene.supportsDecor ? (eq.shelf1L === 's1l-jellyfish') : activeScene.hasJellyGlow;
  const effectiveWeather = (decorMode && canNightPreview && decorNightPreview) ? 'snow' : view.weather;

  atmosphere.setScene({
    weather: effectiveWeather,
    isEvolved: isSnowRoom,
    windowMode: activeScene.windowMode,
    dustLevel: decorMode ? 0 : state.dustLevel,
    lampGlow: effectiveLampGlow,
    hasJellyGlow: effectiveJellyGlow,
    nightPreview: decorMode && canNightPreview && decorNightPreview,
  });
  canvas.classList.toggle('interactive-dust', !decorMode && state.dustLevel > 0);
  $('dust-cue').style.display = !decorMode && state.dustLevel > 0 ? 'flex' : 'none';

  // 3. 顶部麻绳木牌日历 & 橡木金币牌 & 右上黄铜摇奖匣挂徽
  $('plaque-date').textContent = view.cal.cnDate;
  const weatherZh = {
    sun: '晴', autumn: '晴风', rain: '细雨', snow: '飘雪', sakura: '樱风', firefly: '夏夜',
  }[effectiveWeather] || '晴';
  const plaqueSub = view.hasPendingReunion
    ? `${view.cal.seasonLabel}${view.cal.isNight ? '雪夜' : view.cal.period} · 别${state.reunion.awayDays}日`
    : (state.sceneOverride || state.weatherOverride)
      ? `${activeScene.name} · ${activeScene.id === 'sunset-veranda' ? '橘海落日' : weatherZh}`
      : view.cal.plaqueSub;
  $('plaque-sub').textContent = plaqueSub;
  $('hud-coins').textContent = String(state.coins);

  $('btn-open-gacha').style.display = view.hasPendingReunion ? 'none' : 'flex';
  const tickets = state.tickets || 0;
  $('gacha-ticket-badge').style.display = tickets > 0 ? 'flex' : 'none';
  $('gacha-ticket-num').textContent = String(tickets);

  // 4. 窗台晒好的香酥小鱼干零食（含看视频双倍）+ 投喂按钮 + 旅途中咕咕加急飞鸽
  if (view.sillPortions > 0 && !view.hasPendingReunion) {
    $('sill-drop-group').style.display = 'flex';
    $('sill-gain').textContent = `小鱼干 +${view.sillPortions}`;
    const sillAdRem = getAdRemaining(state, 'sillDouble');
    $('btn-sill-ad').style.display = sillAdRem > 0 ? 'inline-flex' : 'none';
    $('sill-ad-label').textContent = `×2 (${sillAdRem})`;
  } else {
    $('sill-drop-group').style.display = 'none';
  }
  const fishCount = state.inventory.fish || 0;
  if (state.status === 'home' && !view.hasPendingReunion && fishCount > 0) {
    $('btn-feed-snack').style.display = 'flex';
    $('snack-count').textContent = `喂小鱼干 (${fishCount})`;
  } else {
    $('btn-feed-snack').style.display = 'none';
  }
  // 团子在旅途中时，显示咕咕加急飞鸽传书（激励广告 P1）
  const rushRem = getAdRemaining(state, 'tripRush');
  if (state.status === 'away' && state.trip && !view.hasPendingReunion && rushRem > 0) {
    $('btn-trip-rush').style.display = 'flex';
    $('trip-rush-sub').textContent = `▶ 看视频立刻带回明信片 (${rushRem}/2)`;
  } else {
    $('btn-trip-rush').style.display = 'none';
  }

  // 5. 门口红丝带信捆火漆（重逢雪夜房或有积压未读信件时显示）
  const showBundle = isSnowRoom && (view.hasPendingReunion || view.unreadTotal >= 2);
  $('btn-bundle-seal').style.display = showBundle ? 'flex' : 'none';
  $('bundle-count').textContent = String(Math.max(view.unreadTotal, view.hasPendingReunion ? 5 : 0));

  // 6. 团子活态姿态与整猫无缝穿搭（零贴纸帽！自动贴合当前场景坐垫坐标）
  const actor = $('tuanzi-actor');
  const sprite = $('tuanzi-sprite');
  const zzz = $('zzz-layer');
  const outfit = DECOR_ITEMS[eq.outfit] || DECOR_ITEMS['outfit-default'];
  actor.className = 'tuanzi-actor';
  if (activeScene.actorClass) actor.classList.add(activeScene.actorClass);
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
    } else if (!activeScene.supportsDecor) {
      $('rug-whisper').textContent = activeScene.whisper;
    } else if (deskItem) {
      $('rug-whisper').textContent = `${deskItem.name}亮着暖光，团子在绿花垫子上安稳打盹。`;
    } else if (outfit.id === 'outfit-postman') {
      $('rug-whisper').textContent = '团子戴着云邮局小圆帽，在午后阳光里打起了呼噜。';
    } else if (outfit.id === 'outfit-redscarf') {
      $('rug-whisper').textContent = '团子把小爪子缩进红绒围巾里，暖烘烘地眯起了眼。';
    } else {
      $('rug-whisper').textContent = activeScene.whisper;
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

  const view = getDerivedView(state);
  const gridEl = $('decor-grid');

  // 专属「场景」图鉴页签：6 套手绘实景小窝一键切换！
  if (decorTab === 'scene') {
    const isAuto = !state.sceneOverride;
    $('decor-slot-hint').innerHTML = `
      <span>当前实景：<b>${view.activeScene.name}</b>${isAuto ? '（随节气自动）' : ''}</span>
      ${isAuto ? '<span>点卡片随时切换</span>' : '<button class="craft-btn scene-auto-link" id="btn-scene-auto">恢复随节气自动</button>'}
    `;
    gridEl.innerHTML = ROOM_SCENES.map(sc => {
      const isCur = view.activeSceneId === sc.id;
      return `
        <button class="craft-btn decor-card scene-card ${isCur ? 'equipped' : ''}" data-pick-scene="${sc.id}">
          <img class="thumb" src="${sc.thumb}" alt="${sc.name}" />
          <div class="d-name">${sc.name}</div>
          <div class="d-state ${isCur ? 'on' : 'ready'}">${isCur ? '当前实景' : sc.badge}</div>
        </button>
      `;
    }).join('');
    $('decor-progress').textContent = `已收录手绘实景 ${ROOM_SCENES.length} / ${ROOM_SCENES.length} 套`;

    $('btn-scene-auto')?.addEventListener('click', () => {
      sound.paperTurn();
      commit(setSceneOverride(state, null));
      showToast('已恢复随公历四季与天气自动变换场景');
    });
    gridEl.querySelectorAll('[data-pick-scene]').forEach(btn => {
      btn.addEventListener('click', () => {
        const sid = btn.dataset.pickScene;
        const sc = ROOM_SCENE_MAP[sid];
        if (!sc) return;
        sound.decorSnap();
        let next = setSceneOverride(state, sid);
        next.weatherOverride = null;
        commit(next);
        atmosphere.spawnBurst(195, 360, 'chime');
        showToast(`已切换至「${sc.fullTitle}」`);
      });
    });
    return;
  }

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

  const gachaAdRem = getAdRemaining(state, 'gachaFree');
  const gachaAdBtn = $('btn-gacha-ad');
  if (gachaAdBtn) {
    gachaAdBtn.classList.toggle('exhausted', gachaAdRem <= 0);
    $('gacha-ad-text').textContent = gachaAdRem > 0
      ? `帮奶奶擦亮摇奖匣 · 看视频免费领 1 张副券 (今日 ${gachaAdRem}/3)`
      : '今日帮奶奶擦亮摇奖匣已领完，明日再来吧';
  }

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

    const cardIdx = cards.findIndex(c => c.uid === card.uid);
    const chinaStats = getChinaCollectionStats(state);
    const unlockedMore = card.developed || (state.unlockedMainGallery || []).includes(card.templateId);
    el.innerHTML = `
      ${topTabs}
      <div class="book-scroll">
        <div class="book-heading" style="margin-top:8px;">
          <h3 style="font-size:21px;">${tpl.fullTitle || tpl.title}</h3>
          <div class="date-line">
            ${tpl.isChina
              ? `<span class="cn-place-pill">${tpl.regionLabel}</span>${card.cnDate} · 寄自${tpl.place}`
              : `${card.seasonLabel} · ${card.cnDate} · 寄自${tpl.place}`}
          </div>
        </div>

        <div class="pc-stage-card">
          <img class="pc-tape" src="./assets/uikit/washi-tape.webp" alt="" />
          <div class="pc-photo-frame ${card.developed ? '' : 'undeveloped'}">
            <img src="${tpl.src}" alt="${tpl.title}" />
            ${card.developed ? '' : `
              <div class="pc-mist-overlay">
                <strong style="font-size:17px;">记忆尚未显影</strong>
                <span style="font-size:13px; line-height:1.5;">进入独立异形拼图台拼完 24 片<br/>即可看清全画并解锁更多片数</span>
              </div>
            `}
            <div class="pc-postmark-mini">
              <span>${tpl.postmark || '拾光镇'}</span>
              <span>${card.cnDate.slice(0, 4)}</span>
            </div>
          </div>
        </div>

        <div class="pc-pager-row">
          ${cards.length > 1
            ? `<button class="craft-btn ink-turn" id="pc-prev" style="${cardIdx <= 0 ? 'opacity:0.35' : ''}">← 上一张</button>
               <span>第 ${cardIdx + 1} / ${cards.length} 张</span>
               <button class="craft-btn ink-turn" id="pc-next" style="${cardIdx >= cards.length - 1 ? 'opacity:0.35' : ''}">下一张 →</button>`
            : `<span>共 ${cards.length} 张明信片</span>`}
          <button class="craft-btn china-jump-link" id="pc-open-china">华夏集 ${chinaStats.collected}/${chinaStats.total} ›</button>
        </div>

        <div class="pc-quote-card">
          <div class="pc-quote-text">“${tpl.line}”</div>
          <div class="letter-sign">—— 团子</div>
        </div>

        ${card.developed ? `
          <div class="margin-stamp-row" style="margin-top:4px; padding-top:10px;">
            <img class="portrait" src="${NPCS[tpl.npcId].portrait}" alt="" style="width:48px; height:48px;" />
            <div>
              <div class="ms-title">隐形墨水后记已显现 · 已同步主大厅大图</div>
              <div class="ms-sub">${tpl.hiddenNote}</div>
            </div>
          </div>
        ` : `
          <div class="pc-hint-strip">
            未显影明信片不耗体力：进入全屏拼图台完成 24 片异形显影可得 +30 金币，并解锁 48 片与主大厅 108/300 片。
          </div>
        `}
      </div>

      <div class="book-cta-center">
        <button class="craft-btn book-wax-ribbon-btn" id="btn-play-pc">
          <img class="rb" src="./assets/uikit/paper-ribbon.webp" alt="" />
          <span>${unlockedMore ? '挑战 48 片异形拼图' : '全屏 24 片显影 (+30 金币)'}</span>
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
    $('pc-open-china')?.addEventListener('click', () => {
      scrapSubTab = 'china';
      setScreen('scrapbook');
    });
    $('btn-play-pc').addEventListener('click', () => {
      openPuzzleWorkbench(card.uid, unlockedMore ? 48 : 24, 'mailbox');
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
    <div class="book-top-bar compact-tabs">
      <button class="craft-btn ink-return" id="bk-close">
        <svg viewBox="0 0 24 24"><path d="M15 6l-6 6 6 6"/></svg>
        <span>回小窝</span>
      </button>
      <div class="book-tabs compact">
        <button class="craft-btn book-tab ${scrapSubTab === 'china' ? 'active' : ''}" data-stab="china">华夏集</button>
        <button class="craft-btn book-tab ${scrapSubTab === 'overview' ? 'active' : ''}" data-stab="overview">拾光记</button>
        <button class="craft-btn book-tab ${scrapSubTab === 'souvenirs' ? 'active' : ''}" data-stab="souvenirs">风物</button>
        <button class="craft-btn book-tab ${scrapSubTab === 'memories' ? 'active' : ''}" data-stab="memories">经历</button>
      </div>
    </div>
  `;

  if (scrapSubTab === 'china') {
    const stats = getChinaCollectionStats(state);
    const filtered = chinaRegionFilter === 'all'
      ? stats.items
      : stats.items.filter(it => it.tpl.chinaRegion === chinaRegionFilter);
    const pct = Math.round((stats.collected / stats.total) * 100);
    const wishedTpl = state.nextGuaranteedCardId ? POSTCARD_POOL[state.nextGuaranteedCardId] : null;
    const wishAdRem = getAdRemaining(state, 'chinaWish');

    el.innerHTML = `
      ${topTabs}
      <div class="china-progress-box">
        <div class="cp-head">
          <div>
            <h3>华夏行记 · 集邮册</h3>
            <div class="cp-sub">已集齐 <b>${stats.collected} / ${stats.total}</b> 城 · 已显影 ${stats.developed} 张</div>
          </div>
          <span class="cp-rank-seal">${stats.rankSeal}</span>
        </div>
        <div class="cp-bar-track"><div class="cp-bar-fill" style="width:${pct}%;"></div></div>
      </div>

      ${wishedTpl ? `
        <div class="china-wish-banner">
          <span>顺风定向签已生效：下趟必去【${wishedTpl.fullTitle}】</span>
        </div>
      ` : ''}

      <div class="china-region-pills">
        ${CHINA_REGIONS.map(r => `
          <button class="craft-btn cr-pill ${chinaRegionFilter === r.id ? 'active' : ''}" data-creg="${r.id}">${r.label}</button>
        `).join('')}
      </div>

      <div class="book-scroll">
        <div class="china-album-grid">
          ${filtered.map(item => {
            const t = item.tpl;
            if (item.collected) {
              return `
                <button class="craft-btn china-card ${item.developed ? 'developed' : 'misty'}" data-china-open="${item.owned.uid}" data-china-dev="${item.developed ? '1' : '0'}">
                  <div class="cc-photo-wrap">
                    <img src="${t.src}" alt="${t.fullTitle}" />
                    <span class="cc-postmark">${t.postmark}</span>
                    ${item.developed ? '' : '<span class="cc-mist-tag">24片显影 +30币</span>'}
                  </div>
                  <div class="cc-meta">
                    <div class="cc-city">${t.province} · ${t.city}</div>
                    <div class="cc-title">${t.title}</div>
                  </div>
                </button>
              `;
            }
            const isWished = state.nextGuaranteedCardId === t.id;
            return `
              <button class="craft-btn china-card locked" data-china-hint="${t.id}">
                <div class="cc-photo-wrap silhouette">
                  <div class="cc-stamp-icon">
                    <svg viewBox="0 0 24 24"><path d="M3 18l5.5-8 4 5.5 3-4L21 18H3z"/><circle cx="16.5" cy="7.5" r="2"/></svg>
                    <span>${isWished ? '已许愿必达 ✓' : (wishAdRem > 0 ? '▶ 求顺风签' : '尚未寄达')}</span>
                  </div>
                </div>
                <div class="cc-meta">
                  <div class="cc-city">${t.province} · ${t.city}</div>
                  <div class="cc-hint">${t.hint}</div>
                </div>
              </button>
            `;
          }).join('')}
        </div>
      </div>
    `;

    bindBookCommon(el);
    el.querySelectorAll('[data-creg]').forEach(btn => {
      btn.addEventListener('click', () => {
        chinaRegionFilter = btn.dataset.creg;
        sound.paperTurn();
        renderScrapbookBook(el);
      });
    });
    el.querySelectorAll('[data-china-open]').forEach(btn => {
      btn.addEventListener('click', () => {
        const uid = btn.dataset.chinaOpen;
        if (btn.dataset.chinaDev === '0') {
          openPuzzleWorkbench(uid, 24, 'scrapbook');
          return;
        }
        selectedPostcardUid = uid;
        mailSubTab = 'postcards';
        setScreen('mailbox');
      });
    });
    el.querySelectorAll('[data-china-hint]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const tpl = POSTCARD_POOL[btn.dataset.chinaHint];
        if (!tpl) return;
        if (state.nextGuaranteedCardId === tpl.id) {
          showToast(`已锁定顺风定向签！装好口粮送团子出门，必去【${tpl.fullTitle}】`);
          return;
        }
        if (getAdRemaining(state, 'chinaWish') <= 0) {
          sound.paperTurn();
          showToast(`「${tpl.fullTitle}」尚未寄达：${tpl.hint}`);
          return;
        }
        const ad = await watchRewardedAd('chinaWish', `求一张「顺风定向签」：团子下一次出门必去【${tpl.fullTitle}】！（${tpl.hint}）`);
        if (!ad.completed) return;
        const res = claimAdChinaWish(state, tpl.id);
        if (!res.ok) return showToast(res.reason);
        sound.celebrate();
        commit(res.state);
        showToast(`顺风签求成！下趟送团子出门必去【${tpl.fullTitle}】`);
      });
    });
    return;
  }

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
  const sceneEl = $('dbg-scene');
  if (sceneEl) {
    sceneEl.textContent = state.sceneOverride ? `手动：${view.activeScene.name}` : `自动：${view.activeScene.name}`;
  }
  $('dbg-weather').textContent = state.weatherOverride ? `手动：${state.weatherOverride}` : `自动：${view.cal.weatherLabel}`;
  $('dbg-plant').textContent = `${view.plantStageLabel} (${Math.round(state.plantGrowth)}%)`;
  $('dbg-decor-cnt').textContent = `${(state.ownedDecor || []).length} / ${Object.keys(DECOR_ITEMS).length} 件`;
  const wBadge = $('dbg-wallet-state');
  if (wBadge) {
    wBadge.textContent = walletMeta.linked
      ? `已直连主库 · ${state.coins} 金币`
      : `本地钱包 · ${state.coins} 金币`;
  }

  document.querySelectorAll('[data-scene]').forEach(btn => {
    const val = btn.dataset.scene;
    if (val === 'auto') return;
    btn.classList.toggle('active', view.activeSceneId === val);
  });
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

$('btn-sill-ad').addEventListener('click', async () => {
  const ad = await watchRewardedAd('sillDouble');
  if (!ad.completed) return;
  const res = claimAdSillDouble(state);
  if (!res.ok) return showToast(res.reason);
  sound.celebrate();
  atmosphere.spawnBurst(96, 372, 'reunion');
  showToast(`阳光双倍晒好！收下 +${res.gained} 条香酥小鱼干零食`);
  commit(res.state);
});

$('btn-trip-rush').addEventListener('click', async () => {
  const ad = await watchRewardedAd('tripRush');
  if (!ad.completed) return;
  const res = claimAdTripRush(state);
  if (!res.ok) return showToast(res.reason);
  state = res.state;
  saveState(state);
  playReturnAnimation();
  const title = POSTCARD_POOL[res.postcard?.templateId]?.fullTitle || '新明信片';
  showToast(`咕咕加急送到！团子带着《${title}》提前到家啦`);
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
  const sid = view.activeSceneId;
  const hasPlaced = sid === 'autumn-day' && state.equippedDecor?.window === 'win-windchime';
  const hasBuiltIn = ['winter-snow', 'spring-sakura', 'summer-firefly', 'sunset-veranda'].includes(sid);
  if (!hasBuiltIn && !hasPlaced) return;
  sound.windchime();
  atmosphere.spawnBurst(sid === 'sunset-veranda' ? 278 : 154, sid === 'sunset-veranda' ? 190 : 240, 'chime');
  showToast(sid === 'summer-firefly' ? '叮铃——玻璃风铃在夏夜微风里清脆轻响' : '叮当——海湾贝壳风铃在微风里轻轻摇晃');
});

$('hotspot-musicbox').addEventListener('click', () => {
  if (decorMode) return;
  const sid = getDerivedView(state).activeSceneId;
  const hasBox = (sid === 'autumn-day' && state.equippedDecor?.shelf1R === 's1r-musicbox') || sid === 'rainy-alley';
  if (!hasBox) return;
  sound.musicBox();
  atmosphere.spawnBurst(328, 232, 'reunion');
  showToast('叮叮咚咚……黄铜木八音盒奏起一小段摇篮曲');
});

// 实景装扮入口与抽屉事件
$('btn-open-decor').addEventListener('click', () => {
  const cur = getDerivedView(state).activeScene;
  if (!cur.supportsDecor) {
    activeScreen = 'nook';
    decorMode = true;
    selectedDecorSlot = null;
    decorTab = 'scene';
    $('screen-nook').classList.remove('hidden');
    $('screen-bag').classList.add('hidden');
    $('screen-gacha').classList.add('hidden');
    $('screen-book').classList.add('hidden');
    sound.paperTurn();
    renderAll();
    return;
  }
  enterDecorMode('desk');
});
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
    selectedDecorSlot = (decorTab === 'all' || decorTab === 'scene') ? null : (firstSlot ? firstSlot.id : null);
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
$('btn-gacha-ad').addEventListener('click', async () => {
  const ad = await watchRewardedAd('gachaFree');
  if (!ad.completed) return;
  const res = claimAdGachaTicket(state);
  if (!res.ok) return showToast(res.reason);
  sound.celebrate();
  commit(res.state);
  showToast('奶奶递来 +1 张免费「旅途副券」，快去摇摇看吧！');
});

$('hotspot-apang').addEventListener('click', () => {
  if (!getDerivedView(state).activeScene.hasApang) return;
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

document.querySelectorAll('[data-scene]').forEach(btn => {
  btn.addEventListener('click', () => {
    const sid = btn.dataset.scene;
    state = setSceneOverride(state, sid);
    state.weatherOverride = null;
    saveState(state);
    sound.paperTurn();
    if (activeScreen !== 'nook') setScreen('nook');
    else renderAll();
    const sc = ROOM_SCENE_MAP[sid];
    showToast(sc ? `已切换至「${sc.fullTitle}」` : '已恢复随四季节气自动切换实景');
  });
});

document.querySelectorAll('[data-weather]').forEach(btn => {
  btn.addEventListener('click', () => {
    const w = btn.dataset.weather;
    state.weatherOverride = w === 'auto' ? null : w;
    state.sceneOverride = null;
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

$('btn-demo-china-album')?.addEventListener('click', () => {
  state = structuredClone(state);
  CHINA_POSTCARD_IDS.forEach((cid, idx) => {
    const existing = state.postcards.find(c => c.templateId === cid);
    if (existing) {
      existing.developed = idx < 6; // 保留最后 2 张待拼图显影方便体验！
      existing.read = idx < 6;
    } else {
      state.postcards.unshift({
        uid: `pc-demo-${cid}`,
        templateId: cid,
        arrivedAt: state.now - (idx + 1) * HOUR,
        seasonLabel: POSTCARD_POOL[cid].seasonTag,
        cnDate: ['十月十八', '三月十二', '五月廿四', '六月初八', '十一月雪', '腊月十五', '七月初六', '四月廿一'][idx] || '十月十八',
        read: idx < 6,
        developed: idx < 6,
      });
    }
  });
  saveState(state);
  sound.celebrate();
  scrapSubTab = 'china';
  chinaRegionFilter = 'all';
  setScreen('scrapbook');
  showToast('已集齐 8 城《华夏行记》中国明信片（留 2 张可体验拼图显影）');
});

// 支持 URL ?demo=day30|decorated|china-album|china-partial 和 ?screen=gacha|decor|shop|mailbox|scrapbook|bag 直接预览指定页
const urlParams = new URLSearchParams(location.search);
if (urlParams.get('demo') === 'china-album' || urlParams.get('demo') === 'china-partial') {
  state = createInitialState();
  const isFull = urlParams.get('demo') === 'china-album';
  const count = isFull ? CHINA_POSTCARD_IDS.length : 4;
  state.postcards = [];
  CHINA_POSTCARD_IDS.slice(0, count).forEach((cid, idx) => {
    state.postcards.push({
      uid: `pc-demo-${cid}`,
      templateId: cid,
      arrivedAt: state.now - (idx + 1) * HOUR,
      seasonLabel: POSTCARD_POOL[cid].seasonTag,
      cnDate: ['十月十八', '三月十二', '五月廿四', '六月初八', '十一月雪', '腊月十五', '七月初六', '四月廿一'][idx] || '十月十八',
      read: isFull ? true : idx < 3,
      developed: isFull ? true : idx < 3,
    });
  });
} else if (urlParams.get('demo') === 'day30') {
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
} else if (urlParams.get('demo') === 'day90-post') {
  state = createInitialState();
  state = packBag(state, { food: 'bento', tool: 'camera', wish: 'token-apang' });
  state = togglePantrySlot(state, 1, 'osmanthus');
  state = simulateTo(state, state.now + 90 * DAY + 6 * HOUR).state;
  state = claimReunionGift(state).state;
  state.ownedDecor = Object.keys(DECOR_ITEMS);
  state.equippedDecor = {
    ...state.equippedDecor,
    desk: 'lamp-mushroom',
    window: 'win-teru',
    shelf1L: 's1l-jellyfish',
    shelf2L: 's2l-vase',
    shelf2R: 's2r-sailboat',
    outfit: 'outfit-redscarf',
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
const urlScene = urlParams.get('scene');
if (urlScene && ROOM_SCENE_MAP[urlScene]) {
  state = setSceneOverride(state, urlScene);
  state.weatherOverride = null;
}
const initScreen = urlParams.get('screen');
if (initScreen === 'puzzle') {
  const pieceParam = Number(urlParams.get('pieces') || 24);
  const targetUid = state.postcards[0]?.uid;
  if (targetUid) {
    renderAll();
    openPuzzleWorkbench(targetUid, pieceParam === 48 ? 48 : 24, 'mailbox');
    if (urlParams.get('solved') === '1') {
      setTimeout(() => activeWorkbench?.api?.autoSolve(), 300);
    }
  }
} else if (initScreen === 'decor') {
  decorMode = true;
  decorNightPreview = urlParams.get('night') === '1';
  const initTab = urlParams.get('tab');
  selectedDecorSlot = initTab === 'scene' ? null : 'desk';
  decorTab = ['scene', 'desk', 'shelf', 'window', 'outfit'].includes(initTab) ? initTab : 'desk';
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
