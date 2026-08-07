// Storage layer: localStorage prefs + IndexedDB records + export/import.

const DB_NAME = 'dmsk';
const DB_VERSION = 1;
export const STORES = [
  'campaigns', 'party', 'encounters', 'combats', 'npcs',
  'notes', 'customTables', 'shops', 'calendarEvents', 'misc',
];
const SCHEMA_VERSION = 1;
const PREFS_KEY = 'dmsk:prefs';

let dbPromise = null;

function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const name of STORES) {
        if (!db.objectStoreNames.contains(name)) {
          const store = db.createObjectStore(name, { keyPath: 'id' });
          store.createIndex('campaignId', 'campaignId', { unique: false });
        }
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx(storeName, mode, fn) {
  return openDB().then(db => new Promise((resolve, reject) => {
    const t = db.transaction(storeName, mode);
    const result = fn(t.objectStore(storeName));
    t.oncomplete = () => resolve(result && result.result !== undefined ? result.result : result);
    t.onerror = () => reject(t.error);
  }));
}

export const uid = () => crypto.randomUUID();

export async function dbPut(store, obj) {
  if (!obj.id) obj.id = uid();
  obj.updated = Date.now();
  await tx(store, 'readwrite', s => s.put(obj));
  return obj;
}

export function dbGet(store, id) {
  return tx(store, 'readonly', s => s.get(id));
}

export function dbDelete(store, id) {
  return tx(store, 'readwrite', s => s.delete(id));
}

export async function dbAll(store, campaignId) {
  const all = await tx(store, 'readonly', s => s.getAll());
  return campaignId ? all.filter(r => r.campaignId === campaignId) : all;
}

/* ---------- prefs ---------- */

export function getPrefs() {
  try { return JSON.parse(localStorage.getItem(PREFS_KEY)) || {}; }
  catch { return {}; }
}

export function setPref(key, value) {
  const p = getPrefs();
  p[key] = value;
  localStorage.setItem(PREFS_KEY, JSON.stringify(p));
}

/* ---------- campaigns ---------- */

const campaignListeners = new Set();
export function onCampaignChange(fn) { campaignListeners.add(fn); }

export async function ensureCampaign() {
  let all = await dbAll('campaigns');
  if (!all.length) {
    const c = await dbPut('campaigns', { name: 'My Campaign', created: Date.now() });
    all = [c];
  }
  const prefs = getPrefs();
  if (!prefs.activeCampaign || !all.some(c => c.id === prefs.activeCampaign)) {
    setPref('activeCampaign', all[0].id);
  }
  return all;
}

export function activeCampaignId() {
  return getPrefs().activeCampaign;
}

export async function setActiveCampaign(id) {
  setPref('activeCampaign', id);
  for (const fn of campaignListeners) fn(id);
}

/* ---------- misc keyed state (per campaign, per tool) ---------- */

export async function getState(key, fallback = null) {
  const id = `${activeCampaignId()}:${key}`;
  const rec = await dbGet('misc', id);
  return rec ? rec.value : fallback;
}

export async function setState(key, value) {
  const id = `${activeCampaignId()}:${key}`;
  await dbPut('misc', { id, campaignId: activeCampaignId(), value });
}

/* ---------- export / import ---------- */

export async function exportAll() {
  const dump = { app: 'dm-screen-kit', schema: SCHEMA_VERSION, exported: new Date().toISOString(), prefs: getPrefs(), stores: {} };
  for (const name of STORES) dump.stores[name] = await dbAll(name);
  return dump;
}

export async function importAll(dump, { replace = false } = {}) {
  if (!dump || dump.app !== 'dm-screen-kit' || !dump.stores) {
    throw new Error('Not a DM Screen Kit backup file.');
  }
  for (const name of STORES) {
    const records = dump.stores[name] || [];
    if (replace) {
      await tx(name, 'readwrite', s => s.clear());
    }
    for (const rec of records) {
      if (rec && rec.id) await tx(name, 'readwrite', s => s.put(rec));
    }
  }
  if (dump.prefs) localStorage.setItem(PREFS_KEY, JSON.stringify(dump.prefs));
}
