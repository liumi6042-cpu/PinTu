const app = document.querySelector('#app');
const modal = document.querySelector('#modal');
const toastNode = document.querySelector('#toast');
const TARGETS = { pc: 'PC 网页', 'mobile-shared': '共享小游戏' };
const STATUS = { published: '在架', archived: '归档', draft: '草稿' };
const FIELD_NAMES = { name: '名称', title: '标题', subtitle: '副标题', description: '说明', styleGroupId: '画风分组', subjectTags: '题材标签', status: '展示状态', galleryVisible: '图库可见', dailyOnly: '每日专用', category: '原分类', imageIds: '图片与顺序', coverImageId: '封面', price: '金币价格', decorationId: '奖励装饰', packId: '关联图包', milestones: '里程碑', added: '新增', removed: '移除', packOrder: '图包顺序', albumOrder: '图鉴顺序' };
const ENTITY_NAMES = { draft: '草稿', style: '画风', asset: '素材', pack: '图包', album: '图鉴', target: '内容目标' };
const AUDIT_NAMES = { 'import-baseline': '导入内容基线', 'initialize-admin': '创建管理员', login: '管理员登录', logout: '管理员退出', 'create-draft': '创建草稿', 'save-draft': '保存草稿', 'reimport-source': '重新导入来源', 'generate-candidate': '生成本地候选', 'save-snapshot': '保存规划快照', 'restore-version': '从版本恢复草稿' };
const state = {
  session: null, bootstrap: null, draft: null, target: 'mobile-shared', page: 'assets',
  dirty: false, busy: false, selected: new Set(), packId: null, albumId: null,
  filters: { query: '', style: '', tag: '', origin: '', direction: '', status: '', review: '' },
  analysis: null, picker: null, version: null, fileIndex: 0,
};
const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const attr = esc;
const clone = value => structuredClone(value);
const doc = () => state.draft?.document;
const assets = () => Array.isArray(state.bootstrap?.source?.assets) ? state.bootstrap.source.assets : Object.values(state.bootstrap?.source?.assets || {});
const assetById = id => assets().find(asset => asset.id === id);
const managed = id => doc()?.assets?.[id] || {};
const targetAsset = id => managed(id).targets?.[state.target] || {};
const targetDoc = () => doc()?.targets?.[state.target] || { packs: [], albums: [] };
const styles = () => doc()?.styles || [];
const styleName = id => styles().find(style => style.id === id)?.name || '待分类';
const titleFor = id => managed(id).title || assetById(id)?.title || id;
const imageUrl = (id, kind = 'thumbnail') => `/api/images/${encodeURIComponent(id)}?kind=${kind}`;
const date = value => value ? new Date(value).toLocaleString('zh-CN', { hour12: false, timeZone: 'Asia/Shanghai' }) : '—';
const textValue = value => typeof value === 'string' ? value : JSON.stringify(value ?? null);
const bindAttr = path => `data-bind="${attr(JSON.stringify(path))}"`;
const labelTarget = target => TARGETS[target] || (target === 'shared' ? '共用素材' : target) || '完整规划';

function toast(message, error = false) {
  toastNode.textContent = message;
  toastNode.className = error ? 'error' : '';
  toastNode.classList.add('visible');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { toastNode.classList.remove('visible'); }, error ? 7000 : 3500);
}

async function api(path, { method = 'GET', body } = {}) {
  const headers = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (method !== 'GET' && state.session?.csrfToken) headers['X-CSRF-Token'] = state.session.csrfToken;
  const response = await fetch(path, { method, headers, credentials: 'same-origin', body: body === undefined ? undefined : JSON.stringify(body) });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(result.error || `操作未完成（${response.status}）`);
    error.status = response.status; error.code = result.code; error.analysis = result.analysis;
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
  catch (error) { toast(error.status === 409 ? `${error.message}。本窗口编辑已保留，请另建草稿或重新载入后合并。` : error.message, true); }
  finally { state.busy = false; document.body.classList.remove('loading-inline'); }
}

function dirty() {
  state.dirty = true;
  state.analysis = null;
  const node = document.querySelector('#save-state');
  if (node) { node.textContent = '有未保存编辑'; node.classList.remove('saved'); }
  const save = document.querySelector('[data-action="save"]');
  if (save) save.disabled = false;
  document.title = '● 拼图 · 内容工作室';
}

function markSaved() {
  state.dirty = false;
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
  const existing = state.bootstrap.drafts.find(item => item.id === state.draft.id);
  if (existing) Object.assign(existing, { revision: state.draft.revision, name: state.draft.name, updatedAt: state.draft.updatedAt });
  markSaved();
  const audit = await api('/api/audit').catch(() => null);
  if (audit) state.bootstrap.audit = audit.audit || [];
  if (!quiet) toast('草稿已保存，游戏现有内容未变动。');
  return state.draft;
}

async function loadDraft(id) {
  state.draft = await api(`/api/drafts/${encodeURIComponent(id)}`);
  if (state.draft.draft) state.draft = state.draft.draft;
  state.analysis = null;
  state.selected.clear();
  state.packId = null; state.albumId = null;
  markSaved();
}

