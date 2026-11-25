// Offline, explicit promotion of reviewed private artwork. Default is a plan only.
// Keeps managed IDs and existing catalog text; never touches the admin database,
// legacy puzzle-play project, runtime ports, player data or a remote service.
import assert from 'node:assert/strict';
import {createHash, randomUUID} from 'node:crypto';
import {copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, renameSync, writeFileSync} from 'node:fs';
import {basename, dirname, isAbsolute, join, relative, resolve, sep} from 'node:path';
import {readPendingAssets} from '../pending.mjs';
import {webTree} from '../project-layout.mjs';

const project = realpathSync(resolve(import.meta.dirname, '../..'));
const allowed = new Map([
  [realpathSync(join(project, 'jigsaw-nook-taptap')), 'mobile'],
  [realpathSync(webTree(project)), 'web'],
]);
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const json = value => JSON.stringify(value, null, 2) + '\n';
const options = {apply: false, target: null, ids: null, evidence: null};
for (const argument of process.argv.slice(2)) {
  if (argument === '--apply' && !options.apply) options.apply = true;
  else if (argument.startsWith('--target=') && !options.target) options.target = argument.slice(9);
  else if (argument.startsWith('--ids=') && !options.ids) options.ids = argument.slice(6).split(',');
  else if (argument.startsWith('--evidence=') && !options.evidence) options.evidence = argument.slice(11);
  else throw Error('Usage: node content-admin/scripts/prepare-pending-delivery.mjs [--target=<absolute allowed project>] [--ids=id,id --evidence=<absolute private directory>] [--apply]');
}
if (options.apply && !options.target) throw Error('--apply requires one explicit absolute --target.');
if (options.target && !isAbsolute(options.target)) throw Error('--target must be an absolute path.');
const targets = options.target ? [realpathSync(options.target)] : [...allowed.keys()];
for (const target of targets) if (!allowed.has(target)) throw Error('Only the mobile project and the registered Web release worktree are allowed; puzzle-play is never modified.');
if (options.ids && (!options.ids.length || new Set(options.ids).size !== options.ids.length || options.ids.some(id=>!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)))) throw Error('--ids must list distinct valid image IDs.');
if (options.ids && !options.evidence) throw Error('A filtered batch requires a separate --evidence directory.');
if (options.evidence && !isAbsolute(options.evidence)) throw Error('--evidence must be an absolute private directory.');
const evidence = options.evidence ? child(join(project,'content-admin/work'),relative(join(project,'content-admin/work'),resolve(options.evidence)).split(sep).join('/')) : join(project, 'content-admin/work/image-delivery-20261014');

function child(root, name) {
  assert.equal(typeof name, 'string');
  assert.ok(name && !name.includes('\\') && !name.includes(':') && !name.startsWith('/') && !name.split('/').some(part => !part || part === '.' || part === '..'));
  const target = resolve(root, name), part = relative(root, target);
  assert.ok(part && part !== '..' && !part.startsWith('..' + sep) && !isAbsolute(part));
  let cursor = root;
  for (const segment of part.split(sep)) {
    cursor = join(cursor, segment);
    if (existsSync(cursor)) assert.ok(!lstatSync(cursor).isSymbolicLink(), 'A delivery target cannot traverse a link: ' + cursor);
  }
  return target;
}
function assertBytes(file, expected) {
  const bytes = readFileSync(file);
  assert.equal(bytes.length, expected.bytes, 'File size differs: ' + file);
  assert.equal(sha(bytes), expected.sha256, 'File hash differs: ' + file);
}
function appendArray(text, entries) {
  if (!entries.length) return text;
  const end = text.search(/\]\s*$/);
  assert.ok(end >= 0, 'Expected a JSON array.');
  const prefix = text.slice(0, end).replace(/\s+$/, '');
  const result = prefix + (JSON.parse(text).length ? ',' : '') + '\n' + entries.map(entry => JSON.stringify(entry, null, 2).split('\n').map(line => '  ' + line).join('\n')).join(',\n') + '\n' + text.slice(end);
  assert.deepEqual(JSON.parse(result).slice(0, JSON.parse(text).length), JSON.parse(text));
  return result;
}
function appendObject(text, entries) {
  if (!Object.keys(entries).length) return text;
  const end = text.search(/\}\s*$/);
  assert.ok(end >= 0, 'Expected a JSON object.');
  const prefix = text.slice(0, end).replace(/\s+$/, '');
  const inner = JSON.stringify(entries, null, 2).slice(2, -2);
  const result = prefix + (Object.keys(JSON.parse(text)).length ? ',' : '') + '\n' + inner + '\n' + text.slice(end);
  for (const [key, value] of Object.entries(JSON.parse(text))) assert.deepEqual(JSON.parse(result)[key], value);
  return result;
}
function writeNewOrSame(file, bytes) {
  if (existsSync(file)) {
    assert.ok(readFileSync(file).equals(Buffer.from(bytes)), 'Refusing to overwrite differing evidence: ' + file);
    return;
  }
  mkdirSync(dirname(file), {recursive: true});
  writeFileSync(file, bytes, {flag: 'wx'});
}
function atomicWrite(file, bytes) {
  const temporary = file + '.pending-delivery-' + randomUUID();
  writeFileSync(temporary, bytes, {flag: 'wx'});
  renameSync(temporary, file);
}

