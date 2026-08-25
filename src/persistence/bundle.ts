import { z } from "zod";
import type { DraftLedger } from "../domain/types";
import { canonicalHltvMatchUrl } from "../domain/hltvUrl";

export const MAX_BUNDLE_CHARS = 25_000_000;
export const MAX_DRAFT_IMPORTS = 100;
export const MAX_DRAFT_RAW_CHARS = 20_000_000;

const sourceKindSchema = z.enum(["main-match", "map-stats"]);
const sourceStateSchema = z.enum(["live", "completed", "unknown"]);
const idSchema = z.string().min(1).max(200);
const nameSchema = z.string().max(160);
const noteSchema = z.string().max(5_000);
const sourceUrlSchema = z.string().max(500).refine(
  (value) => value === "" || canonicalHltvMatchUrl(value) === value,
  "HLTV source URL is not canonical.",
);

const teamSchema = z.strictObject({ id: idSchema, name: nameSchema });
const mapSchema = z.strictObject({
  id: idSchema,
  name: z.string().max(80),
  team1Score: z.number().int().nonnegative(),
  team2Score: z.number().int().nonnegative(),
  halfScore: z.string().max(80).optional(),
  statsUrl: z.string().max(500).optional(),
  sourceKind: sourceKindSchema.optional(),
  sourceState: sourceStateSchema.optional(),
});
const playerSchema = z.strictObject({
  id: idSchema,
  name: nameSchema,
  team: nameSchema,
  teamSide: z.enum(["team1", "team2"]).optional(),
  kills: z.number().int().nonnegative(),
  deaths: z.number().int().nonnegative(),
  swing: z.string().max(40),
  adr: z.number().nonnegative(),
  kast: z.string().max(40),
  rating: z.number().nonnegative(),
  sourceKind: sourceKindSchema.optional(),
  sourceState: sourceStateSchema.optional(),
});
const matchSchema = z.strictObject({
  id: idSchema,
  sourceUrl: sourceUrlSchema,
  team1: teamSchema,
  team2: teamSchema,
  seriesScore: z.tuple([z.number().int().nonnegative(), z.number().int().nonnegative()]),
  event: z.string().max(240),
  stage: z.string().max(240),
  bestOf: z.number().int().positive(),
  maps: z.array(mapSchema).max(7),
  players: z.array(playerSchema).max(24),
  context: noteSchema,
  sourceKind: sourceKindSchema.optional(),
  state: sourceStateSchema.optional(),
});
const manualFieldsSchema = z.strictObject({
  sourceUrl: z.string().max(500).optional(),
  team1Name: nameSchema.optional(),
  team2Name: nameSchema.optional(),
  team1Score: z.number().int().nonnegative().optional(),
  team2Score: z.number().int().nonnegative().optional(),
  event: z.string().max(240).optional(),
  stage: z.string().max(240).optional(),
  context: noteSchema.optional(),
});
const manualSchema = manualFieldsSchema.default({});
const importSchema = z.strictObject({
  id: idSchema,
  capturedAt: z.string().max(100),
  active: z.boolean(),
  fingerprint: z.string().max(200),
  match: matchSchema,
  diagnostics: z.array(z.string().max(500)).max(50).optional(),
  changes: z.array(z.strictObject({
    field: z.string().max(240),
    kind: z.enum(["added", "changed", "unchanged", "retained"]),
    before: z.string().max(1_000).optional(),
    after: z.string().max(1_000).optional(),
  })).max(200).optional(),
  raw: z.strictObject({
    plain: z.string().max(120_000),
    html: z.string().max(3_000_000),
  }).optional(),
});
const ledgerSchema = z.strictObject({
  id: idSchema,
  createdAt: z.string().max(100),
  updatedAt: z.string().max(100),
  imports: z.array(importSchema).max(MAX_DRAFT_IMPORTS),
  manual: manualSchema,
  manualBaselines: manualFieldsSchema.optional(),
  manualMaps: z.record(
    z.string(),
    z.strictObject({
      name: z.string().max(80).optional(),
      team1Score: z.number().int().nonnegative().optional(),
      team2Score: z.number().int().nonnegative().optional(),
    }),
  ).optional(),
  manualPlayers: z.record(
    z.string(),
    z.strictObject({
      name: nameSchema.optional(),
      team: nameSchema.optional(),
      teamSide: z.enum(["team1", "team2"]).optional(),
      kills: z.number().int().nonnegative().optional(),
      deaths: z.number().int().nonnegative().optional(),
      adr: z.number().nonnegative().optional(),
      swing: z.string().max(40).optional(),
      rating: z.number().nonnegative().optional(),
    }),
  ).optional(),
}).superRefine((ledger, context) => {
  const activeMatchIds = new Set(
    ledger.imports.filter((entry) => entry.active).map((entry) => entry.match.id),
  );
  if (activeMatchIds.size > 1) {
    context.addIssue({
      code: "custom",
      path: ["imports"],
      message: "Active imports must belong to one match.",
    });
  }
});
const bundleSchema = z.strictObject({
  version: z.literal(1, { error: "Unsupported bundle version." }),
  exportedAt: z.string().max(100),
  ledger: ledgerSchema,
});

export interface DraftBundle {
  version: 1;
  exportedAt: string;
  ledger: DraftLedger;
}

function containsDangerousKey(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  if (Array.isArray(value)) return value.some(containsDangerousKey);
  for (const [key, child] of Object.entries(value)) {
    if (key === "__proto__" || key === "prototype" || key === "constructor") return true;
    if (containsDangerousKey(child)) return true;
  }
  return false;
}

export function exportDraftBundle(ledger: DraftLedger, exportedAt = new Date().toISOString()): string {
  const bundle = { version: 1 as const, exportedAt, ledger };
  const result = bundleSchema.safeParse(bundle);
  if (!result.success) throw new Error("Draft cannot be exported because its recovery data is invalid.");
  const encoded = JSON.stringify(result.data, null, 2);
  if (encoded.length > MAX_BUNDLE_CHARS) throw new Error("Draft is too large to export safely.");
  return encoded;
}

export function parseDraftBundle(encoded: string): DraftBundle {
  if (encoded.length > MAX_BUNDLE_CHARS) throw new Error("Bundle is too large.");
  let parsed: unknown;
  try {
    parsed = JSON.parse(encoded);
  } catch {
    throw new Error("Bundle is not valid JSON.");
  }
  if (containsDangerousKey(parsed)) throw new Error("Bundle contains a forbidden object key.");
  const result = bundleSchema.safeParse(parsed);
  if (!result.success) {
    const message = result.error.issues.map((issue) => issue.message).join(" ");
    throw new Error(message || "Bundle schema is invalid.");
  }
  return result.data;
}