async function initialize({ keepDraft = false } = {}) {
  state.session = await api('/api/session');
  if (!state.session.authenticated) { renderAuth(); return; }
  state.bootstrap = await api('/api/bootstrap');
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
    <section class="auth-intro"><div class="eyebrow">JIGSAW CONTENT STUDIO</div><h1>整理每一幅画，<br>留住每一份发现。</h1><p>一套素材库，分别配置 PC 网页与共享小游戏。按画风整理图包，用题材标签连接灵感。</p><small>本地内容工作室 · 私有管理</small></section>
    <section class="auth-card-wrap"><form class="auth-card" id="auth-form"><h2>${setup ? '创建首位管理员' : '管理员登录'}</h2><p class="auth-subtitle">${setup ? '首次在本机初始化。请设置独立账号和至少 10 位密码。' : '使用本地内容管理员账号。玩家账号不用于此后台。'}</p><div class="auth-error" role="alert">${esc(error)}</div>
      <label class="field"><b>管理员用户名</b><input name="username" required autocomplete="username" minlength="2" maxlength="40" autofocus></label>
      <label class="field"><b>密码</b><input name="password" type="password" maxlength="128" required ${setup ? 'minlength="10"' : ''} autocomplete="${setup ? 'new-password' : 'current-password'}"></label>
      ${setup ? '<label class="field"><b>再次输入密码</b><input name="confirmPassword" type="password" maxlength="128" minlength="10" required autocomplete="new-password"></label>' : ''}
      <button class="primary" type="submit">${setup ? '创建并进入工作室' : '进入工作室'}</button><p class="muted text-small space-top">图包整理先保存为草稿。生成候选不会自动部署到游戏。</p>
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
        await initialize({ keepDraft: state.dirty });
      } catch (error) { event.target.querySelector('.auth-error').textContent = error.message; }
    });
  });
}

function render() {
  if (!state.session?.authenticated) { renderAuth(); return; }
  const pages = [['assets', '▦', '素材库'], ['packs', '▤', '图包'], ['albums', '▧', '图鉴'], ['publish', '↗', '发布与版本']];
  app.innerHTML = `<div class="shell"><aside class="sidebar"><div class="brand"><div class="brand-mark">✳</div><strong>内容工作室</strong><span>拼图的素材与收藏</span></div><nav class="nav" aria-label="主要导航">${pages.map(([id, icon, name]) => `<button data-action="page" data-page="${id}" class="${state.page === id ? 'active' : ''}" ${state.page === id ? 'aria-current="page"' : ''}><span class="nav-icon">${icon}</span>${name}</button>`).join('')}</nav><div class="sidebar-note">素材身份保持稳定<br>画风分组 · 题材标签<br><br>微信与 TapTap 共用<br>「共享小游戏」内容配置</div></aside>
    <main class="main"><header class="topbar"><div class="target-switch" aria-label="内容目标">${Object.entries(TARGETS).map(([id, name]) => `<button data-action="target" data-target="${id}" class="${state.target === id ? 'active' : ''}" aria-pressed="${state.target === id}">${name}</button>`).join('')}</div><div class="draft-control"><label class="sr-only" for="draft-select">当前草稿</label><select id="draft-select" data-action="draft-select">${(state.bootstrap?.drafts || []).map(item => `<option value="${attr(item.id)}" ${state.draft?.id === item.id ? 'selected' : ''}>${esc(item.name)}</option>`).join('')}</select><button data-action="new-draft" class="small">新草稿</button><span id="save-state" class="dirty ${state.dirty ? '' : 'saved'}">${state.dirty ? '有未保存编辑' : '已保存'}</span><button class="primary small" data-action="save" ${!state.dirty ? 'disabled' : ''}>保存草稿</button><button data-action="logout" class="quiet small" title="退出管理员账号">退出</button></div></header><div class="main-content" id="page-content">${state.draft ? renderPage() : '<div class="empty"><h2>创建你的第一份内容草稿</h2><p>系统会从现有游戏导入完整内容基线。</p><button data-action="new-draft" class="primary space-top">创建草稿</button></div>'}</div></main></div>`;
}

function renderPage() {
  if (state.page === 'assets') return renderAssets();
  if (state.page === 'packs') return renderEntities('packs');
  if (state.page === 'albums') return renderEntities('albums');
  return renderPublish();
}

function heading(title, subtitle, actions = '') {
  return `<div class="page-heading"><div><div class="eyebrow">${esc(labelTarget(state.target))} · CONTENT WORKSPACE</div><h1>${title}</h1><p>${subtitle}</p></div>${actions ? `<div class="actions">${actions}</div>` : ''}</div>`;
}
function options(values, selected, placeholder = '全部') {
  return `<option value="">${esc(placeholder)}</option>${values.map(([value, name]) => `<option value="${attr(value)}" ${selected === value ? 'selected' : ''}>${esc(name)}</option>`).join('')}`;
}
function styleOptions(selected, placeholder = '待分类') { return options(styles().map(style => [style.id, style.name]), selected || '', placeholder); }
function statusOptions(selected) { return Object.entries(STATUS).map(([value, name]) => `<option value="${value}" ${value === selected ? 'selected' : ''}>${name}</option>`).join(''); }
function originName(value) { return ({ 'project-ai-generated': '项目生成', 'user-provided': '用户提供' })[value] || value || '未记录'; }
function reviewName(value) { return ({ approved: '已审核', reviewed: '已审核', passed: '已审核', pending: '待审核', rejected: '未通过', unknown: '未记录' })[value] || value || '未记录'; }
function directionName(value) { return ({ landscape: '横图', portrait: '竖图', square: '方图', horizontal: '横图', vertical: '竖图' })[value] || value || '未记录'; }

function filteredAssets({ query = state.filters.query, picker = false } = {}) {
  const needle = query.trim().toLocaleLowerCase();
  return assets().filter(asset => {
    const meta = managed(asset.id), target = meta.targets?.[state.target] || {};
    if (needle && ![asset.id, meta.title, asset.title, meta.subtitle, ...(meta.subjectTags || [])].some(value => String(value || '').toLocaleLowerCase().includes(needle))) return false;
    if (picker) return true;
    const filter = state.filters;
    if (filter.style === '__none' && meta.styleGroupId) return false;
    if (filter.style && filter.style !== '__none' && meta.styleGroupId !== filter.style) return false;
    if (filter.tag && !(meta.subjectTags || []).includes(filter.tag)) return false;
    if (filter.origin && asset.origin !== filter.origin) return false;
    if (filter.direction && asset.direction !== filter.direction) return false;
    if (filter.status && target.status !== filter.status) return false;
    if (filter.review && asset.reviewStatus !== filter.review) return false;
    return true;
  });
}

