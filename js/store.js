/*
 * Local persistence for the web app (localStorage).
 * Requires extractor.js to be loaded first.
 *
 * Keys (prefixed):
 *   settings  – user settings (see ClipExtractor.DEFAULT_SETTINGS)
 *   rows      – [{ id, clipId, capturedAt, data: {col: value}, cols: [col...], source }]
 *   lastText  – last clipboard text seen (so a reload doesn't re-import it)
 *   stats     – { lastCaptureAt, lastCaptureCount }
 *   project   – { name, createdAt, savedAt, fileName, dirty }
 *   draft     – text in the admin panel's "Test & explain" box
 *
 * Changes made in another tab are broadcast through the `storage` event.
 */
(function (global) {
  'use strict';

  const E = global.ClipExtractor;
  const PREFIX = 'clipboard-extractor:';
  const MAX_ROWS = 5000;
  const MAX_SOURCE = 2000;
  const listeners = new Set();

  // In-memory fallback when localStorage is unavailable (private mode, blocked cookies).
  const memory = {};
  function read(key, fallback) {
    try {
      const raw = localStorage.getItem(PREFIX + key);
      return raw == null ? fallback : JSON.parse(raw);
    } catch (e) {
      return key in memory ? memory[key] : fallback;
    }
  }
  function write(key, value) {
    memory[key] = value;
    try {
      localStorage.setItem(PREFIX + key, JSON.stringify(value));
    } catch (e) {
      if (e && e.name === 'QuotaExceededError') throw new Error('Browser storage is full — export and clear some rows.');
      // storage unavailable: keep in memory only
    }
  }
  const emit = (key) => listeners.forEach((fn) => fn(key));

  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

  const Store = {
    MAX_ROWS,
    uid,

    /** Column names of a stored row, in extraction order. */
    columnsOf(row) {
      const keys = Object.keys(row.data);
      if (!Array.isArray(row.cols)) return keys;
      return row.cols.filter((k) => k in row.data).concat(keys.filter((k) => !row.cols.includes(k)));
    },

    getSettings() {
      return E.normalizeSettings(read('settings'));
    },
    saveSettings(settings) {
      write('settings', E.normalizeSettings(settings));
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
      return Object.assign({ name: 'Untitled project', createdAt: Date.now(), savedAt: null, fileName: null, dirty: false }, p || {});
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
     * @param {Array<Object>} dataRows  output of ClipExtractor.extract
     * @param {{source?: string, dedupe?: boolean}} opts
     */
    addRows(dataRows, opts = {}) {
      if (!dataRows.length) return [];
      const rows = Store.getRows();
      const existing = opts.dedupe ? new Set(rows.map((r) => E.rowKey(r.data))) : null;
      const clipId = uid();
      const now = Date.now();
      const added = [];
      for (const data of dataRows) {
        if (existing) {
          const k = E.rowKey(data);
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
    },

    getStats() {
      return read('stats', {});
    },

    /** Subscribe to changes (this tab or other tabs). fn(key) */
    onChange(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };

  global.addEventListener?.('storage', (e) => {
    if (e.key && e.key.startsWith(PREFIX)) emit(e.key.slice(PREFIX.length));
  });

  global.ClipStore = Store;
})(typeof globalThis !== 'undefined' ? globalThis : this);
