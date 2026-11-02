/* Clipboard Extractor – web app UI and clipboard watcher. */
(function () {
  'use strict';

  const E = window.ClipExtractor;
  const Store = window.ClipStore;
  const $ = (id) => document.getElementById(id);
  const el = (tag, props = {}, children = []) => {
    const n = Object.assign(document.createElement(tag), props);
    n.append(...children);
    return n;
  };

  let rows = Store.getRows();
  let settings = Store.getSettings();
  let sort = { col: '__time', dir: 'desc' };
  let filter = '';
  let knownIds = new Set(rows.map((r) => r.id)); // to highlight new rows

  // ---------- helpers ----------

  function toast(msg) {
    const t = $('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => t.classList.remove('show'), 2400);
  }

  function safely(fn) {
    try {
      return fn();
    } catch (e) {
      toast(e.message || String(e));
    }
  }

  const fmtTime = (ts) =>
    new Date(ts).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' });

  /** Union of all columns, in order of first appearance. */
  function columnsOf(list) {
    const cols = [];
    const seen = new Set();
    for (const r of list) for (const k of Store.columnsOf(r)) if (!seen.has(k)) seen.add(k), cols.push(k);
    return cols;
  }

  // ---------- clipboard watcher ----------
  //
  // Browsers only let a page read the clipboard while it has focus, and
  // (in Chromium) after the user grants the "clipboard-read" permission.
  // We read it whenever the tab regains focus, and periodically while focused.
  // Browsers without that permission (Firefox, Safari) show a paste prompt
  // on every read, so there we rely on Ctrl/⌘+V instead.

  const Watcher = {
    mode: 'checking', // checking | auto | prompt | denied | paste
    lastText: Store.getLastText(),
    busy: false,
    timer: null,
  };

  async function detectMode() {
    if (!window.isSecureContext || !navigator.clipboard?.readText) return 'paste';
    try {
      const status = await navigator.permissions.query({ name: 'clipboard-read' });
      status.onchange = () => setMode(permissionToMode(status.state));
      return permissionToMode(status.state);
    } catch {
      return 'paste';
    }
  }
  const permissionToMode = (state) => (state === 'granted' ? 'auto' : state === 'denied' ? 'denied' : 'prompt');

  function setMode(mode) {
    Watcher.mode = mode;
    renderStatus();
    if (mode === 'auto') readClipboard();
  }

  function renderStatus() {
    const on = settings.enabled;
    const { mode } = Watcher;
    const st = $('status');
    let text;
    let kind;
    if (mode === 'paste') {
      text = 'Press Ctrl/⌘+V here to add';
      kind = 'warn';
    } else if (mode === 'denied') {
      text = 'Clipboard blocked in site settings: press Ctrl/⌘+V instead';
      kind = 'error';
    } else if (mode === 'prompt') {
      text = 'Needs permission';
      kind = 'warn';
    } else if (mode === 'checking') {
      text = 'Starting…';
      kind = 'warn';
    } else if (!on) {
      text = 'Paused';
      kind = 'off';
    } else {
      text = document.hasFocus() ? 'Watching clipboard' : 'Watching: switch back to this tab after copying';
      kind = 'ok';
    }
    st.dataset.kind = kind;
    $('statusText').textContent = text;
    $('allow').hidden = mode !== 'prompt';
    $('enabled').closest('.switch').hidden = mode === 'paste' || mode === 'denied';
    $('readNow').hidden = mode !== 'auto';
    $('enabled').checked = on;
  }

  /** Read the clipboard. `manual`: user-initiated, process even if unchanged. */
  async function readClipboard(manual = false) {
    if (!manual && (Watcher.mode !== 'auto' || !settings.enabled || !document.hasFocus())) return;
    if (Watcher.busy) return;
    Watcher.busy = true;
    try {
      const text = await navigator.clipboard.readText();
      handleText(text, { force: manual, origin: 'clipboard' });
      if (manual && Watcher.mode === 'prompt') setMode('auto');
    } catch (e) {
      if (e?.name === 'NotAllowedError') {
        // Lost focus mid-read is harmless; a real denial is picked up by the permission status.
        if (manual) {
          setMode(await detectMode());
          if (Watcher.mode !== 'auto') toast('Clipboard access was not allowed. Press Ctrl/⌘+V to paste instead.');
        }
      } else if (manual) {
        toast('Could not read the clipboard: ' + (e?.message || e));
      }
    } finally {
      Watcher.busy = false;
    }
  }

  /** Extract rows from text and add them to the table. */
  function handleText(text, { force = false, origin = 'clipboard' } = {}) {
    text = String(text || '');
    if (!text.trim()) {
      if (force) toast('The clipboard has no text');
      return [];
    }
    if (!force && text === Watcher.lastText) return [];
    Watcher.lastText = text;
    safely(() => Store.setLastText(text));

    const extracted = E.extract(text, settings);
    const added =
      safely(() => Store.addRows(extracted, { source: settings.keepSource ? text : '', dedupe: settings.dedupeRows })) || [];

    if (added.length) {
      toast(`Added ${added.length} row${added.length === 1 ? '' : 's'}`);
      flashTitle(added.length);
    } else if (force) {
      toast(extracted.length ? 'Already in the table' : 'Nothing to extract from that text');
    }
    return added;
  }

  function flashTitle(n) {
    document.title = `(+${n}) Clipboard Extractor`;
    clearTimeout(flashTitle.t);
    flashTitle.t = setTimeout(() => (document.title = 'Clipboard Extractor'), 4000);
  }

  function startPolling() {
    clearInterval(Watcher.timer);
    Watcher.timer = setInterval(readClipboard, settings.pollInterval);
  }

  window.addEventListener('focus', () => {
    renderStatus();
    readClipboard();
  });
  window.addEventListener('blur', renderStatus);
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && readClipboard());

  // Ctrl/⌘+V anywhere on the page (except in form fields) adds the pasted text.
  document.addEventListener('paste', (e) => {
    const t = e.target;
    if (t.closest?.('input, textarea, select, [contenteditable="true"], [contenteditable="plaintext-only"]')) return;
    const text = e.clipboardData?.getData('text/plain');
    if (!text) return;
    e.preventDefault();
    handleText(text, { force: true, origin: 'paste' });
  });

  $('allow').addEventListener('click', () => readClipboard(true));
  $('readNow').addEventListener('click', () => readClipboard(true));
  $('enabled').addEventListener('change', () => {
    settings.enabled = $('enabled').checked;
    safely(() => Store.saveSettings(settings));
    renderStatus();
    readClipboard();
  });

  // ---------- table ----------

  function visibleRows() {
    const q = filter.trim().toLowerCase();
    const list = q
      ? rows.filter(
          (r) =>
            Object.values(r.data).some((v) => String(v).toLowerCase().includes(q)) ||
            (r.source || '').toLowerCase().includes(q)
        )
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

  function render() {
    const list = visibleRows();
    const cols = columnsOf(rows);
    const thead = $('table').tHead;
    const tbody = $('table').tBodies[0];

    const th = (label, key) => {
      const h = el('th', { textContent: label });
      if (!key) h.className = 'nosort';
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
        th('#'),
        th('Captured', '__time'),
        ...cols.map((c) => th(c, c)),
        ...(settings.keepSource ? [th('Source text')] : []),
        th(''),
      ])
    );

    const frag = document.createDocumentFragment();
    let lastClip = null;
    let alt = false;
    list.forEach((r, i) => {
      if (r.clipId !== lastClip) (alt = !alt), (lastClip = r.clipId);
      const tr = el('tr', { className: (alt ? 'alt' : '') + (knownIds.has(r.id) ? '' : ' fresh') });
      tr.dataset.id = r.id;
      tr.append(el('td', { className: 'meta', textContent: i + 1 }), el('td', { className: 'meta', textContent: fmtTime(r.capturedAt) }));
      for (const c of cols) {
        const td = el('td', { className: 'cell', tabIndex: 0, title: 'Double-click to edit' });
        td.dataset.col = c;
        if (r.data[c] != null) td.append(linkify(String(r.data[c])));
        tr.append(td);
      }
      if (settings.keepSource) tr.append(el('td', { className: 'source', textContent: r.source || '', title: r.source || '' }));
      const del = el('button', { className: 'icon', textContent: '✕', title: 'Delete row', onclick: () => deleteRow(r.id) });
      del.setAttribute('aria-label', 'Delete row');
      tr.append(el('td', {}, [del]));
      frag.append(tr);
    });
    tbody.replaceChildren(frag);
    knownIds = new Set(rows.map((r) => r.id));

    $('empty').hidden = rows.length > 0;
    $('table').hidden = rows.length === 0;
    const clips = new Set(rows.map((r) => r.clipId)).size;
    $('summary').textContent = rows.length
      ? `${list.length === rows.length ? rows.length : list.length + ' of ' + rows.length} rows · ${cols.length} columns · from ${clips} capture${clips === 1 ? '' : 's'}`
      : '';
  }

  function deleteRow(id) {
    rows = rows.filter((r) => r.id !== id);
    safely(() => Store.setRows(rows));
  }

  // inline editing
  const table = $('table');
  table.addEventListener('dblclick', (e) => {
    const td = e.target.closest('td.cell');
    if (!td) return;
    e.preventDefault();
    td.textContent = td.textContent; // drop links while editing
    td.contentEditable = 'plaintext-only';
    td.focus();
    document.getSelection().selectAllChildren(td);
  });
  table.addEventListener('keydown', (e) => {
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
  table.addEventListener('focusout', (e) => {
    const td = e.target.closest?.('td.cell');
    if (!td || !td.isContentEditable) return;
    td.contentEditable = 'false';
    const row = rows.find((r) => r.id === td.parentElement.dataset.id);
    if (!row || td.dataset.cancel) return render();
    const value = td.textContent.trim();
    const col = td.dataset.col;
    if (value) {
      row.data[col] = value;
      if (Array.isArray(row.cols) && !row.cols.includes(col)) row.cols.push(col);
    } else delete row.data[col];
    safely(() => Store.setRows(rows));
  });

  // ---------- export ----------

  function exportMatrix() {
    const list = visibleRows();
    const cols = columnsOf(list);
    return [['Captured', ...cols], ...list.map((r) => [new Date(r.capturedAt).toISOString(), ...cols.map((c) => r.data[c] ?? '')])];
  }

  function download(name, type, content) {
    const url = URL.createObjectURL(new Blob([content], { type }));
    const a = el('a', { href: url, download: name });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  const stamp = () => new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');

  const DOWNLOADS = {
    csv() {
      if (!rows.length) return toast('Nothing to download yet');
      const esc = (v) => (/[",\n\r]/.test(v) ? '"' + String(v).replace(/"/g, '""') + '"' : String(v));
      const csv = exportMatrix()
        .map((r) => r.map(esc).join(','))
        .join('\r\n');
      download(`clipboard-${stamp()}.csv`, 'text/csv;charset=utf-8', '﻿' + csv);
    },

    json() {
      if (!rows.length) return toast('Nothing to download yet');
      const data = visibleRows().map((r) => {
        const o = { capturedAt: new Date(r.capturedAt).toISOString() };
        for (const c of Store.columnsOf(r)) o[c] = r.data[c];
        return o;
      });
      download(`clipboard-${stamp()}.json`, 'application/json', JSON.stringify(data, null, 2));
    },

    /** Everything needed to restore this workspace: all rows + settings. */
    project() {
      const project = {
        app: PROJECT_APP,
        version: 1,
        exportedAt: new Date().toISOString(),
        settings,
        rows,
      };
      download(`clipboard-project-${stamp()}.json`, 'application/json', JSON.stringify(project, null, 2));
      toast(`Project saved (${rows.length} row${rows.length === 1 ? '' : 's'})`);
    },

    /** The app's own files, zipped, so it can be run or hosted anywhere. */
    async app() {
      toast('Preparing download…');
      const files = [];
      const missing = [];
      for (const path of APP_FILES) {
        try {
          const res = await fetch(path, { cache: 'no-cache' });
          if (!res.ok) throw new Error(res.status);
          files.push({ name: 'clipboard-extractor/' + path, data: new Uint8Array(await res.arrayBuffer()) });
        } catch {
          missing.push(path);
        }
      }
      if (!files.some((f) => f.name.endsWith('/index.html'))) {
        return toast('Could not read the app files. Open the app from a web server (http/https) to download it.');
      }
      if (!files.some((f) => /README\.md$/.test(f.name))) {
        files.push({ name: 'clipboard-extractor/README.txt', data: APP_README });
      }
      const zip = window.ClipZip.create(files);
      download(`clipboard-extractor-app-${stamp()}.zip`, 'application/zip', zip);
      toast(`Downloaded ${files.length} files`);
    },
  };

  const PROJECT_APP = 'clipboard-extractor';
  const APP_FILES = [
    'index.html',
    'manifest.webmanifest',
    'css/app.css',
    'js/extractor.js',
    'js/store.js',
    'js/zip.js',
    'js/app.js',
    'icons/icon16.png',
    'icons/icon32.png',
    'icons/icon48.png',
    'icons/icon128.png',
    'icons/icon192.png',
    'icons/icon512.png',
    'README.md',
    'package.json',
    'test/extractor.test.js',
    'test/zip.test.js',
  ];
  const APP_README = [
    'Clipboard Extractor',
    '',
    'Run it:  python3 -m http.server 8080   then open http://localhost:8080',
    '(or open index.html directly; Ctrl/Cmd+V works everywhere, automatic',
    'clipboard reading needs http://localhost or https).',
    '',
  ].join('\n');

  const menu = $('downloadMenu');
  menu.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-download]');
    if (!btn) return;
    menu.open = false;
    Promise.resolve(DOWNLOADS[btn.dataset.download]()).catch((err) => toast('Download failed: ' + (err?.message || err)));
  });
  document.addEventListener('click', (e) => {
    if (menu.open && !menu.contains(e.target)) menu.open = false;
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && menu.open) menu.open = false;
  });

  // ---------- open project ----------

  /** Accepts a project file, or a "Table as JSON" download (array of objects). */
  function parseProject(obj) {
    const toRow = (data, capturedAt, clipId, extra = {}) => {
      const clean = {};
      const cols = [];
      for (const [k, v] of Object.entries(data || {})) {
        if (v == null || v === '' || typeof v === 'object') continue;
        clean[String(k)] = String(v);
        cols.push(String(k));
      }
      const ts = Number.isFinite(capturedAt) ? capturedAt : Date.parse(capturedAt);
      return {
        id: Store.uid(),
        clipId: clipId || Store.uid(),
        capturedAt: Number.isFinite(ts) ? ts : Date.now(),
        data: clean,
        cols: Array.isArray(extra.cols) ? extra.cols.filter((c) => c in clean) : cols,
        source: typeof extra.source === 'string' ? extra.source : '',
      };
    };

    if (obj && obj.app === PROJECT_APP && Array.isArray(obj.rows)) {
      return {
        settings: obj.settings ? E.normalizeSettings(obj.settings) : null,
        rows: obj.rows
          .filter((r) => r && typeof r.data === 'object')
          .map((r) => Object.assign(toRow(r.data, r.capturedAt, r.clipId, r), { id: typeof r.id === 'string' ? r.id : Store.uid() })),
      };
    }
    if (Array.isArray(obj) && obj.every((x) => x && typeof x === 'object' && !Array.isArray(x))) {
      const clipId = Store.uid();
      return {
        settings: null,
        rows: obj.map(({ capturedAt, ...data }) => toRow(data, capturedAt, clipId)),
      };
    }
    throw new Error('This is not a Clipboard Extractor project file.');
  }

  $('openProject').addEventListener('click', () => $('projectFile').click());
  $('projectFile').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    let project;
    try {
      project = parseProject(JSON.parse(await file.text()));
    } catch (err) {
      return toast(err instanceof SyntaxError ? 'That file is not valid JSON.' : err.message);
    }
    if (!project.rows.length && !project.settings) return toast('The file has no rows');

    let replace = true;
    if (rows.length) {
      replace = confirm(
        `Open "${file.name}" (${project.rows.length} rows)?\n\n` +
          `OK: replace the current table (${rows.length} rows)\nCancel: add its rows to the current table`
      );
    }
    let next;
    if (replace) next = project.rows;
    else {
      const ids = new Set(rows.map((r) => r.id));
      const keys = settings.dedupeRows ? new Set(rows.map((r) => E.rowKey(r.data))) : null;
      next = rows.concat(
        project.rows.filter((r) => !ids.has(r.id) && !(keys && keys.has(E.rowKey(r.data))))
      );
    }
    const added = next.length - (replace ? 0 : rows.length);
    if (project.settings && replace) {
      settings = project.settings;
      safely(() => Store.saveSettings(settings));
      renderSettings();
      renderStatus();
      startPolling();
    }
    rows = next;
    knownIds = new Set(); // highlight what was loaded
    safely(() => Store.setRows(rows));
    render();
    toast(replace ? `Opened project: ${rows.length} rows` : `Added ${added} row${added === 1 ? '' : 's'} from the project`);
  });

  $('copyTsv').addEventListener('click', async () => {
    if (!rows.length) return toast('Nothing to copy');
    const tsv = exportMatrix()
      .map((r) => r.map((v) => String(v).replace(/[\t\n\r]+/g, ' ')).join('\t'))
      .join('\n');
    // Mark it as seen so the watcher doesn't import our own copy.
    Watcher.lastText = tsv;
    safely(() => Store.setLastText(tsv));
    try {
      await navigator.clipboard.writeText(tsv);
      toast('Copied: paste into Excel or Google Sheets');
    } catch {
      toast('Copy failed: your browser blocked clipboard writing');
    }
  });

  $('clear').addEventListener('click', () => {
    if (!rows.length) return;
    if (!confirm(`Delete all ${rows.length} rows? This cannot be undone.`)) return;
    rows = [];
    safely(() => Store.setRows([]));
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
  $('testAdd').addEventListener('click', () => {
    if (!$('testInput').value.trim()) return;
    handleText($('testInput').value, { force: true, origin: 'manual' });
  });

  // ---------- settings ----------

  function openSettings(open) {
    $('settings').hidden = !open;
    $('toggleSettings').setAttribute('aria-expanded', String(open));
    if (open) history.replaceState(null, '', '#settings');
    else history.replaceState(null, '', location.pathname + location.search);
  }
  $('toggleSettings').addEventListener('click', () => openSettings($('settings').hidden));
  $('closeSettings').addEventListener('click', () => openSettings(false));
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !$('settings').hidden && !e.target.isContentEditable) openSettings(false);
  });

  let saveTimer = null;
  function save() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      safely(() => Store.saveSettings(settings));
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
  }

  function customEditor(cf) {
    const err = el('div', { className: 'err', textContent: cf.pattern ? E.compileCustom(cf).error || '' : '' });
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
      settings = E.normalizeSettings(settings);
      $(id).value = settings[id];
      if (id === 'pollInterval') startPolling();
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
  $('resetSettings').addEventListener('click', () => {
    if (!confirm('Reset all settings (including custom fields) to defaults?')) return;
    settings = E.normalizeSettings({ enabled: settings.enabled });
    renderSettings();
    startPolling();
    save();
  });

  // ---------- live updates (this tab and other tabs) ----------

  Store.onChange((key) => {
    if (key === 'rows') {
      rows = Store.getRows();
      if (!document.activeElement?.isContentEditable) render();
    } else if (key === 'settings' && !$('settings').contains(document.activeElement)) {
      settings = Store.getSettings();
      renderSettings();
      renderStatus();
      render();
    } else if (key === 'lastText') {
      Watcher.lastText = Store.getLastText();
    }
  });

  // ---------- start ----------

  renderSettings();
  render();
  renderStatus();
  if (location.hash === '#settings') openSettings(true);
  detectMode().then((mode) => {
    setMode(mode);
    startPolling();
  });
})();
