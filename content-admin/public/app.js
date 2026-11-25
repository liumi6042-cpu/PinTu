import { createReleasePanel } from './release-ui.js';
import { renderImport } from './import-ui.js';
import { createDragPayload, parseDragPayload } from './album-drag.js';
import { dailyImageState, tomorrowDate, nextOpenDailyDate, automaticDailyPlan } from './daily-state.js';
import { renderTaskRewards, readTaskRewardForm, updateTaskRewardInput } from './task-rewards-ui.js';
import { renderGameSettings, readGameSettingsForm, updateGameSettingInput, addGameMilestone, removeGameMilestone, renderGameLevelPreview, renderGameDecorationPreview } from './game-settings-ui.js';
import { createAlbumRecovery } from './album-recovery.js';
import { planImageDeletion, deleteImages, restoreImages } from './image-trash.js';
import { ensureAlbumRewardIds, addAlbumReward, renderAlbumRewards } from './album-rewards-ui.js';

const app = document.querySelector('#app');
const modal = document.querySelector('#modal');
const toastNode = document.querySelector('#toast');
const confirmation = document.createElement('dialog');
confirmation.id = 'action-confirm';
confirmation.setAttribute('aria-labelledby', 'confirmation-title');
document.body.append(confirmation);
let resolveConfirmation = null;
const TARGETS = { pc: 'PC 网页', 'mobile-shared': '小程序' };
const FIELD_NAMES = { name: '名称', title: '标题', subtitle: '副标题', description: '说明', styleGroupId: '画风分组', subjectTags: '题材标签', visible: '旧相册显示', showOnPc: '在 PC 显示', showOnMobile: '在小程序显示', purchasable: '设为购买包', deleted: '移入回收站', status: '历史展示状态', galleryVisible: '历史图库展示', dailyOnly: '每日专用', category: '原分类', imageIds: '图片与顺序', coverImageId: '封面', price: '金币价格', decorationId: '奖励装饰', packId: '历史图包关联', milestones: '里程碑', added: '新增', removed: '移除', packOrder: '历史图包顺序', albumOrder: '相册顺序' };
// Every album starts with the same collection rewards: three pictures pay 30
// coins, six pay 60. The album settings dialog can still add, change or remove
// tiers; this is only the starting point for a new album.
const ALBUM_DEFAULT_MILESTONES = () => [
  { id: 'milestone-3', target: 3, coins: 30, decorationId: null },
  { id: 'milestone-6', target: 6, coins: 60, decorationId: null },
];
const ENTITY_NAMES = { draft: '工作内容', style: '画风', asset: '图片', pack: '历史图包', album: '相册', target: '内容目标' };
const AUDIT_NAMES = { 'import-baseline': '导入内容基线', 'initialize-admin': '创建管理员', login: '管理员登录', logout: '管理员退出', 'create-draft': '建立工作内容', 'save-draft': '保存相册整理', 'reimport-source': '同步原项目内容', 'generate-candidate': '生成游戏更新文件', 'save-snapshot': '保存完整备份', 'restore-version': '恢复备份为当前工作内容', 'import-pending-assets': '导入新图并整理', 'initialize-task-rewards': '导入任务奖励', 'save-task-rewards': '保存任务奖励' };
const state = {
  session: null, bootstrap: null, draft: null, target: 'shared', exportTarget: 'mobile-shared', page: 'albums',
  dirty: false, busy: false, selected: new Set(), albumId: null,
  filters: { query: '', style: '', tag: '', origin: '', direction: '', review: '', lifecycle: '', daily: '' },
  analysis: null, picker: null, version: null, fileIndex: 0,
  versionAdvancedOpen: false,
  historyOpen: false, settings: null, dragGesture: null, suppressClickUntil: 0, suppressClickPoint: null,
  taskRewards: null, taskRewardDocument: null, taskRewardsDirty: false, taskRewardConflict: false,
  gameSettings: null, gameSettingDocument: null, gameSettingsDirty: false, gameSettingConflict: false,
  savedAlbumDocument: null, albumRecoveryEntry: null,
  importQueue: [], importStyles: [], importReceipts: [], importBusy: false, importProgress: 0, importError: '',
};
const albumRecovery = createAlbumRecovery();
Object.assign(AUDIT_NAMES, {'initialize-game-settings':'导入成长与装饰设置','save-game-settings':'保存成长与装饰设置'});
const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const attr = esc;
const doc = () => state.draft?.document;
const isGameSettingsPage = () => ['growth', 'decorations'].includes(state.page);
const hasUnsavedEdits = () => state.dirty || state.taskRewardsDirty || state.gameSettingsDirty;
const releasePanel = createReleasePanel({api, hasUnsavedEdits:() => hasUnsavedEdits() || Boolean(state.settings)});
const assets = () => Array.isArray(state.bootstrap?.source?.assets) ? state.bootstrap.source.assets : Object.values(state.bootstrap?.source?.assets || {});
const availableAssets = () => assets().filter(asset => !managed(asset.id).deleted);
const assetById = id => assets().find(asset => asset.id === id);
const managed = id => doc()?.assets?.[id] || {};
const targetAsset = id => managed(id).targets?.['mobile-shared'] || {};
const targetDoc = () => doc() || { albums: [] };
const albumShown = album => Boolean(album.showOnPc || album.showOnMobile);
const albumDisplayLabel = album => album.showOnPc && album.showOnMobile ? 'PC 与小程序显示' : album.showOnPc ? '仅 PC 显示' : album.showOnMobile ? '仅小程序显示' : '两端隐藏';
const albumDisplayChips = album => !album.imageIds.length ? '<span class="chip hidden">空相册 · 玩家端自动隐藏</span>' : `<span class="chip ${album.showOnPc ? '' : 'hidden'}">${album.showOnPc ? 'PC 显示' : 'PC 隐藏'}</span><span class="chip ${album.showOnMobile ? '' : 'hidden'}">${album.showOnMobile ? '小程序显示' : '小程序隐藏'}</span>`;
const albumFor = id => (targetDoc().albums || []).find(album => album.imageIds.includes(id));
const styles = () => doc()?.styles || [];
const styleName = id => styles().find(style => style.id === id)?.name || '待分类';
const dailyFor = id => dailyImageState({imageId:id,plans:doc()?.dailyPlans || [],appearances:state.bootstrap?.daily?.appearances || [],enrollments:state.bootstrap?.daily?.enrollments || [],isLegacy:targetAsset(id).dailyOnly});
const dailyReadiness = id => state.bootstrap?.daily?.readiness?.find(item => item.imageId === id);
const titleFor = id => managed(id).title || assetById(id)?.title || id;
const runtimeAvailable = asset => asset.runtimeAvailable ?? asset.lifecycle === 'retained';
const integrationLabel = asset => runtimeAvailable(asset) ? '' : '待接入游戏';
const imageUrl = (id, kind = 'thumbnail') => `/api/images/${encodeURIComponent(id)}?kind=${kind}`;
const date = value => value ? new Date(value).toLocaleString('zh-CN', { hour12: false, timeZone: 'Asia/Shanghai' }) : '—';
const textValue = value => typeof value === 'string' ? value : JSON.stringify(value ?? null);
const bindAttr = path => `data-bind="${attr(JSON.stringify(path))}"`;
const labelTarget = target => TARGETS[target] || (target === 'shared' ? 'PC 与小程序共用' : target) || '完整规划';

function toast(message, error = false) {
  toastNode.textContent = message;
  toastNode.className = error ? 'error' : '';
  toastNode.classList.add('visible');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { toastNode.classList.remove('visible'); }, error ? 7000 : 3500);
}

async function api(path, { method = 'GET', body } = {}) {
  const headers = { Accept: 'application/json' };
  // File uploads carry their own multipart Content-Type, so never override it.
  const isForm = typeof FormData !== 'undefined' && body instanceof FormData;
  if (body !== undefined && !isForm) headers['Content-Type'] = 'application/json';
  if (method !== 'GET' && state.session?.csrfToken) headers['X-CSRF-Token'] = state.session.csrfToken;
  const response = await fetch(path, { method, headers, credentials: 'same-origin', body: body === undefined ? undefined : isForm ? body : JSON.stringify(body) });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(result.error || `操作未完成（${response.status}）`);
    error.status = response.status; error.code = result.code; error.analysis = result.analysis; error.receipt = result.receipt;
    if (response.status === 401 && state.session?.authenticated && result.code === 'LOGIN_REQUIRED') {
      state.session.authenticated = false;
      renderAuth('登录已过期，请重新登录。当前未保存编辑仍在本窗口保留。');
    }
    throw error;
  }
  return result;
}

async function busy(task) {
  if (state.busy) return;
  state.busy = true;
  document.body.classList.add('loading-inline');
  try { return await task(); }
    catch (error) { toast(error.status === 409 ? `${error.message}。本窗口编辑已保留，请重新载入后合并。` : error.message, true); }
  finally { state.busy = false; document.body.classList.remove('loading-inline'); }
}

function dirty({sourceOnly=false} = {}) {
  state.dirty = true;
  if (!sourceOnly) {
    state.albumRecoveryEntry = null;
    if (state.draft && state.session?.user?.username) albumRecovery.save({owner:state.session.user.username,draftId:state.draft.id,revision:state.draft.revision,document:doc(),baseDocument:state.savedAlbumDocument});
  }
  state.analysis = null;
  const node = document.querySelector('#save-state');
  if (node) { node.textContent = '有未保存编辑'; node.classList.remove('saved'); }
  const save = document.querySelector('[data-action="save"]');
  if (save) save.disabled = false;
  document.title = '● 拼图 · 内容工作室';
}

function markSaved({clearRecovery=true} = {}) {
  state.dirty = false;
  if (clearRecovery && state.draft && state.session?.user?.username) albumRecovery.clear({owner:state.session.user.username,draftId:state.draft.id});
  if (clearRecovery) state.albumRecoveryEntry = null;
  document.title = '拼图 · 内容工作室';
  const node = document.querySelector('#save-state');
  if (node) { node.textContent = '已保存'; node.classList.add('saved'); }
  const save = document.querySelector('[data-action="save"]');
  if (save) save.disabled = true;
}

async function saveDraft({ quiet = false } = {}) {
  if (!state.draft || !state.dirty) return state.draft;
  const result = await api(`/api/drafts/${encodeURIComponent(state.draft.id)}`, {
    method: 'PUT', body: { revision: state.draft.revision, document: doc() },
  });
  const saved = result.draft || result;
  if (!Number.isSafeInteger(saved.revision)) throw new Error('保存响应缺少版本号，请重新打开页面核对。');
  state.draft = saved.document ? saved : { ...state.draft, ...saved };
  state.savedAlbumDocument = structuredClone(state.draft.document);
  const existing = state.bootstrap.drafts.find(item => item.id === state.draft.id);
  if (existing) Object.assign(existing, { revision: state.draft.revision, name: state.draft.name, updatedAt: state.draft.updatedAt });
  markSaved();
  const audit = await api('/api/audit').catch(() => null);
  if (audit) state.bootstrap.audit = audit.audit || [];
  if (!quiet) toast('相册整理已保存。');
  await refreshDaily().catch(() => {});
  return state.draft;
}

function setTaskRewards(settings) {
  state.taskRewards = settings;
  state.taskRewardDocument = structuredClone(settings.document);
  state.taskRewardsDirty = false;
  state.taskRewardConflict = false;
}

async function saveTaskRewards(form = document.querySelector('#task-rewards-form')) {
  if (!state.taskRewardsDirty || !state.taskRewards || !form) return;
  try {
    const settings = await api('/api/task-rewards', {method:'PUT',body:{revision:state.taskRewards.revision,document:readTaskRewardForm(form)}});
    setTaskRewards(settings);
    state.bootstrap.taskRewards = settings;
    render(); toast('任务奖励已保存，新产生的奖励会使用这些数值。');
  } catch (error) {
    if (error.status === 409) { state.taskRewardConflict = true; render(); }
    toast(error.message, true);
  }
}

function setGameSettings(settings) {
  state.gameSettings = settings;
  state.gameSettingDocument = structuredClone(settings.document);
  state.gameSettingsDirty = false;
  state.gameSettingConflict = false;
}

function markGameSettingsDirty() {
  state.gameSettingsDirty = true;
  const button = document.querySelector('#game-settings-save'); if (button) button.disabled = false;
  const status = document.querySelector('#game-settings-state');
  if (status) { status.textContent = '游戏设置有未保存修改'; status.className = 'dirty'; }
}

