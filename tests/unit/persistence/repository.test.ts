import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import type { DraftLedger, MatchData } from "../../../src/domain/types";
import { createDraftRepository } from "../../../src/persistence/draftRepository";

const match: MatchData = {
  id: "m1",
  sourceUrl: "https://www.hltv.org/matches/1/example",
  team1: { id: "t1", name: "One" },
  team2: { id: "t2", name: "Two" },
  seriesScore: [2, 1],
  event: "Event",
  stage: "Final",
  bestOf: 3,
  maps: [],
  players: [],
  context: "",
};

const ledger: DraftLedger = {
  id: "draft",
  createdAt: "2026-08-24T00:00:00.000Z",
  updatedAt: "2026-08-24T00:01:00.000Z",
  imports: [{ id: "i1", active: true, capturedAt: "1", fingerprint: "fp", match }],
  manual: { stage: "Grand Final" },
};

describe("draft repository", () => {
  beforeEach(() => indexedDB.deleteDatabase("pmt-test"));

  it("round-trips authoritative draft state and active identity", async () => {
    const repository = createDraftRepository("pmt-test");
    await repository.saveAndActivate(ledger);

    expect(await repository.get(ledger.id)).toEqual(ledger);
    expect(await repository.getActiveId()).toBe(ledger.id);
    await repository.close();
  });

  it("clears one complete draft without touching another", async () => {
    const repository = createDraftRepository("pmt-test");
    await repository.save(ledger);
    await repository.save({ ...ledger, id: "other" });
    await repository.setActiveId(ledger.id);

    await repository.clear(ledger.id);

    expect(await repository.get(ledger.id)).toBeUndefined();
    expect(await repository.get("other")).toBeDefined();
    expect(await repository.getActiveId()).toBeNull();
    await repository.close();
  });
});
