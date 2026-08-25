import { parseFragment } from "parse5";
import type {
  HalfScore,
  ImportProposal,
  MapPlayerStat,
  MapResult,
  MatchData,
  PlayerStat,
  Team,
  VetoStep,
} from "../domain/types";
import { canonicalHltvMatchUrl } from "../domain/hltvUrl";
import { countryCode } from "../domain/countries";

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
  nodeName?: string;
  value?: string;
  attrs?: Array<{ name: string; value: string }>;
  childNodes?: NodeLike[];
}

function nodeAttr(node: NodeLike, name: string): string | undefined {
  return node.attrs?.find((attribute) => attribute.name === name)?.value;
}

// Current HLTV copies serialize absolute links; older captures used relative
// paths. All href handling works on the normalized path form.
function hltvPath(href: string): string {
  return href.replace(/^https?:\/\/(?:www\.)?hltv\.org(?=\/)/, "");
}

function nodeHref(node: NodeLike): string | undefined {
  const href = nodeAttr(node, "href");
  return href ? hltvPath(href) : undefined;
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
  /** Canonical paths of the page itself, e.g. from data-original-overlay-location. */
  selfMatchPaths: string[];
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

function collectHtmlFacts(root: NodeLike | null): HtmlFacts {
  const facts: HtmlFacts = { hrefs: [], selfMatchPaths: [], teamCountries: {}, playerFacts: new Map() };
  if (!root) return facts;
  let nodes = 0;

  const attr = nodeAttr;

  const visit = (node: NodeLike, depth: number): SubtreeFacts => {
    nodes += 1;
    if (nodes > MAX_NODES || depth > MAX_DEPTH) {
      throw new Error("Copied HTML is too structurally complex.");
    }
    const href = nodeHref(node);
    if (href) facts.hrefs.push(href);
    const overlayLocation = attr(node, "data-original-overlay-location");
    if (overlayLocation && /^\/matches\/\d+\/[^?#]+$/.test(hltvPath(overlayLocation))) {
      facts.selfMatchPaths.push(hltvPath(overlayLocation));
    }
    const classes = attr(node, "class") ?? "";
    const title = attr(node, "title") ?? "";
    // Older HLTV markup carries the code in the image src; newer markup can
    // drop the src, but the title still holds the country name.
    const flagCode =
      attr(node, "src")?.match(FLAG_SRC)?.[1]?.toUpperCase() ??
      (classes.includes("flag") || /(?:^|\s)team[12](?:\s|$)/.test(classes)
        ? countryCode(title) ?? undefined
        : undefined);

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

interface MapDetail {
  halves?: HalfScore[];
  players?: Array<Omit<MapPlayerStat, "teamSide"> & { teamId: string }>;
}

function nodeText(node: NodeLike): string {
  if (node.nodeName === "#text") return node.value ?? "";
  return (node.childNodes ?? []).map(nodeText).join("");
}

function findNodes(root: NodeLike, matches: (node: NodeLike) => boolean): NodeLike[] {
  const found: NodeLike[] = [];
  const stack: NodeLike[] = [root];
  while (stack.length > 0) {
    const node = stack.pop();
    if (!node) break;
    if (matches(node)) found.push(node);
    const children = node.childNodes ?? [];
    // Push in reverse so nodes are visited in document order.
    for (let index = children.length - 1; index >= 0; index -= 1) stack.push(children[index]);
  }
  return found;
}

function parseHalfScores(container: NodeLike): HalfScore[] {
  // Half scores render as span pairs: (<span class="ct">6</span>:<span
  // class="t">6</span>; ...). Overtime numbers have no side class.
  const scores: Array<{ value: number; side?: "CT" | "T" }> = [];
  for (const span of findNodes(container, (node) => node.nodeName === "span")) {
    const text = nodeText(span).trim();
    if (!/^\d+$/.test(text)) continue;
    const classes = nodeAttr(span, "class") ?? "";
    const side = /(?:^|\s)ct(?:\s|$)/.test(classes)
      ? ("CT" as const)
      : /(?:^|\s)t(?:\s|$)/.test(classes)
        ? ("T" as const)
        : undefined;
    scores.push({ value: Number(text), side });
  }
  const halves: HalfScore[] = [];
  for (let index = 0; index + 1 < scores.length; index += 2) {
    halves.push({
      team1: scores[index].value,
      team2: scores[index + 1].value,
      team1Side: scores[index].side,
    });
  }
  return halves;
}

function parseMapStatsTables(container: NodeLike): MapDetail["players"] {
  const players: NonNullable<MapDetail["players"]> = [];
  const tables = findNodes(container, (node) =>
    node.nodeName === "table" && (nodeAttr(node, "class") ?? "").includes("totalstats"),
  );
  for (const table of tables) {
    const teamId = findNodes(table, (node) => Boolean(nodeHref(node)?.match(/^\/team\/\d+\//)))
      .map((node) => nodeHref(node)?.match(/^\/team\/(\d+)\//)?.[1])
      .find(Boolean);
    if (!teamId) continue;
    for (const row of findNodes(table, (node) => node.nodeName === "tr")) {
      const cells = (row.childNodes ?? []).filter((node) => node.nodeName === "td");
      const cellText = (kind: string) => {
        const cell = cells.find((candidate) => {
          const classes = nodeAttr(candidate, "class") ?? "";
          return classes.includes(kind) && !classes.includes("hidden");
        });
        return cell ? nodeText(cell).trim() : "";
      };
      const playerCell = cells.find((cell) => (nodeAttr(cell, "class") ?? "").includes("players"));
      if (!playerCell) continue;
      const playerHref = findNodes(playerCell, (node) =>
        Boolean(nodeHref(node)?.match(/^\/player\/\d+\//)),
      )[0];
      const id = playerHref ? nodeHref(playerHref)?.match(/^\/player\/(\d+)\//)?.[1] : undefined;
      const name = findNodes(playerCell, (node) =>
        (nodeAttr(node, "class") ?? "").includes("statsPlayerName") &&
        (nodeAttr(node, "class") ?? "").includes("gtSmartphone-only"),
      ).map((node) => nodeText(node).trim())[0];
      const kd = cellText("kd").match(/^(\d+)-(\d+)$/);
      const adr = Number(cellText("adr"));
      const rating = Number(cellText("rating").match(/\d+\.\d+/)?.[0]);
      if (!id || !name || !kd || !Number.isFinite(adr) || !Number.isFinite(rating)) continue;
      players.push({
        id,
        name,
        teamId,
        kills: Number(kd[1]),
        deaths: Number(kd[2]),
        swing: cellText("roundSwing"),
        adr,
        kast: cellText("kast"),
        rating,
      });
    }
  }
  return players.length > 0 ? players : undefined;
}

function collectMapDetails(root: NodeLike | null): Map<string, MapDetail> {
  const details = new Map<string, MapDetail>();
  if (!root) return details;

  // Per-map half scores live next to each map's STATS link.
  for (const holder of findNodes(root, (node) =>
    (nodeAttr(node, "class") ?? "").includes("results-center"),
  )) {
    const link = findNodes(holder, (node) =>
      Boolean(nodeHref(node)?.match(/\/stats\/matches\/mapstatsid\/\d+\//)),
    )[0];
    const mapId = link ? nodeHref(link)?.match(/mapstatsid\/(\d+)/)?.[1] : undefined;
    const scoreBox = findNodes(holder, (node) =>
      (nodeAttr(node, "class") ?? "").includes("half-score"),
    )[0];
    if (!mapId || !scoreBox) continue;
    const halves = parseHalfScores(scoreBox);
    if (halves.length > 0) {
      details.set(mapId, { ...details.get(mapId), halves });
    }
  }

  // Per-map player stats live in containers with id "{mapstatsid}-content".
  for (const container of findNodes(root, (node) =>
    Boolean(nodeAttr(node, "id")?.match(/^\d+-content$/)),
  )) {
    const mapId = nodeAttr(container, "id")?.match(/^(\d+)-content$/)?.[1];
    if (!mapId) continue;
    const players = parseMapStatsTables(container);
    if (players) details.set(mapId, { ...details.get(mapId), players });
  }
  return details;
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

function parseVetoes(
  lines: string[],
  mapsIndex: number,
  team1Name: string,
  team2Name: string,
): VetoStep[] {
  // The veto list is a numbered block just below the "Maps" header. Only the
  // first contiguous block that starts with "1." counts, so a veto prediction
  // quoted in the comment section cannot be mistaken for the real list.
  const vetoes: VetoStep[] = [];
  let expected = 1;
  for (let index = mapsIndex; index < Math.min(lines.length, mapsIndex + 40); index += 1) {
    const numbered = lines[index].match(/^(\d+)\.\s+(.*)$/);
    if (!numbered) {
      if (expected > 1) break;
      continue;
    }
    if (Number(numbered[1]) !== expected) break;
    const rest = numbered[2];
    const step = rest.match(/^(.+?)\s+(removed|picked)\s+(.+)$/);
    const leftover = rest.match(/^(.+?) was left over$/);
    const mapName = canonicalMapName(step?.[3] ?? leftover?.[1]);
    if (!mapName) break;
    if (step) {
      const teamSide = step[1] === team1Name ? "team1" : step[1] === team2Name ? "team2" : undefined;
      if (!teamSide) break;
      vetoes.push({ teamSide, action: step[2] as "removed" | "picked", map: mapName });
    } else {
      vetoes.push({ action: "leftover", map: mapName });
    }
    expected += 1;
  }
  return vetoes;
}

function parseVrs(lines: string[]): MatchData["vrs"] {
  // The VRS box lists, in page order: team1 points and rank, a "before"
  // label, team2 points and rank, team1 diff and new rank, a "result" label,
  // and team2 diff and new rank. Rank-movement lines like "+2" are noise.
  const anchor = lines.findIndex((line) => /^VRS result/i.test(line));
  if (anchor < 0) return undefined;
  const beforePoints: number[] = [];
  const beforeRanks: number[] = [];
  const diffs: number[] = [];
  const afterRanks: number[] = [];
  for (const line of lines.slice(anchor + 1, anchor + 20)) {
    const points = line.match(/^(\d+)pt$/);
    const diff = line.match(/^([+-]\d+)pt$/);
    const rank = line.match(/^#(\d+)$/);
    if (points && beforePoints.length < 2) beforePoints.push(Number(points[1]));
    else if (diff && diffs.length < 2) diffs.push(Number(diff[1]));
    else if (rank && beforeRanks.length < beforePoints.length) beforeRanks.push(Number(rank[1]));
    else if (rank && afterRanks.length < diffs.length) afterRanks.push(Number(rank[1]));
  }
  if (beforePoints.length < 2 || beforeRanks.length < 2 || diffs.length < 2 || afterRanks.length < 2) {
    return undefined;
  }
  return {
    team1: { beforePoints: beforePoints[0], beforeRank: beforeRanks[0], diffPoints: diffs[0], afterRank: afterRanks[0] },
    team2: { beforePoints: beforePoints[1], beforeRank: beforeRanks[1], diffPoints: diffs[1], afterRank: afterRanks[1] },
  };
}

function parseHighlights(lines: string[]): string[] {
  const start = lines.indexOf("Highlights");
  if (start < 0) return [];
  const highlights: string[] = [];
  for (let index = start + 1; index < lines.length && highlights.length < 20; index += 1) {
    if (!/^M\d+R\d+\s*\|/.test(lines[index])) break;
    highlights.push(lines[index].slice(0, 300));
  }
  return highlights;
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
    // Newer HLTV copies print the country name on the line above the player.
    const country = fact?.country ?? countryCode(lines[index - 2]) ?? undefined;
    players.push({
      id,
      name,
      team: currentTeam,
      teamSide: currentTeam === team1.name ? "team1" : "team2",
      ...(country ? { country } : {}),
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
): { name: string; score: number; nameIndex: number } | null {
  const step = direction === "forward" ? 1 : -1;
  let index = direction === "forward" ? start : end - 1;
  while (index >= start && index < end) {
    const score = integerLine(lines[index]);
    const name = lines[index - 1];
    if (score !== null && name) return { name, score, nameIndex: index - 1 };
    index += step;
  }
  return null;
}

function countryAbove(lines: string[], nameIndex: number): string | undefined {
  // The team's country name sits within a few lines above the team name
  // (logo and name lines may repeat between them).
  for (let index = nameIndex - 1; index >= Math.max(0, nameIndex - 3); index -= 1) {
    const code = countryCode(lines[index]);
    if (code) return code;
  }
  return undefined;
}

function parseMain(
  lines: string[],
  htmlFacts: HtmlFacts,
  mapDetails: Map<string, MapDetail>,
): MatchData | null {
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

  const isLive = /^LIVE$/i.test(lines[statusIndex]);
  let team1Result = findSeriesTeam(lines, Math.max(0, statusIndex - 12), statusIndex, "backward");
  let team2Result = findSeriesTeam(lines, statusIndex + 1, mapsIndex, "forward");
  if ((!team1Result || !team2Result) && isLive) {
    // A live match header has no series score numbers yet. Team one sits just
    // above the start-time line; team two is the last line before "Maps".
    // Scores are derived from the finished map blocks further down.
    for (let index = statusIndex - 1; index >= Math.max(0, statusIndex - 12); index -= 1) {
      if (/^\d{1,2}:\d{2}$/.test(lines[index]) && lines[index - 1]) {
        team1Result = { name: lines[index - 1], score: -1, nameIndex: index - 1 };
        break;
      }
    }
    if (lines[mapsIndex - 1] && mapsIndex - 1 > statusIndex) {
      team2Result = { name: lines[mapsIndex - 1], score: -1, nameIndex: mapsIndex - 1 };
    }
  }
  if (!team1Result || !team2Result) return null;
  const { name: team1Name, score: score1 } = team1Result;
  const { name: team2Name, score: score2 } = team2Result;

  const team1 = findTeam(hrefs, team1Name);
  const team2 = findTeam(hrefs, team2Name);
  const team1Country = htmlFacts.teamCountries.team1 ?? countryAbove(lines, team1Result.nameIndex);
  const team2Country = htmlFacts.teamCountries.team2 ?? countryAbove(lines, team2Result.nameIndex);
  if (team1Country) team1.country = team1Country;
  if (team2Country) team2.country = team2Country;
  // The page's own canonical path is authoritative; href scanning can hit a
  // head-to-head link between the same teams.
  const source = findSourceUrl([...htmlFacts.selfMatchPaths, ...hrefs], team1Name, team2Name);
  const bestOfLine = lines.slice(mapsIndex, mapsIndex + 5).find((line) => /Best of \d+/i.test(line));
  const bestOf = Number(bestOfLine?.match(/Best of (\d+)/i)?.[1] ?? 1);
  const stageLine = lines.slice(mapsIndex, mapsIndex + 8).find((line) => line.startsWith("*"));
  const stage = stageLine?.replace(/^\*\s*/, "").split(".")[0]?.trim() ?? "";
  const state = /^Match over$/i.test(lines[statusIndex])
    ? "completed"
    : /^LIVE$/i.test(lines[statusIndex])
      ? "live"
      : "unknown";

  const maps = parseMaps(lines, team1Name, team2Name, hrefs, state).map((map) => {
    const detail = mapDetails.get(map.id);
    if (!detail) return map;
    const players = detail.players
      ?.filter((player) => player.teamId === team1.id || player.teamId === team2.id)
      .map(({ teamId, ...player }): NonNullable<MapResult["players"]>[number] => ({
        ...player,
        teamSide: teamId === team1.id ? "team1" : "team2",
      }));
    return {
      ...map,
      ...(detail.halves ? { halves: detail.halves } : {}),
      ...(players && players.length > 0 ? { players } : {}),
    };
  });
  const vetoes = parseVetoes(lines, mapsIndex, team1Name, team2Name);
  const vrs = parseVrs(lines);
  const highlights = parseHighlights(lines);
  const seriesScore: [number, number] = score1 >= 0 && score2 >= 0
    ? [score1, score2]
    : [
        maps.filter((map) => map.team1Score > map.team2Score).length,
        maps.filter((map) => map.team2Score > map.team1Score).length,
      ];

  return {
    id: source.id,
    sourceUrl: source.url,
    team1,
    team2,
    seriesScore,
    event: lines[statusIndex - 1] ?? "",
    stage,
    bestOf,
    maps,
    ...(vetoes.length > 0 ? { vetoes } : {}),
    ...(vrs ? { vrs } : {}),
    ...(highlights.length > 0 ? { highlights } : {}),
    players: parsePlayers(lines, team1, team2, htmlFacts, state),
    context: stageLine?.split(".").slice(1).join(".").trim() ?? "",
    sourceKind: "main-match",
    state,
  };
}

function parseMapStatsPlayers(
  lines: string[],
  team1Name: string,
  team2Name: string,
  hrefs: string[],
): MapPlayerStat[] {
  const playerLinks = new Map<string, string>();
  for (const href of hrefs) {
    const match = href.match(/^\/(?:stats\/players|player)\/(\d+)\/([^?#/]+)/);
    if (match && !playerLinks.has(match[2])) playerLinks.set(match[2], match[1]);
  }
  const players: MapPlayerStat[] = [];
  let side: "team1" | "team2" | "" = "";
  for (let index = 1; index < lines.length; index += 1) {
    if (lines[index] === team1Name) { side = "team1"; continue; }
    if (lines[index] === team2Name) { side = "team2"; continue; }
    // A stat row is tab-separated: "2 : 4  6  50.0%  0  20 (9)  1 (0)  18 (4)  79.4  +0.36%  1.04"
    const fields = lines[index].split("\t").map((field) => field.trim()).filter(Boolean);
    if (fields.length !== 10 || !side) continue;
    const opening = fields[0].match(/^\d+ : \d+$/);
    const kills = fields[4].match(/^(\d+) \(\d+\)$/);
    const deaths = fields[6].match(/^(\d+) \(\d+\)$/);
    const adr = Number(fields[7]);
    const swing = fields[8].match(/^[+-][\d.]+%$/) ? fields[8] : null;
    const rating = Number(fields[9]);
    const nickname = lines[index - 1];
    if (!opening || !kills || !deaths || !swing || !nickname || !Number.isFinite(adr) || !Number.isFinite(rating)) {
      continue;
    }
    players.push({
      id: playerLinks.get(slug(nickname)) ?? `name:${slug(nickname)}`,
      name: nickname,
      teamSide: side,
      kills: Number(kills[1]),
      deaths: Number(deaths[1]),
      swing,
      adr,
      kast: fields[2],
      rating,
    });
  }
  return players;
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
  const mapPlayers = parseMapStatsPlayers(lines, team1Name, team2Name, hrefs);
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
      ...(mapPlayers.length > 0 ? { players: mapPlayers } : {}),
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
    const root = capture.html ? (parseFragment(capture.html) as NodeLike) : null;
    const htmlFacts = collectHtmlFacts(root);
    const hrefs = htmlFacts.hrefs;
    const mainMatch = parseMain(lines, htmlFacts, collectMapDetails(root));
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
