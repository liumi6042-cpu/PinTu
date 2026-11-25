import {TARGETS} from './source.mjs';
import {normalizeDraft, toLegacyDraft, buildAlbumConfiguration, effectiveImageVisibility, plannedImageVisibility, albumDisplayedOn} from './album-model.mjs';
import {validateDailyPlans} from './daily.mjs';
export {normalizeDraft, buildAlbumConfiguration, effectiveImageVisibility, plannedImageVisibility} from './album-model.mjs';

const clone = value => structuredClone(value);
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const fail = message => {throw Object.assign(new Error(message), {status: 400, code: 'INVALID_DRAFT'});};
const idPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const forbidden = new Set(['__proto__', 'prototype', 'constructor']);

function object(value, label, allowed, optional = []) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail(label + '必须是对象。');
  const keys = Object.keys(value);
  if (keys.some(key => forbidden.has(key) || !allowed.includes(key))) fail(label + '包含不允许的字段。');
  if (allowed.some(key => !optional.includes(key) && !Object.hasOwn(value, key))) fail(label + '缺少必填字段。');
  return value;
}
function text(value, label, maximum, allowEmpty = false) {
  if (typeof value !== 'string' || value.length > maximum || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) fail(label + '长度或类型不合法。');
  value = value.trim();
  if (!allowEmpty && !value) fail(label + '不能为空。');
  return value;
}
function id(value, label) {
  const result = text(value, label, 96);
  if (!idPattern.test(result)) fail(label + '必须使用小写字母、数字和连字符。');
  return result;
}
function integer(value, label, minimum = 0) {
  if (!Number.isSafeInteger(value) || value < minimum) fail(label + '必须是安全的非负整数。');
  return value;
}
function bool(value, label) {if (typeof value !== 'boolean') fail(label + '必须是布尔值。'); return value;}
function list(value, label, maximum = 500) {
  if (!Array.isArray(value) || value.length > maximum) fail(label + '必须是有界数组。');
  for (let index = 0; index < value.length; index++) if (!Object.hasOwn(value, index)) fail(label + '不能包含空洞。');
  return value;
}
function enumValue(value, label, allowed) {if (!allowed.includes(value)) fail(label + '包含未知值。'); return value;}
function styleRef(value, available, label) {if (value === null) return null; value = id(value, label); if (!available.has(value)) fail(label + '未登记。'); return value;}
function decoration(value, available, label) {if (value === null) return null; value = id(value, label); if (!available.has(value)) fail(label + '未登记。'); return value;}

