/*
 * Browser persistence (client-side only).
 *
 * localStorage keys (prefixed):
 *   settings  – user settings (see DEFAULT_SETTINGS in extractor.js)
 *   rows      – [{ id, clipId, capturedAt, data: {col: value}, cols: [col...], source }]
 *   lastText  – last clipboard text seen (so a reload doesn't re-import it)
 *   stats     – { lastCaptureAt, lastCaptureCount }
 *   project   – { id, name, createdAt, savedAt, dirty, closed }
 *   draft     – text in the admin panel's "Test & explain" box
 *
 * Saved projects ("Projects" list) live in IndexedDB.
 * Changes made in another tab are broadcast through the `storage` event.
 */
import { normalizeSettings, rowKey } from './extractor.js';

const PREFIX = 'clipboard-extractor:';
const MAX_ROWS = 5000;
const MAX_SOURCE = 2000;
const listeners = new Set();
const isBrowser = typeof window !== 'undefined';

// In-memory fallback when localStorage is unavailable (private mode, blocked storage).
const memory = {};
function read(key, fallback) {
  try {
    const raw = window.localStorage.getItem(PREFIX + key);
    return raw == null ? fallback : JSON.parse(raw);
  } catch {
    return key in memory ? memory[key] : fallback;
  }
}
function write(key, value) {
  memory[key] = value;
  try {
    window.localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch (e) {
    if (e && e.name === 'QuotaExceededError') throw new Error('Browser storage is full: export and clear some rows.');
  }
}
const emit = (key) => listeners.forEach((fn) => fn(key));

export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

/** Column names of a stored row, in extraction order. */
export function columnsOfRow(row) {
  const keys = Object.keys(row.data);
  if (!Array.isArray(row.cols)) return keys;
  return row.cols.filter((k) => k in row.data).concat(keys.filter((k) => !row.cols.includes(k)));
}

/** Union of all columns of several rows, in order of first appearance. */
export function columnsOf(list) {
  const cols = [];
  const seen = new Set();
  for (const r of list) for (const k of columnsOfRow(r)) if (!seen.has(k)) seen.add(k), cols.push(k);
  return cols;
}

const Store = {
  MAX_ROWS,

  getSettings() {
    return normalizeSettings(read('settings'));
  },
  saveSettings(settings) {
    write('settings', normalizeSettings(settings));
    emit('settings');
  },

  getRows() {
    const rows = read('rows', []);
    return Array.isArray(rows) ? rows : [];
  },
  /** Replace all rows. Marks the project as having unsaved changes unless `dirty: false`. */
  setRows(rows, { dirty = true } = {}) {
    write('rows', rows.slice(-MAX_ROWS));
    emit('rows');
    const p = Store.getProject();
    if (p.dirty !== dirty) Store.setProject(Object.assign(p, { dirty }));
  },

  getProject() {
    const p = read('project', null);
    return Object.assign({ id: null, name: 'Untitled project', createdAt: Date.now(), savedAt: null, dirty: false, closed: false }, p || {});
  },
  setProject(project) {
    write('project', project);
    emit('project');
  },

  getDraft() {
    return read('draft', null);
  },
  setDraft(text) {
    write('draft', String(text).slice(0, 100000));
  },

  /**
   * Append extracted rows; returns the rows actually added.
   * @param {Array<Object>} dataRows  output of extract()
   * @param {{source?: string, dedupe?: boolean}} opts
   */
  addRows(dataRows, opts = {}) {
    if (!dataRows.length) return [];
    const rows = Store.getRows();
    const existing = opts.dedupe ? new Set(rows.map((r) => rowKey(r.data))) : null;
    const clipId = uid();
    const now = Date.now();
    const added = [];
    for (const data of dataRows) {
      if (existing) {
        const k = rowKey(data);
        if (existing.has(k)) continue;
        existing.add(k);
      }
      added.push({
        id: uid(),
        clipId,
        capturedAt: now,
        data,
        cols: Object.keys(data),
        source: opts.source ? String(opts.source).slice(0, MAX_SOURCE) : '',
      });
    }
    if (added.length) {
      Store.setRows(rows.concat(added));
      write('stats', { lastCaptureAt: now, lastCaptureCount: added.length });
    }
    return added;
  },

  getLastText() {
    return read('lastText', '');
  },
  setLastText(text) {
    write('lastText', String(text).slice(0, 100000));
    emit('lastText');
  },

  /** Subscribe to changes (this tab or other tabs). fn(key); returns an unsubscribe function. */
  onChange(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
};

/*
 * Saved projects, in IndexedDB (they can be larger than localStorage allows).
 * Document: { id, name, createdAt, savedAt, rowCount, rules, rows }
 */
let dbPromise = null;
function db() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      if (!isBrowser || !window.indexedDB) return reject(new Error('This browser cannot store projects (IndexedDB is unavailable).'));
      const req = window.indexedDB.open('clipboard-extractor', 1);
      req.onupgradeneeded = () => req.result.createObjectStore('projects', { keyPath: 'id' });
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    dbPromise.catch(() => (dbPromise = null));
  }
  return dbPromise;
}
async function tx(mode, fn) {
  const conn = await db();
  return new Promise((resolve, reject) => {
    const t = conn.transaction('projects', mode);
    const req = fn(t.objectStore('projects'));
    t.oncomplete = () => resolve(req ? req.result : undefined);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error('Storage failed (the disk may be full).'));
  });
}
const libraryChanged = () => {
  write('libraryVersion', Date.now()); // lets other tabs know
  emit('library');
};

export const Library = {
  /** Project summaries, newest first (without rows). */
  async list() {
    const all = (await tx('readonly', (s) => s.getAll())) || [];
    return all
      .map(({ rows, rules, ...meta }) => Object.assign(meta, { rowCount: meta.rowCount ?? (rows ? rows.length : 0) }))
      .sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0));
  },
  get(id) {
    return tx('readonly', (s) => s.get(id));
  },
  async put(doc) {
    await tx('readwrite', (s) => s.put(doc));
    libraryChanged();
  },
  async remove(id) {
    await tx('readwrite', (s) => s.delete(id));
    libraryChanged();
  },
};

if (isBrowser) {
  window.addEventListener('storage', (e) => {
    if (!e.key || !e.key.startsWith(PREFIX)) return;
    const key = e.key.slice(PREFIX.length);
    emit(key === 'libraryVersion' ? 'library' : key);
  });
}

export default Store;
