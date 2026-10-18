// Import a picture from the admin console: compress it to the delivery spec and
// register it in the private pending registry, so 「提交到双端」 can ship it.
//
// The whole point is that the operator keeps only the original PNG. Everything
// the runtimes need (Q70 / total pixels at most 6,553,600, plus a 384 thumbnail) is produced
// here with sharp, using the same parameters the release checker verifies.
import {createHash, randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import {existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {dirname, join, resolve} from 'node:path';
import {deliveryDimensions, MAX_DELIVERY_PIXELS} from './delivery-spec.mjs';

const REQUIRE_FROM = 'D:/chat/拼图/jigsaw-nook-taptap/package.json';
const QUALITY = 70;
const THUMB_BOX = 384;
const THUMB_QUALITY = 82;

// Delivery spec, kept in one place so the importer and the checkers agree.
export const IMAGE_SPEC = {maxPixels: MAX_DELIVERY_PIXELS, quality: QUALITY, thumbBox: THUMB_BOX, thumbQuality: THUMB_QUALITY, effort: 6};

const failure = (message, code = 'INVALID_IMPORT', status = 409) => Object.assign(new Error(message), {code, status});
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const slug = value => String(value || '')
  .normalize('NFKD')
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-+|-+$/g, '')
  .slice(0, 60);

function sharpModule() {
  try {
    return createRequire(REQUIRE_FROM)('sharp');
  } catch {
    throw failure('本机缺少 sharp，无法压缩图片。请先在 jigsaw-nook-taptap 目录安装依赖。', 'SHARP_MISSING', 503);
  }
}

/** Decode the uploaded bytes once and reject anything sharp cannot read. */
async function decode(sharp, bytes) {
  const image = sharp(bytes, {failOn: 'error'});
  const meta = await image.metadata().catch(() => null);
  if (!meta || !meta.width || !meta.height) throw failure('无法读取这张图片，请换一张 PNG 或 JPG。');
  if (!['png', 'jpeg', 'webp'].includes(meta.format)) throw failure('只接受 PNG、JPG 或 WebP 图片。');
  if (Math.min(meta.width, meta.height) < 240) throw failure('图片太小，短边至少 240 像素。');
  return meta;
}

async function encode(sharp, bytes, {width, height}, {quality, box, smartSubsample = true}) {
  let pipeline = sharp(bytes, {failOn: 'error'}).rotate();
  // Optimized delivery uses a total-pixel cap; thumbnails keep their fixed box.
  // `withoutEnlargement` leaves smaller pictures at their own size.
  const limit = box ?? deliveryDimensions(width, height, IMAGE_SPEC.maxPixels);
  pipeline = pipeline.resize({width: limit.width ?? limit, height: limit.height ?? limit, fit: 'inside', withoutEnlargement: true});
  const buffer = await pipeline.webp({quality, effort: IMAGE_SPEC.effort, smartSubsample}).toBuffer();
  const meta = await sharp(buffer).metadata();
  return {buffer, width: meta.width, height: meta.height};
}

/**
 * Compress one uploaded file and write the registry entry.
 * `draft` carries the operator's metadata: title, subtitle, style, tags, prompt, origin.
 */
async function importOne({sharp, bytes, originalName, draft, pendingRoot, batchDir, baseUrl, project}) {
  const meta = await decode(sharp, bytes);
  // A Chinese title leaves nothing for a slug, so fall back to a dated sequence
  // rather than colliding on a shared prefix.
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const explicit = slug(draft.id || '');
  const base = slug(draft.title);
  // An explicit id is used verbatim so a re-import can be refused rather than
  // silently duplicating; otherwise the title seeds a name, with a short suffix.
  const id = explicit || (base ? `${base}-${randomUUID().slice(0, 4)}` : `img-${stamp}-${randomUUID().slice(0, 6)}`);
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)) throw failure('图片 ID 只能是小写字母、数字和连字符：' + id);

  const batchPath = join(pendingRoot, batchDir);
  for (const dir of ['originals', 'native', 'delivery']) mkdirSync(join(batchPath, dir), {recursive: true});

  // The uploaded file is both the original and the generation source: the console
  // cannot know anything better, and the checker needs a real PNG byte match.
  const originalName_ = id + '.png';
  const sourceBytes = meta.format === 'png' ? bytes : await sharp(bytes).png({compressionLevel: 9}).toBuffer();
  const sourcePath = join(batchPath, 'originals', originalName_);
  const nativePath = join(batchPath, 'native', originalName_);
  writeFileSync(sourcePath, sourceBytes);
  writeFileSync(nativePath, sourceBytes);
  const sourceSize = statSync(sourcePath).size;
  const sourceHash = sha(sourceBytes);

  const playable = await encode(sharp, sourceBytes, {width: meta.width, height: meta.height}, {quality: QUALITY, box: null});
  const thumb = await encode(sharp, sourceBytes, {width: meta.width, height: meta.height}, {quality: THUMB_QUALITY, box: {width: THUMB_BOX, height: THUMB_BOX}, smartSubsample: false});

  const deliveryOf = (kind, result, extra) => {
    const digest = sha(result.buffer);
    const name = `${id}-${kind}-${digest.slice(0, 12)}.webp`;
    writeFileSync(join(batchPath, 'delivery', name), result.buffer);
    return {
      path: `${batchDir}/delivery/${name}`,
      width: result.width,
      height: result.height,
      sha256: digest,
      bytes: result.buffer.length,
      format: 'webp',
      lossless: false,
      sourceSha256: sourceHash,
      inputSha256: sourceHash,
      ...extra,
    };
  };

  const optimized = deliveryOf('optimized', playable, {
    quality: QUALITY, upscaled: false, effort: IMAGE_SPEC.effort, smartSubsample: true,
    encoding: {library: 'sharp', version: sharp.versions.sharp, effort: IMAGE_SPEC.effort, smartSubsample: true},
  });
  const thumbnail = deliveryOf('thumbnail', thumb, {
    quality: THUMB_QUALITY, upscaled: false,
    encoding: {library: 'sharp', version: sharp.versions.sharp, effort: IMAGE_SPEC.effort},
  });

  const now = new Date().toISOString();
  const asset = {
    id,
    title: draft.title,
    subtitle: draft.subtitle ?? '',
    styleGroupId: draft.styleGroupId ?? null,
    subjectTags: Array.isArray(draft.subjectTags) ? draft.subjectTags : [],
    origin: draft.origin,
    status: 'accepted',
    width: meta.width,
    height: meta.height,
    source: {path: `${batchDir}/originals/${originalName_}`, sha256: sourceHash, bytes: sourceSize, width: meta.width, height: meta.height, format: 'png'},
    generation: {
      provider: draft.provider || 'uploaded',
      tool: draft.tool || 'admin-upload',
      method: draft.method || 'Uploaded original; WebP delivery encoded at Q70',
      native: {path: `${batchDir}/native/${originalName_}`, sha256: sourceHash, bytes: sourceSize, width: meta.width, height: meta.height, format: 'png'},
      prompt: draft.prompt || '（后台上传，未记录生成提示词）',
      threadId: draft.threadId || 'admin-upload',
      generatedAt: draft.generatedAt || now,
      referencePaths: [],
    },
    export: {originalPath: `${batchDir}/originals/${originalName_}`, width: meta.width, height: meta.height, isUpscaled: false},
    review: {status: 'reviewed', reviewer: draft.reviewer || 'admin', reviewedAt: now, notes: draft.notes || '后台导入并自动压缩。'},
    delivery: {sourceSha256: sourceHash, optimized, thumbnail},
    importedFrom: originalName,
  };
  return asset;
}