/** Planning drafts may contain breaking reorganizations. Structural errors may not. */
function validateLegacyDraft(document, source) {
  object(document, '草稿', ['name', 'styles', 'assets', 'targets']);
  const styles = list(document.styles, '画风分组', 100).map((item, index) => {
    object(item, '画风分组 ' + index, ['id', 'name']);
    return {id: id(item.id, '画风 ID'), name: text(item.name, '画风名称', 60)};
  });
  const styleIds = new Set(styles.map(item => item.id));
  if (styleIds.size !== styles.length) fail('画风 ID 不能重复。');
  const sourceIds = new Set(source.assets.map(asset => asset.id));
  object(document.assets, '素材配置', [...sourceIds]);
  const assets = {};
  for (const image of source.assets) {
    const item = object(document.assets[image.id], '素材 ' + image.id, ['title', 'subtitle', 'styleGroupId', 'subjectTags', 'targets', 'deleted'], ['deleted']);
    object(item.targets, '素材目标', TARGETS);
    const tags = list(item.subjectTags, '题材标签', 30).map(tag => text(tag, '题材标签', 60));
    const targets = {};
    for (const target of TARGETS) {
      const config = object(item.targets[target], '素材目标 ' + target, ['status', 'galleryVisible', 'dailyOnly', 'category']);
      targets[target] = {status: enumValue(config.status, '素材状态', ['published', 'archived', 'draft']),
        galleryVisible: bool(config.galleryVisible, '图库可见'), dailyOnly: bool(config.dailyOnly, '每日专用'),
        category: text(config.category, '原分类', 80)};
    }
    assets[image.id] = {title: text(item.title, '图片标题', 180), subtitle: text(item.subtitle, '图片副标题', 800, true),
      styleGroupId: styleRef(item.styleGroupId, styleIds, '画风引用'), subjectTags: [...new Set(tags)], targets,
      ...(Object.hasOwn(item, 'deleted') ? {deleted: bool(item.deleted, '图片回收站状态')} : {})};
  }
  const imageIds = (value, label) => {
    const result = list(value, label, sourceIds.size).map(value => id(value, '图片引用'));
    if (new Set(result).size !== result.length) fail(label + '不能重复。');
    if (result.some(value => !sourceIds.has(value))) fail(label + '引用未登记图片。');
    return result;
  };
  const decorations = new Set(source._private.collection.decorations.map(item => item.id));
  object(document.targets, '内容目标', TARGETS);
  const targets = {};
  for (const target of TARGETS) {
    const config = object(document.targets[target], '目标 ' + target, ['packs', 'albums']);
    const packs = list(config.packs, '图包', 200).map(item => {
      object(item, '图包', ['id', 'title', 'description', 'imageIds', 'coverImageId', 'status', 'styleGroupId', 'price', 'decorationId']);
      const images = imageIds(item.imageIds, '图包图片');
      const cover = item.coverImageId === null && !images.length ? null : id(item.coverImageId, '图包封面');
      if (images.length && !images.includes(cover)) fail('图包封面必须属于该图包。');
      return {id: id(item.id, '图包 ID'), title: text(item.title, '图包标题', 180), description: text(item.description, '图包说明', 1500, true),
        imageIds: images, coverImageId: cover, status: enumValue(item.status, '图包状态', ['published', 'archived', 'draft']),
        styleGroupId: styleRef(item.styleGroupId, styleIds, '图包画风'),
        price: item.price === null && target === 'pc' ? null : integer(item.price, '图包金币价格'),
        decorationId: decoration(item.decorationId, decorations, '图包奖励装饰')};
    });
    const packIds = new Set(packs.map(item => item.id));
    if (packIds.size !== packs.length) fail('同目标图包 ID 不能重复。');
    const albums = list(config.albums, '图鉴', 300).map(item => {
      object(item, '图鉴', ['id', 'title', 'description', 'imageIds', 'packId', 'styleGroupId', 'milestones']);
      const images = imageIds(item.imageIds, '图鉴图片');
      const packId = item.packId === null ? null : id(item.packId, '图鉴关联图包');
      if (packId !== null && !packIds.has(packId)) fail('图鉴关联的图包不存在。');
      const milestones = list(item.milestones, '图鉴里程碑', 100).map(milestone => {
        object(milestone, '里程碑', ['id', 'target', 'coins', 'decorationId'], ['id']);
        if (Object.hasOwn(milestone, 'id')) id(milestone.id, '里程碑 ID');
        const target = integer(milestone.target, '里程碑目标', 1);
        return {target, coins: integer(milestone.coins, '里程碑金币'), decorationId: decoration(milestone.decorationId, decorations, '里程碑装饰')};
      });
      if (new Set(milestones.map(item => item.target)).size !== milestones.length) fail('图鉴里程碑目标不能重复。');
      return {id: id(item.id, '图鉴 ID'), title: text(item.title, '图鉴标题', 180), description: text(item.description, '图鉴说明', 1500, true),
        imageIds: images, packId, styleGroupId: styleRef(item.styleGroupId, styleIds, '图鉴画风'), milestones};
    });
    if (new Set(albums.map(item => item.id)).size !== albums.length) fail('同目标图鉴 ID 不能重复。');
    targets[target] = {packs, albums};
  }
  return {name: text(document.name, '草稿名称', 100), styles, assets, targets};
}

function dailyPool(document, source, target) {
  const ids = source._private.catalogs[target].filter(photo => document.assets[photo.id].targets[target].status === 'published').map(photo => photo.id);
  const daily = ids.filter(id => document.assets[id].targets[target].dailyOnly);
  return daily.length ? daily : ids;
}

