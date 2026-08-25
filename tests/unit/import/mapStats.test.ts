import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parseHltvClipboard } from "../../../src/import/parseHltvClipboard";

const fixture = (name: string) =>
  readFileSync(resolve(process.cwd(), `tests/fixtures/hltv/mapstats-ancient/${name}`), "utf8");
const otFixture = (name: string) =>
  readFileSync(resolve(process.cwd(), `tests/fixtures/hltv/mapstats-ot-mirage/${name}`), "utf8");

describe("HLTV map-stat import", () => {
  it("associates a protected map-stat page to the stable match and map identities", () => {
    const proposal = parseHltvClipboard({
      plain: fixture("clipboard.txt"),
      html: fixture("clipboard.html"),
    });

    expect(proposal.kind).toBe("map-stats");
    expect(proposal.match).toMatchObject({
      id: "2397078",
      sourceUrl: "https://www.hltv.org/matches/2397078/100-thieves-vs-eternal-fire-iem-beijing-2026-open-qualifier",
      team1: { name: "100 Thieves" },
      team2: { name: "Eternal Fire" },
      seriesScore: [1, 2],
      bestOf: 3,
      maps: [{ id: "235806", name: "Ancient", team1Score: 9, team2Score: 13 }],
    });
  });

  it("extracts the per-map player stats table", () => {
    const proposal = parseHltvClipboard({
      plain: fixture("clipboard.txt"),
      html: fixture("clipboard.html"),
    });

    const players = proposal.match?.maps[0].players ?? [];
    expect(players).toHaveLength(10);
    expect(players[0]).toEqual(
      expect.objectContaining({
        name: "device",
        teamSide: "team1",
        kills: 20,
        deaths: 18,
        adr: 79.4,
        swing: "+0.36%",
        rating: 1.04,
      }),
    );
    expect(players.filter((player) => player.teamSide === "team2")).toHaveLength(5);
    expect(players.find((player) => player.name === "jottAAA")).toEqual(
      expect.objectContaining({ teamSide: "team2", kills: 19, deaths: 14, rating: 1.61 }),
    );
  });

  it("extracts regulation halves and overtime splits from the round history", () => {
    const proposal = parseHltvClipboard({
      plain: otFixture("clipboard.txt"),
      html: otFixture("clipboard.html"),
    });

    const map = proposal.match?.maps[0];
    expect(proposal.match?.team1.name).toBe("SINNERS");
    expect(proposal.match?.team2.name).toBe("EYEBALLERS");
    expect(map).toMatchObject({ name: "Mirage", team1Score: 19, team2Score: 17 });
    expect(map?.halves).toEqual([
      { team1: 8, team2: 4, team1Side: "T" },
      { team1: 4, team2: 8, team1Side: "CT" },
    ]);
    expect(map?.overtimes).toEqual([
      { team1: [2, 1], team2: [1, 2], team1FirstSide: "CT" },
      { team1: [2, 2], team2: [1, 1], team1FirstSide: "T" },
    ]);
  });

  it("anchors a stats capture to its match through the extension's URL hint", () => {
    const withoutHint = parseHltvClipboard({
      plain: otFixture("clipboard.txt"),
      html: otFixture("clipboard.html"),
    });
    expect(withoutHint.match?.id).toMatch(/^composite:/);

    const withHint = parseHltvClipboard(
      { plain: otFixture("clipboard.txt"), html: otFixture("clipboard.html") },
      { matchUrlHint: "https://www.hltv.org/matches/2396532/sinners-vs-eyeballers-esports-world-cup-2026-open-qualifier" },
    );
    expect(withHint.match?.id).toBe("2396532");
    expect(withHint.match?.sourceUrl).toBe(
      "https://www.hltv.org/matches/2396532/sinners-vs-eyeballers-esports-world-cup-2026-open-qualifier",
    );
  });

  it("parses a plain-text-only map capture conservatively with composite identities", () => {
    const proposal = parseHltvClipboard({ plain: fixture("clipboard.txt"), html: "" });
    expect(proposal.kind).toBe("map-stats");
    expect(proposal.match?.id).toMatch(/^composite:/);
    expect(proposal.match?.sourceUrl).toBe("");
    expect(proposal.match?.maps[0]).toMatchObject({ id: "map:ancient", name: "Ancient" });
    expect(proposal.confidence).toBe("review");
  });
});
