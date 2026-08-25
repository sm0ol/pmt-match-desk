import { describe, expect, it } from "vitest";
import { replayDraft } from "../../../src/domain/replay";
import { renderPmt } from "../../../src/output/renderPmt";
import type { DraftLedger, MatchData } from "../../../src/domain/types";

const match: MatchData = {
  id: "match-1",
  sourceUrl: "https://www.hltv.org/matches/1/example",
  team1: { id: "one", name: "One" },
  team2: { id: "two", name: "Two" },
  seriesScore: [2, 0],
  event: "Event",
  stage: "Final",
  bestOf: 3,
  maps: [],
  players: [],
  context: "",
};

describe("replayDraft", () => {
  it("keeps human-owned fields through later imports and exposes a conflict", () => {
    const ledger: DraftLedger = {
      id: "draft-1",
      createdAt: "2026-08-24T00:00:00.000Z",
      updatedAt: "2026-08-24T00:00:00.000Z",
      imports: [
        { id: "a", capturedAt: "1", active: true, fingerprint: "a", match },
        {
          id: "b",
          capturedAt: "2",
          active: true,
          fingerprint: "b",
          match: { ...match, stage: "Grand Final" },
        },
      ],
      manual: { stage: "Upper Final" },
      manualBaselines: { stage: "Final" },
    };

    const projection = replayDraft(ledger);
    expect(projection.match?.stage).toBe("Upper Final");
    expect(projection.conflicts).toEqual([
      expect.objectContaining({ field: "stage", imported: "Grand Final" }),
    ]);
  });

  it("treats a fresh manual correction as owned rather than conflicted", () => {
    const ledger: DraftLedger = {
      id: "draft-1",
      createdAt: "1",
      updatedAt: "2",
      imports: [{ id: "a", capturedAt: "1", active: true, fingerprint: "a", match }],
      manual: { stage: "Community Final" },
      manualBaselines: { stage: "Final" },
    };

    const projection = replayDraft(ledger);
    expect(projection.match?.stage).toBe("Community Final");
    expect(projection.conflicts).toEqual([]);
  });

  it("keeps a manually supplied source URL through later imports", () => {
    const correctedUrl = "https://www.hltv.org/matches/2/one-vs-two-event";
    const ledger: DraftLedger = {
      id: "draft-1",
      createdAt: "1",
      updatedAt: "2",
      imports: [
        { id: "a", capturedAt: "1", active: true, fingerprint: "a", match: { ...match, sourceUrl: "" } },
        { id: "b", capturedAt: "2", active: true, fingerprint: "b", match: { ...match, sourceUrl: "" } },
      ],
      manual: { sourceUrl: correctedUrl },
      manualBaselines: { sourceUrl: "" },
    };

    expect(replayDraft(ledger).match?.sourceUrl).toBe(correctedUrl);
  });

  it("keeps completed results when a stale live snapshot arrives later", () => {
    const live = { ...match, state: "live" as const, sourceKind: "main-match" as const, seriesScore: [1, 0] as [number, number] };
    const final = { ...match, state: "completed" as const, sourceKind: "main-match" as const, seriesScore: [1, 2] as [number, number] };
    const ledgerFor = (imports: MatchData[]): DraftLedger => ({
      id: "draft-1",
      createdAt: "1",
      updatedAt: "2",
      imports: imports.map((entry, index) => ({
        id: String(index),
        capturedAt: String(index),
        active: true,
        fingerprint: String(index),
        match: entry,
      })),
      manual: {},
    });

    expect(replayDraft(ledgerFor([live, final])).match?.seriesScore).toEqual([1, 2]);
    expect(replayDraft(ledgerFor([final, live])).match?.seriesScore).toEqual([1, 2]);
  });

  it("reverts one import without erasing manual work", () => {
    const ledger: DraftLedger = {
      id: "draft-1",
      createdAt: "1",
      updatedAt: "2",
      imports: [
        { id: "a", capturedAt: "1", active: true, fingerprint: "a", match },
        {
          id: "b",
          capturedAt: "2",
          active: false,
          fingerprint: "b",
          match: { ...match, seriesScore: [2, 1] },
        },
      ],
      manual: { context: "Winner advances." },
    };

    const projection = replayDraft(ledger);
    expect(projection.match?.seriesScore).toEqual([2, 0]);
    expect(projection.match?.context).toBe("Winner advances.");
  });

  it("keeps a manually corrected map score through later parser updates", () => {
    const first = { ...match, maps: [{ id: "map:1", name: "Nuke", team1Score: 13, team2Score: 9 }] };
    const ledger: DraftLedger = {
      id: "draft-1",
      createdAt: "1",
      updatedAt: "2",
      imports: [
        { id: "a", capturedAt: "1", active: true, fingerprint: "a", match: first },
        {
          id: "b",
          capturedAt: "2",
          active: true,
          fingerprint: "b",
          match: { ...first, maps: [{ ...first.maps[0], team1Score: 11 }] },
        },
      ],
      manual: {},
      manualMaps: { "map:1": { team1Score: 16 } },
    };

    expect(replayDraft(ledger).match?.maps[0].team1Score).toBe(16);
  });

  it("replays human-owned player-stat corrections", () => {
    const withPlayer = {
      ...match,
      players: [{ id: "player:1", name: "Ace", team: "One", kills: 20, deaths: 10, swing: "+5%", adr: 95, kast: "80%", rating: 1.3 }],
    };
    const ledger: DraftLedger = {
      id: "draft-1",
      createdAt: "1",
      updatedAt: "2",
      imports: [{ id: "a", capturedAt: "1", active: true, fingerprint: "a", match: withPlayer }],
      manual: {},
      manualPlayers: { "player:1": { kills: 25, rating: 1.5 } },
    };

    expect(replayDraft(ledger).match?.players[0]).toMatchObject({ kills: 25, rating: 1.5 });
  });

  it("keeps player rows grouped after a team-name correction", () => {
    const withPlayer = {
      ...match,
      players: [{
        id: "player:1",
        name: "Ace",
        team: "One",
        teamSide: "team1" as const,
        kills: 20,
        deaths: 10,
        swing: "+5%",
        adr: 95,
        kast: "80%",
        rating: 1.3,
      }],
    };
    const ledger: DraftLedger = {
      id: "draft-1",
      createdAt: "1",
      updatedAt: "2",
      imports: [{ id: "a", capturedAt: "1", active: true, fingerprint: "a", match: withPlayer }],
      manual: { team1Name: "Community One" },
      manualBaselines: { team1Name: "One" },
    };

    const projection = replayDraft(ledger);
    expect(projection.match?.players[0].team).toBe("Community One");
    expect(renderPmt(projection.match).body).toContain("|Ace|20-10|");
  });
});