const pending = readPendingAssets(project); // Validates originals, natives and all WebP hashes/dimensions.
assert.ok(pending.assets.length > 0, 'No pending artwork.');
const selected = options.ids ? options.ids.map(id=>{const asset=pending.byId.get(id);assert.ok(asset,'Unknown pending ID: '+id);return asset;}) : pending.assets;
assert.ok(selected.every(asset => asset.origin === 'project-ai-generated' && ['reviewed','approved'].includes(asset.review.status)), 'Every promoted asset must have verified project generation provenance and completed review.');
const nativeParents = new Map(pending.assets.map(asset => [asset.generation.native.sha256, asset]));
const sourceFiles = new Map();
function copyPlan(from, to, record) {
  const previous = sourceFiles.get(to);
  const item = {from, to, bytes: record.bytes, sha256: record.sha256};
  if (previous) assert.deepEqual(previous, item, 'Duplicate target has different source facts.');
  sourceFiles.set(to, item);
  return to;
}
const OPENAI_TERMS='https://openai.com/policies/row-terms-of-use/';
const DOUBAO_TERMS='https://docs.volcengine.com/docs/ark/doubao-model-service-agreement?lang=zh';
const additions = selected.map(asset => {
  const id = asset.id, native = asset.generation.native;
  const hybrid=asset.generation.method==='builtin-original-reference-redraw';
  const stages=asset.generation.stages;
  if(hybrid){
    assert.equal(asset.generation.provider,'Volcengine Ark');assert.equal(asset.generation.tool,'images/generations');
    assert.match(asset.generation.model,/^doubao-seedream-[a-z0-9-]+$/);
    assert.equal(stages?.length,2);assert.equal(stages[0].role,'original-artwork');assert.equal(stages[0].provider,'OpenAI');assert.equal(stages[0].tool,'image_gen');
    assert.equal(stages[1].role,'reference-hd-redraw');
    for(const key of ['provider','tool','model','prompt','generatedAt'])assert.equal(stages[1][key],asset.generation[key]);
    for(const key of ['sha256','width','height','bytes'])assert.equal(stages[1].native[key],asset.source[key]);
    assert.equal(asset.export.isUpscaled,false);assert.ok(stages[0].evidence.length&&stages[1].evidence.length===2);
  // `admin-upload` is a picture the operator supplied through the console; it has
  // no generation prompt, and its provenance says so instead of inventing one.
  // A single-stage Doubao redraw records its provider and model directly; accept it
  // only when those two facts match the model family, never an arbitrary tool name.
  }else if(asset.generation.tool==='Ark Images Generations API'){
    assert.equal(asset.generation.provider,'ByteDance Doubao','Unknown provider for the Ark adapter.');
    assert.match(asset.generation.model,/^doubao-seedream-[a-z0-9.-]+$/);
  }else assert.ok(['image_gen','admin-upload'].includes(asset.generation.tool),'Unknown generation tool requires its own reviewed import adapter.');
  const sourcePath = copyPlan(join(pending.root, asset.source.path), 'public/puzzles/' + id + '.png', asset.source);
  const nativePath = copyPlan(join(pending.root, native.path), 'content/artwork/gallery-hd/' + id + '/native.png', native);
  const delivery = {sourceSha256: asset.source.sha256};
  // Two delivery files since 2026-10-17. A legacy `play` entry may still exist on
  // older registrations; it is copied for the rooms that already reference it.
  const kinds = asset.delivery.play ? ['play', 'thumbnail', 'optimized'] : ['thumbnail', 'optimized'];
  for (const kind of kinds) {
    const {path, ...facts} = asset.delivery[kind];
    const src = '/puzzles/' + basename(path);
    assert.equal(src, '/puzzles/' + id + '-' + kind + '-' + facts.sha256.slice(0, 12) + '.webp');
    copyPlan(join(pending.root, path), 'public' + src, facts);
    delivery[kind] = {src, ...facts};
  }
  const extraGenerated=[];
  const arkReference=asset.generation.tool==='Ark Images Generations API';
  // A concept reference the operator supplied is not part of any catalogue, so it
  // cannot be registered as a gallery image. Its bytes are still verified here, and
  // the provenance says plainly that it was not distributed with the artwork.
  let unregisteredReference=false;
  const referenceImages = asset.generation.referencePaths.flatMap(path => {
    const bytes = readFileSync(join(pending.root, path)), digest = sha(bytes), parent = nativeParents.get(digest);
    if(hybrid){
      assert.equal(digest,stages[0].native.sha256,'The reference redraw must use its verified built-in original.');
      const location='content/artwork/gallery-hd/'+id+'/reference-original.png';
      copyPlan(join(pending.root,path),location,stages[0].native);
      return [{origin:'project-ai-generated',path:location,sha256:digest,purpose:'same-artwork-reference-redraw',resolution:'native-generation'}];
    }
    if(parent&&parent.id!==id){
      const location = 'content/artwork/gallery-hd/' + parent.id + '/native.png';
      return [{origin: 'project-ai-generated', imageId: parent.id, path: location, sha256: digest, purpose: 'rendering-style-only', resolution: 'native-generation'}];
    }
    assert.ok(arkReference, 'A style reference must match another registered project generation native; unknown references require separate review.');
    unregisteredReference=true;
    return [];
  });
  const catalog = {id, title: asset.title, subtitle: asset.subtitle, category: '插画', src: sourcePath.slice(6), origin: asset.origin,
    status: 'archived', galleryVisible: false, dailyOnly: false, playSrc: (delivery.play ?? delivery.optimized).src, thumbSrc: delivery.thumbnail.src, optimizedSrc: delivery.optimized.src};
  const provenance = {id, origin: asset.origin, width: asset.source.width, height: asset.source.height, sha256: asset.source.sha256,
    nativeResolution: !asset.export.isUpscaled, upscaled: asset.export.isUpscaled,
    generation: {provider: asset.generation.provider, tool: asset.generation.tool, generatedDate: asset.generation.generatedAt.slice(0, 10), generatedAt: asset.generation.generatedAt,
      threadId: asset.generation.threadId, promptPath: 'content/image-prompts/' + id + '.txt', referenceImages,
      native: {...native, path: nativePath}, originalFile: sourcePath, importedRegistrySha256: pending.fingerprint},
    resolutionNote: '原始生成 ' + native.width + '×' + native.height + '；保存成品 ' + asset.source.width + '×' + asset.source.height + (asset.export.isUpscaled ? '，已放大，放大尺寸不代表新增原生细节。' : '，未放大。') + (unregisteredReference ? '参考用的概念图由运营者提供，未在图库登记，也未随成品分发。' : ''),
    review: structuredClone(asset.review), commercialUse: {basis: 'provider-output-terms', termsUrl: (hybrid||arkReference) ? DOUBAO_TERMS : OPENAI_TERMS, exclusiveRightsGuaranteed: false}, delivery};
  if(arkReference){
    // Record which model produced the redraw; the reference image itself is not
    // registered, so this is the only honest provenance available for it.
    provenance.generation.model=asset.generation.model;
    provenance.generation.method=asset.generation.method;
  }
  if(hybrid){
    assert.equal(referenceImages.length,1,'A built-in reference redraw requires exactly one original.');
    provenance.generation.model=asset.generation.model;provenance.generation.method=asset.generation.method;
    provenance.generation.stages=stages.map((stage,index)=>{
      const promptPath=index===0?'content/image-prompts/'+id+'-original.txt':provenance.generation.promptPath;
      if(index===0)extraGenerated.push({path:promptPath,content:stage.prompt+'\n'});
      const stageNative={...stage.native,path:index===0?referenceImages[0].path:nativePath};
      const evidence=stage.evidence.map((item,evidenceIndex)=>{
        const location='content/artwork/gallery-hd/'+id+'/stage-'+index+'-evidence-'+evidenceIndex+'.json';
        copyPlan(join(pending.root,item.path),location,item);
        return {path:location,sha256:item.sha256,bytes:item.bytes};
      });
      return {role:stage.role,provider:stage.provider,tool:stage.tool,model:stage.model,promptPath,generatedAt:stage.generatedAt,native:stageNative,evidence,
        commercialUse:{basis:'provider-output-terms',termsUrl:index===0?OPENAI_TERMS:DOUBAO_TERMS,exclusiveRightsGuaranteed:false}};
    });
    provenance.commercialUse.referenceTermsUrls=[OPENAI_TERMS];
    provenance.resolutionNote='内置工具原画 '+stages[0].native.width+'×'+stages[0].native.height+'；豆包 Seedream 参考重绘原生 '+native.width+'×'+native.height+'，按原生尺寸保存，未经插值放大；局部纹理可能重绘。';
  }
  const guidance = {width: asset.source.width, height: asset.source.height, complexity: 3, preferredCount: 108,
    reason: '建议先从清晰轮廓开始，再按颜色分区连接。' + (asset.export.isUpscaled ? '此图保存为放大成品，原生细节以生成尺寸为准。' : '')};
  return {catalog, provenance, guidance, prompt: asset.generation.prompt, extraGenerated};
});
mkdirSync(evidence, {recursive: true});
const outputs = [];
for (const target of targets) {
  const label = allowed.get(target), output = join(evidence, 'prepared-' + label);
  mkdirSync(output, {recursive: true});
  const metadataPaths = ['content/puzzle-catalog.json', 'content/puzzle-guidance.json', 'content/artwork-revisions.json'];
  if (label === 'mobile') metadataPaths.push('h5/asset-manifest.json');
  const metadata = new Map(metadataPaths.map(name => [name, readFileSync(child(target, name), 'utf8')]));
  const catalog = JSON.parse(metadata.get('content/puzzle-catalog.json')), guidance = JSON.parse(metadata.get('content/puzzle-guidance.json')), manifest = JSON.parse(metadata.get('h5/asset-manifest.json') ?? '[]');
  const byId = new Map(catalog.map(photo => [photo.id, photo]));
  assert.equal(byId.size, catalog.length, 'Existing catalog has duplicate IDs.');
  const uniqueManifest = [...new Set(manifest)];
  const newCatalog = [], newGuidance = {}, generated = [];
  for (const item of additions) {
    if (byId.has(item.catalog.id)) assert.deepEqual(byId.get(item.catalog.id), item.catalog, 'Existing ID differs; never overwrite: ' + item.catalog.id);
    else newCatalog.push(item.catalog);
    if (Object.hasOwn(guidance, item.catalog.id)) assert.deepEqual(guidance[item.catalog.id], item.guidance, 'Existing guidance differs; never overwrite.');
    else newGuidance[item.catalog.id] = item.guidance;
    generated.push({path: 'content/image-provenance/' + item.catalog.id + '.json', content: json(item.provenance)});
    generated.push({path: 'content/image-prompts/' + item.catalog.id + '.txt', content: item.prompt + (item.prompt.endsWith('\n') ? '' : '\n')});
    generated.push(...item.extraGenerated);
  }
  // Play and optimized may reference the same WebP. Keep one entry per URL.
  const newUrls = [...new Set(additions.flatMap(item => [item.catalog.playSrc, item.catalog.thumbSrc, item.catalog.optimizedSrc]))]
    .filter(url => !uniqueManifest.includes(url));
  const nextMetadata = new Map([
    ['content/puzzle-catalog.json', appendArray(metadata.get('content/puzzle-catalog.json'), newCatalog)],
    ['content/puzzle-guidance.json', appendObject(metadata.get('content/puzzle-guidance.json'), newGuidance)],
  ]);
  // New images also need their initial, immutable room-artwork snapshot. This
  // registers the existing base image only; it never grants an HD upgrade or
  // changes active revisions/legacy fallbacks used by existing rooms.
  const artwork = JSON.parse(metadata.get('content/artwork-revisions.json'));
  assert.equal(artwork.schema, 'jigsaw-artwork-revisions/v1');
  const nextArtwork = structuredClone(artwork);
  for (const item of additions) {
    const snapshot = {revision: item.provenance.sha256,
      src: item.catalog.optimizedSrc ?? item.catalog.playSrc, thumbSrc: item.catalog.thumbSrc,
      width: item.provenance.width, height: item.provenance.height};
    const versions = nextArtwork.versions[item.catalog.id];
    if (versions) assert.ok(versions.some(existing => Object.keys(snapshot).every(key => existing[key] === snapshot[key])), 'Existing artwork revisions do not contain the registered base: ' + item.catalog.id);
    else nextArtwork.versions[item.catalog.id] = [snapshot];
  }
  nextMetadata.set('content/artwork-revisions.json', JSON.stringify(nextArtwork, null, 2) + '\n');
  if (metadata.has('h5/asset-manifest.json')) {
    const manifestText = uniqueManifest.length === manifest.length ? metadata.get('h5/asset-manifest.json') : json(uniqueManifest);
    nextMetadata.set('h5/asset-manifest.json', appendArray(manifestText, newUrls));
  }
  const files = [...sourceFiles.values()].map(item => {
    const to = child(target, item.to), present = existsSync(to);
    if (present) assertBytes(to, item);
    return {...item, destination: to, action: present ? 'keep-identical' : 'copy-new'};
  });
  for (const item of generated) {
    const file = child(target, item.path);
    if (existsSync(file)) assert.equal(readFileSync(file, 'utf8'), item.content, 'Existing provenance/prompt differs; never overwrite: ' + item.path);
  }
  // Plans are private review artifacts, not source mutations or an upload.
  for (const item of generated) writeNewOrSame(child(output, item.path), item.content);
  for (const [name, text] of nextMetadata) atomicWrite(child(output, basename(name)), text);
  const plan = {schema: 'jigsaw-pending-delivery-plan/v1',createdAt: new Date().toISOString(),target,registryPath:pending.registryPath,registrySha256:pending.fingerprint,
    existingCatalogCount: catalog.length,addedCatalogCount: newCatalog.length,finalCatalogCount: catalog.length + newCatalog.length,
    ids: additions.map(item => item.catalog.id),archivedByDefault:true,existingEntriesPreserved:true,
    metadata:[...metadata].map(([path,text]) => ({path,beforeSha256:sha(text),afterSha256:sha(nextMetadata.get(path))})),
    files,generated:generated.map(({path,content}) => ({path,bytes:Buffer.byteLength(content),sha256:sha(content)})),
    totalCopyBytes:files.filter(file=>file.action==='copy-new').reduce((total,file)=>total+file.bytes,0),
    scope:'Local source registration only; original PNGs/native evidence are not runtime delivery files. No admin data or remote changes.'};
  atomicWrite(join(output, 'plan.json'), json(plan));
  if (options.apply) {
    assert.equal(sha(readFileSync(pending.registryPath)), pending.fingerprint, 'Pending registry changed after validation.');
    for (const [name,text] of metadata) assert.equal(readFileSync(child(target,name),'utf8'),text,'Target metadata changed after planning.');
    const backup = join(output, 'before-' + Date.now());
    mkdirSync(backup, {recursive:true});
    for (const [name,text] of metadata) writeNewOrSame(child(backup,name),text);
    for (const file of files) if (file.action === 'copy-new') {
      assertBytes(file.from,file);
      mkdirSync(dirname(file.destination),{recursive:true});
      copyFileSync(file.from,file.destination,1); // COPYFILE_EXCL: never replace artwork.
      assertBytes(file.destination,file);
    }
    for (const item of generated) writeNewOrSame(child(target,item.path),item.content);
    for (const [name,text] of metadata) assert.equal(readFileSync(child(target,name),'utf8'),text,'Metadata changed during copy; stop before changing catalogs.');
    for (const [name,text] of nextMetadata) if (text !== metadata.get(name)) atomicWrite(child(target,name),text);
    atomicWrite(join(output,'apply-receipt.json'),json({schema:'jigsaw-pending-delivery-local-apply/v1',createdAt:new Date().toISOString(),target,registrySha256:pending.fingerprint,
      addedImages:newCatalog.length,finalImageCount:catalog.length+newCatalog.length,backupDirectory:backup,adminDatabaseChanged:false,remoteUploaded:false,
      nextCheck:'node scripts/check-image-library.mjs (run in target project); then planMobileAssets(target).'}));
  }
  outputs.push({target,plan:join(output,'plan.json'),applied:options.apply,existingImages:catalog.length,addedImages:newCatalog.length,newFiles:files.filter(file=>file.action==='copy-new').length,copyBytes:plan.totalCopyBytes});
}
console.log(json({mode: options.apply ? 'local-apply' : 'dry-run',validatedPendingImages:pending.assets.length,outputs}));