function assetCard(asset, { picker = false } = {}) {
  const meta = managed(asset.id), target = targetAsset(asset.id);
  const selected = picker ? state.picker.selected.has(asset.id) : state.selected.has(asset.id);
  const status = target.status || 'draft';
  return `<article class="asset-card ${selected ? 'selected' : ''}"><label class="asset-check"><input type="${picker && state.picker.mode === 'cover' ? 'radio' : 'checkbox'}" ${picker ? 'name="picker-item"' : ''} aria-label="选择 ${attr(titleFor(asset.id))}" data-${picker ? 'pick' : 'select'}="${attr(asset.id)}" ${selected ? 'checked' : ''}></label><button class="asset-thumb" data-action="${picker ? 'pick-image' : 'asset-detail'}" data-id="${attr(asset.id)}" aria-label="${picker ? '选择' : '查看'} ${attr(titleFor(asset.id))}"><img loading="lazy" src="${imageUrl(asset.id)}" alt="${attr(titleFor(asset.id))}"></button><div class="asset-info"><strong title="${attr(titleFor(asset.id))}">${esc(titleFor(asset.id))}</strong><div class="asset-id" title="${attr(asset.id)}">${esc(asset.id)}</div><div class="chips"><span class="chip">${esc(styleName(meta.styleGroupId))}</span><span class="chip ${status}">${esc(STATUS[status] || status)}</span>${!picker && (meta.subjectTags || []).slice(0, 2).map(tag => `<span class="chip">${esc(tag)}</span>`).join('')}</div></div></article>`;
}

function renderAssets() {
  const filtered = filteredAssets();
  const tags = [...new Set(Object.values(doc().assets).flatMap(asset => asset.subjectTags || []))].sort();
  const origins = [...new Set(assets().map(asset => asset.origin).filter(Boolean))];
  const directions = [...new Set(assets().map(asset => asset.direction).filter(Boolean))];
  const reviews = [...new Set(assets().map(asset => asset.reviewStatus).filter(Boolean))];
  return heading('素材库', `${assets().length} 幅素材共用同一来源；当前编辑 ${labelTarget(state.target)} 的展示状态。`, '<button data-action="styles">管理画风</button>') +
    `<div class="filters"><label>搜索素材<input data-filter="query" value="${attr(state.filters.query)}" placeholder="图片 ID、标题或题材"></label><label>画风<select data-filter="style">${options([['__none', '待分类'], ...styles().map(style => [style.id, style.name])], state.filters.style, '全部画风')}</select></label><label>题材<select data-filter="tag">${options(tags.map(tag => [tag, tag]), state.filters.tag, '全部题材')}</select></label><label>来源<select data-filter="origin">${options(origins.map(value => [value, originName(value)]), state.filters.origin)}</select></label><label>方向<select data-filter="direction">${options(directions.map(value => [value, directionName(value)]), state.filters.direction)}</select></label><label>状态<select data-filter="status">${options(Object.entries(STATUS), state.filters.status)}</select></label><label>审核<select data-filter="review">${options(reviews.map(value => [value, reviewName(value)]), state.filters.review)}</select></label></div>
    <div class="toolbar"><label class="check-field"><input type="checkbox" data-action="select-all" ${filtered.length && filtered.every(asset => state.selected.has(asset.id)) ? 'checked' : ''}> 选择筛选结果</label><span class="muted">显示 ${filtered.length} 幅 · ${state.selected.size} 幅已选</span></div>
    ${state.selected.size ? `<div class="batchbar"><strong>整理 ${state.selected.size} 幅素材</strong><select id="batch-style" aria-label="批量画风">${styleOptions('')}</select><button class="small" data-action="batch-style">设置画风</button><input id="batch-tags" aria-label="批量题材标签" placeholder="题材标签，用逗号分隔"><button class="small" data-action="batch-tags">追加标签</button><button class="small" data-action="batch-replace-tags">替换标签</button><button class="quiet small" data-action="clear-selection">清空选择</button></div>` : ''}
    ${filtered.length ? `<div class="asset-grid">${filtered.map(asset => assetCard(asset)).join('')}</div>` : '<div class="empty">没有符合筛选条件的素材。<p>可以修改关键词或清空部分筛选。</p></div>'}`;
}

function renderEntities(type) {
  const isPack = type === 'packs';
  const name = isPack ? '图包' : '图鉴';
  const list = targetDoc()[type] || [];
  const idKey = isPack ? 'packId' : 'albumId';
  let index = list.findIndex(item => item.id === state[idKey]);
  if (index < 0 && list.length) { index = 0; state[idKey] = list[0].id; }
  const active = list[index];
  return heading(name, `${labelTarget(state.target)} 独立配置。画风与题材整理保存在当前草稿。`, `<button class="primary" data-action="new-entity" data-type="${type}">新建${name}</button>`) +
    (state.target === 'pc' ? '<div class="notice">PC 目前使用主题画册，没有金币购买机制；收费与里程碑金币配置需另行接入。</div>' : '') +
    `<div class="editor-layout"><aside class="entity-list">${list.map(item => `<button data-action="entity" data-type="${type}" data-id="${attr(item.id)}" class="${item.id === active?.id ? 'active' : ''}"><strong>${esc(item.title)}</strong><span>${esc(item.id)} · ${item.imageIds.length} 幅${isPack ? ` · ${esc(STATUS[item.status] || item.status)}` : ''}</span></button>`).join('') || '<div class="empty">暂无分组</div>'}</aside>${active ? renderEntityEditor(type, active, index) : `<div class="empty"><h2>创建第一个${name}</h2><p>选择图片，设定顺序，然后保存为草稿。</p></div>`}</div>`;
}

