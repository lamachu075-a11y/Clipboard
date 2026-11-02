const Store = window.ClipStore;
const $ = (id) => document.getElementById(id);

function timeAgo(ts) {
  if (!ts) return 'never';
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 60) return s + 's ago';
  if (s < 3600) return Math.round(s / 60) + 'm ago';
  if (s < 86400) return Math.round(s / 3600) + 'h ago';
  return new Date(ts).toLocaleDateString();
}

async function render() {
  const [settings, rows, stats] = await Promise.all([Store.getSettings(), Store.getRows(), Store.getStats()]);
  $('enabled').checked = settings.enabled;
  $('enabledLabel').textContent = settings.enabled ? 'On' : 'Paused';
  $('rowCount').textContent = rows.length;
  $('lastCount').textContent = stats.lastCaptureCount ? '+' + stats.lastCaptureCount : '–';
  $('lastAt').textContent = 'last capture · ' + timeAgo(stats.lastCaptureAt);
  const recent = $('recent');
  recent.replaceChildren(
    ...rows
      .slice(-5)
      .reverse()
      .map((r) => {
        const div = document.createElement('div');
        const cols = Store.columnsOf(r);
        div.textContent = cols.map((c) => r.data[c]).join(' · ');
        div.title = cols.map((c) => c + ': ' + r.data[c]).join('\n');
        return div;
      })
  );
}

$('enabled').addEventListener('change', async (e) => {
  const settings = await Store.getSettings();
  settings.enabled = e.target.checked;
  await Store.saveSettings(settings);
});

$('open').addEventListener('click', async () => {
  const url = chrome.runtime.getURL('table.html');
  // getContexts finds our own tab without needing the "tabs" permission.
  const [ctx] = await chrome.runtime.getContexts({ contextTypes: ['TAB'], documentUrls: [url] });
  if (ctx) {
    await chrome.tabs.update(ctx.tabId, { active: true });
    await chrome.windows.update(ctx.windowId, { focused: true });
  } else {
    await chrome.tabs.create({ url });
  }
  window.close();
});

$('capture').addEventListener('click', async () => {
  $('msg').textContent = 'Reading clipboard…';
  const before = (await Store.getRows()).length;
  const res = await chrome.runtime.sendMessage({ target: 'background', type: 'capture-now' });
  const after = (await Store.getRows()).length;
  $('msg').textContent = !res?.ok
    ? 'Could not read clipboard: ' + (res?.error || 'unknown error')
    : after > before
      ? `Added ${after - before} row(s).`
      : 'Nothing new found in the clipboard.';
});

chrome.storage.onChanged.addListener(render);
render();
