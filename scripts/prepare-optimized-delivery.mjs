// Offline delivery encoding. Does not resize, replace originals, remove old assets,
// generate imagery, access the network, or run on the production request path.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const catalogPath = path.join(root, 'content/puzzle-catalog.json');
const originalCatalogText = await fs.readFile(catalogPath, 'utf8');
const catalog = JSON.parse(originalCatalogText);
const fullLimit = 2 * 1024 * 1024;
const compactLimit = 700 * 1024;
const hdIds = new Set([
  'mountain-lake-reflection-hd-v3',
  'morning-meadow-tree-hd-v3',
  'clear-sand-bay-hd-v3',
]);
sharp.concurrency(1);
sharp.cache({ memory: 32, files: 5, items: 20 });

const sha = data => crypto.createHash('sha256').update(data).digest('hex');
const toJSON = value => `${JSON.stringify(value, null, 2)}\n`;
function assetPath(src) {
  assert.match(src, /^\/puzzles\/[a-z0-9-]+\.(?:png|webp)$/);
  return path.join(root, 'public', src.slice(1));
}
function pngDimensions(data) {
  assert.equal(data.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  return { width: data.readUInt32BE(16), height: data.readUInt32BE(20) };
}
async function checkedAsset(src, record) {
  const data = await fs.readFile(assetPath(src));
  assert.equal(sha(data), record.sha256, `${src}: SHA-256`);
  assert.equal(data.length, record.bytes, `${src}: byte length`);
  const meta = await sharp(data).metadata();
  assert.equal(meta.format, 'webp', `${src}: WebP format`);
  assert.equal(meta.width, record.width, `${src}: width`);
  assert.equal(meta.height, record.height, `${src}: height`);
  return data;
}

const pending = [];
let encoded = 0, skipped = 0, newBytes = 0;
const totals = {
  count: 0, publishedCount: 0,
  allOldFullBytes: 0, allOptimizedFullBytes: 0,
  publishedOldFullBytes: 0, publishedOptimizedFullBytes: 0,
  publishedOldStandardOrFullBytes: 0, publishedOptimizedStandardOrFullBytes: 0,
  compactBytes: 0,
};

for (const photo of catalog) {
  if (photo.origin !== 'project-ai-generated' || !['published', 'archived'].includes(photo.status)) continue;
  assert.match(photo.id, /^[a-z0-9-]+$/);
  const recordPath = path.join(root, 'content/image-provenance', `${photo.id}.json`);
  const originalRecordText = await fs.readFile(recordPath, 'utf8');
  const record = JSON.parse(originalRecordText);
  assert.equal(record.id, photo.id);
  assert.equal(record.origin, photo.origin);
  const original = await fs.readFile(assetPath(photo.src));
  assert.equal(sha(original), record.sha256, `${photo.id}: original changed`);
  const originalSize = pngDimensions(original);
  assert.equal(originalSize.width, record.width);
  assert.equal(originalSize.height, record.height);
  assert.equal(record.delivery?.sourceSha256, record.sha256, `${photo.id}: source provenance`);
  assert.equal(photo.playSrc, record.delivery.play.src);
  await checkedAsset(photo.playSrc, record.delivery.play);
  // Capture all pre-existing generated-image provenance and delivery paths. The
  // only additions below are optimized/compact records and their catalog fields.
  const beforeRecord = structuredClone(record);
  delete beforeRecord.delivery.optimized;
  delete beforeRecord.delivery.compact;
  const assets = [];
  async function prepare(kind, field, input, inputSize, quality, byteLimit, extra = {}) {
    const existing = record.delivery[kind];
    const inputSha256 = sha(input);
    if (existing && photo[field] === existing.src &&
        existing.width === inputSize.width && existing.height === inputSize.height &&
        existing.quality === quality && existing.lossless === false && existing.upscaled === false &&
        existing.sourceSha256 === record.sha256 && existing.inputSha256 === inputSha256 &&
        existing.encoding?.effort === 5 && existing.encoding?.smartSubsample === true &&
        Object.entries(extra).every(([key, value]) => existing[key] === value)) {
      assert.match(existing.src, new RegExp(`^/puzzles/${photo.id}-${kind}-[a-f0-9]{12}\\.webp$`));
      assert.equal(existing.src, `/puzzles/${photo.id}-${kind}-${existing.sha256.slice(0, 12)}.webp`);
      assert.ok(existing.bytes <= byteLimit, `${photo.id} ${kind}: exceeds byte budget`);
      await checkedAsset(existing.src, existing);
      skipped++;
      return existing;
    }
    const data = await sharp(input).webp({ quality, effort: 5, smartSubsample: true }).toBuffer();
    const metadata = await sharp(data).metadata();
    assert.equal(metadata.width, inputSize.width, `${photo.id}: encoding resized width`);
    assert.equal(metadata.height, inputSize.height, `${photo.id}: encoding resized height`);
    assert.equal(metadata.format, 'webp');
    if (data.length > byteLimit) {
      throw new Error(`${photo.id} ${kind}: ${data.length} bytes exceeds ${byteLimit}; no assets or catalog were published. Review manually; the script never lowers dimensions or quality automatically.`);
    }
    const digest = sha(data);
    const src = `/puzzles/${photo.id}-${kind}-${digest.slice(0, 12)}.webp`;
    const entry = {
      src, width: metadata.width, height: metadata.height,
      sha256: digest, bytes: data.length, format: 'webp', lossless: false,
      quality, upscaled: false, sourceSha256: record.sha256, inputSha256,
      encoding: { library: 'sharp', version: sharp.versions.sharp, effort: 5, smartSubsample: true },
      ...extra,
    };
    assets.push({ src, data, entry });
    photo[field] = src;
    record.delivery[kind] = entry;
    encoded++;
    return entry;
  }
  const optimized = await prepare('optimized', 'optimizedSrc', original, originalSize, hdIds.has(photo.id) ? 88 : 84, fullLimit);
  let compact = null;
  if (photo.standardSrc) {
    assert.equal(photo.standardSrc, record.delivery.standard.src);
    assert.equal(record.delivery.standard.lossless, true);
    const standard = await checkedAsset(photo.standardSrc, record.delivery.standard);
    assert.ok(record.delivery.standard.width <= 1774 && record.delivery.standard.height <= 1774);
    compact = await prepare('compact', 'optimizedStandardSrc', standard, record.delivery.standard, 84, compactLimit, { downsampled: true, maximumPieces: 1000 });
  }
  const afterRecord = structuredClone(record);
  delete afterRecord.delivery.optimized;
  delete afterRecord.delivery.compact;
  assert.deepEqual(afterRecord, beforeRecord, `${photo.id}: original provenance or old delivery changed`);
  pending.push({ photo, record, recordPath, originalRecordText, originalDigest: record.sha256, assets });
  totals.count++;
  totals.allOldFullBytes += record.delivery.play.bytes;
  totals.allOptimizedFullBytes += optimized.bytes;
  if (compact) totals.compactBytes += compact.bytes;
  if (photo.status === 'published') {
    totals.publishedCount++;
    totals.publishedOldFullBytes += record.delivery.play.bytes;
    totals.publishedOptimizedFullBytes += optimized.bytes;
    totals.publishedOldStandardOrFullBytes += record.delivery.standard?.bytes ?? record.delivery.play.bytes;
    totals.publishedOptimizedStandardOrFullBytes += compact?.bytes ?? optimized.bytes;
  }
}

// Validate the complete batch before writing anything. Existing sources and
// manifests must not have changed while this offline operation was encoding.
assert.equal(await fs.readFile(catalogPath, 'utf8'), originalCatalogText, 'catalog changed concurrently');
for (const item of pending) {
  assert.equal(await fs.readFile(item.recordPath, 'utf8'), item.originalRecordText, `${item.photo.id}: provenance changed concurrently`);
  assert.equal(sha(await fs.readFile(assetPath(item.photo.src))), item.originalDigest, `${item.photo.id}: original changed during encoding`);
}
for (const item of pending) {
  for (const asset of item.assets) {
    try {
      await fs.writeFile(assetPath(asset.src), asset.data, { flag: 'wx' });
      newBytes += asset.data.length;
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      assert.equal(sha(await fs.readFile(assetPath(asset.src))), asset.entry.sha256, `${asset.src}: existing hashed file mismatch`);
    }
    await checkedAsset(asset.src, asset.entry);
  }
  const nextText = toJSON(item.record);
  if (nextText !== item.originalRecordText) await fs.writeFile(item.recordPath, nextText, 'utf8');
}
const nextCatalogText = toJSON(catalog);
if (nextCatalogText !== originalCatalogText) await fs.writeFile(catalogPath, nextCatalogText, 'utf8');
console.log(JSON.stringify({ ...totals, encoded, skipped, newBytes, originalHashesVerified: pending.length, policy: { normalQuality: 84, fullHDQuality: 88, compactQuality: 84, fullLimit, compactLimit, noResize: true } }, null, 2));
