// Event and team reference data from two sources: the Post-Match Team's
// curated databases (github.com/asbmeyers/Post-Match-Thread-Creator, refresh
// with `npm run refresh-data`) and our own Liquipedia-built event database
// (data/event-sources.json, refresh with `npm run refresh-events`). Our own
// entries win on name collisions.
import data from "./referenceData.json";
import liquipediaData from "./liquipediaEvents.json";
import liquipediaTeams from "./liquipediaTeams.json";

export interface EventReference {
  name: string;
  flag: string;
  city: string;
  prize: string;
  liquipedia: string;
  hltv: string;
  reddit: string;
  streams: Array<{ label: string; url: string }>;
  /** Known directly for Liquipedia-built entries; derived from city otherwise. */
  kind?: "LAN" | "Online";
  aliases?: string[];
}

export interface TeamReference {
  hltvName: string;
  name: string;
  flagName: string;
  initials: string;
  roster: string[];
  coach: string;
  subs: string[];
  links: Array<{ label: string; url: string }>;
  aliases?: string[];
  /** r/GlobalOffensive stylesheet icon, e.g. flag "🇷🇺" + code "betboom". */
  logoFlag?: string;
  logoCode?: string;
  logoWhite?: boolean;
}

function normalize(value: string): string {
  return value.trim().toLocaleLowerCase();
}

const eventsByName = new Map<string, EventReference>();
for (const event of [...(data.events as EventReference[]), ...(liquipediaData.events as EventReference[])]) {
  eventsByName.set(normalize(event.name), event);
  for (const alias of event.aliases ?? []) eventsByName.set(normalize(alias), event);
}
const teamsByHltvName = new Map<string, TeamReference>();
function indexTeam(team: TeamReference) {
  for (const key of [team.hltvName, team.name, ...(team.aliases ?? [])]) {
    if (key) teamsByHltvName.set(normalize(key), team);
  }
}
for (const team of data.teams as TeamReference[]) indexTeam(team);
for (const liquipediaTeam of liquipediaTeams.teams as TeamReference[]) {
  // Liquipedia has no subreddit icon codes; keep them from the curated data.
  const existing = teamsByHltvName.get(normalize(liquipediaTeam.hltvName));
  const merged: TeamReference = {
    ...liquipediaTeam,
    logoFlag: liquipediaTeam.logoFlag ?? existing?.logoFlag,
    logoCode: liquipediaTeam.logoCode ?? existing?.logoCode,
    logoWhite: liquipediaTeam.logoWhite ?? existing?.logoWhite,
    initials: liquipediaTeam.initials || existing?.initials || "",
  };
  indexTeam(merged);
}

export function findEventReference(name: string): EventReference | undefined {
  return eventsByName.get(normalize(name));
}

export function findTeamReference(hltvName: string): TeamReference | undefined {
  return teamsByHltvName.get(normalize(hltvName));
}

// Continent "cities" mean an online event in the source data.
const ONLINE_REGIONS = new Set([
  "north america",
  "south america",
  "europe",
  "asia",
  "oceania",
  "africa",
]);

export function eventLocationKind(city: string): "LAN" | "Online" {
  return ONLINE_REGIONS.has(normalize(city)) ? "Online" : "LAN";
}
