import { z } from "zod";
import type { DraftLedger, ManualFields, PlayerStat } from "../domain/types";

export const MANUAL_JOURNAL_KEY = "pmt-manual-outbox";
const MAX_OPERATIONS = 100;
const MAX_JOURNAL_CHARS = 100_000;
const idSchema = z.string().min(1).max(200);
const editValueSchema = z.union([z.string().max(5_000), z.number()]);

const scalarFieldSchema = z.enum([
  "team1Name",
  "team2Name",
  "team1Score",
  "team2Score",
  "event",
  "stage",
  "context",
]);
const operationSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    version: z.literal(1),
    kind: z.literal("scalar"),
    draftId: idSchema,
    operationId: idSchema,
    field: scalarFieldSchema,
    value: editValueSchema,
    baseline: editValueSchema.optional(),
  }),
  z.strictObject({
    version: z.literal(1),
    kind: z.literal("map"),
    draftId: idSchema,
    operationId: idSchema,
    targetId: idSchema,
    field: z.enum(["name", "team1Score", "team2Score"]),
    value: editValueSchema,
  }),
  z.strictObject({
    version: z.literal(1),
    kind: z.literal("player"),
    draftId: idSchema,
    operationId: idSchema,
    targetId: idSchema,
    field: z.enum(["name", "team", "kills", "deaths", "adr", "swing", "rating"]),
    value: editValueSchema,
    teamSide: z.enum(["team1", "team2"]).optional(),
  }),
]);

export type ManualJournalOperation = z.infer<typeof operationSchema>;

function read(): ManualJournalOperation[] {
  const encoded = localStorage.getItem(MANUAL_JOURNAL_KEY);
  if (!encoded) return [];
  if (encoded.length > MAX_JOURNAL_CHARS) throw new Error("Manual recovery journal is too large.");
  const parsed: unknown = JSON.parse(encoded);
  return z.array(operationSchema).max(MAX_OPERATIONS).parse(parsed);
}

function write(operations: ManualJournalOperation[]): void {
  if (operations.length === 0) localStorage.removeItem(MANUAL_JOURNAL_KEY);
  else {
    const encoded = JSON.stringify(operations);
    if (encoded.length > MAX_JOURNAL_CHARS) throw new Error("Manual recovery journal is too large.");
    localStorage.setItem(MANUAL_JOURNAL_KEY, encoded);
  }
}

export function appendManualOperation(operation: ManualJournalOperation): void {
  const operations = read();
  if (operations.some((entry) => entry.operationId === operation.operationId)) return;
  write([...operations, operation]);
}

export function acknowledgeManualOperation(operationId: string): void {
  write(read().filter((operation) => operation.operationId !== operationId));
}

export function loadManualJournal(): ManualJournalOperation[] {
  try {
    return read();
  } catch {
    try { localStorage.removeItem(MANUAL_JOURNAL_KEY); } catch { /* Storage remains unavailable. */ }
    return [];
  }
}

export function discardDraftOperations(draftId: string): void {
  try {
    write(read().filter((operation) => operation.draftId !== draftId));
  } catch {
    try { localStorage.removeItem(MANUAL_JOURNAL_KEY); } catch { /* IndexedDB cleanup already succeeded. */ }
  }
}

export function applyManualOperation(
  ledger: DraftLedger,
  operation: ManualJournalOperation,
): DraftLedger {
  if (ledger.id !== operation.draftId) return ledger;
  if (operation.kind === "scalar") {
    const manual: ManualFields = { ...ledger.manual, [operation.field]: operation.value };
    const manualBaselines: ManualFields = {
      ...ledger.manualBaselines,
      ...(operation.baseline === undefined ? {} : { [operation.field]: operation.baseline }),
    };
    return { ...ledger, manual, manualBaselines };
  }
  if (operation.kind === "map") {
    return {
      ...ledger,
      manualMaps: {
        ...ledger.manualMaps,
        [operation.targetId]: {
          ...ledger.manualMaps?.[operation.targetId],
          [operation.field]: operation.value,
        },
      },
    };
  }
  const playerPatch: Partial<PlayerStat> = {
    ...ledger.manualPlayers?.[operation.targetId],
    [operation.field]: operation.value,
  };
  if (operation.field === "team" && operation.teamSide) playerPatch.teamSide = operation.teamSide;
  return {
    ...ledger,
    manualPlayers: {
      ...ledger.manualPlayers,
      [operation.targetId]: playerPatch,
    },
  };
}
