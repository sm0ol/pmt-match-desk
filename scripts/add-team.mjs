// Adds a Liquipedia team URL to data/team-sources.json and refreshes the
// team database. Run with: npm run add-team -- <url> [hltv-team-name]
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

const [url, hltvName] = process.argv.slice(2);
if (!url || !/^https:\/\/liquipedia\.net\/counterstrike\//.test(url)) {
  console.error("Usage: npm run add-team -- https://liquipedia.net/counterstrike/<team-page> [hltv-team-name]");
  process.exit(1);
}

const sourcesPath = resolve(import.meta.dirname, "../data/team-sources.json");
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

const result = spawnSync("node", [resolve(import.meta.dirname, "refresh-teams.mjs")], { stdio: "inherit" });
process.exit(result.status ?? 0);
