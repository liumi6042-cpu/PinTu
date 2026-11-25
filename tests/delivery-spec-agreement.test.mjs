// The pixel budget used to live only inside the dated Web worktree, so a
// release rotation could silently break the admin. It now has a stable copy
// under contracts/; this test fails if the two copies ever disagree.
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import test from 'node:test';

const projectRoot = resolve(import.meta.dirname, '../..');
const admin = await import('../contracts/delivery-spec.mjs');
const {webTree, webTreeName, mobileTree} = await import('../project-layout.mjs');

const sizes = [
  [2560, 2560], // exactly the budget
  [2760, 1584], // landscape over budget
  [1584, 2760], // portrait over budget
  [4000, 4000], // square over budget
  [1280, 720], // under budget, must stay native
  [1, 1],
];

test('the build tree and the admin agree on the pixel budget', () => {
  const build = join(webTree(projectRoot), 'scripts/delivery-spec.mjs');
  assert.ok(existsSync(build), 'Web 树缺少 delivery-spec.mjs：' + build);
  return import(pathToFileURL(build).href).then(spec => {
    assert.equal(spec.MAX_DELIVERY_PIXELS, admin.MAX_DELIVERY_PIXELS, '两端像素上限不一致');
    for (const [width, height] of sizes) {
      assert.deepEqual(
        spec.deliveryDimensions(width, height),
        admin.deliveryDimensions(width, height),
        `两端对 ${width}×${height} 的缩放结果不一致`,
      );
    }
  });
});

test('the pixel budget stays a ceiling, not a target', () => {
  assert.deepEqual(admin.deliveryDimensions(1280, 720), {width: 1280, height: 720});
  for (const [width, height] of sizes) {
    const out = admin.deliveryDimensions(width, height);
    assert.ok(out.width * out.height <= admin.MAX_DELIVERY_PIXELS, `${width}×${height} 超出上限`);
  }
});

test('the Web tree is discovered rather than hard-coded', () => {
  const tree = webTree(projectRoot);
  assert.ok(existsSync(join(tree, 'content/puzzle-catalog.json')), '发现的 Web 树不像一棵内容树：' + tree);
  assert.match(webTreeName(projectRoot), /^(?:puzzle-play|work\/dual-managed-release-\d{8})$/, 'Web 树路径格式意外：' + webTreeName(projectRoot));
  assert.ok(!webTreeName(projectRoot).includes('\\'), '相对路径必须是 POSIX 风格');
});

test('the layout resolves to real directories for every tree', () => {
  assert.ok(existsSync(join(mobileTree(projectRoot), 'content/puzzle-catalog.json')), '移动端内容树不存在');
});
