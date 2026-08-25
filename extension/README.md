# PMT Match Desk Capture (browser extension)

One click on an HLTV match page sends the page — and each finished map's
stats page — to PMT Match Desk. No Ctrl+A, no Ctrl+C.

## Install (Chrome / Edge / Brave)

1. Open `chrome://extensions`.
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked** and select this `extension/` directory.

## Use

1. Open a match page on HLTV (live or finished).
2. Click the extension button in the toolbar.
3. The extension captures the page, opens each finished map's stats page in a
   background tab, captures those too, then opens or focuses Match Desk and
   imports everything into one draft.

The badge shows progress: `…` while capturing, the number of captured pages
on success, `!` on failure. On a map-stats page, the button sends just that
page. Anywhere else, the button opens Match Desk.

## Notes

- The extension talks only to HLTV pages you visit and to the Match Desk app.
  It makes no other network requests and stores nothing.
- If a stats page fails to load in time, that map is skipped — Match Desk
  shows **Get stats** next to any map that still needs its table.
- The Match Desk URL is set in `manifest.json` and `background.js`
  (`APP_HOME` / `APP_URL_PATTERNS`). Local dev servers on ports 5173 and 4173
  are included.
