const PREFIX = 'jigsaw-admin-album-recovery/v1';
const TAB_KEY = PREFIX + ':tab-id';
const MAX_BYTES = 2 * 1024 * 1024;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = value => typeof value === 'string' && value.length > 0 && value.length <= 180;
const validContext = ({owner, draftId}) => text(owner) && text(draftId);
const keyFor = (owner, draftId, tabId) => PREFIX + ':' + [owner, draftId, tabId].map(encodeURIComponent).join(':');
const byteLength = value => new TextEncoder().encode(value).byteLength;
const defaultId = () => globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
function browserStorage(name) {try {return globalThis[name];} catch {return undefined;}}

/** Local editing snapshots contain content only. Each tab owns its own entry. */
export function createAlbumRecovery({storage = browserStorage('localStorage'), sessionStorage = browserStorage('sessionStorage'), now = Date.now, newId = defaultId} = {}) {
  let tabId;
  function getTabId() {
    if (tabId) return tabId;
    try {const saved = sessionStorage?.getItem(TAB_KEY); if (text(saved)) tabId = saved;} catch {}
    if (!tabId) {
      try {tabId = String(newId());} catch {tabId = defaultId();}
      if (!text(tabId)) tabId = defaultId();
      try {sessionStorage?.setItem(TAB_KEY, tabId);} catch {}
    }
    return tabId;
  }
  function clear(context) {
    if (!validContext(context) || !storage) return false;
    try {storage.removeItem(keyFor(context.owner, context.draftId, getTabId())); return true;} catch {return false;}
  }
  function save({owner, draftId, revision, document, baseDocument}) {
    if (!validContext({owner, draftId}) || !Number.isSafeInteger(revision) || revision < 1 || !object(document) || !storage) return false;
    try {
      const documentJson = JSON.stringify(document);
      if (baseDocument !== undefined && documentJson === JSON.stringify(baseDocument)) return clear({owner, draftId});
      if (byteLength(documentJson) > MAX_BYTES) return false;
      const savedAt = now();
      if (!Number.isSafeInteger(savedAt) || savedAt < 0) return false;
      const record = {schema: PREFIX, tabId: getTabId(), owner, draftId, revision, document, savedAt};
      const encoded = JSON.stringify(record);
      if (byteLength(encoded) > MAX_BYTES) return false;
      storage.setItem(keyFor(owner, draftId, record.tabId), encoded);
      return true;
    } catch {return false;}
  }
  function entries({owner, draftId}) {
    if (!validContext({owner, draftId}) || !storage) return [];
    const prefix = PREFIX + ':' + [owner, draftId].map(encodeURIComponent).join(':') + ':';
    const found = [];
    try {
      for (let index = 0; index < storage.length; index++) {
        const key = storage.key(index);
        if (typeof key !== 'string' || !key.startsWith(prefix)) continue;
        try {
          const encoded = storage.getItem(key);
          if (typeof encoded !== 'string' || byteLength(encoded) > MAX_BYTES) continue;
          const record = JSON.parse(encoded);
          if (!object(record) || record.schema !== PREFIX || record.owner !== owner || record.draftId !== draftId
            || !text(record.tabId) || key !== keyFor(owner, draftId, record.tabId)
            || !Number.isSafeInteger(record.revision) || record.revision < 1 || !object(record.document)
            || !Number.isSafeInteger(record.savedAt) || record.savedAt < 0) continue;
          found.push({schema: PREFIX, tabId: record.tabId, owner, draftId, revision: record.revision, document: record.document, savedAt: record.savedAt});
        } catch {}
      }
    } catch {return [];}
    return found.sort((a, b) => b.savedAt - a.savedAt || a.tabId.localeCompare(b.tabId));
  }
  return {getTabId, save, entries, clear};
}