function updateGameSettingsField(element) {
  updateGameSettingInput(state.gameSettingDocument, element.name, element.type === 'checkbox' ? element.checked : element.value, element.type);
  markGameSettingsDirty();
  const preview = document.querySelector('#game-level-preview');
  if (preview) preview.innerHTML = renderGameLevelPreview(state.gameSettingDocument);
  const decoration = /^decorations\.(\d+)\./.exec(element.name);
  if (decoration) {
    const index = Number(decoration[1]), node = document.querySelector(`[data-decoration-preview="${index}"]`);
    if (node) node.innerHTML = renderGameDecorationPreview(state.gameSettingDocument.decorations[index]);
  }
  const fixedRefill = document.querySelector('[name="energy.upgradeEnergy"]');
  if (fixedRefill) fixedRefill.disabled = state.gameSettingDocument.energy.upgradeRefill !== 'fixed';
  for (const [name, attribute, value] of [
    ['energy.initial','max',state.gameSettingDocument.energy.baseCap],
    ['energy.maximumCap','min',state.gameSettingDocument.energy.baseCap],
    ['progression.laterXpMaximum','min',state.gameSettingDocument.progression.earlyXp[9]],
    ['collection.completionFragmentMaximum','min',state.gameSettingDocument.collection.completionFragmentMinimum],
  ]) {
    const input = document.querySelector(`[name="${name}"]`);
    if (input && value !== '' && Number.isFinite(Number(value))) input.setAttribute(attribute, String(value));
  }
}

async function saveGameSettings(form = document.querySelector('#game-settings-form')) {
  if (!state.gameSettingsDirty || !state.gameSettings || !form) return;
  try {
    const settings = await api('/api/game-settings', {method:'PUT',body:{revision:state.gameSettings.revision,document:readGameSettingsForm(form,state.gameSettingDocument)}});
    setGameSettings(settings); state.bootstrap.gameSettings = settings;
    render(); toast('游戏设置已保存，之后的拼合、升级和新奖励会采用新规则。');
  } catch (error) {
    if (error.status === 409) { state.gameSettingConflict = true; render(); }
    toast(error.message, true);
  }
}

async function refreshDaily() {
  if (!state.session?.authenticated || !state.draft) return;
  const result = await api('/api/daily/status');
  const factsChanged = JSON.stringify(state.bootstrap.daily || {}) !== JSON.stringify(result.daily || {});
  state.bootstrap.daily = result.daily || {};
  if (result.draftRevision !== state.draft.revision) {
    if (state.dirty) {
      if (state.dailyConflictRevision !== result.draftRevision) toast('每日图片已自动收录。本窗口未保存编辑已保留，保存前请重新载入合并。', true);
      state.dailyConflictRevision = result.draftRevision;
      return;
    }
    const albumId = state.albumId;
    await loadDraft(state.draft.id);
    state.albumId = doc().albums.some(album => album.id === albumId) ? albumId : null;
    if (!modal.open && !(state.page === 'task-rewards' && state.taskRewardsDirty) && !(isGameSettingsPage() && state.gameSettingsDirty)) render();
  } else if (factsChanged && !hasUnsavedEdits() && !modal.open) render();
}

async function loadDraft(id) {
  state.draft = await api(`/api/drafts/${encodeURIComponent(id)}`);
  if (state.draft.draft) state.draft = state.draft.draft;
  state.analysis = null;
  state.selected.clear();

  state.albumId = null;
  state.savedAlbumDocument = structuredClone(state.draft.document);
  const entries = albumRecovery.entries({owner:state.session.user.username,draftId:state.draft.id});
  state.albumRecoveryEntry = entries.find(entry => entry.revision === state.draft.revision && JSON.stringify(entry.document) !== JSON.stringify(state.savedAlbumDocument)) || null;
  markSaved({clearRecovery:false});
  if (state.draft.sourceNeedsMerge) dirty({sourceOnly:true});
}

async function initialize({ keepDraft = false } = {}) {
  state.session = await api('/api/session');
  if (!state.session.authenticated) { renderAuth(); return; }
  state.bootstrap = await api('/api/bootstrap');
  if (!(keepDraft && state.taskRewardsDirty) && state.bootstrap.taskRewards) setTaskRewards(state.bootstrap.taskRewards);
  if (!(keepDraft && state.gameSettingsDirty) && state.bootstrap.gameSettings) setGameSettings(state.bootstrap.gameSettings);
  if (!(keepDraft && state.draft)) {
    const id = state.bootstrap.activeDraftId || state.bootstrap.drafts?.[0]?.id;
    if (id) await loadDraft(id);
    else state.draft = null;
  }
  render();
}

function renderAuth(error = '') {
  closeModal();
  const setup = state.session?.setupRequired;
  app.innerHTML = `<main class="auth-layout">
    <section class="auth-intro"><div class="eyebrow">JIGSAW CONTENT STUDIO</div><h1>整理每一幅画，<br>留住每一份发现。</h1><p>把图片放进相册，每个相册就是一本图鉴。显示、隐藏与购买设置都在相册里完成。</p><small>本地内容工作室 · 私有管理</small></section>
    <section class="auth-card-wrap"><form class="auth-card" id="auth-form"><h2>${setup ? '创建首位管理员' : '管理员登录'}</h2><p class="auth-subtitle">${setup ? '首次在本机初始化。请设置独立账号和至少 10 位密码。' : '使用本地内容管理员账号。玩家账号不用于此后台。'}</p><div class="auth-error" role="alert">${esc(error)}</div>
      <label class="field"><b>管理员用户名</b><input name="username" required autocomplete="username" minlength="2" maxlength="40" autofocus></label>
      <label class="field"><b>密码</b><input name="password" type="password" maxlength="128" required ${setup ? 'minlength="10"' : ''} autocomplete="${setup ? 'new-password' : 'current-password'}"></label>
      ${setup ? '<label class="field"><b>再次输入密码</b><input name="confirmPassword" type="password" maxlength="128" minlength="10" required autocomplete="new-password"></label>' : ''}
      <button class="primary" type="submit">${setup ? '创建并进入工作室' : '进入工作室'}</button><p class="muted text-small space-top">整理完成后保存。未放进相册的图片只在后台保留。</p>
    </form></section></main>`;
  document.querySelector('#auth-form').addEventListener('submit', event => {
    event.preventDefault();
    const data = new FormData(event.target);
    if (setup && data.get('password') !== data.get('confirmPassword')) {
      event.target.querySelector('.auth-error').textContent = '两次输入的密码不一致。'; return;
    }
    busy(async () => {
      try {
        await api(setup ? '/api/setup' : '/api/login', { method: 'POST', body: { username: data.get('username'), password: data.get('password') } });
        await initialize({ keepDraft: hasUnsavedEdits() });
      } catch (error) { event.target.querySelector('.auth-error').textContent = error.message; }
    });
  });
}

/**
 * Import flow. One picture per request keeps memory bounded and lets the panel
 * show per-file progress; the server compresses and registers each one.
 */
async function loadImportContext() {
  if (!state.importStyles.length) {
    try {
      const result = await api('/api/import/context');
      state.importStyles = result.styles || [];
      state.importReceipts = result.receipts || [];
    } catch (error) {
      state.importError = error.message;
    }
  } else {
    try {
      const result = await api('/api/import/context');
      state.importReceipts = result.receipts || [];
    } catch { /* The panel still works with what it already has. */ }
  }
  render();
}

