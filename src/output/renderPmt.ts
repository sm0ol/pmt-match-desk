import type { MapResult, MatchData, PlayerStat, Team, VrsTeamImpact } from "../domain/types";
import { canonicalHltvMatchUrl } from "../domain/hltvUrl";
import { flagEmoji } from "../domain/countries";

const AWPER_MARK = "⊕";
const IGL_MARK = "♛";

export interface PmtOutput {
  title: string;
  body: string;
  ready: boolean;
  issues: PmtIssue[];
}

export type PmtIssue = "match" | "match live" | "team 1" | "team 2" | "event" | "stage" | "HLTV URL";

function escapeMarkdown(value: string): string {
  const reserved = new Set("\\`*_{}[]()<>#+-.!|");
  return [...value].map((character) => (reserved.has(character) ? `\\${character}` : character)).join("");
}

function vrsSection(match: MatchData): string {
  const vrs = match.vrs;
  if (!vrs) return "";
  const row = (team: Team, impact: VrsTeamImpact) => {
    const rank = escapeMarkdown(`#${impact.beforeRank} → #${impact.afterRank}`);
    const diff = escapeMarkdown(`${impact.diffPoints >= 0 ? "+" : ""}${impact.diffPoints} pts`);
    const total = `${impact.beforePoints + impact.diffPoints} pts`;
    return `|${withFlag(escapeMarkdown(team.name), team.country)}|${rank}|${diff}|${total}|`;
  };
  return `### Predicted VRS Impact\n\n|**Team**|**Rank**|**Diff**|**Total**|\n|:--|:--:|--:|--:|\n${row(match.team1, vrs.team1)}\n${row(match.team2, vrs.team2)}\n\nNote: VRS officially updates once per month. This is simply a prediction that might not take into account all factors that go into VRS calculations.`;
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
  const team1 = withFlag(escapeMarkdown(match.team1.name), match.team1.country);
  const team2 = withFlag(escapeMarkdown(match.team2.name), match.team2.country);
  return `### Full Match Stats\n\n${STATS_HEADER}\n|**${team1}**|||||\n${playerRows(match.players, "team1", match.team1.name)}\n|**${team2}**|||||\n${playerRows(match.players, "team2", match.team2.name)}\n\n### [HLTV Match Page](${match.sourceUrl})`;
}

function oppositeSide(side: "CT" | "T"): "CT" | "T" {
  return side === "CT" ? "T" : "CT";
}

function halvesTable(map: MapResult, match: MatchData): string {
  const halves = map.halves ?? [];
  if (halves.length < 2) return "";
  const [first, second] = halves;
  const overtime = halves.slice(2);
  const sidesKnown = Boolean(first.team1Side && second.team1Side);
  const otHeaders = overtime.map((_, index) => `**OT${overtime.length > 1 ? index + 1 : ""}**`);
  const header = [
    "**Team**",
    sidesKnown ? `**${first.team1Side}**` : "**1st**",
    sidesKnown ? `**${second.team1Side}**` : "**2nd**",
    ...otHeaders,
    "**Total**",
  ];
  const align = ["|:--", ...header.slice(1).map(() => "--:"), ""].join("|");
  const team1Row = [
    withFlag(escapeMarkdown(match.team1.name), match.team1.country),
    first.team1,
    second.team1,
    ...overtime.map((half) => half.team1),
    `**${map.team1Score}**`,
  ];
  const team2Row = [
    withFlag(escapeMarkdown(match.team2.name), match.team2.country),
    first.team2,
    second.team2,
    ...overtime.map((half) => half.team2),
    `**${map.team2Score}**`,
  ];
  const sideLabelRow = sidesKnown
    ? ["", oppositeSide(first.team1Side!), oppositeSide(second.team1Side!), ...overtime.map(() => ""), ""]
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
  const team1 = withFlag(escapeMarkdown(match.team1.name), match.team1.country);
  const team2 = withFlag(escapeMarkdown(match.team2.name), match.team2.country);
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

export function renderPmt(match: MatchData | null): PmtOutput {
  if (!match) return { title: "", body: "", ready: false, issues: ["match"] };
  const issues: PmtIssue[] = [];
  if (match.state === "live") issues.push("match live");
  if (!match.team1.name) issues.push("team 1");
  if (!match.team2.name) issues.push("team 2");
  if (!match.event) issues.push("event");
  if (!match.stage) issues.push("stage");
  const sourceUrl = canonicalHltvMatchUrl(match.sourceUrl) ?? "";
  if (!sourceUrl) issues.push("HLTV URL");

  const title = `${match.team1.name} vs ${match.team2.name} / ${match.event} - ${match.stage} / Post-Match Discussion`;
  const maps = match.maps.map((map) => `**${escapeMarkdown(map.name)}:** ${map.team1Score}-${map.team2Score}  `).join("\n");
  const flag1 = flagEmoji(match.team1.country);
  const flag2 = flagEmoji(match.team2.country);
  const sections = [
    `# ${escapeMarkdown(match.team1.name)}${flag1 ? ` ${flag1}` : ""} [${match.seriesScore[0]}-${match.seriesScore[1]}](${sourceUrl})${flag2 ? ` ${flag2}` : ""} ${escapeMarkdown(match.team2.name)}`,
    maps,
    match.context ? `**${escapeMarkdown(match.context)}**  ` : "",
    "&nbsp;\n\n-----",
    vrsSection(match),
    mapVetoTable(match),
    statsTable({ ...match, sourceUrl }),
    ...match.maps.map((map, index) => mapSection(map, match, index)),
    highlightsSection(match),
    "---\n\n[**This thread was created by the Post-Match Team.**](https://docs.google.com/spreadsheets/d/1k5TiV7VuDKLa41MfcDgP1XiBkPvAo_HInRmNlKKEIBM/edit?usp=sharing)  \nWant to help post these threads? Message /u/Undercover-Cactus to join the Post-Match Team.",
  ].filter(Boolean);

  return { title, body: sections.join("\n\n"), ready: issues.length === 0, issues };
}
