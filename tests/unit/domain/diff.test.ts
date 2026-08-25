import { describe, expect, it } from "vitest";
import { summarizeMatchChanges } from "../../../src/domain/diff";
import type { MatchData } from "../../../src/domain/types";

const match: MatchData = {
  id: "match:1",
  sourceUrl: "https://www.hltv.org/matches/1/a-vs-b",
  team1: { id: "team:a", name: "Alpha" },
  team2: { id: "team:b", name: "Bravo" },
  seriesScore: [1, 0],
  event: "Community Cup",
  stage: "Semi-final",
  bestOf: 3,
  context: "Winner advances.",
  maps: [{ id: "map:1", name: "Nuke", team1Score: 13, team2Score: 9 }],
  players: [],
};

describe("match import summaries", () => {
  it("reports the initial observations as additions", () => {
    const changes = summarizeMatchChanges(null, match);
    expect(changes.filter((change) => change.kind === "added").map((change) => change.field)).toContain(
      "map:Nuke",
    );
    expect(changes.some((change) => change.kind === "changed")).toBe(false);
  });

  it("distinguishes changes from values retained when a later source is sparse", () => {
    const next: MatchData = {
      ...match,
      seriesScore: [2, 0],
      context: "",
      maps: [],
    };
    const changes = summarizeMatchChanges(match, next);

    expect(changes).toContainEqual({ field: "series score", kind: "changed", before: "1–0", after: "2–0" });
    expect(changes).toContainEqual({ field: "context", kind: "retained", before: "Winner advances." });
    expect(changes).toContainEqual({ field: "map:Nuke", kind: "retained", before: "13–9" });
  });
});
