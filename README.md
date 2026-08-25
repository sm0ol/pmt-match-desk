# PMT Match Desk

A free, local-first thread creator for the r/GlobalOffensive Post-Match Team. It turns a normal `Ctrl+A` → `Ctrl+C` capture from HLTV into the familiar PMT title and Markdown body without scraping HLTV from a server.

## The fast workflow

1. Open the finished match on HLTV.
2. Press `Ctrl+A`, then `Ctrl+C`.
3. Paste into Match Desk.
4. Resolve any highlighted issue, then copy the Reddit title and body separately.

The match page carries everything except the per-map player tables — current
HLTV pages load those on demand, so they are not part of the copy. To fill the
MAP sections: click **Get stats** next to a map (it opens that map's HLTV stats
page), press `Ctrl+A`, `Ctrl+C`, and paste into the same draft. Maps with
loaded tables show **✓ stats**.

A live match page works too: paste it to prepare the draft early, then paste
the final page after the match to replace live numbers with final ones.

## The one-click workflow (browser extension)

The `extension/` directory contains an unpacked Chrome extension that removes
the copy gesture: on an HLTV match page, one click captures the page and each
finished map's stats page, then feeds them all into Match Desk as one draft.
See [extension/README.md](extension/README.md) for install steps.

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

## Event and team reference data

The Event Information and Team Information sections come from two sources:

1. **Our own databases, built from Liquipedia.** Humans only enter URLs:
   `npm run add-event -- https://liquipedia.net/counterstrike/<event-page>`
   and `npm run add-team -- https://liquipedia.net/counterstrike/<team-page>`
   add pages to `data/event-sources.json` / `data/team-sources.json` and
   fetch them through the Liquipedia API, within their API terms of use.
   Events carry name, location, prize pool, LAN/Online, and official streams.
   Teams carry the active roster with flags, the IGL mark, loan/trial notes,
   coach, benched players, and profile links; the AWPer mark and the HLTV
   team link are filled in from each match's own page at render time.
   `npm run refresh-events` / `npm run refresh-teams` re-fetch everything
   listed. Pass an HLTV name as a second argument when HLTV names the event
   or team differently than Liquipedia.
2. **The Post-Match Team's live Google Sheets** (the same sheets the PMT
   lead edits — display names, logo codes, rosters, links). `npm run
   refresh-data` pulls them directly, falling back to the CSV snapshot in
   [Post-Match-Thread-Creator](https://github.com/asbmeyers/Post-Match-Thread-Creator)
   when the sheets are unreachable. Edits made in the sheets flow in on the
   next refresh with no npm work on the editor's side.

Our own source lists can also live in a Google Sheet: publish a tab to the
web as CSV and paste its URL into `data/sources-config.json` (see the column
notes there). Sheet rows merge over the local JSON lists, so team members
manage sources — including display-name overrides — in the sheet.

Our Liquipedia entries win on name collisions. A GitHub Actions cron
(`.github/workflows/refresh-events.yml`) refreshes everything daily and
commits changes; redeploy to publish them (connect the repo to Railway for
automatic deploys). A match whose event or team is in neither source simply
renders without that block; team rosters fall back to the players parsed
from the match page.

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
