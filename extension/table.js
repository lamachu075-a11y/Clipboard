const E = window.ClipExtractor;
const Store = window.ClipStore;
const $ = (id) => document.getElementById(id);
const el = (tag, props = {}, children = []) => {
  const n = Object.assign(document.createElement(tag), props);
  n.append(...children);
  return n;
};

let rows = [];
let settings = E.normalizeSettings();
let sort = { col: '__time', dir: 'desc' };
let filter = '';
let knownIds = null; // to highlight newly captured rows

// ---------- helpers ----------

function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.remove('show'), 2200);
}

const fmtTime = (ts) =>
  new Date(ts).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' });

/** Union of all data keys, in order of first appearance. */
function columnsOf(list) {
  const cols = [];
  const seen = new Set();
  for (const r of list) for (const k of Store.columnsOf(r)) if (!seen.has(k)) seen.add(k), cols.push(k);
  return cols;
}

function visibleRows() {
  const q = filter.trim().toLowerCase();
  let list = q
    ? rows.filter((r) => Object.values(r.data).some((v) => String(v).toLowerCase().includes(q)) || (r.source || '').toLowerCase().includes(q))
    : rows.slice();
  const dir = sort.dir === 'asc' ? 1 : -1;
  const idx = new Map(rows.map((r, i) => [r.id, i]));
  list.sort((a, b) => {
    // Newest capture first by default, but rows of one capture stay in clipboard order.
    if (sort.col === '__time') return (a.capturedAt - b.capturedAt) * dir || idx.get(a.id) - idx.get(b.id);
    const av = a.data[sort.col] ?? '';
    const bv = b.data[sort.col] ?? '';
    return String(av).localeCompare(String(bv), undefined, { numeric: true, sensitivity: 'base' }) * dir;
  });
  return list;
}

function linkify(value) {
  if (/^(https?:\/\/|www\.)\S+$/i.test(value)) {
    const href = /^www\./i.test(value) ? 'https://' + value : value;
    return el('a', { href, target: '_blank', rel: 'noopener noreferrer', textContent: value });
  }
  if (/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(value)) return el('a', { href: 'mailto:' + value, textContent: value });
  return document.createTextNode(value);
}

// ---------- table ----------

function render() {
  const list = visibleRows();
  const cols = columnsOf(rows);
  const thead = $('table').tHead;
  const tbody = $('table').tBodies[0];

  const th = (label, key, sortable = true) => {
    const h = el('th', { textContent: label });
    if (!sortable) h.className = 'nosort';
    else {
      if (sort.col === key) h.dataset.sort = sort.dir;
      h.addEventListener('click', () => {
        sort = sort.col === key ? { col: key, dir: sort.dir === 'asc' ? 'desc' : 'asc' } : { col: key, dir: 'asc' };
        render();
      });
    }
    return h;
  };
  thead.replaceChildren(
    el('tr', {}, [
      th('#', null, false),
      th('Captured', '__time'),
      ...cols.map((c) => th(c, c)),
      ...(settings.keepSource ? [th('Source text', null, false)] : []),
      th('', null, false),
    ])
  );

  const frag = document.createDocumentFragment();
  let lastClip = null;
  let alt = false;
  list.forEach((r, i) => {
    if (r.clipId !== lastClip) (alt = !alt), (lastClip = r.clipId);
    const tr = el('tr', { className: (alt ? 'alt' : '') + (knownIds && !knownIds.has(r.id) ? ' fresh' : '') });
    tr.dataset.id = r.id;
    tr.append(el('td', { className: 'meta', textContent: i + 1 }), el('td', { className: 'meta', textContent: fmtTime(r.capturedAt) }));
    for (const c of cols) {
      const td = el('td', { className: 'cell', tabIndex: 0, title: 'Double-click to edit' });
      td.dataset.col = c;
      if (r.data[c] != null) td.append(linkify(String(r.data[c])));
      tr.append(td);
    }
    if (settings.keepSource) tr.append(el('td', { className: 'source', textContent: r.source || '', title: r.source || '' }));
    tr.append(el('td', {}, [el('button', { className: 'icon', textContent: '✕', title: 'Delete row', 'aria-label': 'Delete row', onclick: () => deleteRow(r.id) })]));
    frag.append(tr);
  });
  tbody.replaceChildren(frag);
  knownIds = new Set(rows.map((r) => r.id));

  $('empty').hidden = rows.length > 0;
  $('table').hidden = rows.length === 0;
  const clips = new Set(rows.map((r) => r.clipId)).size;
  $('summary').textContent = rows.length
    ? `${list.length === rows.length ? rows.length : list.length + ' of ' + rows.length} rows · ${cols.length} columns · from ${clips} clipboard capture${clips === 1 ? '' : 's'}`
    : '';
}

async function deleteRow(id) {
  rows = rows.filter((r) => r.id !== id);
  await Store.setRows(rows);
}

