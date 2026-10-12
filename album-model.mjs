// Album ownership is the sole editable source of gallery and collection content.
// Legacy asset target flags remain in documents only to preserve old snapshots.
export const ALBUM_SCHEMA_VERSION = 3;
const TARGETS = ['pc', 'mobile-shared'];
const clone = value => structuredClone(value);
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const conflict = message => {throw Object.assign(new Error(message), {status: 409, code: 'ALBUM_MIGRATION_CONFLICT'});};

function mergeField(album, pack, originalAlbum, originalPack, field) {
  if (!album) return clone(pack[field]);
  if (!pack) return clone(album[field]);
  if (equal(album[field], pack[field])) return clone(album[field]);
  if (originalAlbum && originalPack) {
    const albumChanged = !equal(album[field], originalAlbum[field]);
    const packChanged = !equal(pack[field], originalPack[field]);
    if (albumChanged && packChanged) conflict('相册与旧图包的' + field + '都有独立修改，请先合并：' + album.id);
    if (packChanged) return clone(pack[field]);
    if (albumChanged) return clone(album[field]);
  }
  // Independent old collection content takes precedence over its display mirror.
  return clone(album[field]);
}

/** Pure conversion. Saved legacy documents and version blobs are never mutated. */
function legacyToAlbumDraft(input, source) {
  if (!input || input.schemaVersion !== undefined) conflict('未知内容版本，无法转换为相册。');
  const document = clone(input);
  const legacyBaseline = source?._private?.legacyBaseline ?? (source?.baseline?.schemaVersion === undefined ? source?.baseline : null);
  document.schemaVersion = 2;
  for (const target of TARGETS) {
    const old = document.targets[target], original = legacyBaseline?.targets[target];
    const packs = old.packs ?? [], oldAlbums = old.albums ?? [];
    const handled = new Set();
    const albums = oldAlbums.map(album => {
      const pack = album.packId === null ? null : packs.find(item => item.id === album.packId);
      if (pack) {
        if (pack.id !== album.id) conflict('旧图鉴与关联购买包使用不同 ID，需保留历史权益后合并：' + album.id);
        handled.add(pack.id);
      }
      const originalAlbum = original?.albums.find(item => item.id === album.id);
      const originalPack = pack && original?.packs.find(item => item.id === pack.id);
      const imageIds = mergeField(album, pack, originalAlbum, originalPack, 'imageIds');
      const purchasable = target === 'mobile-shared' && !!pack && pack.price > 0;
      return {id: album.id,
        title: mergeField(album, pack, originalAlbum, originalPack, 'title'),
        description: mergeField(album, pack, originalAlbum, originalPack, 'description'),
        imageIds, coverImageId: imageIds.includes(pack?.coverImageId) ? pack.coverImageId : imageIds[0] ?? null,
        styleGroupId: mergeField(album, pack, originalAlbum, originalPack, 'styleGroupId'),
        visible: pack ? pack.status === 'published' : true, purchasable, price: purchasable ? pack.price : 0,
        decorationId: pack?.decorationId ?? null, milestones: clone(album.milestones)};
    });
    for (const pack of packs) if (!handled.has(pack.id)) {
      const purchasable = target === 'mobile-shared' && pack.price > 0;
      albums.push({id: pack.id, title: pack.title, description: pack.description, imageIds: clone(pack.imageIds),
        coverImageId: pack.coverImageId, styleGroupId: pack.styleGroupId, visible: pack.status === 'published',
        purchasable, price: purchasable ? pack.price : 0, decorationId: pack.decorationId, milestones: []});
    }
    if (original) {
      const packOrderChanged = !equal(packs.map(pack => pack.id), original.packs.map(pack => pack.id));
      const albumOrderChanged = !equal(oldAlbums.map(album => album.id), original.albums.map(album => album.id));
      if (packOrderChanged && !albumOrderChanged) {
        const orderedIds = [...packs.map(pack => pack.id), ...albums.filter(album => !packs.some(pack => pack.id === album.id)).map(album => album.id)];
        albums.sort((a, b) => orderedIds.indexOf(a.id) - orderedIds.indexOf(b.id));
      } else if (packOrderChanged && albumOrderChanged) {
        const packIds = new Set(packs.map(pack => pack.id));
        if (!equal(packs.map(pack => pack.id), oldAlbums.filter(album => packIds.has(album.id)).map(album => album.id)))
          conflict('旧图包和图鉴的排序都有独立修改，请先合并：' + target);
      }
    }
    if (target === 'pc') {
      const assigned = new Set(albums.flatMap(album => album.imageIds));
      const ordinary = Object.keys(document.assets).filter(id => {
        const config = document.assets[id].targets[target];
        return config.status === 'published' && config.galleryVisible && !config.dailyOnly && !assigned.has(id);
      });
      if (ordinary.length) {
        if (albums.some(album => album.id === 'free-gallery')) conflict('原有相册占用了普通相册 ID，请先合并。');
        albums.push({id: 'free-gallery', title: '日常拾光', description: '自由图库中的普通图片。', imageIds: ordinary,
          coverImageId: ordinary[0], styleGroupId: null, visible: true, purchasable: false, price: 0, decorationId: null, milestones: []});
      }
    }
    document.targets[target] = {albums};
  }
  return document;
}

