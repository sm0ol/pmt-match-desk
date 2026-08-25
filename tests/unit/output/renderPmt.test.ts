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
  players: [],
};

describe("renderPmt", () => {
  it("renders the established PMT title and core body", () => {
    const output = renderPmt(match);
    expect(output.title).toBe(readFileSync(resolve(process.cwd(), "tests/golden/pmt/completed-bo3.title.txt"), "utf8").trimEnd());
    expect(output.body).toBe(readFileSync(resolve(process.cwd(), "tests/golden/pmt/completed-bo3.body.txt"), "utf8").trimEnd());
    expect(output.body).toContain("#100 Thieves [1-2](https://www.hltv.org/matches/");
    expect(output.body).toContain("**Ancient:** 9-13");
    expect(output.body).toContain("###Map Vetoes");
    expect(output.body).toContain("|9|**Ancient**|**13**|");
    expect(output.body).toContain("|**13**|**Dust2**|7|");
    expect(output.body).toContain("This thread was created by the Post-Match Team");
    expect(output.ready).toBe(true);
  });

  it("blocks readiness when a core field is missing", () => {
    const output = renderPmt({ ...match, event: "" });
    expect(output.ready).toBe(false);
    expect(output.issues).toContain("event");
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