/** Write the batch into the private registry, refusing to overwrite an existing ID. */
export function createImageImporter({projectRoot, pendingRoot, registryPath, dataDir} = {}) {
  const project = resolve(projectRoot ?? 'D:/chat/拼图');
  const pending = resolve(pendingRoot ?? join(project, 'content-admin/work/pending-assets'));
  const registry = resolve(registryPath ?? join(pending, 'registry.json'));
  const work = resolve(dataDir ?? join(project, 'content-admin/work'));

  async function run(files, drafts, {actor = 'admin'} = {}) {
    if (!Array.isArray(files) || !files.length) throw failure('请至少选择一张图片。');
    if (files.length > 20) throw failure('一次最多导入 20 张。');
    const sharp = sharpModule();
    const batchDir = 'admin-import-' + new Date().toISOString().replace(/[-:.]/g, '').slice(0, 15);

    const current = existsSync(registry)
      ? JSON.parse(readFileSync(registry, 'utf8'))
      : {schema: 'jigsaw-pending-assets/v1', assets: []};
    if (!Array.isArray(current.assets)) throw failure('待整理素材登记结构无效。');
    const existing = new Set(current.assets.map(asset => asset.id));

    const imported = [];
    const failures = [];
    const staging = join(pending, batchDir);
    try {
      for (let index = 0; index < files.length; index += 1) {
        const draft = drafts[index] ?? {};
        const title = String(draft.title || files[index].name.replace(/\.[^.]+$/, '')).trim().slice(0, 180);
        if (!title) { failures.push({name: files[index].name, reason: '缺标题'}); continue; }
        try {
          const asset = await importOne({
            sharp, bytes: files[index].bytes, originalName: files[index].name,
            draft: {...draft, title, id: draft.id ? slug(draft.id) : undefined},
            pendingRoot: pending, batchDir, project,
          });
          if (existing.has(asset.id)) throw failure('图片 ID 已存在：' + asset.id);
          existing.add(asset.id);
          imported.push(asset);
        } catch (error) {
          failures.push({name: files[index].name, reason: error.message});
        }
      }
      if (!imported.length) throw failure('没有图片导入成功：' + (failures[0]?.reason ?? '未知原因'));

      current.assets = [...current.assets, ...imported];
      const temporary = registry + '.import-' + randomUUID();
      writeFileSync(temporary, JSON.stringify(current, null, 1) + '\n');
      renameSync(temporary, registry);

      mkdirSync(work, {recursive: true});
      const receipt = {
        schema: 'jigsaw-admin-import/v1',
        at: new Date().toISOString(),
        actor,
        batch: batchDir,
        spec: IMAGE_SPEC,
        imported: imported.map(asset => ({
          id: asset.id, title: asset.title,
          sourceBytes: asset.source.bytes,
          optimizedBytes: asset.delivery.optimized.bytes,
          width: asset.delivery.optimized.width, height: asset.delivery.optimized.height,
        })),
        failures,
      };
      writeFileSync(join(work, 'admin-imports.json'), JSON.stringify(receipt, null, 2) + '\n');
      return receipt;
    } catch (error) {
      // Keep the registry untouched; drop the half-written batch directory.
      if (existsSync(staging)) rmSync(staging, {recursive: true, force: true});
      throw error;
    }
  }

  /**
   * Write the freshly imported pictures into both project catalogues, so they
   * appear in 全部图片 and can be dragged into an album. Reuses the offline
   * delivery script, which already verifies every byte it copies.
   */
  function register(ids, {actor = 'admin'} = {}) {
    if (!Array.isArray(ids) || !ids.length) throw failure('没有需要入库的图片。');
    const script = join(project, 'content-admin/scripts/prepare-pending-delivery.mjs');
    const evidence = join(work, 'admin-import-register-' + new Date().toISOString().replace(/[-:.]/g, '').slice(0, 15));
    mkdirSync(evidence, {recursive: true});
    const results = [];
    for (const target of [join(project, 'jigsaw-nook-taptap'), join(project, 'work/dual-managed-release-20261014')]) {
      const outcome = spawnSync(process.execPath, [
        script, '--target=' + target, '--ids=' + ids.join(','), '--evidence=' + evidence, '--apply',
      ], {encoding: 'utf8', windowsHide: true, env: {...process.env, NODE_OPTIONS: ''}});
      if (outcome.status !== 0) {
        const detail = String(outcome.stderr || outcome.stdout || '').trim().split(/\r?\n/).slice(-3).join(' ');
        throw failure('图片已压缩并登记，但写入图库失败：' + (detail || '未知错误'), 'REGISTER_FAILED');
      }
      results.push({target, ok: true});
    }
    return {ids, evidence, targets: results, actor};
  }

  return {run, register, spec: IMAGE_SPEC};
}
