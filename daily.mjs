import {createHash, randomUUID} from 'node:crypto';
import {existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {isDeepStrictEqual} from 'node:util';
import {problem} from './store.mjs';

const IMAGE_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const DIGEST = /^[a-f0-9]{64}$/;
const DAY = 86_400_000, CHINA_OFFSET = 8 * 60 * 60 * 1000;
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const copy = value => structuredClone(value);
const invalid = message => {throw problem(400, message, 'INVALID_DRAFT');};
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value)
  && [Object.prototype, null].includes(Object.getPrototypeOf(value));

export function validDailyDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  return year >= 1970 && year <= 9999 && new Date(Date.UTC(year, month - 1, day)).toISOString().slice(0, 10) === value;
}
export const beijingDate = (now = Date.now()) => new Date(now + CHINA_OFFSET).toISOString().slice(0, 10);
export const nextBeijingDate = (now = Date.now()) => beijingDate(now + DAY);

const planFields = ['id', 'imageId', 'date', 'albumId'];
export const isAutomaticDailyPlan = plan => plan?.autoPublish === true || plan?.autoDate === true;
const samePlan = (a, b) => planFields.every(field => a[field] === b[field]) && isAutomaticDailyPlan(a) === isAutomaticDailyPlan(b);
function checkPlanFields(plan) {
  if (!plain(plan) || planFields.some(field => !Object.hasOwn(plan, field))
    || Object.keys(plan).some(field => ![...planFields, 'autoDate', 'autoPublish'].includes(field))) invalid('每日首发计划包含缺失或无效字段。');
  for (const field of ['autoDate', 'autoPublish']) if (Object.hasOwn(plan, field) && typeof plan[field] !== 'boolean') invalid('自动发布必须是勾选值。');
  if (Object.hasOwn(plan, 'autoDate') && Object.hasOwn(plan, 'autoPublish') && plan.autoDate !== plan.autoPublish) invalid('自动发布设置不能互相冲突。');
  if (plan.autoPublish === true && plan.date !== null) invalid('自动发布图片不占用日期，请取消自动发布后再指定日期。');
  if (!isAutomaticDailyPlan(plan) && !validDailyDate(plan.date))
    invalid('每日首发日期必须是真实的 YYYY-MM-DD 日期。');
  if (plan.autoDate === true && plan.date !== null && !validDailyDate(plan.date)) invalid('原自动安排日期无效。');
}

// Kept as the server's normalization hook for old callers. Automatic publishing
// now means an undated candidate pool; it never consumes a manual date.
export function resolveAutomaticDailyDates(document, previous = {}, frozenPlans = [], now = Date.now()) {
  const next = copy(document);
  if (!plain(next)) invalid('内容方案必须是对象。');
  if (!Object.hasOwn(next, 'dailyPlans')) return next;
  const plans = next.dailyPlans;
  if (!Array.isArray(plans) || plans.length > Object.keys(next.assets ?? {}).length) invalid('每日首发计划必须是有界数组。');
  for (let index = 0; index < plans.length; index++) if (!Object.hasOwn(plans, index)) invalid('每日首发计划不能包含空洞。');
  for (const plan of plans) checkPlanFields(plan);
  for (const plan of plans) {
    if (isAutomaticDailyPlan(plan)) {plan.date = null; plan.autoPublish = true;}
    delete plan.autoDate;
  }
  return next;
}

export function validateDailyPlans(value, imageIds, albumIds) {
  if (!Array.isArray(value) || value.length > imageIds.size) invalid('每日首发计划必须是有界数组。');
  for (let index = 0; index < value.length; index++) if (!Object.hasOwn(value, index)) invalid('每日首发计划不能包含空洞。');
  const images = new Set(), dates = new Set();
  return value.map(plan => {
    checkPlanFields(plan);
    if (typeof plan.imageId !== 'string' || !IMAGE_ID.test(plan.imageId) || !imageIds.has(plan.imageId) || plan.id !== plan.imageId) invalid('每日首发计划的图片引用无效。');
    if (typeof plan.albumId !== 'string' || !albumIds.has(plan.albumId)) invalid('每日首发计划的预选相册不存在。');
    if (images.has(plan.imageId)) invalid('每张图片只能安排一次每日首发。');
    const automatic = isAutomaticDailyPlan(plan);
    if (!automatic && dates.has(plan.date)) invalid('每天只能安排一张每日首发图片。');
    images.add(plan.imageId); if (!automatic) dates.add(plan.date);
    return {id: plan.imageId, imageId: plan.imageId, date: automatic ? null : plan.date, albumId: plan.albumId,
      ...(automatic ? {autoPublish: true} : Object.hasOwn(plan, 'autoPublish') ? {autoPublish: false} : {})};
  });
}

