import type { MapResult, MatchData, PlayerStat, Team, VrsTeamImpact } from "../domain/types";
import { canonicalHltvMatchUrl } from "../domain/hltvUrl";
import { flagEmoji } from "../domain/countries";
import { eventLocationKind, findEventReference, findTeamReference } from "./referenceData";
import { containsBlockedTerm, isSafeRedditLink } from "./linkSafety";

const AWPER_MARK = "⊕";
const IGL_MARK = "♛";

export interface PmtOutput {
  title: string;
  body: string;
  ready: boolean;
  issues: PmtIssue[];
}

export type PmtIssue = "match" | "team 1" | "team 2" | "event" | "stage" | "HLTV URL";

function escapeMarkdown(value: string): string {
  const reserved = new Set("\\`*_{}[]()<>#+-.!|");
  return [...value].map((character) => (reserved.has(character) ? `\\${character}` : character)).join("");
}

/** Renders a note in the Post-Match Team's small superscript style. */
function superNote(text: string): string {
  return text.split(/\s+/).map((word) => `^${word}`).join(" ");
}

const SECTION_BREAK = "&nbsp;\n\n---";

function eventInfoSection(match: MatchData): string {
  const event = findEventReference(match.event);
  if (!event) return "";
  const kind = event.kind ?? eventLocationKind(event.city);
  const place = [event.flag, event.city].filter(Boolean).join(" ");
  const links = [
    event.liquipedia ? `[Liquipedia](${event.liquipedia})` : "",
    event.hltv ? `[HLTV](${event.hltv})` : "",
    event.reddit ? `[Reddit](${event.reddit})` : "",
  ].filter((link) => link && isSafeRedditLink(link.match(/\((.+)\)$/)?.[1] ?? ""));
  const headline = [
    `**${escapeMarkdown(event.name)}**`,
    `${place} (${event.prize || "$0"} ${kind})`.trim(),
    ...links,
  ].join(" | ");
  const streams = event.streams
    .filter((stream) => isSafeRedditLink(stream.url))
    .map((stream) => `[${stream.label}](${stream.url})`)
    .join(" | ");
  return `### Event Information\n\n${headline}${streams ? `\n\n**Streams** | ${streams}` : ""}`;
}

function fallbackRoster(match: MatchData, teamSide: "team1" | "team2", teamName: string): string[] {
  return match.players
    .filter((player) => (player.teamSide ? player.teamSide === teamSide : player.team === teamName))
    .map((player) => {
      const marks = `${player.awper ? ` ${AWPER_MARK}` : ""}${player.igl ? ` ${IGL_MARK}` : ""}`;
      return `${withFlag(escapeMarkdown(nicknameOf(player.name)), player.country)}${marks}`;
    });
}

/**
 * Adds role marks the reference roster lacks, using what this match's page
 * says. Liquipedia knows the IGL but not the AWPer; HLTV marks both.
 */
function enrichRosterEntry(entry: string, players: PlayerStat[]): string {
  const player = players.find((candidate) => {
    const nickname = nicknameOf(candidate.name).toLocaleLowerCase();
    return entry
      .toLocaleLowerCase()
      .split(/\s+/)
      .some((word) => word === nickname);
  });
  if (!player) return entry;
  let enriched = entry;
  if (player.awper && !enriched.includes(AWPER_MARK)) enriched += ` ${AWPER_MARK}`;
  if (player.igl && !enriched.includes(IGL_MARK)) enriched += ` ${IGL_MARK}`;
  return enriched;
}

function hltvTeamUrl(team: Team): string {
  if (!/^\d+$/.test(team.id)) return "";
  const slug = team.name.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return slug ? `https://www.hltv.org/team/${team.id}/${slug}` : "";
}

