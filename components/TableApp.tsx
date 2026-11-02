'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { Project, ProjectDoc, ProjectSummary, Row, ViewPrefs } from '../lib/types.ts';
import { extract, normalizeSettings, rulesOf, sameRules } from '../lib/extractor.ts';
import Store, { Library, columnsOf, uid } from '../lib/store.ts';
import { BASE_PATH, download, pickTextFile, safeFileName, saveTextFile } from '../lib/files.ts';
import { csvOf, fileOf, jsonOf, parseProject, pdfOf, sortedRows, tsvOf } from '../lib/projectio.ts';
import { formatNumber, numericColumns, resolveGroupBy, resolveSumBy, summarize } from '../lib/summary.ts';
import { Modal, ToastProvider, useDismiss, useIsTouch, useStored, useToast } from './common.tsx';
import DataTable from './DataTable.tsx';
import type { SortState } from './DataTable.tsx';

/** How the clipboard can be read in this browser. */
type Mode = 'checking' | 'auto' | 'prompt' | 'denied' | 'paste' | 'insecure';

const permissionToMode = (state: PermissionState): Mode => (state === 'granted' ? 'auto' : state === 'denied' ? 'denied' : 'prompt');
const defaultProjectName = (): string => 'Project ' + new Date().toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
const plural = (n: number, w: string): string => `${n} ${w}${n === 1 ? '' : 's'}`;
const errMsg = (e: unknown): string => (e instanceof Error ? e.message : String(e));

export default function TableApp() {
  return (
    <ToastProvider>
      <TablePage />
    </ToastProvider>
  );
}