// inline editing
$('table').addEventListener('dblclick', (e) => {
  const td = e.target.closest('td.cell');
  if (!td) return;
  e.preventDefault();
  td.textContent = td.textContent; // drop links while editing
  td.contentEditable = 'plaintext-only';
  td.focus();
  document.getSelection().selectAllChildren(td);
});
$('table').addEventListener('keydown', (e) => {
  const td = e.target.closest('td.cell');
  if (!td) return;
  if (td.isContentEditable && (e.key === 'Enter' || e.key === 'Escape')) {
    e.preventDefault();
    if (e.key === 'Escape') td.dataset.cancel = '1';
    td.blur();
  } else if (!td.isContentEditable && e.key === 'Enter') {
    td.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
  }
});
$('table').addEventListener('focusout', async (e) => {
  const td = e.target.closest?.('td.cell');
  if (!td || !td.isContentEditable) return;
  td.contentEditable = 'false';
  const row = rows.find((r) => r.id === td.parentElement.dataset.id);
  if (!row || td.dataset.cancel) return render();
  const value = td.textContent.trim();
  if (value) {
    row.data[td.dataset.col] = value;
    if (Array.isArray(row.cols) && !row.cols.includes(td.dataset.col)) row.cols.push(td.dataset.col);
  }
  else delete row.data[td.dataset.col];
  await Store.setRows(rows);
});

// ---------- export ----------

function exportMatrix() {
  const list = visibleRows();
  const cols = columnsOf(list);
  return [['Captured', ...cols], ...list.map((r) => [new Date(r.capturedAt).toISOString(), ...cols.map((c) => r.data[c] ?? '')])];
}

function download(name, type, content) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  el('a', { href: url, download: name }).click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const stamp = () => new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');

$('exportCsv').addEventListener('click', () => {
  if (!rows.length) return toast('Nothing to export');
  const esc = (v) => (/[",\n\r]/.test(v) ? '"' + String(v).replace(/"/g, '""') + '"' : String(v));
  const csv = exportMatrix().map((r) => r.map(esc).join(',')).join('\r\n');
  download(`clipboard-${stamp()}.csv`, 'text/csv;charset=utf-8', '﻿' + csv);
});

$('exportJson').addEventListener('click', () => {
  if (!rows.length) return toast('Nothing to export');
  const data = visibleRows().map((r) => ({ capturedAt: new Date(r.capturedAt).toISOString(), ...r.data }));
  download(`clipboard-${stamp()}.json`, 'application/json', JSON.stringify(data, null, 2));
});

$('copyTsv').addEventListener('click', async () => {
  if (!rows.length) return toast('Nothing to copy');
  const tsv = exportMatrix()
    .map((r) => r.map((v) => String(v).replace(/[\t\n\r]+/g, ' ')).join('\t'))
    .join('\n');
  // Remember it as "seen" so the watcher doesn't re-import our own copy.
  await chrome.storage.local.set({ lastText: tsv });
  await navigator.clipboard.writeText(tsv);
  toast('Copied — paste into Excel or Google Sheets');
});

$('clear').addEventListener('click', async () => {
  if (!rows.length) return;
  if (!confirm(`Delete all ${rows.length} rows? This cannot be undone.`)) return;
  rows = [];
  await Store.setRows([]);
  toast('Table cleared');
});

$('search').addEventListener('input', (e) => {
  filter = e.target.value;
  render();
});

// ---------- manual input ----------

function renderPreview() {
  const text = $('testInput').value;
  const out = text.trim() ? E.extract(text, settings) : [];
  $('testInfo').textContent = text.trim() ? `${out.length} row${out.length === 1 ? '' : 's'} would be extracted` : '';
  if (!out.length) return $('testPreview').replaceChildren();
  const cols = columnsOf(out.map((d) => ({ data: d, cols: Object.keys(d) })));
  $('testPreview').replaceChildren(
    el('table', {}, [
      el('thead', {}, [el('tr', {}, cols.map((c) => el('th', { textContent: c })))]),
      el('tbody', {}, out.map((d) => el('tr', {}, cols.map((c) => el('td', { textContent: d[c] ?? '' }))))),
    ])
  );
}
$('testInput').addEventListener('input', renderPreview);
$('testAdd').addEventListener('click', async () => {
  const text = $('testInput').value;
  if (!text.trim()) return;
  const before = rows.length;
  await chrome.runtime.sendMessage({ target: 'background', type: 'process-text', text });
  const after = (await Store.getRows()).length;
  toast(after > before ? `Added ${after - before} row(s)` : 'No new rows (nothing matched, or already in table)');
});

// ---------- settings ----------

function openSettings(open) {
  $('settings').hidden = !open;
  $('toggleSettings').setAttribute('aria-expanded', String(open));
  if (open) location.hash = 'settings';
  else history.replaceState(null, '', location.pathname);
}
$('toggleSettings').addEventListener('click', () => openSettings($('settings').hidden));
$('closeSettings').addEventListener('click', () => openSettings(false));
document.addEventListener('keydown', (e) => e.key === 'Escape' && !$('settings').hidden && !e.target.isContentEditable && openSettings(false));

let saveTimer = null;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    await Store.saveSettings(settings);
    $('savedMsg').textContent = 'Saved';
    setTimeout(() => ($('savedMsg').textContent = ''), 1200);
  }, 250);
  renderPreview();
}