/** Every requested change is retained in the diff; blockers are per target. */
function analyzeLegacyDraft(input, source) {
  const document = validateLegacyDraft(input, source), before = source.baseline;
  const changes = [], blockers = [], warnings = [];
  const issue = (into, target, code, id, message) => {
    if (!into.some(item => item.target === target && item.code === code && item.id === id)) into.push({target, code, id, message});
  };
  const block = (target, code, id, message) => issue(blockers, target, code, id, message);
  const warn = (target, code, id, message) => issue(warnings, target, code, id, message);
  const change = (target, entityType, id, field, a, b) => {if (!equal(a, b)) changes.push({target, entityType, id, field, before: a ?? null, after: b ?? null});};
  change('shared', 'draft', 'draft', 'name', before.name, document.name);
  const compareEntities = (target, entityType, original, next) => {
    const ids = new Set([...original.map(item => item.id), ...next.map(item => item.id)]);
    for (const id of ids) {
      const a = original.find(item => item.id === id), b = next.find(item => item.id === id);
      if (!a || !b) change(target, entityType, id, a ? 'removed' : 'added', a, b);
      else for (const field of Object.keys(a)) if (field !== 'id') change(target, entityType, id, field, a[field], b[field]);
    }
  };
  compareEntities('shared', 'style', before.styles, document.styles);
  for (const asset of source.assets) {
    const a = before.assets[asset.id], b = document.assets[asset.id];
    for (const field of ['title', 'subtitle', 'styleGroupId', 'subjectTags', 'deleted']) change('shared', 'asset', asset.id, field, a[field], b[field]);
    if (asset.lifecycle !== 'pending' && (a.title !== b.title || a.subtitle !== b.subtitle)) for (const target of TARGETS) block(target, 'LOCALE_ADAPTER_REQUIRED', asset.id,
      '图片标题或副标题修改需要同步现有中英文展示映射；草稿可保存，首期候选先阻断该目标。');
    for (const target of TARGETS) {
      const old = a.targets[target], next = b.targets[target];
      for (const field of Object.keys(old)) change(target, 'asset', asset.id, field, old[field], next[field]);
      if (asset.lifecycle === 'pending') {
        if (next.status !== 'draft' || next.galleryVisible || next.dailyOnly) block(target, 'NEW_ASSET_RUNTIME_IMPORT_REQUIRED', asset.id,
          '新素材目前仅在后台待整理。需要完成目标目录、尺寸引导、语言及交付接入后才能进入游戏更新文件；请保留待整理状态。');
        continue;
      }
      if (old.category !== next.category) block(target, 'EXISTING_CATEGORY_CHANGED', asset.id, '旧分类参与成就与历史内容判断；请使用新画风分组和题材标签。');
      if (old.dailyOnly !== next.dailyOnly) block(target, 'DAILY_ONLY_CHANGED', asset.id, '每日专用标记需保持历史选图规则，首期不可改变。');
      if (next.status === 'draft') block(target, 'HISTORY_RETENTION_REQUIRED', asset.id, '历史图片只能保留上架或归档；草稿状态会移出旧房间可恢复清单。');
      if (old.status !== next.status || old.galleryVisible !== next.galleryVisible) warn(target, 'VISIBILITY_CHANGE', asset.id, '此修改会改变该目标的新游戏或图库入口，旧 ID 和交付资源仍保留。');
      if (next.status === 'published' && asset.reviewStatus !== 'reviewed') block(target, 'UNREVIEWED_IMAGE', asset.id, '未完成来源审核的图片不能进入运行候选。');
    }
  }
  for (const target of TARGETS) {
    const pendingIds = new Set(source.assets.filter(asset => asset.lifecycle === 'pending').map(asset => asset.id));
    for (const entity of [...document.targets[target].packs, ...document.targets[target].albums]) {
      for (const id of entity.imageIds) if (pendingIds.has(id)) block(target, 'NEW_ASSET_RUNTIME_IMPORT_REQUIRED', id,
        '图包或图鉴引用后台待整理素材（' + entity.id + '）；新素材完成游戏目录、尺寸引导、语言及交付接入前只能保留为规划。');
    }
    if (!equal(dailyPool(before, source, target), dailyPool(document, source, target))) block(target, 'DAILY_ROTATION_CHANGED', 'daily-puzzle', '本次变更改变每日图片轮转顺序或成员，将影响历史日章；需单独兼容方案。');
    compareEntities(target, 'pack', before.targets[target].packs, document.targets[target].packs);
    compareEntities(target, 'album', before.targets[target].albums, document.targets[target].albums);
    const oldPackOrder = before.targets[target].packs.map(item => item.id), nextPackOrder = document.targets[target].packs.map(item => item.id);
    const oldAlbumOrder = before.targets[target].albums.map(item => item.id), nextAlbumOrder = document.targets[target].albums.map(item => item.id);
    change(target, 'target', target, 'packOrder', oldPackOrder, nextPackOrder);
    change(target, 'target', target, 'albumOrder', oldAlbumOrder, nextAlbumOrder);
  }
  const mobile = document.targets['mobile-shared'], oldMobile = before.targets['mobile-shared'];
  const mobileTarget = 'mobile-shared';
  const originalPaid = new Set(oldMobile.packs.flatMap(pack => pack.imageIds));
  for (const old of oldMobile.packs) {
    const next = mobile.packs.find(pack => pack.id === old.id);
    if (!next) {block(mobileTarget, 'MOBILE_PACK_REMOVED', old.id, '旧图包 ID 被玩家购买记录引用，删除需权益快照和迁移方案。'); continue;}
    if (!equal([...old.imageIds].sort(), [...next.imageIds].sort())) block(mobileTarget, 'MOBILE_PACK_MEMBERS_CHANGED', old.id, '旧图包成员集合变化会改变已购权益和图鉴总数，需权益快照和迁移方案。');
    if (old.price !== next.price) block(mobileTarget, 'MOBILE_PACK_PRICE_CHANGED', old.id, '现有图包价格修改需明确内容与权益方案；首期仅保存规划。');
    if (old.decorationId !== next.decorationId) block(mobileTarget, 'MOBILE_PACK_DECORATION_CHANGED', old.id, '旧图包装饰承诺与历史奖励键必须保留。');
    if (old.coverImageId !== next.coverImageId) block(mobileTarget, 'MOBILE_COVER_ADAPTER_REQUIRED', old.id, '独立封面配置需要小游戏运行时适配；不能通过偷偷重排第一张图片生效。');
    if (next.status !== 'published') block(mobileTarget, 'MOBILE_PACK_STATUS_ADAPTER_REQUIRED', old.id, '当前运行时未实现图包上下架过滤；草稿状态需适配后才能生效。');
  }
  for (const pack of mobile.packs) {
    if (!oldMobile.packs.some(old => old.id === pack.id)) {
      block(mobileTarget, 'MOBILE_NEW_PACK_ADAPTER_REQUIRED', pack.id, '新图包需明确免费/收费归属、镜像图鉴及独立奖励版本后接入运行时。');
      if (pack.price > 0 && pack.imageIds.some(id => !originalPaid.has(id))) block(mobileTarget, 'FREE_IMAGE_BECOMES_PAID', pack.id, '新收费图包包含原免费素材，会收窄原有选图权限；需权益方案。');
    }
    if (pack.coverImageId !== pack.imageIds[0]) block(mobileTarget, 'MOBILE_COVER_ADAPTER_REQUIRED', pack.id, '当前小游戏封面固定取首张图片；独立封面需运行时适配。');
    for (const id of pack.imageIds) {
      const config = document.assets[id].targets[mobileTarget];
      if (config.status !== 'published' || !config.galleryVisible || config.dailyOnly) block(mobileTarget, 'MOBILE_PACK_IMAGE_UNAVAILABLE', id, '被小游戏图包引用的图片必须属于该目标普通在架图库：' + pack.id + '。');
    }
  }
  for (const old of oldMobile.albums) {
    const next = mobile.albums.find(album => album.id === old.id);
    if (!next) {block(mobileTarget, 'MOBILE_ALBUM_REMOVED', old.id, '历史图鉴 ID 和奖励键被玩家进度引用，删除需要迁移方案。'); continue;}
    for (const field of ['imageIds', 'milestones', 'packId']) if (!equal(old[field], next[field])) block(mobileTarget, field === 'milestones' ? 'MOBILE_ALBUM_REWARDS_CHANGED' : 'MOBILE_ALBUM_MEMBERS_CHANGED', old.id,
      field === 'milestones' ? '里程碑目标、金币或装饰变化会影响历史去重和承诺，需奖励版本及迁移。' : '现有图鉴成员、顺序或来源关系改变需独立图鉴运行时与进度兼容方案。');
  }
  for (const album of mobile.albums) {
    if (!oldMobile.albums.some(old => old.id === album.id)) block(mobileTarget, 'MOBILE_ALBUM_ADAPTER_REQUIRED', album.id, '当前图鉴由图包和免费图库推导；新增独立图鉴需要运行时适配。');
    if (album.packId) {
      const pack = mobile.packs.find(item => item.id === album.packId);
      const expectedMilestones = source._private.collection.milestones.map(item => ({target: item.target, coins: item.coins, decorationId: item.albumDecoration ? pack.decorationId : null}));
      if (album.id !== pack.id || !equal(album.imageIds, pack.imageIds) || album.title !== pack.title || album.description !== pack.description || !equal(album.milestones, expectedMilestones))
        block(mobileTarget, 'MOBILE_ALBUM_MIRROR_ADAPTER_REQUIRED', album.id, '当前图鉴镜像图包标题、说明、顺序和共用奖励；独立配置需要运行时适配。');
    } else if (album.id === 'everyday-gallery') {
      const paid = new Set(mobile.packs.flatMap(item => item.imageIds));
      const expectedImages = source._private.catalogs[mobileTarget].filter(photo => {
        const config = document.assets[photo.id].targets[mobileTarget];
        return config.status === 'published' && config.galleryVisible && !paid.has(photo.id);
      }).map(photo => photo.id);
      const original = oldMobile.albums.find(item => item.id === album.id);
      if (!equal(expectedImages, album.imageIds) || album.title !== original.title || album.description !== original.description || album.milestones.length)
        block(mobileTarget, 'MOBILE_FREE_ALBUM_ADAPTER_REQUIRED', album.id, '日常图鉴当前由普通免费图库动态生成；独立成员、名称或奖励需运行时适配。');
      if (!equal(expectedImages, original.imageIds)) block(mobileTarget, 'MOBILE_FREE_ALBUM_MEMBERS_CHANGED', album.id, '素材可见性或图包归属会间接改变旧免费图鉴成员，需进度兼容方案。');
    } else block(mobileTarget, 'MOBILE_ALBUM_ADAPTER_REQUIRED', album.id, '未关联图包的独立图鉴需要运行时适配。');
  }
  const albumOrder = mobile.albums.map(item => item.id);
  const derivedAlbumOrder = [...mobile.packs.map(item => item.id), 'everyday-gallery'];
  if (!equal(oldMobile.albums.map(item => item.id), albumOrder) || !equal(derivedAlbumOrder, albumOrder))
    block(mobileTarget, 'MOBILE_ALBUM_ORDER_ADAPTER_REQUIRED', 'albums', '当前图鉴顺序由图包顺序加日常组推导，独立排序需要运行时适配。');
  const pc = document.targets.pc, oldPc = before.targets.pc;
  for (const entity of ['packs', 'albums']) {
    const oldIds = oldPc[entity].map(item => item.id), nextIds = pc[entity].map(item => item.id);
    if (!equal(oldIds, nextIds)) block('pc', 'PC_THEME_ADAPTER_REQUIRED', entity, 'PC 主题仍由 TypeScript 常量读取；新增、删除或排序需配置适配。');
    for (const item of pc[entity]) {
      const old = oldPc[entity].find(candidate => candidate.id === item.id);
      if (!old || Object.keys(item).some(field => field !== 'styleGroupId' && !equal(old[field], item[field]))) block('pc', 'PC_THEME_ADAPTER_REQUIRED', item.id, 'PC 画册内容或展示规则变化需要配置及中英文适配；规划配置不会自动进入游戏。');
    }
  }
  const metadataChanges = changes.some(item => item.target === 'shared' && ['style', 'asset'].includes(item.entityType) && ['styleGroupId', 'subjectTags', 'name', 'added', 'removed'].includes(item.field)) || changes.some(item => item.field === 'styleGroupId');
  if (metadataChanges) for (const target of TARGETS) warn(target, 'MANAGEMENT_METADATA_ONLY', 'styles-and-tags', '画风和题材将写入管理侧边文件；游戏展示这些新分组仍需后续接入。');
  return {changes, blockers, warnings, compatibleTargets: TARGETS.filter(target => !blockers.some(item => item.target === target))};
}

