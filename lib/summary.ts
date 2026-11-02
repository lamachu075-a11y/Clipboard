/*
 * Group rows by a column (e.g. Platform) and total a numeric column (e.g. Credit).
 * Pure functions: used by the table, the PDF report and the tests.
 */
import { columnsOf } from './store.ts';
import type { Row } from './types.ts';

/** Column names that are grouped / totalled automatically when present. */
const AUTO_GROUP = ['platform'];
const AUTO_SUM = ['credit', 'amount', 'total'];

/**
 * The number in a value such as "5555", "5,555", "$1,250.50", "Rs. 300", "-12.5 %";
 * null if it is not a number.
 */
export function numericValue(value: unknown): number | null {
  if (value == null) return null;
  const s = String(value).trim();
  if (!s) return null;
  // Allow a currency symbol/code and spaces around one number.
  const m = /^[^\d+-]{0,4}?\s*([+-]?\d[\d,  ]*(?:\.\d+)?)\s*[^\d]{0,4}$/.exec(s);
  if (!m) return null;
  const n = Number(m[1].replace(/[,  ]/g, ''));
  return Number.isFinite(n) ? n : null;
}

/** Columns where (almost) every filled-in value is a number. */
export function numericColumns(rows: Row[]): string[] {
  return columnsOf(rows).filter((col) => {
    let filled = 0;
    let numbers = 0;
    for (const r of rows) {
      const v = r.data[col];
      if (v == null || v === '') continue;
      filled++;
      if (numericValue(v) !== null) numbers++;
    }
    return filled > 0 && numbers / filled >= 0.8;
  });
}

const findColumn = (cols: string[], wanted: string[]): string => cols.find((c) => wanted.includes(c.toLowerCase())) || '';

/** The column to group by: the chosen one if it exists, a "Platform" column for 'auto', or ''. */
export function resolveGroupBy(rows: Row[], choice: string): string {
  const cols = columnsOf(rows);
  if (choice === 'auto') return findColumn(cols, AUTO_GROUP);
  return cols.find((c) => c.toLowerCase() === choice.toLowerCase()) || '';
}

/** The column to total: the chosen one if numeric, "Credit"/"Amount"/"Total" for 'auto', or ''. */
export function resolveSumBy(rows: Row[], choice: string): string {
  const nums = numericColumns(rows);
  if (choice === 'auto') return findColumn(nums, AUTO_SUM);
  return nums.find((c) => c.toLowerCase() === choice.toLowerCase()) || '';
}

export interface Group {
  /** The group's value of the group-by column ('' when missing). */
  key: string;
  label: string;
  rows: Row[];
  total: number;
}

export interface Summary {
  groupBy: string;
  sumBy: string;
  groups: Group[];
  total: number;
  count: number;
}

export const NO_VALUE = '(no value)';

/** Sum of a column over rows (non-numbers count as 0). */
export function sumOf(rows: Row[], col: string): number {
  let t = 0;
  for (const r of rows) t += numericValue(r.data[col]) ?? 0;
  return Math.round(t * 100) / 100;
}

/**
 * Split rows into groups by `groupBy` (keeping their order inside each group),
 * groups sorted by name; with totals of `sumBy`.
 */
export function summarize(rows: Row[], groupBy: string, sumBy: string): Summary {
  const groups = new Map<string, Group>();
  if (groupBy) {
    for (const r of rows) {
      const raw = String(r.data[groupBy] ?? '').trim();
      const id = raw.toLowerCase();
      let g = groups.get(id);
      if (!g) groups.set(id, (g = { key: raw, label: raw || NO_VALUE, rows: [], total: 0 }));
      g.rows.push(r);
    }
  }
  const list = [...groups.values()].sort((a, b) => {
    if (!a.key !== !b.key) return a.key ? -1 : 1; // "(no value)" last
    return a.label.localeCompare(b.label, undefined, { numeric: true, sensitivity: 'base' });
  });
  for (const g of list) g.total = sumBy ? sumOf(g.rows, sumBy) : 0;
  return { groupBy, sumBy, groups: list, total: sumBy ? sumOf(rows, sumBy) : 0, count: rows.length };
}

/** A total for display: thousands separators, up to 2 decimals. */
export const formatNumber = (n: number): string => n.toLocaleString('en-US', { maximumFractionDigits: 2 });
