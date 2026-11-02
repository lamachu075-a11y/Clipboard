# Clipboard Extractor

A web app that **reads your clipboard automatically**, **extracts the data you care about**,
and **collects it in a table**. One copy can produce **many rows**: every contact in a list,
every line of a spreadsheet, every email in a paragraph.

Built with **Next.js 16** (App Router), **React 19** and **TypeScript** (strict mode). It is exported as a static site (no server
code), so it can be hosted anywhere, e.g. on GitHub Pages. Everything stays in your browser.

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

### Admin panel (`/admin`)
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
  - **App source code (.zip)**: this Next.js project, packed at build time.
- **Copy** puts the table on the clipboard as tab-separated text for Excel / Google Sheets.

> The built-in PDF uses the standard PDF fonts, which cover Latin-script languages (English, Spanish,
> French, German, …). For other scripts such as Chinese, Arabic or Hindi, the app shows a hint to use
> *Print / Save as PDF*, which supports every language.

### Phone layout
On screens up to 700px wide the app switches to a phone layout:
- a **bottom bar** with a big **Paste** button (reads the clipboard in one tap; if the browser doesn't
  allow it, it opens a box to long-press and paste into), plus **Projects**, **Save** and **More**;
- **More** opens a bottom sheet with New project, downloads (PDF, CSV, project file), Print, Copy, Clear and the Admin panel;
- rows are shown as **cards** (label: value) instead of a wide table;
- dialogs open as **bottom sheets**, and hints say "tap Paste" instead of "press Ctrl+V";
- the admin panel gets **Rules / Test & explain / Settings** tabs.

Add it to the home screen (browser menu → *Add to Home Screen* / *Install app*) to use it like an app.

## Browser support for automatic reading

Browsers only let a web page read the clipboard **while its tab is focused**, and only on
`https://` or `http://localhost`.

| Browser | Behaviour |
| --- | --- |
| Chrome, Edge, Brave, Opera | Click **Allow clipboard access** once. After that, reading is automatic. |
| Firefox, Safari | They ask for confirmation on every read, so the app uses **Ctrl/⌘ + V** on the page instead. |

## Run it

Needs Node.js 22.18 or newer (it runs the TypeScript tests and scripts directly).

```bash
npm install
npm run dev      # development server with hot reload: http://localhost:3000
npm run typecheck  # TypeScript check (strict)
npm test         # unit tests for the extraction engine, templates, PDF and ZIP writers
npm run build    # static export to ./out
npm start        # serve ./out at http://localhost:8080
```

Automatic clipboard reading needs `localhost` or `https`; Ctrl/⌘ + V and the Paste button work everywhere.

To serve the app from a sub-path, build with `BASE_PATH`, e.g. `BASE_PATH=/Clipboard npm run build`.

### Host on your own server (subdomain)

`deploy/setup-subdomain.sh` sets the app up on a subdomain of a server that already runs other
sites with Nginx, including HTTPS, without touching them. Step-by-step guide: [deploy/README.md](deploy/README.md).

```bash
npm ci && npm run build
sudo bash deploy/setup-subdomain.sh clip.example.com you@example.com --files out
```

### Host on GitHub Pages

The workflow in `.github/workflows/pages.yml` runs the type check and tests, builds the static site (with the right
base path for your repository) and deploys it on every push to `main`.
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
| `app/layout.tsx` | root layout: page metadata, manifest, global styles |
| `app/page.tsx` | `/`: the table page |
| `app/admin/page.tsx` | `/admin`: the admin panel |
| `app/globals.css` | styles (light and dark, desktop and phone layouts) |
| `components/TableApp.tsx` | table page: clipboard watcher, auto-read switch, projects, downloads, phone bar |
| `components/DataTable.tsx` | the rows table (cards on phones), sorting and inline editing |
| `components/AdminApp.tsx` | admin panel: rules editor, regex templates, test & explain, settings |
| `components/common.tsx` | toast, modal dialog, store-sync and touch hooks |
| `lib/types.ts` | shared types: settings, rules, rows, projects, extraction trace |
| `lib/extractor.ts` | extraction engine with `extract()` and `explain()` (pure, unit tested) |
| `lib/templates.ts` | regex template library and quick reference |
| `lib/store.ts` | browser storage: current project (`localStorage`), saved Projects (IndexedDB), cross-tab sync |
| `lib/projectio.ts` | project files and CSV / JSON / PDF exports |
| `lib/files.ts` | downloads, saving and opening files |
| `lib/pdf.ts`, `lib/zip.ts` | small dependency-free PDF and ZIP writers |
| `public/` | icons and the web app manifest |
| `scripts/` | build helpers: pack the source zip, serve the static build |
| `test/` | `npm test`: unit tests |

The code uses only TypeScript syntax that can be erased (`erasableSyntaxOnly`), and imports use `.ts`
extensions, so Node runs the tests and scripts directly while Next.js builds the app.