function publicProvenance(source, target) {
  return source._private.catalogs[target].map(photo => {
    const record = source._private.records[target][photo.id];
    const delivery = Object.fromEntries(Object.entries(record.delivery ?? {}).filter(([, item]) => item && typeof item === 'object' && item.format === 'webp').map(([kind, item]) => [kind, {src: item.src, width: item.width, height: item.height, bytes: item.bytes, sha256: item.sha256, format: item.format}]));
    return {id: record.id, origin: record.origin, width: record.width, height: record.height, sourceSha256: record.sha256, reviewStatus: record.review?.status ?? 'unknown', delivery};
  });
}

/** Candidate output is inert: caller stores it in a private immutable version. */
function buildLegacyCandidate(input, source, target) {
  if (!TARGETS.includes(target)) throw Object.assign(new Error('未知内容目标。'), {status: 400});
  const document = validateLegacyDraft(input, source), analysis = analyzeLegacyDraft(document, source);
  if (!analysis.compatibleTargets.includes(target)) throw Object.assign(new Error('该目标存在兼容阻断，不能生成运行候选。'), {status: 409, code: 'CANDIDATE_BLOCKED', blockers: analysis.blockers.filter(item => item.target === target)});
  const catalog = source._private.catalogs[target].map(original => {
    const entry = clone(original), asset = document.assets[entry.id], config = asset.targets[target];
    entry.title = asset.title;
    if (asset.subtitle !== (original.subtitle ?? '')) entry.subtitle = asset.subtitle;
    entry.status = config.status; entry.category = config.category;
    if (config.galleryVisible !== (original.galleryVisible !== false)) entry.galleryVisible = config.galleryVisible;
    if (config.dailyOnly !== (original.dailyOnly === true)) entry.dailyOnly = config.dailyOnly;
    return entry;
  });
  const files = [];
  const json = (path, value) => files.push({path, content: JSON.stringify(value, null, 2) + '\n'});
  json('content/puzzle-catalog.json', catalog);
  json('content/puzzle-guidance.json', source._private.guidance[target]);
  json('content/content-admin-metadata.json', {schema: 'jigsaw-content-metadata/v1', sourceFingerprint: source.fingerprint,
    scope: 'Management style groups and subject tags; game display adapter is not installed automatically.',
    styles: document.styles, assets: Object.fromEntries(source.assets.filter(asset => asset.lifecycle !== 'pending').map(asset => [asset.id, {styleGroupId: document.assets[asset.id].styleGroupId, subjectTags: document.assets[asset.id].subjectTags}])),
    packs: Object.fromEntries(document.targets[target].packs.map(pack => [pack.id, {styleGroupId: pack.styleGroupId}])),
    albums: Object.fromEntries(document.targets[target].albums.map(album => [album.id, {styleGroupId: album.styleGroupId}]))});
  json('content/reviewed-delivery-summary.json', {schema: 'jigsaw-reviewed-delivery/v1', sourceFingerprint: source.fingerprint, assets: publicProvenance(source, target)});
  if (target === 'mobile-shared') {
    const collection = clone(source._private.collection);
    collection.packs = document.targets[target].packs.map(pack => {
      const old = collection.packs.find(item => item.id === pack.id);
      return {...old, title: pack.title, description: pack.description, price: pack.price, imageIds: [...pack.imageIds], decorationId: pack.decorationId};
    });
    json('lib/mobile-collection-catalog.json', collection);
  } else {
    json('content/pc-albums.planning.json', {schema: 'jigsaw-pc-albums-planning/v1', requiresRuntimeAdapter: true,
      message: 'This JSON is a planning reference. Existing lib/puzzle-journey.ts remains the active runtime configuration.',
      packs: document.targets.pc.packs, albums: document.targets.pc.albums, existingSeries: source._private.series});
  }
  return {files, metadata: {target, sourceFingerprint: source.fingerprint, schema: 'jigsaw-content-candidate/v1',
    mode: 'local-candidate', runtimeApplied: false, requiresDeployment: true, retainedImages: catalog.length,
    changedFields: analysis.changes.filter(item => item.target === target || item.target === 'shared').length,
    warnings: analysis.warnings.filter(item => item.target === target),
    assetPipeline: target === 'mobile-shared' ? 'scripts/package-mobile-assets.mjs (reviewed catalog and manifest)' : 'existing PC image validation and delivery',
    includesOriginalImages: false, includesPlayerData: false}};
}

