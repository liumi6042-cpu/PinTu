// Private staging only. This tool never changes either game's catalog, original
// artwork, delivery directory, manifest, runtime data, or production service.
import assert from 'node:assert/strict';
import {createHash, randomBytes} from 'node:crypto';
import fs from 'node:fs/promises';
import {existsSync, lstatSync, realpathSync} from 'node:fs';
import {createRequire} from 'node:module';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const cmsRoot = realpathSync(path.resolve(import.meta.dirname, '..'));
const projectRoot = path.resolve(cmsRoot, '..');
const privateRoot = path.join(cmsRoot, 'work', 'pending-assets');
const gameRequire = createRequire(path.join(projectRoot, 'jigsaw-nook-taptap', 'package.json'));
const sha = data => createHash('sha256').update(data).digest('hex');
const idPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const json = value => JSON.stringify(value, null, 2) + '\n';

function fail(message) {throw new Error(message);}
function within(root, value, allowRoot = false) {
  const relative = path.relative(root, value);
  return (allowRoot || relative !== '') && !path.isAbsolute(relative) && relative !== '..' && !relative.startsWith('..' + path.sep);
}
function outputRoot(value) {
  if (typeof value !== 'string' || !value.trim()) fail('--output 必须指定私有待入库目录。');
  // Resolve the existing compatibility workspace junction before enforcing the
  // private physical root, including when the final staging directory is new.
  const requested = path.isAbsolute(value) ? path.resolve(value) : path.resolve(realpathSync(process.cwd()), value);
  let ancestor = requested;
  const missing = [];
  while (!existsSync(ancestor)) {
    const parent = path.dirname(ancestor);
    if (parent === ancestor) fail('输出路径没有可解析的本机父目录。');
    missing.unshift(path.basename(ancestor));
    ancestor = parent;
  }
  const absolute = path.resolve(realpathSync(ancestor), ...missing);
  if (!within(privateRoot, absolute, true)) fail('输出必须位于 content-admin/work/pending-assets 内，禁止写入游戏或公开目录。');
  let cursor = cmsRoot;
  for (const part of path.relative(cmsRoot, absolute).split(path.sep)) {
    cursor = path.join(cursor, part);
    if (existsSync(cursor) && lstatSync(cursor).isSymbolicLink()) fail('输出路径不能包含符号链接或目录联接。');
  }
  return absolute;
}
function string(value, label, max, allowEmpty = false) {
  if (typeof value !== 'string' || value.length > max || value.includes('\0')) fail(label + '类型或长度不合法。');
  value = value.trim();
  if (!allowEmpty && !value) fail(label + '不能为空。');
  return value;
}
function absoluteInput(value, label) {
  value = string(value, label, 4096);
  if (!path.isAbsolute(value)) fail(label + '必须是原始来源的绝对路径。');
  return path.normalize(value);
}
function pngDimensions(data, label) {
  if (data.length < 24 || data.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') fail(label + '必须是真实 PNG，不能仅改扩展名。');
  const width = data.readUInt32BE(16), height = data.readUInt32BE(20);
  if (!width || !height || width * height > 100_000_000) fail(label + '尺寸不合法或超过入库上限。');
  return {width, height};
}
async function pngFile(filename, sharp, label) {
  const actual = await fs.realpath(filename), stat = await fs.stat(actual);
  if (!stat.isFile() || stat.size > 128 * 1024 * 1024) fail(label + '不是普通文件或超过 128 MiB。');
  const bytes = await fs.readFile(actual), size = pngDimensions(bytes, label), metadata = await sharp(bytes).metadata();
  if (metadata.format !== 'png' || metadata.width !== size.width || metadata.height !== size.height || (metadata.pages ?? 1) !== 1)
    fail(label + '元数据不一致或是多帧图片。');
  return {bytes, originalPath: actual, record: {sha256: sha(bytes), bytes: bytes.length, ...size, format: 'png'}};
}
function normalizeManifest(input) {
  if (!Array.isArray(input) || !input.length || input.length > 100) fail('manifest 必须是 1–100 张记录的 JSON 数组。');
  const seen = new Set();
  const allowed = ['exportPath', 'nativePath', 'id', 'title', 'subtitle', 'styleGroupId', 'subjectTags', 'prompt', 'threadId', 'generatedAt', 'referencePaths', 'review'];
  return input.map((value, index) => {
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !allowed.includes(key))) fail('manifest 第 ' + index + ' 条包含未知字段。');
    const id = string(value.id, '图片 ID', 96);
    if (!idPattern.test(id) || seen.has(id)) fail('图片 ID 非法或重复：' + id);
    seen.add(id);
    const styleGroupId = value.styleGroupId == null ? null : string(value.styleGroupId, '画风 ID', 96);
    if (styleGroupId !== null && !idPattern.test(styleGroupId)) fail('画风 ID 非法。');
    if (!Array.isArray(value.subjectTags) || value.subjectTags.length > 30) fail('题材标签必须是最多 30 项的数组。');
    const subjectTags = [...new Set(value.subjectTags.map(tag => string(tag, '题材标签', 60)))];
    if (!Array.isArray(value.referencePaths) || value.referencePaths.length > 16) fail('参考原图路径必须是最多 16 项的数组。');
    const referencePaths = [...new Set(value.referencePaths.map(value => absoluteInput(value, '参考原图路径')))];
    const generatedAt = string(value.generatedAt, '生成时间', 100);
    if (!Number.isFinite(Date.parse(generatedAt))) fail('生成时间不是有效日期。');
    let review = {status: 'pending'};
    if (value.review !== undefined) {
      if (!value.review || typeof value.review !== 'object' || Array.isArray(value.review) || !['reviewed', 'pending', 'rejected'].includes(value.review.status)) fail('review 需提供真实审核对象和合法状态。');
      review = structuredClone(value.review);
      if (review.status === 'reviewed') {
        string(review.reviewer, '审核人', 200);
        string(review.reviewedAt, '审核时间', 100);
        if (!Number.isFinite(Date.parse(review.reviewedAt))) fail('审核时间不是有效日期。');
        const notes = Array.isArray(review.notes) ? review.notes : [review.notes];
        if (!notes.length || notes.length > 100) fail('已审核图片必须有真实审核观察。');
        notes.forEach(item => string(item, '审核观察', 10000));
      }
    }
    return {id, title: string(value.title, '标题', 180), subtitle: string(value.subtitle ?? '', '副标题', 800, true), styleGroupId, subjectTags,
      exportPath: absoluteInput(value.exportPath, '4K 导出文件'), nativePath: absoluteInput(value.nativePath, '生成原生文件'),
      prompt: string(value.prompt, '原始生成提示词', 100000), threadId: string(value.threadId, '来源会话 ID', 200),
      generatedAt, referencePaths, review};
  });
}
async function assertFreshIds(records) {
  for (const name of ['puzzle-play', 'jigsaw-nook-taptap']) {
    const catalog = JSON.parse(await fs.readFile(path.join(projectRoot, name, 'content/puzzle-catalog.json'), 'utf8'));
    const existing = new Set(catalog.map(photo => photo.id));
    for (const record of records) if (existing.has(record.id)) fail('新导入 ID 与现有历史图片冲突，禁止覆盖：' + record.id);
  }
}

