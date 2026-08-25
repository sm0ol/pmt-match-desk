// Adds a Liquipedia event URL to data/event-sources.json and refreshes the
// event database. Run with: npm run add-event -- <url> [hltv-event-name]
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

const [url, hltvName] = process.argv.slice(2);
if (!url || !/^https:\/\/liquipedia\.net\/counterstrike\//.test(url)) {
  console.error("Usage: npm run add-event -- https://liquipedia.net/counterstrike/<event-page> [hltv-event-name]");
  process.exit(1);
}

const sourcesPath = resolve(import.meta.dirname, "../data/event-sources.json");
const config = JSON.parse(readFileSync(sourcesPath, "utf8"));
const cleaned = url.replace(/\/+$/, "");
const existing = config.sources.find((entry) => (typeof entry === "string" ? entry : entry.url) === cleaned);
if (existing) {
  console.log("Already listed. Refreshing.");
} else {
  config.sources.push(hltvName ? { url: cleaned, hltvName } : { url: cleaned });
  writeFileSync(sourcesPath, JSON.stringify(config, null, 2) + "\n");
  console.log(`Added ${cleaned}`);
}

const result = spawnSync("node", [resolve(import.meta.dirname, "refresh-events.mjs")], { stdio: "inherit" });
process.exit(result.status ?? 0);