// Runtime and CMS use the same canonical digest; no private source records are
// copied into this deliberately small public bridge.
export function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, stableValue(value[key])]));
  return value;
}
export const configurationDigest = configuration => {
  const {configDigest: _digest, ...publicContent} = configuration;
  return createHash('sha256').update(JSON.stringify(stableValue(publicContent))).digest('hex');
};

export function dailyReadiness(document, source, sourceNeedsMerge = false) {
  const assets = new Map(source.assets.map(asset => [asset.id, asset]));
  const albumIds = new Set(document.albums.map(album => album.id));
  return (document.dailyPlans ?? []).map(plan => {
    const asset = assets.get(plan.imageId);
    const album = document.albums.find(album => album.id === plan.albumId);
    let reason = sourceNeedsMerge ? '来源内容已变化，合并后才能同步每日计划。'
      : !albumIds.has(plan.albumId) ? '预选相册不存在。'
        : !asset || asset.lifecycle !== 'retained' ? '图片尚未接入游戏。' : '';
    return {imageId: plan.imageId, ready: !reason, reason: reason || '可供小游戏读取；实际出场以游戏记录为准。'};
  });
}

export function buildDailyConfiguration(document, source) {
  const readyIds = new Set(dailyReadiness(document, source).filter(item => item.ready).map(item => item.imageId));
  const usableIds = new Set(source.assets.filter(asset => asset.lifecycle === 'retained').map(asset => asset.id));
  const entries = (document.dailyPlans ?? []).filter(plan => readyIds.has(plan.imageId) && !isAutomaticDailyPlan(plan))
    .map(({date, imageId, albumId}) => ({date, imageId, albumId})).sort((a, b) => a.date.localeCompare(b.date));
  const automaticCandidates = (document.dailyPlans ?? []).filter(plan => readyIds.has(plan.imageId) && isAutomaticDailyPlan(plan))
    .map(({imageId, albumId}) => ({imageId, albumId})).sort((a, b) => a.imageId.localeCompare(b.imageId));
  const fallbackImageIds = [...new Set(document.albums.flatMap(album => album.imageIds).filter(id => usableIds.has(id)))].sort();
  const related = new Set([...entries, ...automaticCandidates].map(entry => entry.albumId));
  const fields = ['id', 'title', 'description', 'showOnPc', 'showOnMobile', 'purchasable', 'price', 'decorationId', 'milestones'];
  const albums = document.albums.filter(album => related.has(album.id)).map(album => Object.fromEntries(fields.map(field => [field, copy(album[field])])))
    .sort((a, b) => a.id.localeCompare(b.id));
  const configuration = {schema: 'jigsaw-daily-content/v2', timezone: 'Asia/Shanghai', entries, automaticCandidates, fallbackImageIds, albums};
  return {...configuration, configDigest: configurationDigest(configuration)};
}

function atomicJson(file, value) {
  const temporary = file + '.' + process.pid + '.' + randomUUID() + '.tmp';
  try {writeFileSync(temporary, JSON.stringify(value, null, 2) + '\n', {flag: 'wx'}); renameSync(temporary, file);}
  finally {if (existsSync(temporary)) unlinkSync(temporary);}
}
export function writeDailyConfiguration(bridgeDir, configuration) {
  const snapshots = join(bridgeDir, 'configurations'); mkdirSync(snapshots, {recursive: true});
  const snapshot = join(snapshots, configuration.configDigest + '.json');
  if (!existsSync(snapshot)) atomicJson(snapshot, configuration);
  else {
    const saved = boundedJson(snapshot);
    if (saved.configDigest !== configuration.configDigest || configurationDigest(saved) !== configuration.configDigest) throw problem(409, '每日公开配置快照校验失败', 'DAILY_CONFIGURATION_CHANGED');
  }
  const current = join(bridgeDir, 'configuration.json');
  if (!existsSync(current) || !same(boundedJson(current), configuration)) atomicJson(current, configuration);
  return configuration;
}

function boundedJson(file) {
  const info = lstatSync(file);
  if (info.isSymbolicLink() || !info.isFile() || info.size > 2 * 1024 * 1024) throw problem(400, '每日记录文件类型或大小无效', 'INVALID_DAILY_RECEIPT');
  return JSON.parse(readFileSync(file, 'utf8'));
}

