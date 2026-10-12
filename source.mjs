import {createHash} from 'node:crypto';
import {readFileSync, realpathSync, lstatSync} from 'node:fs';
import {join, resolve, relative, sep} from 'node:path';
import {planMobileAssets} from '../jigsaw-nook-taptap/scripts/package-mobile-assets.mjs';
import {checkImageLibrary as checkMobileImageLibrary} from '../jigsaw-nook-taptap/scripts/check-image-library.mjs';
import {checkImageLibrary as checkPcImageLibrary} from '../puzzle-play/scripts/check-image-library.mjs';
import {readPendingAssets, pendingPreviewFile} from './pending.mjs';

export const TARGETS = ['pc', 'mobile-shared'];
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const clone = value => structuredClone(value);
const error = (message, status = 400) => Object.assign(new Error(message), {status});
const styles = [
  {id: 'paper-collage', name: '纸艺'}, {id: 'anime', name: '二次元'},
  {id: 'realistic', name: '写实'}, {id: 'painted', name: '厚涂'},
  {id: 'flat', name: '平涂'}, {id: 'other', name: '其他'},
];

function inside(root, file) {
  const part = relative(root, file);
  return part !== '' && !part.startsWith('..' + sep) && part !== '..' && !resolve(part).startsWith('\\\\') && !/^[A-Za-z]:/.test(part);
}

// The compatibility workspace junction is resolved before checking child paths.
// No child symlink or junction may redirect content/preview reads outside it.
function safeFile(root, path) {
  const file = resolve(root, path);
  if (!inside(root, file)) throw error('文件路径超出已登记项目目录。');
  let cursor = root;
  for (const part of relative(root, file).split(sep)) {
    cursor = join(cursor, part);
    if (lstatSync(cursor).isSymbolicLink()) throw error('素材路径包含符号链接，拒绝读取。');
  }
  const real = realpathSync(file);
  if (!inside(root, real) || !lstatSync(real).isFile()) throw error('素材必须是项目目录内的普通文件。');
  return real;
}

function targetConfig(photo) {
  return {status: photo.status, galleryVisible: photo.galleryVisible !== false,
    dailyOnly: photo.dailyOnly === true, category: photo.category};
}

function countTarget(catalog) {
  return {total: catalog.length, published: catalog.filter(p => p.status === 'published').length,
    archived: catalog.filter(p => p.status === 'archived').length,
    gallery: catalog.filter(p => p.status === 'published' && p.galleryVisible !== false).length,
    dailyOnly: catalog.filter(p => p.status === 'published' && p.dailyOnly === true).length};
}

