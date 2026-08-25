// Loads Liquipedia source lists: the local JSON file, optionally merged with
// a published Google Sheet CSV (data/sources-config.json) so the team can
// manage sources — including display-name overrides — in a sheet without
// running npm scripts. Sheet rows win over local entries with the same URL.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fetchCsvUrl } from "./csv.mjs";

const MERGE_KEYS = ["hltvName", "name", "initials", "logoFlag", "logoCode", "hltv", "reddit"];

export async function loadSources(kind) {
  const local = JSON.parse(
    readFileSync(resolve(import.meta.dirname, `../data/${kind}-sources.json`), "utf8"),
  );
  const config = JSON.parse(
    readFileSync(resolve(import.meta.dirname, "../data/sources-config.json"), "utf8"),
  );
  const byUrl = new Map();
  for (const entry of local.sources) {
    const source = typeof entry === "string" ? { url: entry } : entry;
    byUrl.set(source.url, source);
  }
  const sheetUrl = config[`${kind}SourcesCsv`];
  if (sheetUrl) {
    try {
      const rows = await fetchCsvUrl(sheetUrl);
      let merged = 0;
      for (const row of rows) {
        if (!row.url || !/^https:\/\/liquipedia\.net\/counterstrike\//.test(row.url)) continue;
        const cleaned = row.url.replace(/\/+$/, "");
        const entry = { ...byUrl.get(cleaned), url: cleaned };
        for (const key of MERGE_KEYS) {
          if (row[key]) entry[key] = row[key];
        }
        if (row.logoWhite) entry.logoWhite = /^true$/i.test(row.logoWhite);
        byUrl.set(cleaned, entry);
        merged += 1;
      }
      console.log(`Merged ${merged} ${kind} sources from the sheet`);
    } catch (error) {
      console.warn(`${kind} sources sheet fetch failed (${error.message}); using local JSON only`);
    }
  }
  return [...byUrl.values()];
}
