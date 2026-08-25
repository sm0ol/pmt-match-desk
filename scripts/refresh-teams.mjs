// Builds our own team database from Liquipedia pages listed in
// data/team-sources.json. Run with: npm run refresh-teams
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { countryCode, flagEmoji } from "../src/domain/countries.ts";
import { loadSources } from "./sources.mjs";
import {
  extractTemplate,
  fetchWikitext,
  pageNameFromUrl,
  REQUEST_GAP_MS,
  sleep,
  splitTemplateFields,
} from "./liquipedia.mjs";

const IGL_MARK = "♛";

const targetPath = resolve(import.meta.dirname, "../src/output/liquipediaTeams.json");

const STAFF_ROLE = /coach|manager|analyst/i;

function personString(fields) {
  const flag = flagEmoji(fields.flag ?? "") ?? flagEmoji(countryCode(fields.flag ?? "") ?? "") ?? "";
  const nick = (fields.id ?? "").replace(/\[\[|\]\]/g, "").trim();
  if (!nick) return null;
  const igl = fields.igl === "y" || fields.igl === "true";
  const role = fields.role ?? "";
  // Loan, trial, and stand-in players are part of the active roster.
  const note = role && !STAFF_ROLE.test(role) ? ` (${role.toLowerCase()})` : "";
  return {
    text: `${flag ? `${flag} ` : ""}${nick}${igl ? ` ${IGL_MARK}` : ""}${note}`,
    role,
  };
}

/** Reads all {{Person|...}} entries out of one {{Squad|...}} block. */
function squadMembers(squadBody) {
  const members = [];
  let from = 0;
  for (;;) {
    const person = extractTemplate(squadBody, /\{\{Person\b/i, from);
    if (!person) break;
    const { fields } = splitTemplateFields(person.body);
    const member = personString(fields);
    if (member) members.push(member);
    from = person.end;
  }
  return members;
}

function findSquad(wikitext, status) {
  let from = 0;
  for (;;) {
    const squad = extractTemplate(wikitext, /\{\{Squad\b/i, from);
    if (!squad) return null;
    const statusMatch = squad.body.match(/\|\s*status\s*=\s*([a-z]+)/i);
    if ((statusMatch?.[1] ?? "").toLowerCase() === status) return squad;
    from = squad.end;
  }
}

const TEAM_LINKS = [
  ["Official Site", "website", (value) => value],
  ["Faceit", "faceit", (value) => `https://www.faceit.com/en/teams/${value}`],
  ["Twitter", "twitter", (value) => `https://twitter.com/${value}`],
  ["Facebook", "facebook", (value) => `https://facebook.com/${value}`],
  ["Instagram", "instagram", (value) => `https://www.instagram.com/${value}`],
  ["TikTok", "tiktok", (value) => `https://tiktok.com/@${value}`],
  ["YouTube", "youtube", (value) => (value.includes("/") ? `https://www.youtube.com/${value}` : `https://www.youtube.com/@${value}`)],
  ["Twitch", "twitch", (value) => `https://www.twitch.tv/${value}`],
  ["Steam", "privsteam", (value) => `https://steamcommunity.com/groups/${value}`],
  ["Discord", "discord", (value) => (value.startsWith("http") ? value : `https://discord.gg/${value}`)],
];

function buildTeam(source, wikitext) {
  const infoboxTemplate = extractTemplate(wikitext, /\{\{Infobox team/i);
  if (!infoboxTemplate) throw new Error("No team infobox on this page.");
  const { fields } = splitTemplateFields(infoboxTemplate.body);
  const infoboxName = fields.name || pageNameFromUrl(source.url).replaceAll("_", " ");
  // A source-level name wins: it is how the post displays the team, e.g. a
  // substitute for gambling org names Reddit may auto-remove.
  const name = source.name || infoboxName;
  const country = countryCode(fields.location ?? "") ?? "";
  const flag = flagEmoji(country) ?? "";

  const active = findSquad(wikitext, "active");
  const inactive = findSquad(wikitext, "inactive");
  const activeMembers = active ? squadMembers(active.body) : [];
  const roster = activeMembers
    .filter((member) => !STAFF_ROLE.test(member.role))
    .map((member) => member.text);
  const coaches = activeMembers
    .filter((member) => /coach/i.test(member.role))
    .map((member) => member.text);
  const subs = inactive ? squadMembers(inactive.body).map((member) => member.text) : [];

  const links = [
    { label: "Liquipedia", url: source.url },
    ...TEAM_LINKS.filter(([, key]) => fields[key]).map(([label, key, toUrl]) => ({
      label,
      url: /^https?:\/\//.test(fields[key]) && key !== "website" ? fields[key] : toUrl(fields[key]),
    })),
  ];

  return {
    hltvName: source.hltvName || infoboxName,
    name,
    flagName: `${flag ? `${flag} ` : ""}${name}`,
    country,
    initials: source.initials || "",
    roster,
    coach: coaches.join(" | "),
    subs,
    links,
    ...(source.logoFlag && source.logoCode
      ? { logoFlag: source.logoFlag, logoCode: source.logoCode, logoWhite: Boolean(source.logoWhite) }
      : {}),
    aliases: [...new Set([infoboxName, source.hltvName, source.name].filter(Boolean))],
  };
}

const teams = [];
for (const source of await loadSources("team")) {
  const pageName = pageNameFromUrl(source.url);
  process.stdout.write(`Fetching ${pageName}... `);
  try {
    const team = buildTeam(source, await fetchWikitext(pageName));
    teams.push(team);
    console.log(`ok (${team.name}: ${team.roster.length} players, coach ${team.coach || "n/a"})`);
  } catch (error) {
    console.log(`FAILED: ${error.message}`);
    process.exitCode = 1;
  }
  await sleep(REQUEST_GAP_MS);
}

writeFileSync(
  targetPath,
  JSON.stringify(
    { source: "https://liquipedia.net (see data/team-sources.json)", refreshedAt: new Date().toISOString(), teams },
    null,
    2,
  ) + "\n",
);
console.log(`Wrote ${teams.length} teams to ${targetPath}`);