function pcSeries(text) {
  const match = /export\s+const\s+PUZZLE_SERIES\s*=\s*(\[[\s\S]*?\]);/.exec(text);
  if (!match) throw error('PC 画册定义无法安全解析，需更新只读适配器。', 409);
  const entries = [...match[1].matchAll(/\{\s*id\s*:\s*'([^']+)'\s*,\s*zh\s*:\s*'([^']+)'\s*,\s*en\s*:\s*'([^']+)'\s*,\s*pictures\s*:\s*\[([^\]]*)\]\s*\}/g)];
  const result = entries.map(([, id, zh, en, list]) => {
    const pictures = [...list.matchAll(/'([a-z0-9-]+)'/g)].map(m => m[1]);
    if (!pictures.length || list.replace(/'[a-z0-9-]+'/g, '').replace(/[\s,]/g, ''))
      throw error('PC 画册图片定义无法安全解析。', 409);
    return {id, zh, en, pictures};
  });
  if (!result.length || result.length !== (match[1].match(/\bid\s*:/g) ?? []).length)
    throw error('PC 画册定义存在未知结构，不能静默忽略。', 409);
  return result;
}

/** Only source facts and source pointers are imported; nothing is written. */
export function readSource(projectRoot = resolve(import.meta.dirname, '..')) {
  const root = realpathSync(projectRoot);
  const roots = {pc: realpathSync(join(root, 'puzzle-play')), 'mobile-shared': realpathSync(join(root, 'jigsaw-nook-taptap'))};
  const inputs = [];
  const read = (target, path, parse = true) => {
    const bytes = readFileSync(safeFile(roots[target], path));
    inputs.push({path: target + '/' + path, sha256: hash(bytes)});
    return parse ? JSON.parse(bytes.toString('utf8')) : bytes.toString('utf8');
  };
  const catalogs = Object.fromEntries(TARGETS.map(target => [target, read(target, 'content/puzzle-catalog.json')]));
  const guidance = Object.fromEntries(TARGETS.map(target => [target, read(target, 'content/puzzle-guidance.json')]));
  const records = {pc: {}, 'mobile-shared': {}};
  for (const target of TARGETS) {
    const seen = new Set();
    if (!Array.isArray(catalogs[target])) throw error('素材目录不是数组。', 409);
    for (const photo of catalogs[target]) {
      if (!/^[a-z0-9-]+$/.test(photo.id) || seen.has(photo.id)) throw error('素材目录存在非法或重复 ID。', 409);
      if (!['published', 'archived'].includes(photo.status)) throw error('来源目录包含未知保留状态。', 409);
      seen.add(photo.id);
      const record = read(target, 'content/image-provenance/' + photo.id + '.json');
      if (record.id !== photo.id || record.origin !== photo.origin || !Number.isSafeInteger(record.width) || record.width <= 0 || !Number.isSafeInteger(record.height) || record.height <= 0)
        throw error('来源记录身份或尺寸不符：' + photo.id, 409);
      records[target][photo.id] = record;
    }
  }
  const mobileCatalog = catalogs['mobile-shared'];
  if (Object.keys(records.pc).length !== mobileCatalog.length || mobileCatalog.some(photo => !records.pc[photo.id]))
    throw error('两项目素材 ID 清单不一致，需要人工合并后重新导入。', 409);
  for (const photo of mobileCatalog) {
    const a = records.pc[photo.id], b = records['mobile-shared'][photo.id];
    if (JSON.stringify(a) !== JSON.stringify(b)) throw error('两项目来源、审核或交付记录不一致：' + photo.id, 409);
    const pcPhoto = catalogs.pc.find(p => p.id === photo.id);
    for (const key of ['origin', 'src', 'playSrc', 'thumbSrc', 'optimizedSrc', 'standardSrc'])
      if (pcPhoto[key] !== photo[key]) throw error('同 ID 的两端素材引用不一致：' + photo.id, 409);
  }
  const collection = read('mobile-shared', 'lib/mobile-collection-catalog.json');
  const journeyText = read('pc', 'lib/puzzle-journey.ts', false);
  const series = pcSeries(journeyText);
  const manifests = {};
  for (const target of TARGETS) {
    for (const path of ['lib/puzzle-catalog.ts', 'lib/daily-puzzle.ts', 'scripts/check-image-library.mjs', 'scripts/image-origin.mjs']) read(target, path, false);
  }
  for (const path of ['server/mobile-collection.mjs', 'scripts/package-mobile-assets.mjs']) read('mobile-shared', path, false);
  manifests['mobile-shared'] = read('mobile-shared', 'h5/asset-manifest.json');
  const pcById = new Map(catalogs.pc.map(photo => [photo.id, photo]));
  const assets = mobileCatalog.map(photo => {
    const record = records['mobile-shared'][photo.id];
    const delivery = Object.fromEntries(Object.entries(record.delivery ?? {}).filter(([, item]) => item && typeof item === 'object' && item.format === 'webp').map(([kind, item]) => [kind, {width: item.width, height: item.height, bytes: item.bytes, sha256: item.sha256, format: 'webp', lossless: item.lossless}]));
    const generation = record.generation;
    return {id: photo.id, title: photo.title, subtitle: photo.subtitle ?? '', category: photo.category, lifecycle: 'retained',
      origin: photo.origin, reviewStatus: record.review?.status ?? 'unknown', width: record.width,
      height: record.height, direction: record.width > record.height ? 'landscape' : record.width < record.height ? 'portrait' : 'square',
      publishedAt: photo.publishedAt ?? null, review: clone(record.review ?? {}),
      sourceDescription: record.source?.description ?? (generation ? `${generation.provider ?? '项目'}生成素材${generation.generatedDate ? '，生成于 ' + generation.generatedDate : ''}。${record.resolutionNote ?? ''}` : record.resolutionNote ?? '来源记录已登记。'),
      rightsStatement: record.rights?.statement ?? (record.commercialUse?.basis === 'provider-output-terms' ? '依生成服务商输出条款记录；未保证独占权。' : '请查看来源记录的授权依据。'),
      delivery, targets: {pc: targetConfig(pcById.get(photo.id)), 'mobile-shared': targetConfig(photo)}};
  });
  const pending = readPendingAssets(root), historicalIds = new Set(assets.map(asset => asset.id));
  if (pending.fingerprint) inputs.push({path: 'content-admin/work/pending-assets/registry.json', sha256: pending.fingerprint});
  for (const record of pending.assets) {
    if (historicalIds.has(record.id)) throw error('待整理素材与历史图片 ID 冲突：' + record.id, 409);
    if (record.styleGroupId !== null && !styles.some(style => style.id === record.styleGroupId)) throw error('待整理素材引用未登记画风：' + record.id, 409);
    const target = {status: 'draft', galleryVisible: false, dailyOnly: false, category: 'illustration'};
    const native = record.generation.native;
    const resolutionNote = record.export.isUpscaled
      ? `原始生成 ${native.width}×${native.height}；保存为 ${record.source.width}×${record.source.height} 的放大成品。放大尺寸不代表新增原生细节。`
      : `原始生成 ${native.width}×${native.height}；按保存原件尺寸 ${record.source.width}×${record.source.height} 登记。`;
    const delivery = Object.fromEntries(['thumbnail', 'play', 'optimized'].map(kind => {
      const item = record.delivery[kind];
      return [kind, {width: item.width, height: item.height, bytes: item.bytes, sha256: item.sha256, format: 'webp', lossless: item.lossless}];
    }));
    assets.push({id: record.id, title: record.title, subtitle: record.subtitle, category: 'illustration', lifecycle: 'pending',
      origin: record.origin, reviewStatus: record.review.status, width: record.source.width, height: record.source.height,
      direction: record.source.width > record.source.height ? 'landscape' : record.source.width < record.source.height ? 'portrait' : 'square',
      publishedAt: null, review: clone(record.review), nativeResolution: {width: native.width, height: native.height}, resolutionNote,
      sourceThreadId: record.generation.threadId, sourceDescription: '由用户指定生成会话导入后台待整理素材。' + resolutionNote,
      rightsStatement: '用户已授权本次导入和整理，生成来源与风格参考记录已保留。',
      styleGroupId: record.styleGroupId, subjectTags: [...record.subjectTags], delivery,
      targets: {pc: clone(target), 'mobile-shared': clone(target)}});
  }
  const mobilePacks = collection.packs.map(pack => ({id: pack.id, title: pack.title, description: pack.description,
    imageIds: [...pack.imageIds], coverImageId: pack.imageIds[0], status: 'published', styleGroupId: null,
    price: pack.price, decorationId: pack.decorationId ?? null}));
  const mobileAlbums = mobilePacks.map(pack => ({id: pack.id, title: pack.title, description: pack.description,
    imageIds: [...pack.imageIds], packId: pack.id, styleGroupId: null,
    milestones: collection.milestones.map(m => ({target: m.target, coins: m.coins, decorationId: m.albumDecoration ? pack.decorationId : null}))}));
  const paid = new Set(mobilePacks.flatMap(p => p.imageIds));
  mobileAlbums.push({id: 'everyday-gallery', title: '日常拾光', description: '在自由图库里遇见的每一幅画，也值得收藏。',
    imageIds: mobileCatalog.filter(photo => photo.status === 'published' && photo.galleryVisible !== false && !paid.has(photo.id)).map(photo => photo.id),
    packId: null, styleGroupId: null, milestones: []});
  const pcPacks = series.map(item => ({id: item.id, title: item.zh, description: '', imageIds: [...item.pictures],
    coverImageId: item.pictures[0], status: 'published', styleGroupId: null, price: null, decorationId: null}));
  const baseline = {name: '初始内容草稿', styles: clone(styles),
    assets: Object.fromEntries(assets.map(asset => [asset.id, {title: asset.title, subtitle: asset.subtitle,
      styleGroupId: asset.lifecycle === 'pending' ? asset.styleGroupId : null, subjectTags: asset.lifecycle === 'pending' ? [...asset.subjectTags] : [], targets: clone(asset.targets)}])),
    targets: {pc: {packs: pcPacks, albums: pcPacks.map(pack => ({id: pack.id, title: pack.title, description: '', imageIds: [...pack.imageIds], packId: pack.id, styleGroupId: null, milestones: []}))},
      'mobile-shared': {packs: mobilePacks, albums: mobileAlbums}}};
  const targetStats = Object.fromEntries(TARGETS.map(target => [target, countTarget(catalogs[target])]));
  const stats = {...targetStats['mobile-shared'], total: assets.length, retained: mobileCatalog.length, pending: pending.assets.length, directions: {landscape: 0, portrait: 0, square: 0}, origins: {},
    targets: targetStats, mobilePacks: mobilePacks.length, mobileAlbums: mobileAlbums.length, pcPacks: pcPacks.length};
  for (const asset of assets) {stats.directions[asset.direction]++; stats.origins[asset.origin] = (stats.origins[asset.origin] ?? 0) + 1;}
  const fingerprint = hash(JSON.stringify(inputs.sort((a, b) => a.path.localeCompare(b.path))));
  const source = {fingerprint, assets, stats, baseline};
  // Keep original paths/records out of accidental JSON responses and version blobs.
  Object.defineProperty(source, '_private', {value: {root, roots, catalogs, records, guidance, collection, series, journeyText, manifests, inputs, pending}, enumerable: false});
  return source;
}

/** ID + kind only. A request can never become an arbitrary filesystem path. */
export function previewFile(source, id, kind = 'thumbnail') {
  if (!['thumbnail', 'preview'].includes(kind)) throw error('不支持的图片预览类型。');
  if (typeof id !== 'string' || !/^[a-z0-9-]+$/.test(id)) throw error('非法图片 ID。');
  const data = source._private;
  if (data.pending?.byId.has(id)) return pendingPreviewFile(data.pending, id, kind);
  const photo = data.catalogs['mobile-shared'].find(item => item.id === id);
  if (!photo) throw error('图片未登记。', 404);
  const deliveryKind = kind === 'thumbnail' ? 'thumbnail' : photo.optimizedSrc ? 'optimized' : 'play';
  const url = kind === 'thumbnail' ? photo.thumbSrc : photo.optimizedSrc ?? photo.playSrc;
  const expected = data.records['mobile-shared'][id].delivery?.[deliveryKind];
  if (typeof url !== 'string' || !new RegExp('^/puzzles/' + id + '-' + deliveryKind + '(?:-[a-f0-9]{12})?\\.webp$').test(url) || expected?.src !== url)
    throw error('预览只允许已登记的 WebP 衍生文件。');
  let file;
  try {file = safeFile(data.roots['mobile-shared'], 'public' + url);}
  catch (cause) {if (cause.code === 'ENOENT') throw error('已登记的预览资源缺失，请重新检查交付素材。', 404); throw cause;}
  const puzzles = realpathSync(join(data.roots['mobile-shared'], 'public/puzzles'));
  if (!inside(puzzles, file)) throw error('预览路径逃逸素材目录。');
  return file;
}

/** Reuses the existing review/manifest/hash pipeline; no package files are made. */
export async function verifyDelivery(source) {
  const data = source._private;
  const [mobileReview, pcReview] = await Promise.all([
    checkMobileImageLibrary(data.roots['mobile-shared']), checkPcImageLibrary(data.roots.pc),
  ]);
  const plan = planMobileAssets(data.roots['mobile-shared']);
  if (plan.photos.length !== source.assets.filter(asset => asset.lifecycle !== 'pending').length) throw error('公开分发清单未保留全部历史图片。', 409);
  const latestPending = readPendingAssets(data.root);
  if (latestPending.fingerprint !== data.pending?.fingerprint) throw error('待整理素材登记在校验期间已变化，请重新同步。', 409);
  const pcFiles = [];
  for (const asset of plan.assets) {
    const file = safeFile(data.roots.pc, 'public/' + asset.path), bytes = readFileSync(file);
    if (bytes.length !== asset.bytes || hash(bytes) !== asset.sha256) throw error('PC 交付文件与已审核记录不一致：' + asset.url, 409);
    pcFiles.push(asset.url);
  }
  for (const photo of data.catalogs['mobile-shared']) {
    const record = data.records['mobile-shared'][photo.id];
    if (record.delivery?.sourceSha256 !== record.sha256) throw error('衍生物未关联当前来源 SHA：' + photo.id, 409);
    const guide = data.guidance['mobile-shared'][photo.id];
    // Ten retained legacy works use the game's existing default guidance. A
    // missing optional hint must not invalidate their otherwise reviewed assets.
    if (guide && (guide.width !== record.width || guide.height !== record.height)) throw error('图片引导尺寸与来源不一致：' + photo.id, 409);
    const pcGuide = data.guidance.pc[photo.id];
    if (JSON.stringify(pcGuide) !== JSON.stringify(guide)) throw error('两目标图片引导不一致：' + photo.id, 409);
  }
  return {fileCount: plan.assets.length, totalBytes: plan.assets.reduce((sum, item) => sum + item.bytes, 0),
    publishedImages: plan.photos.filter(photo => photo.status === 'published').length,
    archivedImages: plan.photos.filter(photo => photo.status === 'archived').length,
    pcVerifiedFiles: pcFiles.length, pendingVerifiedImages: latestPending.assets.length, pipeline: 'scripts/check-image-library.mjs + scripts/package-mobile-assets.mjs#planMobileAssets + private pending registry validation',
    reviews: {pc: pcReview, 'mobile-shared': mobileReview},
    files: plan.assets.map(({source: _source, ...item}) => item)};
}
