const fail = message => { throw new Error(message); };

function selectedImages(document, ids) {
  if (!Array.isArray(ids) && !(ids instanceof Set)) fail('请选择图片。');
  const selected = [...new Set(ids)];
  if (!selected.length) fail('请至少选择一张图片。');
  if (selected.some(id => typeof id !== 'string' || !Object.hasOwn(document.assets, id))) fail('所选图片已变化，请重新载入。');
  return selected;
}

/** Deletion affects future discovery, never the original image or its stable ID. */
export function planImageDeletion(document, ids, {lockedImageIds = []} = {}) {
  const selected = selectedImages(document, ids).filter(id => !document.assets[id].deleted);
  const chosen = new Set(selected), locked = new Set(lockedImageIds);
  return {
    ids: selected,
    albums: document.albums.filter(album => album.imageIds.some(id => chosen.has(id)))
      .map(album => ({id: album.id, title: album.title, count: album.imageIds.filter(id => chosen.has(id)).length, purchasable: album.purchasable})),
    cancelledPlans: (document.dailyPlans ?? []).filter(plan => chosen.has(plan.imageId) && !locked.has(plan.imageId)).map(plan => plan.imageId),
    retainedPlans: (document.dailyPlans ?? []).filter(plan => chosen.has(plan.imageId) && locked.has(plan.imageId)).map(plan => plan.imageId),
  };
}

export function deleteImages(document, ids, options) {
  const plan = planImageDeletion(document, ids, options), selected = new Set(plan.ids);
  for (const id of selected) document.assets[id].deleted = true;
  for (const album of document.albums) {
    album.imageIds = album.imageIds.filter(id => !selected.has(id));
    if (!album.imageIds.includes(album.coverImageId)) album.coverImageId = album.imageIds[0] ?? null;
  }
  const cancelled = new Set(plan.cancelledPlans);
  document.dailyPlans = (document.dailyPlans ?? []).filter(plan => !cancelled.has(plan.imageId));
  return plan;
}

export function restoreImages(document, ids) {
  const selected = selectedImages(document, ids).filter(id => document.assets[id].deleted);
  for (const id of selected) delete document.assets[id].deleted;
  return selected;
}
