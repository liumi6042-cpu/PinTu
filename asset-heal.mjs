// Heal artwork deliveries at submit time.
//
// Pictures can arrive without going through the import tab: another tool may
// generate them, write a catalogue entry and drop files in place, with its own
// encoder settings. Whatever produced them, the two runtimes need exactly
//
//   optimized  Q70, total pixels at most 6,553,600 (or the native size when smaller)
//   thumbnail  Q82, 384 box
//
// so this module re-encodes anything that does not match, straight from the
// original PNG, and rewrites both catalogues, the provenance records and the
// artwork registry together. Running it when nothing is wrong is cheap: it only
// reads headers.
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {copyFileSync, existsSync, readFileSync, statSync, writeFileSync} from 'node:fs';
import {basename, join, resolve} from 'node:path';
import {deliveryDimensions, MAX_DELIVERY_PIXELS} from './delivery-spec.mjs';

const REQUIRE_FROM = 'D:/chat/拼图/jigsaw-nook-taptap/package.json';
export const DELIVERY_SPEC = {maxPixels: MAX_DELIVERY_PIXELS, quality: 70, thumbBox: 384, thumbQuality: 82, effort: 6};

const sha = bytes => createHash('sha256').update(bytes).digest('hex');

function sharpModule() {
  try {
    return createRequire(REQUIRE_FROM)('sharp');
  } catch {
    throw Object.assign(new Error('本机缺少 sharp，无法在提交前压缩图片。'), {code: 'SHARP_MISSING', status: 503});
  }
}

/** Read a WebP's frame size and whether it is lossy, from its bytes. */
function webpFacts(bytes) {
  if (bytes.length < 20 || bytes.toString('ascii', 0, 4) !== 'RIFF' || bytes.toString('ascii', 8, 12) !== 'WEBP') return null;
  let offset = 12, frame = null, lossless = null;
  while (offset + 8 <= bytes.length) {
    const kind = bytes.toString('ascii', offset, offset + 4);
    const length = bytes.readUInt32LE(offset + 4);
    const start = offset + 8;
    if (start + length > bytes.length) return null;
    if (kind === 'VP8L') {
      const bits = bytes.readUInt32LE(start + 1);
      frame = {width: 1 + (bits & 0x3fff), height: 1 + ((bits >>> 14) & 0x3fff)};
      lossless = true;
    } else if (kind === 'VP8 ') {
      frame = {width: bytes.readUInt16LE(start + 6) & 0x3fff, height: bytes.readUInt16LE(start + 8) & 0x3fff};
      lossless = false;
    }
    offset = start + length + (length % 2);
  }
  return frame && lossless !== null ? {...frame, lossless} : null;
}

/** Why a catalogue photo's delivery is not acceptable, or null when it is fine. */
function inspect(root, photo) {
  const problems = [];
  if (typeof photo.optimizedSrc !== 'string' || !photo.optimizedSrc.startsWith('/puzzles/')) problems.push('缺少压缩图引用');
  if (typeof photo.thumbSrc !== 'string' || !photo.thumbSrc.startsWith('/puzzles/')) problems.push('缺少缩略图引用');
  if (photo.standardSrc || photo.optimizedStandardSrc) problems.push('含已停用的小图字段');
  if (problems.length) return problems;

  const recordFile = join(root, 'content/image-provenance/' + photo.id + '.json');
  if (!existsSync(recordFile)) return ['缺少来源记录'];
  let record;
  try { record = JSON.parse(readFileSync(recordFile, 'utf8')); } catch { return ['来源记录无法读取']; }
  const optimized = record.delivery?.optimized;
  const thumbnail = record.delivery?.thumbnail;
  if (!optimized || !thumbnail) return ['来源记录缺少交付信息'];
  if (optimized.quality !== DELIVERY_SPEC.quality || optimized.lossless !== false) problems.push('压缩参数不符');
  if (record.delivery.compact || record.delivery.play) problems.push('来源记录含旧规格');

  for (const [kind, url, entry] of [['optimized', photo.optimizedSrc, optimized], ['thumbnail', photo.thumbSrc, thumbnail]]) {
    if (entry.src !== url) problems.push(kind + ' 引用与来源记录不一致');
    const file = join(root, 'public', url.slice(1));
    if (!existsSync(file)) { problems.push(kind + ' 文件缺失'); continue; }
    const bytes = readFileSync(file);
    const facts = webpFacts(bytes);
    if (!facts) { problems.push(kind + ' 不是有效 WebP'); continue; }
    if (facts.lossless !== false) problems.push(kind + ' 必须是有损 WebP');
    if (facts.width !== entry.width || facts.height !== entry.height) problems.push(kind + ' 尺寸与记录不一致');
    if (kind === 'optimized') {
      if (facts.width > record.width || facts.height > record.height) problems.push('压缩图被放大');
      // The delivery must use the full pixel budget, not merely stay under it:
      // a smaller file throws away detail the budget already allows.
      const budget = deliveryDimensions(record.width, record.height, DELIVERY_SPEC.maxPixels);
      if (facts.width !== budget.width || facts.height !== budget.height) {
        problems.push(facts.width * facts.height > DELIVERY_SPEC.maxPixels
          ? '压缩图超过总像素上限'
          : '压缩图小于像素预算，浪费了可用的清晰度');
      }
    } else if (facts.width > 384 || facts.height > 384 || facts.width > record.width || facts.height > record.height) {
      problems.push('缩略图超出尺寸预算');
    }
  }
  return problems.length ? [...new Set(problems)] : null;
}

