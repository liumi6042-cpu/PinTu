// Bring pictures that only reached the pending registry up to the delivery spec,
// keeping their IDs so albums that already reference them stay valid.
//
// Some tools drop artwork into the private registry and stop there. The admin can
// then place those pictures in albums, but nothing is written into a runtime
// catalogue, so the albums publish empty and the player side hides them.
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {existsSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {basename, dirname, join} from 'node:path';

const REQUIRE_FROM = 'D:/chat/拼图/jigsaw-nook-taptap/package.json';
import {deliveryDimensions, MAX_DELIVERY_PIXELS} from '../delivery-spec.mjs';
const QUALITY = 70, THUMB = 384, THUMB_QUALITY = 82, EFFORT = 6;
const sha = bytes => createHash('sha256').update(bytes).digest('hex');

export async function normalisePending({projectRoot = 'D:/chat/拼图', ids = null, apply = false} = {}) {
  const pendingRoot = join(projectRoot, 'content-admin/work/pending-assets');
  const registryPath = join(pendingRoot, 'registry.json');
  const registry = JSON.parse(readFileSync(registryPath, 'utf8'));
  const selected = registry.assets.filter(asset => !ids || ids.includes(asset.id));
  const sharp = createRequire(REQUIRE_FROM)('sharp');

  const report = {checked: selected.length, changed: [], skipped: [], apply};

  for (const asset of selected) {
    const source = join(pendingRoot, asset.source.path);
    if (!existsSync(source)) { report.skipped.push({id: asset.id, reason: '原图缺失'}); continue; }

    const budget = deliveryDimensions(asset.source.width, asset.source.height, MAX_DELIVERY_PIXELS);
    const current = asset.delivery?.optimized;
    const needsWork = !current
      || asset.delivery.play !== undefined
      || current.quality !== QUALITY
      || current.width !== budget.width
      || current.height !== budget.height;
    if (!needsWork) continue;

    const encode = async (kind, box, quality) => {
      const buffer = await sharp(source, {failOn: 'error'}).rotate()
        .resize({width: box.width, height: box.height, fit: 'inside', withoutEnlargement: true})
        .webp({quality, effort: EFFORT, smartSubsample: kind === 'optimized'}).toBuffer();
      const meta = await sharp(buffer).metadata();
      return {buffer, width: meta.width, height: meta.height, digest: sha(buffer)};
    };
    const optimized = await encode('optimized', budget, QUALITY);
    const thumbnail = await encode('thumbnail', {width: THUMB, height: THUMB}, THUMB_QUALITY);

    const place = (kind, result, quality, extra) => {
      const name = `${asset.id}-${kind}-${result.digest.slice(0, 12)}.webp`;
      const relative = 'normalised/' + name;
      if (apply) { mkdirSync(join(pendingRoot, 'normalised'), {recursive: true}); writeFileSync(join(pendingRoot, relative), result.buffer); }
      return {
        path: relative, src: '/puzzles/' + name, sha256: result.digest, bytes: result.buffer.length,
        width: result.width, height: result.height, format: 'webp', lossless: false, quality,
        upscaled: false, sourceSha256: asset.source.sha256, inputSha256: asset.source.sha256, ...extra,
      };
    };

    const entry = {
      sourceSha256: asset.source.sha256,
      optimized: place('optimized', optimized, QUALITY, {
        effort: EFFORT, smartSubsample: true,
        encoding: {library: 'sharp', version: sharp.versions.sharp, effort: EFFORT, smartSubsample: true},
      }),
      thumbnail: place('thumbnail', thumbnail, THUMB_QUALITY, {
        encoding: {library: 'sharp', version: sharp.versions.sharp, effort: EFFORT},
      }),
    };
    if (apply) {
      // The old files stay on disk; only the registry stops pointing at them.
      asset.delivery = entry;
    }
    report.changed.push({
      id: asset.id,
      from: `${asset.delivery?.optimized?.width}x${asset.delivery?.optimized?.height}`,
      to: `${entry.optimized.width}x${entry.optimized.height}`,
      bytes: entry.optimized.bytes,
    });
  }

  if (apply && report.changed.length) {
    writeFileSync(registryPath, JSON.stringify(registry, null, 1) + '\n');
  }
  return report;
}

if (process.argv[1] && process.argv[1].endsWith('normalise-pending.mjs')) {
  const ids = process.argv.find(value => value.startsWith('--ids='))?.slice(6).split(',') ?? null;
  const apply = process.argv.includes('--apply');
  const report = await normalisePending({ids, apply});
  console.log(JSON.stringify({...report, changed: report.changed.slice(0, 40)}, null, 1));
}