function renderEntityEditor(type, entity, index) {
  const isPack = type === 'packs';
  const base = ['targets', state.target, type, index];
  return `<section class="panel"><div class="section-heading"><h2>${esc(entity.title)}</h2><button class="quiet danger small" data-action="delete-entity" data-type="${type}" data-id="${attr(entity.id)}">移除分组</button></div><div class="form-grid">
    <label class="field"><b>稳定 ID</b><input value="${attr(entity.id)}" readonly><small>历史引用依赖此 ID，创建后不可改名。</small></label>
    <label class="field"><b>标题</b><input ${bindAttr([...base, 'title'])} value="${attr(entity.title)}" maxlength="180" required></label>
    <label class="field full"><b>说明</b><textarea ${bindAttr([...base, 'description'])} maxlength="1500">${esc(entity.description)}</textarea></label>
    <label class="field"><b>画风分组</b><select ${bindAttr([...base, 'styleGroupId'])} data-null="true">${styleOptions(entity.styleGroupId)}</select></label>
    ${isPack ? `<label class="field"><b>展示状态</b><select ${bindAttr([...base, 'status'])}>${statusOptions(entity.status)}</select></label><label class="field"><b>金币价格</b>${state.target === 'pc' ? '<input value="PC 不适用" readonly>' : `<input ${bindAttr([...base, 'price'])} data-number="true" type="number" min="0" step="1" value="${attr(entity.price ?? '')}" required>`}</label><label class="field"><b>关联装饰 ID</b><input ${bindAttr([...base, 'decorationId'])} data-null="true" value="${attr(entity.decorationId)}" maxlength="100"><small>既有奖励关联改变会触发兼容检查。</small></label>` : `<label class="field"><b>关联图包</b><select ${bindAttr([...base, 'packId'])} data-null="true">${options((targetDoc().packs || []).map(pack => [pack.id, pack.title]), entity.packId || '', '独立图鉴')}</select><small>旧小游戏结构仍依赖图包关联。</small></label>`}
    </div>${isPack ? `<div class="cover-row">${entity.coverImageId ? `<img src="${imageUrl(entity.coverImageId)}" alt="${attr(titleFor(entity.coverImageId))}">` : ''}<div><strong>图包封面</strong><div class="muted text-small">${entity.coverImageId ? esc(titleFor(entity.coverImageId)) : '尚未选择'}</div><small>独立设置，不会改变图片排序。</small></div><button class="small push-right" data-action="pick" data-type="${type}" data-index="${index}" data-mode="cover" ${entity.imageIds.length ? '' : 'disabled'}>选择封面</button></div>` : ''}
    <section class="section"><div class="section-heading"><h3>图片与顺序 · ${entity.imageIds.length} 幅</h3><button data-action="pick" data-type="${type}" data-index="${index}" data-mode="members" class="small">选择图片</button></div>${entity.imageIds.length ? entity.imageIds.map((id, order) => imageRow(id, order, type, index, entity.imageIds.length)).join('') : '<div class="empty">从素材库选择图片开始整理。</div>'}</section>
    ${!isPack ? `<section class="section"><div class="section-heading"><h3>里程碑奖励</h3><button class="small" data-action="add-milestone" data-index="${index}">添加里程碑</button></div><p class="muted text-small">既有目标与奖励定义需保持稳定。新的规则可先保留为规划。</p>${(entity.milestones || []).map((milestone, row) => `<div class="milestone-row"><label class="field">完成张数<input ${bindAttr([...base, 'milestones', row, 'target'])} data-number="true" type="number" min="1" step="1" value="${milestone.target}"></label><label class="field">奖励金币<input ${bindAttr([...base, 'milestones', row, 'coins'])} data-number="true" type="number" min="0" step="1" value="${milestone.coins}"></label><label class="field">奖励装饰 ID<input ${bindAttr([...base, 'milestones', row, 'decorationId'])} data-null="true" value="${attr(milestone.decorationId)}"></label><button class="danger small" data-action="remove-milestone" data-index="${index}" data-row="${row}" aria-label="移除此里程碑">×</button></div>`).join('') || '<p class="muted">尚无里程碑奖励。</p>'}</section>` : ''}
    <div class="notice warning section-notice">图片成员、旧奖励、独立封面或上下架的调整可能需要运行时兼容。请到「发布与版本」查看具体阻断项。</div></section>`;
}

function imageRow(id, order, type, index, count) {
  return `<div class="image-row"><img loading="lazy" src="${imageUrl(id)}" alt="${attr(titleFor(id))}"><div><strong>${order + 1}. ${esc(titleFor(id))}</strong><small>${esc(id)}</small></div><div class="actions"><button class="small" data-action="move-image" data-type="${type}" data-index="${index}" data-order="${order}" data-delta="-1" ${order === 0 ? 'disabled' : ''} aria-label="上移图片">↑</button><button class="small" data-action="move-image" data-type="${type}" data-index="${index}" data-order="${order}" data-delta="1" ${order === count - 1 ? 'disabled' : ''} aria-label="下移图片">↓</button><button class="small danger" data-action="remove-image" data-type="${type}" data-index="${index}" data-order="${order}">移除</button></div></div>`;
}

function renderPublish() {
  const analysis = state.analysis;
  const inspected = Boolean(analysis);
  const candidateAllowed = inspected && (analysis.compatibleTargets || []).includes(state.target);
  return heading('发布与版本', '生成本地规划快照或目标候选；游戏内容由原项目的发布流程接入。', '<button data-action="reimport">重新导入来源</button><button class="primary" data-action="analyze">保存并检查差异</button>') +
    `<div class="notice">本地「生成候选」不会上线，不会覆盖游戏源码或玩家数据。包含兼容阻断的规划仍可保存为完整快照。</div><div class="publish-layout"><div class="stack"><section class="panel"><div class="section-heading"><h2>差异与兼容</h2><small>草稿版本 ${state.draft.revision}</small></div>${analysis ? renderAnalysis(analysis) : '<div class="empty">先保存并检查差异。<p>服务端会核对图片资源、历史身份、图包权益与奖励规则。</p></div>'}</section><section class="panel"><h2>版本记录</h2>${renderVersions()}</section></div><div class="stack"><section class="panel"><h2>生成本地版本</h2><form id="publish-form"><label class="field space-bottom"><b>版本标签</b><input name="label" required maxlength="100" placeholder="例如：纸艺分组整理 · 第一轮"></label><label class="field space-bottom"><b>操作原因</b><textarea name="reason" required minlength="4" maxlength="500" placeholder="记录这次整理的目的与影响"></textarea></label><label class="field space-bottom"><b>再次验证管理员密码</b><input name="password" type="password" maxlength="128" required autocomplete="current-password"></label><div class="actions"><button type="submit" name="kind" value="snapshot" ${inspected ? '' : 'disabled'}>保存完整规划快照</button><button type="submit" name="kind" value="candidate" class="primary" ${candidateAllowed ? '' : 'disabled'}>生成${labelTarget(state.target)}候选</button></div><p class="muted text-small publish-note">${!inspected ? '先点击「保存并检查差异」，审阅后再生成版本。' : !candidateAllowed ? '当前目标存在兼容阻断，可保存完整规划快照继续整理。' : '候选仅包含当前目标的兼容内容，不会静默排除变更。'}</p></form></section><section class="panel"><h2>操作审计</h2>${renderAudit()}</section></div></div>`;
}

