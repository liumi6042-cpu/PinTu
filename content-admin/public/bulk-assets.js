const TARGETS = ['pc', 'mobile-shared'];
const ACTIONS = ['archive', 'restore', 'hide', 'show'];
const STATUSES = ['published', 'archived', 'draft'];
const TARGET_NAMES = {pc: 'PC 网页', 'mobile-shared': '共享小游戏'};

const fail = message => {
  throw Object.assign(new Error(message), {status: 400, code: 'INVALID_BULK_ASSET_ACTION'});
};
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);

function selection(document, ids, target, action) {
  if (!TARGETS.includes(target)) fail('请选择 PC 网页或共享小游戏作为管理目标。');
  if (!ACTIONS.includes(action)) fail('不支持该素材批量操作。');
  if (!isObject(document) || !isObject(document.assets)) fail('当前素材草稿不可用。');
  if (!Array.isArray(ids) && !(ids instanceof Set)) fail('请选择需要管理的素材。');
  const selected = [...ids];
  if (!selected.length) fail('请至少选择一张素材。');
  for (const id of selected) {
    if (typeof id !== 'string' || !Object.hasOwn(document.assets, id)) fail('素材 ID 未登记：' + String(id));
    const asset = document.assets[id];
    if (!isObject(asset) || !isObject(asset.targets) || !Object.hasOwn(asset.targets, target)) fail('素材缺少当前目标配置：' + id);
    const config = asset.targets[target];
    if (!isObject(config) || !STATUSES.includes(config.status) || typeof config.galleryVisible !== 'boolean' || typeof config.dailyOnly !== 'boolean') fail('素材目标配置不合法：' + id);
  }
  return [...new Set(selected)];
}

function warningsFor(document, ids, target, action) {
  const warnings = [];
  if (action === 'archive') {
    warnings.push('归档只停用当前目标的素材，不删除图片原件或历史图片 ID；旧房间仍保留图片引用。');
  } else if (action === 'restore') {
    warnings.push('恢复会将当前目标的素材设为在架，保留原有图库显示设置及每日专用语义。');
  } else if (action === 'hide') {
    warnings.push('从图库隐藏只修改当前目标的图库显示设置，保留图片原件、历史图片 ID 和旧房间引用。');
  } else {
    warnings.push('显示到图库只修改当前目标的图库显示设置；归档素材仍需恢复后才会在图库出现。');
  }
  const chosen = new Set(ids);
  const content = document.targets?.[target];
  const related = [];
  for (const [key, label] of [['packs', '图包'], ['albums', '图鉴']]) {
    const entries = Array.isArray(content?.[key]) ? content[key] : [];
    const references = entries.filter(item => isObject(item) && (
      (Array.isArray(item.imageIds) && item.imageIds.some(id => chosen.has(id))) || chosen.has(item.coverImageId)
    )).map(item => String(item.id));
    if (references.length) related.push(label + '：' + [...new Set(references)].join('、'));
  }
  if (related.length) {
    warnings.push('选中素材有关联引用（' + related.join('；') + '）。本次不改图包成员、价格、玩家权益或图鉴进度，准备游戏更新文件前需通过服务端兼容检查。');
  }
  const daily = ids.filter(id => document.assets[id].targets[target].dailyOnly);
  if (daily.length) {
    warnings.push('选中每日专用素材：' + daily.join('、') + '。本次保留每日专用语义；状态或图库可见性变更可能被服务端兼容检查阻断。');
  }
  warnings.push('本次仅修改 ' + TARGET_NAMES[target] + ' 的当前草稿，另一端内容不变；保存草稿和准备更新文件都不会自动更新游戏。');
  return warnings;
}

/** Return a reviewable plan without changing the draft or its source facts. */
export function planBulkAssets(document, ids, target, action) {
  const selected = selection(document, ids, target, action);
  const changes = [];
  for (const id of selected) {
    const asset = document.assets[id];
    const config = asset.targets[target];
    const before = {status: config.status, galleryVisible: config.galleryVisible};
    const after = {...before};
    if (action === 'archive') after.status = 'archived';
    else if (action === 'restore') after.status = 'published';
    else after.galleryVisible = action === 'show';
    if (before.status !== after.status || before.galleryVisible !== after.galleryVisible) {
      changes.push({id, title: typeof asset.title === 'string' && asset.title ? asset.title : id, before, after});
    }
  }
  return {ids: selected, target, action, changes, unchangedCount: selected.length - changes.length,
    warnings: warningsFor(document, selected, target, action)};
}

/** Apply the validated plan only to existing fields in the current target. */
export function applyBulkAssets(document, ids, target, action) {
  const plan = planBulkAssets(document, ids, target, action);
  for (const change of plan.changes) {
    const config = document.assets[change.id].targets[target];
    if (action === 'archive' || action === 'restore') config.status = change.after.status;
    else config.galleryVisible = change.after.galleryVisible;
  }
  return plan;
}