function teamInfoBlock(match: MatchData, team: Team, teamSide: "team1" | "team2"): string {
  const reference = findTeamReference(team.name);
  const displayName = reference?.name || team.name;
  const icon = teamIcon(team) || reference?.flagName.split(" ")[0] || "";
  // A team whose identity contains a blocked brand term gets no links at
  // all; even its profile URLs risk auto-removal.
  const blockedTeam =
    containsBlockedTerm(reference?.hltvName ?? "") || containsBlockedTerm(team.name);
  const links = blockedTeam
    ? []
    : (reference?.links ?? []).filter((link) => isSafeRedditLink(link.url));
  const hltv = hltvTeamUrl(team);
  if (!blockedTeam && hltv && isSafeRedditLink(hltv) && !links.some((link) => link.label === "HLTV")) {
    const insertAt = links.findIndex((link) => link.label === "Liquipedia") + 1;
    links.splice(insertAt, 0, { label: "HLTV", url: hltv });
  }
  const header = [
    `${icon ? `${icon} ` : ""}**${escapeMarkdown(displayName)}**`,
    ...links.map((link) => `[${link.label}](${link.url})`),
  ].join(" | ");
  const teamPlayers = match.players.filter((player) =>
    player.teamSide ? player.teamSide === teamSide : player.team === team.name,
  );
  const roster = (reference?.roster.length
    ? reference.roster.map((entry) => enrichRosterEntry(entry, teamPlayers))
    : fallbackRoster(match, teamSide, team.name));
  if (roster.length === 0 && !reference) return "";
  const lines = [header, `**Roster**: ${roster.join(" | ")}  `];
  if (reference?.coach) lines.push(`**Coach**: ${reference.coach}  `);
  if (reference?.subs.length) lines.push(`**Subs/Benched**: ${reference.subs.join(" | ")}  `);
  return lines.join("  \n");
}

function teamInfoSection(match: MatchData): string {
  const blocks = [
    teamInfoBlock(match, match.team1, "team1"),
    teamInfoBlock(match, match.team2, "team2"),
  ].filter(Boolean);
  if (blocks.length === 0) return "";
  return `### Team Information\n\n${blocks.join("\n\n")}\n\n${superNote(
    "Note: Above rosters do not reflect temporary subs and may be out of date if recent changes were made",
  )}`;
}

function vrsSection(match: MatchData): string {
  const vrs = match.vrs;
  if (!vrs) return "";
  const row = (team: Team, impact: VrsTeamImpact) => {
    const rank = escapeMarkdown(`#${impact.beforeRank} → #${impact.afterRank}`);
    const diff = escapeMarkdown(`${impact.diffPoints >= 0 ? "+" : ""}${impact.diffPoints} pts`);
    const total = `${impact.beforePoints + impact.diffPoints} pts`;
    return `|${teamLabel(team)}|${rank}|${diff}|${total}|`;
  };
  return `### Predicted VRS Impact\n\n|**Team**|**Rank**|**Diff**|**Total**|\n|:--|:--:|--:|--:|\n${row(match.team1, vrs.team1)}\n${row(match.team2, vrs.team2)}\n\n${superNote(
    "Note: VRS officially updates once per month. This is simply a prediction that might not take into account all factors that go into VRS calculations.",
  )}`;
}

function highlightsSection(match: MatchData): string {
  const highlights = match.highlights ?? [];
  if (highlights.length === 0) return "";
  return `### Highlights\n\n${highlights.map((line) => `${escapeMarkdown(line)}  `).join("\n")}`;
}

function mapVetoTable(match: MatchData): string {
  const vetoes = match.vetoes ?? [];
  if (vetoes.length === 0) return "";
  const rows = vetoes
    .map((veto) => {
      const mark = veto.action === "picked" ? "✔" : veto.action === "removed" ? "X" : "";
      const left = veto.teamSide === "team1" ? mark : "";
      const right = veto.teamSide === "team2" ? mark : "";
      return `|${left}|${escapeMarkdown(veto.map.toLowerCase())}|${right}|`;
    })
    .join("\n");
  return `### Map Vetoes\n\n|${escapeMarkdown(match.team1.name)}|**MAP**|${escapeMarkdown(match.team2.name)}|\n|:--:|:--:|:--:|\n${rows}`;
}

function withFlag(name: string, country: string | undefined): string {
  const flag = flagEmoji(country);
  return flag ? `${flag} ${name}` : name;
}

/**
 * Prefers the reference database's display names over HLTV's, everywhere in
 * the post — including cases like gambling org names Reddit may auto-remove.
 */
function applyDisplayNames(match: MatchData): MatchData {
  const name1 = findTeamReference(match.team1.name)?.name ?? match.team1.name;
  const name2 = findTeamReference(match.team2.name)?.name ?? match.team2.name;
  if (name1 === match.team1.name && name2 === match.team2.name) return match;
  return {
    ...match,
    team1: { ...match.team1, name: name1 },
    team2: { ...match.team2, name: name2 },
    players: match.players.map((player) => ({
      ...player,
      team: player.team === match.team1.name ? name1 : player.team === match.team2.name ? name2 : player.team,
    })),
  };
}

/**
 * A team's flag as a subreddit stylesheet icon when a logo code is known
 * ("[🇷🇺](#betboom-logo)" renders the logo on r/GlobalOffensive and degrades
 * to the flag elsewhere), else the plain emoji flag.
 */
