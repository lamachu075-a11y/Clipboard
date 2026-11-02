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

  /** Phones and tablets have no Ctrl+V: point them to the Paste button instead. */
  const isTouch = () => window.matchMedia('(pointer: coarse)').matches;
  const pasteHint = () => (isTouch() ? 'tap Paste' : 'press Ctrl/⌘+V');

  function renderStatus() {
    const on = settings.enabled;
    const { mode } = Watcher;
    let text;
    let kind;
    if (!on) [text, kind] = [`Off: copies are not read automatically (${isTouch() ? 'Paste' : 'Ctrl/⌘+V'} still works)`, 'off'];
    else if (mode === 'auto') [text, kind] = [document.hasFocus() ? 'Watching clipboard' : 'Watching: switch back to this tab after copying', 'ok'];
    else if (mode === 'prompt') [text, kind] = ['Allow clipboard access to start', 'warn'];
    else if (mode === 'denied') [text, kind] = [`Clipboard blocked in site settings: ${pasteHint()} instead`, 'error'];
    else if (mode === 'paste') [text, kind] = [`This browser doesn't allow automatic reading: ${pasteHint()} to add`, 'warn'];
    else [text, kind] = ['Starting…', 'warn'];
    $('status').dataset.kind = kind;
    $('statusText').textContent = text;
    $('allow').hidden = !(on && mode === 'prompt');
    $('readNow').hidden = mode !== 'auto';
    document.querySelectorAll('.needs-auto').forEach((b) => (b.hidden = mode !== 'auto'));
    $('enabled').checked = on;
    $('enabledState').textContent = on ? 'ON' : 'OFF';
    $('enabledState').closest('.autoread').classList.toggle('on', on);
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
          if (Watcher.mode !== 'auto') toast(`Clipboard access was not allowed. ${isTouch() ? 'Tap Paste' : 'Press Ctrl/⌘+V'} to add text instead.`);
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
    // The current project was saved: new data goes into a new project.
    const savedName = extracted.length ? ensureOpenProject() : null;
    const added =
      safely(() => Store.addRows(extracted, { source: settings.keepSource ? text : '', dedupe: settings.dedupeRows })) || [];

    if (added.length) {
      const n = `${added.length} row${added.length === 1 ? '' : 's'}`;
      toast(savedName ? `"${savedName}" stays saved. Added ${n} to new project "${project.name}".` : `Added ${n}`);
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
    if (!settings.enabled) return toast('Auto-read is OFF. Copies are not read until you turn it back on.');
    if (Watcher.mode === 'prompt') return readClipboard(true); // this click lets the browser ask for permission
    if (Watcher.mode === 'paste' || Watcher.mode === 'denied') {
      return toast(`This browser doesn't let web pages read the clipboard automatically. ${isTouch() ? 'Tap Paste' : 'Press Ctrl/⌘+V on this page'} instead.`);
    }
    toast('Auto-read is ON. Copy text anywhere, then come back to this tab.');
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
        ...(settings.keepSource ? [Object.assign(th('Source text'), { className: 'nosort source-col' })] : []),
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
      tr.append(el('td', { className: 'meta num', textContent: i + 1 }), el('td', { className: 'meta time', textContent: fmtTime(r.capturedAt) }));
      for (const c of cols) {
        const td = el('td', { className: 'cell', tabIndex: 0, title: 'Double-click to edit' });
        td.dataset.label = c;
        td.dataset.col = c;
        if (r.data[c] != null) td.append(linkify(String(r.data[c])));
        tr.append(td);
      }
      if (settings.keepSource) {
        const src = el('td', { className: 'source', textContent: r.source || '', title: r.source || '' });
        src.dataset.label = 'Source';
        tr.append(src);
      }
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
  //
  // The current project lives in localStorage (rows + project info). "Save
  // project" copies it into the Projects list (IndexedDB) and marks it as
  // saved. After that, the next extraction starts a new project, so a saved
  // project is never changed by new clipboard data unless you choose
  // "Keep adding to this project".

  const Library = Store.Library;

  function renderProject() {
    if (document.activeElement !== $('projectName')) $('projectName').value = project.name;
    $('projectName').style.width = Math.min(Math.max(project.name.length, 8), 32) + 2 + 'ch';
    const st = $('saveState');
    if (project.dirty) {
      st.textContent = '● Unsaved';
      st.className = 'save-state dirty';
      st.title = 'This project has changes that are not saved yet. Click "Save project" (Ctrl/⌘+S).';
    } else if (project.savedAt) {
      st.textContent = '✓ Saved';
      st.className = 'save-state saved';
      st.title = `Saved to Projects ${new Date(project.savedAt).toLocaleString()}`;
    } else {
      st.textContent = '';
      st.className = 'save-state';
      st.title = '';
    }
    $('savedBanner').hidden = !(project.closed && !project.dirty);
    $('savedName').textContent = `"${project.name}"`;
    $('printTitle').textContent = project.name;
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

  $('keepAdding').addEventListener('click', () => {
    updateProject({ closed: false });
    toast(`New copies will be added to "${project.name}"`);
  });

  /** Everything about the current project, as stored in Projects and in files. */
  function projectDoc() {
    return {
      id: project.id,
      name: project.name,
      createdAt: project.createdAt,
      savedAt: Date.now(),
      rowCount: rows.length,
      rules: E.rulesOf(settings),
      rows,
    };
  }

  /** Project file contents (also what "Open from file" reads). */
  function fileOf(doc) {
    return {
      app: PROJECT_APP,
      type: 'project',
      version: 2,
      name: doc.name,
      createdAt: new Date(doc.createdAt).toISOString(),
      savedAt: new Date(doc.savedAt || Date.now()).toISOString(),
      rules: doc.rules,
      rows: doc.rows,
    };
  }

  /**
   * Save the current project into Projects.
   * @param {{close?: boolean, quiet?: boolean}} opts close: new copies go to a new project afterwards
   */
  async function saveProject({ close = true, quiet = false } = {}) {
    if (!rows.length && !project.savedAt) {
      if (!quiet) toast('Nothing to save yet: copy some text first.');
      return false;
    }
    const doc = projectDoc();
    try {
      await Library.put(doc);
    } catch (e) {
      toast('Could not save: ' + (e?.message || e));
      return false;
    }
    updateProject({ savedAt: doc.savedAt, dirty: false, closed: close });
    if (!quiet) toast(`Saved "${project.name}" (${rows.length} row${rows.length === 1 ? '' : 's'}). The next copy starts a new project.`);
    return true;
  }

  $('saveProject').addEventListener('click', () => saveProject());
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
      e.preventDefault();
      if (e.shiftKey) downloadProjectFile(projectDoc());
      else saveProject();
    }
  });

  /** Before switching projects, keep unsaved work in Projects. */
  async function keepCurrentSafe() {
    if (rows.length && project.dirty) return saveProject({ close: true, quiet: true });
    return true;
  }

  /** Names like "Project Nov 2, 2026", "Project Nov 2, 2026 (2)", … */
  async function uniqueName(base, { includeCurrent = true } = {}) {
    const current = includeCurrent ? [project.name] : [];
    let names = new Set(current);
    try {
      names = new Set([...current, ...(await Library.list()).map((p) => p.name)]);
    } catch {
      /* no library: fine */
    }
    if (!names.has(base)) return base;
    for (let i = 2; ; i++) if (!names.has(`${base} (${i})`)) return `${base} (${i})`;
  }
  const defaultProjectName = () =>
    'Project ' + new Date().toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });

  function startNewProject(name) {
    rows = [];
    safely(() => Store.setRows([], { dirty: false }));
    project = { id: Store.uid(), name, createdAt: Date.now(), savedAt: null, dirty: false, closed: false };
    safely(() => Store.setProject(project));
    filter = '';
    $('search').value = '';
    renderProject();
    render();
  }

  // New clipboard data after a save goes into a new project.
  let pendingName = null;
  function ensureOpenProject() {
    if (!project.closed) return null;
    const previous = project.name;
    startNewProject(pendingName || defaultProjectName());
    // Make the name unique in the background.
    const started = project.id;
    uniqueName(project.name, { includeCurrent: false }).then((n) => project.id === started && n !== project.name && updateProject({ name: n }));
    return previous;
  }
  uniqueName(defaultProjectName()).then((n) => (pendingName = n));
  Store.onChange((key) => key === 'library' && uniqueName(defaultProjectName()).then((n) => (pendingName = n)));

  $('newProject').addEventListener('click', async () => {
    $('newName').value = await uniqueName(defaultProjectName());
    $('newNote').textContent =
      rows.length && project.dirty ? `"${project.name}" has unsaved changes. It will be saved to Projects first.` : '';
    $('newDialog').showModal();
    $('newName').select();
  });

  $('newDialog').addEventListener('close', async () => {
    if ($('newDialog').returnValue !== 'ok') return;
    const name = $('newName').value.trim() || defaultProjectName();
    if (!(await keepCurrentSafe())) return;
    const previous = project.name;
    const hadRows = rows.length > 0;
    startNewProject(name);
    toast(hadRows ? `"${previous}" is saved. Started "${name}".` : `Started "${name}"`);
  });

  /** Make a stored project the current one. */
  async function openDoc(doc) {
    if (doc.id === project.id && !project.dirty) {
      $('projectsDialog').close();
      return;
    }
    if (doc.id !== project.id && !(await keepCurrentSafe())) return;
    if (doc.rules && !E.sameRules(settings, doc.rules)) {
      const useTheirs = confirm(
        `"${doc.name}" was saved with different extraction rules.\n\n` +
          `OK: use the project's rules (replaces the rules in the Admin panel)\nCancel: keep the current rules`
      );
      if (useTheirs) {
        settings = E.normalizeSettings(Object.assign({}, settings, E.rulesOf(doc.rules)));
        safely(() => Store.saveSettings(settings));
      }
    }
    rows = doc.rows || [];
    knownIds = new Set();
    safely(() => Store.setRows(rows, { dirty: false }));
    project = { id: doc.id, name: doc.name, createdAt: doc.createdAt, savedAt: doc.savedAt, dirty: false, closed: true };
    safely(() => Store.setProject(project));
    filter = '';
    $('search').value = '';
    renderProject();
    render();
    $('projectsDialog').close();
    toast(`Opened "${doc.name}" (${rows.length} row${rows.length === 1 ? '' : 's'})`);
  }

  // ----- Projects dialog -----

  async function renderProjectList() {
    let list;
    try {
      list = await Library.list();
    } catch (e) {
      $('projectList').replaceChildren(el('p', { className: 'err', textContent: e.message || String(e) }));
      return;
    }
    $('projectCount').textContent = list.length || '';
    if (!list.length) {
      $('projectList').replaceChildren(
        el('p', { className: 'muted', textContent: 'No saved projects yet. Click "Save project" to keep the current table here.' })
      );
      return;
    }
    const withDoc = (id, fn) => async () => {
      const doc = await Library.get(id);
      if (!doc) return toast('That project no longer exists.');
      return fn(doc);
    };
    $('projectList').replaceChildren(
      ...list.map((p) => {
        const current = p.id === project.id;
        const meta = `${p.rowCount} row${p.rowCount === 1 ? '' : 's'} · saved ${new Date(p.savedAt).toLocaleString(undefined, {
          dateStyle: 'medium',
          timeStyle: 'short',
        })}`;
        return el('div', { className: 'project-item' + (current ? ' current' : '') }, [
          el('div', { className: 'project-info' }, [
            el('b', { textContent: p.name }),
            current ? el('span', { className: 'tag', textContent: project.dirty ? 'open · unsaved changes' : 'open' }) : '',
            el('div', { className: 'muted small', textContent: meta }),
          ]),
          el('div', { className: 'project-actions' }, [
            el('button', { className: current ? '' : 'primary', textContent: current ? 'Open' : 'Open', disabled: current && !project.dirty, onclick: withDoc(p.id, openDoc) }),
            el('button', { textContent: 'PDF', title: 'Download as PDF', onclick: withDoc(p.id, (d) => downloadPdf(d.name, sortedRows(d.rows))) }),
            el('button', { textContent: 'CSV', title: 'Download as CSV (Excel)', onclick: withDoc(p.id, (d) => downloadCsv(d.name, sortedRows(d.rows))) }),
            el('button', { textContent: 'File', title: 'Download the project file (.json)', onclick: withDoc(p.id, downloadProjectFile) }),
            el('button', {
              className: 'icon danger',
              textContent: '✕',
              title: 'Delete project',
              onclick: async () => {
                if (!confirm(`Delete "${p.name}" (${p.rowCount} rows) from Projects? This cannot be undone.`)) return;
                await Library.remove(p.id);
                if (current) updateProject({ savedAt: null, dirty: rows.length > 0, closed: false });
                toast(`Deleted "${p.name}"`);
              },
            }),
          ]),
        ]);
      })
    );
  }

  $('openProjects').addEventListener('click', () => {
    renderProjectList();
    $('projectsDialog').showModal();
  });
  $('closeProjects').addEventListener('click', () => $('projectsDialog').close());
  $('projectsDialog').addEventListener('click', (e) => e.target === $('projectsDialog') && $('projectsDialog').close());
  Store.onChange((key) => key === 'library' && renderProjectList());

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

  $('openFromFile').addEventListener('click', async () => {
    const picked = await pickTextFile($('projectFile'));
    if (!picked) return;
    let p;
    try {
      p = parseProject(JSON.parse(picked.text), picked.name);
    } catch (err) {
      return toast(err instanceof SyntaxError ? 'That file is not valid JSON.' : err.message);
    }
    const doc = { id: Store.uid(), name: await uniqueName(p.name), createdAt: p.createdAt, savedAt: Date.now(), rowCount: p.rows.length, rules: p.rules, rows: p.rows };
    try {
      await Library.put(doc);
    } catch (e) {
      return toast('Could not add the project: ' + (e?.message || e));
    }
    await openDoc(doc);
  });

  // ---------- downloads ----------

  /** Rows in capture order (oldest capture first, clipboard order within a capture). */
  const sortedRows = (list) =>
    list
      .map((r, i) => [r, i])
      .sort((a, b) => a[0].capturedAt - b[0].capturedAt || a[1] - b[1])
      .map(([r]) => r);

  function matrixOf(list) {
    const cols = columnsOf(list);
    return [['Captured', ...cols], ...list.map((r) => [new Date(r.capturedAt).toISOString(), ...cols.map((c) => r.data[c] ?? '')])];
  }

  function downloadCsv(name, list) {
    if (!list.length) return toast('Nothing to download yet');
    const esc = (v) => (/[",\n\r]/.test(v) ? '"' + String(v).replace(/"/g, '""') + '"' : String(v));
    const csv = matrixOf(list)
      .map((r) => r.map(esc).join(','))
      .join('\r\n');
    download(`${safeFileName(name)}.csv`, 'text/csv;charset=utf-8', '﻿' + csv);
  }

  function downloadPdf(name, list) {
    if (!list.length) return toast('Nothing to download yet');
    const cols = columnsOf(list);
    const tableRows = list.map((r, i) => [String(i + 1), fmtTime(r.capturedAt), ...cols.map((c) => r.data[c] ?? '')]);
    const pdf = window.ClipPdf.table({
      title: name,
      subtitle: `${list.length} row${list.length === 1 ? '' : 's'} · ${cols.length} column${cols.length === 1 ? '' : 's'} · exported ${new Date().toLocaleString()}`,
      columns: ['#', 'Captured', ...cols],
      rows: tableRows,
      footer: 'Clipboard Extractor',
    });
    download(`${safeFileName(name)}.pdf`, 'application/pdf', pdf);
    const missing = window.ClipPdf.unsupported(name + cols.join('') + tableRows.flat().join(''));
    if (missing.length) {
      toast(`Some characters (${missing.slice(0, 5).join(' ')}) can't be shown in this PDF. Use Download → Print / Save as PDF for those.`);
    }
  }

  async function downloadProjectFile(doc) {
    try {
      const res = await saveTextFile({ suggestedName: safeFileName(doc.name) + '.json', text: JSON.stringify(fileOf(doc), null, 2) });
      if (res) toast(`Project file saved: ${res.fileName}`);
    } catch (e) {
      toast('Could not save the file: ' + (e?.message || e));
    }
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
    'js/pdf.js',
    'js/templates.js',
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
    'test/pdf.test.js',
    'test/templates.test.js',
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
    pdf: () => downloadPdf(project.name, visibleRows()),
    csv: () => downloadCsv(project.name, visibleRows()),
    json() {
      if (!rows.length) return toast('Nothing to download yet');
      const data = visibleRows().map((r) => {
        const o = { capturedAt: new Date(r.capturedAt).toISOString() };
        for (const c of Store.columnsOf(r)) o[c] = r.data[c];
        return o;
      });
      download(`${safeFileName(project.name)}-table.json`, 'application/json', JSON.stringify(data, null, 2));
    },
    file: () => downloadProjectFile(projectDoc()),
    print() {
      if (!rows.length) return toast('Nothing to print yet');
      window.print();
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
    const tsv = matrixOf(visibleRows())
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

  // ---------- phone layout: bottom bar and "More" sheet ----------

  function openTypeBox(afterPasteFailed) {
    const details = $('testPanel').querySelector('details');
    details.open = true;
    $('testPanel').scrollIntoView({ block: 'start', behavior: 'smooth' });
    $('testInput').focus({ preventScroll: true });
    if (afterPasteFailed) toast('Long-press the box, tap Paste, then "Add to table".');
  }

  /** One tap: read the clipboard now (the tap lets the browser ask for permission). */
  async function pasteNow() {
    if (window.isSecureContext && navigator.clipboard?.readText) {
      try {
        const text = await navigator.clipboard.readText();
        if (Watcher.mode === 'prompt') setMode(await detectMode());
        if (text && text.trim()) return handleText(text, { force: true });
        return toast('The clipboard is empty. Copy some text first.');
      } catch {
        /* not allowed: fall back to pasting into the box */
      }
    }
    openTypeBox(true);
  }

  $('mPaste').addEventListener('click', pasteNow);
  $('mProjects').addEventListener('click', () => $('openProjects').click());
  $('mSave').addEventListener('click', () => $('saveProject').click());
  $('mMore').addEventListener('click', () => $('moreSheet').showModal());
  $('moreClose').addEventListener('click', () => $('moreSheet').close());
  $('moreSheet').addEventListener('click', (e) => {
    if (e.target === $('moreSheet')) return $('moreSheet').close();
    const btn = e.target.closest('[data-proxy]');
    if (!btn) return;
    $('moreSheet').close();
    if (btn.dataset.proxy === '#testPanel summary') return openTypeBox(false);
    document.querySelector(btn.dataset.proxy)?.click();
  });
  // Tap outside a dialog (on its backdrop) closes it.
  for (const d of [$('projectsDialog')]) d.addEventListener('click', (e) => e.target === d && d.close());

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

  if (!project.id) project.id = Store.uid(); // projects from older versions
  safely(() => Store.setProject(project)); // remember the project (and its creation time) on first run
  renderProject();
  Store.Library.list()
    .then((l) => ($('projectCount').textContent = l.length || ''))
    .catch(() => {});
  render();
  renderStatus();
  detectMode().then((mode) => {
    setMode(mode);
    startPolling();
  });
})();
