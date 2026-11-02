/*
 * Minimal PDF writer for tables (no dependencies). Works in browsers and Node.
 *
 *   const bytes = ClipPdf.table({ title, subtitle, columns: ['A', 'B'], rows: [['1', '2']] });
 *
 * Uses the built-in Helvetica fonts (WinAnsi encoding), so text is limited to
 * Latin characters; anything else is printed as "?". `unsupported(text)` lists
 * such characters so the UI can suggest the browser's Print → Save as PDF.
 */

// Helvetica glyph widths (1/1000 em) for ASCII 32–126.
const W = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278,
  556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556,
  1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778,
  667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556,
  333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556,
  556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584,
];

// Unicode -> WinAnsi (cp1252) for the 0x80–0x9F range.
const CP1252 = {
  0x20ac: 0x80, 0x201a: 0x82, 0x0192: 0x83, 0x201e: 0x84, 0x2026: 0x85, 0x2020: 0x86, 0x2021: 0x87,
  0x02c6: 0x88, 0x2030: 0x89, 0x0160: 0x8a, 0x2039: 0x8b, 0x0152: 0x8c, 0x017d: 0x8e, 0x2018: 0x91,
  0x2019: 0x92, 0x201c: 0x93, 0x201d: 0x94, 0x2022: 0x95, 0x2013: 0x96, 0x2014: 0x97, 0x02dc: 0x98,
  0x2122: 0x99, 0x0161: 0x9a, 0x203a: 0x9b, 0x0153: 0x9c, 0x017e: 0x9e, 0x0178: 0x9f,
};

/** WinAnsi byte for a character, or null if it can't be shown. */
function winAnsi(ch) {
  const c = ch.codePointAt(0);
  if (c === 9) return 32;
  if (c >= 32 && c <= 126) return c;
  if (c >= 0xa0 && c <= 0xff) return c;
  return CP1252[c] ?? null;
}

/** Characters in `text` that the PDF fonts can't display. */
function unsupported(text) {
  const out = new Set();
  for (const ch of String(text)) if (ch !== '\n' && ch !== '\r' && winAnsi(ch) === null) out.add(ch);
  return [...out];
}

function charWidth(ch, bold) {
  const b = winAnsi(ch);
  const w = b !== null && b >= 32 && b <= 126 ? W[b - 32] : 556;
  return bold ? w * 1.06 : w;
}

const textWidth = (s, size, bold) => {
  let w = 0;
  for (const ch of s) w += charWidth(ch, bold);
  return (w * size) / 1000;
};

/** PDF string literal (WinAnsi bytes, escaped). */
function pdfString(s) {
  let out = '(';
  for (const ch of s) {
    const b = winAnsi(ch) ?? 63; // "?"
    if (b === 40 || b === 41 || b === 92) out += '\\' + String.fromCharCode(b);
    else if (b < 32 || b > 126) out += '\\' + b.toString(8).padStart(3, '0');
    else out += String.fromCharCode(b);
  }
  return out + ')';
}

/** Cut text to fit `width`, adding an ellipsis. */
function truncate(s, width, size, bold) {
  if (textWidth(s, size, bold) <= width) return s;
  const ell = '…';
  let out = '';
  for (const ch of s) {
    if (textWidth(out + ch + ell, size, bold) > width) break;
    out += ch;
  }
  return out + ell;
}

/** Word-wrap text into at most `maxLines` lines of `width`. */
function wrap(text, width, size, bold, maxLines) {
  const lines = [];
  for (const para of String(text).replace(/\r/g, '').split('\n')) {
    let line = '';
    for (const word of para.split(/(\s+)/)) {
      if (!word) continue;
      const candidate = line + word;
      if (textWidth(candidate, size, bold) <= width) {
        line = candidate;
        continue;
      }
      if (line.trim()) lines.push(line.trimEnd());
      line = word.trimStart();
      // a single word longer than the column: break it
      while (textWidth(line, size, bold) > width) {
        let cut = '';
        for (const ch of line) {
          if (textWidth(cut + ch, size, bold) > width) break;
          cut += ch;
        }
        if (!cut) cut = line[0];
        lines.push(cut);
        line = line.slice(cut.length);
      }
    }
    lines.push(line.trimEnd());
  }
  while (lines.length > 1 && lines[lines.length - 1] === '') lines.pop();
  if (lines.length > maxLines) {
    const kept = lines.slice(0, maxLines);
    let last = kept[maxLines - 1];
    while (last && textWidth(last + '…', size, bold) > width) last = last.slice(0, -1);
    kept[maxLines - 1] = last + '…';
    return kept;
  }
  return lines;
}

const num = (n) => (Math.round(n * 100) / 100).toString();

/**
 * Build a PDF with a title and a table that flows over as many pages as needed.
 * @param {{title: string, subtitle?: string, columns: string[], rows: string[][], landscape?: boolean, footer?: string}} opts
 * @returns {Uint8Array}
 */
