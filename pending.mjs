import {createHash} from 'node:crypto';
import {existsSync, lstatSync, readFileSync, realpathSync} from 'node:fs';
import {join, relative, resolve, sep} from 'node:path';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const fail = message => {throw Object.assign(new Error(message), {status: 409, code: 'INVALID_PENDING_ASSET'});};
const idPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const digestPattern = /^[a-f0-9]{64}$/;
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const dimensions = item => plain(item) && Number.isSafeInteger(item.width) && item.width > 0 && Number.isSafeInteger(item.height) && item.height > 0;
function text(value, label, maximum, allowEmpty = false) {
  if (typeof value !== 'string' || value.length > maximum || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value) || (!allowEmpty && !value.trim())) fail('待整理素材' + label + '无效。');
  return value;
}
function inside(root, file) {
  const part = relative(root, file);
  return part !== '' && part !== '..' && !part.startsWith('..' + sep) && !/^[A-Za-z]:/.test(part) && !part.startsWith('\\\\');
}
function checkedChild(root, path, file = true) {
  if (typeof path !== 'string' || !path || path.includes('\\') || path.startsWith('/') || path.includes(':') || path.split('/').some(part => !part || part === '.' || part === '..') || /[\u0000-\u001f\u007f]/.test(path)) fail('待整理素材路径必须是登记目录内的相对路径。');
  const target = resolve(root, path);
  if (!inside(root, target)) fail('待整理素材路径超出登记目录。');
  let cursor = root;
  for (const part of relative(root, target).split(sep)) {
    cursor = join(cursor, part);
    if (lstatSync(cursor).isSymbolicLink()) fail('待整理素材路径含符号链接或目录联接。');
  }
  const real = realpathSync(target), stat = lstatSync(real);
  if (!inside(root, real) || (file ? !stat.isFile() : !stat.isDirectory())) fail('待整理素材路径不是登记目录内的普通' + (file ? '文件。' : '目录。'));
  return real;
}
function pngSize(bytes) {
  if (bytes.length < 33 || bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a' || bytes.toString('ascii', 12, 16) !== 'IHDR') fail('待整理原件必须是真实 PNG。');
  return {width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20)};
}
function webpSize(bytes) {
  if (bytes.length < 20 || bytes.toString('ascii', 0, 4) !== 'RIFF' || bytes.toString('ascii', 8, 12) !== 'WEBP' || bytes.readUInt32LE(4) + 8 !== bytes.length) fail('待整理交付文件必须是真实 WebP。');
  let frame = null, canvas = null, lossless = null, offset = 12;
  while (offset + 8 <= bytes.length) {
    const kind = bytes.toString('ascii', offset, offset + 4), length = bytes.readUInt32LE(offset + 4), start = offset + 8, end = start + length;
    if (end + (length % 2) > bytes.length) fail('待整理 WebP 区块不完整。');
    if (['ANIM', 'ANMF'].includes(kind)) fail('待整理交付必须是静态图片。');
    if (kind === 'VP8X') {
      if (canvas || length !== 10 || (bytes[start] & 0x02)) fail('待整理 WebP 画布无效。');
      canvas = {width: 1 + bytes.readUIntLE(start + 4, 3), height: 1 + bytes.readUIntLE(start + 7, 3)};
    } else if (kind === 'VP8L') {
      if (frame || length < 5 || bytes[start] !== 0x2f) fail('待整理无损 WebP 无效。');
      const bits = bytes.readUInt32LE(start + 1);
      frame = {width: 1 + (bits & 0x3fff), height: 1 + ((bits >>> 14) & 0x3fff)}; lossless = true;
    } else if (kind === 'VP8 ') {
      if (frame || length < 10 || (bytes[start] & 1) || bytes.toString('hex', start + 3, start + 6) !== '9d012a') fail('待整理有损 WebP 无效。');
      frame = {width: bytes.readUInt16LE(start + 6) & 0x3fff, height: bytes.readUInt16LE(start + 8) & 0x3fff}; lossless = false;
    }
    offset = end + (length % 2);
  }
  if (offset !== bytes.length || !frame || !frame.width || !frame.height || (canvas && (canvas.width !== frame.width || canvas.height !== frame.height))) fail('待整理 WebP 尺寸无效。');
  return {...frame, lossless};
}
function checkedImage(root, item, kind) {
  if (!dimensions(item) || !digestPattern.test(item.sha256 ?? '') || !Number.isSafeInteger(item.bytes) || item.bytes <= 0) fail('待整理图片尺寸或摘要记录无效。');
  const file = checkedChild(root, item.path), bytes = readFileSync(file);
  if (bytes.length !== item.bytes || sha(bytes) !== item.sha256) fail('待整理图片与已登记摘要或大小不一致：' + item.path);
  const size = kind === 'png' ? pngSize(bytes) : webpSize(bytes);
  if (size.width !== item.width || size.height !== item.height) fail('待整理图片尺寸与登记记录不一致：' + item.path);
  return {file, size};
}