function addImportFiles(files) {
  const accepted = [...files].filter(file => /^image\//.test(file.type) || /\.(png|jpe?g|webp)$/i.test(file.name));
  if (!accepted.length) { state.importError = '请选择 PNG、JPG 或 WebP 图片。'; render(); return; }
  const fallbackStyle = state.importStyles[0]?.id || '';
  for (const file of accepted) {
    state.importQueue.push({
      file,
      title: file.name.replace(/\.[^.]+$/, '').slice(0, 180),
      styleGroupId: fallbackStyle,
      subjectTags: '',
    });
  }
  state.importError = '';
  render();
}

async function runImport() {
  if (state.importBusy || !state.importQueue.length) return;
  if (!state.importStyles.length) { state.importError = '还没有读取到画风分组，请稍后重试。'; render(); return; }
  state.importBusy = true;
  state.importError = '';
  const queue = [...state.importQueue];
  const failures = [];
  let done = 0;
  for (const item of queue) {
    state.importProgress = done;
    render();
    try {
      const body = new FormData();
      body.set('image', item.file, item.file.name);
      body.set('title', item.title || item.file.name);
      body.set('styleGroupId', item.styleGroupId || '');
      body.set('subjectTags', item.subjectTags || '');
      body.set('origin', 'project-ai-generated');
      const receipt = await api('/api/assets/import', { method: 'POST', body });
      done += 1;
      state.importReceipts = [receipt, ...(state.importReceipts || [])];
      state.importQueue = state.importQueue.filter(entry => entry !== item);
    } catch (error) {
      failures.push(`${item.file.name}：${error.message}`);
      state.importQueue = state.importQueue.filter(entry => entry !== item);
    }
  }
  state.importBusy = false;
  state.importProgress = 0;
  if (failures.length) state.importError = failures.join('；');
  // The catalogue changed, so reload the workspace to pick up the new pictures.
  try { await reloadAfterImport(); } catch { /* render still shows the receipt */ }
  render();
  toast(done ? `已导入 ${done} 张图片。拖进相册后保存，再提交到双端。` : '没有图片导入成功。', !done);
}

async function reloadAfterImport() {
  const bootstrap = await api('/api/bootstrap');
  state.bootstrap = bootstrap;
  state.source = bootstrap.source;
  if (bootstrap.drafts?.length) state.draft = bootstrap.drafts.find(item => item.id === state.draft?.id) || state.draft;
}

function render() {
  if (state.dragGesture) clearDragFeedback();
  if (!state.session?.authenticated) { renderAuth(); return; }
  const unassigned = availableAssets().filter(asset => !albumFor(asset.id)).length;
  const tabs = [['albums', `相册与未分配 · ${unassigned}`], ['assets', `全部图片 · ${availableAssets().length}`], ['import', '导入图片'], ['task-rewards', '任务奖励'], ['growth', '成长与体力'], ['decorations', '装饰与收集']];
  app.innerHTML = `<div class="album-shell"><header class="topbar"><div class="workspace-brand"><span class="brand-mark">✳</span><strong>拼图管理</strong></div><span class="workspace-scope">PC 与小程序共用</span><div class="draft-control"><span id="save-state" class="dirty ${state.dirty ? '' : 'saved'}">${(state.page === 'task-rewards' || isGameSettingsPage()) ? state.dirty ? '相册有未保存编辑' : '相册已保存' : state.dirty ? '有未保存编辑' : '已保存'}</span><button class="primary" data-action="save" ${!state.dirty ? 'disabled' : ''}>${(state.page === 'task-rewards' || isGameSettingsPage()) ? '保存相册' : '保存'}</button><button data-action="release" class="release-entry">提交到双端</button><button data-action="more" class="quiet">更多 ···</button></div></header><main class="album-main"><nav class="workspace-tabs" aria-label="拼图管理导航">${tabs.map(([id, name]) => `<button data-action="page" data-page="${id}" class="${state.page === id ? 'active' : ''}" ${state.page === id ? 'aria-current="page"' : ''}>${name}</button>`).join('')}</nav><div class="main-content" id="page-content">${state.draft ? renderPage() : '<div class="empty">暂时没有可整理的内容，请重新载入。</div>'}</div></main>${state.historyOpen ? renderHistoryDrawer() : ''}</div>`;
}

function renderPage() {
  if (state.page === 'task-rewards') return renderTaskRewards({document:state.taskRewardDocument,dirty:state.taskRewardsDirty,conflict:state.taskRewardConflict,updatedAt:date(state.taskRewards?.updatedAt)});
  if (isGameSettingsPage()) return renderGameSettings({document:state.gameSettingDocument,dirty:state.gameSettingsDirty,conflict:state.gameSettingConflict,updatedAt:date(state.gameSettings?.updatedAt),section:state.page});
  const recovery = state.albumRecoveryEntry ? `<div class="notice album-recovery-note">本机保留了一份未保存的相册编辑（${date(state.albumRecoveryEntry.savedAt)}）。<button type="button" class="small" data-action="recover-album-edits">恢复相册编辑</button></div>` : '';
  if (state.page === 'import') return renderImport(state);
  if (state.page === 'assets' || state.page === 'unassigned' || state.page === 'trash') return recovery + renderAssets();
  return recovery + renderAlbums();
}

function renderHistoryDrawer() {
  const history = (state.bootstrap.drafts || []).filter(item => item.id !== state.draft.id);
  return `<div class="drawer-backdrop" data-action="close-history"></div><aside class="history-drawer" aria-label="历史与备份"><header class="drawer-head"><h2>历史与备份</h2><button data-action="close-history" class="quiet" aria-label="关闭历史与备份">×</button></header><div class="drawer-content"><details class="old-drafts"><summary>以前的整理副本 · ${history.length} 份</summary><p class="muted text-small">日常只使用当前工作内容。以前的副本在这里保留，方便追溯。</p>${history.map(item => `<div class="audit-row">${esc(item.name)}<span>${date(item.updatedAt)} · 只读保留</span></div>`).join('') || '<p class="muted">没有旧副本。</p>'}</details>${renderPublish()}</div></aside>`;
}

function heading(title, subtitle, actions = '') {
  return `<div class="page-heading"><div><div class="eyebrow">${esc(labelTarget(state.target))} · CONTENT WORKSPACE</div><h1>${title}</h1><p>${subtitle}</p></div>${actions ? `<div class="actions">${actions}</div>` : ''}</div>`;
}
function options(values, selected, placeholder = '全部') {
  return `<option value="">${esc(placeholder)}</option>${values.map(([value, name]) => `<option value="${attr(value)}" ${selected === value ? 'selected' : ''}>${esc(name)}</option>`).join('')}`;
}
function styleOptions(selected, placeholder = '待分类') { return options(styles().map(style => [style.id, style.name]), selected || '', placeholder); }
function originName(value) { return ({ 'project-ai-generated': '项目生成', 'user-provided': '用户提供' })[value] || value || '未记录'; }
function reviewName(value) { return ({ approved: '已审核', reviewed: '已审核', passed: '已审核', pending: '待审核', rejected: '未通过', unknown: '未记录' })[value] || value || '未记录'; }
function directionName(value) { return ({ landscape: '横图', portrait: '竖图', square: '方图', horizontal: '横图', vertical: '竖图' })[value] || value || '未记录'; }

function filteredAssets({ query = state.filters.query, picker = false } = {}) {
  const needle = query.trim().toLocaleLowerCase();
  return assets().filter(asset => {
    const meta = managed(asset.id);
    if (picker ? meta.deleted : Boolean(meta.deleted) !== (state.page === 'trash')) return false;
    if (needle && ![asset.id, meta.title, asset.title, meta.subtitle, ...(meta.subjectTags || [])].some(value => String(value || '').toLocaleLowerCase().includes(needle))) return false;
    if (picker) return true;
    if ((state.page === 'unassigned' || (state.page === 'albums' && !state.albumId)) && albumFor(asset.id)) return false;
    const filter = state.filters;
    if (filter.lifecycle && runtimeAvailable(asset) !== (filter.lifecycle === 'available')) return false;
    if (filter.style === '__none' && meta.styleGroupId) return false;
    if (filter.style && filter.style !== '__none' && meta.styleGroupId !== filter.style) return false;
    if (filter.tag && !(meta.subjectTags || []).includes(filter.tag)) return false;
    if (filter.origin && asset.origin !== filter.origin) return false;
    if (filter.direction && asset.direction !== filter.direction) return false;
    if (filter.review && asset.reviewStatus !== filter.review) return false;
    if (filter.daily && (filter.daily === 'any' ? dailyFor(asset.id).code === 'none' : dailyFor(asset.id).code !== filter.daily)) return false;
    return true;
  });
}

function assetCard(asset, { picker = false } = {}) {
  const meta = managed(asset.id), album = albumFor(asset.id), daily = dailyFor(asset.id);
  const selected = picker ? state.picker.selected.has(asset.id) : state.selected.has(asset.id);
  if (meta.deleted) return `<article class="asset-card ${selected ? 'selected' : ''}"><label class="asset-check"><input type="checkbox" aria-label="选择 ${attr(titleFor(asset.id))}" data-select="${attr(asset.id)}" ${selected ? 'checked' : ''}></label><button class="asset-thumb" data-action="asset-detail" data-id="${attr(asset.id)}" aria-label="查看 ${attr(titleFor(asset.id))}"><img loading="lazy" src="${imageUrl(asset.id)}" alt="${attr(titleFor(asset.id))}"></button><div class="asset-info"><strong>${esc(titleFor(asset.id))}</strong><div class="chips"><span class="chip archived">已删除 · 可恢复</span></div><button class="small space-top" data-action="restore-images" data-id="${attr(asset.id)}">恢复图片</button></div></article>`;
  return `<article ${picker ? '' : `draggable="false" data-drag-image="${attr(asset.id)}"`} class="asset-card ${selected ? 'selected' : ''}"><label class="asset-check"><input type="${picker && state.picker.mode === 'cover' ? 'radio' : 'checkbox'}" ${picker ? 'name="picker-item"' : ''} aria-label="选择 ${attr(titleFor(asset.id))}" data-${picker ? 'pick' : 'select'}="${attr(asset.id)}" ${selected ? 'checked' : ''}></label><button class="asset-thumb" draggable="false" data-action="${picker ? 'pick-image' : 'asset-detail'}" data-id="${attr(asset.id)}" aria-label="${picker ? '选择' : '查看'} ${attr(titleFor(asset.id))}"><img draggable="false" loading="lazy" src="${imageUrl(asset.id)}" alt="${attr(titleFor(asset.id))}"></button><div class="asset-info"><strong title="${attr(titleFor(asset.id))}">${esc(titleFor(asset.id))}</strong><div class="chips"><span class="chip">${esc(styleName(meta.styleGroupId))}</span><span class="chip ${album && albumShown(album) ? '' : 'hidden'}">${album ? `${esc(album.title)}${albumShown(album) ? '' : ' · 隐藏'}` : '未分配 · 仅后台'}</span>${integrationLabel(asset) ? `<span class="chip draft">${esc(integrationLabel(asset))}</span>` : ''}${daily.label ? `<span class="chip daily-${attr(daily.code)}" title="${attr(daily.detail)}">${esc(daily.label)}${daily.plan?.date && !automaticDailyPlan(daily.plan) ? ` · ${esc(daily.plan.date)}` : ''}</span>` : ''}${picker ? '' : (meta.subjectTags || []).slice(0, 2).map(tag => `<span class="chip">${esc(tag)}</span>`).join('')}</div></div></article>`;
}

function renderAssets({ embedded = false } = {}) {
  const filtered = filteredAssets();
  const tags = [...new Set(Object.values(doc().assets).flatMap(asset => asset.subjectTags || []))].sort();
  const origins = [...new Set(assets().map(asset => asset.origin).filter(Boolean))];
  const directions = [...new Set(assets().map(asset => asset.direction).filter(Boolean))];
  const reviews = [...new Set(assets().map(asset => asset.reviewStatus).filter(Boolean))];
  if (state.page === 'trash') return heading('图片回收站', '这里的图片已移出相册。原图与图片 ID 保留，已有拼图记录仍能读取。', '<button data-action="page" data-page="assets">返回全部图片</button>') + `<div class="notice">删除和恢复都需要先保存，再通过“提交到双端”更新正式游戏。恢复后可重新放入相册；已出场但尚未收录的每日图片会继续原来的收录安排。</div><div class="toolbar"><label class="check-field"><input type="checkbox" data-action="select-all" ${filtered.length && filtered.every(asset => state.selected.has(asset.id)) ? 'checked' : ''}> 选择回收站图片</label><span class="muted">${filtered.length} 幅</span></div>${renderBulkBar()}${filtered.length ? `<div class="asset-grid">${filtered.map(asset => assetCard(asset)).join('')}</div>` : '<div class="empty">回收站为空。</div>'}`;
  return (embedded ? '' : heading(state.page === 'unassigned' ? '未分配图片' : '全部图片', state.page === 'unassigned' ? '这里的图片只在后台保留。选择图片放进相册，再由相册控制显示与购买。' : '选择图片加入相册。画风与题材标签继续用于查找和整理。', `<button data-action="page" data-page="trash">回收站 · ${assets().length - availableAssets().length}</button><button data-action="styles">管理画风</button>`)) +
    `<div class="filters library-filters"><label>搜索图片<input data-filter="query" value="${attr(state.filters.query)}" placeholder="标题或题材关键词"></label><label>画风<select data-filter="style">${options([['__none', '待分类'], ...styles().map(style => [style.id, style.name])], state.filters.style, '全部画风')}</select></label><label>题材<select data-filter="tag">${options(tags.map(tag => [tag, tag]), state.filters.tag, '全部题材')}</select></label><label>方向<select data-filter="direction">${options(directions.map(value => [value, directionName(value)]), state.filters.direction)}</select></label></div><details class="library-advanced"><summary>更多筛选</summary><div class="filters compact-filters"><label>每日状态<select data-filter="daily">${options([['any','全部每日图片'],['automatic','待自动发布'],['scheduled','指定日期'],['today','今日每日'],['appeared','已出场 · 待收录'],['enrolled','已收录'],['awaiting','待游戏确认'],['library','曾从相册随机选中'],['legacy','原每日图片']], state.filters.daily)}</select></label><label>素材阶段<select data-filter="lifecycle">${options([['unavailable','尚未交付到双端'],['available','已交付到双端']], state.filters.lifecycle)}</select></label><label>来源<select data-filter="origin">${options(origins.map(value => [value, originName(value)]), state.filters.origin)}</select></label><label>审核<select data-filter="review">${options(reviews.map(value => [value, reviewName(value)]), state.filters.review)}</select></label></div></details>
    <div class="toolbar"><label class="check-field"><input type="checkbox" data-action="select-all" ${filtered.length && filtered.every(asset => state.selected.has(asset.id)) ? 'checked' : ''}> 选择筛选结果</label><span class="muted">显示 ${filtered.length} 幅 · ${state.selected.size} 幅已选</span></div>
    ${renderBulkBar()}
    ${filtered.length ? `<div class="asset-grid ${state.selected.size ? 'with-selection' : ''}">${filtered.map(asset => assetCard(asset)).join('')}</div>` : '<div class="empty">没有符合筛选条件的素材。<p>可以修改关键词或清空部分筛选。</p></div>'}`;
}

function renderBulkBar() {
  if (!state.selected.size) return '';
  if (state.page === 'trash') return `<section class="batchbar" aria-label="回收站图片管理"><strong>已选 ${state.selected.size} 幅</strong><button class="primary small" data-action="restore-images">恢复所选图片</button><button class="quiet small" data-action="clear-selection">取消选择</button></section>`;
  return `<section class="batchbar" aria-label="所选图片管理"><div class="batch-head"><strong>已选 ${state.selected.size} 幅</strong><span>${esc(labelTarget(state.target))}</span><button class="quiet small push-right" data-action="clear-selection">取消选择</button></div><div class="actions"><select id="assign-album" aria-label="选择相册">${options((targetDoc().albums || []).map(album => [album.id, album.title]), '', '选择相册')}</select><button class="primary small" data-action="assign-selected">放入相册</button><button class="small danger" data-action="unassign-selected">移出相册</button><button class="small danger" data-action="delete-images">删除所选图片</button></div><details class="batch-extra"><summary>批量设置画风与题材标签</summary><div class="batch-controls"><select id="batch-style" aria-label="批量画风">${styleOptions('')}</select><button class="small" data-action="batch-style">设置画风</button><input id="batch-tags" aria-label="批量题材标签" placeholder="题材标签，用逗号分隔"><button class="small" data-action="batch-tags">追加标签</button><button class="small" data-action="batch-replace-tags">替换标签</button></div></details><small>一张图片只属于一个共用相册。移出后只在后台保留。</small></section>`;
}

function albumCard(album) {
  const cover = album.coverImageId || album.imageIds[0];
  return `<article class="album-card ${albumShown(album) ? '' : 'is-hidden'}" data-drop-album="${attr(album.id)}" aria-label="拖入相册 ${attr(album.title)}"><button class="album-card-open" data-action="album-open" data-id="${attr(album.id)}" aria-label="打开相册 ${attr(album.title)}"><div class="album-cover">${cover ? `<img draggable="false" loading="lazy" src="${imageUrl(cover)}" alt="${attr(album.title)}">` : '<span>▧</span>'}<span class="album-count">${album.imageIds.length} 幅</span></div><div class="album-card-info"><h2>${esc(album.title)}</h2><div class="chips">${albumDisplayChips(album)}<span class="chip">${album.purchasable ? `${album.price} 金币` : '免费'}</span></div></div></button><div class="album-card-actions"><small class="drop-hint">拖到这里</small><button class="small" data-action="album-settings" data-id="${attr(album.id)}" aria-label="设置相册 ${attr(album.title)}">设置</button></div></article>`;
}

function renderAlbums() {
  const list = targetDoc().albums || [];
  const index = list.findIndex(album => album.id === state.albumId);
  if (index >= 0) return renderAlbumEditor(list[index], index);
  state.albumId = null;
  const unassigned = availableAssets().filter(asset => !albumFor(asset.id)).length;
  return heading('相册与未分配', '拖动图片到相册；多选后可整批拖入。点击相册查看内部图片，设置单独打开。') +
    `<div class="album-board"><aside class="album-destinations" aria-label="相册拖入区"><div class="section-heading"><h2>我的相册 · ${list.length}</h2><button class="primary small" data-action="new-album">新建相册</button></div>${list.length ? `<div class="album-grid">${list.map(albumCard).join('')}</div>` : '<div class="empty"><p>先新建一个相册，再把图片拖进来。</p></div>'}</aside><section class="unassigned-panel" aria-label="未分配图片"><div class="section-heading"><h2>未分配图片 · ${unassigned}</h2><span class="muted text-small">拖入相册后归入该册</span></div>${renderAssets({ embedded: true })}</section></div><p class="muted workspace-footnote">未分配的图片只在后台保留。整理后点击顶部“保存”；新图的游戏接入提示继续保留。</p>`;
}

function renderAlbumEditor(album, index) {
  const selected = album.imageIds.filter(id => state.selected.has(id));
  return `<div class="album-editor-heading"><button class="quiet" data-action="album-back">← 相册与未分配</button><div class="actions">${albumDisplayChips(album)}<span class="chip">${album.purchasable ? `${album.price} 金币购买包` : '免费相册'}</span><button data-action="album-settings" data-id="${attr(album.id)}">相册设置</button></div></div>` + heading(esc(album.title), `${album.imageIds.length} 幅图片 · ${esc(album.description || '点击图片查看大图与标签。')}`) +
    `<section class="album-members"><div class="section-heading"><h2>相册图片</h2><button class="primary small" data-action="pick" data-type="albums" data-index="${index}" data-mode="members">添加 / 选择图片</button></div>${album.imageIds.length ? `<div class="toolbar"><label class="check-field"><input type="checkbox" data-action="select-album-all" ${selected.length === album.imageIds.length ? 'checked' : ''}> 全选相册图片</label><div class="actions"><button class="small danger" data-action="delete-images" ${selected.length ? '' : 'disabled'}>删除所选</button><button class="small danger" data-action="remove-album-selected" data-index="${index}" ${selected.length ? '' : 'disabled'}>移出所选 · ${selected.length}</button></div></div><div class="asset-grid album-member-grid">${album.imageIds.map((id, order) => `<div class="album-member-tile">${assetCard(assetById(id))}<div class="member-order"><small>第 ${order + 1} 张</small><div class="actions"><button class="small" data-action="move-image" data-type="albums" data-index="${index}" data-order="${order}" data-delta="-1" ${order === 0 ? 'disabled' : ''} aria-label="上移 ${attr(titleFor(id))}">↑</button><button class="small" data-action="move-image" data-type="albums" data-index="${index}" data-order="${order}" data-delta="1" ${order === album.imageIds.length - 1 ? 'disabled' : ''} aria-label="下移 ${attr(titleFor(id))}">↓</button><button class="small danger" data-action="remove-image" data-type="albums" data-index="${index}" data-order="${order}">移出</button></div></div></div>`).join('')}</div>` : '<div class="empty">这个相册还没有图片。<p>返回主页拖入图片，或点击“添加 / 选择图片”。</p></div>'}<p class="muted text-small space-top">箭头调整顺序；移出后回到未分配。封面、显示与购买在“相册设置”中修改。</p></section>`;
}

function openAlbumSettings(id) {
  const album = targetDoc().albums.find(item => item.id === id);
  if (!album) return;
  state.settings = { id, target: state.target, album: ensureAlbumRewardIds(structuredClone(album)) };
  renderAlbumSettings();
}

function renderAlbumSettings() {
  if (!state.settings) return;
  const album = state.settings.album, cover = album.coverImageId || album.imageIds[0];
  const field = name => `data-settings-field="${name}"`;
  const rewards = renderAlbumRewards(album, state.gameSettingDocument?.decorations || state.bootstrap?.gameSettings?.document?.decorations || []);
  openModal('相册设置', `<form id="album-settings-form" class="album-settings-form"><div class="album-settings-cover">${cover ? `<img draggable="false" src="${imageUrl(cover)}" alt="${attr(titleFor(cover))}">` : '<span>尚未选择图片</span>'}<button type="button" class="small" data-action="settings-cover" ${album.imageIds.length ? '' : 'disabled'}>更换封面</button></div><div class="stack compact"><label class="field"><b>相册名称</b><input ${field('title')} value="${attr(album.title)}" maxlength="180" required></label><label class="field"><b>相册说明</b><textarea ${field('description')} maxlength="1500">${esc(album.description)}</textarea></label><label class="field"><b>画风</b><select ${field('styleGroupId')}>${styleOptions(album.styleGroupId)}</select></label><label class="setting-switch"><div><b>在 PC 显示</b><small>控制 PC 端的相册与图片展示。</small></div><input type="checkbox" ${field('showOnPc')} ${album.showOnPc ? 'checked' : ''}></label><label class="setting-switch"><div><b>在小程序显示</b><small>控制小程序端的相册与图片展示。</small></div><input type="checkbox" ${field('showOnMobile')} ${album.showOnMobile ? 'checked' : ''}></label><p class="muted text-small">没有可展示图片的相册会在玩家端自动隐藏。添加图片或每日图片到期收录后，按上方勾选自动显示；后台始终保留相册，方便继续整理。</p><label class="setting-switch"><div><b>设为购买包</b><small>开启后需要金币购买。</small></div><input type="checkbox" ${field('purchasable')} ${album.purchasable ? 'checked' : ''}></label>${album.purchasable ? `<label class="field"><b>购买价格 · 金币</b><input ${field('price')} type="number" min="1" max="100000000" step="1" value="${album.price}" required></label>` : ''}${rewards}<button type="button" class="quiet danger small" data-action="delete-album" data-id="${attr(album.id)}">移除相册</button></div><div class="modal-footer"><button type="button" data-action="close-modal">取消</button><button type="submit" class="primary">保存相册设置</button></div><p class="muted text-small settings-save-note">点击即保存到后台，同时保存本页已调整的图片归属与顺序。</p></form>`);
}

function updateSettingsField(element) {
  if (!state.settings) return;
  if (element.dataset.settingsField) {
    const field = element.dataset.settingsField;
    const value = element.type === 'checkbox' ? element.checked : element.type === 'number' ? Number(element.value) : element.value;
    state.settings.album[field] = ['styleGroupId', 'decorationId'].includes(field) ? value || null : value;
    if (field === 'purchasable') {
      state.settings.album.price = value ? Math.max(1, state.settings.album.price || 180) : 0;
      renderAlbumSettings();
    }
  } else if (element.dataset.settingsRow !== undefined) {
    const item = state.settings.album.milestones[Number(element.dataset.settingsRow)];
    if (item) item[element.dataset.settingsKey] = element.type === 'number' ? Number(element.value) : element.value || null;
  }
}

async function saveAlbumSettings() {
  const form = document.querySelector('#album-settings-form');
  if (!form || !form.reportValidity()) return;
  const settings = state.settings;
  const album = settings?.target === state.target && targetDoc().albums.find(item => item.id === settings.id);
  if (!album) { closeModal(); toast('相册已变化，请重新打开设置。', true); return; }
  for (const field of ['title','description','styleGroupId','coverImageId','showOnPc','showOnMobile','purchasable','price','decorationId','milestones']) album[field] = structuredClone(settings.album[field]);
  album.title = album.title.trim(); album.price = album.purchasable ? album.price : 0;
  dirty();
  await saveDraft({quiet:true});
  closeModal();
  render(); toast('相册设置与本页整理已保存。');
}

async function confirmMoving(ids, destination) {
  const existing = (targetDoc().albums || []).filter(album => album.id !== destination.id && album.imageIds.some(id => ids.includes(id)));
  if (!existing.length) return true;
  const count = existing.reduce((sum, album) => sum + album.imageIds.filter(id => ids.includes(id)).length, 0);
  return confirmAction(`${count} 幅图片目前在「${existing.map(album => album.title).join('、')}」中。将它们移动到「${destination.title}」？`);
}

function moveIntoAlbum(ids, destination) {
  const selected = new Set(ids.filter(id => !managed(id).deleted));
  ids = [...selected];
  for (const album of targetDoc().albums || []) {
    if (album.id === destination.id) continue;
    album.imageIds = album.imageIds.filter(id => !selected.has(id));
    if (!album.imageIds.includes(album.coverImageId)) album.coverImageId = album.imageIds[0] || null;
  }
  destination.imageIds = [...destination.imageIds, ...ids.filter(id => !destination.imageIds.includes(id))];
  if (!destination.imageIds.includes(destination.coverImageId)) destination.coverImageId = destination.imageIds[0] || null;
}

function removeAlbumImages(album, ids) {
  const remove = new Set(ids);
  album.imageIds = album.imageIds.filter(id => !remove.has(id));
  if (!album.imageIds.includes(album.coverImageId)) album.coverImageId = album.imageIds[0] || null;
}

async function deleteChosenImages(ids) {
  const lockedImageIds = () => (doc().dailyPlans || []).filter(plan => dailyFor(plan.imageId).locked).map(plan => plan.imageId);
  const plan = planImageDeletion(doc(), ids, {lockedImageIds: lockedImageIds()});
  if (!plan.ids.length) return;
  const details = [`将 ${plan.ids.length} 幅图片移到回收站？`];
  if (plan.albums.length) details.push(`会从以下相册移出：${plan.albums.map(album => `${album.title}（${album.count} 幅${album.purchasable ? '，购买包' : ''}）`).join('、')}。封面会自动替换。相册显示的完成数量会按剩余图片重新计算，已有拼图记录与已发奖励保留。`);
  if (plan.cancelledPlans.length) details.push(`同时取消 ${plan.cancelledPlans.length} 张图片尚未出场的每日首发安排。`);
  if (plan.retainedPlans.length) details.push(`其中 ${plan.retainedPlans.length} 张图片已有每日出场记录：历史安排保留，停止新的每日选取和自动收录；当日已经选中的图片会保留到当天结束。`);
  details.push('图片原件与稳定图片 ID 会保留，旧房间和玩家已有拼图记录不会删除。可以在“回收站”恢复。', '先保存，再点“提交到双端”后正式游戏才会采用这次删除。');
  if (!await confirmAction(details.join('\n\n'), {title: '删除图片', confirmLabel: '移到回收站'})) return;
  deleteImages(doc(), plan.ids, {lockedImageIds: lockedImageIds()});
  state.selected.clear(); closeModal(); dirty(); render();
  toast(`已将 ${plan.ids.length} 幅图片移到回收站，请保存。`);
}

function imageRow(id, order, type, index, count) {
  return `<div class="image-row"><img loading="lazy" src="${imageUrl(id)}" alt="${attr(titleFor(id))}"><div><strong>${order + 1}. ${esc(titleFor(id))}</strong><small>${esc(id)}</small></div><div class="actions"><button class="small" data-action="move-image" data-type="${type}" data-index="${index}" data-order="${order}" data-delta="-1" ${order === 0 ? 'disabled' : ''} aria-label="上移图片">↑</button><button class="small" data-action="move-image" data-type="${type}" data-index="${index}" data-order="${order}" data-delta="1" ${order === count - 1 ? 'disabled' : ''} aria-label="下移图片">↓</button><button class="small danger" data-action="remove-image" data-type="${type}" data-index="${index}" data-order="${order}">移除</button></div></div>`;
}

function renderPublish() {
  const analysis = state.analysis;
  const inspected = Boolean(analysis);
  const candidateAllowed = inspected && (analysis.compatibleTargets || []).includes(state.exportTarget);
  return heading('检查与备份', '日常只需保存当前相册；这里保留历史备份与游戏更新检查。', '<button data-action="reimport">同步原项目最新内容</button><button class="primary" data-action="analyze">保存并查看改动</button>') +
    `<ol class="workflow-guide"><li><b>1 · 整理并保存</b><span>图片和相册的修改保存在后台，可继续编辑。</span></li><li><b>2 · 查看改动与检查结果</b><span>确认改了什么，检查已有购买、图鉴进度和图片引用。</span></li><li><b>3 · 保存版本备份</b><span>留住这一轮完整整理结果，以后可恢复为当前工作内容。</span></li></ol><div class="notice">工作内容和版本备份保存在本机。日常更新游戏请使用顶部“提交到双端”，检查已保存内容后确认提交。</div><div class="publish-layout"><div class="stack"><section class="panel"><div class="section-heading"><h2>修改预览与检查结果</h2><small>保存次数 ${state.draft.revision}</small></div>${analysis ? renderAnalysis(analysis) : '<div class="empty">点击上方“保存并查看改动”。<p>这里会列出与原项目导入内容的差别，以及更新前需要解决的问题。</p></div>'}</section><section class="panel"><h2>版本备份与更新文件</h2><p class="muted text-small">恢复后成为当前工作内容，现有内容保留在历史记录。恢复备份后仍需使用顶部“提交到双端”，才会改变正式游戏内容。</p>${renderVersions()}</section></div><div class="stack"><section class="panel"><h2>保存这一轮整理</h2><form id="publish-form"><label class="field space-bottom"><b>版本名称</b><input name="label" required maxlength="100" placeholder="例如：纸艺分组整理 · 第一轮"></label><label class="field space-bottom"><b>本次整理说明</b><textarea name="reason" required minlength="4" maxlength="500" placeholder="例如：整理纸艺相册，隐藏暂不展示的相册"></textarea></label><label class="field space-bottom"><b>再次验证管理员密码</b><input name="password" type="password" maxlength="128" required autocomplete="current-password"></label><button type="submit" name="kind" value="snapshot" class="primary" ${inspected ? '' : 'disabled'}>保存版本备份</button><p class="muted text-small publish-note">${!inspected ? '先查看改动，再保存这一轮备份。' : '备份包含完整共用相册内容；有待解决的问题也可以先备份。'}</p><details class="update-options"><summary>旧版导出（兼容保留）</summary><label class="field space-bottom"><b>准备更新的应用</b><select id="export-target">${options(Object.entries(TARGETS), state.exportTarget, '选择应用')}</select></label><p class="muted text-small">交付应用：${esc(labelTarget(state.exportTarget))}。通过检查后生成供原游戏发布流程使用的文件，应用后才会对玩家生效。</p><button type="submit" name="kind" value="candidate" ${candidateAllowed ? '' : 'disabled'}>准备${state.exportTarget==='pc'?' PC 网页':'小游戏'}更新文件</button><p class="muted text-small publish-note">${!inspected ? '先保存并查看改动。' : !candidateAllowed ? '当前目标还有需要解决的问题；可先保存版本备份继续整理。' : '会再次校验图片审核与交付文件，并完整保留本目标的修改。'}</p></details></form></section><section class="panel"><h2>操作记录</h2>${renderAudit()}</section></div></div>`;
}

function renderAnalysis(analysis) {
  const blockers = analysis.blockers || [], warnings = analysis.warnings || [], changes = analysis.changes || [];
  return `${blockers.length ? `<div class="notice error"><strong>${blockers.length} 项更新前需要解决的问题</strong><ul class="analysis-list">${blockers.map(item => `<li><strong>${esc(labelTarget(item.target))} · ${esc(item.id || item.code)}</strong><br>${esc(item.message)}</li>`).join('')}</ul></div>` : '<div class="notice">当前检查未发现影响历史内容的问题。准备更新文件时还会校验原件、审核和交付文件。</div>'}
    ${warnings.length ? `<div class="notice warning"><strong>需要留意</strong><ul class="analysis-list">${warnings.map(item => `<li>${esc(labelTarget(item.target))} · ${esc(item.message)}</li>`).join('')}</ul></div>` : ''}
    <p class="muted text-small">可生成游戏更新文件：${(analysis.compatibleTargets || []).map(labelTarget).join('、') || '暂无'} · ${changes.length} 项改动</p>
    ${changes.length ? `<div class="table-wrap"><table><thead><tr><th>目标 / 内容</th><th>修改项</th><th>原项目导入内容</th><th>当前工作内容</th></tr></thead><tbody>${changes.map(change => `<tr><td>${esc(labelTarget(change.target))}<br><small>${esc(ENTITY_NAMES[change.entityType] || change.entityType)} · ${esc(change.id)}</small></td><td>${esc(FIELD_NAMES[change.field] || change.field)}</td><td class="diff-value">${esc(textValue(change.before))}</td><td class="diff-value">${esc(textValue(change.after))}</td></tr>`).join('')}</tbody></table></div>` : '<p class="muted">当前工作内容与原项目导入内容一致。</p>'}`;
}

function renderVersions() {
  const versions = state.bootstrap?.versions || [];
  return versions.length ? versions.map(version => `<article class="version-row"><div class="version-top"><div><strong>${esc(version.label || version.id)}</strong><small>${date(version.createdAt)} · ${version.kind === 'snapshot' ? '完整备份' : `${esc(labelTarget(version.target))}更新文件`}</small></div><span class="chip">${version.kind==='snapshot'?'可恢复':'待应用'}</span></div><p>${esc(version.reason || '本轮内容整理')}</p><div class="actions"><button class="small" data-action="version" data-id="${attr(version.id)}">查看版本</button><a class="download-link" href="/api/versions/${encodeURIComponent(version.id)}/download" download>${version.kind==='snapshot'?'下载备份':'下载更新文件'}</a><button class="small" data-action="restore" data-id="${attr(version.id)}">恢复此备份</button></div></article>`).join('') : '<p class="muted">尚无版本备份。日常修改先点击“保存”，完成一轮整理后再留一份备份。</p>';
}

function renderAudit() {
  const rows = state.bootstrap?.audit || [];
  return rows.length ? rows.slice(0, 20).map(row => {
    const action = row.action || row.event || row.type || '操作';
    const label = row.label || state.bootstrap.drafts.find(draft => draft.id === row.target)?.name || state.bootstrap.versions.find(version => version.id === row.target)?.label || '';
    return `<div class="audit-row">${esc(AUDIT_NAMES[action] || action)}${label ? ` · ${esc(label)}` : ''}<span>${date(row.createdAt || row.timestamp || row.at)} · ${esc(row.username || row.actor?.username || (row.actor === 'system' ? '系统' : row.actor) || '')}</span>${row.reason ? `<span>${esc(row.reason)}</span>` : ''}</div>`;
  }).join('') : '<p class="muted">保存、准备更新文件与版本恢复会记录到这里。</p>';
}

function openModal(title, content) {
  modal.classList.toggle('album-settings-dialog', title === '相册设置');
  modal.innerHTML = `<header class="modal-head"><h2 id="modal-title">${esc(title)}</h2><button data-action="close-modal" class="quiet" aria-label="关闭弹窗">×</button></header><div class="modal-body">${content}</div>`;
  if (!modal.open) modal.showModal();
}
function closeModal({ returnToSettings = true } = {}) {
  finishConfirmation(false);
  if (returnToSettings && state.session?.authenticated && state.picker?.fromSettings && state.settings) {
    state.picker = null; renderAlbumSettings(); return;
  }
  if (modal.open) modal.close();
  state.picker = null; state.settings = null;
}

function confirmAction(message, {title = '确认操作', confirmLabel = '确认操作'} = {}) {
  finishConfirmation(false);
  return new Promise(resolve => {
    resolveConfirmation = resolve;
    confirmation.innerHTML = `<header class="modal-head"><h2 id="confirmation-title">${esc(title)}</h2></header><div class="modal-body"><p style="white-space:pre-line">${esc(message)}</p><div class="modal-footer"><button data-confirm="cancel" autofocus>取消</button><button class="primary" data-confirm="continue">${esc(confirmLabel)}</button></div></div>`;
    confirmation.showModal();
  });
}

function finishConfirmation(confirmed) {
  const resolve = resolveConfirmation;
  resolveConfirmation = null;
  if (confirmation.open) confirmation.close();
  if (resolve) resolve(confirmed);
}

confirmation.addEventListener('click', event => {
  const button = event.target.closest('[data-confirm]');
  if (button) finishConfirmation(button.dataset.confirm === 'continue');
});
confirmation.addEventListener('cancel', event => { event.preventDefault(); finishConfirmation(false); });
confirmation.addEventListener('close', () => { if (!confirmation.open && resolveConfirmation) finishConfirmation(false); });

function renderDailySettings(id) {
  const daily = dailyFor(id), plan = daily.plan, current = albumFor(id);
  const best = current && albumShown(current) ? current : doc().albums.find(album => albumShown(album) && !album.purchasable && album.styleGroupId === managed(id).styleGroupId);
  const selected = plan?.albumId || best?.id || '';
  const readiness = dailyReadiness(id);
  const automatic = plan ? automaticDailyPlan(plan) : true;
  const plannedDate = automatic ? '' : plan?.date || nextOpenDailyDate(doc().dailyPlans || [], {excludeId:id});
  return `<details class="section daily-settings" data-daily-locked="${daily.locked}" ${plan || targetAsset(id).dailyOnly || daily.enrollment ? 'open' : ''}><summary>每日首发${daily.label ? ` · ${esc(daily.label.replace(/^每日 · /,''))}` : ''}</summary><p class="muted text-small">指定日期的首发优先。当天没有指定图片时，随机发布一张尚未出场的自动图片；全部发布后，从所有相册随机选图。通过每日入口创建，无需解锁购买包。</p><label class="check-field"><input type="checkbox" name="dailyEnabled" ${plan ? 'checked' : ''} ${daily.locked ? 'disabled' : ''}> 安排每日首发并自动收录</label><label class="check-field daily-auto-switch"><input type="checkbox" name="dailyAutoPublish" ${automatic ? 'checked' : ''} ${!plan || daily.locked ? 'disabled' : ''}> 自动发布</label><p class="muted text-small daily-mode-hint">${automatic ? '不占日期，等待每日随机选中。' : '手动指定日期；自动发布图片不会占用这些日期。'}</p><div class="daily-fields ${automatic ? 'automatic' : ''}"><label class="field daily-manual-date" ${automatic ? 'hidden' : ''}><b>每日首发日期</b><input type="date" name="dailyDate" aria-label="每日首发日期" value="${attr(plannedDate)}" min="${attr(plan?.date && plan.date < tomorrowDate() ? plan.date : tomorrowDate())}" ${!plan || daily.locked || automatic ? 'disabled' : ''} required><small>从明天起选择日期，每天最多一张指定首发。</small></label><label class="field"><b>收录相册</b><select name="dailyAlbumId" aria-label="收录相册" ${!plan || daily.locked ? 'disabled' : ''} required>${options(doc().albums.map(album => [album.id,`${album.title}${!albumShown(album) ? ' · 两端隐藏' : ''}${album.purchasable ? ' · 购买包' : ''}`]),selected,'选择相册')}</select><small>首发实际出场后，次日北京时间 00:00 自动放入这里。</small></label></div><p class="daily-fact">${esc(daily.detail || '勾选后可预选收录相册。')}</p>${readiness && !readiness.ready ? `<p class="muted text-small">${esc(readiness.reason || '素材待接入游戏，安排先保存在后台。')}</p>` : ''}${daily.locked ? '<p class="muted text-small">已出场记录已锁定。收录后仍可在相册中移动图片。</p>' : '<p class="muted text-small">应用修改后点击顶部“保存”，再通过“提交到双端”让正式游戏采用这份安排。</p>'}</details>`;
}

function updateDailyControls(form) {
  const section = form.querySelector('.daily-settings');
  if (!section || section.dataset.dailyLocked === 'true') return;
  const enabled = form.elements.dailyEnabled.checked, automatic = form.elements.dailyAutoPublish.checked;
  form.elements.dailyAutoPublish.disabled = !enabled;
  form.elements.dailyAlbumId.disabled = !enabled;
  form.elements.dailyDate.disabled = !enabled || automatic;
  const plan = dailyFor(form.dataset.id).plan;
  if (automatic) form.elements.dailyDate.value = '';
  else if (!form.elements.dailyDate.value) form.elements.dailyDate.value = !automaticDailyPlan(plan) && plan?.date || nextOpenDailyDate(doc().dailyPlans || [], {excludeId:form.dataset.id});
  section.querySelector('.daily-manual-date').hidden = automatic;
  section.querySelector('.daily-fields').classList.toggle('automatic', automatic);
  section.querySelector('.daily-mode-hint').textContent = automatic ? '不占日期，等待每日随机选中。' : '手动指定日期；自动发布图片不会占用这些日期。';
}

function openAsset(id) {
  const asset = assetById(id), meta = managed(id), album = albumFor(id);
  if (!asset) return;
  if (meta.deleted) { openModal('已删除的图片', `<img class="detail-preview" src="${imageUrl(id, 'preview')}" alt="${attr(titleFor(id))}"><h3 class="space-top">${esc(titleFor(id))}</h3><p class="muted">原图、稳定图片 ID 和历史记录已保留。恢复后可重新分配相册。</p><div class="modal-footer"><button data-action="close-modal">关闭</button><button class="primary" data-action="restore-images" data-id="${attr(id)}">恢复图片</button></div>`); return; }
  const body = `<form id="asset-form" data-id="${attr(id)}"><div class="asset-detail"><div><img class="detail-preview" src="${imageUrl(id, 'preview')}" alt="${attr(titleFor(id))}"><dl class="detail-facts"><dt>所在共用相册</dt><dd>${album ? `${esc(album.title)} · ${albumDisplayLabel(album)}${album.purchasable ? ' · 购买包' : ''}` : '未分配 · 只在后台保留'}</dd><dt>保存尺寸 / 方向</dt><dd>${esc(asset.width || '?')} × ${esc(asset.height || '?')} · ${esc(directionName(asset.direction))}</dd>${asset.lifecycle === 'pending' ? `<dt>原始生成尺寸</dt><dd>${esc(asset.nativeResolution?.width)} × ${esc(asset.nativeResolution?.height)}${asset.resolutionNote ? `<p class="muted">${esc(asset.resolutionNote)}</p>` : ''}</dd><dt>素材阶段</dt><dd>${runtimeAvailable(asset) ? '已交付到双端，保存相册并提交后可展示' : '待接入游戏，可先放进相册整理'}</dd>` : ''}</dl></div><div class="stack compact"><label class="field"><b>图片标题</b><input name="title" value="${attr(meta.title || asset.title)}" required maxlength="180"></label><label class="field"><b>副标题</b><input name="subtitle" value="${attr(meta.subtitle || '')}" maxlength="500"></label><label class="field"><b>画风</b><select name="styleGroupId">${styleOptions(meta.styleGroupId)}</select></label><label class="field"><b>题材标签</b><input name="subjectTags" value="${attr((meta.subjectTags || []).join('，'))}" placeholder="例如：山海、城市、花卉"><small>用中文或英文逗号分隔。</small></label><p class="muted text-small">图片是否显示、是否收费，统一在所属相册中设置。</p></div></div><details class="section"><summary>来源、授权与审核记录（只读）</summary><dl class="detail-facts"><dt>稳定图片 ID</dt><dd>${esc(id)}</dd><dt>来源 / 审核</dt><dd>${esc(originName(asset.origin))} · ${esc(reviewName(asset.reviewStatus))}</dd><dt>来源说明</dt><dd>${esc(asset.sourceDescription || '未记录')}</dd><dt>授权说明</dt><dd>${esc(asset.rightsStatement || '未记录')}</dd></dl><pre class="pre">${esc(JSON.stringify({ review: asset.review, delivery: asset.delivery }, null, 2))}</pre></details><div class="modal-footer"><button type="button" class="danger push-right" data-action="delete-images" data-id="${attr(id)}">删除图片</button><button type="button" data-action="close-modal">取消</button><button type="submit" class="primary">应用修改</button></div></form>`;
  const preview=asset.previewArtwork;
  const displayBody=preview?body.replace('<dt>保存尺寸 / 方向</dt>',`<dt>当前游戏图片尺寸</dt><dd>${esc(preview.width)} × ${esc(preview.height)} · ${esc(directionName(preview.direction))}<p class="muted">已升级 · WebP Q${esc(preview.quality)} · ${esc(Math.round(preview.bytes/1024))} KB。当前预览使用升级图，原素材和历史房间图片保留。</p></dd><dt>管理原素材尺寸 / 方向</dt>`):body;
  openModal('素材详情', displayBody.replace('<details class="section">', `${renderDailySettings(id)}<details class="section">`));
}

function openStyles() {
  const countUsage = id => Object.values(doc().assets).filter(asset => asset.styleGroupId === id).length + doc().albums.filter(entity => entity.styleGroupId === id).length;
  openModal('画风分组', `<p class="muted">画风作为主分组，题材作为标签。修改后点击主界面的“保存”。</p>${styles().map((style, index) => `<div class="style-row"><input aria-label="画风名称" ${bindAttr(['styles', index, 'name'])} value="${attr(style.name)}" maxlength="60"><small>${countUsage(style.id)} 处引用</small><button class="small danger" data-action="delete-style" data-id="${attr(style.id)}" ${countUsage(style.id) ? 'disabled title="需先取消所有引用"' : ''}>删除</button></div>`).join('')}<form id="style-form" class="style-add"><input name="name" required maxlength="60" placeholder="新增画风，例如：纸艺"><button class="primary" type="submit">新增画风</button></form><div class="modal-footer"><button data-action="finish-styles">完成</button></div>`);
}

function openPicker(type, index, mode, fromSettings = false) {
  const entity = fromSettings ? state.settings.album : targetDoc()[type][index];
  state.picker = { type, index, mode, fromSettings, query: '', style: '', selected: new Set(mode === 'cover' ? (entity.coverImageId ? [entity.coverImageId] : []) : entity.imageIds) };
  renderPicker();
}

function renderPicker() {
  const picker = state.picker;
  const entity = picker.fromSettings ? state.settings.album : targetDoc()[picker.type][picker.index];
  const candidates = filteredAssets({ query: picker.query, picker: true }).filter(asset => (picker.mode !== 'cover' || entity.imageIds.includes(asset.id)) && (!picker.style || managed(asset.id).styleGroupId === picker.style));
  openModal(picker.mode === 'cover' ? '选择相册封面' : `为「${entity.title}」选择图片`, `<div class="picker-filters"><label class="field"><b>搜索图片</b><input id="picker-search" placeholder="标题或题材标签" value="${attr(picker.query)}"></label><label class="field"><b>画风</b><select id="picker-style">${styleOptions(picker.style, '全部画风')}</select></label></div><div class="toolbar picker-toolbar"><span class="picker-count">${candidates.length} 幅可选 · ${picker.selected.size} 幅已选</span><small>${picker.mode === 'cover' ? '封面从相册成员中选择。' : '每张图片只属于一个相册，已归属的图片将移动到这里。'}</small></div>${picker.mode === 'members' ? `<label class="check-field"><input type="checkbox" id="picker-select-all" ${candidates.length && candidates.every(asset => picker.selected.has(asset.id)) ? 'checked' : ''}> 选择当前筛选结果</label>` : ''}<div class="asset-grid picker-grid">${candidates.map(asset => assetCard(asset, { picker: true })).join('') || '<p class="muted">没有符合搜索条件的图片。</p>'}</div><div class="modal-footer"><button data-action="close-modal">取消</button><button class="primary" data-action="picker-apply" ${picker.mode === 'cover' && !picker.selected.size ? 'disabled' : ''}>应用选择</button></div>`);
}

function togglePick(id, checked) {
  const picker = state.picker;
  if (!picker) return;
  if (picker.mode === 'cover') { picker.selected.clear(); picker.selected.add(id); }
  else if (checked ?? !picker.selected.has(id)) picker.selected.add(id);
  else picker.selected.delete(id);
  const scrollTop = modal.querySelector('.picker-grid')?.scrollTop || 0;
  renderPicker();
  modal.querySelector('.picker-grid').scrollTop = scrollTop;
}

function openRestore(id) {
  const version = state.bootstrap.versions.find(item => item.id === id);
  openModal('恢复此备份', `<form id="restore-form" data-id="${attr(id)}" class="stack compact"><p class="muted">恢复「${esc(version?.label || id)}」后，它会成为当前工作内容。现有内容保留在历史记录。</p><label class="field"><b>工作内容名称</b><input name="name" required maxlength="100" value="${attr(`恢复 · ${version?.label || id}`)}"></label><label class="field"><b>操作原因</b><textarea name="reason" required minlength="4" maxlength="500"></textarea></label><label class="field"><b>再次验证密码</b><input name="password" type="password" maxlength="128" required autocomplete="current-password"></label><div class="modal-footer"><button type="button" data-action="close-modal">取消</button><button type="submit" class="primary">恢复此备份</button></div></form>`);
}

function openReimport() {
  openModal('同步原项目内容', `<form id="reimport-form" class="stack compact"><div class="notice">先保存当前工作内容，再读取原项目最新内容。合并相册整理与来源的独立改动；遇到冲突会拒绝覆盖并保留编辑。</div><label class="field"><b>操作原因</b><textarea name="reason" required minlength="4" maxlength="500" placeholder="例如：同步原项目新增的已审核图片"></textarea></label><label class="field"><b>再次验证密码</b><input name="password" type="password" maxlength="128" required autocomplete="current-password"></label><div class="modal-footer"><button type="button" data-action="close-modal">取消</button><button type="submit" class="primary">保存并导入最新来源</button></div></form>`);
}

function showVersion() {
  const { version } = state.version;
  const files = [...(state.version.files || [])];
  if (version.kind === 'snapshot' && state.version.document) files.unshift({ path: '完整备份内容', content: state.version.document });
  const file = files[state.fileIndex];
  openModal(version.label || version.id, `<dl class="detail-facts"><dt>保存时间</dt><dd>${date(version.createdAt)}</dd><dt>本次整理说明</dt><dd>${esc(version.reason || "未填写")}</dd><dt>版本用途</dt><dd>${version.kind === "snapshot" ? "完整共用相册备份，恢复后成为当前工作内容。" : `${esc(labelTarget(version.target))}更新文件，等待原游戏发布流程应用。`}</dd></dl><details class="version-advanced" ${state.versionAdvancedOpen ? "open" : ""}><summary>高级：查看备份内容、更新文件与详细记录</summary><details><summary>版本详细记录</summary><pre class="pre">${esc(JSON.stringify(version, null, 2))}</pre></details><div class="file-tabs">${files.map((item, index) => `<button class="${state.fileIndex === index ? "active" : ""}" data-action="file" data-index="${index}">${esc(item.path)}</button>`).join("")}</div>${file ? `<pre class="pre file-content">${esc(typeof file.content === "string" ? file.content : JSON.stringify(file.content, null, 2))}</pre>` : "<p class=muted>此版本没有目标更新文件。</p>"}</details><div class="modal-footer"><a href="/api/versions/${encodeURIComponent(version.id)}/download" download>${version.kind === "snapshot" ? "下载备份" : "下载更新文件"}</a><button data-action="close-modal">关闭</button></div>`);
}

function parseTags(value) { return [...new Set(String(value).split(/[,，、\n]/).map(tag => tag.trim()).filter(Boolean))]; }
function setBound(element) {
  const path = JSON.parse(element.dataset.bind);
  let object = doc();
  for (const key of path.slice(0, -1)) object = object[key];
  let value = element.type === 'checkbox' ? element.checked : element.value;
  if (element.dataset.number) {
    value = element.value === '' ? null : Number(element.value);
    if (value !== null && (!Number.isSafeInteger(value) || value < 0)) return;
  } else if (element.dataset.null && value === '') value = null;
  object[path.at(-1)] = value;
  dirty();
}

async function refreshRecords() {
  const results = await Promise.all([api('/api/versions'), api('/api/audit')]);
  state.bootstrap.versions = Array.isArray(results[0]) ? results[0] : results[0].versions || [];
  state.bootstrap.audit = Array.isArray(results[1]) ? results[1] : results[1].audit || [];
}

function clearDragFeedback() {
  const gesture = state.dragGesture;
  if (gesture?.card.hasPointerCapture?.(gesture.pointerId)) gesture.card.releasePointerCapture(gesture.pointerId);
  state.dragGesture = null;
  document.body.classList.remove('is-dragging-images');
  document.querySelectorAll('.drop-active, .drag-source').forEach(card => card.classList.remove('drop-active', 'drag-source'));
  document.querySelector('#drag-indicator')?.remove(); document.querySelector('#drag-ghost')?.remove();
}

async function applyDraggedImages(payload, target, albumId) {
  if (state.target !== target || state.busy || modal.open || confirmation.open) return;
  const ids = parseDragPayload(payload, { target, knownIds: availableAssets().map(asset => asset.id) });
  const destination = targetDoc().albums.find(album => album.id === albumId);
  if (!ids.length || !destination || !await confirmMoving(ids, destination)) return;
  if (state.target !== target || !targetDoc().albums.includes(destination)) return;
  moveIntoAlbum(ids, destination); state.selected.clear(); dirty(); render();
  toast(`已将 ${ids.length} 张图片放入「${destination.title}」，请保存。`);
}

document.addEventListener('pointerdown', event => {
  const card = event.target.closest('[data-drag-image]');
  if (!card || event.button !== 0 || !event.isPrimary || event.target.closest('input, select, textarea, .asset-check') || state.busy || modal.open || confirmation.open) return;
  const payload = createDragPayload({ imageId: card.dataset.dragImage, selectedIds: state.selected, knownIds: availableAssets().map(asset => asset.id), target: state.target });
  if (!payload) return;
  state.dragGesture = { card, payload, target: state.target, pointerId: event.pointerId, x: event.clientX, y: event.clientY, active: false };
});

document.addEventListener('pointermove', event => {
  const gesture = state.dragGesture;
  if (!gesture || gesture.pointerId !== event.pointerId) return;
  if (!gesture.active && Math.hypot(event.clientX - gesture.x, event.clientY - gesture.y) < 7) return;
  event.preventDefault();
  if (!gesture.active) {
    gesture.active = true; gesture.card.setPointerCapture?.(event.pointerId);
    const ids = parseDragPayload(gesture.payload, { target: gesture.target, knownIds: availableAssets().map(asset => asset.id) });
    document.body.classList.add('is-dragging-images'); gesture.card.classList.add('drag-source');
    const indicator = document.createElement('div'); indicator.id = 'drag-indicator'; indicator.textContent = `将 ${ids.length} 张图片拖到相册`; document.body.append(indicator);
    const ghost = document.createElement('div'); ghost.id = 'drag-ghost';
    ghost.innerHTML = `<img draggable="false" src="${imageUrl(gesture.card.dataset.dragImage)}" alt=""><span>${ids.length} 张图片</span>`; document.body.append(ghost);
  }
  const ghost = document.querySelector('#drag-ghost');
  ghost.style.left = `${event.clientX + 14}px`; ghost.style.top = `${event.clientY + 14}px`;
  const destination = document.elementFromPoint(event.clientX, event.clientY)?.closest('[data-drop-album]');
  document.querySelectorAll('.drop-active').forEach(card => { if (card !== destination) card.classList.remove('drop-active'); });
  destination?.classList.add('drop-active');
}, { passive: false });

document.addEventListener('pointerup', async event => {
  const gesture = state.dragGesture;
  if (!gesture || gesture.pointerId !== event.pointerId) return;
  const destination = gesture.active && document.elementFromPoint(event.clientX, event.clientY)?.closest('[data-drop-album]');
  clearDragFeedback();
  if (!gesture.active) return;
  event.preventDefault(); state.suppressClickUntil = Date.now() + 350; state.suppressClickPoint = { x: event.clientX, y: event.clientY };
  if (destination) await applyDraggedImages(gesture.payload, gesture.target, destination.dataset.dropAlbum);
});

document.addEventListener('pointercancel', () => clearDragFeedback());
document.addEventListener('dragstart', event => { if (event.target.closest('[data-drag-image]')) event.preventDefault(); });
document.addEventListener('click', event => {
  const point = state.suppressClickPoint;
  if (Date.now() < state.suppressClickUntil && point && Math.hypot(event.clientX - point.x, event.clientY - point.y) < 4) { event.preventDefault(); event.stopImmediatePropagation(); }
  state.suppressClickUntil = 0; state.suppressClickPoint = null;
}, true);
window.addEventListener('blur', () => clearDragFeedback());

document.addEventListener('click', async event => {
  const button = event.target.closest('[data-action]');
  if (!button || button.disabled || button.tagName === 'SELECT' || button.tagName === 'INPUT') return;
  const action = button.dataset.action;
  if (action === 'release') { await releasePanel.open(); }
  else if (action === 'retry') { location.reload(); }
  else if (action === 'page') { if (button.dataset.page === 'trash' || state.page === 'trash') state.filters = Object.fromEntries(Object.keys(state.filters).map(key => [key, ''])); state.page = button.dataset.page; state.selected.clear(); state.albumId = null; if (state.page === 'import') void loadImportContext(); render(); }
  else if (action === 'import-remove') { state.importQueue.splice(Number(button.dataset.row), 1); render(); }
  else if (action === 'import-clear') { state.importQueue = []; state.importError = ''; render(); }
  else if (action === 'import-run') void runImport();
  else if (action === 'save') busy(async () => { await saveDraft(); render(); });
  else if (action === 'recover-album-edits') {
    const entry = state.albumRecoveryEntry;
    if (!entry || entry.revision !== state.draft.revision) { toast('相册已更新，请重新载入后核对恢复记录。', true); return; }
    state.draft.document = structuredClone(entry.document); state.albumRecoveryEntry = null;
    dirty(); render(); toast('相册编辑已恢复，请保存。成长与体力设置未改变。');
  }
  else if (action === 'reload-task-rewards') busy(async () => {
    if (state.taskRewardsDirty && !await confirmAction('重新载入会替换本窗口未保存的任务奖励修改，确定继续？')) return;
    setTaskRewards(await api('/api/task-rewards')); render();
  });
  else if (action === 'reload-game-settings') busy(async () => {
    if (state.gameSettingsDirty && !await confirmAction('重新载入会替换未保存的成长、体力、装饰和收集设置，确定继续？')) return;
    setGameSettings(await api('/api/game-settings')); render();
  });
  else if (action === 'add-game-milestone') { addGameMilestone(state.gameSettingDocument); markGameSettingsDirty(); render(); }
  else if (action === 'remove-game-milestone') { removeGameMilestone(state.gameSettingDocument, Number(button.dataset.index)); markGameSettingsDirty(); render(); }
  else if (action === 'more') openModal('更多', '<div class="more-menu"><button data-action="open-trash">图片回收站 <span>恢复已删除的图片</span></button><button data-action="open-history">历史与备份 <span>以前的副本、检查记录和更新文件</span></button><button data-action="styles">管理画风 <span>编辑图片与相册的画风分组</span></button><button data-action="logout">退出账号</button></div>');
  else if (action === 'open-trash') { closeModal(); state.page = 'trash'; state.filters = Object.fromEntries(Object.keys(state.filters).map(key => [key, ''])); state.selected.clear(); state.albumId = null; render(); }
  else if (action === 'delete-images') { await deleteChosenImages(button.dataset.id ? [button.dataset.id] : [...state.selected]); }
  else if (action === 'restore-images') { const restored = restoreImages(doc(), button.dataset.id ? [button.dataset.id] : [...state.selected]); state.selected.clear(); closeModal(); dirty(); render(); toast(`已恢复 ${restored.length} 幅图片，请保存后重新分配相册。`); }
  else if (action === 'open-history') { closeModal(); state.historyOpen = true; render(); }
  else if (action === 'close-history') { state.historyOpen = false; render(); }
  else if (action === 'album-open') { state.albumId = button.dataset.id; state.page = 'albums'; state.selected.clear(); render(); }
  else if (action === 'album-settings') openAlbumSettings(button.dataset.id);
  else if (action === 'settings-cover') openPicker('albums', targetDoc().albums.findIndex(album => album.id === state.settings.id), 'cover', true);
  else if (action === 'settings-add-milestone') {
    addAlbumReward(state.settings.album);
    renderAlbumSettings();
  }
  else if (action === 'settings-remove-milestone') { state.settings.album.milestones.splice(Number(button.dataset.row), 1); renderAlbumSettings(); }
  else if (action === 'album-back') { state.albumId = null; state.selected.clear(); render(); }
  else if (action === 'new-album') openModal('新建相册', '<form id="new-album-form" class="stack compact"><label class="field"><b>相册名称</b><input name="title" required maxlength="180" placeholder="例如：纸艺小世界" autofocus></label><p class="muted text-small">创建后选择图片，再设置显示与购买。</p><div class="modal-footer"><button type="button" data-action="close-modal">取消</button><button class="primary" type="submit">创建相册</button></div></form>');
  else if (action === 'delete-album') {
    const album = targetDoc().albums.find(item => item.id === button.dataset.id);
    if (!album || !await confirmAction(`移除「${album.title}」？其中 ${album.imageIds.length} 幅图片将回到未分配，只在后台保留。`)) return;
    targetDoc().albums = targetDoc().albums.filter(item => item.id !== album.id); state.albumId = null; state.selected.clear(); closeModal({ returnToSettings: false }); dirty(); render();
  }
  else if (action === 'assign-selected') {
    const id = document.querySelector('#assign-album').value;
    const destination = targetDoc().albums.find(album => album.id === id);
    if (!destination) { toast('请先选择要放入的相册。'); return; }
    const ids = [...state.selected]; if (!await confirmMoving(ids, destination)) return;
    moveIntoAlbum(ids, destination); state.selected.clear(); dirty(); render(); toast(`已放入「${destination.title}」，请保存。`);
  }
  else if (action === 'unassign-selected') {
    if (!await confirmAction(`将所选 ${state.selected.size} 幅图片移出相册？它们将只在后台保留。`)) return;
    for (const album of targetDoc().albums) removeAlbumImages(album, [...state.selected]);
    state.selected.clear(); dirty(); render();
  }
  else if (action === 'remove-album-selected') {
    const album = targetDoc().albums[Number(button.dataset.index)];
    const ids = album.imageIds.filter(id => state.selected.has(id));
    if (!ids.length || !await confirmAction(`将 ${ids.length} 幅图片移出「${album.title}」？它们会回到未分配。`)) return;
    removeAlbumImages(album, ids); state.selected.clear(); dirty(); render();
  }
  else if (action === 'logout') {
    if (hasUnsavedEdits() && !await confirmAction('还有未保存编辑。退出会放弃本窗口编辑，确定退出？')) return;
    busy(async () => { await api('/api/logout', { method: 'POST', body: {} }); state.draft = null; state.dirty = false; state.taskRewardsDirty = false; state.taskRewardDocument = null; state.taskRewards = null; state.gameSettingsDirty = false; state.gameSettingDocument = null; state.gameSettings = null; await initialize(); });
  }
  else if (action === 'close-modal') closeModal();
  else if (action === 'asset-detail') openAsset(button.dataset.id);
  else if (action === 'styles') openStyles();
  else if (action === 'finish-styles') { closeModal(); render(); }
  else if (action === 'delete-style') {
    doc().styles = styles().filter(style => style.id !== button.dataset.id); dirty(); openStyles();
  }
  else if (action === 'clear-selection') { state.selected.clear(); render(); }
  else if (action === 'batch-style') {
    const value = document.querySelector('#batch-style').value || null;
    state.selected.forEach(id => { managed(id).styleGroupId = value; }); dirty(); render();
  }
  else if (action === 'batch-tags' || action === 'batch-replace-tags') {
    const tags = parseTags(document.querySelector('#batch-tags').value);
    if (action === 'batch-replace-tags' && !tags.length && !await confirmAction('将清空所选素材的全部题材标签，确定继续？')) return;
    state.selected.forEach(id => { managed(id).subjectTags = action === 'batch-tags' ? [...new Set([...(managed(id).subjectTags || []), ...tags])] : [...tags]; }); dirty(); render();
  }
  else if (action === 'pick') openPicker(button.dataset.type, Number(button.dataset.index), button.dataset.mode);
  else if (action === 'pick-image') togglePick(button.dataset.id);
  else if (action === 'picker-apply') {
    const picker = state.picker, entity = picker.fromSettings ? state.settings.album : targetDoc()[picker.type][picker.index];
    if (picker.mode === 'cover') entity.coverImageId = [...picker.selected][0] || null;
    else {
      const ids = [...picker.selected]; if (!await confirmMoving(ids, entity)) return;
      entity.imageIds = entity.imageIds.filter(id => picker.selected.has(id));
      moveIntoAlbum(ids, entity);
    }
    if (picker.fromSettings) { state.picker = null; renderAlbumSettings(); }
    else { dirty(); closeModal(); render(); }
  }
  else if (action === 'move-image' || action === 'remove-image') {
    const entity = targetDoc()[button.dataset.type][Number(button.dataset.index)], order = Number(button.dataset.order);
    if (action === 'move-image') { const other = order + Number(button.dataset.delta); [entity.imageIds[order], entity.imageIds[other]] = [entity.imageIds[other], entity.imageIds[order]]; }
    else { const [removed] = entity.imageIds.splice(order, 1); if (entity.coverImageId === removed) entity.coverImageId = entity.imageIds[0] || null; }
    dirty(); render();
  }
  else if (action === 'add-milestone') {
    const album = targetDoc().albums[Number(button.dataset.index)];
    album.milestones ||= [];
    addAlbumReward(album); dirty(); render();
  }
  else if (action === 'remove-milestone') { targetDoc().albums[Number(button.dataset.index)].milestones.splice(Number(button.dataset.row), 1); dirty(); render(); }
  else if (action === 'analyze') busy(async () => {
    await saveDraft({ quiet: true });
    state.analysis = await api(`/api/drafts/${encodeURIComponent(state.draft.id)}/analyze`, { method: 'POST', body: { revision: state.draft.revision } });
    render(); toast('差异与兼容检查已完成。');
  });
  else if (action === 'version') busy(async () => { state.version = await api(`/api/versions/${encodeURIComponent(button.dataset.id)}`); state.fileIndex = 0; state.versionAdvancedOpen = false; showVersion(); });
  else if (action === 'file') { state.fileIndex = Number(button.dataset.index); state.versionAdvancedOpen = true; showVersion(); }
  else if (action === 'restore') openRestore(button.dataset.id);
  else if (action === 'reimport') openReimport();
});

document.addEventListener('change', event => {
  const element = event.target;
  if (element.dataset.importFiles !== undefined) { addImportFiles(element.files || []); element.value = ''; return; }
  if (element.dataset.importKey) {
    const row = state.importQueue[Number(element.dataset.row)];
    if (row) { row[element.dataset.importKey] = element.value; }
    return;
  }
  if (element.form?.id === 'game-settings-form') { updateGameSettingsField(element); return; }
  if (element.id === 'export-target') { if (TARGETS[element.value]) state.exportTarget = element.value; render(); return; }
  if (element.dataset.settingsField || element.dataset.settingsRow !== undefined) { updateSettingsField(element); return; }
  if (element.dataset.bind) {
    setBound(element);
    const path = JSON.parse(element.dataset.bind);
    if (path[2] === 'albums' && ['title', 'visible', 'price'].includes(path.at(-1))) render();
    return;
  }
  if (element.dataset.albumPurchase !== undefined) {
    const album = targetDoc().albums[Number(element.dataset.albumPurchase)];
    album.purchasable = element.checked; album.price = element.checked ? Math.max(1, Number(album.price) || 180) : 0;
    dirty(); render(); return;
  }
  if (element.id === 'picker-style') { state.picker.style = element.value; renderPicker(); return; }
  if (element.id === 'picker-select-all') {
    const picker = state.picker;
    filteredAssets({ query: picker.query, picker: true }).filter(asset => !picker.style || managed(asset.id).styleGroupId === picker.style).forEach(asset => { if (element.checked) picker.selected.add(asset.id); else picker.selected.delete(asset.id); });
    renderPicker(); return;
  }
  if (element.dataset.filter) {
    state.filters[element.dataset.filter] = element.value;
    if (element.dataset.filter !== 'query') render();
  }
  else if (element.dataset.select) {
    if (element.checked) state.selected.add(element.dataset.select); else state.selected.delete(element.dataset.select);
    render();
  }
  else if (element.dataset.pick) togglePick(element.dataset.pick, element.checked);
  else if (element.dataset.action === 'select-all') {
    filteredAssets().forEach(asset => { if (element.checked) state.selected.add(asset.id); else state.selected.delete(asset.id); }); render();
  }
  else if (element.dataset.action === 'select-album-all') {
    const album = targetDoc().albums.find(item => item.id === state.albumId);
    album.imageIds.forEach(id => { if (element.checked) state.selected.add(id); else state.selected.delete(id); }); render();
  }

});

let searchTimer;
document.addEventListener('input', event => {
  const element = event.target;
  if (element.form?.id === 'game-settings-form') { updateGameSettingsField(element); return; }
  if (element.form?.id === 'task-rewards-form') {
    updateTaskRewardInput(state.taskRewardDocument, element.name, element.value);
    state.taskRewardsDirty = true;
    document.querySelector('#task-rewards-save').disabled = false;
    const status = document.querySelector('#task-rewards-state'); status.textContent = '任务奖励有未保存修改'; status.className = 'dirty';
    return;
  }
  if ((element.dataset.settingsField || element.dataset.settingsRow !== undefined) && element.type !== 'checkbox' && element.tagName !== 'SELECT') { updateSettingsField(element); return; }
  if (element.dataset.bind && element.tagName !== 'SELECT' && element.type !== 'checkbox') setBound(element);
  if (element.dataset.filter === 'query') {
    clearTimeout(searchTimer);
    const value = element.value, cursor = element.selectionStart;
    searchTimer = setTimeout(() => { state.filters.query = value; render(); const search = document.querySelector('[data-filter="query"]'); if (search) { search.focus(); search.setSelectionRange(cursor, cursor); } }, 220);
  }
  if (element.id === 'picker-search') {
    clearTimeout(searchTimer);
    const value = element.value, cursor = element.selectionStart;
    searchTimer = setTimeout(() => { if (!state.picker) return; state.picker.query = value; renderPicker(); const search = document.querySelector('#picker-search'); search.focus(); search.setSelectionRange(cursor, cursor); }, 220);
  }
});

document.addEventListener('submit', event => {
  const form = event.target;
  if (form.id === 'auth-form') return;
  if (form.id === 'task-rewards-form') {event.preventDefault();busy(() => saveTaskRewards(form));return;}
  if (form.id === 'game-settings-form') {event.preventDefault();busy(() => saveGameSettings(form));return;}
  if (!['asset-form', 'album-settings-form', 'style-form', 'new-album-form', 'publish-form', 'restore-form', 'reimport-form'].includes(form.id)) return;
  event.preventDefault();
  const data = new FormData(form);
  if (form.id === 'asset-form') {
    const daily = dailyFor(form.dataset.id);
    if (!daily.locked) {
      const remaining = (doc().dailyPlans || []).filter(plan => plan.imageId !== form.dataset.id);
      if (data.get('dailyEnabled') === 'on') {
        const automatic = data.get('dailyAutoPublish') === 'on';
        const date = automatic ? null : String(data.get('dailyDate') || '');
        const albumId = String(data.get('dailyAlbumId') || '');
        if ((!automatic && !date) || !doc().albums.some(album => album.id === albumId)) { toast(automatic ? '请选择收录相册。' : '请选择每日首发日期和收录相册。', true); return; }
        if (!automatic && remaining.some(plan => !automaticDailyPlan(plan) && plan.date === date)) { toast('这一天已经指定了另一张首发图片，请选择其他日期。', true); return; }
        remaining.push({id:form.dataset.id,imageId:form.dataset.id,date,albumId,...(automatic ? {autoPublish:true} : {})});
      }
      doc().dailyPlans = remaining;
    }
    const meta = managed(form.dataset.id);
    Object.assign(meta, { title: String(data.get('title')).trim(), subtitle: String(data.get('subtitle')).trim(), styleGroupId: data.get('styleGroupId') || null, subjectTags: parseTags(data.get('subjectTags')) });
    dirty(); closeModal(); render();
  }
  else if (form.id === 'album-settings-form') {
    busy(() => saveAlbumSettings());
  }
  else if (form.id === 'new-album-form') {
    const title = String(data.get('title')).trim();
    if (!title) return;
    const entity = { id: `album-${crypto.randomUUID().slice(0, 8)}`, title, description: '', imageIds: [], coverImageId: null, styleGroupId: null, showOnPc: true, showOnMobile: true, purchasable: false, price: 0, decorationId: null, milestones: ALBUM_DEFAULT_MILESTONES() };
    targetDoc().albums.push(entity); state.page = 'albums'; state.albumId = null; state.selected.clear(); dirty(); closeModal(); render(); openAlbumSettings(entity.id);
  }
  else if (form.id === 'style-form') {
    const name = String(data.get('name')).trim();
    if (!name) return;
    if (styles().some(style => style.name === name)) { toast('已有同名画风分组。', true); return; }
    doc().styles.push({ id: `style-${crypto.randomUUID().slice(0, 8)}`, name }); dirty(); openStyles();
  }
  else if (form.id === 'publish-form') {
    if (!state.analysis) { toast('请先保存并查看改动，审阅后再生成版本。', true); return; }
    const kind = event.submitter?.value || 'snapshot';
    busy(async () => {
      await saveDraft({ quiet: true });
      state.analysis = await api(`/api/drafts/${encodeURIComponent(state.draft.id)}/analyze`, { method: 'POST', body: { revision: state.draft.revision } });
      if (kind === 'candidate' && (!(state.analysis.compatibleTargets || []).includes(state.exportTarget) || (state.analysis.blockers || []).some(item => !item.target || item.target === 'shared' || item.target === state.exportTarget))) {
        render(); toast('当前目标还有更新前需要解决的问题，已保留工作内容。请查看需要解决的问题，或保存版本备份。', true); return;
      }
      await api(`/api/drafts/${encodeURIComponent(state.draft.id)}/publish`, { method: 'POST', body: { revision: state.draft.revision, password: data.get('password'), reason: data.get('reason'), label: data.get('label'), target: kind === 'candidate' ? state.exportTarget : null, kind } });
      await refreshRecords(); render(); toast(kind === 'snapshot' ? '版本备份已保存。' : `${labelTarget(state.exportTarget)}游戏更新文件已生成，等待原游戏发布流程应用。`);
    });
  }
  else if (form.id === 'restore-form') busy(async () => {
    if (state.dirty && !await confirmAction('恢复后将使用这份备份作为当前工作内容。当前未保存编辑会放弃，确定继续？')) return;
    const result = await api(`/api/versions/${encodeURIComponent(form.dataset.id)}/restore`, { method: 'POST', body: { name: data.get('name'), password: data.get('password'), reason: data.get('reason') } });
    state.bootstrap = await api('/api/bootstrap'); await loadDraft((result.draft || result).id); closeModal(); render(); toast('已恢复此备份为当前工作内容。现有内容保留在历史记录。');
  });
  else if (form.id === 'reimport-form') busy(async () => {
    await saveDraft({ quiet: true });
    const result = await api(`/api/drafts/${encodeURIComponent(state.draft.id)}/reimport`, { method: 'POST', body: { revision: state.draft.revision, password: data.get('password'), reason: data.get('reason') } });
    state.bootstrap = await api('/api/bootstrap'); await loadDraft((result.draft || result).id); closeModal(); render(); toast('来源已重新导入，相册整理已保留。');
  });
});

modal.addEventListener('click', event => { if (event.target === modal && (event.offsetX < 0 || event.offsetX > modal.clientWidth || event.offsetY < 0 || event.offsetY > modal.clientHeight)) closeModal(); });
modal.addEventListener('cancel', event => { event.preventDefault(); closeModal(); });
modal.addEventListener('change', event => {
  if (!['dailyEnabled','dailyAutoPublish'].includes(event.target.name)) return;
  if (event.target.name === 'dailyEnabled' && event.target.checked) event.target.form.elements.dailyAutoPublish.checked = true;
  updateDailyControls(event.target.form);
});
// Dragging files anywhere onto the import panel queues them.
document.addEventListener('dragover', event => {
  if (state.page !== 'import' || !event.target.closest?.('[data-import-drop]')) return;
  event.preventDefault();
  event.target.closest('[data-import-drop]').classList.add('is-over');
});
document.addEventListener('dragleave', event => {
  const zone = event.target.closest?.('[data-import-drop]');
  if (zone) zone.classList.remove('is-over');
});
document.addEventListener('drop', event => {
  if (state.page !== 'import') return;
  const zone = event.target.closest?.('[data-import-drop]');
  if (!zone) return;
  event.preventDefault();
  zone.classList.remove('is-over');
  if (event.dataTransfer?.files?.length) addImportFiles(event.dataTransfer.files);
});
window.addEventListener('beforeunload', event => { if (hasUnsavedEdits()) { event.preventDefault(); event.returnValue = ''; } });
window.addEventListener('keydown', event => {
  if (event.key === 'Escape' && state.dragGesture) { clearDragFeedback(); event.preventDefault(); return; }
  if (confirmation.open) return;
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's' && state.session?.authenticated) {
    event.preventDefault(); busy(async () => { if (state.page === 'task-rewards') await saveTaskRewards(); else if (isGameSettingsPage()) await saveGameSettings(); else {await saveDraft(); render();} });
  }
});
initialize().catch(error => { app.innerHTML = `<main class="initial-loading"><h2>暂时无法打开工作室</h2><p>${esc(error.message)}</p><button data-action="retry">重试</button></main>`; });
setInterval(() => {
  if (!state.session?.authenticated || state.busy || modal.open || confirmation.open || state.dragGesture) return;
  refreshDaily().catch(() => {});
}, 45000);