function table({ title, subtitle = '', columns, rows, landscape = true, footer = '' }) {
  const pageW = landscape ? 842 : 595;
  const pageH = landscape ? 595 : 842;
  const margin = 36;
  const size = 8.5;
  const headSize = 8.5;
  const lineH = size * 1.3;
  const padX = 4;
  const padY = 4;
  const maxLines = 6;
  const usable = pageW - margin * 2;

  // Column widths: natural width (capped), scaled to fill the page.
  const natural = columns.map((c, i) => {
    let w = textWidth(String(c), headSize, true);
    for (const r of rows.slice(0, 500)) w = Math.max(w, textWidth(String(r[i] ?? ''), size, false));
    return Math.min(Math.max(w + padX * 2, 30), 260);
  });
  const total = natural.reduce((a, b) => a + b, 0);
  let widths = natural.map((w) => (w / total) * usable);
  if (total < usable) widths = natural.map((w) => w + (usable - total) / natural.length);

  const pages = [];
  let ops = [];
  let y = 0;

  const text = (s, x, yy, bold, sz = size) => ops.push(`BT /${bold ? 'F2' : 'F1'} ${num(sz)} Tf ${num(x)} ${num(yy)} Td ${pdfString(s)} Tj ET`);
  const rect = (x, yy, w, h, gray) => ops.push(`${num(gray)} g ${num(x)} ${num(yy)} ${num(w)} ${num(h)} re f 0 g`);
  const line = (x1, y1, x2, y2) => ops.push(`0.82 G 0.5 w ${num(x1)} ${num(y1)} m ${num(x2)} ${num(y2)} l S`);

  function headerRow() {
    const cells = columns.map((c, i) => wrap(String(c), widths[i] - padX * 2, headSize, true, 2));
    const h = Math.max(...cells.map((l) => l.length)) * lineH + padY * 2;
    rect(margin, y - h, usable, h, 0.92);
    let x = margin;
    cells.forEach((lines, i) => {
      lines.forEach((l, j) => text(l, x + padX, y - padY - size - j * lineH + 1, true, headSize));
      x += widths[i];
    });
    line(margin, y - h, margin + usable, y - h);
    y -= h;
  }

  function newPage(first) {
    if (ops.length) pages.push(ops);
    ops = [];
    y = pageH - margin;
    if (first) {
      text(truncate(String(title), usable, 16, true), margin, y - 16, true, 16);
      y -= 22;
      if (subtitle) {
        ops.push('0.4 g');
        text(truncate(String(subtitle), usable, 9, false), margin, y - 10, false, 9);
        ops.push('0 g');
        y -= 18;
      }
      y -= 6;
    }
    headerRow();
  }

  newPage(true);
  if (!rows.length) text('No rows.', margin, y - 18, false, 10);
  rows.forEach((r, ri) => {
    const cells = columns.map((_, i) => wrap(String(r[i] ?? ''), widths[i] - padX * 2, size, false, maxLines));
    const h = Math.max(1, ...cells.map((l) => l.length)) * lineH + padY * 2;
    if (y - h < margin + 18) newPage(false);
    if (ri % 2 === 1) rect(margin, y - h, usable, h, 0.97);
    let x = margin;
    cells.forEach((lines, i) => {
      lines.forEach((l, j) => l && text(l, x + padX, y - padY - size - j * lineH + 1, false));
      x += widths[i];
    });
    line(margin, y - h, margin + usable, y - h);
    y -= h;
  });
  pages.push(ops);

  // Footer with page numbers.
  pages.forEach((p, i) => {
    const label = `${footer ? footer + '  ·  ' : ''}Page ${i + 1} of ${pages.length}`;
    p.push('0.45 g');
    p.push(`BT /F1 8 Tf ${num(pageW - margin - textWidth(label, 8, false))} ${num(margin - 16)} Td ${pdfString(label)} Tj ET`);
    p.push('0 g');
  });

  // Assemble objects.
  const objects = [];
  const add = (body) => objects.push(body) && objects.length;
  const catalog = add(null);
  const pagesObj = add(null);
  const f1 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  const f2 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
  const kids = [];
  for (const p of pages) {
    const stream = p.join('\n');
    const content = add(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
    kids.push(
      add(
        `<< /Type /Page /Parent ${pagesObj} 0 R /MediaBox [0 0 ${pageW} ${pageH}] ` +
          `/Resources << /Font << /F1 ${f1} 0 R /F2 ${f2} 0 R >> >> /Contents ${content} 0 R >>`
      )
    );
  }
  const info = add(`<< /Title ${pdfString(String(title))} /Producer (Clipboard Extractor) >>`);
  objects[catalog - 1] = `<< /Type /Catalog /Pages ${pagesObj} 0 R >>`;
  objects[pagesObj - 1] = `<< /Type /Pages /Kids [${kids.map((k) => k + ' 0 R').join(' ')}] /Count ${kids.length} >>`;

  let out = '%PDF-1.4\n%âãÏÓ\n';
  const offsets = [];
  objects.forEach((body, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const o of offsets) out += String(o).padStart(10, '0') + ' 00000 n \n';
  out += `trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R /Info ${info} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;

  const bytes = new Uint8Array(out.length);
  for (let i = 0; i < out.length; i++) bytes[i] = out.charCodeAt(i) & 0xff;
  return bytes;
}

const api = { table, unsupported, textWidth };

export { table, unsupported, textWidth };
export default api;