function renderAnalysis(analysis) {
  const blockers = analysis.blockers || [], warnings = analysis.warnings || [], changes = analysis.changes || [];
  return `${blockers.length ? `<div class="notice error"><strong>${blockers.length} 项兼容阻断</strong><ul class="analysis-list">${blockers.map(item => `<li><strong>${esc(labelTarget(item.target))} · ${esc(item.id || item.code)}</strong><br>${esc(item.message)}</li>`).join('')}</ul></div>` : '<div class="notice">未发现兼容阻断。生成候选时还会校验原件、审核和交付文件。</div>'}
    ${warnings.length ? `<div class="notice warning"><strong>需要留意</strong><ul class="analysis-list">${warnings.map(item => `<li>${esc(labelTarget(item.target))} · ${esc(item.message)}</li>`).join('')}</ul></div>` : ''}
    <p class="muted text-small">可生成目标候选：${(analysis.compatibleTargets || []).map(labelTarget).join('、') || '暂无'} · ${changes.length} 项差异</p>
    ${changes.length ? `<div class="table-wrap"><table><thead><tr><th>目标 / 内容</th><th>字段</th><th>当前基线</th><th>草稿</th></tr></thead><tbody>${changes.map(change => `<tr><td>${esc(labelTarget(change.target))}<br><small>${esc(ENTITY_NAMES[change.entityType] || change.entityType)} · ${esc(change.id)}</small></td><td>${esc(FIELD_NAMES[change.field] || change.field)}</td><td class="diff-value">${esc(textValue(change.before))}</td><td class="diff-value">${esc(textValue(change.after))}</td></tr>`).join('')}</tbody></table></div>` : '<p class="muted">当前草稿与导入基线一致。</p>'}`;
}

function renderVersions() {
  const versions = state.bootstrap?.versions || [];
  return versions.length ? versions.map(version => `<article class="version-row"><div class="version-top"><div><strong>${esc(version.label || version.id)}</strong><small>${date(version.createdAt)} · ${version.kind === 'snapshot' ? '规划快照' : `${esc(labelTarget(version.target))}候选`}</small></div><span class="chip">本地版本</span></div><p>${esc(typeof version.summary === 'string' ? version.summary : version.reason || (version.summary ? textValue(version.summary) : version.id))}</p><div class="actions"><button class="small" data-action="version" data-id="${attr(version.id)}">查看导出</button><a class="download-link" href="/api/versions/${encodeURIComponent(version.id)}/download" download>下载版本</a><button class="small" data-action="restore" data-id="${attr(version.id)}">恢复为新草稿</button></div></article>`).join('') : '<p class="muted">尚无版本。完整规划快照会保留两个目标的全部草稿。</p>';
}

function renderAudit() {
  const rows = state.bootstrap?.audit || [];
  return rows.length ? rows.slice(0, 20).map(row => {
    const action = row.action || row.event || row.type || '操作';
    const label = row.label || state.bootstrap.drafts.find(draft => draft.id === row.target)?.name || state.bootstrap.versions.find(version => version.id === row.target)?.label || '';
    return `<div class="audit-row">${esc(AUDIT_NAMES[action] || action)}${label ? ` · ${esc(label)}` : ''}<span>${date(row.createdAt || row.timestamp || row.at)} · ${esc(row.username || row.actor?.username || (row.actor === 'system' ? '系统' : row.actor) || '')}</span>${row.reason ? `<span>${esc(row.reason)}</span>` : ''}</div>`;
  }).join('') : '<p class="muted">保存、候选生成与版本恢复会记录到这里。</p>';
}

function openModal(title, content) {
  modal.innerHTML = `<header class="modal-head"><h2 id="modal-title">${esc(title)}</h2><button data-action="close-modal" class="quiet" aria-label="关闭弹窗">×</button></header><div class="modal-body">${content}</div>`;
  if (!modal.open) modal.showModal();
}
function closeModal() { if (modal.open) modal.close(); state.picker = null; }

