import { describe, expect, it } from "vitest";
import type { DraftLedger, MatchData } from "../../../src/domain/types";
import { exportDraftBundle, parseDraftBundle } from "../../../src/persistence/bundle";

const ledger: DraftLedger = {
  id: "draft",
  createdAt: "1",
  updatedAt: "2",
  manual: {},
  imports: [],
};

const match: MatchData = {
  id: "match-1",
  sourceUrl: "https://www.hltv.org/matches/1/one-vs-two",
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

describe("draft bundles", () => {
  it("round-trips a version-one bundle exactly", () => {
    const encoded = exportDraftBundle(ledger, "2026-08-24T00:00:00.000Z");
    expect(parseDraftBundle(encoded).ledger).toEqual(ledger);
  });

  it("rejects unsupported and prototype-shaped bundles", () => {
    expect(() => parseDraftBundle(JSON.stringify({ version: 2, ledger }))).toThrow(/version/i);
    expect(() =>
      parseDraftBundle('{"version":1,"exportedAt":"x","ledger":{"id":"x","createdAt":"x","updatedAt":"x","imports":[],"manual":{},"__proto__":{"polluted":true}}}'),
    ).toThrow();
    expect(({} as { polluted?: boolean }).polluted).toBeUndefined();
  });

  it("rejects mixed match identities and hostile source URLs", () => {
    const mixed: DraftLedger = {
      ...ledger,
      imports: [
        { id: "a", capturedAt: "1", active: true, fingerprint: "a", match },
        { id: "b", capturedAt: "2", active: true, fingerprint: "b", match: { ...match, id: "match-2" } },
      ],
    };
    expect(() => parseDraftBundle(JSON.stringify({ version: 1, exportedAt: "x", ledger: mixed }))).toThrow(/one match/i);

    const hostile: DraftLedger = {
      ...ledger,
      imports: [{
        id: "a",
        capturedAt: "1",
        active: true,
        fingerprint: "a",
        match: { ...match, sourceUrl: "https://attacker.invalid/) [click](https://attacker.invalid" },
      }],
    };
    expect(() => parseDraftBundle(JSON.stringify({ version: 1, exportedAt: "x", ledger: hostile }))).toThrow(/url/i);
  });

  it("never exports more history than the importer accepts", () => {
    const oversized: DraftLedger = {
      ...ledger,
      imports: Array.from({ length: 101 }, (_, index) => ({
        id: String(index),
        capturedAt: String(index),
        active: true,
        fingerprint: String(index),
        match,
      })),
    };
    expect(() => exportDraftBundle(oversized)).toThrow(/invalid/i);
  });
});