function readConfirmedReceipts(appearanceDir, bridgeDir, source, now) {
  if (!existsSync(appearanceDir)) return [];
  if (lstatSync(appearanceDir).isSymbolicLink()) throw problem(400, '每日出场目录不能使用符号链接', 'INVALID_DAILY_RECEIPT');
  const imageIds = new Set(source.assets.map(asset => asset.id)), facts = [];
  for (const filename of readdirSync(appearanceDir).filter(file => /^\d{4}-\d{2}-\d{2}\.json$/.test(file)).sort()) {
    try {
      const fact = boundedJson(join(appearanceDir, filename));
      const v2 = fact?.schema === 'jigsaw-daily-appearance/v2';
      if (!plain(fact) || ![true, false].includes(fact.planned) || (!v2 && fact.schema !== 'jigsaw-daily-appearance/v1') || fact.target !== 'mobile-shared'
        || filename !== fact.date + '.json' || !validDailyDate(fact.date) || !imageIds.has(fact.imageId)
        || typeof fact.configDigest !== 'string' || !DIGEST.test(fact.configDigest)
        || !Number.isSafeInteger(fact.activatedAt) || fact.activatedAt > now || fact.activatedAt < 0 || beijingDate(fact.activatedAt) !== fact.date) continue;
      const snapshot = boundedJson(join(bridgeDir, 'configurations', fact.configDigest + '.json'));
      if (!['jigsaw-daily-content/v1', 'jigsaw-daily-content/v2'].includes(snapshot.schema) || snapshot.timezone !== 'Asia/Shanghai' || snapshot.configDigest !== fact.configDigest
        || configurationDigest(snapshot) !== fact.configDigest || !Array.isArray(snapshot.entries) || !Array.isArray(snapshot.albums)) continue;
      const sourceKind = v2 ? fact.source : fact.planned ? 'scheduled' : 'library';
      if (!['scheduled', 'automatic', 'library'].includes(sourceKind) || fact.planned !== (sourceKind !== 'library')) continue;
      let plan = null;
      if (sourceKind === 'scheduled') {
        if (!snapshot.entries.some(entry => entry.date === fact.date && entry.imageId === fact.imageId && entry.albumId === fact.albumId)) continue;
        plan = {id: fact.imageId, imageId: fact.imageId, date: fact.date, albumId: fact.albumId};
      } else if (sourceKind === 'automatic') {
        if (snapshot.schema !== 'jigsaw-daily-content/v2' || !Array.isArray(snapshot.automaticCandidates)
          || !snapshot.automaticCandidates.some(entry => entry.imageId === fact.imageId && entry.albumId === fact.albumId)) continue;
        plan = {id: fact.imageId, imageId: fact.imageId, date: null, albumId: fact.albumId, autoPublish: true};
      } else {
        if (fact.albumId !== null) continue;
        if (snapshot.schema === 'jigsaw-daily-content/v2' && (!Array.isArray(snapshot.fallbackImageIds) || !snapshot.fallbackImageIds.includes(fact.imageId))) continue;
        if (snapshot.schema === 'jigsaw-daily-content/v1' && !source.assets.some(asset => asset.id === fact.imageId && asset.lifecycle === 'retained' && asset.targets['mobile-shared'].dailyOnly)) continue;
      }
      if (plan && !snapshot.albums.some(album => album.id === fact.albumId)) continue;
      facts.push({...fact, source: sourceKind, plan});
    } catch {
      // A partial, malformed or untrusted file does not turn a saved plan into
      // an appearance and cannot prevent other valid daily facts being synced.
    }
  }
  return facts;
}

export function assertDailyPlanChanges(previous, document, frozenPlans, now = Date.now(), checkNewDates = true) {
  const plans = document.dailyPlans ?? [];
  for (const locked of frozenPlans) {
    if (!plans.some(plan => samePlan(plan, locked))) throw problem(409, '已实际出场的首发计划不能修改或删除：' + locked.imageId, 'DAILY_PLAN_LOCKED');
  }
  if (checkNewDates) for (const plan of plans) {
    const old = (previous.dailyPlans ?? []).find(item => item.imageId === plan.imageId);
    if (!isAutomaticDailyPlan(plan) && (!old || old.date !== plan.date || isAutomaticDailyPlan(old)) && plan.date < nextBeijingDate(now)) throw problem(400, '新安排的每日首发最早只能从北京时间明天开始。', 'DAILY_PLAN_DATE_PAST');
  }
}

