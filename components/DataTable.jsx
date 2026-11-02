'use client';

import { useEffect, useRef, useState } from 'react';
import { columnsOf } from '../lib/store.js';
import { fmtTime } from '../lib/projectio.js';

function CellValue({ value }) {
  if (/^(https?:\/\/|www\.)\S+$/i.test(value)) {
    const href = /^www\./i.test(value) ? 'https://' + value : value;
    return (
      <a href={href} target="_blank" rel="noopener noreferrer">
        {value}
      </a>
    );
  }
  if (/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(value)) return <a href={'mailto:' + value}>{value}</a>;
  return value;
}

/**
 * The rows table. On phones the same markup is styled as cards (see app.css).
 * @param {{ rows, list, keepSource, sort, onSort, onEdit, onDelete, onExplain, highlightToken }} props
 *   rows: all rows (decides the columns); list: the visible, sorted rows;
 *   highlightToken: change it to highlight every row (e.g. after opening a project)
 */
export default function DataTable({ rows, list, keepSource, sort, onSort, onEdit, onDelete, onExplain, highlightToken }) {
  const cols = columnsOf(rows);
  const [editing, setEditing] = useState(null); // { id, col }
  // Rows not seen in the previous render get a short highlight.
  const known = useRef(null);
  const token = useRef(highlightToken);
  const [fresh, setFresh] = useState(() => new Set());
  useEffect(() => {
    const ids = rows.map((r) => r.id);
    if (known.current === null) known.current = new Set(ids);
    if (token.current !== highlightToken) {
      token.current = highlightToken;
      known.current = new Set();
    }
    const added = ids.filter((id) => !known.current.has(id));
    known.current = new Set(ids);
    if (added.length) {
      setFresh(new Set(added));
      const t = setTimeout(() => setFresh(new Set()), 2000);
      return () => clearTimeout(t);
    }
  }, [rows, highlightToken]);

  const th = (label, key, extra = '') => {
    if (!key) return <th className={('nosort ' + extra).trim()}>{label}</th>;
    return (
      <th data-sort={sort.col === key ? sort.dir : undefined} onClick={() => onSort(key)}>
        {label}
      </th>
    );
  };

  let lastClip = null;
  let alt = false;
  return (
    <table id="table">
      <thead>
        <tr>
          {th('#')}
          {th('Captured', '__time')}
          {cols.map((c) => (
            <th key={c} data-sort={sort.col === c ? sort.dir : undefined} onClick={() => onSort(c)}>
              {c}
            </th>
          ))}
          {keepSource ? th('Source text', null, 'source-col') : null}
          {th('')}
        </tr>
      </thead>
      <tbody>
        {list.map((r, i) => {
          if (r.clipId !== lastClip) (alt = !alt), (lastClip = r.clipId);
          return (
            <tr key={r.id} data-id={r.id} className={[alt ? 'alt' : '', fresh.has(r.id) ? 'fresh' : ''].join(' ').trim() || undefined}>
              <td className="meta num">{i + 1}</td>
              <td className="meta time">{fmtTime(r.capturedAt)}</td>
              {cols.map((c) => {
                const isEditing = editing && editing.id === r.id && editing.col === c;
                const value = r.data[c];
                if (isEditing) {
                  return (
                    <td key={c} className="cell editing" data-label={c}>
                      <input
                        autoFocus
                        defaultValue={value ?? ''}
                        aria-label={`Edit ${c}`}
                        onFocus={(e) => e.target.select()}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') e.currentTarget.blur();
                          if (e.key === 'Escape') {
                            e.currentTarget.dataset.cancel = '1';
                            e.currentTarget.blur();
                          }
                        }}
                        onBlur={(e) => {
                          if (!e.currentTarget.dataset.cancel) onEdit(r.id, c, e.currentTarget.value.trim());
                          setEditing(null);
                        }}
                      />
                    </td>
                  );
                }
                return (
                  <td
                    key={c}
                    className="cell"
                    data-label={c}
                    tabIndex={0}
                    title="Double-click to edit"
                    onDoubleClick={(e) => {
                      e.preventDefault();
                      setEditing({ id: r.id, col: c });
                    }}
                    onKeyDown={(e) => e.key === 'Enter' && setEditing({ id: r.id, col: c })}
                  >
                    {value != null ? <CellValue value={String(value)} /> : null}
                  </td>
                );
              })}
              {keepSource ? (
                <td className="source" data-label="Source" title={r.source || ''}>
                  {r.source || ''}
                </td>
              ) : null}
              <td className="actions">
                {r.source ? (
                  <button className="icon info" title="Explain how this row was extracted" aria-label="Explain extraction" onClick={() => onExplain(r.source)}>
                    ?
                  </button>
                ) : null}
                <button className="icon" title="Delete row" aria-label="Delete row" onClick={() => onDelete(r.id)}>
                  ✕
                </button>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
