export const MAX_HISTORY = 20;

const DB_NAME  = 'petpet-history';
const DB_VER   = 1;
const STORE    = 'gifs';

let dbPromise = null;

function openDB() {
  if (!dbPromise) dbPromise = _createDB();
  return dbPromise;
}

function _createDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VER);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
      }
    };
    req.onsuccess = (e) => resolve(e.target.result);
    req.onerror   = (e) => reject(e.target.error);
  });
}

// 테스트에서 DB를 리셋하기 위한 내부 함수
export async function _resetDB() {
  if (dbPromise) {
    const db = await dbPromise;
    db.close();
    dbPromise = null;
  }
  await new Promise((resolve, reject) => {
    const req = indexedDB.deleteDatabase(DB_NAME);
    req.onsuccess = () => resolve();
    req.onerror   = (e) => reject(e.target.error);
    req.onblocked = () => resolve();
  });
}

function tx(db, mode) {
  return db.transaction(STORE, mode).objectStore(STORE);
}

function wrap(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = (e) => resolve(e.target.result);
    req.onerror   = (e) => reject(e.target.error);
  });
}

export async function addToHistory(blob, meta) {
  const db   = await openDB();
  const store = tx(db, 'readwrite');

  await wrap(store.add({ blob, ...meta, createdAt: new Date() }));

  // 최대 개수 초과 시 가장 오래된 항목 제거
  const allKeys = await wrap(tx(db, 'readonly').getAllKeys());
  if (allKeys.length > MAX_HISTORY) {
    const toDelete = allKeys.slice(0, allKeys.length - MAX_HISTORY);
    const delStore = tx(db, 'readwrite');
    await Promise.all(toDelete.map((k) => wrap(delStore.delete(k))));
  }
}

export async function getHistory() {
  const db   = await openDB();
  const all  = await wrap(tx(db, 'readonly').getAll());
  return all.reverse(); // 최신순
}

export async function removeFromHistory(id) {
  const db = await openDB();
  await wrap(tx(db, 'readwrite').delete(id));
}

export async function clearHistory() {
  const db = await openDB();
  await wrap(tx(db, 'readwrite').clear());
}
