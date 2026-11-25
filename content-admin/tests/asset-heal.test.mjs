import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {healDeliveries} from '../asset-heal.mjs';

const sharp = createRequire(resolve(import.meta.dirname, '../../jigsaw-nook-taptap/package.json'))('sharp');

/**
 * A miniature two-tree project: one picture, correctly encoded, so a test can
 * break exactly one thing and watch the healer put it back.
 */
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'asset-heal-'));
  const web = join(root, 'work/dual-managed-release-20261014');
  const mobile = join(root, 'jigsaw-nook-taptap');
  for (const tree of [web, mobile]) {
    for (const dir of ['content/image-provenance', 'public/puzzles']) mkdirSync(join(tree, dir), {recursive: true});
  }
  return {root, web, mobile};
}

async function seed({root, web, mobile}, {quality = 70, lifetime = 'fresh'} = {}) {
  const id = 'sample-piece-v1';
  const original = await sharp({create: {width: 1800, height: 1200, channels: 3, background: {r: 90, g: 120, b: 80}}}).png().toBuffer();
  for (const tree of [web, mobile]) writeFileSync(join(tree, 'public/puzzles', id + '.png'), original);

  const encode = async (kind, box, q) => {
    const buffer = await sharp(original).resize({width: box.width, height: box.height, fit: 'inside', withoutEnlargement: true})
      .webp({quality: q, effort: 6, smartSubsample: kind === 'optimized'}).toBuffer();
    const meta = await sharp(buffer).metadata();
    return {buffer, width: meta.width, height: meta.height};
  };
  const optimized = await encode('optimized', {width: 2560, height: 2560}, quality);
  const thumbnail = await encode('thumbnail', {width: 384, height: 384}, 82);
  const crypto = await import('node:crypto');
  const digest = buffer => crypto.createHash('sha256').update(buffer).digest('hex');

  const optimizedName = `${id}-optimized-${digest(optimized.buffer).slice(0, 12)}.webp`;
  const thumbnailName = `${id}-thumbnail-${digest(thumbnail.buffer).slice(0, 12)}.webp`;
  for (const tree of [web, mobile]) {
    writeFileSync(join(tree, 'public/puzzles', optimizedName), optimized.buffer);
    writeFileSync(join(tree, 'public/puzzles', thumbnailName), thumbnail.buffer);
  }
  const photo = {
    id, title: 'Sample', subtitle: '', category: '插画', src: '/puzzles/' + id + '.png',
    origin: 'project-ai-generated', status: 'published',
    playSrc: '/puzzles/' + optimizedName, thumbSrc: '/puzzles/' + thumbnailName, optimizedSrc: '/puzzles/' + optimizedName,
  };
  for (const tree of [web, mobile]) {
    writeFileSync(join(tree, 'content/puzzle-catalog.json'), JSON.stringify([photo], null, 2) + '\n');
  }
  const record = {
    id, origin: photo.origin, width: 1800, height: 1200, sha256: digest(original),
    nativeResolution: true, upscaled: false,
    delivery: {
      sourceSha256: digest(original),
      optimized: {
        src: photo.optimizedSrc, sha256: digest(optimized.buffer), bytes: optimized.buffer.length,
        width: optimized.width, height: optimized.height, format: 'webp', lossless: false, quality,
        upscaled: false, inputSha256: digest(original),
        encoding: {library: 'sharp', version: sharp.versions.sharp, effort: 6, smartSubsample: true},
      },
      thumbnail: {
        src: photo.thumbSrc, sha256: digest(thumbnail.buffer), bytes: thumbnail.buffer.length,
        width: thumbnail.width, height: thumbnail.height, format: 'webp', lossless: false, quality: 82,
        upscaled: false, inputSha256: digest(original),
        encoding: {library: 'sharp', version: sharp.versions.sharp, effort: 6},
      },
    },
  };
  if (lifetime === 'legacy') {
    record.delivery.play = {...record.delivery.optimized, src: '/puzzles/' + id + '-play-legacy.webp'};
  }
  for (const tree of [web, mobile]) {
    writeFileSync(join(tree, 'content/image-provenance', id + '.json'), JSON.stringify(record, null, 2) + '\n');
  }
  writeFileSync(join(web, 'content/artwork-revisions.json'), JSON.stringify({
    schema: 'jigsaw-artwork-revisions/v1', legacy: {}, active: {},
    files: {},
    versions: {[id]: [{revision: record.sha256, src: photo.optimizedSrc, thumbSrc: photo.thumbSrc, width: 1800, height: 1200}]},
  }, null, 2) + '\n');
  const registryDir = join(root, 'content-admin/work/pending-assets');
  mkdirSync(registryDir, {recursive: true});
  writeFileSync(join(registryDir, 'registry.json'), JSON.stringify({schema: 'jigsaw-pending-assets/v1', assets: []}, null, 1));
  return {id, optimizedName, thumbnailName, original};
}

