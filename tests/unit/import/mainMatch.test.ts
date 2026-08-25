import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parseHltvClipboard } from "../../../src/import/parseHltvClipboard";

const plain = readFileSync(
  resolve(process.cwd(), "tests/fixtures/hltv/completed-bo3/clipboard.txt"),
  "utf8",
);
const html = readFileSync(
  resolve(process.cwd(), "tests/fixtures/hltv/completed-bo3/clipboard.html"),
  "utf8",
);

describe("parseHltvClipboard", () => {
  it("parses the real completed BO3 capture", () => {
    const result = parseHltvClipboard({ plain, html });

    expect(result.kind, JSON.stringify(result)).toBe("main-match");
    expect(result.confidence, JSON.stringify(result)).toBe("confident");
    expect(result.match?.id).toBe("2397078");
    expect(result.match?.team1.name).toBe("100 Thieves");
    expect(result.match?.team2.name).toBe("Eternal Fire");
    expect(result.match?.seriesScore).toEqual([1, 2]);
    expect(result.match?.event).toBe("IEM Beijing 2026 Open Qualifier");
    expect(result.match?.stage).toBe("Quarter-final");
    expect(result.match?.maps).toEqual([
      expect.objectContaining({ id: "235806", name: "Ancient", team1Score: 9, team2Score: 13 }),
      expect.objectContaining({ id: "235812", name: "Dust2", team1Score: 13, team2Score: 7 }),
      expect.objectContaining({ id: "235818", name: "Mirage", team1Score: 10, team2Score: 13 }),
    ]);
    expect(result.match?.players).toHaveLength(10);
    expect(result.match?.players[0]).toEqual(
      expect.objectContaining({ team: "100 Thieves", kills: 44, deaths: 42 }),
    );
  });

  it("rejects unrelated and over-budget input without guessing", () => {
    expect(parseHltvClipboard({ plain: "hello", html: "" }).kind).toBe("unrecognized");
    const oversized = parseHltvClipboard({ plain: "x".repeat(130_000), html: "" });
    expect(oversized.kind).toBe("rejected");
    expect(oversized.diagnostics[0]).toMatch(/too large/i);
  });
});
