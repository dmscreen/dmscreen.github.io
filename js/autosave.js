// Auto-save to a file, ported from listboard.github.io.
//
// The File System Access API hands back a handle to a file the user picked.
// The handle is structured-cloneable, so it can live in IndexedDB and outlast
// a reload, and Chrome can grant it permission for every visit. After one
// dialog the app writes a full backup to that file whenever anything changes.
//
// Be honest about the limit: clearing site data takes the handle with it, the
// same as everything else. What it does not take is the file, which is the
// whole point. Point it at a synced folder and there is a copy off this
// machine that survives the browser entirely.
//
// Chromium desktop only. Firefox and every browser on iOS have no such API,
// so the Settings card simply never appears there and manual export stays
// the way.
//
// The handle lives in its own tiny database rather than the main one so that
// exportAll() never tries to serialise it into a backup file.

import { exportAll, setPref, onDbWrite } from './store.js';
import { toast } from './components/ui.js';

const IDB_NAME = 'dmsk-autosave';
const IDB_STORE = 'kv';
const HANDLE_KEY = 'autosave-handle';
const DEBOUNCE = 1500;

export const autosaveSupported = () => !!(window.showSaveFilePicker && window.indexedDB);

function idb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(IDB_STORE)) req.result.createObjectStore(IDB_STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function idbDo(mode, fn) {
  return idb().then(db => new Promise((resolve, reject) => {
    const t = db.transaction(IDB_STORE, mode);
    const req = fn(t.objectStore(IDB_STORE));
    t.oncomplete = () => resolve(req && req.result);
    t.onerror = () => reject(t.error);
  }));
}

export const autosave = { handle: null, name: '', at: null, error: '', perm: 'granted', timer: null, busy: false };

const listeners = new Set();
export function onAutosaveChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }
function notify() { for (const fn of listeners) fn(autosave); }

export async function autosaveInit() {
  if (!autosaveSupported()) return;
  try {
    const h = await idbDo('readonly', st => st.get(HANDLE_KEY));
    if (h) {
      autosave.handle = h;
      autosave.name = h.name || 'a file';
      // queryPermission never prompts. Asking for permission needs a user
      // gesture, so whatever it reports is recorded and acted on from a
      // button rather than nagged about on load.
      //
      // 'prompt' here is the ordinary case, not a fault: browsers hand out
      // file-write permission for the session, so a refresh drops back to
      // asking unless the grant was made permanent in the browser's own
      // dialog. 'denied' is the genuine problem. They read very differently
      // and must not share a message.
      autosave.perm = await h.queryPermission({ mode: 'readwrite' });
    }
  } catch { /* no handle, or storage refused: manual export stands */ }
  notify();
}

export function autosavePick() {
  if (!autosaveSupported()) return;
  window.showSaveFilePicker({
    // Named for the site rather than just the app, so a file sitting in a
    // folder months later still says where it came from.
    suggestedName: 'dmscreen-github-io.json',
    types: [{ description: 'DM Screen backup', accept: { 'application/json': ['.json'] } }],
  }).then(h => {
    autosave.handle = h;
    autosave.name = h.name || 'a file';
    autosave.error = '';
    return idbDo('readwrite', st => st.put(h, HANDLE_KEY)).then(() => autosaveWrite(true));
  }).catch(err => {
    // Cancelling the dialog is not a failure.
    if (err && err.name === 'AbortError') return;
    autosave.error = (err && err.message) || 'could not use that file';
    notify();
  });
}

export function autosaveStop() {
  autosave.handle = null; autosave.name = ''; autosave.at = null;
  autosave.error = ''; autosave.perm = 'granted';
  clearTimeout(autosave.timer);
  idbDo('readwrite', st => st.delete(HANDLE_KEY)).catch(() => {}).then(notify);
}

// Writes the same payload Export everything produces, so the file is a
// normal backup that Import already understands.
export async function autosaveWrite(loud) {
  if (!autosave.handle || autosave.busy) return;
  autosave.busy = true;
  const h = autosave.handle;
  try {
    autosave.perm = await h.queryPermission({ mode: 'readwrite' });
    if (autosave.perm !== 'granted') throw new Error('permission');
    const w = await h.createWritable();
    await w.write(JSON.stringify(await exportAll(), null, 1));
    await w.close();
    autosave.at = new Date();
    autosave.error = '';
    // An automatic write is a real backup, so the storage-health line counts
    // it. Otherwise Settings would nag while the app dutifully saves.
    setPref('lastBackup', autosave.at.getTime());
    if (loud) toast(`Auto-saving to ${autosave.name}`);
  } catch (err) {
    if (!autosave.error) autosave.error = (err && err.message) || 'write failed';
  } finally {
    autosave.busy = false;
    notify();
  }
}

// Debounced, because one action can put several records.
export function autosaveSchedule() {
  if (!autosave.handle) return;
  clearTimeout(autosave.timer);
  autosave.timer = setTimeout(() => autosaveWrite(false), DEBOUNCE);
}

export function autosaveReconnect() {
  if (!autosave.handle) return;
  autosave.handle.requestPermission({ mode: 'readwrite' }).then(state => {
    autosave.perm = state;
    if (state === 'granted') { autosave.error = ''; return autosaveWrite(true); }
    notify();
  }).catch(() => notify());
}

// Every database write anywhere in the app lands here.
onDbWrite(autosaveSchedule);
