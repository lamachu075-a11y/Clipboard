/* File helpers: downloads, saving to a file, picking a file (client-side only). */

export const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH || '';

export function download(name: string, type: string, content: BlobPart): void {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const stamp = (): string => new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');

/** A name that is safe to use as a file name. */
export const safeFileName = (name: string): string =>
  String(name || 'project')
    .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80) || 'project';

const JSON_TYPES = [{ description: 'Clipboard Extractor file', accept: { 'application/json': ['.json'] } }];

/* File System Access API (Chrome, Edge): not in TypeScript's DOM types yet. */
interface WritableFile {
  write(data: string): Promise<void>;
  close(): Promise<void>;
}
export interface FileHandle {
  name: string;
  createWritable(): Promise<WritableFile>;
  getFile(): Promise<File>;
}
type PickerTypes = { description: string; accept: Record<string, string[]> }[];
interface FilePickerWindow {
  showSaveFilePicker?: (opts: { suggestedName: string; types: PickerTypes }) => Promise<FileHandle>;
  showOpenFilePicker?: (opts: { types: PickerTypes; multiple: boolean }) => Promise<FileHandle[]>;
}
const pickers = (): FilePickerWindow => window as unknown as FilePickerWindow;

export interface SaveOptions {
  suggestedName: string;
  text: string;
  /** Overwrite this file instead of asking where to save. */
  handle?: FileHandle | null;
  type?: string;
}

/**
 * Save text to a file: the File System Access API where available (Chrome,
 * Edge), otherwise a download. Resolves to null if the user cancelled.
 */
export async function saveTextFile({ suggestedName, text, handle = null, type = 'application/json' }: SaveOptions): Promise<{ fileName: string; handle: FileHandle | null } | null> {
  const { showSaveFilePicker } = pickers();
  if (handle || typeof showSaveFilePicker === 'function') {
    try {
      if (!handle) handle = await showSaveFilePicker!({ suggestedName, types: JSON_TYPES });
      const writable = await handle.createWritable();
      await writable.write(text);
      await writable.close();
      return { fileName: handle.name, handle };
    } catch (e) {
      const name = e instanceof Error ? e.name : '';
      if (name === 'AbortError') return null;
      if (!handle || (name !== 'NotAllowedError' && name !== 'SecurityError')) throw e;
    }
  }
  download(suggestedName, type, text);
  return { fileName: suggestedName, handle: null };
}

/** Let the user pick a JSON file. Returns { name, text } or null if cancelled. */
export async function pickTextFile(): Promise<{ name: string; text: string } | null> {
  const { showOpenFilePicker } = pickers();
  if (typeof showOpenFilePicker === 'function') {
    try {
      const [handle] = await showOpenFilePicker({ types: JSON_TYPES, multiple: false });
      const file = await handle.getFile();
      return { name: file.name, text: await file.text() };
    } catch (e) {
      if (e instanceof Error && e.name === 'AbortError') return null;
    }
  }
  return new Promise<{ name: string; text: string } | null>((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.hidden = true;
    input.id = 'projectFile';
    document.body.append(input);
    input.addEventListener('change', async () => {
      const file = input.files?.[0];
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
