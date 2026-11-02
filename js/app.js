/* Clipboard Extractor – main page: clipboard watcher, table, projects, downloads. */
(function () {
  'use strict';

  const E = window.ClipExtractor;
  const Store = window.ClipStore;
  const { $, el, toast, download, stamp, safeFileName, saveTextFile, pickTextFile } = window.UI;

  const PROJECT_APP = 'clipboard-extractor';

  let rows = Store.getRows();
  let settings = Store.getSettings();
  let project = Store.getProject();
  let fileHandle = null; // where "Save" writes (Chrome/Edge); cleared on New project
  let sort = { col: '__time', dir: 'desc' };
  let filter = '';
  let knownIds = new Set(rows.map((r) => r.id)); // to highlight new rows

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

  function explainInAdmin(text) {
    safely(() => Store.setDraft(text));
    location.href = 'admin.html#test';
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
    interval: 0,
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
    let text;
    let kind;
    if (mode === 'paste') [text, kind] = ['Press Ctrl/⌘+V here to add', 'warn'];
    else if (mode === 'denied') [text, kind] = ['Clipboard blocked in site settings: press Ctrl/⌘+V instead', 'error'];
    else if (mode === 'prompt') [text, kind] = ['Needs permission', 'warn'];
    else if (mode === 'checking') [text, kind] = ['Starting…', 'warn'];
    else if (!on) [text, kind] = ['Paused', 'off'];
    else [text, kind] = [document.hasFocus() ? 'Watching clipboard' : 'Watching: switch back to this tab after copying', 'ok'];
    $('status').dataset.kind = kind;
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
      handleText(text, { force: manual });
      if (manual && Watcher.mode === 'prompt') setMode('auto');
    } catch (e) {
      if (e?.name === 'NotAllowedError') {
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
  function handleText(text, { force = false } = {}) {
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
      toast(extracted.length ? 'Already in the table' : 'Nothing to extract from that text. See the Admin panel to add a rule.');
    }
    return added;
  }

  function flashTitle(n) {
    document.title = `(+${n}) Clipboard Extractor`;
    clearTimeout(flashTitle.t);
    flashTitle.t = setTimeout(() => (document.title = 'Clipboard Extractor'), 4000);
  }

  function startPolling() {
    if (Watcher.interval === settings.pollInterval && Watcher.timer) return;
    clearInterval(Watcher.timer);
    Watcher.interval = settings.pollInterval;
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
    if (e.target.closest?.('input, textarea, select, [contenteditable="true"], [contenteditable="plaintext-only"]')) return;
    const text = e.clipboardData?.getData('text/plain');
    if (!text) return;
    e.preventDefault();
    handleText(text, { force: true });
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
    const table = $('table');

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
    table.tHead.replaceChildren(
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
      const actions = el('td', { className: 'actions' });
      if (r.source) {
        const why = el('button', { className: 'icon info', textContent: '?', title: 'Explain how this row was extracted', onclick: () => explainInAdmin(r.source) });
        why.setAttribute('aria-label', 'Explain extraction');
        actions.append(why);
      }
      const del = el('button', { className: 'icon', textContent: '✕', title: 'Delete row', onclick: () => deleteRow(r.id) });
      del.setAttribute('aria-label', 'Delete row');
      actions.append(del);
      tr.append(actions);
      frag.append(tr);
    });
    table.tBodies[0].replaceChildren(frag);
    knownIds = new Set(rows.map((r) => r.id));

    $('empty').hidden = rows.length > 0;
    table.hidden = rows.length === 0;
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

  $('search').addEventListener('input', (e) => {
    filter = e.target.value;
    render();
  });

  $('clear').addEventListener('click', () => {
    if (!rows.length) return;
    if (!confirm(`Delete all ${rows.length} rows in "${project.name}"? This cannot be undone.`)) return;
    rows = [];
    safely(() => Store.setRows([]));
    toast('Table cleared');
  });

  // ---------- projects ----------

  function renderProject() {
    if (document.activeElement !== $('projectName')) $('projectName').value = project.name;
    $('projectName').style.width = Math.min(Math.max(project.name.length, 8), 32) + 2 + 'ch';
    const st = $('saveState');
    if (project.dirty) {
      st.textContent = '● Unsaved';
      st.className = 'save-state dirty';
      st.title = 'This project has changes that are not saved to a file yet. Click Save (Ctrl/⌘+S).';
    } else if (project.savedAt) {
      st.textContent = 'Saved';
      st.className = 'save-state saved';
      st.title = `Saved ${new Date(project.savedAt).toLocaleString()}${project.fileName ? ' to ' + project.fileName : ''}`;
    } else {
      st.textContent = '';
      st.className = 'save-state';
    }
  }

  function updateProject(changes) {
    project = Object.assign({}, project, changes);
    safely(() => Store.setProject(project));
    renderProject();
  }

  $('projectName').addEventListener('change', (e) => {
    const name = e.target.value.trim() || 'Untitled project';
    if (name !== project.name) updateProject({ name, dirty: true });
    e.target.value = name;
  });
  $('projectName').addEventListener('keydown', (e) => e.key === 'Enter' && e.target.blur());

  /** The whole project as one self-contained file: rows + the rules used. */
  function projectFile() {
    return {
      app: PROJECT_APP,
      type: 'project',
      version: 2,
      name: project.name,
      createdAt: new Date(project.createdAt).toISOString(),
      savedAt: new Date().toISOString(),
      rules: E.rulesOf(settings),
      rows,
    };
  }

  /** Save to a file. Returns true when saved, false when cancelled. */
  async function saveProject({ saveAs = false } = {}) {
    let result;
    try {
      result = await saveTextFile({
        suggestedName: safeFileName(project.name) + '.json',
        text: JSON.stringify(projectFile(), null, 2),
        handle: saveAs ? null : fileHandle,
      });
    } catch (e) {
      toast('Could not save: ' + (e?.message || e));
      return false;
    }
    if (!result) return false;
    fileHandle = result.handle;
    updateProject({ savedAt: Date.now(), fileName: result.fileName, dirty: false });
    toast(result.handle ? `Saved to ${result.fileName}` : `Saved: downloaded ${result.fileName}`);
    return true;
  }

  $('saveProject').addEventListener('click', () => saveProject());
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
      e.preventDefault();
      saveProject({ saveAs: e.shiftKey });
    }
  });

  function startNewProject(name) {
    rows = [];
    fileHandle = null;
    safely(() => Store.setRows([], { dirty: false }));
    project = { name, createdAt: Date.now(), savedAt: null, fileName: null, dirty: false };
    safely(() => Store.setProject(project));
    filter = '';
    $('search').value = '';
    renderProject();
    render();
    toast(`Started "${name}". Copy text to fill it.`);
  }

  const defaultProjectName = () =>
    'Project ' + new Date().toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });

  $('newProject').addEventListener('click', () => {
    const hasRows = rows.length > 0;
    $('newName').value = defaultProjectName();
    $('saveFirstWrap').hidden = !hasRows;
    $('saveFirst').checked = hasRows && project.dirty;
    $('saveFirstLabel').textContent = project.dirty
      ? `Save "${project.name}" first (it has unsaved changes)`
      : `Save "${project.name}" again first`;
    $('newDialog').showModal();
    $('newName').select();
  });

  $('newDialog').addEventListener('close', async () => {
    if ($('newDialog').returnValue !== 'ok') return;
    const name = $('newName').value.trim() || defaultProjectName();
    if (!$('saveFirstWrap').hidden && $('saveFirst').checked) {
      if (!(await saveProject())) return toast('Not saved, so no new project was started.');
    } else if (rows.length && project.dirty && !confirm(`Discard the unsaved rows of "${project.name}"?`)) {
      return;
    }
    startNewProject(name);
  });

  /** Read a project file (v1 or v2) or a "Table as JSON" download. */
  function parseProject(obj, fileName) {
    const toRow = (src, clipId) => {
      const data = src.data && typeof src.data === 'object' ? src.data : src;
      const clean = {};
      const order = [];
      for (const [k, v] of Object.entries(data)) {
        if (k === 'capturedAt' && data === src) continue;
        if (v == null || v === '' || typeof v === 'object') continue;
        clean[String(k)] = String(v);
        order.push(String(k));
      }
      const ts = typeof src.capturedAt === 'number' ? src.capturedAt : Date.parse(src.capturedAt);
      return {
        id: typeof src.id === 'string' && src.data ? src.id : Store.uid(),
        clipId: (src.data && src.clipId) || clipId,
        capturedAt: Number.isFinite(ts) ? ts : Date.now(),
        data: clean,
        cols: Array.isArray(src.cols) ? src.cols.filter((c) => c in clean) : order,
        source: typeof src.source === 'string' ? src.source : '',
      };
    };
    const baseName = String(fileName || '').replace(/\.json$/i, '') || 'Untitled project';

    if (obj && obj.app === PROJECT_APP && Array.isArray(obj.rows)) {
      const clip = Store.uid();
      const created = Date.parse(obj.createdAt);
      return {
        name: typeof obj.name === 'string' && obj.name.trim() ? obj.name.trim() : baseName,
        createdAt: Number.isFinite(created) ? created : Date.now(),
        rules: obj.rules || obj.settings || null,
        rows: obj.rows.filter((r) => r && typeof r === 'object').map((r) => toRow(r, clip)),
      };
    }
    if (Array.isArray(obj) && obj.every((x) => x && typeof x === 'object' && !Array.isArray(x))) {
      const clip = Store.uid();
      return { name: baseName, createdAt: Date.now(), rules: null, rows: obj.map((r) => toRow(r, clip)) };
    }
    throw new Error('This is not a Clipboard Extractor project file.');
  }

  $('openProject').addEventListener('click', async () => {
    if (rows.length && project.dirty && !confirm(`"${project.name}" has unsaved changes that will be lost. Open another project anyway?`)) return;
    const picked = await pickTextFile($('projectFile'));
    if (!picked) return;
    let p;
    try {
      p = parseProject(JSON.parse(picked.text), picked.name);
    } catch (err) {
      return toast(err instanceof SyntaxError ? 'That file is not valid JSON.' : err.message);
    }

    if (p.rules && !E.sameRules(settings, p.rules)) {
      const useTheirs = confirm(
        `"${p.name}" was saved with different extraction rules.\n\n` +
          `OK: use the project's rules (replaces the rules in the Admin panel)\nCancel: keep the current rules`
      );
      if (useTheirs) {
        settings = E.normalizeSettings(Object.assign({}, settings, E.rulesOf(p.rules)));
        safely(() => Store.saveSettings(settings));
      }
    }
    rows = p.rows;
    fileHandle = picked.handle;
    knownIds = new Set();
    safely(() => Store.setRows(rows, { dirty: false }));
    project = { name: p.name, createdAt: p.createdAt, savedAt: Date.now(), fileName: picked.name, dirty: false };
    safely(() => Store.setProject(project));
    renderProject();
    render();
    toast(`Opened "${p.name}" (${rows.length} row${rows.length === 1 ? '' : 's'})`);
  });

  // ---------- downloads ----------

  function exportMatrix() {
    const list = visibleRows();
    const cols = columnsOf(list);
    return [['Captured', ...cols], ...list.map((r) => [new Date(r.capturedAt).toISOString(), ...cols.map((c) => r.data[c] ?? '')])];
  }

  const APP_FILES = [
    'index.html',
    'admin.html',
    'manifest.webmanifest',
    'css/app.css',
    'js/extractor.js',
    'js/store.js',
    'js/ui.js',
    'js/zip.js',
    'js/app.js',
    'js/admin.js',
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

  const DOWNLOADS = {
    csv() {
      if (!rows.length) return toast('Nothing to download yet');
      const esc = (v) => (/[",\n\r]/.test(v) ? '"' + String(v).replace(/"/g, '""') + '"' : String(v));
      const csv = exportMatrix()
        .map((r) => r.map(esc).join(','))
        .join('\r\n');
      download(`${safeFileName(project.name)}.csv`, 'text/csv;charset=utf-8', '﻿' + csv);
    },

    json() {
      if (!rows.length) return toast('Nothing to download yet');
      const data = visibleRows().map((r) => {
        const o = { capturedAt: new Date(r.capturedAt).toISOString() };
        for (const c of Store.columnsOf(r)) o[c] = r.data[c];
        return o;
      });
      download(`${safeFileName(project.name)}-table.json`, 'application/json', JSON.stringify(data, null, 2));
    },

    saveAs() {
      return saveProject({ saveAs: true });
    },

    /** The app's own files, zipped, so it can be run or hosted anywhere. */
    async app() {
      toast('Preparing download…');
      const files = [];
      for (const path of APP_FILES) {
        try {
          const res = await fetch(path, { cache: 'no-cache' });
          if (!res.ok) continue;
          files.push({ name: 'clipboard-extractor/' + path, data: new Uint8Array(await res.arrayBuffer()) });
        } catch {
          /* skip files that can't be read */
        }
      }
      if (!files.some((f) => f.name.endsWith('/index.html'))) {
        return toast('Could not read the app files. Open the app from a web server (http/https) to download it.');
      }
      if (!files.some((f) => /README\.md$/.test(f.name))) {
        files.push({ name: 'clipboard-extractor/README.txt', data: APP_README });
      }
      download(`clipboard-extractor-app-${stamp()}.zip`, 'application/zip', window.ClipZip.create(files));
      toast(`Downloaded ${files.length} files`);
    },
  };

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
    if ($('testInput').value.trim()) handleText($('testInput').value, { force: true });
  });
  $('testExplain').addEventListener('click', () => explainInAdmin($('testInput').value));

  // ---------- live updates (this tab, other tabs, the admin panel) ----------

  Store.onChange((key) => {
    if (key === 'rows') {
      rows = Store.getRows();
      if (!document.activeElement?.isContentEditable) render();
    } else if (key === 'settings') {
      settings = Store.getSettings();
      renderStatus();
      startPolling();
      renderPreview();
      render();
    } else if (key === 'project') {
      project = Store.getProject();
      renderProject();
    } else if (key === 'lastText') {
      Watcher.lastText = Store.getLastText();
    }
  });

  // ---------- start ----------

  safely(() => Store.setProject(project)); // remember the project (and its creation time) on first run
  renderProject();
  render();
  renderStatus();
  detectMode().then((mode) => {
    setMode(mode);
    startPolling();
  });
})();
