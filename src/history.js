export const MAX_HISTORY = 20;

const DB_NAME = 'petpet-history';
const DB_VER  = 1;
const STORE   = 'gifs';

let dbPromise = null;

function wrap(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = (e) => resolve(e.target.result);
    req.onerror   = (e) => reject(e.target.error);
  });
}

function openDB() {
  if (!dbPromise) dbPromise = _createDB();
  return dbPromise;
}

// Fix B: wrap 재사용 — onupgradeneeded 설정 후 wrap(req) 위임
function _createDB() {
  const req = indexedDB.open(DB_NAME, DB_VER);
  req.onupgradeneeded = (e) => {
    const db = e.target.result;
    if (!db.objectStoreNames.contains(STORE)) {
      db.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
    }
  };
  return wrap(req);
}

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

// Fix A: 3개 트랜잭션 → cursor 기반 단일 readwrite 트랜잭션, 새 id 반환
export function addToHistory(blob, meta) {
  return openDB().then((db) => new Promise((resolve, reject) => {
    const store = db.transaction(STORE, 'readwrite').objectStore(STORE);
    let newId;
    const addReq = store.add({ blob, ...meta, createdAt: new Date() });
    addReq.onsuccess = (e) => { newId = e.target.result; };
    const countReq = store.count();
    countReq.onsuccess = () => {
      if (countReq.result > MAX_HISTORY) {
        let excess = countReq.result - MAX_HISTORY;
        const cursorReq = store.openCursor();
        cursorReq.onsuccess = (e) => {
          const c = e.target.result;
          if (c && excess-- > 0) { c.delete(); c.continue(); }
        };
      }
    };
    store.transaction.oncomplete = () => resolve(newId);
    store.transaction.onerror   = () => reject(store.transaction.error);
  }));
}

// Fix C: getAll(null, MAX_HISTORY) — DB 레이어에서 수량 제한
export async function getHistory() {
  const db  = await openDB();
  const all = await wrap(tx(db, 'readonly').getAll(null, MAX_HISTORY));
  return all.reverse();
}

export async function removeFromHistory(id) {
  const db = await openDB();
  await wrap(tx(db, 'readwrite').delete(id));
}

export async function clearHistory() {
  const db = await openDB();
  await wrap(tx(db, 'readwrite').clear());
}