export function createDailyCoordinator({store, getSource, validateDocument, bridgeDir, appearanceDir, now = Date.now}) {
  let syncing = false;
  function status(sourceNeedsMerge = false, document = store.draft(store.activeDraftId()).document) {
    return {appearances: store.dailyAppearances(), enrollments: store.dailyEnrollments(), readiness: dailyReadiness(document, getSource(), sourceNeedsMerge)};
  }
  function sync() {
    if (syncing) return status();
    syncing = true;
    try {
      const source = getSource(), current = store.draft(store.activeDraftId()), at = now();
      if (current.sourceFingerprint !== source.fingerprint) return status(true, current.document);
      const document = validateDocument(current.document, source);
      writeDailyConfiguration(bridgeDir, buildDailyConfiguration(document, source));
      const receipts = readConfirmedReceipts(appearanceDir, bridgeDir, source, at);
      const known = new Map(store.dailyAppearances().map(fact => [fact.target + '/' + fact.date, fact]));
      const incoming = receipts.filter(fact => {
        const old = known.get(fact.target + '/' + fact.date);
        return !old || old.imageId === fact.imageId && old.albumId === fact.albumId;
      });
      // A v1 bridge did not store its automatic flag. Preserve the saved mode
      // when importing that historical fact, while keeping the real day in the receipt.
      for (const fact of incoming) if (fact.plan && fact.schema === 'jigsaw-daily-appearance/v1') {
        const saved = document.dailyPlans.find(plan => plan.imageId === fact.imageId);
        if (isAutomaticDailyPlan(saved) && saved.albumId === fact.albumId) fact.plan = {id: fact.imageId, imageId: fact.imageId, date: null, albumId: fact.albumId, autoPublish: true};
      }
      const lockedByImage = new Map(store.dailyFrozenPlans().map(plan => [plan.imageId, plan]));
      for (const fact of incoming) if (fact.plan && !lockedByImage.has(fact.imageId)) lockedByImage.set(fact.imageId, fact.plan);
      const next = copy(document);
      for (const locked of lockedByImage.values()) {
        const index = next.dailyPlans.findIndex(plan => plan.imageId === locked.imageId);
        const restored = copy(locked);
        if (index < 0) next.dailyPlans.push(restored); else next.dailyPlans[index] = restored;
      }
      const enrollmentIds = new Set(store.dailyEnrollments().map(item => item.imageId)), enrollments = [];
      const firstPlannedDays = new Map();
      for (const fact of [...store.dailyAppearances(), ...incoming].sort((a, b) => a.date.localeCompare(b.date)))
        if (fact.planned !== false && fact.albumId && !firstPlannedDays.has(fact.imageId)) firstPlannedDays.set(fact.imageId, fact.date);
      for (const plan of lockedByImage.values()) {
        const firstAppearanceDate = firstPlannedDays.get(plan.imageId);
        if (!firstAppearanceDate || firstAppearanceDate >= beijingDate(at) || enrollmentIds.has(plan.imageId)) continue;
        const destination = next.albums.find(album => album.id === plan.albumId);
        if (!destination) continue;
        for (const album of next.albums) {
          if (album.id === destination.id || !album.imageIds.includes(plan.imageId)) continue;
          album.imageIds = album.imageIds.filter(imageId => imageId !== plan.imageId);
          if (album.coverImageId === plan.imageId) album.coverImageId = album.imageIds[0] ?? null;
        }
        if (!destination.imageIds.includes(plan.imageId)) destination.imageIds.push(plan.imageId);
        if (destination.coverImageId === null) destination.coverImageId = destination.imageIds[0] ?? null;
        enrollments.push({imageId: plan.imageId, firstAppearanceDate, enrolledAt: at, albumId: plan.albumId});
      }
      const validated = validateDocument(next, source);
      // Reading old rewards gives them stable identities, but daily bookkeeping
      // must not persist that migration over an administrator's saved albums.
      const reconciled = copy(validated);
      for (const album of reconciled.albums) {
        const saved = current.document.albums.find(item => item.id === album.id);
        for (const milestone of album.milestones) {
          const original = saved?.milestones.find(item => item.target === milestone.target);
          if (original && !Object.hasOwn(original, 'id') && milestone.id === 'milestone-' + milestone.target) delete milestone.id;
        }
      }
      if (incoming.length || enrollments.length || !same(document, validated))
        store.reconcileDaily(current.id, current.revision, isDeepStrictEqual(current.document, reconciled) ? current.document : reconciled,
          source.fingerprint, incoming, enrollments, at);
      writeDailyConfiguration(bridgeDir, buildDailyConfiguration(validated, source));
      return status(false, validated);
    } finally {syncing = false;}
  }
  return {sync, status, assertChanges(previous, document, checkNewDates = true) {
    assertDailyPlanChanges(previous, document, store.dailyFrozenPlans(), now(), checkNewDates);
  }, resolveDates(document, previous) {
    return resolveAutomaticDailyDates(document, previous, store.dailyFrozenPlans(), now());
  }};
}