/** Collapse the former device copies only after checking the old PC workspace. */
export function normalizeDraft(input, source) {
  if (input?.schemaVersion === ALBUM_SCHEMA_VERSION) return clone(input);
  if (!input || ![undefined, 2].includes(input.schemaVersion)) conflict('未知内容版本，无法转换为共享相册。');
  const document = input.schemaVersion === 2 ? clone(input) : legacyToAlbumDraft(input, source);
  const original = source?._private?.legacyBaseline
    ?? (source?.baseline?.schemaVersion === undefined ? source?.baseline : null)
    ?? (input.schemaVersion === undefined ? input : null);
  if (!original) conflict('缺少旧 PC 相册基线，无法确认独立编辑是否已经保留。');
  const originalPc = legacyToAlbumDraft(original).targets.pc.albums;
  if (!equal(document.targets.pc.albums, originalPc)) conflict('PC 相册存在独立修改，请先合并到共享相册后继续；原记录仍保留。');
  const albums = document.targets['mobile-shared'].albums.map(({visible, ...album}) => ({
    ...album, showOnPc: visible, showOnMobile: visible,
  }));
  delete document.targets;
  return {...document, schemaVersion: ALBUM_SCHEMA_VERSION, albums};
}

const displayField = target => target === 'pc' ? 'showOnPc' : target === 'mobile-shared' ? 'showOnMobile' : null;
export function albumDisplayedOn(album, target) {
  const field = displayField(target);
  if (!field) throw Object.assign(new Error('未知内容目标。'), {status: 400});
  return album[field];
}

/** Management plans include pending and previously archived artwork. */
export function plannedImageVisibility(input, source, target) {
  const document = normalizeDraft(input, source);
  const dailyOnly = new Set(source.assets.filter(asset => asset.targets[target].dailyOnly).map(asset => asset.id));
  return new Set(document.albums.filter(album => albumDisplayedOn(album, target)).flatMap(album => album.imageIds).filter(id => !dailyOnly.has(id)));
}

/** Existing games can currently use only already published retained artwork. */
export function effectiveImageVisibility(input, source, target) {
  const planned = plannedImageVisibility(input, source, target);
  const available = new Set(source.assets.filter(asset => asset.lifecycle !== 'pending' && asset.targets[target].status === 'published').map(asset => asset.id));
  return new Set([...planned].filter(id => available.has(id)));
}

export const runtimeImageVisibility = effectiveImageVisibility;

export function buildAlbumConfiguration(input, source, target) {
  const document = normalizeDraft(input, source);
  if (target !== undefined && !TARGETS.includes(target)) throw Object.assign(new Error('未知内容目标。'), {status: 400});
  return {schema: 'jigsaw-content-albums/v3', sourceFingerprint: source.fingerprint,
    ...(target === undefined ? {} : {target}), sharedAlbums: true, oneAlbumPerImage: true, unassignedImagesVisible: false,
    albums: clone(document.albums)};
}

/** Inert legacy export adapter. Album changes still require runtime support. */
export function toLegacyDraft(input, source) {
  const document = normalizeDraft(input, source), legacy = clone(source._private.legacyBaseline);
  legacy.name = document.name; legacy.styles = clone(document.styles); legacy.assets = clone(document.assets);
  for (const target of TARGETS) {
    const albums = document.albums;
    const runtimeVisible = effectiveImageVisibility(document, source, target);
    for (const asset of source.assets) {
      const config = legacy.assets[asset.id].targets[target];
      // Daily pictures remain on their existing independent selection path.
      if (!config.dailyOnly && asset.lifecycle !== 'pending' && config.status === 'published') config.galleryVisible = runtimeVisible.has(asset.id);
    }
    // Existing PC themes have different progress and reward IDs. Keep their
    // original receipt until the shared-album runtime adapter migrates them.
    if (target === 'pc') continue;
    const packAlbums = albums.filter(album => album.purchasable);
    const packs = packAlbums.map(album => ({id: album.id, title: album.title, description: album.description,
      imageIds: clone(album.imageIds), coverImageId: album.coverImageId, status: albumDisplayedOn(album, target) ? 'published' : 'archived',
      styleGroupId: album.styleGroupId, price: target === 'pc' ? null : album.price, decorationId: album.decorationId}));
    legacy.targets[target] = {packs, albums: albums.map(album => ({
      id: album.id, title: album.title, description: album.description, imageIds: clone(album.imageIds),
      packId: packs.some(pack => pack.id === album.id) ? album.id : null, styleGroupId: album.styleGroupId,
      milestones: clone(album.milestones)}))};
  }
  return legacy;
}
