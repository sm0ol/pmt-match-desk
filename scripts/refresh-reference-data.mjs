// Snapshots the Post-Match Team's curated event and team databases
// (github.com/asbmeyers/Post-Match-Thread-Creator) into
// src/output/referenceData.json. Run with: npm run refresh-data
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

const SOURCE = "https://raw.githubusercontent.com/asbmeyers/Post-Match-Thread-Creator/main/csgo/csv";

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (inQuotes) {
      if (char === '"' && text[i + 1] === '"') { field += '"'; i += 1; }
      else if (char === '"') inQuotes = false;
      else field += char;
    } else if (char === '"') inQuotes = true;
    else if (char === ",") { row.push(field); field = ""; }
    else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[i + 1] === "\n") i += 1;
      row.push(field); field = "";
      if (row.some((cell) => cell.trim() !== "")) rows.push(row);
      row = [];
    } else field += char;
  }
  row.push(field);
  if (row.some((cell) => cell.trim() !== "")) rows.push(row);
  return rows;
}

function toObjects(rows) {
  const [header, ...rest] = rows;
  return rest.map((row) =>
    Object.fromEntries(header.map((key, index) => [key.trim(), (row[index] ?? "").trim()])),
  );
}

async function fetchCsv(name) {
  const response = await fetch(`${SOURCE}/${name}`);
  if (!response.ok) throw new Error(`${name}: HTTP ${response.status}`);
  return toObjects(parseCsv(await response.text()));
}

const eventRows = await fetchCsv("Events.csv");
const teamRows = await fetchCsv("Full_Teams.csv");

const events = eventRows
  .filter((row) => row.Name)
  .map((row) => ({
    name: row.Name,
    flag: row.Flag || "",
    city: row.City || "",
    prize: row.Prize || "",
    liquipedia: row.Wiki || "",
    hltv: row.HLTV || "",
    reddit: row.Reddit || "",
    streams: [
      ["YouTube", row.YouTube],
      ["Twitch A", row["Twitch A"]],
      ["Twitch B", row["Twitch B"]],
      ["Twitch C", row["Twitch C"]],
      ["Twitch D", row["Twitch D"]],
      ["Kick A", row["Kick A"]],
      ["Kick B", row["Kick B"]],
      ["Kick C", row["Kick C"]],
      ["Kick D", row["Kick D"]],
    ].filter(([, url]) => url).map(([label, url]) => ({ label, url })),
  }));

const LINK_ORDER = [
  ["Liquipedia", "Wiki"],
  ["HLTV", "HLTV"],
  ["Official Site", "Official Site"],
  ["Faceit", "Faceit"],
  ["Twitter", "Twitter"],
  ["Facebook", "Facebook"],
  ["Instagram", "Instagram"],
  ["TikTok", "TikTok"],
  ["YouTube", "YouTube"],
  ["Twitch", "Twitch"],
  ["Steam", "Steam"],
  ["Discord", "Discord"],
  ["Subreddit", "Subreddit"],
  ["Weibo", "Weibo"],
  ["Bilibili", "Bilibili"],
];

const teams = teamRows
  .filter((row) => row["HLTV Name"])
  .map((row) => ({
    hltvName: row["HLTV Name"],
    name: row.Name || row["HLTV Name"],
    flagName: row["Flag Name"] || "",
    initials: row.Initials || "",
    roster: [row["PLAYER 1"], row["PLAYER 2"], row["PLAYER 3"], row["PLAYER 4"], row["PLAYER 5"], row["PLAYER 6"]]
      .filter(Boolean),
    coach: row.COACH || "",
    subs: [row["SUB 1"], row["SUB 2"], row["SUB 3"], row["SUB 4"], row["SUB 5"], row["SUB 6"]].filter(Boolean),
    links: LINK_ORDER
      .filter(([, column]) => row[column])
      .map(([label, column]) => ({ label, url: row[column] })),
  }));

const output = {
  source: "https://github.com/asbmeyers/Post-Match-Thread-Creator",
  refreshedAt: new Date().toISOString(),
  events,
  teams,
};
const target = resolve(import.meta.dirname, "../src/output/referenceData.json");
writeFileSync(target, JSON.stringify(output, null, 2) + "\n");
console.log(`Wrote ${events.length} events and ${teams.length} teams to ${target}`);
