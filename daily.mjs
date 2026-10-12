import {createHash, randomUUID} from 'node:crypto';
import {existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
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
const samePlan = (a, b) => planFields.every(field => a[field] === b[field]);
function checkPlanFields(plan, allowAutomaticPlaceholder = false) {
  if (!plain(plan) || planFields.some(field => !Object.hasOwn(plan, field))
    || Object.keys(plan).some(field => ![...planFields, 'autoDate'].includes(field))) invalid('每日首发计划包含缺失或无效字段。');
  if (Object.hasOwn(plan, 'autoDate') && typeof plan.autoDate !== 'boolean') invalid('自动安排日期必须是勾选值。');
  if (!(allowAutomaticPlaceholder && plan.autoDate === true && plan.date === null) && !validDailyDate(plan.date))
    invalid('每日首发日期必须是真实的 YYYY-MM-DD 日期。');
}

// Allocation happens before canonical validation, but never changes a saved
// automatic slot. Only newly enabled automatic plans enter the free-date queue.
export function resolveAutomaticDailyDates(document, previous = {}, frozenPlans = [], now = Date.now()) {
  const next = copy(document);
  if (!plain(next)) invalid('内容方案必须是对象。');
  if (!Object.hasOwn(next, 'dailyPlans')) return next;
  const plans = next.dailyPlans;
  if (!Array.isArray(plans) || plans.length > Object.keys(next.assets ?? {}).length) invalid('每日首发计划必须是有界数组。');
  for (let index = 0; index < plans.length; index++) if (!Object.hasOwn(plans, index)) invalid('每日首发计划不能包含空洞。');
  for (const plan of plans) checkPlanFields(plan, true);
  const oldByImage = new Map((previous.dailyPlans ?? []).map(plan => [plan.imageId, plan]));
  const frozenByImage = new Map(frozenPlans.map(plan => [plan.imageId, plan]));
  const pending = [], occupied = new Set(frozenPlans.map(plan => plan.date));
  for (const plan of plans) {
    const old = oldByImage.get(plan.imageId), frozen = frozenByImage.get(plan.imageId);
    if (plan.autoDate === true) {
      if (frozen) {
        if (plan.date !== null && plan.date !== frozen.date) throw problem(409, '已实际出场的首发计划不能修改或删除：' + frozen.imageId, 'DAILY_PLAN_LOCKED');
        plan.date = frozen.date;
      }
      else if (old?.autoDate === true && validDailyDate(old.date)) plan.date = old.date;
      else {pending.push(plan); continue;}
    }
    occupied.add(plan.date);
  }
  let date = nextBeijingDate(now);
  for (const plan of pending) {
    while (occupied.has(date)) date = nextBeijingDate(Date.parse(date + 'T00:00:00+08:00'));
    if (!validDailyDate(date)) invalid('可安排的每日首发日期已超出支持范围。');
    plan.date = date; occupied.add(date);
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
    if (dates.has(plan.date)) invalid('每天只能安排一张每日首发图片。');
    images.add(plan.imageId); dates.add(plan.date);
    return {id: plan.imageId, imageId: plan.imageId, date: plan.date, albumId: plan.albumId,
      ...(Object.hasOwn(plan, 'autoDate') ? {autoDate: plan.autoDate} : {})};
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
  const existingPurchaseIds = new Set((source._private?.collection?.packs ?? []).map(pack => pack.id));
  return (document.dailyPlans ?? []).map(plan => {
    const asset = assets.get(plan.imageId);
    const album = document.albums.find(album => album.id === plan.albumId);
    let reason = sourceNeedsMerge ? '来源内容已变化，合并后才能同步每日计划。'
      : !albumIds.has(plan.albumId) ? '预选相册不存在。'
        : album.purchasable && !existingPurchaseIds.has(album.id) ? '购买相册尚未接入小游戏商店，排期先保留。'
        : !asset || asset.lifecycle !== 'retained' ? '图片尚未接入游戏。'
          : asset.targets['mobile-shared'].status !== 'published' ? '历史图片尚未恢复为可用素材。' : '';
    return {imageId: plan.imageId, ready: !reason, reason: reason || '可供小游戏读取；实际出场以游戏记录为准。'};
  });
}

export function buildDailyConfiguration(document, source) {
  const readyIds = new Set(dailyReadiness(document, source).filter(item => item.ready).map(item => item.imageId));
  const entries = (document.dailyPlans ?? []).filter(plan => readyIds.has(plan.imageId))
    .map(({date, imageId, albumId}) => ({date, imageId, albumId})).sort((a, b) => a.date.localeCompare(b.date));
  const related = new Set(entries.map(entry => entry.albumId));
  const fields = ['id', 'title', 'description', 'showOnPc', 'showOnMobile', 'purchasable', 'price', 'decorationId', 'milestones'];
  const albums = document.albums.filter(album => related.has(album.id)).map(album => Object.fromEntries(fields.map(field => [field, copy(album[field])])))
    .sort((a, b) => a.id.localeCompare(b.id));
  const configuration = {schema: 'jigsaw-daily-content/v1', timezone: 'Asia/Shanghai', entries, albums};
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
      if (!plain(fact) || fact.planned !== true || fact.schema !== 'jigsaw-daily-appearance/v1' || fact.target !== 'mobile-shared'
        || filename !== fact.date + '.json' || !validDailyDate(fact.date) || !imageIds.has(fact.imageId)
        || typeof fact.configDigest !== 'string' || !DIGEST.test(fact.configDigest)
        || !Number.isSafeInteger(fact.activatedAt) || fact.activatedAt > now || fact.activatedAt < 0 || beijingDate(fact.activatedAt) !== fact.date) continue;
      const snapshot = boundedJson(join(bridgeDir, 'configurations', fact.configDigest + '.json'));
      if (snapshot.schema !== 'jigsaw-daily-content/v1' || snapshot.timezone !== 'Asia/Shanghai' || snapshot.configDigest !== fact.configDigest
        || configurationDigest(snapshot) !== fact.configDigest || !Array.isArray(snapshot.entries) || !Array.isArray(snapshot.albums)) continue;
      const plan = snapshot.entries.find(entry => entry.date === fact.date && entry.imageId === fact.imageId && entry.albumId === fact.albumId);
      if (!plan || !snapshot.albums.some(album => album.id === fact.albumId)) continue;
      facts.push({...fact, plan: {id: fact.imageId, imageId: fact.imageId, date: fact.date, albumId: fact.albumId}});
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
    if ((!old || old.date !== plan.date) && plan.date < nextBeijingDate(now)) throw problem(400, '新安排的每日首发最早只能从北京时间明天开始。', 'DAILY_PLAN_DATE_PAST');
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
      const lockedByImage = new Map();
      for (const plan of [...store.dailyFrozenPlans(), ...incoming.map(fact => fact.plan)].sort((a, b) => a.date.localeCompare(b.date)))
        if (!lockedByImage.has(plan.imageId)) lockedByImage.set(plan.imageId, plan);
      const next = copy(document);
      for (const locked of lockedByImage.values()) {
        const index = next.dailyPlans.findIndex(plan => plan.imageId === locked.imageId);
        const current = index < 0 ? locked : next.dailyPlans[index];
        const restored = {...copy(locked), ...(Object.hasOwn(current, 'autoDate') ? {autoDate: current.autoDate} : {})};
        if (index < 0) next.dailyPlans.push(restored); else next.dailyPlans[index] = restored;
      }
      const enrollmentIds = new Set(store.dailyEnrollments().map(item => item.imageId)), enrollments = [];
      for (const plan of lockedByImage.values()) {
        if (plan.date >= beijingDate(at) || enrollmentIds.has(plan.imageId)) continue;
        const destination = next.albums.find(album => album.id === plan.albumId);
        if (!destination) continue;
        for (const album of next.albums) {
          if (album.id === destination.id || !album.imageIds.includes(plan.imageId)) continue;
          album.imageIds = album.imageIds.filter(imageId => imageId !== plan.imageId);
          if (album.coverImageId === plan.imageId) album.coverImageId = album.imageIds[0] ?? null;
        }
        if (!destination.imageIds.includes(plan.imageId)) destination.imageIds.push(plan.imageId);
        if (destination.coverImageId === null) destination.coverImageId = destination.imageIds[0] ?? null;
        enrollments.push({imageId: plan.imageId, firstAppearanceDate: plan.date, enrolledAt: at, albumId: plan.albumId});
      }
      const validated = validateDocument(next, source);
      if (incoming.length || enrollments.length || !same(document, validated))
        store.reconcileDaily(current.id, current.revision, validated, source.fingerprint, incoming, enrollments, at);
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
