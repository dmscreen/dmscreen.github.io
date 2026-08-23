// Storage layer: localStorage prefs + IndexedDB records + export/import.

const DB_NAME = 'dmsk';
export const STORES = [
  'campaigns', 'party', 'encounters', 'combats', 'npcs',
  'notes', 'customTables', 'shops', 'calendarEvents', 'misc',
  'stories',
  // user-added bookmarks; deliberately not campaign-scoped, so they follow
  // the person rather than the story they happen to be running
  'links',
];
const SCHEMA_VERSION = 1;
const PREFS_KEY = 'dmsk:prefs';

let dbPromise = null;

// Opening without a version uses whatever version already exists on this
// device (and creates v1 for a first visit). Upgrades only ever add missing
// stores, so existing records are never touched.
function openAt(version) {
  return new Promise((resolve, reject) => {
    const req = version ? indexedDB.open(DB_NAME, version) : indexedDB.open(DB_NAME);
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
    req.onblocked = () => reject(new Error('Another DM Screen tab is open and holding the database. Close it and reload.'));
  });
}

// Self-healing open: if a release adds an object store, an existing visitor's
// database will not have it yet, and every read or write to it would throw
// NotFoundError. Rather than relying on someone remembering to bump a version
// constant, detect the gap and upgrade on the spot.
function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = (async () => {
    let db = await openAt();
    const missing = STORES.filter(s => !db.objectStoreNames.contains(s));
    if (missing.length) {
      const next = db.version + 1;
      db.close();
      db = await openAt(next);
    }
    // another tab upgrading shouldn't leave this one holding a stale handle
    db.onversionchange = () => { db.close(); dbPromise = null; };
    db.onclose = () => { dbPromise = null; };
    return db;
  })().catch(err => { dbPromise = null; throw err; });
  return dbPromise;
}

/* ---------- durability ---------- */

// Ask the browser to keep this origin's data instead of evicting it under
// storage pressure. Chrome grants it silently on engaged sites; Safari and
// Firefox may ignore or prompt. Safe to call on every load.
export async function requestPersistence() {
  try {
    if (!navigator.storage?.persist) return false;
    if (await navigator.storage.persisted()) return true;
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}

export async function storageStatus() {
  const out = { persisted: false, usage: null, quota: null, supported: !!navigator.storage?.estimate };
  try {
    if (navigator.storage?.persisted) out.persisted = await navigator.storage.persisted();
    if (navigator.storage?.estimate) {
      const { usage, quota } = await navigator.storage.estimate();
      out.usage = usage ?? null;
      out.quota = quota ?? null;
    }
  } catch { /* leave the defaults */ }
  return out;
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

// Export a single campaign: its record plus every store's records for it,
// including 'misc' (combat state, generator histories, calendar, timers).
export async function exportCampaign(campaignId = activeCampaignId()) {
  const campaign = await dbGet('campaigns', campaignId);
  if (!campaign) throw new Error('Campaign not found.');
  const dump = {
    app: 'dm-screen-kit', schema: SCHEMA_VERSION, type: 'campaign',
    exported: new Date().toISOString(), campaign, stores: {},
  };
  for (const name of STORES) {
    if (name === 'campaigns') continue;
    dump.stores[name] = await dbAll(name, campaignId);
  }
  return dump;
}

export async function importAll(dump, { replace = false } = {}) {
  if (!dump || dump.app !== 'dm-screen-kit' || !dump.stores) {
    throw new Error('Not a DM Screen backup file.');
  }
  // single-campaign file: put the campaign record, then its data (same ids
  // merge/overwrite, so re-importing an updated file refreshes in place)
  if (dump.type === 'campaign') {
    if (!dump.campaign?.id) throw new Error('Campaign backup is missing its campaign record.');
    await tx('campaigns', 'readwrite', s => s.put(dump.campaign));
    for (const name of STORES) {
      for (const rec of dump.stores[name] || []) {
        if (rec && rec.id) await tx(name, 'readwrite', s => s.put(rec));
      }
    }
    setPref('activeCampaign', dump.campaign.id);
    return;
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
