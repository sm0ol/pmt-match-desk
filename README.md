# PMT Match Desk

A free, local-first thread creator for the r/GlobalOffensive Post-Match Team. It turns a normal `Ctrl+A` → `Ctrl+C` capture from HLTV into the familiar PMT title and Markdown body without scraping HLTV from a server.

## The fast workflow

1. Open the finished match on HLTV.
2. Press `Ctrl+A`, then `Ctrl+C`.
3. Paste into Match Desk.
4. Resolve any highlighted issue, then copy the Reddit title and body separately.

The real completed-match regression fixture becomes copy-ready in roughly 0.2 seconds in automated Chromium runs. The executable timing protocol is part of the end-to-end test suite.

## What the MVP does

- Reads both plain-text and rich HTML clipboard data from an explicit paste.
- Parses current HLTV main-match and map-stat pages without making a request to HLTV.
- Shows a rendered preview of the post title and Markdown body in the established PMT structure.
- Keeps new snapshots in an import history with added, changed, and retained-value summaries.
- Prevents a different match from silently overwriting the active draft.
- Preserves human corrections across later imports; team, event, stage, context, map, and player-stat values are directly editable.
- Reverts or restores individual source snapshots.
- Autosaves complete drafts in IndexedDB and restores them after reload.
- Exports and imports a validated recovery bundle, with explicit raw-data disclosure.
- Runs entirely in the browser: no account, analytics, telemetry, backend, or runtime fetch.

When HLTV changes a layout, the importer fails conservatively and leaves the last good draft alone. The checked-in capture fixtures make parser drift reproducible.

## Run it locally

Requirements: a current Node.js release and a modern Chromium browser.

```bash
npm install
npm run dev
```

Open the local URL Vite prints. For a production-static build:

```bash
npm run build
```

Serve the generated `dist/` directory from any static host. Public hosting is intentionally outside this local MVP.

## Validate it

Install Playwright’s pinned browser once:

```bash
npx playwright install chromium
npm run validate
```

`validate` runs lint, strict TypeScript, unit/component tests, the production build, and real Chromium flows for paste, clipboard copy, local persistence, bundle recovery, updates and conflicts, wrong-match protection, hostile input, narrow layouts, and the timing protocol.

## Privacy and recovery

Pasted source data and drafts stay in the browser origin’s local storage. Copy actions write only the selected PMT output to the clipboard. Exported `.pmt.json` bundles intentionally contain the full import history and raw clipboard payloads; the UI discloses this before download. Treat those files as source records and share them only with people you trust.

“Clear this draft” removes the selected local draft, its snapshots, edits, and history. It does not remove other drafts.

## Current boundary

This is the human-assisted MVP. It does not monitor HLTV, sign into Reddit, submit posts, coordinate volunteers, or bypass bot protection. A Chrome extension can later remove the select/copy gesture while feeding the same parser and draft model.

The corpus currently includes a real completed BO3 main-page capture and a real protected map-stat capture, plus deterministic layout, sparse, update, hostile-input, and series-shape variants. More real tournament captures should be added as the community encounters them.
