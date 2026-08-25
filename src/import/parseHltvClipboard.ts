import { parseFragment } from "parse5";
import type {
  ImportProposal,
  MapResult,
  MatchData,
  PlayerStat,
  Team,
} from "../domain/types";
import { canonicalHltvMatchUrl } from "../domain/hltvUrl";

const MAX_PLAIN_CHARS = 120_000;
// Current HLTV copies can include a large live-stream/sidebar payload even
// though the match block itself is small. Keep a hard ceiling, but leave room
// for a normal full-page browser copy observed in production.
const MAX_HTML_CHARS = 3_000_000;
const MAX_NODES = 250_000;
const MAX_DEPTH = 80;
const MAP_NAMES = new Set([
  "ancient",
  "anubis",
  "cache",
  "cobblestone",
  "dust2",
  "inferno",
  "mirage",
  "nuke",
  "overpass",
  "train",
  "vertigo",
]);

interface ClipboardCapture {
  plain: string;
  html: string;
}

interface NodeLike {
  attrs?: Array<{ name: string; value: string }>;
  childNodes?: NodeLike[];
}

function fingerprint(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function slug(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function normalizedLines(plain: string): string[] {
  return plain
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => line.replace(/\u00a0/g, " ").trim())
    .filter(Boolean);
}

function integerLine(value: string | undefined): number | null {
  if (!value || !/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function canonicalMapName(value: string | undefined): string | null {
  const normalized = value?.toLowerCase() ?? "";
  for (const mapName of MAP_NAMES) {
    if (normalized === mapName || normalized === `${mapName}${mapName}`) {
      return `${mapName[0].toUpperCase()}${mapName.slice(1)}`;
    }
  }
  return null;
}

interface PlayerFact {
  country?: string;
  awper?: boolean;
  igl?: boolean;
}

interface HtmlFacts {
  hrefs: string[];
  teamCountries: { team1?: string; team2?: string };
  playerFacts: Map<string, PlayerFact>;
}

interface SubtreeFacts {
  playerIds: Set<string>;
  flags: string[];
  awper: boolean;
  igl: boolean;
}

// HLTV flag images encode the country in their src:
// /img/static/flags/30x20/DK.gif or /img/static/flags/300x200/EU.png
const FLAG_SRC = /\/img\/static\/flags\/[^/]+\/([A-Za-z-]{2,7})\.(?:gif|png)/;

function collectHtmlFacts(html: string): HtmlFacts {
  const facts: HtmlFacts = { hrefs: [], teamCountries: {}, playerFacts: new Map() };
  if (!html) return facts;
  const root = parseFragment(html) as NodeLike;
  let nodes = 0;

  const attr = (node: NodeLike, name: string) =>
    node.attrs?.find((attribute) => attribute.name === name)?.value;

  const visit = (node: NodeLike, depth: number): SubtreeFacts => {
    nodes += 1;
    if (nodes > MAX_NODES || depth > MAX_DEPTH) {
      throw new Error("Copied HTML is too structurally complex.");
    }
    const href = attr(node, "href");
    if (href) facts.hrefs.push(href);
    const classes = attr(node, "class") ?? "";
    const title = attr(node, "title") ?? "";
    const flagCode = attr(node, "src")?.match(FLAG_SRC)?.[1]?.toUpperCase();

    if (flagCode && /(?:^|\s)team1(?:\s|$)/.test(classes)) facts.teamCountries.team1 ??= flagCode;
    if (flagCode && /(?:^|\s)team2(?:\s|$)/.test(classes)) facts.teamCountries.team2 ??= flagCode;

    const subtree: SubtreeFacts = {
      playerIds: new Set(),
      flags: flagCode && classes.includes("flag") ? [flagCode] : [],
      awper:
        classes.includes("role-pill--awp") ||
        classes.includes("fa-crosshairs") ||
        title === "Main AWPer",
      igl: classes.includes("role-pill--igl") || title === "In-game leader",
    };
    const playerId = href?.match(/^\/player\/(\d+)\//)?.[1];
    if (playerId) subtree.playerIds.add(playerId);

    for (const child of node.childNodes ?? []) {
      const childFacts = visit(child, depth + 1);
      for (const id of childFacts.playerIds) subtree.playerIds.add(id);
      subtree.flags.push(...childFacts.flags);
      subtree.awper ||= childFacts.awper;
      subtree.igl ||= childFacts.igl;
    }

    // The smallest container holding exactly one player link owns any flag or
    // role markers inside it. Consume them so a wider ancestor (a lineup row
    // with five players, a section with stream flags) cannot mispair them.
    if (subtree.playerIds.size === 1 && (subtree.flags.length > 0 || subtree.awper || subtree.igl)) {
      const [id] = subtree.playerIds;
      const fact = facts.playerFacts.get(id) ?? {};
      if (subtree.flags.length === 1 && !fact.country) fact.country = subtree.flags[0];
      if (subtree.awper) fact.awper = true;
      if (subtree.igl) fact.igl = true;
      facts.playerFacts.set(id, fact);
      subtree.flags = [];
      subtree.awper = false;
      subtree.igl = false;
    }
    return subtree;
  };

  visit(root, 0);
  return facts;
}

function findTeam(hrefs: string[], name: string): Team {
  const expectedSlug = slug(name);
  const href = hrefs.find((candidate) => {
    const match = candidate.match(/^\/team\/(\d+)\/([^?#/]+)/);
    return match && match[2] === expectedSlug;
  });
  const id = href?.match(/^\/team\/(\d+)/)?.[1] ?? `name:${expectedSlug}`;
  return { id, name };
}

function findSourceUrl(hrefs: string[], team1: string, team2: string): { id: string; url: string } {
  const teamSlugs = [slug(team1), slug(team2)];
  const candidate = hrefs.find((href) => {
    const path = href.replace(/^https:\/\/www\.hltv\.org/, "");
    const match = path.match(/^\/matches\/(\d+)\/([^?#/]+)/);
    return match && teamSlugs.every((teamSlug) => match[2].includes(teamSlug));
  });
  const path = candidate?.replace(/^https:\/\/www\.hltv\.org/, "");
  const match = path?.match(/^\/matches\/(\d+)\/([^?#/]+)/);
  if (!match) {
    const composite = fingerprint(`${team1}|${team2}`);
    return { id: `composite:${composite}`, url: "" };
  }
  return {
    id: match[1],
    url: canonicalHltvMatchUrl(`https://www.hltv.org/matches/${match[1]}/${match[2]}`) ?? "",
  };
}

function findMatchUrl(hrefs: string[], team1: string, team2: string): { id: string; url: string } | null {
  const teamSlugs = [slug(team1), slug(team2)];
  const candidate = hrefs.find((href) => {
    const path = href.replace(/^https:\/\/www\.hltv\.org/, "");
    const match = path.match(/^\/matches\/\d+\/([^?#/]+)/);
    return match && teamSlugs.every((teamSlug) => match[1].includes(teamSlug));
  });
  const path = candidate?.replace(/^https:\/\/www\.hltv\.org/, "");
  const match = path?.match(/^\/matches\/(\d+)\/[^?#/]+/);
  const url = path ? canonicalHltvMatchUrl(`https://www.hltv.org${path}`) : null;
  return match && url ? { id: match[1], url } : null;
}

function parseMaps(
  lines: string[],
  team1: string,
  team2: string,
  hrefs: string[],
  sourceState: MatchData["state"],
): MapResult[] {
  const mapLinks = hrefs.filter((href) => /^\/stats\/matches\/mapstatsid\/\d+\//.test(href));
  const maps: MapResult[] = [];
  const seen = new Set<string>();

  for (let index = 0; index < lines.length - 5; index += 1) {
    const name = canonicalMapName(lines[index]);
    if (!name) continue;
    let blockEnd = Math.min(lines.length, index + 14);
    for (let candidateIndex = index + 1; candidateIndex < blockEnd; candidateIndex += 1) {
      if (canonicalMapName(lines[candidateIndex])) {
        blockEnd = candidateIndex;
        break;
      }
    }
    const absoluteStats = lines.slice(index + 1, Math.min(blockEnd, index + 10))
      .findIndex((line) => line === "STATS") + index + 1;
    if (absoluteStats <= index || !lines.slice(index + 1, absoluteStats).includes(team1)) continue;

    let team1Score: number | null = null;
    for (let candidateIndex = absoluteStats - 1; candidateIndex > index; candidateIndex -= 1) {
      team1Score = integerLine(lines[candidateIndex]);
      if (team1Score !== null) break;
    }
    const absoluteTeam2 = lines.slice(absoluteStats + 1, blockEnd).findIndex((line) => line === team2)
      + absoluteStats + 1;
    if (team1Score === null || absoluteTeam2 <= absoluteStats) continue;

    let team2Score: number | null = null;
    for (let candidateIndex = absoluteTeam2 + 1; candidateIndex < blockEnd; candidateIndex += 1) {
      team2Score = integerLine(lines[candidateIndex]);
      if (team2Score !== null) break;
    }
    if (team2Score === null || seen.has(name.toLowerCase())) continue;
    const link = mapLinks[maps.length];
    const mapId = link?.match(/mapstatsid\/(\d+)/)?.[1] ?? `map:${slug(name)}`;
    maps.push({
      id: mapId,
      name,
      team1Score,
      team2Score,
      halfScore: lines[absoluteStats + 1]?.startsWith("(") ? lines[absoluteStats + 1] : undefined,
      statsUrl: link ? `https://www.hltv.org${link}` : undefined,
      sourceKind: "main-match",
      sourceState,
    });
    seen.add(name.toLowerCase());
  }
  return maps;
}

function parsePlayers(
  lines: string[],
  team1: Team,
  team2: Team,
  htmlFacts: HtmlFacts,
  sourceState: MatchData["state"],
): PlayerStat[] {
  const start = lines.indexOf("Match stats");
  const end = lines.indexOf("Lineups", start + 1);
  if (start < 0 || end < 0) return [];
  const playerLinks = new Map<string, string>();
  for (const href of htmlFacts.hrefs) {
    const match = href.match(/^\/player\/(\d+)\/([^?#/]+)/);
    if (match && !playerLinks.has(match[2])) playerLinks.set(match[2], match[1]);
  }

  const players: PlayerStat[] = [];
  let currentTeam = "";
  for (let index = start; index < end; index += 1) {
    if (lines[index] === team1.name || lines[index] === team2.name) {
      currentTeam = lines[index];
      continue;
    }
    const stats = lines[index].match(/^(\d+)-(\d+)\s+([+-]?\d+(?:\.\d+)?%)\s+(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?%)\s+(\d+(?:\.\d+)?)$/);
    if (!stats || !currentTeam || index === 0) continue;
    const name = lines[index - 1];
    const nickname = name.match(/'([^']+)'/)?.[1] ?? name;
    const id = playerLinks.get(slug(nickname)) ?? `name:${slug(name)}`;
    const fact = htmlFacts.playerFacts.get(id);
    players.push({
      id,
      name,
      team: currentTeam,
      teamSide: currentTeam === team1.name ? "team1" : "team2",
      ...(fact?.country ? { country: fact.country } : {}),
      ...(fact?.awper ? { awper: true } : {}),
      ...(fact?.igl ? { igl: true } : {}),
      kills: Number(stats[1]),
      deaths: Number(stats[2]),
      swing: stats[3],
      adr: Number(stats[4]),
      kast: stats[5],
      rating: Number(stats[6]),
      sourceKind: "main-match",
      sourceState,
    });
  }
  return players;
}

function findSeriesTeam(
  lines: string[],
  start: number,
  end: number,
  direction: "forward" | "backward",
): { name: string; score: number } | null {
  const step = direction === "forward" ? 1 : -1;
  let index = direction === "forward" ? start : end - 1;
  while (index >= start && index < end) {
    const score = integerLine(lines[index]);
    const name = lines[index - 1];
    if (score !== null && name) return { name, score };
    index += step;
  }
  return null;
}

function parseMain(lines: string[], htmlFacts: HtmlFacts): MatchData | null {
  const hrefs = htmlFacts.hrefs;
  const mapsIndex = lines.indexOf("Maps");
  let statusIndex = -1;
  for (let index = mapsIndex - 1; index >= 0; index -= 1) {
    if (/^(Match over|LIVE|Match postponed|Match cancelled)$/i.test(lines[index])) {
      statusIndex = index;
      break;
    }
  }
  if (statusIndex < 5 || mapsIndex < statusIndex + 2) return null;

  const team1Result = findSeriesTeam(lines, Math.max(0, statusIndex - 12), statusIndex, "backward");
  const team2Result = findSeriesTeam(lines, statusIndex + 1, mapsIndex, "forward");
  if (!team1Result || !team2Result) return null;
  const { name: team1Name, score: score1 } = team1Result;
  const { name: team2Name, score: score2 } = team2Result;

  const team1 = findTeam(hrefs, team1Name);
  const team2 = findTeam(hrefs, team2Name);
  if (htmlFacts.teamCountries.team1) team1.country = htmlFacts.teamCountries.team1;
  if (htmlFacts.teamCountries.team2) team2.country = htmlFacts.teamCountries.team2;
  const source = findSourceUrl(hrefs, team1Name, team2Name);
  const bestOfLine = lines.slice(mapsIndex, mapsIndex + 5).find((line) => /Best of \d+/i.test(line));
  const bestOf = Number(bestOfLine?.match(/Best of (\d+)/i)?.[1] ?? 1);
  const stageLine = lines.slice(mapsIndex, mapsIndex + 8).find((line) => line.startsWith("*"));
  const stage = stageLine?.replace(/^\*\s*/, "").split(".")[0]?.trim() ?? "";
  const state = /^Match over$/i.test(lines[statusIndex])
    ? "completed"
    : /^LIVE$/i.test(lines[statusIndex])
      ? "live"
      : "unknown";

  return {
    id: source.id,
    sourceUrl: source.url,
    team1,
    team2,
    seriesScore: [score1, score2],
    event: lines[statusIndex - 1] ?? "",
    stage,
    bestOf,
    maps: parseMaps(lines, team1Name, team2Name, hrefs, state),
    players: parsePlayers(lines, team1, team2, htmlFacts, state),
    context: stageLine?.split(".").slice(1).join(".").trim() ?? "",
    sourceKind: "main-match",
    state,
  };
}

function parseMapStats(lines: string[], hrefs: string[]): MatchData | null {
  const mapStatsLink = hrefs.find((href) => /^\/stats\/matches\/mapstatsid\/\d+\//.test(href));
  const linkedMapId = mapStatsLink?.match(/mapstatsid\/(\d+)/)?.[1];
  const mapIndex = lines.findIndex(
    (line, index) => line === "Map" && MAP_NAMES.has((lines[index + 1] ?? "").toLowerCase()),
  );
  if (mapIndex < 0) return null;

  const mapName = lines[mapIndex + 1] ?? "";
  const team1Name = lines[mapIndex + 2] ?? "";
  const team1Score = Number(lines[mapIndex + 3]);
  const team2Name = lines[mapIndex + 4] ?? "";
  const team2Score = Number(lines[mapIndex + 5]);
  if (!team1Name || !team2Name || !Number.isFinite(team1Score) || !Number.isFinite(team2Score)) {
    return null;
  }
  const source = findMatchUrl(hrefs, team1Name, team2Name);

  const bestOfIndex = lines.findIndex((line) => /^Best of \d+$/i.test(line));
  const scoreLine = bestOfIndex > 0 ? lines[bestOfIndex - 1] : "";
  const score = scoreLine.match(/^(\d+)\s*-\s*(\d+)$/);
  const event = lines[lines.indexOf("Overview") - 1] ?? "";
  const compositeId = `composite:${fingerprint(`${team1Name}|${team2Name}|${event}`)}`;
  const teamContextIds = hrefs
    .map((href) => href.match(/[?&]contextIds=(\d+)&contextTypes=team/)?.[1])
    .filter((id): id is string => Boolean(id));

  return {
    id: source?.id ?? compositeId,
    sourceUrl: source?.url ?? "",
    team1: { id: teamContextIds[0] ?? `name:${slug(team1Name)}`, name: team1Name },
    team2: { id: teamContextIds[1] ?? `name:${slug(team2Name)}`, name: team2Name },
    seriesScore: [Number(score?.[1] ?? 0), Number(score?.[2] ?? 0)],
    event,
    stage: "",
    bestOf: Number(lines[bestOfIndex]?.match(/\d+/)?.[0] ?? 1),
    maps: [{
      id: linkedMapId ?? `map:${slug(mapName)}`,
      name: mapName,
      team1Score,
      team2Score,
      sourceKind: "map-stats",
      sourceState: "completed",
    }],
    players: [],
    context: "",
    sourceKind: "map-stats",
    state: "completed",
  };
}

export function parseHltvClipboard(capture: ClipboardCapture): ImportProposal {
  if (capture.plain.length > MAX_PLAIN_CHARS || capture.html.length > MAX_HTML_CHARS) {
    return {
      kind: "rejected",
      confidence: "missing",
      match: null,
      diagnostics: ["Copied page is too large to process safely."],
      fingerprint: fingerprint(`oversized:${capture.plain.length}:${capture.html.length}`),
    };
  }
  const rawFingerprint = fingerprint(`${capture.plain}\u0000${capture.html}`);
  if (!/\bHLTV\b|Match stats|Best of \d+/i.test(`${capture.plain} ${capture.html.slice(0, 5000)}`)) {
    return {
      kind: "unrecognized",
      confidence: "missing",
      match: null,
      diagnostics: ["This does not look like a copied HLTV match or map-stat page."],
      fingerprint: rawFingerprint,
    };
  }

  try {
    const lines = normalizedLines(capture.plain);
    const htmlFacts = collectHtmlFacts(capture.html);
    const hrefs = htmlFacts.hrefs;
    const mainMatch = parseMain(lines, htmlFacts);
    const hasMapStatsBlock = lines.some(
      (line, index) => line === "Map" && MAP_NAMES.has((lines[index + 1] ?? "").toLowerCase()),
    );
    const mapStats = !mainMatch && (hasMapStatsBlock || hrefs.some((href) => /\/stats\/matches\/mapstatsid\//.test(href)));
    const match = mainMatch ?? (mapStats ? parseMapStats(lines, hrefs) : null);
    if (!match) {
      return {
        kind: "unrecognized",
        confidence: "review",
        match: null,
        diagnostics: ["HLTV content was recognized, but the core match block could not be read."],
        fingerprint: rawFingerprint,
      };
    }
    const diagnostics: string[] = [];
    if (!match.sourceUrl) diagnostics.push("The match URL could not be identified from copied links.");
    if (!match.stage) diagnostics.push("Event stage is missing and needs a quick edit.");
    return {
      kind: mapStats ? "map-stats" : "main-match",
      confidence: diagnostics.length === 0 ? "confident" : "review",
      match,
      diagnostics,
      fingerprint: rawFingerprint,
    };
  } catch (error) {
    return {
      kind: "rejected",
      confidence: "missing",
      match: null,
      diagnostics: [error instanceof Error ? error.message : "Copied HTML could not be parsed safely."],
      fingerprint: rawFingerprint,
    };
  }
}
