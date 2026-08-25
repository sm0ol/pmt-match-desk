import { beforeEach, describe, expect, it } from "vitest";
import type { DraftLedger } from "../../../src/domain/types";
import {
  acknowledgeManualOperation,
  appendManualOperation,
  applyManualOperation,
  loadManualJournal,
} from "../../../src/persistence/manualJournal";

const ledger: DraftLedger = {
  id: "draft-1",
  createdAt: "1",
  updatedAt: "1",
  imports: [],
  manual: {},
};

describe("manual recovery journal", () => {
  beforeEach(() => localStorage.clear());

  it("replays and acknowledges a scalar edit idempotently", () => {
    const operation = {
      version: 1 as const,
      kind: "scalar" as const,
      draftId: ledger.id,
      operationId: "operation-1",
      field: "stage" as const,
      value: "Community Final",
      baseline: "Final",
    };
    appendManualOperation(operation);
    appendManualOperation(operation);

    const stored = loadManualJournal();
    expect(stored).toHaveLength(1);
    const once = applyManualOperation(ledger, stored[0]);
    const twice = applyManualOperation(once, stored[0]);
    expect(twice.manual.stage).toBe("Community Final");
    expect(twice.manualBaselines?.stage).toBe("Final");

    acknowledgeManualOperation(operation.operationId);
    expect(loadManualJournal()).toEqual([]);
  });

  it("replays map and player edits for their owning draft only", () => {
    const mapOperation = {
      version: 1 as const,
      kind: "map" as const,
      draftId: ledger.id,
      operationId: "map-1",
      targetId: "map:1",
      field: "team1Score" as const,
      value: 16,
    };
    const playerOperation = {
      version: 1 as const,
      kind: "player" as const,
      draftId: ledger.id,
      operationId: "player-1",
      targetId: "player:1",
      field: "team" as const,
      value: "Two",
      teamSide: "team2" as const,
    };
    const recovered = applyManualOperation(applyManualOperation(ledger, mapOperation), playerOperation);
    expect(recovered.manualMaps?.["map:1"]?.team1Score).toBe(16);
    expect(recovered.manualPlayers?.["player:1"]).toMatchObject({ team: "Two", teamSide: "team2" });
    expect(applyManualOperation({ ...ledger, id: "another" }, mapOperation).manualMaps).toBeUndefined();
  });
});