function renderSettings() {
  const tbody = $('builtinFields').tBodies[0];
  const allFields = [...E.DISPLAY_ORDER.map((k) => E.BUILTIN_FIELDS.find((f) => f.key === k)), E.KV_FIELD];
  tbody.replaceChildren(
    ...allFields.map((f) => {
      const cfg = settings.fields[f.key];
      const box = (prop, disabled) => {
        const i = el('input', { type: 'checkbox', checked: !!cfg[prop], disabled: !!disabled });
        i.setAttribute('aria-label', `${f.label} ${prop}`);
        i.addEventListener('change', () => {
          cfg[prop] = i.checked;
          if (prop === 'enabled' && !i.checked) cfg.required = false;
          renderSettings();
          save();
        });
        return i;
      };
      return el('tr', {}, [
        el('td', { textContent: f.label }),
        el('td', {}, [box('enabled')]),
        el('td', {}, f.key === 'kv' ? [] : [box('required', !cfg.enabled)]),
      ]);
    })
  );

  $('customFields').replaceChildren(...settings.customFields.map(customEditor));

  for (const id of ['splitMode', 'matchMode', 'delimiter', 'pollInterval', 'minLength']) $(id).value = settings[id];
  for (const id of ['repeatSingles', 'detectTables', 'dedupeRows', 'keepSource']) $(id).checked = settings[id];
  $('delimiterWrap').hidden = settings.splitMode !== 'custom';
  $('enabled').checked = settings.enabled;
  $('enabledLabel').textContent = settings.enabled ? 'Watching' : 'Paused';
}

function customEditor(cf) {
  const input = (name, props) => {
    const i = el('input', { type: 'text', name, value: cf[name] ?? '', ...props });
    i.setAttribute('aria-label', props.placeholder);
    i.addEventListener('input', () => {
      cf[name] = name === 'group' ? Number(i.value) || 0 : i.value;
      err.textContent = cf.pattern ? E.compileCustom(cf).error || '' : '';
      save();
    });
    return i;
  };
  const check = (prop, label) => {
    const i = el('input', { type: 'checkbox', checked: prop === 'enabled' ? cf.enabled !== false : !!cf[prop] });
    i.addEventListener('change', () => {
      cf[prop] = i.checked;
      save();
    });
    return el('label', { className: 'check' }, [i, ' ' + label]);
  };
  const err = el('div', { className: 'err', textContent: cf.pattern ? E.compileCustom(cf).error || '' : '' });
  return el('div', { className: 'custom' }, [
    el('div', { className: 'line' }, [
      input('name', { placeholder: 'Column name' }),
      el('button', {
        className: 'icon',
        textContent: '✕',
        title: 'Remove field',
        onclick: () => {
          settings.customFields = settings.customFields.filter((x) => x !== cf);
          renderSettings();
          save();
        },
      }),
    ]),
    input('pattern', { placeholder: 'Regular expression, e.g. INV-\\d+' }),
    el('div', { className: 'line' }, [
      input('flags', { placeholder: 'flags', title: 'Regex flags, e.g. i' }),
      input('group', { placeholder: 'group', title: 'Capture group (0 = whole match)' }),
      check('enabled', 'On'),
      check('required', 'Required'),
    ]),
    err,
  ]);
}

$('addCustom').addEventListener('click', () => {
  settings.customFields.push({ id: Store.uid(), name: '', pattern: '', flags: 'i', group: 0, enabled: true, required: false });
  renderSettings();
  $('customFields').lastElementChild?.querySelector('input')?.focus();
});

for (const id of ['splitMode', 'matchMode', 'delimiter']) {
  $(id).addEventListener('input', () => {
    settings[id] = $(id).value;
    $('delimiterWrap').hidden = settings.splitMode !== 'custom';
    save();
  });
}
for (const id of ['pollInterval', 'minLength']) {
  $(id).addEventListener('change', () => {
    settings[id] = Number($(id).value);
    save();
  });
}
for (const id of ['repeatSingles', 'detectTables', 'dedupeRows', 'keepSource']) {
  $(id).addEventListener('change', () => {
    settings[id] = $(id).checked;
    save();
    render();
  });
}
$('enabled').addEventListener('change', () => {
  settings.enabled = $('enabled').checked;
  renderSettings();
  save();
});
$('resetSettings').addEventListener('click', () => {
  if (!confirm('Reset all settings (including custom fields) to defaults?')) return;
  settings = E.normalizeSettings({ enabled: settings.enabled });
  renderSettings();
  save();
});

// ---------- live updates ----------

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (changes.rows) {
    rows = changes.rows.newValue || [];
    if (!document.activeElement?.isContentEditable) render();
  }
  if (changes.settings && !$('settings').contains(document.activeElement)) {
    settings = E.normalizeSettings(changes.settings.newValue);
    renderSettings();
    render();
  }
});

(async function init() {
  [settings, rows] = await Promise.all([Store.getSettings(), Store.getRows()]);
  knownIds = new Set(rows.map((r) => r.id));
  renderSettings();
  render();
  if (location.hash === '#settings') openSettings(true);
})();