function openAsset(id) {
  const asset = assetById(id), meta = managed(id), target = targetAsset(id);
  if (!asset) return;
  const related = (targetDoc().packs || []).filter(pack => pack.imageIds.includes(id)).map(pack => pack.title);
  const body = `<form id="asset-form" data-id="${attr(id)}"><div class="asset-detail"><div><img class="detail-preview" src="${imageUrl(id, 'preview')}" alt="${attr(titleFor(id))}"><dl class="detail-facts"><dt>稳定图片 ID</dt><dd>${esc(id)}</dd><dt>原始尺寸 / 方向</dt><dd>${esc(asset.width || '?')} × ${esc(asset.height || '?')} · ${esc(directionName(asset.direction))}</dd><dt>来源 / 审核</dt><dd>${esc(originName(asset.origin))} · ${esc(reviewName(asset.reviewStatus))}</dd><dt>当前目标引用图包</dt><dd>${related.length ? esc(related.join('、')) : '暂无'}</dd></dl></div><div class="stack compact"><label class="field"><b>标题（两端共用）</b><input name="title" value="${attr(meta.title || asset.title)}" required maxlength="180"></label><label class="field"><b>副标题</b><input name="subtitle" value="${attr(meta.subtitle || '')}" maxlength="500"></label><label class="field"><b>画风</b><select name="styleGroupId">${styleOptions(meta.styleGroupId)}</select></label><label class="field"><b>题材标签</b><input name="subjectTags" value="${attr((meta.subjectTags || []).join('，'))}" placeholder="例如：山海、城市、花卉"><small>用中文或英文逗号分隔。</small></label><label class="field"><b>${labelTarget(state.target)} · 状态</b><select name="status">${statusOptions(target.status)}</select></label><label class="check-field"><input name="galleryVisible" type="checkbox" ${target.galleryVisible ? 'checked' : ''}>在当前目标图库展示</label><label class="field"><b>原分类（只读）</b><input readonly value="${attr(target.category || asset.category || '')}"><small>不使用旧分类自动推断画风。${target.dailyOnly ? '此图为每日专用图。' : ''}</small></label></div></div><details class="section"><summary>来源、授权与审核记录（只读）</summary><dl class="detail-facts"><dt>来源说明</dt><dd>${esc(asset.sourceDescription || '未记录')}</dd><dt>授权说明</dt><dd>${esc(asset.rightsStatement || '未记录')}</dd></dl><pre class="pre">${esc(JSON.stringify({ review: asset.review, delivery: asset.delivery }, null, 2))}</pre></details><div class="modal-footer"><button type="button" data-action="close-modal">取消</button><button type="submit" class="primary">应用到草稿</button></div></form>`;
  openModal('素材详情', body);
}

function openStyles() {
  const countUsage = id => Object.values(doc().assets).filter(asset => asset.styleGroupId === id).length + Object.values(doc().targets).flatMap(target => [...target.packs, ...target.albums]).filter(entity => entity.styleGroupId === id).length;
  openModal('画风分组', `<p class="muted">画风作为主分组，题材作为标签。此处改动只保存在草稿。</p>${styles().map((style, index) => `<div class="style-row"><input aria-label="画风名称" ${bindAttr(['styles', index, 'name'])} value="${attr(style.name)}" maxlength="60"><small>${countUsage(style.id)} 处引用</small><button class="small danger" data-action="delete-style" data-id="${attr(style.id)}" ${countUsage(style.id) ? 'disabled title="需先取消所有引用"' : ''}>删除</button></div>`).join('')}<form id="style-form" class="style-add"><input name="name" required maxlength="60" placeholder="新增画风，例如：纸艺"><button class="primary" type="submit">新增画风</button></form><div class="modal-footer"><button data-action="finish-styles">完成</button></div>`);
}

function openNewEntity(type) {
  const name = type === 'packs' ? '图包' : '图鉴';
  openModal(`新建${name}`, `<form id="new-entity-form" data-type="${type}" class="stack compact"><label class="field"><b>稳定 ID</b><input name="id" required pattern="[a-z0-9]+(-[a-z0-9]+)*" maxlength="80" placeholder="例如：paper-worlds"><small>1–80 位小写字母、数字和短横线；创建后不可改名。</small></label><label class="field"><b>标题</b><input name="title" required maxlength="180" placeholder="${name}名称"></label><div class="notice warning">新分组不会改变已有玩家权益。候选导出需通过兼容检查。</div><div class="modal-footer"><button type="button" data-action="close-modal">取消</button><button class="primary" type="submit">创建为草稿</button></div></form>`);
}

function openPicker(type, index, mode) {
  const entity = targetDoc()[type][index];
  state.picker = { type, index, mode, query: '', selected: new Set(mode === 'cover' ? (entity.coverImageId ? [entity.coverImageId] : []) : entity.imageIds) };
  renderPicker();
}

function renderPicker() {
  const picker = state.picker;
  const entity = targetDoc()[picker.type][picker.index];
  const candidates = filteredAssets({ query: picker.query, picker: true }).filter(asset => picker.mode !== 'cover' || entity.imageIds.includes(asset.id));
  openModal(picker.mode === 'cover' ? '选择图包封面' : '选择图片', `<label class="field"><b>搜索素材</b><input id="picker-search" placeholder="图片 ID、标题或标签" value="${attr(picker.query)}"></label><div class="toolbar picker-toolbar"><span class="picker-count">${candidates.length} 幅可选 · ${picker.selected.size} 幅已选</span><small>${picker.mode === 'cover' ? '封面从图包成员中选择。' : '保留已有顺序，新选择的图片追加到末尾。'}</small></div><div class="asset-grid picker-grid">${candidates.map(asset => assetCard(asset, { picker: true })).join('') || '<p class="muted">没有符合搜索条件的图片。</p>'}</div><div class="modal-footer"><button data-action="close-modal">取消</button><button class="primary" data-action="picker-apply" ${picker.mode === 'cover' && !picker.selected.size ? 'disabled' : ''}>应用选择</button></div>`);
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
  openModal('恢复为新草稿', `<form id="restore-form" data-id="${attr(id)}" class="stack compact"><p class="muted">从「${esc(version?.label || id)}」建立新草稿，原草稿与历史版本会保留。</p><label class="field"><b>新草稿名称</b><input name="name" required maxlength="100" value="${attr(`恢复 · ${version?.label || id}`)}"></label><label class="field"><b>操作原因</b><textarea name="reason" required minlength="4" maxlength="500"></textarea></label><label class="field"><b>再次验证密码</b><input name="password" type="password" maxlength="128" required autocomplete="current-password"></label><div class="modal-footer"><button type="button" data-action="close-modal">取消</button><button type="submit" class="primary">恢复为新草稿</button></div></form>`);
}

