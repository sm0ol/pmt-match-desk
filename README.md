# PMT Match Desk

A free, local-first thread creator for the r/GlobalOffensive Post-Match Team.
It turns an HLTV match page into the PMT title and Markdown body. It does not
scrape HLTV from a server.

Live desk: https://pmt-production-4bee.up.railway.app

## Quick start for a new member

1. Install the browser extension. See [extension/README.md](extension/README.md).
2. Open a match page on HLTV.
3. Click the extension button. The desk opens with a complete draft.
4. Check the preview. Fix any item listed under "Fix before copying".
5. Set the subreddit field. Click **Post on Reddit**.
6. Check the prefilled submit form. Click submit.

If you do not have the extension: press `Ctrl+A`, then `Ctrl+C` on the HLTV
page, and paste into the desk. The result is the same.

## The thread lifecycle

**Before the match ends.** Capture the live match page. The desk builds the
draft early: teams, flags, event, stage, vetoes, finished maps, and running
stats. The action bar shows "Match is live". You can post early — the title
is already final, because the title contains only the teams, the event, and
the stage.

**When the match ends.** Capture the final match page into the same draft.
Final numbers replace the live numbers. Your manual edits stay.

**Per-map player stats.** Current HLTV match pages do not include the per-map
player tables. The extension opens each map's stats page and captures it for
you. Without the extension, click **Get stats** next to a map, copy that
page, and paste it into the same draft. A map with loaded tables shows
**✓ stats**.

**Editing.** All core fields are editable in the desk: teams, scores, event,
stage, context, maps, and player stats. Edit here, not in Reddit's editor.
Your edits survive later captures. If a newer capture disagrees with your
edit, the desk shows a conflict and asks you to choose.

**Posting.** **Post on Reddit** opens the old-Reddit submit page with the
title prefilled. The body arrives three ways, in this order:

1. The extension fills the body into the form.
2. If the body is small enough for the URL, it arrives prefilled.
3. The body is always copied to your clipboard as a fallback — paste it if
   the form is empty.

Reddit titles cannot be edited after posting. Bodies can. To update a posted
thread: capture the newest page into the draft, click **Copy body**, and
paste over the body on Reddit.

## How the desk merges captures

Each capture becomes an import in the draft's history. The rules:

- A completed page beats a live page.
- A map-stats page owns that map's detail; the match page owns the rest.
- Your manual edits beat every import. A disagreement becomes a conflict
  prompt, never a silent overwrite.
- A capture for a different match never overwrites the active draft. A paste
  asks; an extension capture switches to or creates that match's draft.
- You can revert or restore any import in the history.

## Where names and information come from

The post is built from the match page first. The reference database only
adds to it. **A missing database entry never blocks a post** — the section
renders from the match page alone, or is omitted.

When a team or event is in the database, this precedence applies:

1. **Our Liquipedia database** (`data/team-sources.json`,
   `data/event-sources.json`). Entries here win.
2. **The Post-Match Team's live Google Sheets** — the same sheets the PMT
   lead edits. These fill everything our database does not cover, and they
   supply the subreddit logo codes.
3. **The match page itself** — the fallback for everything.

What each source contributes:

- **Display names.** The database name replaces the HLTV name everywhere,
  title included. This protects against Reddit auto-removal of gambling org
  names: BetBoom posts as "BB Team", BC.Game as "BC".
- **Logo codes.** `[🇷🇺](#betboom-logo)` renders the team logo on
  r/GlobalOffensive and degrades to the flag everywhere else.
- **Rosters.** From Liquipedia: players with flags, the IGL mark, loan and
  trial notes, coach, and benched players. The AWPer mark and the HLTV team
  link come from the match page at render time, because Liquipedia does not
  track them.
- **Events.** Name, location flag, prize pool, LAN or Online, and official
  stream links.

## How to keep teams and events updated

**Before a tournament**, add its event and its teams once:

```bash
npm run add-event -- https://liquipedia.net/counterstrike/BLAST/Open/2026/Fall
npm run add-team  -- https://liquipedia.net/counterstrike/FURIA_Esports
```

- If HLTV uses a different name, pass it as a second argument.
- To override the display name (for example a gambling org), add
  `--name <display-name>`.
- Entries are plain JSON in `data/` and can be edited by hand.

**Or manage sources in a Google Sheet.** Publish a sheet tab to the web as
CSV and paste its URL into `data/sources-config.json` (column names are
documented there). Sheet rows merge over the local JSON by URL. Members then
add teams and edit name overrides in the sheet, without npm.

**The automatic update flow.** A GitHub Actions cron runs daily:

1. It re-fetches every listed Liquipedia event and team page.
2. It pulls the PMT team's live Google Sheets (with the GitHub CSV snapshot
   as fallback).
3. If the data changed, it commits. The commit deploys itself through
   Railway's GitHub integration.

So: an edit in a sheet is live on the desk within a day, with no npm work.
For an immediate refresh, run the "Refresh event database" workflow from the
repository's Actions tab, or run the npm scripts locally and push.

Liquipedia is fetched within its API terms of use: a descriptive User-Agent,
gzip, and one request per two seconds. The desk itself makes no runtime
requests — data is baked in at build time.

## What the desk does

- Reads both the plain-text and the HTML halves of a capture.
- Parses main-match, live-match, and map-stat pages without contacting HLTV.
- Shows a rendered preview of the title and body in the PMT structure.
- Keeps every capture in an import history with change summaries.
- Autosaves drafts in the browser and restores them after reload.
- Exports and imports a validated recovery bundle.
- Runs entirely in the browser: no account, no analytics, no telemetry, no
  runtime fetch.

When HLTV changes a layout, the importer fails conservatively and leaves the
last good draft alone. The checked-in capture fixtures make parser drift
reproducible.

## Run it locally

Requirements: a current Node.js release and a modern Chromium browser.

```bash
npm install
npm run dev
```

For a production build: `npm run build`, then serve `dist/` from any static
host. Production deploys automatically from pushes to `main` through
Railway.

## Validate it

Install Playwright's pinned browser once:

```bash
npx playwright install chromium
npm run validate
```

`validate` runs lint, strict TypeScript, unit tests, the production build,
and real Chromium flows: paste, clipboard copy, persistence, bundle
recovery, updates and conflicts, wrong-match protection, live matches,
hostile input, narrow layouts, and the timing protocol.

## Privacy and recovery

Pasted source data and drafts stay in the browser origin's local storage.
Copy actions write only the selected PMT output to the clipboard. Exported
`.pmt.json` bundles contain the full import history and the raw clipboard
payloads; the UI discloses this before download. Share those files only with
people you trust.

"Clear this draft" removes the selected local draft, its snapshots, edits,
and history. It does not remove other drafts. Drafts live per browser — use
Export bundle / Import bundle to move a draft between machines.

## Current boundary

The desk does not monitor HLTV, sign into Reddit, submit posts for you, or
bypass bot protection. The extension only captures pages you visit and
prefills the submit form; a human always reviews and clicks submit.