function teamIcon(team: Team): string {
  const reference = findTeamReference(team.name);
  const flag = flagEmoji(team.country) ?? reference?.logoFlag ?? "";
  if (reference?.logoCode) {
    const suffix = reference.logoCode.startsWith("lang-") ? "" : "-logo";
    return `[${flag || reference.logoFlag || "🏳️"}](#${reference.logoCode}${suffix})`;
  }
  return flag;
}

function teamLabel(team: Team): string {
  const icon = teamIcon(team);
  return `${icon ? `${icon} ` : ""}${escapeMarkdown(team.name)}`;
}

function nicknameOf(name: string): string {
  return name.match(/'([^']+)'/)?.[1] ?? name;
}

function playerCell(player: PlayerStat): string {
  const marks = `${player.awper ? ` ${AWPER_MARK}` : ""}${player.igl ? ` ${IGL_MARK}` : ""}`;
  return `${withFlag(escapeMarkdown(nicknameOf(player.name)), player.country)}${marks}`;
}

function playerRows(
  players: PlayerStat[],
  teamSide: "team1" | "team2",
  teamName: string,
): string {
  return players
    .filter((player) => player.teamSide ? player.teamSide === teamSide : player.team === teamName)
    .map(
      (player) =>
        `|${playerCell(player)}|${player.kills}-${player.deaths}|${player.adr.toFixed(1)}|${escapeMarkdown(player.swing)}|${player.rating.toFixed(2)}|`,
    )
    .join("\n");
}

const STATS_HEADER = "|**Team**|**K-D**|**ADR**|**Swing**|**Rating**|\n|:--|--:|--:|--:|--:|";

function statsTable(match: MatchData): string {
  if (match.players.length === 0) return "";
  const team1 = teamLabel(match.team1);
  const team2 = teamLabel(match.team2);
  return `### Full Match Stats\n\n${STATS_HEADER}\n|**${team1}**|||||\n${playerRows(match.players, "team1", match.team1.name)}\n|**${team2}**|||||\n${playerRows(match.players, "team2", match.team2.name)}\n\n### [HLTV Match Page](${match.sourceUrl})`;
}

function oppositeSide(side: "CT" | "T"): "CT" | "T" {
  return side === "CT" ? "T" : "CT";
}

/** "OT1^(CT:T)" — the superscript is the side order for that row's team. */
function overtimeHeading(index: number, firstSide: "CT" | "T" | undefined, bold: boolean): string {
  const sides = firstSide ? `^(${firstSide}:${oppositeSide(firstSide)})` : "";
  const label = `OT${index + 1}${sides}`;
  return bold ? `**${label}**` : label;
}

function halvesTable(map: MapResult, match: MatchData): string {
  const halves = map.halves ?? [];
  if (halves.length < 2) return "";
  const [first, second] = halves;
  const structured = map.overtimes ?? [];
  // Without per-half overtime detail, fall back to one column per overtime
  // with each team's round total.
  const flatOvertime = structured.length > 0 ? [] : halves.slice(2);
  const sidesKnown = Boolean(first.team1Side && second.team1Side);
  const header = [
    "**Team**",
    sidesKnown ? `**${first.team1Side}**` : "**1st**",
    sidesKnown ? `**${second.team1Side}**` : "**2nd**",
    ...structured.map((overtime, index) => overtimeHeading(index, overtime.team1FirstSide, true)),
    ...flatOvertime.map((_, index) => `**OT${flatOvertime.length > 1 ? index + 1 : ""}**`),
    "**Total**",
  ];
  const align = ["|:--", ...header.slice(1).map(() => "--:"), ""].join("|");
  const team1Row = [
    teamLabel(match.team1),
    first.team1,
    second.team1,
    ...structured.map((overtime) => `${overtime.team1[0]}:${overtime.team1[1]}`),
    ...flatOvertime.map((half) => half.team1),
    `**${map.team1Score}**`,
  ];
  const team2Row = [
    teamLabel(match.team2),
    first.team2,
    second.team2,
    ...structured.map((overtime) => `${overtime.team2[0]}:${overtime.team2[1]}`),
    ...flatOvertime.map((half) => half.team2),
    `**${map.team2Score}**`,
  ];
  const sideLabelRow = sidesKnown
    ? [
        "",
        oppositeSide(first.team1Side!),
        oppositeSide(second.team1Side!),
        ...structured.map((overtime, index) =>
          overtimeHeading(index, flipOvertimeSide(overtime.team1FirstSide), false),
        ),
        ...flatOvertime.map(() => ""),
        "",
      ]
    : null;
  const row = (cells: Array<string | number>) => `|${cells.join("|")}|`;
  return [
    row(header),
    align,
    row(team1Row),
    sideLabelRow ? row(sideLabelRow) : "",
    row(team2Row),
  ].filter(Boolean).join("\n");
}