function openReimport() {
  openModal('重新导入来源', `<form id="reimport-form" class="stack compact"><div class="notice">先保存当前草稿，再读取原项目最新内容。服务端合并草稿与来源的独立改动；遇到冲突会拒绝覆盖并保留编辑。</div><label class="field"><b>操作原因</b><textarea name="reason" required minlength="4" maxlength="500" placeholder="例如：同步原项目新增的已审核图片"></textarea></label><label class="field"><b>再次验证密码</b><input name="password" type="password" maxlength="128" required autocomplete="current-password"></label><div class="modal-footer"><button type="button" data-action="close-modal">取消</button><button type="submit" class="primary">保存并导入最新来源</button></div></form>`);
}

function showVersion() {
  const { version } = state.version;
  const files = [...(state.version.files || [])];
  if (version.kind === 'snapshot' && state.version.document) files.unshift({ path: '完整规划草稿（版本内）', content: state.version.document });
  const file = files[state.fileIndex];
  openModal(version.label || version.id, `<div class="notice">${version.kind === 'snapshot' ? '完整规划快照' : `${esc(labelTarget(version.target))}发布候选`} · ${date(version.createdAt)}<br>仅供本地审阅与原项目发布流程接入。</div><details><summary>版本记录</summary><pre class="pre">${esc(JSON.stringify(version, null, 2))}</pre></details><h3 class="space-top">导出文件</h3><div class="file-tabs">${files.map((item, index) => `<button class="${state.fileIndex === index ? 'active' : ''}" data-action="file" data-index="${index}">${esc(item.path)}</button>`).join('')}</div>${file ? `<pre class="pre file-content">${esc(typeof file.content === 'string' ? file.content : JSON.stringify(file.content, null, 2))}</pre>` : '<p class="muted">此版本没有目标适配文件。</p>'}<div class="modal-footer"><a href="/api/versions/${encodeURIComponent(version.id)}/download" download>下载完整版本</a><button data-action="close-modal">关闭</button></div>`);
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

document.addEventListener('click', event => {
  const button = event.target.closest('[data-action]');
  if (!button || button.disabled || button.tagName === 'SELECT' || button.tagName === 'INPUT') return;
  const action = button.dataset.action;
  if (action === 'retry') { location.reload(); }
  else if (action === 'page') { state.page = button.dataset.page; render(); }
  else if (action === 'target') { state.target = button.dataset.target; state.selected.clear(); state.packId = null; state.albumId = null; render(); }
  else if (action === 'save') busy(async () => { await saveDraft(); render(); });
  else if (action === 'new-draft') openModal('新建内容草稿', `<form id="new-draft-form" class="stack compact"><label class="field"><b>草稿名称</b><input name="name" required maxlength="100" placeholder="例如：按画风整理 · 第一轮"></label>${state.draft ? '<label class="check-field"><input name="copy" type="checkbox" checked>复制当前内容（包含本窗口未保存编辑）</label>' : ''}<div class="modal-footer"><button type="button" data-action="close-modal">取消</button><button class="primary" type="submit">创建草稿</button></div></form>`);
  else if (action === 'logout') {
    if (state.dirty && !confirm('还有未保存编辑。退出会放弃本窗口编辑，确定退出？')) return;
    busy(async () => { await api('/api/logout', { method: 'POST', body: {} }); state.draft = null; state.dirty = false; await initialize(); });
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
    if (action === 'batch-replace-tags' && !tags.length && !confirm('将清空所选素材的全部题材标签，确定继续？')) return;
    state.selected.forEach(id => { managed(id).subjectTags = action === 'batch-tags' ? [...new Set([...(managed(id).subjectTags || []), ...tags])] : [...tags]; }); dirty(); render();
  }
  else if (action === 'entity') { state[button.dataset.type === 'packs' ? 'packId' : 'albumId'] = button.dataset.id; render(); }
  else if (action === 'new-entity') openNewEntity(button.dataset.type);
  else if (action === 'delete-entity') {
    if (!confirm('从草稿移除此分组？历史内容删除将由发布兼容检查拦截。')) return;
    const type = button.dataset.type;
    targetDoc()[type] = targetDoc()[type].filter(entity => entity.id !== button.dataset.id); dirty(); render();
  }
  else if (action === 'pick') openPicker(button.dataset.type, Number(button.dataset.index), button.dataset.mode);
  else if (action === 'pick-image') togglePick(button.dataset.id);
  else if (action === 'picker-apply') {
    const picker = state.picker, entity = targetDoc()[picker.type][picker.index];
    if (picker.mode === 'cover') entity.coverImageId = [...picker.selected][0] || null;
    else {
      entity.imageIds = [...entity.imageIds.filter(id => picker.selected.has(id)), ...[...picker.selected].filter(id => !entity.imageIds.includes(id))];
      if (picker.type === 'packs' && !entity.imageIds.includes(entity.coverImageId)) entity.coverImageId = entity.imageIds[0] || null;
    }
    dirty(); closeModal(); render();
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
    album.milestones.push({ target: Math.max(1, album.imageIds.length), coins: 0, decorationId: null }); dirty(); render();
  }
  else if (action === 'remove-milestone') { targetDoc().albums[Number(button.dataset.index)].milestones.splice(Number(button.dataset.row), 1); dirty(); render(); }
  else if (action === 'analyze') busy(async () => {
    await saveDraft({ quiet: true });
    state.analysis = await api(`/api/drafts/${encodeURIComponent(state.draft.id)}/analyze`, { method: 'POST', body: { revision: state.draft.revision } });
    render(); toast('差异与兼容检查已完成。');
  });
  else if (action === 'version') busy(async () => { state.version = await api(`/api/versions/${encodeURIComponent(button.dataset.id)}`); state.fileIndex = 0; showVersion(); });
  else if (action === 'file') { state.fileIndex = Number(button.dataset.index); showVersion(); }
  else if (action === 'restore') openRestore(button.dataset.id);
  else if (action === 'reimport') openReimport();
});

document.addEventListener('change', event => {
  const element = event.target;
  if (element.dataset.bind) { setBound(element); return; }
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
  else if (element.dataset.action === 'draft-select') {
    if (state.dirty && !confirm('切换草稿会放弃未保存编辑。先取消并保存，或确定继续切换？')) { element.value = state.draft.id; return; }
    busy(async () => { await loadDraft(element.value); render(); });
  }
});

let searchTimer;
document.addEventListener('input', event => {
  const element = event.target;
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
  if (!['asset-form', 'style-form', 'new-entity-form', 'new-draft-form', 'publish-form', 'restore-form', 'reimport-form'].includes(form.id)) return;
  event.preventDefault();
  const data = new FormData(form);
  if (form.id === 'asset-form') {
    const meta = managed(form.dataset.id), target = meta.targets[state.target];
    Object.assign(meta, { title: String(data.get('title')).trim(), subtitle: String(data.get('subtitle')).trim(), styleGroupId: data.get('styleGroupId') || null, subjectTags: parseTags(data.get('subjectTags')) });
    Object.assign(target, { status: data.get('status'), galleryVisible: data.has('galleryVisible') }); dirty(); closeModal(); render();
  }
  else if (form.id === 'style-form') {
    const name = String(data.get('name')).trim();
    if (!name) return;
    if (styles().some(style => style.name === name)) { toast('已有同名画风分组。', true); return; }
    doc().styles.push({ id: `style-${crypto.randomUUID().slice(0, 8)}`, name }); dirty(); openStyles();
  }
  else if (form.id === 'new-entity-form') {
    const type = form.dataset.type, id = String(data.get('id')).trim(), title = String(data.get('title')).trim();
    if (targetDoc()[type].some(entity => entity.id === id)) { toast('当前目标已有相同 ID，请使用新的 ID。', true); return; }
    const entity = { id, title, description: '', imageIds: [], styleGroupId: null };
    if (type === 'packs') Object.assign(entity, { coverImageId: null, status: 'draft', price: state.target === 'pc' ? null : 0, decorationId: null });
    else Object.assign(entity, { packId: null, milestones: [] });
    targetDoc()[type].push(entity); state[type === 'packs' ? 'packId' : 'albumId'] = id; dirty(); closeModal(); render();
  }
  else if (form.id === 'new-draft-form') busy(async () => {
    const localCopy = data.has('copy') && state.draft && state.dirty ? clone(doc()) : null;
    if (!data.has('copy') && state.dirty && !confirm('将从源内容新建草稿，当前未保存编辑会放弃，确定继续？')) return;
    const result = await api('/api/drafts', { method: 'POST', body: { name: data.get('name'), ...(data.has('copy') && state.draft ? { fromDraftId: state.draft.id } : {}) } });
    const draft = result.draft || result;
    if (localCopy) {
      localCopy.name = String(data.get('name'));
      await api(`/api/drafts/${encodeURIComponent(draft.id)}`, { method: 'PUT', body: { revision: draft.revision, document: localCopy } });
    }
    state.bootstrap = await api('/api/bootstrap'); await loadDraft(draft.id); closeModal(); render(); toast('新草稿已创建。');
  });
  else if (form.id === 'publish-form') {
    if (!state.analysis) { toast('请先保存并检查差异，审阅后再生成版本。', true); return; }
    const kind = event.submitter?.value || 'snapshot';
    busy(async () => {
      await saveDraft({ quiet: true });
      state.analysis = await api(`/api/drafts/${encodeURIComponent(state.draft.id)}/analyze`, { method: 'POST', body: { revision: state.draft.revision } });
      if (kind === 'candidate' && (!(state.analysis.compatibleTargets || []).includes(state.target) || (state.analysis.blockers || []).some(item => !item.target || item.target === 'shared' || item.target === state.target))) {
        render(); toast('当前目标存在兼容阻断，已保留草稿。请检查阻断原因，或保存完整规划快照。', true); return;
      }
      await api(`/api/drafts/${encodeURIComponent(state.draft.id)}/publish`, { method: 'POST', body: { revision: state.draft.revision, password: data.get('password'), reason: data.get('reason'), label: data.get('label'), target: kind === 'candidate' ? state.target : null, kind } });
      await refreshRecords(); render(); toast(kind === 'snapshot' ? '完整规划快照已保存。' : `${labelTarget(state.target)}本地候选已生成，等待原项目接入。`);
    });
  }
  else if (form.id === 'restore-form') busy(async () => {
    if (state.dirty && !confirm('恢复后将打开新草稿。当前未保存编辑会放弃，确定继续？')) return;
    const result = await api(`/api/versions/${encodeURIComponent(form.dataset.id)}/restore`, { method: 'POST', body: { name: data.get('name'), password: data.get('password'), reason: data.get('reason') } });
    state.bootstrap = await api('/api/bootstrap'); await loadDraft((result.draft || result).id); closeModal(); render(); toast('已恢复为新草稿，尚未生成候选或部署。');
  });
  else if (form.id === 'reimport-form') busy(async () => {
    await saveDraft({ quiet: true });
    const result = await api(`/api/drafts/${encodeURIComponent(state.draft.id)}/reimport`, { method: 'POST', body: { revision: state.draft.revision, password: data.get('password'), reason: data.get('reason') } });
    state.bootstrap = await api('/api/bootstrap'); await loadDraft((result.draft || result).id); closeModal(); render(); toast('来源已重新导入，草稿改动已保留。');
  });
});

modal.addEventListener('click', event => { if (event.target === modal && (event.offsetX < 0 || event.offsetX > modal.clientWidth || event.offsetY < 0 || event.offsetY > modal.clientHeight)) closeModal(); });
modal.addEventListener('cancel', () => { state.picker = null; });
window.addEventListener('beforeunload', event => { if (state.dirty) { event.preventDefault(); event.returnValue = ''; } });
window.addEventListener('keydown', event => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's' && state.session?.authenticated) {
    event.preventDefault(); busy(async () => { await saveDraft(); render(); });
  }
});
initialize().catch(error => { app.innerHTML = `<main class="initial-loading"><h2>暂时无法打开工作室</h2><p>${esc(error.message)}</p><button data-action="retry">重试</button></main>`; });