/** Strict canonical album validation; legacy snapshots are converted in memory. */
function validateAlbumDraft(converted, source, version) {
  object(converted, '内容方案', ['schemaVersion', 'name', 'styles', 'assets', version === 2 ? 'targets' : 'albums', ...(version === 3 ? ['dailyPlans'] : [])], ['dailyPlans']);
  if (converted.schemaVersion !== version) fail('不支持的相册内容版本。');
  // Reuse the bounded metadata and immutable source-ID validation without making
  // a second editable pack/collection representation.
  const metadata = validateLegacyDraft({name: converted.name, styles: converted.styles, assets: converted.assets,
    targets: Object.fromEntries(TARGETS.map(target => [target, {packs: [], albums: []}]))}, source);
  const sourceIds = new Set(source.assets.map(asset => asset.id)), styleIds = new Set(metadata.styles.map(style => style.id));
  const decorations = new Set(source._private.collection.decorations.map(item => item.id));
  const groups = version === 2 ? TARGETS : ['shared'];
  if (version === 2) object(converted.targets, '内容目标', TARGETS);
  const validatedGroups = {};
  for (const target of groups) {
    const targetDocument = version === 2 ? object(converted.targets[target], '相册目标 ' + target, ['albums']) : converted;
    const ownership = new Map();
    const albums = list(targetDocument.albums, '相册', 300).map(item => {
      object(item, '相册', ['id', 'title', 'description', 'imageIds', 'coverImageId', 'styleGroupId', ...(version === 2 ? ['visible'] : ['showOnPc', 'showOnMobile']), 'purchasable', 'price', 'decorationId', 'milestones']);
      const albumId = id(item.id, '相册 ID');
      const images = list(item.imageIds, '相册图片', sourceIds.size).map(value => id(value, '图片引用'));
      if (new Set(images).size !== images.length) fail('同一相册的图片不能重复。');
      for (const imageId of images) {
        if (!sourceIds.has(imageId)) fail('相册引用未登记图片。');
        if (metadata.assets[imageId].deleted) fail('回收站中的图片须先恢复，才能放入相册：' + imageId);
        if (ownership.has(imageId)) fail('图片只能属于一个相册：' + imageId + '（' + ownership.get(imageId) + ' / ' + albumId + '）。');
        ownership.set(imageId, albumId);
      }
      const coverImageId = item.coverImageId === null ? null : id(item.coverImageId, '相册封面');
      if (images.length && !images.includes(coverImageId)) fail('相册封面必须属于相册。');
      if (!images.length && coverImageId !== null) fail('空相册的封面必须为空。');
      const purchasable = bool(item.purchasable, '购买包开关'), price = integer(item.price, '相册金币价格');
      if (purchasable && price < 1) fail('购买包价格至少为 1 金币。');
      if (!purchasable && price !== 0) fail('免费相册价格必须为 0。');
      const milestones = list(item.milestones, '相册奖励', 100).map(milestone => {
        object(milestone, '相册奖励', ['id', 'target', 'coins', 'decorationId'], ['id']);
        const target = integer(milestone.target, '完成图片数', 1);
        if (target > 10000) fail('完成图片数不能超过 10000。');
        const coins = integer(milestone.coins, '奖励金币');
        if (coins > 100000) fail('奖励金币不能超过 100000。');
        // Freeze old target-based reward identities before an administrator edits
        // their thresholds. This conversion only changes the read representation.
        return {id: Object.hasOwn(milestone, 'id') ? id(milestone.id, '相册奖励 ID') : 'milestone-' + target,
          target, coins,
          decorationId: decoration(milestone.decorationId, decorations, '相册奖励装饰')};
      });
      if (new Set(milestones.map(milestone => milestone.target)).size !== milestones.length) fail('相册奖励的完成图片数不能重复。');
      if (new Set(milestones.map(milestone => milestone.id)).size !== milestones.length) fail('同一相册的奖励 ID 不能重复。');
      return {id: albumId, title: text(item.title, '相册名称', 180), description: text(item.description, '相册说明', 1500, true),
        imageIds: images, coverImageId, styleGroupId: styleRef(item.styleGroupId, styleIds, '相册画风'),
        ...(version === 2 ? {visible: bool(item.visible, '相册显示开关')} : {showOnPc: bool(item.showOnPc, 'PC 显示开关'), showOnMobile: bool(item.showOnMobile, '小程序显示开关')}), purchasable, price,
        decorationId: decoration(item.decorationId, decorations, '相册完成装饰'), milestones};
    });
    if (new Set(albums.map(album => album.id)).size !== albums.length) fail('相册 ID 不能重复。');
    validatedGroups[target] = {albums};
  }
  return {schemaVersion: version, name: metadata.name, styles: metadata.styles, assets: metadata.assets,
    ...(version === 2 ? {targets: validatedGroups} : {albums: validatedGroups.shared.albums,
      dailyPlans: validateDailyPlans(Object.hasOwn(converted, 'dailyPlans') ? converted.dailyPlans : [], sourceIds, new Set(validatedGroups.shared.albums.map(album => album.id)))})};
}

