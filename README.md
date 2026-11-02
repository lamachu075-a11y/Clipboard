# Clipboard Extractor

A web app that **reads your clipboard automatically**, **extracts the data you care about**,
and **collects it in a table**. One copy can produce **many rows**: every contact in a list,
every line of a spreadsheet, every email in a paragraph.

It's a static site (HTML, CSS and JavaScript, no build step, no server code), so you can open it
locally or host it on GitHub Pages. Everything stays in your browser.

## Features

### Capture and extract
- **Automatic clipboard reading.** Copy text anywhere, switch back to the app's tab, and the new
  data is already in the table. While the tab is focused it also checks the clipboard every second.
- **Ctrl/⌘ + V anywhere on the page** adds whatever you paste. This works in every browser.
- **Built-in rules:** Email, Phone, URL, Date, Amount/Currency, IP address, Hashtag, and
  `Key: Value` lines (e.g. `Name: Jane Doe` becomes a *Name* column).
- **Custom rules:** any regular expression becomes a column.
- **Multiple rows from one clipboard:** spreadsheet copies, blank-line separated blocks, one record
  per line, or a custom delimiter. Several values in one record become one row each, or one joined cell.

### Admin panel (`admin.html`)
- Every extraction rule in one place, **with its regular expression**. Built-in patterns can be
  edited, renamed or reset. Custom rules can be added, re-ordered and deleted. Any rule can be marked *required*.
- Rules are **saved automatically** in the browser and used by the table immediately.
- **Test & explain** shows, step by step, how a text is extracted:
  1. how it is split into records, and why;
  2. which part of the text each rule matched (colour-highlighted), and what was skipped or rejected and why;
  3. the rows that come out.
- Each rule shows how many values it finds in the test text.
- **Export / import rules** as a file, or reset everything to the defaults.
- The **?** button on any table row opens that row's original text in *Test & explain*.

### Projects
- Give the project a name (top left). The label next to it shows whether there are unsaved changes.
- **Save** (Ctrl/⌘ + S) writes the whole project (all rows plus the rules used) into **one `.json` file**.
  In Chrome and Edge you pick the file once and later saves update that same file. Other browsers download the file instead.
- **New project** starts an empty table with the same rules. If the current project has unsaved
  changes, it offers to save it first.
- **Open** loads a saved project. If the file was made with different rules, you choose whether to use them.

### Table and downloads
- Sort, filter, double-click a cell to edit, delete rows. Rows from the same copy are shaded as a group.
- **Download** menu: table as CSV (Excel) or JSON, *Save as…*, or the **app source code (.zip)**.
- **Copy** puts the table on the clipboard as tab-separated text for Excel / Google Sheets.

## Browser support for automatic reading

Browsers only let a web page read the clipboard **while its tab is focused**, and only on
`https://` or `http://localhost`.

| Browser | Behaviour |
| --- | --- |
| Chrome, Edge, Brave, Opera | Click **Allow clipboard access** once. After that, reading is automatic. |
| Firefox, Safari | They ask for confirmation on every read, so the app uses **Ctrl/⌘ + V** on the page instead. |

## Run it

```bash
npm start            # serves the app at http://localhost:8080 (needs Python 3)
# or any static server, e.g.: npx serve .
```

You can also open `index.html` directly. Ctrl/⌘ + V always works that way, but automatic
reading is only guaranteed on `localhost` or `https`.

### Host on GitHub Pages

The workflow in `.github/workflows/pages.yml` tests and deploys the site on every push to `main`.
Turn it on once under **Settings → Pages → Build and deployment → Source: GitHub Actions**.

## Project file format

```json
{
  "app": "clipboard-extractor",
  "type": "project",
  "version": 2,
  "name": "Leads October",
  "createdAt": "2026-11-02T06:00:00.000Z",
  "savedAt": "2026-11-02T07:30:00.000Z",
  "rules": { "splitMode": "auto", "fields": { "...": "..." }, "customFields": [] },
  "rows": [{ "id": "…", "capturedAt": 1793600000000, "data": { "Name": "John", "Email": "john@acme.com" }, "cols": ["Name", "Email"], "source": "…" }]
}
```

## Project layout

| Path | What it is |
| --- | --- |
| `index.html`, `js/app.js` | the table page: clipboard watcher, projects, downloads |
| `admin.html`, `js/admin.js` | the admin panel: rules editor, test & explain |
| `js/extractor.js` | extraction engine with `extract()` and `explain()` (pure JS, no DOM, unit tested) |
| `js/store.js` | browser storage (`localStorage`), cross-tab change events |
| `js/ui.js` | shared helpers: toasts, downloads, saving and opening files |
| `js/zip.js` | small dependency-free ZIP writer used for "App source code" |
| `css/app.css` | styles (light and dark) |
| `test/` | `npm test`: unit tests (Node 18+) |
