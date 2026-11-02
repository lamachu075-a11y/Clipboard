# Clipboard Extractor

A web app that **reads your clipboard automatically**, **extracts the data you care about**,
and **collects it in a table**. One copy can produce **many rows**: every contact in a list,
every line of a spreadsheet, every email in a paragraph.

It's a static site (HTML, CSS and JavaScript, no build step, no server code), so you can open it
locally or host it on GitHub Pages. Everything stays in your browser (`localStorage`).

## Features

- **Automatic clipboard reading.** Copy text anywhere, switch back to the app's tab, and the new
  data is already in the table. While the tab is open and focused it also checks the clipboard every second.
- **Ctrl/⌘ + V anywhere on the page** adds whatever you paste. This works in every browser.
- **Built-in extractors:** Email, Phone, URL, Date, Amount/Currency, IP address, Hashtag.
- **`Key: Value` lines** (e.g. `Name: Jane Doe`, `Company = Acme`) become their own columns.
- **Custom fields:** your own column from a regular expression, with an optional capture group
  (e.g. `Order #(\d+)` with group `1`).
- **Required fields:** keep only rows that contain e.g. an Email.
- **Multiple rows from one clipboard:**
  - Spreadsheet copies (tab-separated) map 1:1 to rows, using the header row as column names.
  - Blank-line separated blocks, one record per line, or a custom delimiter.
  - Several matches in one record become one row per match, or are joined into one cell.
- **Table:** sort by any column, filter, double-click a cell to edit, delete rows. Rows from the
  same copy are shaded as a group. Open tabs stay in sync.
- **Download menu:**
  - **Table as CSV** (opens in Excel and Google Sheets) or **Table as JSON**.
  - **Project file:** all rows and settings in one `.json` file. Use **Open project** to load it again,
    on this or another computer. You can replace the current table or add to it. A *Table as JSON* download can be opened too.
  - **App source code (.zip):** the app's own files, ready to run or host anywhere.
- **Copy** puts the table on the clipboard as tab-separated text, ready to paste into Excel or Google Sheets.
- **Installable** as an app (PWA manifest): use "Install app" in Chrome or Edge, or "Add to Home Screen".

## Browser support for automatic reading

Browsers only let a web page read the clipboard **while its tab is focused**, and only on
`https://` or `http://localhost`.

| Browser | Behaviour |
| --- | --- |
| Chrome, Edge, Brave, Opera | Click **Allow clipboard access** once. After that, reading is automatic. |
| Firefox, Safari | They ask for confirmation on every read, so the app uses **Ctrl/⌘ + V** on the page instead. |

The status next to the title shows which mode is active.

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

## Try it

Copy this text, then click back into the app:

```
Name: John Smith
Email: john@acme.com
Phone: +91 98765 43210

Name: Jane Doe
Email: jane@globex.io
Phone: 020 7946 0958
```

Two rows (Name, Email, Phone) appear.

## Project layout

| Path | What it is |
| --- | --- |
| `index.html` | the app page |
| `js/extractor.js` | extraction engine (pure JS, no DOM, unit tested) |
| `js/store.js` | `localStorage` persistence, cross-tab change events |
| `js/app.js` | clipboard watcher, table, downloads, open project, settings |
| `js/zip.js` | small dependency-free ZIP writer used for "App source code" |
| `css/app.css` | styles (light and dark) |
| `test/` | `npm test`: unit tests for the extractor and ZIP writer (Node 18+) |
