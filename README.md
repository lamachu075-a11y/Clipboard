# Clipboard Extractor

A Chrome / Edge / Brave extension (Manifest V3) that **automatically reads your clipboard**,
**extracts the data you care about**, and **collects it in a table**. A single copy can produce
**many rows**: every contact in a list, every line of a spreadsheet, every email in a paragraph.

## Features

- **Automatic clipboard watching.** Copy anything, in the browser or any other app, and new
  data appears in the table within about a second. Toggle it from the toolbar popup or the table page.
- **Built-in extractors:** Email, Phone, URL, Date, Amount/Currency, IP address, Hashtag.
- **`Key: Value` lines** (e.g. `Name: Jane Doe`, `Company = Acme`) become their own columns.
- **Custom fields:** add your own column with a regular expression, and optionally a capture group
  (e.g. `Order #(\d+)` with group `1`).
- **Required fields:** keep only rows that contain e.g. an Email.
- **Multiple rows from one clipboard:**
  - Spreadsheet copies (tab-separated) map 1:1 to rows, using the header row as column names.
  - Blank-line separated blocks, one record per line, or a custom delimiter.
  - Several matches inside one record become one row per match, or are joined into one cell.
- **Table:** live updates, sort by any column, filter, double-click a cell to edit, delete rows,
  rows from the same copy are grouped by shading.
- **Export:** CSV (opens in Excel), JSON, or *Copy* as tab-separated text to paste into Excel / Google Sheets.
- **Manual input:** paste text into the "Paste text manually" box to preview and add it.
- Duplicate rows are skipped (optional). Everything stays local in `chrome.storage`.

## Install (unpacked)

1. Open `chrome://extensions` (or `edge://extensions`).
2. Turn on **Developer mode**.
3. Click **Load unpacked** and select the `extension/` folder of this repo.
4. Pin **Clipboard Extractor** to the toolbar. Click it, then **Open table** (shortcut: `Alt+Shift+C` opens the popup).

Copy some text, for example:

```
Name: John Smith
Email: john@acme.com
Phone: +91 98765 43210

Name: Jane Doe
Email: jane@globex.io
Phone: 020 7946 0958
```

and two rows (Name, Email, Phone) appear in the table.

## How it works

```
 clipboard ──► offscreen.html (execCommand('paste'))
                    ▲  │ text
       poll every   │  ▼
       N ms    background.js (service worker)
                    │  only when text changed
                    ▼
            lib/extractor.js  ──►  rows  ──►  chrome.storage.local  ──►  table.html / popup.html
```

- `extension/lib/extractor.js`: the extraction engine (pure JS, no browser APIs, unit tested).
- `extension/lib/storage.js`: settings and row storage helpers.
- `extension/background.js`: polls the clipboard through the offscreen document and stores new rows.
- `extension/offscreen.*`: reads the system clipboard (MV3 service workers have no DOM).
- `extension/table.*`: the table, export and settings UI. `extension/popup.*`: toolbar popup.

### Permissions

| Permission | Why |
| --- | --- |
| `clipboardRead` | read clipboard text in the background |
| `clipboardWrite` | the table's *Copy* button |
| `offscreen` | a hidden document that performs the clipboard read |
| `storage`, `unlimitedStorage` | keep rows and settings locally |
| `alarms` | restart watching if the browser suspends the service worker |

No host permissions, no network access. Your data never leaves the browser.

## Development

```bash
npm test          # unit tests for the extractor (Node 18+)
npm run package   # zip the extension/ folder for the Chrome Web Store
```