test('a picture that already matches the spec is left alone', async () => {
  const fixtureRoot = fixture();
  try {
    await seed(fixtureRoot);
    const before = readFileSync(join(fixtureRoot.web, 'content/image-provenance/sample-piece-v1.json'), 'utf8');
    const result = await healDeliveries({projectRoot: fixtureRoot.root});
    assert.equal(result.checked, 1);
    assert.deepEqual(result.healed, []);
    assert.equal(readFileSync(join(fixtureRoot.web, 'content/image-provenance/sample-piece-v1.json'), 'utf8'), before);
  } finally {
    rmSync(fixtureRoot.root, {recursive: true, force: true, maxRetries: 8, retryDelay: 120});
  }
});

test('a picture encoded at another quality is re-encoded to Q70', async () => {
  const fixtureRoot = fixture();
  try {
    await seed(fixtureRoot, {quality: 84});
    const result = await healDeliveries({projectRoot: fixtureRoot.root});
    assert.equal(result.healed.length, 1);
    assert.ok(result.healed[0].problems.some(reason => reason.includes('压缩参数')), JSON.stringify(result.healed[0].problems));
    const record = JSON.parse(readFileSync(join(fixtureRoot.web, 'content/image-provenance/sample-piece-v1.json'), 'utf8'));
    assert.equal(record.delivery.optimized.quality, 70);
    // Both trees end up identical, which the admin's source check requires.
    assert.equal(
      readFileSync(join(fixtureRoot.web, 'content/puzzle-catalog.json'), 'utf8'),
      readFileSync(join(fixtureRoot.mobile, 'content/puzzle-catalog.json'), 'utf8'),
    );
    assert.equal(
      readFileSync(join(fixtureRoot.web, 'content/image-provenance/sample-piece-v1.json'), 'utf8'),
      readFileSync(join(fixtureRoot.mobile, 'content/image-provenance/sample-piece-v1.json'), 'utf8'),
    );
  } finally {
    rmSync(fixtureRoot.root, {recursive: true, force: true, maxRetries: 8, retryDelay: 120});
  }
});

test('a missing delivery file is rebuilt from the original', async () => {
  const fixtureRoot = fixture();
  try {
    const {id, optimizedName} = await seed(fixtureRoot);
    const {web} = fixtureRoot;
    rmSync(join(web, 'public/puzzles', optimizedName));
    const result = await healDeliveries({projectRoot: fixtureRoot.root});
    assert.equal(result.healed.length, 1);
    const record = JSON.parse(readFileSync(join(web, 'content/image-provenance', id + '.json'), 'utf8'));
    assert.ok(existsSync(join(web, 'public', record.delivery.optimized.src.slice(1))), 'delivery file exists again');
  } finally {
    rmSync(fixtureRoot.root, {recursive: true, force: true, maxRetries: 8, retryDelay: 120});
  }
});

test('a legacy record that still lists a play file is normalised', async () => {
  const fixtureRoot = fixture();
  try {
    await seed(fixtureRoot, {lifetime: 'legacy'});
    const result = await healDeliveries({projectRoot: fixtureRoot.root});
    assert.equal(result.healed.length, 1);
    const record = JSON.parse(readFileSync(join(fixtureRoot.web, 'content/image-provenance/sample-piece-v1.json'), 'utf8'));
    assert.equal(record.delivery.play, undefined, 'the retired play entry is dropped');
  } finally {
    rmSync(fixtureRoot.root, {recursive: true, force: true, maxRetries: 8, retryDelay: 120});
  }
});

test('without an original the picture is reported, not silently skipped', async () => {
  const fixtureRoot = fixture();
  try {
    const {id, optimizedName} = await seed(fixtureRoot);
    const {web} = fixtureRoot;
    rmSync(join(web, 'public/puzzles', optimizedName));
    rmSync(join(web, 'public/puzzles', id + '.png'));
    rmSync(join(fixtureRoot.mobile, 'public/puzzles', id + '.png'));
    const result = await healDeliveries({projectRoot: fixtureRoot.root});
    assert.equal(result.healed.length, 0);
    assert.equal(result.skipped.length, 1);
    assert.match(result.skipped[0].reason, /原图/);
  } finally {
    rmSync(fixtureRoot.root, {recursive: true, force: true, maxRetries: 8, retryDelay: 120});
  }
});

test('the room snapshot follows the new file so old rooms keep working', async () => {
  const fixtureRoot = fixture();
  try {
    const {id} = await seed(fixtureRoot, {quality: 84});
    const {web} = fixtureRoot;
    await healDeliveries({projectRoot: fixtureRoot.root});
    const record = JSON.parse(readFileSync(join(web, 'content/image-provenance', id + '.json'), 'utf8'));
    const revisions = JSON.parse(readFileSync(join(web, 'content/artwork-revisions.json'), 'utf8'));
    const base = revisions.versions[id].find(item => item.revision === record.sha256);
    assert.equal(base.src, record.delivery.optimized.src);
    assert.equal(base.thumbSrc, record.delivery.thumbnail.src);
  } finally {
    rmSync(fixtureRoot.root, {recursive: true, force: true, maxRetries: 8, retryDelay: 120});
  }
});
