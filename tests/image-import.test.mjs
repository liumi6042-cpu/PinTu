import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync, readdirSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createRequire} from 'node:module';

const sharp = createRequire('D:/chat/拼图/jigsaw-nook-taptap/package.json')('sharp');
const {createImageImporter, IMAGE_SPEC} = await import('../image-import.mjs');

/** A small but real PNG, so sharp sees ordinary pixel data. */
async function samplePng(width = 900, height = 600) {
  return sharp({create: {width, height, channels: 3, background: {r: 140, g: 90, b: 60}}})
    .composite([{input: Buffer.from(`<svg width="${width}" height="${height}"><rect x="60" y="60" width="${width - 120}" height="${height - 120}" fill="#e8c07a"/></svg>`), top: 0, left: 0}])
    .png().toBuffer();
}

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'image-import-'));
  const pending = join(root, 'content-admin/work/pending-assets');
  mkdirSync(pending, {recursive: true});
  writeFileSync(join(pending, 'registry.json'), JSON.stringify({schema: 'jigsaw-pending-assets/v1', assets: []}, null, 1));
  const importer = createImageImporter({projectRoot: root, pendingRoot: pending, registryPath: join(pending, 'registry.json'), dataDir: join(root, 'content-admin/work')});
  return {root, pending, registryPath: join(pending, 'registry.json'), importer};
}

test('import compresses to Q70 / 2560 and registers two delivery files', async () => {
  const {root, pending, registryPath, importer} = fixture();
  try {
    const bytes = await samplePng(3200, 2000);
    const receipt = await importer.run([{name: 'wide.png', bytes}], [{title: 'Wide sample', styleGroupId: 'painted'}], {actor: 'tester'});
    assert.equal(receipt.imported.length, 1);
    const row = receipt.imported[0];
    assert.ok(row.optimizedBytes < bytes.length, 'delivery must be smaller than the source');
    assert.equal(row.width, IMAGE_SPEC.longSide, 'long side is capped at 2560');

    const registry = JSON.parse(readFileSync(registryPath, 'utf8'));
    const asset = registry.assets[0];
    assert.equal(asset.generation.tool, 'admin-upload');
    assert.deepEqual(Object.keys(asset.delivery).sort(), ['optimized', 'sourceSha256', 'thumbnail']);
    assert.equal(asset.delivery.optimized.quality, 70);
    assert.equal(asset.delivery.optimized.lossless, false);
    assert.equal(asset.delivery.optimized.encoding.library, 'sharp');
    assert.equal(asset.delivery.thumbnail.quality, 82);
    assert.ok(asset.delivery.optimized.path.endsWith(asset.delivery.optimized.sha256.slice(0, 12) + '.webp'));
    for (const kind of ['optimized', 'thumbnail']) {
      assert.ok(existsSync(join(pending, asset.delivery[kind].path)), kind + ' file exists');
    }
    // Read the header directly: a second sharp instance would hold the file open.
    const encoded = readFileSync(join(pending, asset.delivery.optimized.path));
    assert.equal(encoded.toString('ascii', 0, 4), 'RIFF');
    assert.equal(encoded.toString('ascii', 8, 12), 'WEBP');
    assert.equal(encoded.length, asset.delivery.optimized.bytes);
  } finally {
    rmSync(root, {recursive: true, force: true, maxRetries: 8, retryDelay: 120});
  }
});

test('a small picture keeps its own size and is never enlarged', async () => {
  const {root, registryPath, importer} = fixture();
  try {
    const bytes = await samplePng(640, 480);
    const receipt = await importer.run([{name: 'small.png', bytes}], [{title: 'Small'}], {actor: 'tester'});
    const row = receipt.imported[0];
    assert.equal(row.width, 640);
    assert.equal(row.height, 480);
    const asset = JSON.parse(readFileSync(registryPath, 'utf8')).assets[0];
    assert.equal(asset.delivery.optimized.upscaled, false);
  } finally {
    rmSync(root, {recursive: true, force: true, maxRetries: 8, retryDelay: 120});
  }
});

test('a Chinese-only title still produces a usable id', async () => {
  const {root, registryPath, importer} = fixture();
  try {
    const receipt = await importer.run([{name: 'x.png', bytes: await samplePng(800, 800)}], [{title: '云山宫阙'}], {actor: 't'});
    const id = receipt.imported[0].id;
    assert.match(id, /^img-\d{8}-[a-f0-9]{6}$/, 'falls back to a dated id: ' + id);
    assert.equal(JSON.parse(readFileSync(registryPath, 'utf8')).assets[0].id, id);
  } finally {
    rmSync(root, {recursive: true, force: true, maxRetries: 8, retryDelay: 120});
  }
});

test('a duplicate id is rejected and the registry is left untouched', async () => {
  const {root, registryPath, importer} = fixture();
  try {
    const bytes = await samplePng(700, 700);
    await importer.run([{name: 'a.png', bytes}], [{title: 'Fixed', id: 'fixed-id'}], {actor: 't'});
    const before = readFileSync(registryPath, 'utf8');
    await assert.rejects(
      () => importer.run([{name: 'b.png', bytes}], [{title: 'Fixed again', id: 'fixed-id'}], {actor: 't'}),
      /没有图片导入成功|已存在/,
    );
    assert.equal(readFileSync(registryPath, 'utf8'), before, 'registry unchanged after a failed batch');
  } finally {
    rmSync(root, {recursive: true, force: true, maxRetries: 8, retryDelay: 120});
  }
});

test('a non-image payload is rejected', async () => {
  const {root, importer} = fixture();
  try {
    await assert.rejects(
      () => importer.run([{name: 'notes.txt', bytes: Buffer.from('not an image')}], [{title: 'Nope'}], {actor: 't'}),
      /无法读取这张图片|只接受/,
    );
  } finally {
    rmSync(root, {recursive: true, force: true, maxRetries: 8, retryDelay: 120});
  }
});

test('a picture below the minimum short side is rejected', async () => {
  const {root, importer} = fixture();
  try {
    const tiny = await samplePng(120, 120);
    await assert.rejects(
      () => importer.run([{name: 'tiny.png', bytes: tiny}], [{title: 'Tiny'}], {actor: 't'}),
      /图片太小/,
    );
  } finally {
    rmSync(root, {recursive: true, force: true, maxRetries: 8, retryDelay: 120});
  }
});

test('importing several pictures in one batch keeps every entry', async () => {
  const {root, registryPath, importer} = fixture();
  try {
    const files = [{name: 'a.png', bytes: await samplePng(900, 600)}, {name: 'b.png', bytes: await samplePng(600, 900)}];
    const receipt = await importer.run(files, [{title: 'Landscape'}, {title: 'Portrait'}], {actor: 't'});
    assert.equal(receipt.imported.length, 2);
    assert.equal(JSON.parse(readFileSync(registryPath, 'utf8')).assets.length, 2);
    assert.notEqual(receipt.imported[0].id, receipt.imported[1].id);
  } finally {
    rmSync(root, {recursive: true, force: true, maxRetries: 8, retryDelay: 120});
  }
});
