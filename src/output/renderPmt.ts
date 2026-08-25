import type { MatchData, PlayerStat } from "../domain/types";
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

export type PmtIssue = "match" | "team 1" | "team 2" | "event" | "stage" | "HLTV URL";

function escapeMarkdown(value: string): string {
  const reserved = new Set("\\`*_{}[]()<>#+-.!|");
  return [...value].map((character) => (reserved.has(character) ? `\\${character}` : character)).join("");
}

function initials(name: string): string {
  const compact = name.replace(/[^A-Za-z0-9 ]/g, " ").trim().split(/\s+/);
  if (compact.length === 1) return compact[0].slice(0, 4).toUpperCase();
  return compact.map((part) => part[0]).join("").slice(0, 5).toUpperCase();
}

function mapVetoTable(match: MatchData): string {
  if (match.maps.length === 0) return "";
  const left = initials(match.team1.name);
  const right = initials(match.team2.name);
  const rows = match.maps
    .map((map) => {
      const team1Won = map.team1Score > map.team2Score;
      const left = team1Won ? `**${map.team1Score}**` : String(map.team1Score);
      const right = team1Won ? String(map.team2Score) : `**${map.team2Score}**`;
      return `|${left}|**${escapeMarkdown(map.name)}**|${right}|`;
    })
    .join("\n");
  return `### Map Vetoes\n\n|${left}|**MAP**|${right}|\n|:--:|:--:|:--:|\n${rows}`;
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

function statsTable(match: MatchData): string {
  if (match.players.length === 0) return "";
  const team1 = withFlag(escapeMarkdown(match.team1.name), match.team1.country);
  const team2 = withFlag(escapeMarkdown(match.team2.name), match.team2.country);
  return `### Full Match Stats\n\n|**Team**|**K-D**|**ADR**|**Swing**|**Rating**|\n|:--|--:|--:|--:|--:|\n|**${team1}**|||||\n${playerRows(match.players, "team1", match.team1.name)}\n|**${team2}**|||||\n${playerRows(match.players, "team2", match.team2.name)}\n\n### [HLTV Match Page](${match.sourceUrl})`;
}

export function renderPmt(match: MatchData | null): PmtOutput {
  if (!match) return { title: "", body: "", ready: false, issues: ["match"] };
  const issues: PmtIssue[] = [];
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
    mapVetoTable(match),
    statsTable({ ...match, sourceUrl }),
    "---\n\n[**This thread was created by the Post-Match Team.**](https://docs.google.com/spreadsheets/d/1k5TiV7VuDKLa41MfcDgP1XiBkPvAo_HInRmNlKKEIBM/edit?usp=sharing)  \nWant to help post these threads? Message /u/Undercover-Cactus to join the Post-Match Team.",
  ].filter(Boolean);

  return { title, body: sections.join("\n\n"), ready: issues.length === 0, issues };
}
