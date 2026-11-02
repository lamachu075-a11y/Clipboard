/*
 * Offscreen document: the only place an MV3 extension can read the system
 * clipboard without a user gesture. With the "clipboardRead" permission,
 * execCommand('paste') into a textarea returns the current clipboard text.
 */
const buffer = document.getElementById('buffer');

function readClipboard() {
  buffer.value = '';
  buffer.focus();
  document.execCommand('paste');
  const text = buffer.value;
  buffer.value = '';
  return text;
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || msg.target !== 'offscreen') return;
  if (msg.type === 'read-clipboard') {
    let text = '';
    try {
      text = readClipboard();
    } catch (e) {
      /* clipboard unavailable */
    }
    sendResponse({ text });
  }
});
