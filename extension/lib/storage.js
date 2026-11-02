/*
 * Thin wrapper over chrome.storage.local shared by the service worker and
 * extension pages. Requires extractor.js to be loaded first.
 *
 * Keys:
 *   settings  – user settings (see ClipExtractor.DEFAULT_SETTINGS)
 *   rows      – [{ id, clipId, capturedAt, data: {col: value}, source }]
 *   lastText  – last clipboard text seen (to detect changes)
 *   stats     – { lastCaptureAt, lastCaptureCount }
 */
(function (global) {
  'use strict';

  const MAX_ROWS = 10000;
  const E = global.ClipExtractor;

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

    async getSettings() {
      const { settings } = await chrome.storage.local.get('settings');
      return E.normalizeSettings(settings);
    },

    async saveSettings(settings) {
      await chrome.storage.local.set({ settings: E.normalizeSettings(settings) });
    },

    async getRows() {
      const { rows } = await chrome.storage.local.get('rows');
      return Array.isArray(rows) ? rows : [];
    },

    async setRows(rows) {
      await chrome.storage.local.set({ rows: rows.slice(-MAX_ROWS) });
    },

    /**
     * Append extracted rows. Returns the rows actually added.
     * @param {Array<Object>} dataRows  output of ClipExtractor.extract
     * @param {{source?: string, dedupe?: boolean}} opts
     */
    async addRows(dataRows, opts = {}) {
      if (!dataRows.length) return [];
      const rows = await Store.getRows();
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
          // chrome.storage does not keep object key order, so keep it explicitly.
          cols: Object.keys(data),
          source: opts.source ? String(opts.source).slice(0, 2000) : '',
        });
      }
      if (added.length) {
        await Store.setRows(rows.concat(added));
        await chrome.storage.local.set({ stats: { lastCaptureAt: now, lastCaptureCount: added.length } });
      }
      return added;
    },

    async getStats() {
      const { stats } = await chrome.storage.local.get('stats');
      return stats || {};
    },
  };

  global.ClipStore = Store;
})(typeof globalThis !== 'undefined' ? globalThis : this);
