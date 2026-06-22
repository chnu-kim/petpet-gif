export const MAX_GIFS_PER_PROJECT = 20;

const DB_NAME  = 'petpet-history';
const DB_VER   = 3;
const PROJECTS = 'projects';
const GIFS     = 'gifs';

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

function _createDB() {
  const req = indexedDB.open(DB_NAME, DB_VER);
  req.onupgradeneeded = (e) => {
    const db = e.target.result;
    if (!db.objectStoreNames.contains(PROJECTS)) {
      db.createObjectStore(PROJECTS, { keyPath: 'id', autoIncrement: true });
    }
    if (!db.objectStoreNames.contains(GIFS)) {
      const gifStore = db.createObjectStore(GIFS, { keyPath: 'id', autoIncrement: true });
      gifStore.createIndex('projectId', 'projectId', { unique: false });
    } else if (!e.target.transaction.objectStore(GIFS).indexNames.contains('projectId')) {
      e.target.transaction.objectStore(GIFS).createIndex('projectId', 'projectId', { unique: false });
    }
    if (e.oldVersion === 1) {
      e.target.transaction.objectStore(GIFS).clear();
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

function txStores(db, storeNames, mode) {
  const t = db.transaction(storeNames, mode);
  return storeNames.map((n) => t.objectStore(n));
}

// ── Projects ────────────────────────────────────────────────────

export async function createProject(name, imageBlob = null, settings = null) {
  const db  = await openDB();
  const now = new Date();
  return wrap(
    db.transaction(PROJECTS, 'readwrite').objectStore(PROJECTS).add({
      name,
      imageBlob,
      settings,
      createdAt: now,
      updatedAt: now,
    }),
  );
}

export async function updateProjectSnapshot(id, imageBlob, settings) {
  const db    = await openDB();
  const store = db.transaction(PROJECTS, 'readwrite').objectStore(PROJECTS);
  const project = await wrap(store.get(id));
  if (!project) return;
  await wrap(store.put({ ...project, imageBlob, settings, updatedAt: new Date() }));
}

export async function renameProject(id, name) {
  const db    = await openDB();
  const store = db.transaction(PROJECTS, 'readwrite').objectStore(PROJECTS);
  const project = await wrap(store.get(id));
  if (!project) return;
  await wrap(store.put({ ...project, name, updatedAt: new Date() }));
}

export async function listProjects() {
  const db  = await openDB();
  const all = await wrap(
    db.transaction(PROJECTS, 'readonly').objectStore(PROJECTS).getAll(),
  );
  return all.reverse();
}

export async function removeProject(id) {
  const db = await openDB();
  const [projStore, gifStore] = txStores(db, [PROJECTS, GIFS], 'readwrite');
  projStore.delete(id);
  await new Promise((resolve, reject) => {
    const req = gifStore.index('projectId').openCursor(IDBKeyRange.only(id));
    req.onsuccess = (e) => {
      const c = e.target.result;
      if (c) { c.delete(); c.continue(); }
      else resolve();
    };
    req.onerror = (e) => reject(e.target.error);
  });
}

// ── GIFs ────────────────────────────────────────────────────────

export function addGifToProject(projectId, blob, meta) {
  return openDB().then((db) => new Promise((resolve, reject) => {
    const [projStore, gifStore] = txStores(db, [PROJECTS, GIFS], 'readwrite');
    const now = new Date();
    let newGifId;

    const addReq = gifStore.add({ projectId, blob, ...meta, createdAt: now });
    addReq.onsuccess = (e) => { newGifId = e.target.result; };

    const getReq = projStore.get(projectId);
    getReq.onsuccess = () => {
      const project = getReq.result;
      if (project) projStore.put({ ...project, updatedAt: now });
    };

    const countReq = gifStore.index('projectId').count(IDBKeyRange.only(projectId));
    countReq.onsuccess = () => {
      let excess = countReq.result - MAX_GIFS_PER_PROJECT;
      if (excess > 0) {
        const cursorReq = gifStore.index('projectId').openCursor(IDBKeyRange.only(projectId));
        cursorReq.onsuccess = (e) => {
          const c = e.target.result;
          if (c && excess-- > 0) { c.delete(); c.continue(); }
        };
      }
    };

    const t = gifStore.transaction;
    t.oncomplete = () => resolve(newGifId);
    t.onerror    = () => reject(t.error);
  }));
}

export async function getProjectGifs(projectId) {
  const db  = await openDB();
  const idx = db.transaction(GIFS, 'readonly').objectStore(GIFS).index('projectId');
  const all = await wrap(idx.getAll(IDBKeyRange.only(projectId)));
  return all.reverse();
}

export async function removeGif(id) {
  const db = await openDB();
  await wrap(db.transaction(GIFS, 'readwrite').objectStore(GIFS).delete(id));
}

export async function clearAllProjects() {
  const db = await openDB();
  const [projStore, gifStore] = txStores(db, [PROJECTS, GIFS], 'readwrite');
  projStore.clear();
  gifStore.clear();
}
