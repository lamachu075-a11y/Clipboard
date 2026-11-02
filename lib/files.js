/* File helpers: downloads, saving to a file, picking a file (client-side only). */

export const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH || '';

export function download(name, type, content) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const stamp = () => new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');

/** A name that is safe to use as a file name. */
export const safeFileName = (name) =>
  String(name || 'project')
    .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80) || 'project';

const JSON_TYPES = [{ description: 'Clipboard Extractor file', accept: { 'application/json': ['.json'] } }];

/**
 * Save text to a file: the File System Access API where available (Chrome,
 * Edge), otherwise a download.
 * @returns {Promise<{fileName: string, handle: FileSystemFileHandle|null}|null>} null if cancelled
 */
export async function saveTextFile({ suggestedName, text, handle = null, type = 'application/json' }) {
  if (handle || typeof window.showSaveFilePicker === 'function') {
    try {
      if (!handle) handle = await window.showSaveFilePicker({ suggestedName, types: JSON_TYPES });
      const writable = await handle.createWritable();
      await writable.write(text);
      await writable.close();
      return { fileName: handle.name, handle };
    } catch (e) {
      if (e && e.name === 'AbortError') return null;
      if (!handle || (e && e.name !== 'NotAllowedError' && e.name !== 'SecurityError')) throw e;
    }
  }
  download(suggestedName, type, text);
  return { fileName: suggestedName, handle: null };
}

/** Let the user pick a JSON file. Returns { name, text } or null if cancelled. */
export async function pickTextFile() {
  if (typeof window.showOpenFilePicker === 'function') {
    try {
      const [handle] = await window.showOpenFilePicker({ types: JSON_TYPES, multiple: false });
      const file = await handle.getFile();
      return { name: file.name, text: await file.text() };
    } catch (e) {
      if (e && e.name === 'AbortError') return null;
    }
  }
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.hidden = true;
    input.id = 'projectFile';
    document.body.append(input);
    input.addEventListener('change', async () => {
      const file = input.files[0];
      input.remove();
      resolve(file ? { name: file.name, text: await file.text() } : null);
    });
    input.addEventListener('cancel', () => {
      input.remove();
      resolve(null);
    });
    input.click();
  });
}