export function validateDraft(input, source) {
  const legacy = input?.schemaVersion === undefined;
  const validated = legacy ? validateLegacyDraft(input, source)
    : validateAlbumDraft(clone(input), source, input?.schemaVersion === 2 ? 2 : 3);
  return legacy || validated.schemaVersion === 2
    ? validateAlbumDraft(normalizeDraft(validated, source), source, 3) : validated;
}

function legacySource(source) {
  const view = {...source, baseline: source._private.legacyBaseline};
  Object.defineProperty(view, '_private', {value: source._private});
  return view;
}

/** Album planning is always savable; unsafe game changes remain explicit. */
export function analyzeDraft(input, source) {
  const document = validateDraft(input, source), before = validateDraft(source.baseline, source);
  const legacy = analyzeLegacyDraft(toLegacyDraft(document, source), legacySource(source));
  const changes = [], blockers = [...legacy.blockers], warnings = [...legacy.warnings];
  const change = (target, entityType, id, field, a, b) => {
    if (!equal(a, b)) changes.push({target, entityType, id, field, before: a ?? null, after: b ?? null});
  };
  const issue = (items, target, code, id, message) => {
    if (!items.some(item => item.target === target && item.code === code && item.id === id)) items.push({target, code, id, message});
  };
  const block = (target, code, id, message) => issue(blockers, target, code, id, message);
  const warn = (target, code, id, message) => issue(warnings, target, code, id, message);
  const entities = (target, type, original, next) => {
    for (const id of new Set([...original.map(item => item.id), ...next.map(item => item.id)])) {
      const a = original.find(item => item.id === id), b = next.find(item => item.id === id);
      if (!a || !b) change(target, type, id, a ? 'removed' : 'added', a, b);
      else for (const field of Object.keys(a)) if (field !== 'id') change(target, type, id, field, a[field], b[field]);
    }
  };
  change('shared', 'draft', 'draft', 'name', before.name, document.name);
  entities('shared', 'style', before.styles, document.styles);
  for (const asset of source.assets) {
    const a = before.assets[asset.id], b = document.assets[asset.id];
    for (const field of ['title', 'subtitle', 'styleGroupId', 'subjectTags', 'deleted']) change('shared', 'asset', asset.id, field, a[field], b[field]);
    for (const target of TARGETS) for (const field of Object.keys(a.targets[target])) change(target, 'asset', asset.id, field, a.targets[target][field], b.targets[target][field]);
  }
  entities('shared', 'album', before.albums, document.albums);
  entities('shared', 'daily-plan', before.dailyPlans, document.dailyPlans);
  if (document.dailyPlans.length) for (const target of TARGETS) block(target, 'DAILY_PLAN_RUNTIME_ADAPTER_REQUIRED', 'daily-plans',
    '每日首发计划已保存；需要已发布游戏读取排期并记录实际出场，次日才能自动收录。');
  change('shared', 'albums', 'albums', 'albumOrder', before.albums.map(album => album.id), document.albums.map(album => album.id));
  block('pc', 'SHARED_ALBUM_RUNTIME_ADAPTER_REQUIRED', 'shared-albums',
    '共享相册已统一保存；PC 仍使用原画册及选图规则，需要接入共享相册、购买和历史进度规则后才能生成游戏更新文件。');
  for (const target of TARGETS) {
    const original = before.albums, next = document.albums;
    const originallyPaid = new Set(original.filter(album => album.purchasable).flatMap(album => album.imageIds));
    if (!equal(original.map(album => album.id), next.map(album => album.id))) block(target, 'ALBUM_RUNTIME_ADAPTER_REQUIRED', 'album-order', '相册新增、删除或排序已保存在管理方案中；现有游戏需要相册配置接入后才能使用。');
    const sourceById = new Map(source.assets.map(asset => [asset.id, asset]));
    for (const album of next) {
      const old = original.find(item => item.id === album.id);
      const otherDisplayField = target === 'pc' ? 'showOnMobile' : 'showOnPc';
      if (!old || Object.keys(album).some(field => !['id', 'styleGroupId', otherDisplayField].includes(field) && !equal(old[field], album[field])))
        block(target, 'ALBUM_RUNTIME_ADAPTER_REQUIRED', album.id, '相册成员、显隐、购买设置或展示内容已保存为规划；需要游戏读取统一相册配置后生效。');
      if (album.purchasable && album.imageIds.some(imageId => !originallyPaid.has(imageId) && sourceById.get(imageId).lifecycle !== 'pending'))
        block(target, 'FREE_IMAGE_BECOMES_PAID', album.id, '购买相册包含原免费图片，规划已保留；游戏接入前需要保证玩家原有选图权益。');
      if (album.milestones.some(milestone => milestone.target > album.imageIds.length)) block(target, 'ALBUM_REWARDS_REQUIRE_ADAPTER', album.id,
        '相册成员少于旧奖励要求，奖励配置已保留；需明确历史奖励兼容后接入游戏。');
      for (const imageId of album.imageIds) {
        const asset = sourceById.get(imageId);
        if (asset.lifecycle === 'pending') block(target, 'NEW_ASSET_RUNTIME_IMPORT_REQUIRED', imageId, '图片已分配到相册；新图需要完成游戏素材接入后才能在玩家端使用。');
        if (albumDisplayedOn(album, target) && asset.lifecycle !== 'pending' && asset.targets[target].status === 'archived') block(target, 'ALBUM_ARCHIVED_IMAGE_ADAPTER_REQUIRED', imageId,
          '历史归档图片已分配到可见相册；重新接入游戏时需要审核上架记录与历史资源兼容。');
        if (albumDisplayedOn(album, target) && asset.targets[target].dailyOnly) warn(target, 'DAILY_IMAGE_HAS_SEPARATE_ENTRY', imageId, '这张图片保留现有每日拼图入口；普通相册接入需要单独处理每日规则。');
      }
    }
    for (const album of original) if (!next.some(item => item.id === album.id)) block(target, 'ALBUM_HISTORY_ID_REQUIRED', album.id,
      '已有相册 ID 关联历史进度与奖励；隐藏可保留记录，删除接入游戏需要迁移方案。');
  }
  return {changes, blockers, warnings, compatibleTargets: TARGETS.filter(target => !blockers.some(item => item.target === target))};
}

