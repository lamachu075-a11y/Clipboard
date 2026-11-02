/*
 * Clipboard Extractor – extraction engine.
 *
 * Pure JavaScript with no browser dependencies, so it can run in the
 * extension service worker, in extension pages, and in Node (for tests).
 *
 * extract(text, settings) -> Array<Object<string, string>>
 *   Every object is one table row; keys are column names.
 *
 * One clipboard can produce many rows:
 *   - spreadsheet/TSV copies become one row per spreadsheet line
 *   - text is split into records (blank-line blocks, lines, custom delimiter)
 *   - inside a record, multiple matches of the same field are spread across
 *     rows ("zip" mode) or joined into one cell ("join" mode)
 */
(function (global) {
  'use strict';

  const MONTHS =
    'jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|' +
    'sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?';

  const trimTrailing = (chars) => (v) => v.replace(new RegExp('[' + chars + ']+$'), '');

  /**
   * Built-in fields, listed in evaluation order. Each field "claims" (masks)
   * the text it matched, so later fields can't re-match it — e.g. digits
   * inside a URL or a date are never reported as a phone number.
   */
  const BUILTIN_FIELDS = [
    {
      key: 'email',
      label: 'Email',
      defaultEnabled: true,
      regex: /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g,
    },
    {
      key: 'url',
      label: 'URL',
      defaultEnabled: true,
      regex: /\b(?:https?:\/\/|www\.)[^\s<>"'`]+/gi,
      clean: trimTrailing('.,;:!?)\\]}\'"'),
    },
    {
      key: 'ip',
      label: 'IP Address',
      defaultEnabled: false,
      regex: /\b(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\b/g,
    },
    {
      key: 'date',
      label: 'Date',
      defaultEnabled: true,
      regex: new RegExp(
        '\\b(?:' +
          '\\d{4}[-/.]\\d{1,2}[-/.]\\d{1,2}' + // 2026-11-02
          '|\\d{1,2}[-/.]\\d{1,2}[-/.](?:\\d{4}|\\d{2})' + // 02/11/2026
          '|\\d{1,2}(?:st|nd|rd|th)?\\s+(?:' + MONTHS + ')\\.?,?\\s+\\d{4}' + // 2 Nov 2026
          '|(?:' + MONTHS + ')\\.?\\s+\\d{1,2}(?:st|nd|rd|th)?,?\\s+\\d{4}' + // Nov 2, 2026
          ')\\b',
        'gi'
      ),
    },
    {
      key: 'amount',
      label: 'Amount',
      defaultEnabled: true,
      regex:
        /(?:[$€£¥₹]\s?|\b(?:USD|EUR|GBP|INR|JPY|AUD|CAD|Rs\.?)\s?)\d[\d,]*(?:\.\d+)?|\b\d[\d,]*(?:\.\d+)?\s?(?:USD|EUR|GBP|INR|JPY|AUD|CAD)\b/gi,
      clean: trimTrailing(','),
    },
    {
      key: 'phone',
      label: 'Phone',
      defaultEnabled: true,
      regex:
        /(?<![\w+])(?:\+\d{1,3}[ \t.-]?)?(?:\(\d{1,4}\)[ \t.-]?)?\d{2,5}(?:[ \t.-]\d{2,5}){1,4}(?!\w)|(?<![\w+])\+?\d{10,13}(?!\w)/g,
      validate: (v) => {
        if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(v)) return false; // IPv4, not a phone
        const digits = v.replace(/\D/g, '').length;
        return digits >= 7 && digits <= 15;
      },
    },
    {
      key: 'hashtag',
      label: 'Hashtag',
      defaultEnabled: false,
      regex: /(?<![\w#&])#[A-Za-z_]\w*/g,
    },
  ];

  /** Column order for built-in fields (independent of evaluation order). */
  const DISPLAY_ORDER = ['email', 'phone', 'url', 'date', 'amount', 'ip', 'hashtag'];

  const KV_FIELD = { key: 'kv', label: 'Labeled fields (Key: Value)', defaultEnabled: true };

  const DEFAULT_SETTINGS = {
    enabled: true,
    pollInterval: 1000,
    splitMode: 'auto', // auto | whole | line | blank | custom
    delimiter: '---',
    matchMode: 'zip', // zip: one row per match | join: one cell per field
    repeatSingles: true, // in zip mode, copy single-value fields into every row
    detectTables: true, // spreadsheet / TSV copies become rows directly
    dedupeRows: true, // skip rows identical to one already in the table
    keepSource: true, // keep the original clipboard text with each row
    minLength: 3, // ignore clipboard text shorter than this
    fields: {}, // { [builtinKey]: { enabled, required } }
    customFields: [], // [{ id, name, pattern, flags, group, enabled, required }]
  };

  for (const f of BUILTIN_FIELDS.concat(KV_FIELD)) {
    DEFAULT_SETTINGS.fields[f.key] = { enabled: f.defaultEnabled, required: false };
  }

  function normalizeSettings(s) {
    s = s && typeof s === 'object' ? s : {};
    const out = Object.assign({}, DEFAULT_SETTINGS, s);
    out.fields = {};
    for (const key of Object.keys(DEFAULT_SETTINGS.fields)) {
      out.fields[key] = Object.assign({}, DEFAULT_SETTINGS.fields[key], (s.fields || {})[key]);
    }
    out.customFields = Array.isArray(s.customFields) ? s.customFields.map((c) => Object.assign({}, c)) : [];
    out.pollInterval = Math.max(250, Number(out.pollInterval) || DEFAULT_SETTINGS.pollInterval);
    out.minLength = Math.max(0, Number(out.minLength) || 0);
    return out;
  }

  /** Compile a user regex; returns { regex } or { error }. */
  function compileCustom(cf) {
    try {
      let flags = String(cf.flags || '').replace(/[^dgimsuvy]/g, '');
      if (!flags.includes('g')) flags += 'g';
      flags = Array.from(new Set(flags)).join('');
      return { regex: new RegExp(cf.pattern, flags) };
    } catch (e) {
      return { error: e.message };
    }
  }

  const titleCase = (s) =>
    s
      .replace(/[_\s]+/g, ' ')
      .trim()
      .replace(/\b\w/g, (c) => c.toUpperCase());

  const KV_LINE = /^\s*([A-Za-z][A-Za-z0-9 _./()#&-]{0,39}?)\s*[:=]\s*(\S.*?)\s*$/;
  const KV_SKIP_KEYS = /^(https?|ftp|mailto|tel|file|data|javascript)$/i;

  function parseKeyValues(text) {
    const pairs = [];
    for (const line of text.split('\n')) {
      const m = KV_LINE.exec(line);
      if (!m) continue;
      const key = m[1].trim();
      if (KV_SKIP_KEYS.test(key)) continue;
      if (key.split(/\s+/).length > 5) continue; // looks like a sentence, not a label
      if (/^\/\//.test(m[2])) continue; // "something://..." scheme
      pairs.push([titleCase(key), m[2]]);
    }
    return pairs;
  }

  function scanRegex(regex, text, group) {
    const results = [];
    regex.lastIndex = 0;
    let m;
    while ((m = regex.exec(text)) !== null) {
      if (m[0] === '') {
        regex.lastIndex++;
        continue;
      }
      const g = Number(group) || 0;
      const value = m[g] !== undefined ? m[g] : m[0];
      results.push({ value, index: m.index, length: m[0].length });
    }
    return results;
  }

  /**
   * Find all field values in one record.
   * Returns an ordered Map: column label -> unique values in order of appearance.
   */
  function extractValues(record, settings) {
    const s = settings;
    const cols = new Map();
    const add = (label, value) => {
      value = String(value).trim();
      if (!value) return;
      if (!cols.has(label)) cols.set(label, []);
      const arr = cols.get(label);
      if (!arr.includes(value)) arr.push(value);
    };

    // 1. "Key: Value" lines (dynamic columns).
    const enabledBuiltinLabels = new Set(
      BUILTIN_FIELDS.filter((f) => s.fields[f.key].enabled).map((f) => f.label.toLowerCase())
    );
    if (s.fields.kv.enabled) {
      for (const [key, value] of parseKeyValues(record)) {
        // "Email: x@y.com" is already handled by the Email extractor.
        if (enabledBuiltinLabels.has(key.toLowerCase())) continue;
        add(key, value);
      }
    }

    // 2. Custom regex fields (run on the original text).
    for (const cf of s.customFields) {
      if (cf.enabled === false || !cf.pattern || !cf.name) continue;
      const { regex } = compileCustom(cf);
      if (!regex) continue;
      for (const r of scanRegex(regex, record, cf.group)) add(cf.name, r.value);
    }

    // 3. Built-in fields, masking what each one claims.
    let masked = record;
    const found = {};
    for (const f of BUILTIN_FIELDS) {
      if (!s.fields[f.key].enabled) continue;
      const values = [];
      for (const r of scanRegex(f.regex, masked)) {
        let v = f.clean ? f.clean(r.value) : r.value;
        if (f.validate && !f.validate(v)) continue;
        values.push(v);
        masked = masked.slice(0, r.index) + ' '.repeat(r.length) + masked.slice(r.index + r.length);
      }
      found[f.key] = values;
    }
    for (const key of DISPLAY_ORDER) {
      const f = BUILTIN_FIELDS.find((x) => x.key === key);
      for (const v of found[key] || []) add(f.label, v);
    }
    return cols;
  }

  function requiredLabels(settings) {
    const req = [];
    for (const f of BUILTIN_FIELDS) {
      const cfg = settings.fields[f.key];
      if (cfg.enabled && cfg.required) req.push(f.label);
    }
    for (const cf of settings.customFields) {
      if (cf.enabled !== false && cf.required && cf.name) req.push(cf.name);
    }
    return req;
  }

  /** Turn one record's column map into one or more rows. */
  function buildRows(cols, settings) {
    if (cols.size === 0) return [];
    const rows = [];
    if (settings.matchMode === 'join') {
      const row = {};
      for (const [label, values] of cols) row[label] = values.join(', ');
      rows.push(row);
    } else {
      const count = Math.max(...Array.from(cols.values(), (v) => v.length));
      for (let i = 0; i < count; i++) {
        const row = {};
        for (const [label, values] of cols) {
          if (values[i] !== undefined) row[label] = values[i];
          else if (settings.repeatSingles && values.length === 1) row[label] = values[0];
        }
        rows.push(row);
      }
    }
    const req = requiredLabels(settings);
    return rows.filter((r) => req.every((label) => r[label]));
  }

  /** Spreadsheet copies: every line has the same (>0) number of tabs. */
  function parseTable(text) {
    const lines = text.split('\n').filter((l) => l.trim() !== '');
    if (lines.length < 2) return null;
    const tabs = lines.map((l) => (l.match(/\t/g) || []).length);
    if (tabs[0] < 1 || !tabs.every((t) => t === tabs[0])) return null;
    const cells = lines.map((l) => l.split('\t').map((c) => c.trim()));

    const first = cells[0];
    const looksLikeHeader =
      first.every((c) => c && !/^[\d\s.,$€£¥₹%+-]+$/.test(c)) &&
      new Set(first.map((c) => c.toLowerCase())).size === first.length &&
      !first.some((c) => BUILTIN_FIELDS.some((f) => f.key !== 'hashtag' && scanRegex(f.regex, c).length));

    const headers = looksLikeHeader ? first : first.map((_, i) => 'Column ' + (i + 1));
    const body = looksLikeHeader ? cells.slice(1) : cells;
    return body
      .map((row) => {
        const obj = {};
        headers.forEach((h, i) => {
          if (row[i]) obj[h] = row[i];
        });
        return obj;
      })
      .filter((r) => Object.keys(r).length);
  }

  function splitRecords(text, settings) {
    const nonEmpty = (arr) => arr.map((x) => x.trim()).filter(Boolean);
    switch (settings.splitMode) {
      case 'whole':
        return [text];
      case 'line':
        return nonEmpty(text.split('\n'));
      case 'blank':
        return nonEmpty(text.split(/\n[ \t]*\n/));
      case 'custom': {
        const d = settings.delimiter || '\n';
        return nonEmpty(text.split(d.replace(/\\n/g, '\n').replace(/\\t/g, '\t')));
      }
      default: {
        // auto
        const blocks = nonEmpty(text.split(/\n[ \t]*\n/));
        if (blocks.length >= 2) return blocks;
        const lines = nonEmpty(text.split('\n'));
        if (lines.length < 2) return [text];
        // Labeled records ("Name: ..." on separate lines) belong together.
        if (settings.fields.kv.enabled && parseKeyValues(text).length >= 2) return [text];
        const withData = lines.filter((l) => extractValues(l, settings).size > 0).length;
        return withData >= 2 && withData >= lines.length / 2 ? lines : [text];
      }
    }
  }

  function extract(text, settings) {
    settings = normalizeSettings(settings);
    text = String(text == null ? '' : text).replace(/\r\n?/g, '\n');
    if (text.trim().length < Math.max(1, settings.minLength)) return [];

    let rows = null;
    if (settings.detectTables) rows = parseTable(text);
    if (!rows) {
      rows = [];
      for (const record of splitRecords(text, settings)) {
        rows.push(...buildRows(extractValues(record, settings), settings));
      }
    }

    // Drop identical rows produced by the same clipboard.
    const seen = new Set();
    return rows.filter((r) => {
      const k = rowKey(r);
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  }

  /** Stable identity for a row's data (used for de-duplication). */
  function rowKey(data) {
    return JSON.stringify(
      Object.keys(data)
        .sort()
        .map((k) => [k.toLowerCase(), String(data[k]).trim().toLowerCase()])
    );
  }

  const api = {
    BUILTIN_FIELDS,
    DISPLAY_ORDER,
    KV_FIELD,
    DEFAULT_SETTINGS,
    normalizeSettings,
    compileCustom,
    extract,
    rowKey,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  global.ClipExtractor = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
