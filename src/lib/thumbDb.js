import { recordFailure } from './invalidLog.js';

const DB_NAME = 'pv-thumb-cache';
const STORE = 'thumbs';
const VERSION = 1;

let _db = null;

function openDb() {
  if (_db) return Promise.resolve(_db);
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = e => e.target.result.createObjectStore(STORE);
    req.onsuccess = e => { _db = e.target.result; resolve(_db); };
    req.onerror = e => reject(e.target.error);
  });
}

export async function getThumb(hash) {
  try {
    const db = await openDb();
    return await new Promise((resolve, reject) => {
      const req = db.transaction(STORE, 'readonly').objectStore(STORE).get(hash);
      req.onsuccess = e => resolve(e.target.result ?? null);
      req.onerror = e => reject(e.target.error);
    });
  } catch (e) {
    // §4.3 #27: IndexedDB が使えない・読めない（キャッシュなしとして続ける）
    recordFailure('§4.3 #27 thumbDb.getThumb', 'thumb-cache-failed', e, { hash });
    return null;
  }
}

export async function putThumb(hash, data) {
  try {
    const db = await openDb();
    await new Promise((resolve, reject) => {
      const req = db.transaction(STORE, 'readwrite').objectStore(STORE).put(data, hash);
      req.onsuccess = () => resolve();
      req.onerror = e => reject(e.target.error);
    });
  } catch (e) {
    recordFailure('§4.3 #27 thumbDb.putThumb', 'thumb-cache-failed', e, { hash });
  }
}

export async function clearAll() {
  try {
    const db = await openDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (e) {
    recordFailure('§4.3 #27 thumbDb.clearAll', 'thumb-cache-failed', e);
    try {
      indexedDB.deleteDatabase(DB_NAME);
    } catch (e2) {
      recordFailure('§4.3 #27 thumbDb.clearAll', 'thumb-cache-delete-failed', e2);
    }
  }
}
