// Snapshots the Post-Match Team's curated event and team databases into
// src/output/referenceData.json. The live source is the team's published
// Google Sheets (edited directly by the PMT team, no npm needed on their
// side); the CSVs in github.com/asbmeyers/Post-Match-Thread-Creator are the
// fallback when the sheets are unreachable. Run with: npm run refresh-data
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fetchCsvUrl } from "./csv.mjs";
import { isSafeRedditLink } from "../src/output/linkSafety.ts";

const GITHUB_SOURCE = "https://raw.githubusercontent.com/asbmeyers/Post-Match-Thread-Creator/main/csgo/csv";
// Published-to-web sheet URLs from the Post-Match-Thread-Creator README.
const TEAM_SHEET = "https://docs.google.com/spreadsheets/d/e/2PACX-1vRFFzItpu4lT2eE6ivgvZdA-rMkB_sYT5LSWicXXEnkt-2mdMwThMbmAj0z8e9JTzWawtZBsDCehNeJ/pub?output=csv";
const EVENT_SHEET = "https://docs.google.com/spreadsheets/d/e/2PACX-1vTIZsUyfKpuANjFhteP8aJWSacnLBLTPCtD6Gc8ESy6Bphvd57VSCfB_xwvjw_RsY_mvoFffbDPe25d/pub?output=csv";

async function fetchWithFallback(sheetUrl, fallbackName) {
  try {
    const rows = await fetchCsvUrl(sheetUrl);
    console.log(`${fallbackName}: ${rows.length} rows from the live sheet`);
    return rows;
  } catch (error) {
    console.warn(`${fallbackName}: sheet fetch failed (${error.message}); using the GitHub snapshot`);
    return fetchCsvUrl(`${GITHUB_SOURCE}/${fallbackName}`);
  }
}

const eventRows = await fetchWithFallback(EVENT_SHEET, "Events.csv");
const teamRows = await fetchWithFallback(TEAM_SHEET, "Full_Teams.csv");

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
    ]
      .filter(([, url]) => url && isSafeRedditLink(url))
      .map(([label, url]) => ({ label, url })),
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

// The live sheet has clean "Flag" and "LOGO CODE" columns; the older CSV
// snapshot only has LOGO as a partial markdown link like "[🇷🇺](#betboom".
function parseLogo(row) {
  const flag = row.Flag || "";
  const code = row["LOGO CODE"] || "";
  if (code && code !== "lang-un") return { logoFlag: flag, logoCode: code };
  const match = (row.LOGO || "").match(/^\[(.+)\]\(#([^)]+)\)?$/);
  if (!match || match[2] === "lang-un") return {};
  return { logoFlag: flag || match[1], logoCode: match[2] };
}

const teams = teamRows
  .filter((row) => row["HLTV Name"])
  .map((row) => ({
    hltvName: row["HLTV Name"],
    name: row.Name || row["HLTV Name"],
    flagName: row["Flag Name"] || "",
    initials: row.Initials || "",
    ...parseLogo(row),
    logoWhite: (row.LOGOW || "").toUpperCase() === "TRUE",
    roster: [row["PLAYER 1"], row["PLAYER 2"], row["PLAYER 3"], row["PLAYER 4"], row["PLAYER 5"], row["PLAYER 6"]]
      .filter(Boolean),
    coach: row.COACH || "",
    subs: [row["SUB 1"], row["SUB 2"], row["SUB 3"], row["SUB 4"], row["SUB 5"], row["SUB 6"]].filter(Boolean),
    links: LINK_ORDER
      .filter(([, column]) => row[column])
      .map(([label, column]) => ({ label, url: row[column] }))
      .filter((link) => isSafeRedditLink(link.url)),
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