/** Write the same catalogue/provenance/registry content to every tree that has it. */
function writeAll(file, text) {
  for (const target of file) {
    if (!existsSync(target)) continue;
    if (readFileSync(target, 'utf8') !== text) writeFileSync(target, text);
  }
}

/**
 * @returns {{checked:number, healed:Array<{id:string,problems:string[]}>, skipped:Array<{id:string,reason:string}>}}
 */
export async function healDeliveries({projectRoot = 'D:/chat/拼图'} = {}) {
  const project = resolve(projectRoot);
  const web = join(project, 'work/dual-managed-release-20261014');
  const mobile = join(project, 'jigsaw-nook-taptap');
  const registryPath = join(project, 'content-admin/work/pending-assets/registry.json');
  // The admin compares the retired PC baseline (puzzle-play) with the mobile
  // project, and the build reads the Web worktree. All three have to carry the
  // same catalogue and provenance, so every write goes to all of them.
  const pcBaseline = join(project, 'puzzle-play');
  const trees = [web, mobile, pcBaseline].filter(tree => existsSync(join(tree, 'content/puzzle-catalog.json')));

  const cataloguePath = join(web, 'content/puzzle-catalog.json');
  const catalogue = JSON.parse(readFileSync(cataloguePath, 'utf8'));
  if (!Array.isArray(catalogue)) throw new Error('图库不是数组');
  const revisionsPath = join(web, 'content/artwork-revisions.json');
  const revisions = existsSync(revisionsPath) ? JSON.parse(readFileSync(revisionsPath, 'utf8')) : null;
  const registry = existsSync(registryPath) ? JSON.parse(readFileSync(registryPath, 'utf8')) : null;
  const registryById = new Map((registry?.assets ?? []).map(asset => [asset.id, asset]));

  // Any tree can lag behind; the union tells us what the delivery has to be.
  const problemsById = new Map();
  for (const photo of catalogue) {
    const problems = inspect(web, photo);
    if (problems) problemsById.set(photo.id, problems);
  }
  if (!problemsById.size) return {checked: catalogue.length, healed: [], skipped: []};

  const sharp = sharpModule();
  const healed = [], skipped = [];
  for (const photo of catalogue) {
    const problems = problemsById.get(photo.id);
    if (!problems) continue;

    const originalName = photo.id + '.png';
    const original = [join(web, 'public/puzzles', originalName), join(mobile, 'public/puzzles', originalName)]
      .find(candidate => existsSync(candidate));
    if (!original) { skipped.push({id: photo.id, reason: '找不到原图 ' + originalName + '，无法重新压缩'}); continue; }

    const recordFile = join(web, 'content/image-provenance/' + photo.id + '.json');
    const record = existsSync(recordFile) ? JSON.parse(readFileSync(recordFile, 'utf8')) : null;
    if (!record) { skipped.push({id: photo.id, reason: '缺少来源记录'}); continue; }

    const encode = async (kind, box, quality) => {
      const pipeline = sharp(original, {failOn: 'error'}).rotate()
        .resize({width: box.width, height: box.height, fit: 'inside', withoutEnlargement: true});
      const buffer = await pipeline.webp({quality, effort: DELIVERY_SPEC.effort, smartSubsample: kind === 'optimized'}).toBuffer();
      const meta = await sharp(buffer).metadata();
      return {buffer, width: meta.width, height: meta.height, digest: sha(buffer)};
    };

    let optimized, thumbnail;
    try {
      optimized = await encode('optimized', deliveryDimensions(record.width, record.height, DELIVERY_SPEC.maxPixels), DELIVERY_SPEC.quality);
      thumbnail = await encode('thumbnail', {width: DELIVERY_SPEC.thumbBox, height: DELIVERY_SPEC.thumbBox}, DELIVERY_SPEC.thumbQuality);
    } catch (error) {
      skipped.push({id: photo.id, reason: '编码失败：' + error.message});
      continue;
    }

    const place = (kind, result, quality, extra) => {
      const name = `${photo.id}-${kind}-${result.digest.slice(0, 12)}.webp`;
      for (const tree of trees) {
        const dir = join(tree, 'public/puzzles');
        if (!existsSync(dir)) continue;
        writeFileSync(join(dir, name), result.buffer);
      }
      return {
        src: '/puzzles/' + name,
        sha256: result.digest,
        bytes: result.buffer.length,
        width: result.width,
        height: result.height,
        format: 'webp',
        lossless: false,
        quality,
        upscaled: false,
        sourceSha256: record.sha256,
        inputSha256: record.sha256,
        ...extra,
      };
    };

    // Older records carry effort/smartSubsample inside `encoding` only; keep that
    // shape instead of introducing a second copy of the same facts.
    const flat = 'effort' in (record.delivery?.optimized ?? {});
    const optimizedEntry = place('optimized', optimized, DELIVERY_SPEC.quality, {
      ...(flat ? {effort: DELIVERY_SPEC.effort, smartSubsample: true} : {}),
      encoding: {library: 'sharp', version: sharp.versions.sharp, effort: DELIVERY_SPEC.effort, smartSubsample: true},
    });
    const thumbnailEntry = place('thumbnail', thumbnail, DELIVERY_SPEC.thumbQuality, {
      encoding: {library: 'sharp', version: sharp.versions.sharp, effort: DELIVERY_SPEC.effort},
    });

    const previous = [photo.playSrc, photo.thumbSrc, photo.optimizedSrc, photo.standardSrc, photo.optimizedStandardSrc].filter(Boolean);
    photo.playSrc = optimizedEntry.src;
    photo.thumbSrc = thumbnailEntry.src;
    photo.optimizedSrc = optimizedEntry.src;
    delete photo.standardSrc;
    delete photo.optimizedStandardSrc;

    // Merge into the existing entries so unrelated recorded facts (for example a
    // downsampled flag) survive untouched and the diff stays about the file.
    record.delivery = {
      sourceSha256: record.sha256,
      optimized: {...record.delivery?.optimized, ...optimizedEntry},
      thumbnail: {...record.delivery?.thumbnail, ...thumbnailEntry},
    };
    delete record.delivery.play;
    delete record.delivery.compact;
    writeAll([recordFile, join(mobile, 'content/image-provenance/' + photo.id + '.json')], JSON.stringify(record, null, 2) + '\n');

    // The base room snapshot points at the catalogue file, so it follows the change.
    const versions = revisions?.versions?.[photo.id];
    if (Array.isArray(versions)) {
      for (const snapshot of versions) {
        if (snapshot.revision !== record.sha256) continue;
        snapshot.src = optimizedEntry.src;
        snapshot.thumbSrc = thumbnailEntry.src;
        snapshot.width = record.width;
        snapshot.height = record.height;
      }
    }
    // The legacy fallback must stay byte-identical to the base snapshot, otherwise
    // the artwork check refuses it; re-point it at the same file.
    const legacy = revisions?.legacy?.[photo.id];
    if (legacy) {
      legacy.revision = record.sha256;
      legacy.src = optimizedEntry.src;
      legacy.thumbSrc = thumbnailEntry.src;
      legacy.width = record.width;
      legacy.height = record.height;
    }

    // The private registry only describes pictures waiting to be imported; an
    // already-published one keeps its original entry, which still points at files
    // that remain on disk.
    void registryById;

    // Files nobody references any more are recorded, not deleted: rooms that were
    // opened before this change still ask for the old names.
    healed.push({id: photo.id, problems, replaced: previous, optimizedBytes: optimizedEntry.bytes});
  }

  const catalogueText = JSON.stringify(catalogue, null, 2) + '\n';
  writeAll(trees.map(tree => join(tree, 'content/puzzle-catalog.json')), catalogueText);
  if (revisions) {
    const text = JSON.stringify(revisions, null, 2) + '\n';
    writeAll(trees.map(tree => join(tree, 'content/artwork-revisions.json')), text);
  }
  return {checked: catalogue.length, healed, skipped};
}
