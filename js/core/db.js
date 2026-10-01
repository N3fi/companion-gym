// IndexedDB : stockage local des séances.
// Une seule base, un seul store "seances" indexé par date (YYYY-MM-DD).

const DB_NAME = 'companion-gym';
const DB_VERSION = 2;
const STORE_SEANCES = 'seances';
const STORE_PROGRAMME = 'programme';

let dbPromise = null;

function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE_SEANCES)) {
        db.createObjectStore(STORE_SEANCES, { keyPath: 'date' });
      }
      if (!db.objectStoreNames.contains(STORE_PROGRAMME)) {
        db.createObjectStore(STORE_PROGRAMME, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

async function tx(mode, fn) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE_SEANCES, mode);
    const store = t.objectStore(STORE_SEANCES);
    let result;
    try {
      result = fn(store);
    } catch (err) {
      reject(err);
      return;
    }
    t.oncomplete = () => resolve(result && result.result !== undefined ? result.result : result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

export async function getSeance(date) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE_SEANCES, 'readonly');
    const req = t.objectStore(STORE_SEANCES).get(date);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

export async function putSeance(seance) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE_SEANCES, 'readwrite');
    t.objectStore(STORE_SEANCES).put(seance);
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
  });
}

export async function deleteSeance(date) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE_SEANCES, 'readwrite');
    t.objectStore(STORE_SEANCES).delete(date);
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
  });
}

export async function getAllSeances() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE_SEANCES, 'readonly');
    const req = t.objectStore(STORE_SEANCES).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

// --- Programme (un seul enregistrement, id = 'actif') ---

export async function getProgrammeActif() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE_PROGRAMME, 'readonly');
    const req = t.objectStore(STORE_PROGRAMME).get('actif');
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

export async function putProgrammeActif(programme) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE_PROGRAMME, 'readwrite');
    t.objectStore(STORE_PROGRAMME).put({ id: 'actif', ...programme });
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
  });
}

export async function deleteProgrammeActif() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE_PROGRAMME, 'readwrite');
    t.objectStore(STORE_PROGRAMME).delete('actif');
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
  });
}

// Demande au navigateur de marquer les données comme persistantes.
// À appeler une fois au démarrage : protège contre la suppression auto.
export async function demanderPersistance() {
  if (!navigator.storage || !navigator.storage.persist) return false;
  try {
    if (await navigator.storage.persisted()) return true;
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}

export async function etatStockage() {
  if (!navigator.storage || !navigator.storage.estimate) return null;
  try {
    const est = await navigator.storage.estimate();
    const persistant = navigator.storage.persisted
      ? await navigator.storage.persisted()
      : false;
    return {
      utilise: est.usage || 0,
      quota: est.quota || 0,
      persistant,
    };
  } catch {
    return null;
  }
}
