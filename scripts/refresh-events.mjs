// Builds our own event database from Liquipedia pages listed in
// data/event-sources.json, per the Liquipedia API terms of use
// (descriptive User-Agent, gzip, one parse request per two seconds).
// Run with: npm run refresh-events
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { gunzipSync } from "node:zlib";
import { countryCode, flagEmoji } from "../src/domain/countries.ts";
import { isSafeRedditLink } from "../src/output/linkSafety.ts";
import { loadSources } from "./sources.mjs";

const USER_AGENT = "pmt-match-desk/0.1 (https://github.com/sm0ol/pmt-match-desk; sprobertson94@gmail.com)";
const REQUEST_GAP_MS = 2100;

const targetPath = resolve(import.meta.dirname, "../src/output/liquipediaEvents.json");

function sleep(ms) {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

function pageNameFromUrl(url) {
  const match = url.match(/^https:\/\/liquipedia\.net\/counterstrike\/(.+?)\/?$/);
  if (!match) throw new Error(`Not a Liquipedia Counter-Strike URL: ${url}`);
  return decodeURIComponent(match[1]);
}

async function fetchWikitext(pageName) {
  const api = `https://liquipedia.net/counterstrike/api.php?action=parse&page=${encodeURIComponent(pageName)}&prop=wikitext&format=json&formatversion=2&redirects=1`;
  const response = await fetch(api, {
    headers: { "User-Agent": USER_AGENT, "Accept-Encoding": "gzip" },
  });
  if (!response.ok) throw new Error(`${pageName}: HTTP ${response.status}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  const text = buffer[0] === 0x1f && buffer[1] === 0x8b ? gunzipSync(buffer).toString("utf8") : buffer.toString("utf8");
  const parsed = JSON.parse(text);
  if (parsed.error) throw new Error(`${pageName}: ${parsed.error.info ?? "API error"}`);
  return parsed.parse.wikitext;
}

/** Splits {{Infobox league ...}} into a field map, respecting nested braces and brackets. */
function parseInfobox(wikitext) {
  const start = wikitext.search(/\{\{Infobox league/i);
  if (start < 0) throw new Error("No league infobox on this page.");
  let depth = 0;
  let end = start;
  for (; end < wikitext.length - 1; end += 1) {
    if (wikitext.startsWith("{{", end)) { depth += 1; end += 1; }
    else if (wikitext.startsWith("}}", end)) { depth -= 1; end += 1; if (depth === 0) break; }
  }
  const body = wikitext.slice(start + 2, end - 1);
  const fields = {};
  let braces = 0;
  let brackets = 0;
  let current = "";
  const parts = [];
  for (const char of body) {
    if (char === "{") braces += 1;
    else if (char === "}") braces -= 1;
    else if (char === "[") brackets += 1;
    else if (char === "]") brackets -= 1;
    if (char === "|" && braces === 0 && brackets === 0) {
      parts.push(current);
      current = "";
    } else current += char;
  }
  parts.push(current);
  for (const part of parts) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    fields[part.slice(0, eq).trim().toLowerCase()] = part.slice(eq + 1).trim();
  }
  return fields;
}

function compactPrize(raw) {
  const amount = Number(String(raw).replace(/[^0-9.]/g, ""));
  if (!Number.isFinite(amount) || amount <= 0) return "$0";
  if (amount >= 1_000_000) return `$${String(Number((amount / 1_000_000).toFixed(2)))}m`;
  if (amount >= 1_000) return `$${String(Number((amount / 1_000).toFixed(1)))}k`;
  return `$${amount}`;
}

function streamUrl(platform, value) {
  if (/^https?:\/\//.test(value)) return value;
  if (platform === "twitch") return `https://www.twitch.tv/${value}`;
  if (platform === "kick") return `https://kick.com/${value}`;
  if (platform === "youtube") return value.includes("/") ? `https://www.youtube.com/${value}` : `https://www.youtube.com/@${value}`;
  return "";
}

function buildEvent(source, fields) {
  const name = fields.name || pageNameFromUrl(source.url).replaceAll("/", " ");
  const country = fields.country || "";
  const flag = flagEmoji(countryCode(country) ?? "") ?? "";
  const cities = [fields.city, fields.city2, fields.city3].filter(Boolean);
  const kind = /offline/i.test(fields.type || "") ? "LAN" : "Online";
  const streams = [];
  const PLATFORM_LABELS = { twitch: "Twitch", youtube: "YouTube", kick: "Kick" };
  for (const platform of ["twitch", "youtube", "kick"]) {
    const keys = Object.keys(fields)
      .filter((key) => new RegExp(`^${platform}\\d*$`).test(key))
      .sort();
    keys.forEach((key, index) => {
      const url = streamUrl(platform, fields[key]);
      if (!url) return;
      const label = PLATFORM_LABELS[platform];
      if (!isSafeRedditLink(url)) return;
      streams.push({ label: keys.length > 1 ? `${label} ${String.fromCharCode(65 + index)}` : label, url });
    });
  }
  return {
    name,
    aliases: [source.hltvName].filter(Boolean),
    flag,
    city: cities.join(" / ") || country,
    prize: compactPrize(fields.prizepoolusd ?? fields.prizepool),
    kind,
    liquipedia: source.url,
    hltv: source.hltv || "",
    reddit: source.reddit || "",
    startDate: fields.sdate || fields.date || "",
    endDate: fields.edate || "",
    streams,
  };
}

const events = [];
for (const source of await loadSources("event")) {
  const pageName = pageNameFromUrl(source.url);
  process.stdout.write(`Fetching ${pageName}... `);
  try {
    const wikitext = await fetchWikitext(pageName);
    const event = buildEvent(source, parseInfobox(wikitext));
    events.push(event);
    console.log(`ok (${event.name})`);
  } catch (error) {
    console.log(`FAILED: ${error.message}`);
    process.exitCode = 1;
  }
  await sleep(REQUEST_GAP_MS);
}

writeFileSync(
  targetPath,
  JSON.stringify(
    { source: "https://liquipedia.net (see data/event-sources.json)", refreshedAt: new Date().toISOString(), events },
    null,
    2,
  ) + "\n",
);
console.log(`Wrote ${events.length} events to ${targetPath}`);
