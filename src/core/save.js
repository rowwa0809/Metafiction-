// save.js — IndexedDB persistence with an in-memory + JSON-download fallback.
//
// $0-forever constraint: no server, no account, no cloud. The world is
// serialized to plain JSON (see worldState.js) and stored in the
// browser's own IndexedDB. If IndexedDB is unavailable (privacy mode,
// very old browser, or the Node test harness), everything still works
// within the current session via an in-memory object; export/import as a
// downloaded .json file is the manual fallback for carrying a save
// between sessions or machines.

const DB_NAME = 'genesis-village';
const STORE = 'saves';
const KEY = 'current';

let memoryFallback = null;

function hasIndexedDB() {
  return typeof indexedDB !== 'undefined';
}

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function saveToIndexedDB(serialized) {
  if (!hasIndexedDB()) {
    memoryFallback = serialized;
    return { ok: true, mode: 'memory' };
  }
  try {
    const db = await openDB();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(serialized, KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    return { ok: true, mode: 'indexeddb' };
  } catch (err) {
    memoryFallback = serialized;
    return { ok: false, mode: 'memory', error: String(err) };
  }
}

export async function loadFromIndexedDB() {
  if (!hasIndexedDB()) return memoryFallback;
  try {
    const db = await openDB();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).get(KEY);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return memoryFallback;
  }
}

export function exportWorldToFile(serialized, filename = `genesis-village-save-${Date.now()}.json`) {
  const blob = new Blob([JSON.stringify(serialized)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function importWorldFromFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        resolve(JSON.parse(reader.result));
      } catch (err) {
        reject(err);
      }
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });
}