/** Canonical albums accompany legacy files only when the latter remain safe. */
export function buildCandidate(input, source, target) {
  if (!TARGETS.includes(target)) throw Object.assign(new Error('未知内容目标。'), {status: 400});
  const document = validateDraft(input, source), analysis = analyzeDraft(document, source);
  if (!analysis.compatibleTargets.includes(target)) throw Object.assign(new Error('该目标需要游戏相册或素材接入，不能生成现有游戏更新文件。'),
    {status: 409, code: 'CANDIDATE_BLOCKED', blockers: analysis.blockers.filter(item => item.target === target)});
  const candidate = buildLegacyCandidate(toLegacyDraft(document, source), legacySource(source), target);
  const configuration = buildAlbumConfiguration(document, source, target);
  candidate.files.push({path: 'content/content-albums.json', content: JSON.stringify({...configuration,
    effectiveGalleryImageIds: [...effectiveImageVisibility(document, source, target)], requiresRuntimeAdapter: true}, null, 2) + '\n'});
  const metadataFile = candidate.files.find(file => file.path === 'content/content-admin-metadata.json');
  const metadata = JSON.parse(metadataFile.content);
  metadata.schema = 'jigsaw-content-metadata/v3'; delete metadata.packs;
  metadata.albums = Object.fromEntries(document.albums.map(album => [album.id, {styleGroupId: album.styleGroupId, showOnPc: album.showOnPc, showOnMobile: album.showOnMobile}]));
  metadataFile.content = JSON.stringify(metadata, null, 2) + '\n';
  candidate.metadata.schema = 'jigsaw-content-candidate/v3';
  candidate.metadata.albumConfiguration = 'content/content-albums.json';
  candidate.metadata.albumRuntimeApplied = false;
  candidate.metadata.changedFields = analysis.changes.filter(item => item.target === target || item.target === 'shared').length;
  return candidate;
}