/** One private provenance and delivery registry; it never joins a public package. */
export function readPendingAssets(projectRoot = resolve(import.meta.dirname, '..')) {
  const project = realpathSync(projectRoot), relativeRoot = 'content-admin/work/pending-assets', location = join(project, relativeRoot), registryPath = join(location, 'registry.json');
  if (!existsSync(location)) return {root: location, registryPath, assets: [], byId: new Map(), fingerprint: null};
  const root = checkedChild(project, relativeRoot, false);
  if (!existsSync(registryPath)) return {root, registryPath, assets: [], byId: new Map(), fingerprint: null};
  const bytes = readFileSync(checkedChild(root, 'registry.json'));
  let registry;
  try {registry = JSON.parse(bytes.toString('utf8'));} catch {fail('待整理素材登记无法读取。');}
  if (!plain(registry) || registry.schema !== 'jigsaw-pending-assets/v1' || !Array.isArray(registry.assets) || registry.assets.length > 2000) fail('待整理素材登记结构无效。');
  const ids = new Set();
  for (const asset of registry.assets) {
    if (!plain(asset) || !idPattern.test(asset.id ?? '') || asset.id.length > 96 || ids.has(asset.id)) fail('待整理素材 ID 无效或重复。');
    ids.add(asset.id);
    text(asset.title, '标题', 180); text(asset.subtitle, '副标题', 800, true);
    if (asset.styleGroupId !== null && (!idPattern.test(asset.styleGroupId ?? '') || asset.styleGroupId.length > 96)) fail('待整理素材画风无效。');
    if (!Array.isArray(asset.subjectTags) || asset.subjectTags.length > 30) fail('待整理素材题材标签无效。');
    for (const tag of asset.subjectTags) text(tag, '题材标签', 60);
    if (!['project-ai-generated', 'user-provided'].includes(asset.origin)) fail('待整理素材来源类型无效。');
    checkedImage(root, asset.source, 'png');
    const generation = asset.generation;
    if (!plain(generation) || !Array.isArray(generation.referencePaths) || generation.referencePaths.length > 30) fail('待整理素材生成记录无效。');
    text(generation.threadId, '来源会话', 96); text(generation.prompt, '实际提示词', 64000);
    if (!Number.isFinite(Date.parse(generation.generatedAt))) fail('待整理素材生成时间无效。');
    checkedImage(root, generation.native, 'png');
    for (const path of generation.referencePaths) checkedChild(root, path);
    const exported = asset.export;
    if (!dimensions(exported) || exported.originalPath !== asset.source.path || exported.width !== asset.source.width || exported.height !== asset.source.height || typeof exported.isUpscaled !== 'boolean') fail('待整理素材导出尺寸记录无效。');
    if ((asset.source.width > generation.native.width || asset.source.height > generation.native.height) && !exported.isUpscaled) fail('放大的待整理素材必须如实记录处理尺寸。');
    if (!plain(asset.review) || !['pending', 'reviewed', 'approved', 'rejected'].includes(asset.review.status)) fail('待整理素材审核状态无效。');
    const reviewed = ['reviewed', 'approved'].includes(asset.review.status);
    text(asset.review.reviewer, '审核人', 180, !reviewed);
    text(asset.review.notes, '审核说明', 8000, true);
    if (reviewed && !Number.isFinite(Date.parse(asset.review.reviewedAt))) fail('待整理素材审核时间无效。');
    if (!plain(asset.delivery) || asset.delivery.sourceSha256 !== asset.source.sha256) fail('待整理素材交付未关联登记原件。');
    for (const kind of ['thumbnail', 'play', 'optimized']) {
      const item = asset.delivery[kind];
      if (!plain(item) || item.format !== 'webp') fail('待整理素材 WebP 交付记录缺失。');
      const {size} = checkedImage(root, item, 'webp');
      if (kind === 'thumbnail') {
        if (item.width > 480 || item.height > 384 || item.width > asset.source.width || item.height > asset.source.height) fail('待整理素材缩略图超过尺寸预算。');
      } else {
        if (item.width !== asset.source.width || item.height !== asset.source.height) fail('待整理素材交付不得改变导出尺寸。');
        if (kind === 'play' && (item.lossless !== true || size.lossless !== true)) fail('待整理游玩交付必须无损。');
        if (kind === 'optimized' && (size.lossless !== false || item.quality !== 84 || (item.effort ?? item.encoding?.effort) !== 5 || (item.smartSubsample ?? item.encoding?.smartSubsample) !== true || item.bytes > 2 * 1024 * 1024)) fail('待整理压缩交付参数或体积不符。');
      }
    }
  }
  return {root, registryPath, assets: registry.assets, byId: new Map(registry.assets.map(asset => [asset.id, asset])), fingerprint: sha(bytes)};
}

/** Private preview reads verify the registered WebP again after startup. */
export function pendingPreviewFile(pending, id, kind = 'thumbnail') {
  if (!['thumbnail', 'preview'].includes(kind)) fail('不支持的待整理预览类型。');
  const asset = pending?.byId?.get(id);
  if (!asset) throw Object.assign(new Error('待整理图片未登记。'), {status: 404});
  const entry = asset.delivery[kind === 'thumbnail' ? 'thumbnail' : 'optimized'];
  return checkedImage(pending.root, entry, 'webp').file;
}
