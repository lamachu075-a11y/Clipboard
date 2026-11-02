/*
 * Clipboard Extractor – extraction engine.
 *
 * Pure JavaScript with no DOM dependencies, so it runs in the browser and in
 * Node (for tests).
 *
 *   extract(text, settings) -> Array<Object<string, string>>
 *     Every object is one table row; keys are column names.
 *
 *   explain(text, settings) -> trace of every step (used by the admin panel):
 *     { kind, reason, records: [{ text, offset, matches, rows, dropped }], rows, errors, ... }
 *
 * How one clipboard becomes rows:
 *   1. Spreadsheet copies (same number of tabs on every line) map 1:1 to rows.
 *   2. Otherwise the text is split into records (blank-line blocks, lines,
 *      a custom delimiter, or the whole text).
 *   3. In each record the rules run in order: "Key: Value" lines, custom
 *      rules, then built-in rules. Built-in rules claim the text they match,
 *      so later built-in rules can't match it again.
 *   4. Several matches of the same column in a record are spread across rows
 *      ("zip" mode) or joined into one cell ("join" mode).
 *   5. Rows missing a required column are dropped; duplicate rows are removed.
 */
(function (global) {
  'use strict';

  const MONTHS =
    'jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|' +
    'sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?';

  const trimTrailing = (chars) => (v) => v.replace(new RegExp('[' + chars + ']+$'), '');

  /**
   * Built-in rules, in evaluation order. The admin panel shows `pattern` and
   * lets the user override it per installation.
   */
  const BUILTIN_FIELDS = [
    {
      key: 'email',
      label: 'Email',
      hue: 210,
      defaultEnabled: true,
      description: 'name@domain.tld',
      pattern: '[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\\.[A-Za-z0-9-]+)*\\.[A-Za-z]{2,}',
      flags: 'g',
    },
    {
      key: 'url',
      label: 'URL',
      hue: 265,
      defaultEnabled: true,
      description: 'Links starting with http://, https:// or www. Trailing punctuation is removed.',
      pattern: '\\b(?:https?:\\/\\/|www\\.)[^\\s<>"\'`]+',
      flags: 'gi',
      clean: trimTrailing('.,;:!?)\\]}\'"'),
    },
    {
      key: 'ip',
      label: 'IP Address',
      hue: 185,
      defaultEnabled: false,
      description: 'IPv4 addresses such as 192.168.1.10',
      pattern: '\\b(?:(?:25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)\\.){3}(?:25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)\\b',
      flags: 'g',
    },
    {
      key: 'date',
      label: 'Date',
      hue: 35,
      defaultEnabled: true,
      description: '2026-11-02, 02/11/2026, 2 Nov 2026, Nov 2, 2026',
      pattern:
        '\\b(?:' +
        '\\d{4}[-/.]\\d{1,2}[-/.]\\d{1,2}' +
        '|\\d{1,2}[-/.]\\d{1,2}[-/.](?:\\d{4}|\\d{2})' +
        '|\\d{1,2}(?:st|nd|rd|th)?\\s+(?:' + MONTHS + ')\\.?,?\\s+\\d{4}' +
        '|(?:' + MONTHS + ')\\.?\\s+\\d{1,2}(?:st|nd|rd|th)?,?\\s+\\d{4}' +
        ')\\b',
      flags: 'gi',
    },
    {
      key: 'amount',
      label: 'Amount',
      hue: 0,
      defaultEnabled: true,
      description: 'Money with a currency symbol or code: $1,250.50, € 99, 500 USD, Rs. 300',
      pattern:
        '(?:[$€£¥₹]\\s?|\\b(?:USD|EUR|GBP|INR|JPY|AUD|CAD|Rs\\.?)\\s?)\\d[\\d,]*(?:\\.\\d+)?' +
        '|\\b\\d[\\d,]*(?:\\.\\d+)?\\s?(?:USD|EUR|GBP|INR|JPY|AUD|CAD)\\b',
      flags: 'gi',
      clean: trimTrailing(','),
    },
    {
      key: 'phone',
      label: 'Phone',
      hue: 140,
      defaultEnabled: true,
      description: 'Phone numbers with 7–15 digits, e.g. +1 (555) 123-4567, 020 7946 0958. Runs last so digits in dates, amounts and links are not counted.',
      pattern:
        '(?<![\\w+])(?:\\+\\d{1,3}[ \\t.-]?)?(?:\\(\\d{1,4}\\)[ \\t.-]?)?\\d{2,5}(?:[ \\t.-]\\d{2,5}){1,4}(?!\\w)' +
        '|(?<![\\w+])\\+?\\d{10,13}(?!\\w)',
      flags: 'g',
      validate: (v) => {
        if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(v)) return 'looks like an IP address';
        const digits = v.replace(/\D/g, '').length;
        return digits >= 7 && digits <= 15 ? true : `has ${digits} digits (needs 7–15)`;
      },
    },
    {
      key: 'hashtag',
      label: 'Hashtag',
      hue: 320,
      defaultEnabled: false,
      description: '#tags',
      pattern: '(?<![\\w#&])#[A-Za-z_]\\w*',
      flags: 'g',
    },
  ];

  /** Column order for built-in fields (independent of evaluation order). */
  const DISPLAY_ORDER = ['email', 'phone', 'url', 'date', 'amount', 'ip', 'hashtag'];

  const KV_LINE = /^\s*([A-Za-z][A-Za-z0-9 _./()#&-]{0,39}?)\s*[:=]\s*(\S.*?)\s*$/;
  const KV_SKIP_KEYS = /^(https?|ftp|mailto|tel|file|data|javascript)$/i;

  const KV_FIELD = {
    key: 'kv',
    label: 'Key: Value lines',
    hue: 50,
    defaultEnabled: true,
    description:
      'A line like "Name: Jane" or "City = Rome" creates a column named after the label. ' +
      'Labels that match a built-in column (e.g. "Email:") are left to that rule.',
    pattern: KV_LINE.source,
    flags: '',
  };

  const CUSTOM_HUES = [95, 290, 15, 170, 230, 340, 60, 250];

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
    fields: {}, // { [builtinKey]: { enabled, required, label?, pattern?, flags? } }
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

  /** Compile a user regex; returns { regex } or { error }. Always global. */
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

  const builtinRegex = (f) => new RegExp(f.pattern, f.flags);

  /**
   * Turn settings into the ordered list of active rules.
   * @returns {{ rules: Array, errors: Array<{id, label, message}> }}
   */
  function compileRules(settings) {
    const s = settings;
    const rules = [];
    const errors = [];
    if (s.fields.kv.enabled) rules.push({ id: 'kv', type: 'kv', label: KV_FIELD.label, hue: KV_FIELD.hue });

    s.customFields.forEach((cf, i) => {
      if (cf.enabled === false) return;
      const name = String(cf.name || '').trim();
      if (!name || !cf.pattern) return;
      const { regex, error } = compileCustom(cf);
      if (error) return errors.push({ id: 'custom:' + cf.id, label: name, message: error });
      rules.push({
        id: 'custom:' + cf.id,
        type: 'custom',
        label: name,
        regex,
        group: Number(cf.group) || 0,
        required: !!cf.required,
        hue: CUSTOM_HUES[i % CUSTOM_HUES.length],
      });
    });

    for (const f of BUILTIN_FIELDS) {
      const cfg = s.fields[f.key];
      if (!cfg.enabled) continue;
      let regex = builtinRegex(f);
      if (cfg.pattern || cfg.flags != null) {
        const r = compileCustom({ pattern: cfg.pattern || f.pattern, flags: cfg.flags != null ? cfg.flags : f.flags });
        if (r.error) errors.push({ id: f.key, label: f.label, message: r.error + ' (using the default pattern)' });
        else regex = r.regex;
      }
      rules.push({
        id: f.key,
        type: 'builtin',
        label: String(cfg.label || '').trim() || f.label,
        regex,
        clean: f.clean,
        validate: f.validate,
        required: !!cfg.required,
        hue: f.hue,
      });
    }
    return { rules, errors };
  }

  const titleCase = (s) =>
    s
      .replace(/[_\s]+/g, ' ')
      .trim()
      .replace(/\b\w/g, (c) => c.toUpperCase());

  /** "Key: Value" lines with the position of each value. */
  function parseKeyValues(text) {
    const pairs = [];
    let pos = 0;
    for (const line of text.split('\n')) {
      const m = KV_LINE.exec(line);
      if (m) {
        const key = m[1].trim();
        const ok =
          !KV_SKIP_KEYS.test(key) &&
          key.split(/\s+/).length <= 5 &&
          !/^\/\//.test(m[2]) && // "scheme://"
          !(/\d$/.test(key) && /^\d/.test(m[2])); // a time like "at 9:30", not a label
        if (ok) {
          const end = pos + line.replace(/\s+$/, '').length;
          pairs.push({ key: titleCase(key), value: m[2], start: end - m[2].length, end });
        }
      }
      pos += line.length + 1;
    }
    return pairs;
  }

  function scanRegex(regex, text, group) {
    const results = [];
    const g = Number(group) || 0;
    regex.lastIndex = 0;
    let m;
    while ((m = regex.exec(text)) !== null) {
      if (m[0] === '') {
        regex.lastIndex++;
        continue;
      }
      const value = m[g] !== undefined ? m[g] : m[0];
      const rel = g ? Math.max(0, m[0].indexOf(value)) : 0;
      results.push({ value, index: m.index, length: m[0].length, start: m.index + rel, end: m.index + rel + value.length });
    }
    return results;
  }

  /**
   * Run every rule on one record.
   * @returns {{ cols: Map<string, string[]>, matches: Array }}
   *   matches: { ruleId, label, value, start, end, status: used|duplicate|skipped|rejected, note }
   *   (start/end are positions in the full clipboard text)
   */
  function extractRecord(text, offset, rules) {
    const cols = new Map();
    const matches = [];
    const add = (m) => {
      m.value = String(m.value).trim();
      matches.push(m);
      if (m.status) return;
      if (!m.value) return Object.assign(m, { status: 'skipped', note: 'empty value' });
      if (!cols.has(m.label)) cols.set(m.label, []);
      const arr = cols.get(m.label);
      if (arr.includes(m.value)) return Object.assign(m, { status: 'duplicate', note: 'same value already found in this record' });
      arr.push(m.value);
      m.status = 'used';
    };
    // "Email: x" is left to the Email rule; "Bill to: x" to a custom "Bill to" rule.
    const builtinLabels = new Map(rules.filter((r) => r.type !== 'kv').map((r) => [r.label.toLowerCase(), r.label]));

    for (const rule of rules) {
      if (rule.type === 'kv') {
        for (const p of parseKeyValues(text)) {
          const m = { ruleId: 'kv', hue: rule.hue, label: p.key, value: p.value, start: offset + p.start, end: offset + p.end };
          if (builtinLabels.has(p.key.toLowerCase())) {
            Object.assign(m, { status: 'skipped', note: `left to the ${builtinLabels.get(p.key.toLowerCase())} rule` });
          }
          add(m);
        }
      } else if (rule.type === 'custom') {
        for (const r of scanRegex(rule.regex, text, rule.group)) {
          add({ ruleId: rule.id, hue: rule.hue, label: rule.label, value: r.value, start: offset + r.start, end: offset + r.end });
        }
      }
    }

    // Built-in rules claim (mask) the text they match.
    let masked = text;
    const found = {};
    for (const rule of rules) {
      if (rule.type !== 'builtin') continue;
      found[rule.id] = [];
      for (const r of scanRegex(rule.regex, masked, 0)) {
        const value = rule.clean ? rule.clean(r.value) : r.value;
        const m = { ruleId: rule.id, hue: rule.hue, label: rule.label, value, start: offset + r.start, end: offset + r.start + value.length };
        const verdict = rule.validate ? rule.validate(value) : true;
        if (verdict !== true) {
          Object.assign(m, { status: 'rejected', note: verdict || 'failed validation' });
        } else {
          masked = masked.slice(0, r.index) + ' '.repeat(r.length) + masked.slice(r.index + r.length);
        }
        found[rule.id].push(m);
      }
    }
    for (const key of DISPLAY_ORDER) for (const m of found[key] || []) add(m);

    return { cols, matches };
  }

  /** Turn one record's columns into rows. */
  function buildRows(cols, settings, rules) {
    if (cols.size === 0) return { rows: [], dropped: [] };
    let rows = [];
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
    const required = rules.filter((r) => r.required).map((r) => r.label);
    const dropped = [];
    rows = rows.filter((r) => {
      const missing = required.filter((label) => !r[label]);
      if (missing.length) dropped.push({ row: r, missing });
      return !missing.length;
    });
    return { rows, dropped };
  }

  const DEFAULT_REGEXES = BUILTIN_FIELDS.filter((f) => f.key !== 'hashtag').map(builtinRegex);

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
      !first.some((c) => DEFAULT_REGEXES.some((re) => scanRegex(re, c).length));

    const headers = looksLikeHeader ? first : first.map((_, i) => 'Column ' + (i + 1));
    const body = looksLikeHeader ? cells.slice(1) : cells;
    const rows = body
      .map((row) => {
        const obj = {};
        headers.forEach((h, i) => {
          if (row[i]) obj[h] = row[i];
        });
        return obj;
      })
      .filter((r) => Object.keys(r).length);
    return {
      rows,
      reason:
        `Spreadsheet copy detected: all ${lines.length} lines have ${tabs[0]} tab${tabs[0] === 1 ? '' : 's'}, ` +
        (looksLikeHeader ? 'so the first line is used as column names.' : 'no header line, so columns are numbered.'),
    };
  }

  /** Split text into trimmed, non-empty pieces, keeping their offsets. */
  function pieces(text, separator) {
    const out = [];
    const push = (s, e) => {
      const raw = text.slice(s, e);
      const t = raw.trim();
      if (t) out.push({ text: t, offset: s + raw.length - raw.trimStart().length });
    };
    let last = 0;
    separator.lastIndex = 0;
    let m;
    while ((m = separator.exec(text)) !== null) {
      if (m[0] === '') {
        separator.lastIndex++;
        continue;
      }
      push(last, m.index);
      last = m.index + m[0].length;
    }
    push(last, text.length);
    return out;
  }

  const BLANK_LINES = /\n[ \t]*\n(?:[ \t]*\n)*/g;
  const LINES = /\n/g;
  const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  function splitRecords(text, settings, rules) {
    const whole = [{ text, offset: 0 }];
    const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
    switch (settings.splitMode) {
      case 'whole':
        return { mode: 'whole', records: whole, reason: 'Setting: the whole text is one record.' };
      case 'line': {
        const records = pieces(text, LINES);
        return { mode: 'line', records, reason: `Setting: each line is a record (${plural(records.length, 'line')}).` };
      }
      case 'blank': {
        const records = pieces(text, BLANK_LINES);
        return { mode: 'blank', records, reason: `Setting: split at blank lines (${plural(records.length, 'block')}).` };
      }
      case 'custom': {
        const d = (settings.delimiter || '\n').replace(/\\n/g, '\n').replace(/\\t/g, '\t');
        const records = pieces(text, new RegExp(escapeRegex(d), 'g'));
        return { mode: 'custom', records, reason: `Setting: split at "${settings.delimiter}" (${plural(records.length, 'record')}).` };
      }
      default: {
        const blocks = pieces(text, BLANK_LINES);
        if (blocks.length >= 2) {
          return { mode: 'blank', records: blocks, reason: `Auto: the text has blank lines, so each of the ${blocks.length} blocks is a record.` };
        }
        const lines = pieces(text, LINES);
        if (lines.length < 2) return { mode: 'whole', records: whole, reason: 'Auto: a single line, so the whole text is one record.' };
        if (settings.fields.kv.enabled && parseKeyValues(text).length >= 2) {
          return {
            mode: 'whole',
            records: whole,
            reason: 'Auto: the text has "Key: Value" lines, so it is kept together as one record (repeated labels become separate rows).',
          };
        }
        const withData = lines.filter((l) => extractRecord(l.text, 0, rules).cols.size > 0).length;
        if (withData >= 2 && withData >= lines.length / 2) {
          return { mode: 'line', records: lines, reason: `Auto: ${withData} of ${lines.length} lines contain data, so each line is a record.` };
        }
        return { mode: 'whole', records: whole, reason: `Auto: only ${withData} of ${lines.length} lines contain data, so the whole text is one record.` };
      }
    }
  }

  /** Full trace of how `text` is turned into rows. */
  function explain(text, settings) {
    settings = normalizeSettings(settings);
    text = String(text == null ? '' : text).replace(/\r\n?/g, '\n');
    const result = { text, kind: 'text', mode: null, reason: '', records: [], rows: [], errors: [], duplicateRows: 0, ignored: null };

    if (text.trim().length < Math.max(1, settings.minLength)) {
      result.ignored = text.trim() ? `Text is shorter than the minimum of ${settings.minLength} characters.` : 'No text.';
      return result;
    }
    const { rules, errors } = compileRules(settings);
    result.errors = errors;
    result.rules = rules.map(({ id, type, label, hue, required }) => ({ id, type, label, hue, required }));

    let rows = [];
    const table = settings.detectTables ? parseTable(text) : null;
    if (table) {
      result.kind = 'table';
      result.reason = table.reason;
      rows = table.rows;
    } else {
      const split = splitRecords(text, settings, rules);
      result.mode = split.mode;
      result.reason = split.reason;
      for (const rec of split.records) {
        const { cols, matches } = extractRecord(rec.text, rec.offset, rules);
        const built = buildRows(cols, settings, rules);
        result.records.push({ text: rec.text, offset: rec.offset, matches, rows: built.rows, dropped: built.dropped });
        rows.push(...built.rows);
      }
    }

    // Drop identical rows produced by the same text.
    const seen = new Set();
    result.rows = rows.filter((r) => {
      const k = rowKey(r);
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
    result.duplicateRows = rows.length - result.rows.length;
    return result;
  }

  function extract(text, settings) {
    return explain(text, settings).rows;
  }

  /** Stable identity for a row's data (used for de-duplication). */
  function rowKey(data) {
    return JSON.stringify(
      Object.keys(data)
        .sort()
        .map((k) => [k.toLowerCase(), String(data[k]).trim().toLowerCase()])
    );
  }

  /** Extraction-related part of the settings (what the admin panel edits). */
  const RULE_KEYS = ['splitMode', 'delimiter', 'matchMode', 'repeatSingles', 'detectTables', 'dedupeRows', 'keepSource', 'minLength', 'fields', 'customFields'];
  function rulesOf(settings) {
    const s = normalizeSettings(settings);
    const out = {};
    for (const k of RULE_KEYS) out[k] = s[k];
    return out;
  }
  const sameRules = (a, b) => JSON.stringify(rulesOf(a)) === JSON.stringify(rulesOf(b));

  const api = {
    BUILTIN_FIELDS,
    DISPLAY_ORDER,
    KV_FIELD,
    CUSTOM_HUES,
    DEFAULT_SETTINGS,
    RULE_KEYS,
    normalizeSettings,
    compileCustom,
    compileRules,
    explain,
    extract,
    rowKey,
    rulesOf,
    sameRules,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  global.ClipExtractor = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
