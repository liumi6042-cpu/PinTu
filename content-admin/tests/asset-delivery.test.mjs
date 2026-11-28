import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join} from 'node:path';
import {catalogFiles, createAssetDelivery} from '../asset-delivery.mjs';

function fixture({existing = [], catalog, files = {}} = {}) {
  const root = mkdtempSync(join(tmpdir(), 'asset-delivery-'));
  const worktree = join(root, 'work/dual-managed-release-20261014');
  mkdirSync(join(worktree, 'content'), {recursive: true});
  mkdirSync(join(worktree, 'public/puzzles'), {recursive: true});
  mkdirSync(join(root, 'content-admin/work'), {recursive: true});
  const entries = catalog ?? [
    {id: 'alpha-v1', src: '/puzzles/alpha-v1.png', playSrc: '/puzzles/alpha-v1-play-aa.webp', thumbSrc: '/puzzles/alpha-v1-thumbnail-bb.webp', optimizedSrc: '/puzzles/alpha-v1-optimized-cc.webp'},
  ];
  writeFileSync(join(worktree, 'content/puzzle-catalog.json'), JSON.stringify(entries, null, 2));
  writeFileSync(join(worktree, 'content/puzzle-guidance.json'), JSON.stringify({}, null, 2));
  const payload = {existing: JSON.stringify({ok: true, puzzles: existing, catalog: true, guidance: true}), apply: JSON.stringify({ok: true, files: 0, services: []})};
  for (const entry of entries) {
    for (const field of ['src', 'playSrc', 'thumbSrc', 'optimizedSrc']) {
      const url = entry[field];
      if (!url) continue;
      const name = url.slice('/puzzles/'.length);
      if (files[name] === false) continue;
      mkdirSync(dirname(join(worktree, 'public/puzzles', name)), {recursive: true});
      if (!files[name]) writeFileSync(join(worktree, 'public/puzzles', name), 'bytes-' + name);
    }
  }
  writeFileSync(join(root, 'content-admin/work/publish-config.json'), JSON.stringify({schema: 'jigsaw-publish-transport/v1', host: 'root@example.test', identityFile: join(root, 'key')}));
  const digest = (relativePath) => createHash('sha256').update(readFileSync(join(worktree, relativePath))).digest('hex');
  const remoteHashes = [`${digest('content/puzzle-catalog.json')}  /srv/sites/jigsaw-content/assets/catalog.json`,
    `${digest('content/puzzle-guidance.json')}  /srv/sites/jigsaw-content/assets/guidance.json`].join('\n');
  const calls = [];
  const runner = async (command, args) => {
    calls.push([command, args]);
    if (command === 'ssh' && args.join(' ').includes('--list-existing')) return {code: 0, stdout: payload.existing + '\n', stderr: ''};
    if (command === 'ssh' && args.join(' ').includes('sha256sum')) return {code: 0, stdout: remoteHashes + '\n', stderr: ''};
    if (command === 'ssh' && args.join(' ').includes('--apply')) return {code: 0, stdout: payload.apply + '\n', stderr: ''};
    return {code: 0, stdout: '', stderr: ''};
  };
  const delivery = createAssetDelivery({projectRoot: root, dataDir: join(root, 'content-admin/work'), configPath: join(root, 'content-admin/work/publish-config.json'), runner, now: () => 1_700_000_000_000});
  return {root, delivery, calls, worktree};
}

test('plan lists only artwork the server is missing', async () => {
  const {root, delivery} = fixture({existing: ['alpha-v1-play-aa.webp', 'alpha-v1-thumbnail-bb.webp']});
  try {
    const plan = await delivery.plan();
    assert.equal(plan.reachable, true);
    assert.deepEqual(plan.missing.map(item => item.url).sort(), ['/puzzles/alpha-v1-optimized-cc.webp']);
    assert.equal(plan.totalFiles, 3);
    assert.ok(plan.missingBytes > 0);
  } finally {
    rmSync(root, {recursive: true, force: true});
  }
});

test('plan reports an unreachable server without uploading', async () => {
  const {root, delivery, calls} = fixture({existing: ['alpha-v1.png', 'alpha-v1-play-aa.webp', 'alpha-v1-thumbnail-bb.webp', 'alpha-v1-optimized-cc.webp']});
  try {
    const plan = await delivery.plan();
    assert.equal(plan.missing.length, 0);
    assert.equal(calls.some(([command, args]) => command === 'scp' || args.join(' ').includes('--apply')), false);
  } finally {
    rmSync(root, {recursive: true, force: true});
  }
});

test('deliver uploads missing files, runs the remote tool and records a receipt', async () => {
  const {root, delivery, calls} = fixture({existing: ['alpha-v1-thumbnail-bb.webp']});
  try {
    const result = await delivery.deliver({actor: 'tester'});
    assert.equal(result.skipped, false);
    const scp = calls.filter(([command]) => command === 'scp').at(-1);
    assert.ok(scp, 'expected an scp call');
    assert.ok(scp[1].some(arg => arg.endsWith('alpha-v1-play-aa.webp')));
    assert.ok(scp[1].some(arg => arg.endsWith('alpha-v1-optimized-cc.webp')));
    assert.ok(!scp[1].some(arg => arg.endsWith('alpha-v1-thumbnail-bb.webp')), 'already-present files are not re-sent');
    assert.ok(calls.some(([command, args]) => command === 'ssh' && args.join(' ').includes('--apply --restart')));
    const receipt = JSON.parse(readFileSync(join(root, 'content-admin/work/asset-uploads.json'), 'utf8'));
    assert.equal(receipt.entries.length, 1);
    assert.equal(receipt.entries[0].actor, 'tester');
    assert.equal(receipt.entries[0].uploaded, 2);
  } finally {
    rmSync(root, {recursive: true, force: true});
  }
});

