// Shared Liquipedia API helpers, used per their API terms of use:
// descriptive User-Agent, gzip, one parse request per two seconds.
import { gunzipSync } from "node:zlib";

const USER_AGENT = "pmt-match-desk/0.1 (https://github.com/sm0ol/pmt-match-desk; sprobertson94@gmail.com)";
export const REQUEST_GAP_MS = 2100;

export function sleep(ms) {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

export function pageNameFromUrl(url) {
  const match = url.match(/^https:\/\/liquipedia\.net\/counterstrike\/(.+?)\/?$/);
  if (!match) throw new Error(`Not a Liquipedia Counter-Strike URL: ${url}`);
  return decodeURIComponent(match[1]);
}

export async function fetchWikitext(pageName) {
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

/** Splits template body fields, respecting nested braces and brackets. */
export function splitTemplateFields(body) {
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
  const positional = [];
  for (const part of parts) {
    const eq = part.indexOf("=");
    if (eq < 0) {
      positional.push(part.trim());
      continue;
    }
    fields[part.slice(0, eq).trim().toLowerCase()] = part.slice(eq + 1).trim();
  }
  return { fields, positional };
}

/** Extracts the body of the first template matching the name pattern, starting at `from`. */
export function extractTemplate(wikitext, namePattern, from = 0) {
  const start = wikitext.slice(from).search(namePattern);
  if (start < 0) return null;
  const absolute = from + start;
  let depth = 0;
  let end = absolute;
  for (; end < wikitext.length - 1; end += 1) {
    if (wikitext.startsWith("{{", end)) { depth += 1; end += 1; }
    else if (wikitext.startsWith("}}", end)) { depth -= 1; end += 1; if (depth === 0) break; }
  }
  return { body: wikitext.slice(absolute + 2, end - 1), start: absolute, end: end + 1 };
}
