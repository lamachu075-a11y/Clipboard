/*
 * Service worker: watches the clipboard and turns new clipboard text into
 * table rows.
 *
 * MV3 service workers have no DOM, so the clipboard is read by an offscreen
 * document (offscreen.html). The worker asks it for the current clipboard
 * text every `pollInterval` ms; when the text changes it is run through the
 * extractor and the resulting rows are stored.
 */
importScripts('lib/extractor.js', 'lib/storage.js');

const E = self.ClipExtractor;
const Store = self.ClipStore;
const OFFSCREEN_URL = 'offscreen.html';

let pollTimer = null;
let pollMs = 0;
let lastText = null;
let queue = Promise.resolve();

// ---------- offscreen document ----------

let creating = null;
async function ensureOffscreen() {
  const contexts = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT'],
    documentUrls: [chrome.runtime.getURL(OFFSCREEN_URL)],
  });
  if (contexts.length) return;
  if (!creating) {
    creating = chrome.offscreen
      .createDocument({
        url: OFFSCREEN_URL,
        reasons: ['CLIPBOARD'],
        justification: 'Read clipboard text to extract data into the table',
      })
      .catch((e) => {
        if (!String(e).includes('single offscreen')) throw e;
      })
      .finally(() => (creating = null));
  }
  await creating;
}

async function readClipboard() {
  await ensureOffscreen();
  const res = await chrome.runtime.sendMessage({ target: 'offscreen', type: 'read-clipboard' });
  return res && typeof res.text === 'string' ? res.text : '';
}

// ---------- processing ----------

/** Serialise all writes so concurrent captures don't clobber each other. */
function enqueue(fn) {
  queue = queue.then(fn).catch((e) => console.warn('[clipboard-extractor]', e));
  return queue;
}

async function processText(text, { force = false } = {}) {
  const settings = await Store.getSettings();
  if (!force && !settings.enabled) return [];
  const rows = E.extract(text, settings);
  const added = await Store.addRows(rows, {
    source: settings.keepSource ? text : '',
    dedupe: settings.dedupeRows,
  });
  if (added.length) flashBadge(added.length);
  return added;
}

async function poll() {
  let text;
  try {
    text = await readClipboard();
  } catch (e) {
    return; // offscreen doc not ready yet; try next tick
  }
  if (lastText === null) {
    const stored = await chrome.storage.local.get('lastText');
    lastText = stored.lastText ?? '';
  }
  if (!text || text === lastText) return;
  lastText = text;
  await chrome.storage.local.set({ lastText: text });
  await enqueue(() => processText(text));
}

// ---------- polling lifecycle ----------

async function sync() {
  const settings = await Store.getSettings();
  if (settings.enabled) {
    if (!pollTimer || pollMs !== settings.pollInterval) {
      clearInterval(pollTimer);
      pollMs = settings.pollInterval;
      // Each tick calls an extension API, which keeps the worker alive.
      pollTimer = setInterval(poll, pollMs);
      await ensureOffscreen();
      poll();
    }
  } else {
    clearInterval(pollTimer);
    pollTimer = null;
    pollMs = 0;
    if (await chrome.offscreen.hasDocument?.()) await chrome.offscreen.closeDocument();
  }
  await updateBadge(settings);
}

// ---------- badge ----------

let badgeTimer = null;
function flashBadge(n) {
  chrome.action.setBadgeBackgroundColor({ color: '#16a34a' });
  chrome.action.setBadgeText({ text: '+' + n });
  clearTimeout(badgeTimer);
  badgeTimer = setTimeout(() => Store.getSettings().then(updateBadge), 2500);
}

async function updateBadge(settings) {
  if (settings.enabled) {
    chrome.action.setBadgeText({ text: '' });
    chrome.action.setTitle({ title: 'Clipboard Extractor – watching clipboard' });
  } else {
    chrome.action.setBadgeBackgroundColor({ color: '#6b7280' });
    chrome.action.setBadgeText({ text: 'off' });
    chrome.action.setTitle({ title: 'Clipboard Extractor – paused' });
  }
}

// ---------- events ----------

chrome.runtime.onInstalled.addListener(async () => {
  const { settings } = await chrome.storage.local.get('settings');
  if (!settings) await Store.saveSettings(E.DEFAULT_SETTINGS);
  chrome.alarms.create('keepalive', { periodInMinutes: 1 });
  sync();
});

chrome.runtime.onStartup.addListener(sync);

// If Chrome ever stops the worker, the alarm wakes it and restarts polling.
chrome.alarms.onAlarm.addListener((a) => {
  if (a.name === 'keepalive') sync();
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (changes.settings) sync();
  // Extension pages may mark text as already seen (e.g. "Copy table").
  if (changes.lastText) lastText = changes.lastText.newValue ?? '';
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || msg.target !== 'background') return;
  if (msg.type === 'process-text') {
    // Manual input from the table page – always processed, even when paused.
    enqueue(() => processText(msg.text, { force: true })).then(() => sendResponse({ ok: true }));
    return true;
  }
  if (msg.type === 'capture-now') {
    readClipboard()
      .then((text) => enqueue(() => processText(text, { force: true })))
      .then(() => sendResponse({ ok: true }))
      .catch((e) => sendResponse({ ok: false, error: String(e) }));
    return true;
  }
});


sync();
