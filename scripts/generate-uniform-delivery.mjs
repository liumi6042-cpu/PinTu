// Generate the uniform 2026-10-17 delivery set from the PNG masters:
//   optimized  Q70, longest side 2560  (rooms with 300+ pieces)
//   compact    Q60, longest side 1600  (rooms under 300 pieces)
//   thumbnail  Q82, 384 box
// Writes files plus a mapping file. It does NOT touch the catalog, so a failed
// follow-up can be retried without cleanup.
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {existsSync, readFileSync, writeFileSync} from 'node:fs';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const WORKSPACE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(join(WORKSPACE_ROOT, 'jigsaw-nook-taptap/package.json'));
const sharp = require('sharp');

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PUZZLES = join(ROOT, 'public/puzzles');
const catalog = JSON.parse(readFileSync(join(ROOT, 'content/puzzle-catalog.json'), 'utf8'));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const out = {schema: 'jigsaw-uniform-delivery/v1', createdAt: new Date().toISOString(), specs: {optimized: {quality: 70, cap: 2560}, compact: {quality: 60, cap: 1600}, thumbnail: {quality: 82, cap: 384}}, images: {}};
let done = 0, total = 0, failed = [];

for (const photo of catalog) {
  const master = join(PUZZLES, photo.id + '.png');
  if (!existsSync(master)) { failed.push({id: photo.id, reason: 'missing png'}); continue; }
  const entry = {};
  for (const kind of ['optimized', 'compact', 'thumbnail']) {
    const cap = kind === 'optimized' ? 2560 : kind === 'compact' ? 1600 : 384;
    const quality = kind === 'optimized' ? 70 : kind === 'compact' ? 60 : 82;
    const buffer = await sharp(master).rotate()
      .resize({width: cap, height: cap, fit: 'inside', withoutEnlargement: true})
      .webp({quality, effort: kind === 'thumbnail' ? 6 : 6, smartSubsample: kind !== 'thumbnail'})
      .toBuffer();
    const digest = sha(buffer);
    const name = `${photo.id}-${kind}-${digest.slice(0, 12)}.webp`;
    writeFileSync(join(PUZZLES, name), buffer);
    const meta = await sharp(buffer).metadata();
    entry[kind] = {
      src: '/puzzles/' + name, sha256: digest, bytes: buffer.length,
      width: meta.width, height: meta.height, format: 'webp', lossless: false,
      quality, upscaled: false, downsampled: true,
      ...(kind === 'compact' ? {maximumPieces: 300} : {}),
      sourceSha256: null,
      inputSha256: null,
      encoding: {library: 'sharp', version: sharp.versions.sharp, effort: 6, smartSubsample: kind !== 'thumbnail'},
    };
    total += buffer.length;
  }
  out.images[photo.id] = entry;
  done += 1;
  if (done % 25 === 0) console.log('generated', done, '/', catalog.length);
}

out.done = done; out.failed = failed; out.totalBytes = total;
writeFileSync(join(WORKSPACE_ROOT, 'content-admin/work/asset-upload-20261017/uniform-delivery.json'), JSON.stringify(out, null, 2) + '\n');
console.log(JSON.stringify({done, failed: failed.length, totalMB: +(total / 1048576).toFixed(1)}));
