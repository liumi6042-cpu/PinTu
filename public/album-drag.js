export const MIME = 'application/x-jigsaw-album-images';

const SCHEMA = 'jigsaw-album-images/v1';
const MAX_BYTES = 64 * 1024;
const MAX_IMAGES = 1000;
const MAX_ID_LENGTH = 256;

const isId = value => typeof value === 'string' && value.length > 0 && value.length <= MAX_ID_LENGTH;
const isTarget = value => typeof value === 'string' && value.length > 0 && value.length <= 128;
const values = input => Array.isArray(input) || input instanceof Set ? input : [];
const knownSet = input => new Set([...values(input)].filter(isId));
const withinSize = raw => raw.length <= MAX_BYTES && new TextEncoder().encode(raw).byteLength <= MAX_BYTES;

/** Drag a selected group together, or only the picture that started the drag. */
export function createDragPayload({imageId, selectedIds, knownIds, target} = {}) {
  const known = knownSet(knownIds);
  if (!isTarget(target) || !isId(imageId) || !known.has(imageId)) return null;

  const selected = values(selectedIds);
  const selectedSet = selected instanceof Set ? selected : new Set(selected);
  const imageIds = selectedSet.has(imageId)
    ? [...selectedSet].filter(id => isId(id) && known.has(id))
    : [imageId];
  if (!imageIds.length || imageIds.length > MAX_IMAGES) return null;

  const raw = JSON.stringify({schema: SCHEMA, target, imageIds});
  return withinSize(raw) ? raw : null;
}

/** Accept only this workspace's bounded, known-image drag payload. */
export function parseDragPayload(raw, {target, knownIds} = {}) {
  if (typeof raw !== 'string' || !raw.length || !withinSize(raw) || !isTarget(target)) return [];
  let payload;
  try { payload = JSON.parse(raw); } catch { return []; }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return [];
  if (Object.keys(payload).length !== 3 || payload.schema !== SCHEMA || payload.target !== target) return [];
  if (!Array.isArray(payload.imageIds) || !payload.imageIds.length || payload.imageIds.length > MAX_IMAGES) return [];

  const known = knownSet(knownIds);
  if (payload.imageIds.some(id => !isId(id) || !known.has(id))) return [];
  return [...new Set(payload.imageIds)];
}
