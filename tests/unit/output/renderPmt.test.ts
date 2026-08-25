import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { renderPmt } from "../../../src/output/renderPmt";
import type { MatchData } from "../../../src/domain/types";

const match: MatchData = {
  id: "2397078",
  sourceUrl:
    "https://www.hltv.org/matches/2397078/100-thieves-vs-eternal-fire-iem-beijing-2026-open-qualifier",
  team1: { id: "8474", name: "100 Thieves" },
  team2: { id: "11251", name: "Eternal Fire" },
  seriesScore: [1, 2],
  event: "IEM Beijing 2026 Open Qualifier",
  stage: "Quarter-final",
  bestOf: 3,
  context: "Eternal Fire advance to the closed qualifier.",
  maps: [
    { id: "235806", name: "Ancient", team1Score: 9, team2Score: 13 },
    { id: "235812", name: "Dust2", team1Score: 13, team2Score: 7 },
    { id: "235818", name: "Mirage", team1Score: 10, team2Score: 13 },
  ],
  vetoes: [
    { teamSide: "team2", action: "removed", map: "Nuke" },
    { teamSide: "team1", action: "removed", map: "Cache" },
    { teamSide: "team2", action: "picked", map: "Ancient" },
    { teamSide: "team1", action: "picked", map: "Dust2" },
    { teamSide: "team2", action: "removed", map: "Inferno" },
    { teamSide: "team1", action: "removed", map: "Anubis" },
    { action: "leftover", map: "Mirage" },
  ],
  players: [],
};

describe("renderPmt", () => {
  it("renders the established PMT title and core body", () => {
    const output = renderPmt(match);
    expect(output.title).toBe(readFileSync(resolve(process.cwd(), "tests/golden/pmt/completed-bo3.title.txt"), "utf8").trimEnd());
    expect(output.body).toBe(readFileSync(resolve(process.cwd(), "tests/golden/pmt/completed-bo3.body.txt"), "utf8").trimEnd());
    expect(output.body).toContain("# 100 Thieves [1-2](https://www.hltv.org/matches/");
    expect(output.body).toContain("**Ancient:** 9-13");
    expect(output.body).toContain("### Map Vetoes");
    expect(output.body).not.toContain("###Map Vetoes");
    expect(output.body).toContain("|100 Thieves|**MAP**|Eternal Fire|");
    expect(output.body).toContain("||nuke|X|");
    expect(output.body).toContain("|✔|dust2||");
    expect(output.body).toContain("||mirage||");
    expect(output.body).toContain("This thread was created by the Post-Match Team");
    expect(output.ready).toBe(true);
  });

  it("renders team flags, player flags, nicknames, and role marks", () => {
    const output = renderPmt({
      ...match,
      team1: { ...match.team1, country: "BR" },
      team2: { ...match.team2, country: "EU" },
      players: [
        {
          id: "p1",
          name: "Gabriel 'FalleN' Toledo",
          team: "100 Thieves",
          teamSide: "team1",
          country: "BR",
          igl: true,
          kills: 45,
          deaths: 44,
          swing: "-0.15%",
          adr: 64,
          kast: "72.2%",
          rating: 1.03,
        },
        {
          id: "p2",
          name: "Danil 'molodoy' Golubenko",
          team: "100 Thieves",
          teamSide: "team1",
          country: "KZ",
          awper: true,
          kills: 55,
          deaths: 50,
          swing: "+0.35%",
          adr: 80.8,
          kast: "75.0%",
          rating: 1.08,
        },
      ],
    });

    expect(output.body).toContain("# 100 Thieves 🇧🇷 [1-2](");
    expect(output.body).toContain(") 🇪🇺 Eternal Fire");
    expect(output.body).toContain("|**🇧🇷 100 Thieves**|||||");
    expect(output.body).toContain("|🇧🇷 FalleN ♛|45-44|");
    expect(output.body).toContain("|🇰🇿 molodoy ⊕|55-50|");
  });

  it("renders the VRS impact table and the highlights list", () => {
    const output = renderPmt({
      ...match,
      team1: { ...match.team1, country: "BR" },
      vrs: {
        team1: { beforePoints: 1844, beforeRank: 5, diffPoints: -13, afterRank: 5 },
        team2: { beforePoints: 1859, beforeRank: 4, diffPoints: 45, afterRank: 3 },
      },
      highlights: ["M1R7 | cmtry - 4 AK kills - Part 1 - observer"],
    });

    expect(output.body).toContain("### Predicted VRS Impact");
    expect(output.body).toContain("|🇧🇷 100 Thieves|\\#5 → \\#5|\\-13 pts|1831 pts|");
    expect(output.body).toContain("|Eternal Fire|\\#4 → \\#3|\\+45 pts|1904 pts|");
    expect(output.body).toContain("Note: VRS officially updates once per month.");
    expect(output.body).toContain("### Highlights");
    expect(output.body).toContain("M1R7 \\| cmtry \\- 4 AK kills \\- Part 1 \\- observer");
  });

  it("omits the VRS and highlights sections when the data is missing", () => {
    const output = renderPmt(match);
    expect(output.body).not.toContain("Predicted VRS Impact");
    expect(output.body).not.toContain("### Highlights");
  });

  it("omits flags and marks when the data is missing", () => {
    const output = renderPmt({
      ...match,
      players: [{
        id: "p1",
        name: "Ace",
        team: "100 Thieves",
        teamSide: "team1",
        kills: 20,
        deaths: 10,
        swing: "+2%",
        adr: 90,
        kast: "80%",
        rating: 1.25,
      }],
    });

    expect(output.body).toContain("# 100 Thieves [1-2](");
    expect(output.body).toContain("|**100 Thieves**|||||");
    expect(output.body).toContain("|Ace|20-10|");
  });

  it("blocks readiness when a core field is missing", () => {
    const output = renderPmt({ ...match, event: "" });
    expect(output.ready).toBe(false);
    expect(output.issues).toContain("event");
  });

  it("blocks copying while the match is live but still builds the draft", () => {
    const output = renderPmt({ ...match, state: "live" });
    expect(output.ready).toBe(false);
    expect(output.issues).toContain("match live");
    expect(output.title).toContain("Post-Match Discussion");
    expect(output.body).toContain("### Map Vetoes");
  });

  it("puts a space after every Markdown heading marker", () => {
    const output = renderPmt({
      ...match,
      players: [{
        id: "player-1",
        name: "Ace",
        team: "100 Thieves",
        teamSide: "team1",
        kills: 20,
        deaths: 10,
        swing: "+2%",
        adr: 90,
        kast: "80%",
        rating: 1.25,
      }],
    });

    expect(output.body).toContain("### Full Match Stats");
    expect(output.body).not.toMatch(/^#{1,6}[^#\s]/m);
  });

  it("rejects non-canonical source URLs before building Markdown", () => {
    const output = renderPmt({
      ...match,
      sourceUrl: "https://attacker.invalid/) [click](https://attacker.invalid",
    });
    expect(output.ready).toBe(false);
    expect(output.issues).toContain("HLTV URL");
    expect(output.body).not.toContain("attacker.invalid");
  });
});
