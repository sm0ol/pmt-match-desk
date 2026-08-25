// Curated event and team reference data maintained by the Post-Match Team
// (github.com/asbmeyers/Post-Match-Thread-Creator). Refresh the snapshot with
// `npm run refresh-data`.
import data from "./referenceData.json";

export interface EventReference {
  name: string;
  flag: string;
  city: string;
  prize: string;
  liquipedia: string;
  hltv: string;
  reddit: string;
  streams: Array<{ label: string; url: string }>;
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
}

function normalize(value: string): string {
  return value.trim().toLocaleLowerCase();
}

const eventsByName = new Map<string, EventReference>(
  (data.events as EventReference[]).map((event) => [normalize(event.name), event]),
);
const teamsByHltvName = new Map<string, TeamReference>(
  (data.teams as TeamReference[]).map((team) => [normalize(team.hltvName), team]),
);

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
