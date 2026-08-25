// Adds a Liquipedia team URL to data/team-sources.json and refreshes the
// team database.
//
//   npm run add-team -- <url> [hltv-team-name] [--name <display-name>]
//
// --name overrides how the post displays the team (e.g. "BB" for a gambling
// org name Reddit may auto-remove). Entries can also be edited by hand in
// data/team-sources.json.
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

const args = process.argv.slice(2);
const positional = [];
let displayName = "";
for (let index = 0; index < args.length; index += 1) {
  if (args[index] === "--name") {
    displayName = args[index + 1] ?? "";
    index += 1;
  } else positional.push(args[index]);
}
const [url, hltvName] = positional;
if (!url || !/^https:\/\/liquipedia\.net\/counterstrike\//.test(url)) {
  console.error("Usage: npm run add-team -- https://liquipedia.net/counterstrike/<team-page> [hltv-team-name] [--name <display-name>]");
  process.exit(1);
}

const sourcesPath = resolve(import.meta.dirname, "../data/team-sources.json");
const config = JSON.parse(readFileSync(sourcesPath, "utf8"));
const cleaned = url.replace(/\/+$/, "");
const existing = config.sources.find((entry) => (typeof entry === "string" ? entry : entry.url) === cleaned);
if (existing && typeof existing !== "string") {
  if (hltvName) existing.hltvName = hltvName;
  if (displayName) existing.name = displayName;
  writeFileSync(sourcesPath, JSON.stringify(config, null, 2) + "\n");
  console.log("Already listed — updated the entry. Refreshing.");
} else if (existing) {
  console.log("Already listed. Refreshing.");
} else {
  const entry = { url: cleaned };
  if (hltvName) entry.hltvName = hltvName;
  if (displayName) entry.name = displayName;
  config.sources.push(entry);
  writeFileSync(sourcesPath, JSON.stringify(config, null, 2) + "\n");
  console.log(`Added ${cleaned}`);
}

const result = spawnSync("node", [resolve(import.meta.dirname, "refresh-teams.mjs")], { stdio: "inherit" });
process.exit(result.status ?? 0);
