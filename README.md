# Clipboard Extractor

A web app that **reads your clipboard automatically**, **extracts the data you care about**,
and **collects it in a table**. One copy can produce **many rows**: every contact in a list,
every line of a spreadsheet, every email in a paragraph.

It's a static site (HTML, CSS and JavaScript, no build step, no server code), so you can open it
locally or host it on GitHub Pages. Everything stays in your browser.

## Features

### Capture and extract
- **Auto-read clipboard switch (ON/OFF)** at the top of the page and in the admin panel. When ON,
  new clipboard text is read automatically; when OFF, nothing is read until you press Ctrl/⌘+V or
  click *Read clipboard*. Turning it ON in Chrome/Edge asks for clipboard permission right away.
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
- **Regex templates:** *Add from template* opens a library of 26 ready-made patterns in 7 groups
  (fill-in, IDs & codes, numbers & money, date & time, web & social, addresses, Indian business IDs).
  Fill-in templates such as *Text after a label* or *Text between two markers* take your own label.
  Each template shows its regex and a live, highlighted example of what it extracts.
- A **regex quick reference** explains the common regex symbols.
- Rules are **saved automatically** in the browser and used by the table immediately.
- **Test & explain** shows, step by step, how a text is extracted:
  1. how it is split into records, and why;
  2. which part of the text each rule matched (colour-highlighted), and what was skipped or rejected and why;
  3. the rows that come out.
- Each rule shows how many values it finds in the test text.
- **Export / import rules** as a file, or reset everything to the defaults.
- The **?** button on any table row opens that row's original text in *Test & explain*.

### Projects
- Give the project a name (top left). The label next to it shows **● Unsaved** or **✓ Saved**.
- **Save project** (Ctrl/⌘ + S) stores the project (all rows plus the rules used) in the **Projects** list,
  inside the browser. No file dialog is needed.
- **After a project is saved, the next clipboard extraction automatically starts a new project**, so a
  saved project is never changed by new data. To add more to the saved project, click
  *Keep adding to this project instead* in the green banner.
- **Projects** lists every saved project. For each one you can **Open**, download it as a **PDF**, **CSV**
  or project **File** (`.json`), or delete it. *Open from file…* adds a downloaded project file back to the list.
- **New project** starts an empty table with the same rules. Unsaved work is saved to Projects first,
  so switching projects never loses data.

### Table and downloads
- Sort, filter, double-click a cell to edit, delete rows. Rows from the same copy are shaded as a group.
- **Download** menu:
  - **Table as PDF**: a PDF file, landscape, with the project name, page numbers and a header row repeated on every page.
  - **Table as CSV** (Excel) or **JSON**.
  - **Project file (.json)**: the whole project in one file, for backups or another computer.
  - **Print / Save as PDF**: the browser's print dialog, with a clean print layout.
  - **App source code (.zip)**.
- **Copy** puts the table on the clipboard as tab-separated text for Excel / Google Sheets.

> The built-in PDF uses the standard PDF fonts, which cover Latin-script languages (English, Spanish,
> French, German, …). For other scripts such as Chinese, Arabic or Hindi, the app shows a hint to use
> *Print / Save as PDF*, which supports every language.

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
| `js/store.js` | browser storage: current project (`localStorage`), saved Projects (IndexedDB), cross-tab change events |
| `js/ui.js` | shared helpers: toasts, downloads, saving and opening files |
| `js/zip.js` | small dependency-free ZIP writer used for "App source code" |
| `js/templates.js` | regex template library and quick reference for the admin panel |
| `js/pdf.js` | small dependency-free PDF writer used for "Table as PDF" |
| `css/app.css` | styles (light and dark) |
| `test/` | `npm test`: unit tests (Node 18+) |