export async function buildPendingImport({manifestPath, outputDir}) {
  const output = outputRoot(outputDir);
  const manifest = normalizeManifest(JSON.parse((await fs.readFile(path.resolve(manifestPath), 'utf8')).replace(/^\uFEFF/, '')));
  await assertFreshIds(manifest);
  if (existsSync(output) && (await fs.readdir(output)).length) fail('待入库输出目录必须为空；已有批次不能覆盖，请使用新的私有子目录。');
  const sharp = gameRequire('sharp');
  sharp.concurrency(1);
  sharp.cache({memory: 32, files: 5, items: 20});
  const outputFiles = new Map(), assets = [], missingReferences = [];
  // All source files are validated before making a private batch directory.
  const sourcePairs = [];
  for (const item of manifest) {
    const source = await pngFile(item.exportPath, sharp, item.id + ' 导出原件');
    const native = await pngFile(item.nativePath, sharp, item.id + ' 原生生成结果');
    // Keep only facts after preflight; a 53-image batch must not retain every
    // original PNG in memory while the offline encoder is working.
    sourcePairs.push({item, source: {originalPath: source.originalPath, record: source.record}, native: {originalPath: native.originalPath, record: native.record}});
  }
  await fs.mkdir(output, {recursive: true});
  const lockPath = path.join(output, '.build-lock');
  await fs.writeFile(lockPath, json({schema: 'jigsaw-pending-build-lock/v1', pid: process.pid, startedAt: new Date().toISOString()}), {flag: 'wx'});
  async function save(relative, bytes) {
    if (!/^(?:originals|native|references|delivery)\/[a-z0-9-]+\.(?:png|webp)$/.test(relative)) fail('生成路径不合法。');
    const file = path.join(output, ...relative.split('/'));
    const digest = sha(bytes);
    if (outputFiles.has(relative)) {assert.equal(outputFiles.get(relative), digest, '同名交付文件 SHA 冲突'); return;}
    await fs.mkdir(path.dirname(file), {recursive: true});
    await fs.writeFile(file, bytes, {flag: 'wx'});
    outputFiles.set(relative, digest);
  }
  async function delivery(item, source, kind, bytes, options) {
    const metadata = await sharp(bytes).metadata();
    assert.equal(metadata.format, 'webp', '交付格式必须是 WebP');
    if (kind === 'thumbnail') {
      assert.ok(metadata.width <= 480 && metadata.height <= 384, '缩略图超出预算');
      assert.ok(metadata.width <= source.record.width && metadata.height <= source.record.height, '缩略图不可放大');
    } else {
      assert.equal(metadata.width, source.record.width, '交付编码不允许改变宽度');
      assert.equal(metadata.height, source.record.height, '交付编码不允许改变高度');
    }
    if (kind === 'optimized' && bytes.length > 2 * 1024 * 1024) fail(item.id + ' optimized 超过 2 MiB；请人工复核，脚本不会自动缩尺寸或降质量。');
    const digest = sha(bytes), relative = 'delivery/' + item.id + '-' + kind + '-' + digest.slice(0, 12) + '.webp';
    await save(relative, bytes);
    return {path: relative, width: metadata.width, height: metadata.height, sha256: digest, bytes: bytes.length,
      format: 'webp', lossless: kind === 'play', quality: kind === 'play' ? null : kind === 'thumbnail' ? 82 : 84,
      upscaled: false, sourceSha256: source.record.sha256, inputSha256: source.record.sha256,
      encoding: {library: 'sharp', version: sharp.versions.sharp, ...options}};
  }
  try {
    let completed = 0;
    for (const {item, source, native} of sourcePairs) {
      const sourceBytes = await fs.readFile(source.originalPath);
      assert.equal(sha(sourceBytes), source.record.sha256, item.id + ' 导出原件在预检后发生变化');
      const nativeBytes = native.record.sha256 === source.record.sha256 ? sourceBytes : await fs.readFile(native.originalPath);
      assert.equal(sha(nativeBytes), native.record.sha256, item.id + ' 原生结果在预检后发生变化');
      const sourcePath = 'originals/' + item.id + '.png';
      await save(sourcePath, sourceBytes);
      const sourceRecord = {path: sourcePath, ...source.record};
      const nativePath = native.record.sha256 === source.record.sha256 ? sourcePath : 'native/' + item.id + '.png';
      if (nativePath !== sourcePath) await save(nativePath, nativeBytes);
      const references = [];
      for (const referencePath of item.referencePaths) {
        let reference;
        try {reference = await pngFile(referencePath, sharp, item.id + ' 风格参考');}
        catch (error) {if (error.code === 'ENOENT') {missingReferences.push({id: item.id, originalPath: referencePath}); continue;} throw error;}
        const relative = 'references/' + reference.record.sha256.slice(0, 12) + '.png';
        await save(relative, reference.bytes);
        references.push(relative);
      }
      // Pillow's existing preparation uses RGB, lossless method=6 and
      // thumbnail quality=82/method=6. Sharp effort is libwebp's method setting.
      const playBytes = await sharp(sourceBytes).removeAlpha().toColourspace('srgb').webp({lossless: true, effort: 6}).toBuffer();
      const expectedRgb = await sharp(sourceBytes).removeAlpha().toColourspace('srgb').raw().toBuffer();
      const decodedRgb = await sharp(playBytes).removeAlpha().toColourspace('srgb').raw().toBuffer();
      assert.ok(expectedRgb.equals(decodedRgb), item.id + ' lossless 解码像素必须与 PNG RGB 完全一致');
      const thumbnailBytes = await sharp(sourceBytes).removeAlpha().toColourspace('srgb')
        .resize({width: 480, height: 384, fit: 'inside', withoutEnlargement: true, kernel: 'lanczos3'})
        .webp({quality: 82, effort: 6}).toBuffer();
      // Identical optimized options to prepare-optimized-delivery.mjs; no resize.
      const optimizedBytes = await sharp(sourceBytes).webp({quality: 84, effort: 5, smartSubsample: true}).toBuffer();
      const play = await delivery(item, source, 'play', playBytes, {effort: 6});
      const thumbnail = await delivery(item, source, 'thumbnail', thumbnailBytes, {effort: 6, kernel: 'lanczos3'});
      const optimized = await delivery(item, source, 'optimized', optimizedBytes, {effort: 5, smartSubsample: true});
      assets.push({id: item.id, title: item.title, subtitle: item.subtitle, styleGroupId: item.styleGroupId,
        subjectTags: item.subjectTags, origin: 'project-ai-generated', status: item.review.status === 'reviewed' ? 'accepted' : 'pending-review',
        width: source.record.width, height: source.record.height, source: sourceRecord,
        generation: {provider: 'OpenAI', tool: 'image_gen', native: {path: nativePath, ...native.record}, prompt: item.prompt,
          threadId: item.threadId, generatedAt: item.generatedAt, referencePaths: [...new Set(references)]},
        export: {originalPath: sourcePath, width: source.record.width, height: source.record.height, isUpscaled: true},
        review: item.review, delivery: {sourceSha256: source.record.sha256, play, thumbnail, optimized}});
      console.error(`已完成 ${++completed}/${manifest.length} ${item.id}，optimized ${optimized.bytes} 字节`);
    }
    // Recheck explicit input files before committing the registry. Original
    // session output files are not rewritten or treated as mutable uploads.
    for (const {item, source, native} of sourcePairs) {
      assert.equal(sha(await fs.readFile(item.exportPath)), source.record.sha256, item.id + ' 导出原件在编码期间发生变化');
      assert.equal(sha(await fs.readFile(item.nativePath)), native.record.sha256, item.id + ' 原生结果在编码期间发生变化');
    }
    const registry = {schema: 'jigsaw-pending-assets/v1', createdAt: new Date().toISOString(), assets};
    const temporary = path.join(output, '.registry-' + randomBytes(8).toString('hex') + '.json');
    await fs.writeFile(temporary, json(registry), {flag: 'wx'});
    // Publishing a hard link creates the complete JSON atomically and refuses an
    // existing registry. No game content or public resource manifest is touched.
    await fs.link(temporary, path.join(output, 'registry.json'));
    await fs.unlink(temporary);
    return {directory: output, registryPath: path.join(output, 'registry.json'), assets: assets.length,
      accepted: assets.filter(asset => asset.status === 'accepted').length, fileCount: outputFiles.size,
      deliveryBytes: assets.reduce((total, asset) => total + asset.delivery.play.bytes + asset.delivery.thumbnail.bytes + asset.delivery.optimized.bytes, 0),
      missingReferences, scope: 'Private pending CMS assets only; no game catalog changes'};
  } finally {
    await fs.unlink(lockPath);
  }
}

function args(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index], value = argv[index + 1];
    if (!['--manifest', '--output'].includes(flag) || !value || value.startsWith('--') || Object.hasOwn(values, flag))
      fail('用法：node scripts/build-pending-import.mjs --manifest <私有JSON路径> --output <work/pending-assets目录>');
    values[flag] = value;
  }
  if (!values['--manifest'] || !values['--output']) fail('必须同时指定 --manifest 和 --output。');
  return {manifestPath: values['--manifest'], outputDir: values['--output']};
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  try {console.log(json(await buildPendingImport(args(process.argv.slice(2)))));}
  catch (error) {console.error(error.message); process.exitCode = 1;}
}
