/* Small DOM and file helpers shared by the app page and the admin panel. */
(function (global) {
  'use strict';

  const $ = (id) => document.getElementById(id);

  const el = (tag, props = {}, children = []) => {
    const n = Object.assign(document.createElement(tag), props);
    n.append(...children);
    return n;
  };

  function toast(msg) {
    const t = $('toast');
    if (!t) return;
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => t.classList.remove('show'), 2600);
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

  /** A name that is safe to use as a file name. */
  const safeFileName = (name) =>
    String(name || 'project')
      .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 80) || 'project';

  const JSON_TYPES = [{ description: 'Clipboard Extractor file', accept: { 'application/json': ['.json'] } }];

  /**
   * Save text to a file. Uses the File System Access API when available
   * (Chrome, Edge) so later saves can overwrite the same file; otherwise
   * downloads it.
   * @returns {Promise<{fileName: string, handle: FileSystemFileHandle|null}|null>} null if cancelled
   */
  async function saveTextFile({ suggestedName, text, handle = null, type = 'application/json' }) {
    if (handle || typeof global.showSaveFilePicker === 'function') {
      try {
        if (!handle) handle = await global.showSaveFilePicker({ suggestedName, types: JSON_TYPES });
        const writable = await handle.createWritable();
        await writable.write(text);
        await writable.close();
        return { fileName: handle.name, handle };
      } catch (e) {
        if (e && e.name === 'AbortError') return null;
        if (!handle || (e && e.name !== 'NotAllowedError' && e.name !== 'SecurityError')) throw e;
        // Permission to the old file was revoked: fall through to a download.
      }
    }
    download(suggestedName, type, text);
    return { fileName: suggestedName, handle: null };
  }

  /**
   * Let the user pick a file. Returns { name, text, handle } or null if cancelled.
   * @param {HTMLInputElement} input fallback <input type=file>
   */
  async function pickTextFile(input) {
    if (typeof global.showOpenFilePicker === 'function') {
      try {
        const [handle] = await global.showOpenFilePicker({ types: JSON_TYPES, multiple: false });
        const file = await handle.getFile();
        return { name: file.name, text: await file.text(), handle };
      } catch (e) {
        if (e && e.name === 'AbortError') return null;
        // otherwise fall back to the plain file input
      }
    }
    return new Promise((resolve) => {
      const done = async () => {
        input.removeEventListener('change', done);
        input.removeEventListener('cancel', cancel);
        const file = input.files[0];
        input.value = '';
        resolve(file ? { name: file.name, text: await file.text(), handle: null } : null);
      };
      const cancel = () => {
        input.removeEventListener('change', done);
        resolve(null);
      };
      input.addEventListener('change', done);
      input.addEventListener('cancel', cancel, { once: true });
      input.click();
    });
  }

  global.UI = { $, el, toast, download, stamp, safeFileName, saveTextFile, pickTextFile };
})(typeof globalThis !== 'undefined' ? globalThis : this);