function TablePage() {
  const toast = useToast();
  const isTouch = useIsTouch();
  const settings = useStored(() => Store.getSettings(), ['settings']);
  const rows = useStored(() => Store.getRows(), ['rows']);
  const project = useStored(() => Store.getProject(), ['project']);
  const view = useStored(() => Store.getView(), ['view']);
  /** Show only this group (lower-case key), or every group. */
  const [onlyGroup, setOnlyGroup] = useState<string | null>(null);

  const [mode, setMode] = useState<Mode>('checking');
  const [focused, setFocused] = useState(true);
  const [sort, setSort] = useState<SortState>({ col: '__time', dir: 'desc' });
  const [filter, setFilter] = useState('');
  const [highlightToken, setHighlightToken] = useState(0);
  const [manualOpen, setManualOpen] = useState(false);
  const [manualText, setManualText] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);
  const [projectsOpen, setProjectsOpen] = useState(false);
  const [newOpen, setNewOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [library, setLibrary] = useState<ProjectSummary[] | null>(null);
  const [libraryError, setLibraryError] = useState('');

  const modeRef = useRef(mode);
  modeRef.current = mode;
  const lastText = useRef(Store.getLastText());
  /**
   * Set when automatic reading is (re)started: the next read only records what is on
   * the clipboard as the starting point, so only copies made after Start are added.
   */
  const needsBaseline = useRef(false);
  /** Remember `text` as the last clipboard content seen (it won't be added). */
  const setBaseline = useCallback((text: string) => {
    lastText.current = text;
    needsBaseline.current = false;
    try {
      Store.setLastText(text);
    } catch {
      /* storage full: the in-memory baseline still works */
    }
  }, []);
  const busy = useRef(false);
  const manualRef = useRef<HTMLElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  /** Run a storage action; show its error (e.g. storage full) instead of failing. */
  const safely = useCallback(
    <T,>(fn: () => T): T | undefined => {
      try {
        return fn();
      } catch (e) {
        toast(errMsg(e));
        return undefined;
      }
    },
    [toast]
  );

  // ---------- projects (library) ----------

  const refreshLibrary = useCallback(() => {
    Library.list()
      .then((l) => {
        setLibrary(l);
        setLibraryError('');
      })
      .catch((e) => setLibraryError(e.message || String(e)));
  }, []);
  useEffect(() => {
    refreshLibrary();
    return Store.onChange((k) => k === 'library' && refreshLibrary());
  }, [refreshLibrary]);

  /** A name that no saved project uses yet ("Project Nov 2, 2026 (2)", …). */
  const uniqueName = useCallback(
    (base: string, { includeCurrent = true }: { includeCurrent?: boolean } = {}): string => {
      const names = new Set([...(includeCurrent ? [Store.getProject().name] : []), ...(library || []).map((p) => p.name)]);
      if (!names.has(base)) return base;
      for (let i = 2; ; i++) if (!names.has(`${base} (${i})`)) return `${base} (${i})`;
    },
    [library]
  );

  const updateProject = (changes: Partial<Project>) => safely(() => Store.setProject(Object.assign(Store.getProject(), changes)));

  const startNewProject = useCallback(
    (name: string) => {
      safely(() => Store.setRows([], { dirty: false }));
      safely(() => Store.setProject({ id: uid(), name, createdAt: Date.now(), savedAt: null, dirty: false, closed: false }));
      setFilter('');
    },
    [safely]
  );

  /** Save the current project into Projects. close: the next extraction starts a new project. */
  const saveProject = useCallback(
    async ({ close = true, quiet = false } = {}) => {
      const p = Store.getProject();
      const current = Store.getRows();
      if (!current.length && !p.savedAt) {
        if (!quiet) toast('Nothing to save yet: copy some text first.');
        return false;
      }
      const doc: ProjectDoc = {
        id: p.id || uid(),
        name: p.name,
        createdAt: p.createdAt,
        savedAt: Date.now(),
        rowCount: current.length,
        rules: rulesOf(Store.getSettings()),
        rows: current,
      };
      try {
        await Library.put(doc);
      } catch (e) {
        toast('Could not save: ' + errMsg(e));
        return false;
      }
      updateProject({ id: doc.id, savedAt: doc.savedAt, dirty: false, closed: close });
      if (!quiet) toast(`Saved "${p.name}" (${plural(current.length, 'row')}). The next copy starts a new project.`);
      return true;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [toast]
  );

  /** Before switching projects, keep unsaved work in Projects. */
  const keepCurrentSafe = useCallback(async () => {
    if (Store.getRows().length && Store.getProject().dirty) return saveProject({ close: true, quiet: true });
    return true;
  }, [saveProject]);

  // ---------- extraction ----------

  /**
   * Extract rows from text and add them to the table.
   * fromClipboard: the text is what is on the clipboard now (remember it, so it isn't read twice).
   */
  const handleText = useCallback(
    (input: string, { force = false, fromClipboard = true }: { force?: boolean; fromClipboard?: boolean } = {}): Row[] => {
      let text = input;
      text = String(text || '');
      if (!text.trim()) {
        if (force) toast('The clipboard has no text');
        return [];
      }
      if (!force && text === lastText.current) return [];
      if (fromClipboard) {
        lastText.current = text;
        safely(() => Store.setLastText(text));
      }

      const s = Store.getSettings();
      const extracted = extract(text, s);
      // A saved project is never changed by new data: start a new one.
      let savedName: string | null = null;
      if (extracted.length && Store.getProject().closed) {
        savedName = Store.getProject().name;
        startNewProject(uniqueName(defaultProjectName(), { includeCurrent: false }));
      }
      const added = safely(() => Store.addRows(extracted, { source: s.keepSource ? text : '', dedupe: s.dedupeRows })) || [];
      if (added.length) {
        const n = plural(added.length, 'row');
        toast(savedName ? `"${savedName}" stays saved. Added ${n} to new project "${Store.getProject().name}".` : `Added ${n}`);
        document.title = `(+${added.length}) Clipboard Extractor`;
        setTimeout(() => (document.title = 'Clipboard Extractor'), 4000);
      } else if (force) {
        toast(extracted.length ? 'Already in the table' : 'Nothing to extract from that text. See the Admin panel to add a rule.');
      }
      return added;
    },
    [safely, startNewProject, toast, uniqueName]
  );

  // ---------- clipboard watcher ----------

  const detectMode = useCallback(async (): Promise<Mode> => {
    if (!window.isSecureContext) return 'insecure'; // clipboard reading needs https://
    if (!navigator.clipboard?.readText) return 'paste';
    try {
      const status = await navigator.permissions.query({ name: 'clipboard-read' as PermissionName });
      status.onchange = () => setMode(permissionToMode(status.state));
      return permissionToMode(status.state);
    } catch {
      return 'paste';
    }
  }, []);

  /** Read the clipboard. `manual`: user-initiated, process even if unchanged. */
  const readClipboard = useCallback(
    async (manual = false) => {
      if (!manual && (modeRef.current !== 'auto' || !Store.getSettings().enabled || !document.hasFocus())) return;
      if (busy.current) return;
      busy.current = true;
      try {
        const text = await navigator.clipboard.readText();
        if (!manual && needsBaseline.current) setBaseline(text);
        else handleText(text, { force: manual });
        if (manual && modeRef.current === 'prompt') setMode('auto');
      } catch (e) {
        if (manual) {
          if ((e as { name?: string } | null)?.name === 'NotAllowedError') {
            const m = await detectMode();
            setMode(m);
            if (m !== 'auto') toast(`Clipboard access was not allowed. ${isTouch ? 'Tap Paste' : 'Press Ctrl/⌘+V'} to add text instead.`);
          } else toast('Could not read the clipboard: ' + errMsg(e));
        }
      } finally {
        busy.current = false;
      }
    },
    [detectMode, handleText, isTouch, setBaseline, toast]
  );
  const readRef = useRef(readClipboard);
  readRef.current = readClipboard;

  useEffect(() => {
    detectMode().then(setMode);
  }, [detectMode]);

  useEffect(() => {
    if (mode === 'auto') readRef.current();
  }, [mode]);

  useEffect(() => {
    const t = setInterval(() => readRef.current(), settings.pollInterval);
    return () => clearInterval(t);
  }, [settings.pollInterval]);

  useEffect(() => {
    const onFocus = () => {
      setFocused(true);
      readRef.current();
    };
    const onBlur = () => setFocused(false);
    const onVisible = () => document.visibilityState === 'visible' && readRef.current();
    window.addEventListener('focus', onFocus);
    window.addEventListener('blur', onBlur);
    document.addEventListener('visibilitychange', onVisible);
    setFocused(document.hasFocus());
    return () => {
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('blur', onBlur);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  useEffect(() => Store.onChange((k) => k === 'lastText' && (lastText.current = Store.getLastText())), []);

  // Ctrl/⌘+V anywhere on the page (except in form fields) adds the pasted text.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      if ((e.target as Element | null)?.closest?.('input, textarea, select, [contenteditable="true"]')) return;
      const text = e.clipboardData?.getData('text/plain');
      if (!text) return;
      e.preventDefault();
      handleText(text, { force: true });
    };
    document.addEventListener('paste', onPaste);
    return () => document.removeEventListener('paste', onPaste);
  }, [handleText]);

  // Ctrl/⌘+S saves (Shift: download the project file).
  const downloadProjectFileRef = useRef<(() => void) | null>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        if (e.shiftKey) downloadProjectFileRef.current?.();
        else saveProject();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [saveProject]);

  // First run (or a project from an older version): give the project an id.
  useEffect(() => {
    const p = Store.getProject();
    if (!p.id) safely(() => Store.setProject(Object.assign(p, { id: uid() })));
  }, [safely]);

  /**
   * Start automatic reading: what is on the clipboard now becomes the starting point and is
   * not added; only copies made after this are. Called from a click, so the browser can ask
   * for clipboard permission.
   */
  const startReading = async () => {
    needsBaseline.current = true;
    if (!window.isSecureContext || !navigator.clipboard?.readText) return;
    busy.current = true;
    try {
      setBaseline(await navigator.clipboard.readText());
      if (modeRef.current !== 'auto') setMode(await detectMode());
      toast('Auto-read is ON. Copies you make from now on are added; what was already on the clipboard is skipped.');
    } catch (e) {
      const m = await detectMode();
      setMode(m);
      if ((e as { name?: string } | null)?.name === 'NotAllowedError' && m !== 'auto') {
        toast(`Clipboard access was not allowed. ${isTouch ? 'Tap Paste' : 'Press Ctrl/⌘+V'} to add text instead.`);
      }
      // Otherwise (e.g. the tab lost focus) the next automatic read takes the baseline.
    } finally {
      busy.current = false;
    }
  };

  const setEnabled = (on: boolean) => {
    prevEnabled.current = on; // this tab handles the start itself (see the effect below)
    safely(() => Store.saveSettings({ ...Store.getSettings(), enabled: on }));
    if (!on) return toast('Auto-read is OFF. Copies are not read until you press Start again.');
    if (mode === 'insecure') {
      return toast(`Browsers only allow automatic clipboard reading on https:// pages. ${isTouch ? 'Tap Paste' : 'Press Ctrl/⌘+V on this page'} instead, or set up HTTPS.`);
    }
    if (mode === 'paste' || mode === 'denied') {
      return toast(`This browser doesn't let web pages read the clipboard automatically. ${isTouch ? 'Tap Paste' : 'Press Ctrl/⌘+V on this page'} instead.`);
    }
    void startReading();
  };

  // Turned on somewhere else (the admin panel or another tab): start from the current clipboard too.
  const prevEnabled = useRef(settings.enabled);
  useEffect(() => {
    if (settings.enabled && !prevEnabled.current) needsBaseline.current = true;
    prevEnabled.current = settings.enabled;
  }, [settings.enabled]);

  // Alt+Shift+A starts / stops automatic reading.
  const setEnabledRef = useRef(setEnabled);
  setEnabledRef.current = setEnabled;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.altKey && e.shiftKey && !e.ctrlKey && !e.metaKey && e.code === 'KeyA') {
        e.preventDefault();
        setEnabledRef.current(!Store.getSettings().enabled);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  // ---------- table ----------

  const visible = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const list = q
      ? rows.filter((r) => Object.values(r.data).some((v) => String(v).toLowerCase().includes(q)) || (r.source || '').toLowerCase().includes(q))
      : rows.slice();
    const dir = sort.dir === 'asc' ? 1 : -1;
    const idx = new Map(rows.map((r, i) => [r.id, i]));
    list.sort((a, b) => {
      // Newest capture first by default, but rows of one capture stay in clipboard order.
      if (sort.col === '__time') return (a.capturedAt - b.capturedAt) * dir || (idx.get(a.id) ?? 0) - (idx.get(b.id) ?? 0);
      return String(a.data[sort.col] ?? '').localeCompare(String(b.data[sort.col] ?? ''), undefined, { numeric: true, sensitivity: 'base' }) * dir;
    });
    return list;
  }, [rows, filter, sort]);

  // ---------- grouping and totals (e.g. per Platform, total Credit) ----------

  const setView = (changes: Partial<ViewPrefs>) => safely(() => Store.setView({ ...Store.getView(), ...changes }));
  const groupBy = resolveGroupBy(rows, view.groupBy);
  const sumBy = resolveSumBy(rows, view.sumBy);
  const summary = useMemo(() => summarize(visible, groupBy, sumBy), [visible, groupBy, sumBy]);
  const activeGroup = onlyGroup !== null && summary.groups.some((g) => g.key.toLowerCase() === onlyGroup) ? onlyGroup : null;
  const shownGroups = activeGroup === null ? summary.groups : summary.groups.filter((g) => g.key.toLowerCase() === activeGroup);
  /** What is on screen (and what downloads contain): every row, or one group's rows. */
  const shown = activeGroup === null || !groupBy ? visible : shownGroups.flatMap((g) => g.rows);
  const shownTotal = activeGroup === null ? summary.total : shownGroups.reduce((t, g) => t + g.total, 0);
  /** Group / total columns for any list of rows (e.g. a saved project's). */
  const reportColumns = (list: Row[]) => ({ groupBy: resolveGroupBy(list, view.groupBy), sumBy: resolveSumBy(list, view.sumBy) });

  const onSort = (key: string) => setSort((s): SortState => (s.col === key ? { col: key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { col: key, dir: 'asc' }));
  const onEdit = (id: string, col: string, value: string) => {
    const next = Store.getRows().map((r) => {
      if (r.id !== id) return r;
      const data = { ...r.data };
      if (value) data[col] = value;
      else delete data[col];
      const cols = Array.isArray(r.cols) && value && !r.cols.includes(col) ? [...r.cols, col] : r.cols;
      return { ...r, data, cols };
    });
    safely(() => Store.setRows(next));
  };
  const onDelete = (id: string) => safely(() => Store.setRows(Store.getRows().filter((r) => r.id !== id)));
  const explainInAdmin = (text: string) => {
    safely(() => Store.setDraft(text));
    window.location.href = `${BASE_PATH}/admin/#test`;
  };

  const clearTable = () => {
    if (!rows.length) return;
    if (!confirm(`Delete all ${rows.length} rows in "${project.name}"? This cannot be undone.`)) return;
    safely(() => Store.setRows([]));
    toast('Table cleared');
  };

  // ---------- downloads ----------

  const downloadPdf = (name: string, list: Row[], columns: { groupBy?: string; sumBy?: string } = reportColumns(list)) => {
    if (!list.length) return toast('Nothing to download yet');
    const { bytes, unsupported } = pdfOf(name, list, columns);
    download(`${safeFileName(name)}.pdf`, 'application/pdf', bytes);
    if (unsupported.length) {
      toast(`Some characters (${unsupported.slice(0, 5).join(' ')}) can't be shown in this PDF. Use Download → Print / Save as PDF for those.`);
    }
  };
  const downloadCsv = (name: string, list: Row[]) => {
    if (!list.length) return toast('Nothing to download yet');
    download(`${safeFileName(name)}.csv`, 'text/csv;charset=utf-8', csvOf(list));
  };
  const downloadProjectFile = async (doc: ProjectDoc) => {
    try {
      const res = await saveTextFile({ suggestedName: safeFileName(doc.name) + '.json', text: JSON.stringify(fileOf(doc), null, 2) });
      if (res) toast(`Project file saved: ${res.fileName}`);
    } catch (e) {
      toast('Could not save the file: ' + errMsg(e));
    }
  };
  const currentDoc = (): ProjectDoc => {
    const p = Store.getProject();
    return { id: p.id || uid(), name: p.name, createdAt: p.createdAt, savedAt: Date.now(), rules: rulesOf(Store.getSettings()), rows: Store.getRows() };
  };
  downloadProjectFileRef.current = () => downloadProjectFile(currentDoc());

  const DOWNLOADS = {
    pdf: () => downloadPdf(project.name, shown, { groupBy, sumBy }),
    csv: () => downloadCsv(project.name, shown),
    json: () => (shown.length ? download(`${safeFileName(project.name)}-table.json`, 'application/json', jsonOf(shown)) : toast('Nothing to download yet')),
    file: () => downloadProjectFile(currentDoc()),
    print: () => (rows.length ? window.print() : toast('Nothing to print yet')),
    async app() {
      const url = `${BASE_PATH}/clipboard-extractor-source.zip`;
      try {
        const res = await fetch(url, { method: 'HEAD' });
        if (!res.ok) throw new Error(String(res.status));
      } catch {
        return toast('The source code download is not available on this server. Run "npm run build" to create it.');
      }
      const a = document.createElement('a');
      a.href = url;
      a.download = 'clipboard-extractor-source.zip';
      document.body.append(a);
      a.click();
      a.remove();
    },
  };
  const runDownload = (kind: keyof typeof DOWNLOADS) => {
    setMenuOpen(false);
    Promise.resolve(DOWNLOADS[kind]()).catch((e) => toast('Download failed: ' + errMsg(e)));
  };
  useDismiss(menuRef, menuOpen, useCallback(() => setMenuOpen(false), []));

  const copyTable = async () => {
    if (!rows.length) return toast('Nothing to copy');
    const tsv = tsvOf(shown);
    lastText.current = tsv; // don't re-import our own copy
    safely(() => Store.setLastText(tsv));
    try {
      await navigator.clipboard.writeText(tsv);
      toast('Copied: paste into Excel or Google Sheets');
    } catch {
      toast('Copy failed: your browser blocked clipboard writing');
    }
  };

  // ---------- open / new project ----------

  const openDoc = async (doc: ProjectDoc) => {
    const p = Store.getProject();
    if (doc.id === p.id && !p.dirty) return setProjectsOpen(false);
    if (doc.id !== p.id && !(await keepCurrentSafe())) return;
    if (doc.rules && !sameRules(Store.getSettings(), doc.rules)) {
      const useTheirs = confirm(
        `"${doc.name}" was saved with different extraction rules.\n\nOK: use the project's rules (replaces the rules in the Admin panel)\nCancel: keep the current rules`
      );
      if (useTheirs) safely(() => Store.saveSettings(normalizeSettings({ ...Store.getSettings(), ...rulesOf(doc.rules) })));
    }
    safely(() => Store.setRows(doc.rows || [], { dirty: false }));
    safely(() => Store.setProject({ id: doc.id, name: doc.name, createdAt: doc.createdAt, savedAt: doc.savedAt, dirty: false, closed: true }));
    setFilter('');
    setHighlightToken((t) => t + 1);
    setProjectsOpen(false);
    toast(`Opened "${doc.name}" (${plural((doc.rows || []).length, 'row')})`);
  };

  const openFromFile = async () => {
    const picked = await pickTextFile();
    if (!picked) return;
    let p;
    try {
      p = parseProject(JSON.parse(picked.text), picked.name);
    } catch (err) {
      return toast(err instanceof SyntaxError ? 'That file is not valid JSON.' : errMsg(err));
    }
    const doc: ProjectDoc = { id: uid(), name: uniqueName(p.name), createdAt: p.createdAt, savedAt: Date.now(), rowCount: p.rows.length, rules: p.rules, rows: p.rows };
    try {
      await Library.put(doc);
    } catch (e) {
      return toast('Could not add the project: ' + errMsg(e));
    }
    await openDoc(doc);
  };

  const withDoc = (id: string, fn: (doc: ProjectDoc) => unknown) => async () => {
    const doc = await Library.get(id);
    if (!doc) return toast('That project no longer exists.');
    return fn(doc);
  };

  const deleteProject = async (p: ProjectSummary) => {
    if (!confirm(`Delete "${p.name}" (${plural(p.rowCount, 'row')}) from Projects? This cannot be undone.`)) return;
    await Library.remove(p.id);
    if (p.id === Store.getProject().id) updateProject({ savedAt: null, dirty: Store.getRows().length > 0, closed: false });
    toast(`Deleted "${p.name}"`);
  };

  // ---------- phone: Paste button ----------

  const openTypeBox = (afterPasteFailed: boolean) => {
    setManualOpen(true);
    setTimeout(() => {
      manualRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' });
      document.getElementById('testInput')?.focus({ preventScroll: true });
    }, 0);
    if (afterPasteFailed) toast('Long-press the box, tap Paste, then "Add to table".');
  };

  /** One tap: read the clipboard now (the tap lets the browser ask for permission). */
  const pasteNow = async () => {
    if (window.isSecureContext && navigator.clipboard?.readText) {
      try {
        const text = await navigator.clipboard.readText();
        if (mode === 'prompt') setMode(await detectMode());
        if (text && text.trim()) return handleText(text, { force: true });
        return toast('The clipboard is empty. Copy some text first.');
      } catch {
        /* not allowed: fall back to pasting into the box */
      }
    }
    openTypeBox(true);
  };

  // ---------- render ----------

  /** "More" sheet entries: icon, label, action, test id. */
  const moreItems: [string, string, () => unknown, string?][] = [
    settings.enabled
      ? ['⏸', 'Stop auto-read', () => setEnabled(false), 'stop-autoread']
      : ['▶', 'Start auto-read', () => setEnabled(true), 'start-autoread'],
    ['＋', 'New project', () => setNewOpen(true)],
    ...(mode === 'auto' ? [['↻', 'Read clipboard again', () => readClipboard(true)] as [string, string, () => unknown]] : []),
    ['⇩', 'Download PDF', () => runDownload('pdf'), 'pdf'],
    ['⇩', 'Download CSV (Excel)', () => runDownload('csv'), 'csv'],
    ['⇩', 'Download project file', () => runDownload('file')],
    ['⎙', 'Print / Save as PDF', () => runDownload('print')],
    ['⧉', 'Copy table', copyTable],
    ['✎', 'Type or paste text', () => openTypeBox(false)],
  ];

  const on = settings.enabled;
  const pasteHint = isTouch ? 'tap Paste' : 'press Ctrl/⌘+V';
  let status;
  if (!on) status = [`Off: copies are not read automatically (${isTouch ? 'Paste' : 'Ctrl/⌘+V'} still works)`, 'off'];
  else if (mode === 'auto') status = [focused ? 'Watching clipboard' : 'Watching: switch back to this tab after copying', 'ok'];
  else if (mode === 'prompt') status = ['Allow clipboard access to start', 'warn'];
  else if (mode === 'denied') status = [`Clipboard blocked in site settings: ${pasteHint} instead`, 'error'];
  else if (mode === 'paste') status = [`This browser doesn't allow automatic reading: ${pasteHint} to add`, 'warn'];
  else if (mode === 'insecure') status = [`Automatic reading needs an https:// address: ${pasteHint} to add`, 'warn'];
  else status = ['Starting…', 'warn'];

  let saveState = { text: '', cls: 'save-state', title: '' };
  if (project.dirty) saveState = { text: '● Unsaved', cls: 'save-state dirty', title: 'This project has changes that are not saved yet. Click "Save project" (Ctrl/⌘+S).' };
  else if (project.savedAt) saveState = { text: '✓ Saved', cls: 'save-state saved', title: `Saved to Projects ${new Date(project.savedAt).toLocaleString()}` };

  const preview = manualText.trim() ? extract(manualText, settings) : [];
  const previewCols = columnsOf(preview.map((d) => ({ data: d, cols: Object.keys(d) })));
  const allCols = columnsOf(rows);
  const clips = new Set(rows.map((r) => r.clipId)).size;
  const hasRows = rows.length > 0;

  return (
    <div className="table-page">
      <header className="topbar">
        <div className="brand">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={`${BASE_PATH}/icons/icon32.png`} alt="" width="24" height="24" />
          <h1>Clipboard Extractor</h1>
          <ProjectName name={project.name} onRename={(name: string) => name !== project.name && updateProject({ name, dirty: true })}>
            <span className={saveState.cls} title={saveState.title} id="saveState">
              {saveState.text}
            </span>
          </ProjectName>
          <label className={'autoread' + (on ? ' on' : '')} title="When ON, new clipboard text is read and extracted automatically">
            <input type="checkbox" id="enabled" role="switch" checked={on} onChange={(e) => setEnabled(e.target.checked)} aria-describedby="statusText" />
            <span className="autoread-label">Auto-read clipboard</span>
            <span className="autoread-state" id="enabledState">
              {on ? 'ON' : 'OFF'}
            </span>
          </label>
          <span className="status" id="status" role="status" data-kind={status[1]}>
            <span className="dot" />
            <span id="statusText">{status[0]}</span>
          </span>
          {on && mode === 'prompt' ? (
            <button className="primary" id="allow" onClick={() => void startReading()}>
              Allow clipboard access
            </button>
          ) : null}
        </div>
        <div className="tools">
          <div className="group" role="group" aria-label="Project">
            <button id="openProjects" title="Your saved projects: open, download or delete" onClick={() => setProjectsOpen(true)}>
              Projects <span className="badge">{library?.length || ''}</span>
            </button>
            <button id="newProject" title="Start a new, empty project (keeps your extraction rules)" onClick={() => setNewOpen(true)}>
              New project
            </button>
            <button id="saveProject" className="primary" title="Save this project to Projects (Ctrl/⌘+S). New copies then start a new project." onClick={() => saveProject()}>
              Save project
            </button>
          </div>
          <button
            id="autoReadButton"
            className={settings.enabled ? 'autoread-stop' : 'autoread-start'}
            aria-pressed={settings.enabled}
            title={settings.enabled ? 'Stop reading the clipboard automatically (Alt+Shift+A)' : 'Start reading the clipboard automatically (Alt+Shift+A)'}
            onClick={() => setEnabled(!settings.enabled)}
          >
            {settings.enabled ? '⏸ Stop auto-read' : '▶ Start auto-read'}
          </button>
          {mode === 'auto' ? (
            <button id="readNow" title="Read the clipboard now, even if it was already captured" onClick={() => readClipboard(true)}>
              Read clipboard
            </button>
          ) : null}
          <input type="search" id="search" placeholder="Filter rows…" aria-label="Filter rows" value={filter} onChange={(e) => setFilter(e.target.value)} />
          <button id="copyTsv" title="Copy the visible rows as tab-separated text (paste into Excel/Sheets)" onClick={copyTable}>
            Copy
          </button>
          <div className="menu" id="downloadMenu" ref={menuRef}>
            <button className="menu-button" aria-expanded={menuOpen} onClick={() => setMenuOpen((o) => !o)}>
              Download ▾
            </button>
            {menuOpen ? (
              <div className="menu-list">
                <button data-download="pdf" onClick={() => runDownload('pdf')}>
                  Table as PDF<small>Ready to print or share</small>
                </button>
                <button data-download="csv" onClick={() => runDownload('csv')}>
                  Table as CSV<small>Opens in Excel and Google Sheets</small>
                </button>
                <button data-download="json" onClick={() => runDownload('json')}>
                  Table as JSON<small>For other programs</small>
                </button>
                <button data-download="file" onClick={() => runDownload('file')}>
                  Project file (.json)<small>All rows and rules in one file; open it again later</small>
                </button>
                <button data-download="print" onClick={() => runDownload('print')}>
                  Print / Save as PDF<small>Your browser&apos;s print dialog; supports every language</small>
                </button>
                <button data-download="app" onClick={() => runDownload('app')}>
                  App source code (.zip)<small>The Next.js project, to run or host your own copy</small>
                </button>
              </div>
            ) : null}
          </div>
          <button id="clear" className="danger" title="Delete all rows in this project" onClick={clearTable}>
            Clear
          </button>
          <Link className="btn" href="/admin/" id="adminLink" title="Extraction rules and how text is extracted">
            Admin panel
          </Link>
        </div>
      </header>

      <main>
        <h1 className="print-title">{project.name}</h1>
        {project.closed && !project.dirty ? (
          <div className="banner" id="savedBanner">
            <span>
              ✓ <b>&quot;{project.name}&quot;</b> is saved in Projects. The next copy will start a <b>new project</b>.
            </span>
            <button
              className="link"
              id="keepAdding"
              onClick={() => {
                updateProject({ closed: false });
                toast(`New copies will be added to "${project.name}"`);
              }}
            >
              Keep adding to this project instead
            </button>
          </div>
        ) : null}

        <section className="panel" id="testPanel" ref={manualRef}>
          <details open={manualOpen} onToggle={(e) => setManualOpen(e.currentTarget.open)}>
            <summary>Paste text manually</summary>
            <p className="muted">Paste or type any text to preview what will be extracted with the current rules.</p>
            <textarea
              id="testInput"
              rows={6}
              value={manualText}
              onChange={(e) => setManualText(e.target.value)}
              placeholder={'e.g.\nName: Jane Doe\nEmail: jane@example.com\nPhone: +1 555 123 4567'}
            />
            <div className="row">
              <button className="primary" id="testAdd" onClick={() => manualText.trim() && handleText(manualText, { force: true, fromClipboard: false })}>
                Add to table
              </button>
              <button id="testExplain" title="Open this text in the admin panel to see step by step how it is extracted" onClick={() => explainInAdmin(manualText)}>
                Explain extraction
              </button>
              <span className="muted" id="testInfo">
                {manualText.trim() ? `${plural(preview.length, 'row')} would be extracted` : ''}
              </span>
            </div>
            {preview.length ? (
              <div className="preview" id="testPreview">
                <table>
                  <thead>
                    <tr>
                      {previewCols.map((c) => (
                        <th key={c}>{c}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {preview.map((d, i) => (
                      <tr key={i}>
                        {previewCols.map((c) => (
                          <td key={c}>{d[c] ?? ''}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
          </details>
        </section>

        <div className="summary muted" id="summary">
          {hasRows
            ? `${visible.length === rows.length ? rows.length : visible.length + ' of ' + rows.length} rows · ${allCols.length} columns · from ${plural(clips, 'capture')}`
            : ''}
        </div>
        {hasRows ? (
          <ViewBar
            view={view}
            columns={allCols}
            numeric={numericColumns(rows)}
            autoGroup={resolveGroupBy(rows, 'auto')}
            autoSum={resolveSumBy(rows, 'auto')}
            onChange={(changes) => {
              setView(changes);
              if ('groupBy' in changes) setOnlyGroup(null);
            }}
          />
        ) : null}
        {groupBy && summary.groups.length ? (
          <div className="group-chips" id="groupChips" role="group" aria-label={`Show one ${groupBy}`}>
            <button className={'gchip' + (activeGroup === null ? ' active' : '')} aria-pressed={activeGroup === null} onClick={() => setOnlyGroup(null)}>
              <b>All</b> <span>{plural(summary.count, 'row')}</span>
              {sumBy ? <span className="gtotal">{formatNumber(summary.total)}</span> : null}
            </button>
            {summary.groups.map((g) => {
              const key = g.key.toLowerCase();
              return (
                <button key={key} className={'gchip' + (activeGroup === key ? ' active' : '')} aria-pressed={activeGroup === key} onClick={() => setOnlyGroup(activeGroup === key ? null : key)}>
                  <b>{g.label}</b> <span>{plural(g.rows.length, 'row')}</span>
                  {sumBy ? <span className="gtotal">{formatNumber(g.total)}</span> : null}
                </button>
              );
            })}
          </div>
        ) : null}
        <div className={'table-wrap ' + (view.mobileView === 'cards' ? 'cards' : 'as-table')}>
          {hasRows ? (
            <DataTable
              rows={rows}
              list={shown}
              groupBy={groupBy}
              groups={shownGroups}
              sumBy={sumBy}
              total={shownTotal}
              keepSource={settings.keepSource}
              sort={sort}
              onSort={onSort}
              onEdit={onEdit}
              onDelete={onDelete}
              onExplain={explainInAdmin}
              highlightToken={highlightToken}
            />
          ) : (
            <div className="empty" id="empty">
              <h2>No data yet</h2>
              <p className="mouse-only">
                Copy some text anywhere (Ctrl/⌘ + C), then come back to this tab. The clipboard is read automatically, and emails, phone numbers, URLs, dates,
                amounts, <code>Key: Value</code> lines and your custom rules land in this table.
              </p>
              <p className="mouse-only">
                You can also press <kbd>Ctrl</kbd>/<kbd>⌘</kbd> + <kbd>V</kbd> anywhere on this page.
              </p>
              <p className="touch-only">
                Copy text in any app, come back here and tap <b>Paste</b>. Emails, phone numbers, links, dates, amounts, <code>Key: Value</code> lines and your
                custom rules are pulled out into cards.
              </p>
              <p className="muted">
                <b>Save project</b> keeps it in Projects, and the next copy starts a new project. The <Link href="/admin/">Admin panel</Link> shows and edits the
                rules used for extraction.
              </p>
            </div>
          )}
        </div>
      </main>

      <NewProjectDialog
        open={newOpen}
        onClose={() => setNewOpen(false)}
        suggestedName={uniqueName(defaultProjectName())}
        note={rows.length && project.dirty ? `"${project.name}" has unsaved changes. It will be saved to Projects first.` : ''}
        onCreate={async (name) => {
          setNewOpen(false);
          if (!(await keepCurrentSafe())) return;
          const previous = Store.getProject().name;
          const hadRows = Store.getRows().length > 0;
          startNewProject(name);
          toast(hadRows ? `"${previous}" is saved. Started "${name}".` : `Started "${name}"`);
        }}
      />

      <Modal open={projectsOpen} onClose={() => setProjectsOpen(false)} className="wide" id="projectsDialog">
        <div className="dialog-head">
          <h2>Projects</h2>
          <div className="row">
            <button id="openFromFile" title="Add a project file (.json) to this list and open it" onClick={openFromFile}>
              Open from file…
            </button>
            <button className="icon" id="closeProjects" title="Close" aria-label="Close" onClick={() => setProjectsOpen(false)}>
              ✕
            </button>
          </div>
        </div>
        <p className="muted small">Saved projects stay in this browser. Download a project as a file to keep a backup or move it to another computer.</p>
        <div id="projectList" className="project-list">
          {libraryError ? <p className="err">{libraryError}</p> : null}
          {library && !library.length ? <p className="muted">No saved projects yet. Click &quot;Save project&quot; to keep the current table here.</p> : null}
          {(library || []).map((p) => {
            const current = p.id === project.id;
            return (
              <div key={p.id} className={'project-item' + (current ? ' current' : '')}>
                <div className="project-info">
                  <b>{p.name}</b>
                  {current ? <span className="tag">{project.dirty ? 'open · unsaved changes' : 'open'}</span> : null}
                  <div className="muted small">
                    {plural(p.rowCount, 'row')} · saved {new Date(p.savedAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}
                  </div>
                </div>
                <div className="project-actions">
                  <button className={current ? '' : 'primary'} disabled={current && !project.dirty} onClick={withDoc(p.id, openDoc)}>
                    Open
                  </button>
                  <button title="Download as PDF (grouped and totalled like the table)" onClick={withDoc(p.id, (d) => downloadPdf(d.name, sortedRows(d.rows)))}>
                    PDF
                  </button>
                  <button title="Download as CSV (Excel)" onClick={withDoc(p.id, (d) => downloadCsv(d.name, sortedRows(d.rows)))}>
                    CSV
                  </button>
                  <button title="Download the project file (.json)" onClick={withDoc(p.id, downloadProjectFile)}>
                    File
                  </button>
                  <button className="icon danger" title="Delete project" aria-label={`Delete ${p.name}`} onClick={() => deleteProject(p)}>
                    ✕
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </Modal>

      {/* Phone layout: bottom action bar + "More" sheet (hidden on larger screens) */}
      <nav className="mobile-bar" aria-label="Actions">
        <button id="mProjects" onClick={() => setProjectsOpen(true)}>
          <span className="mi">▤</span>Projects
        </button>
        <button id="mPaste" className="primary paste" onClick={pasteNow}>
          <span className="mi">⧉</span>Paste
        </button>
        <button id="mSave" onClick={() => saveProject()}>
          <span className="mi">✓</span>Save
        </button>
        <button id="mMore" onClick={() => setMoreOpen(true)}>
          <span className="mi">⋯</span>More
        </button>
      </nav>

      <Modal open={moreOpen} onClose={() => setMoreOpen(false)} className="sheet" id="moreSheet">
        <div className="sheet-grip" />
        <div className="sheet-list" id="moreList">
          {moreItems.map(([icon, label, fn, key]) => (
            <button
              key={label}
              data-action={key}
              onClick={() => {
                setMoreOpen(false);
                fn();
              }}
            >
              <span className="mi">{icon}</span>
              {label}
            </button>
          ))}
          <Link href="/admin/">
            <span className="mi">⚙</span>Admin panel: extraction rules
          </Link>
          <button
            onClick={() => {
              setMoreOpen(false);
              runDownload('app');
            }}
          >
            <span className="mi">⇩</span>App source code (.zip)
          </button>
          <button
            className="danger"
            onClick={() => {
              setMoreOpen(false);
              clearTable();
            }}
          >
            <span className="mi">✕</span>Clear table
          </button>
        </div>
        <button className="sheet-close" id="moreClose" onClick={() => setMoreOpen(false)}>
          Close
        </button>
      </Modal>
    </div>
  );
}

interface ViewBarProps {
  view: ViewPrefs;
  columns: string[];
  /** Columns that can be totalled. */
  numeric: string[];
  /** What "Auto" picks for these rows ('' if nothing). */
  autoGroup: string;
  autoSum: string;
  onChange: (changes: Partial<ViewPrefs>) => void;
}

/** Group by / Total choices, and Table / Cards on phones. */
function ViewBar({ view, columns, numeric, autoGroup, autoSum, onChange }: ViewBarProps) {
  const groupValue = view.groupBy === 'auto' || view.groupBy === '' || columns.includes(view.groupBy) ? view.groupBy : 'auto';
  const sumValue = view.sumBy === 'auto' || view.sumBy === '' || numeric.includes(view.sumBy) ? view.sumBy : 'auto';
  return (
    <div className="viewbar" id="viewbar">
      <label>
        Group by
        <select id="groupBy" value={groupValue} onChange={(e) => onChange({ groupBy: e.target.value })}>
          <option value="auto">Auto ({autoGroup || 'none'})</option>
          <option value="">No grouping</option>
          {columns.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </label>
      <label>
        Total
        <select id="sumBy" value={sumValue} onChange={(e) => onChange({ sumBy: e.target.value })}>
          <option value="auto">Auto ({autoSum || 'none'})</option>
          <option value="">No total</option>
          {numeric.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </label>
      <div className="seg touch-layout" role="group" aria-label="Show rows as">
        <button id="viewTable" aria-pressed={view.mobileView === 'table'} onClick={() => onChange({ mobileView: 'table' })}>
          ▦ Table
        </button>
        <button id="viewCards" aria-pressed={view.mobileView === 'cards'} onClick={() => onChange({ mobileView: 'cards' })}>
          ▤ Cards
        </button>
      </div>
    </div>
  );
}

/** Editable project name: saved on blur or Enter. */
function ProjectName({ name, onRename, children }: { name: string; onRename: (name: string) => void; children?: ReactNode }) {
  const [value, setValue] = useState(name);
  const [editing, setEditing] = useState(false);
  useEffect(() => {
    if (!editing) setValue(name);
  }, [name, editing]);
  const commit = () => {
    setEditing(false);
    const v = value.trim() || 'Untitled project';
    setValue(v);
    onRename(v);
  };
  return (
    <div className="project" title="Project name: click to rename">
      <input
        type="text"
        id="projectName"
        aria-label="Project name"
        spellCheck={false}
        value={value}
        style={{ width: Math.min(Math.max(value.length, 8), 32) + 2 + 'ch' }}
        onFocus={() => setEditing(true)}
        onChange={(e) => setValue(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
      />
      {children}
    </div>
  );
}

interface NewProjectDialogProps {
  open: boolean;
  onClose: () => void;
  suggestedName: string;
  /** Shown when the current project will be saved first. */
  note: string;
  onCreate: (name: string) => void;
}

function NewProjectDialog({ open, onClose, suggestedName, note, onCreate }: NewProjectDialogProps) {
  const [name, setName] = useState(suggestedName);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (open) {
      setName(suggestedName);
      setTimeout(() => inputRef.current?.select(), 0);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  return (
    <Modal open={open} onClose={onClose} id="newDialog">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onCreate(name.trim() || suggestedName);
        }}
      >
        <h2>Start a new project</h2>
        <label className="field-col">
          Project name
          <input type="text" id="newName" ref={inputRef} required value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        {note ? (
          <p className="small" id="newNote">
            {note}
          </p>
        ) : null}
        <p className="muted small">The new project starts with an empty table and uses the same extraction rules from the Admin panel.</p>
        <div className="row end">
          <button type="button" value="cancel" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" value="ok" className="primary">
            Start new project
          </button>
        </div>
      </form>
    </Modal>
  );
}