function flipOvertimeSide(side: "CT" | "T" | undefined): "CT" | "T" | undefined {
  return side ? oppositeSide(side) : undefined;
}

const MAP_STATS_URL = /^https:\/\/www\.hltv\.org\/stats\/matches\/mapstatsid\/\d+\/[A-Za-z0-9-]+$/;

function mapStatsTable(map: MapResult, match: MatchData): string {
  const players = map.players ?? [];
  if (players.length === 0) return "";
  const matchPlayerById = new Map(match.players.map((player) => [player.id, player]));
  const matchPlayerByNick = new Map(
    match.players.map((player) => [nicknameOf(player.name).toLowerCase(), player]),
  );
  const rows = (teamSide: "team1" | "team2") =>
    players
      .filter((player) => player.teamSide === teamSide)
      .map((player) => {
        const matchPlayer =
          matchPlayerById.get(player.id) ??
          matchPlayerByNick.get(nicknameOf(player.name).toLowerCase());
        const marks = `${matchPlayer?.awper ? ` ${AWPER_MARK}` : ""}${matchPlayer?.igl ? ` ${IGL_MARK}` : ""}`;
        const cell = `${withFlag(escapeMarkdown(nicknameOf(player.name)), matchPlayer?.country)}${marks}`;
        return `|${cell}|${player.kills}-${player.deaths}|${player.adr.toFixed(1)}|${escapeMarkdown(player.swing)}|${player.rating.toFixed(2)}|`;
      })
      .join("\n");
  const team1 = teamLabel(match.team1);
  const team2 = teamLabel(match.team2);
  return `${STATS_HEADER}\n|**${team1}**|||||\n${rows("team1")}\n|**${team2}**|||||\n${rows("team2")}`;
}

function mapSection(map: MapResult, match: MatchData, index: number): string {
  const statsLink = map.statsUrl && MAP_STATS_URL.test(map.statsUrl)
    ? `### [${escapeMarkdown(map.name)} Detailed Stats](${map.statsUrl})`
    : "";
  const parts = [
    `### MAP ${index + 1}: ${escapeMarkdown(map.name)}`,
    halvesTable(map, match),
    mapStatsTable(map, match),
    statsLink,
  ].filter(Boolean);
  return parts.length > 1 ? parts.join("\n\n") : "";
}

export function renderPmt(input: MatchData | null): PmtOutput {
  if (!input) return { title: "", body: "", ready: false, issues: ["match"] };
  const match = applyDisplayNames(input);
  const issues: PmtIssue[] = [];
  if (!match.team1.name) issues.push("team 1");
  if (!match.team2.name) issues.push("team 2");
  if (!match.event) issues.push("event");
  if (!match.stage) issues.push("stage");
  const sourceUrl = canonicalHltvMatchUrl(match.sourceUrl) ?? "";
  if (!sourceUrl) issues.push("HLTV URL");

  const title = `${match.team1.name} vs ${match.team2.name} / ${match.event} - ${match.stage} / Post-Match Discussion`;
  const maps = match.maps.map((map) => `**${escapeMarkdown(map.name)}:** ${map.team1Score}-${map.team2Score}  `).join("\n");
  const flag1 = teamIcon(match.team1);
  const flag2 = teamIcon(match.team2);
  const sections = [
    `# ${escapeMarkdown(match.team1.name)}${flag1 ? ` ${flag1}` : ""} [${match.seriesScore[0]}-${match.seriesScore[1]}](${sourceUrl})${flag2 ? ` ${flag2}` : ""} ${escapeMarkdown(match.team2.name)}`,
    maps,
    match.context ? `**${escapeMarkdown(match.context)}**  ` : "",
    "&nbsp;\n\n-----",
    ...[vrsSection(match), eventInfoSection(match), teamInfoSection(match)]
      .filter(Boolean)
      .flatMap((section) => [section, SECTION_BREAK]),
    mapVetoTable(match),
    statsTable({ ...match, sourceUrl }),
    ...match.maps.map((map, index) => mapSection(map, match, index)),
    highlightsSection(match),
    "---\n\n[**This thread was created by the Post-Match Team.**](https://docs.google.com/spreadsheets/d/1k5TiV7VuDKLa41MfcDgP1XiBkPvAo_HInRmNlKKEIBM/edit?usp=sharing)  \nWant to help post these threads? Message /u/Undercover-Cactus to join the Post-Match Team.",
  ].filter(Boolean);

  return { title, body: sections.join("\n\n"), ready: issues.length === 0, issues };
}