test('deliver skips upload when the server already has every file', async () => {
  const {root, delivery, calls} = fixture({existing: ['alpha-v1.png', 'alpha-v1-play-aa.webp', 'alpha-v1-thumbnail-bb.webp', 'alpha-v1-optimized-cc.webp']});
  try {
    const result = await delivery.deliver();
    assert.equal(result.skipped, true);
    assert.equal(calls.some(([command]) => command === 'scp'), false);
  } finally {
    rmSync(root, {recursive: true, force: true});
  }
});

test('catalog paths outside /puzzles are rejected', () => {
  const {root} = fixture({catalog: [{id: 'bad-v1', playSrc: '/etc/passwd', thumbSrc: null, optimizedSrc: null}]});
  try {
    assert.throws(() => catalogFiles([{id: 'bad-v1', playSrc: '/etc/passwd'}], join(root, 'work/dual-managed-release-20261014/public/puzzles')), /不允许上传的路径/);
  } finally {
    rmSync(root, {recursive: true, force: true});
  }
});

test('missing local artwork fails before any upload', async () => {
  const {root, delivery, calls} = fixture({existing: [], files: {'alpha-v1-play-aa.webp': false}});
  try {
    await assert.rejects(() => delivery.plan(), /本地缺少图库文件/);
    assert.equal(calls.some(([command]) => command === 'scp'), false);
  } finally {
    rmSync(root, {recursive: true, force: true});
  }
});

test('plan tolerates a UTF-8 BOM in publish-config.json', async () => {
  const {root, delivery} = fixture({existing: ['alpha-v1-play-aa.webp', 'alpha-v1-thumbnail-bb.webp', 'alpha-v1-optimized-cc.webp']});
  try {
    const cfgPath = join(root, 'content-admin/work/publish-config.json');
    writeFileSync(cfgPath, '\uFEFF' + readFileSync(cfgPath, 'utf8'));
    const plan = await delivery.plan();
    assert.equal(plan.reachable, true);
    assert.equal(plan.missing.length, 0);
  } finally {
    rmSync(root, {recursive: true, force: true});
  }
});

test('deliver immediately records newly uploaded pending assets in delivered-assets.json', async () => {
  const {root, delivery, worktree} = fixture({
    existing: [],
    catalog: [
      {id: 'fresh-v1', src: '/puzzles/fresh-v1.png', thumbSrc: '/puzzles/fresh-v1-thumbnail-bb.webp', optimizedSrc: '/puzzles/fresh-v1-optimized-cc.webp'},
    ],
  });
  try {
    const thumbBytes = readFileSync(join(worktree, 'public/puzzles/fresh-v1-thumbnail-bb.webp'));
    const optBytes = readFileSync(join(worktree, 'public/puzzles/fresh-v1-optimized-cc.webp'));
    const sha = buf => createHash('sha256').update(buf).digest('hex');
    mkdirSync(join(root, 'content-admin/work/pending-assets'), {recursive: true});
    writeFileSync(join(root, 'content-admin/work/pending-assets/registry.json'), JSON.stringify({
      schema: 'jigsaw-pending-assets/v1',
      assets: [{
        id: 'fresh-v1',
        source: {sha256: 'a'.repeat(64)},
        delivery: {
          thumbnail: {path: 'batch/delivery/fresh-v1-thumbnail-bb.webp', bytes: thumbBytes.length, sha256: sha(thumbBytes)},
          optimized: {path: 'batch/delivery/fresh-v1-optimized-cc.webp', bytes: optBytes.length, sha256: sha(optBytes)},
        },
      }],
    }));
    writeFileSync(join(root, 'content-admin/work/delivered-assets.json'), JSON.stringify({
      schema: 'jigsaw-delivered-assets/v1',
      webRelease: 'test-web',
      mobileRelease: 'test-mobile',
      verifiedAt: '2026-01-01T00:00:00.000Z',
      images: [],
    }));
    const result = await delivery.deliver({actor: 'tester'});
    assert.equal(result.skipped, false);
    assert.equal(result.delivered, 1);
    const deliveredReceipt = JSON.parse(readFileSync(join(root, 'content-admin/work/delivered-assets.json'), 'utf8'));
    assert.equal(deliveredReceipt.images.length, 1);
    assert.equal(deliveredReceipt.images[0].id, 'fresh-v1');
    const uploadReceipt = JSON.parse(readFileSync(join(root, 'content-admin/work/asset-uploads.json'), 'utf8'));
    assert.equal(uploadReceipt.entries.at(-1).markedDelivered, 1);
  } finally {
    rmSync(root, {recursive: true, force: true});
  }
});
