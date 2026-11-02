/* Project files and table exports (CSV, JSON, PDF). Pure functions: no DOM. */
import { columnsOf, columnsOfRow, uid } from './store.ts';
import Pdf from './pdf.ts';
import type { ProjectDoc, Row, Rules, SettingsInput } from './types.ts';

export const PROJECT_APP = 'clipboard-extractor' as const;

export const fmtTime = (ts: number): string =>
  new Date(ts).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' });

/** Rows in capture order (oldest capture first, clipboard order within a capture). */
export const sortedRows = (list: Row[]): Row[] =>
  list
    .map((r, i): [Row, number] => [r, i])
    .sort((a, b) => a[0].capturedAt - b[0].capturedAt || a[1] - b[1])
    .map(([r]) => r);

/** [header, ...rows] with a "Captured" column first. */
export function matrixOf(list: Row[]): string[][] {
  const cols = columnsOf(list);
  return [['Captured', ...cols], ...list.map((r) => [new Date(r.capturedAt).toISOString(), ...cols.map((c) => r.data[c] ?? '')])];
}

export function csvOf(list: Row[]): string {
  const esc = (v: string): string => (/[",\n\r]/.test(v) ? '"' + String(v).replace(/"/g, '""') + '"' : String(v));
  return '﻿' + matrixOf(list).map((r) => r.map(esc).join(',')).join('\r\n');
}

export const tsvOf = (list: Row[]): string =>
  matrixOf(list)
    .map((r) => r.map((v) => String(v).replace(/[\t\n\r]+/g, ' ')).join('\t'))
    .join('\n');

export function jsonOf(list: Row[]): string {
  return JSON.stringify(
    list.map((r) => {
      const o: Record<string, string> = { capturedAt: new Date(r.capturedAt).toISOString() };
      for (const c of columnsOfRow(r)) o[c] = r.data[c];
      return o;
    }),
    null,
    2
  );
}

/** PDF bytes for a table, plus characters the PDF fonts can't show. */
export function pdfOf(name: string, list: Row[]): { bytes: Uint8Array<ArrayBuffer>; unsupported: string[] } {
  const cols = columnsOf(list);
  const rows = list.map((r, i) => [String(i + 1), fmtTime(r.capturedAt), ...cols.map((c) => r.data[c] ?? '')]);
  const bytes = Pdf.table({
    title: name,
    subtitle: `${list.length} row${list.length === 1 ? '' : 's'} · ${cols.length} column${cols.length === 1 ? '' : 's'} · exported ${new Date().toLocaleString()}`,
    columns: ['#', 'Captured', ...cols],
    rows,
    footer: 'Clipboard Extractor',
  });
  return { bytes, unsupported: Pdf.unsupported(name + cols.join('') + rows.flat().join('')) };
}

/** Project file contents (also what "Open from file" reads). */
export function fileOf(doc: ProjectDoc): ProjectFile {
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

/** What a project file contains. */
export interface ProjectFile {
  app: typeof PROJECT_APP;
  type: 'project';
  version: 2;
  name: string;
  createdAt: string;
  savedAt: string;
  rules: Rules | SettingsInput | null;
  rows: Row[];
}

/** A project read from a file. */
export interface ParsedProject {
  name: string;
  createdAt: number;
  rules: Rules | SettingsInput | null;
  rows: Row[];
}

type Loose = Record<string, unknown>;

/** Read a project file (v1 or v2) or a "Table as JSON" download. Throws if it is neither. */
export function parseProject(input: unknown, fileName?: string): ParsedProject {
  const toRow = (src: Loose, clipId: string): Row => {
    const data = (src.data && typeof src.data === 'object' ? src.data : src) as Loose;
    const clean: Record<string, string> = {};
    const order: string[] = [];
    for (const [k, v] of Object.entries(data)) {
      if (k === 'capturedAt' && data === src) continue;
      if (v == null || v === '' || typeof v === 'object') continue;
      clean[String(k)] = String(v);
      order.push(String(k));
    }
    const ts = typeof src.capturedAt === 'number' ? src.capturedAt : Date.parse(String(src.capturedAt));
    return {
      id: typeof src.id === 'string' && src.data ? src.id : uid(),
      clipId: src.data && typeof src.clipId === 'string' && src.clipId ? src.clipId : clipId,
      capturedAt: Number.isFinite(ts) ? ts : Date.now(),
      data: clean,
      cols: Array.isArray(src.cols) ? (src.cols as string[]).filter((c) => c in clean) : order,
      source: typeof src.source === 'string' ? src.source : '',
    };
  };
  const baseName = String(fileName || '').replace(/\.json$/i, '') || 'Untitled project';

  const obj = input as Loose | null;
  if (obj && !Array.isArray(obj) && obj.app === PROJECT_APP && Array.isArray(obj.rows)) {
    const clip = uid();
    const created = Date.parse(String(obj.createdAt));
    return {
      name: typeof obj.name === 'string' && obj.name.trim() ? obj.name.trim() : baseName,
      createdAt: Number.isFinite(created) ? created : Date.now(),
      rules: (obj.rules || obj.settings || null) as ParsedProject['rules'],
      rows: (obj.rows as unknown[]).filter((r): r is Loose => !!r && typeof r === 'object').map((r) => toRow(r, clip)),
    };
  }
  if (Array.isArray(input) && input.every((x) => x && typeof x === 'object' && !Array.isArray(x))) {
    const clip = uid();
    return { name: baseName, createdAt: Date.now(), rules: null, rows: (input as Loose[]).map((r) => toRow(r, clip)) };
  }
  throw new Error('This is not a Clipboard Extractor project file.');
}
