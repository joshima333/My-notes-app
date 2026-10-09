// ---------- Archivio locale (IndexedDB) ----------
const DB = (() => {
  let db;
  const open = () => db ? Promise.resolve(db) : new Promise((res, rej) => {
    const r = indexedDB.open('note-vocali', 2);
    r.onupgradeneeded = () => {
      const d = r.result;
      if (!d.objectStoreNames.contains('notes')) d.createObjectStore('notes', { keyPath: 'id' });
      if (!d.objectStoreNames.contains('meta')) d.createObjectStore('meta');
    };
    r.onsuccess = () => res(db = r.result);
    r.onerror = () => rej(r.error);
  });
  const tx = async (store, mode, fn) => {
    const d = await open();
    return new Promise((res, rej) => {
      const t = d.transaction(store, mode), req = fn(t.objectStore(store));
      t.oncomplete = () => res(req && req.result);
      t.onerror = () => rej(t.error);
    });
  };
  return {
    all: () => tx('notes', 'readonly', s => s.getAll()),
    get: id => tx('notes', 'readonly', s => s.get(id)),
    put: n => tx('notes', 'readwrite', s => s.put(n)),
    del: id => tx('notes', 'readwrite', s => s.delete(id)),
    clear: () => tx('notes', 'readwrite', s => s.clear()),
    getMeta: k => tx('meta', 'readonly', s => s.get(k)),
    setMeta: (k, v) => tx('meta', 'readwrite', s => s.put(v, k)),
    delMeta: k => tx('meta', 'readwrite', s => s.delete(k)),
  };
})();
