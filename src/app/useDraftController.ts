import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { parserValueForField, replayDraft } from "../domain/replay";
import { summarizeMatchChanges } from "../domain/diff";
import type { DraftLedger, ImportProposal, ManualFields } from "../domain/types";
import { parseHltvClipboard } from "../import/parseHltvClipboard";
import { renderPmt } from "../output/renderPmt";
import {
  exportDraftBundle,
  MAX_BUNDLE_CHARS,
  MAX_DRAFT_IMPORTS,
  MAX_DRAFT_RAW_CHARS,
  parseDraftBundle,
} from "../persistence/bundle";
import { createDraftRepository } from "../persistence/draftRepository";
import {
  acknowledgeManualOperation,
  appendManualOperation,
  applyManualOperation,
  loadManualJournal,
} from "../persistence/manualJournal";

export type WorkStatus =
  | { tone: "idle"; message: string }
  | { tone: "working"; message: string }
  | { tone: "success"; message: string }
  | { tone: "warning"; message: string }
  | { tone: "error"; message: string };

export interface PendingMatchDecision {
  proposal: ImportProposal;
  raw: { plain: string; html: string };
  matchingDraftId?: string;
  compatibleActive?: boolean;
}

const now = () => new Date().toISOString();
const makeId = () => globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
const identityText = (value: string) => value.trim().toLocaleLowerCase();

function hasCompatibleDisplayIdentity(left: NonNullable<ImportProposal["match"]>, right: NonNullable<ImportProposal["match"]>): boolean {
  const leftTeams = [identityText(left.team1.name), identityText(left.team2.name)].sort();
  const rightTeams = [identityText(right.team1.name), identityText(right.team2.name)].sort();
  return leftTeams[0] === rightTeams[0] && leftTeams[1] === rightTeams[1] && identityText(left.event) === identityText(right.event);
}

function download(name: string, contents: string): void {
  const url = URL.createObjectURL(new Blob([contents], { type: "application/json" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function useDraftController() {
  const repositoryRef = useRef(createDraftRepository());
  const pendingCloseRef = useRef<number | null>(null);
  const [ledger, setLedger] = useState<DraftLedger | null>(null);
  const [drafts, setDrafts] = useState<DraftLedger[]>([]);
  const [status, setStatus] = useState<WorkStatus>({ tone: "idle", message: "Paste is ready." });
  const [hydrated, setHydrated] = useState(false);
  const [pendingDecision, setPendingDecisionState] = useState<PendingMatchDecision | null>(null);
  // Mirrors pendingDecision synchronously so import queues can check it
  // before React has re-rendered.
  const pendingDecisionSync = useRef(false);
  const setPendingDecision = useCallback((value: PendingMatchDecision | null) => {
    pendingDecisionSync.current = value !== null;
    setPendingDecisionState(value);
  }, []);
  const hasPendingDecision = useCallback(() => pendingDecisionSync.current, []);
  const [pendingBundle, setPendingBundle] = useState<DraftLedger | null>(null);
  const [lastRejectedCapture, setLastRejectedCapture] = useState<{ plain: string; html: string } | null>(null);

  useEffect(() => {
    let live = true;
    const repository = repositoryRef.current;
    if (pendingCloseRef.current !== null) {
      window.clearTimeout(pendingCloseRef.current);
      pendingCloseRef.current = null;
    }
    void (async () => {
      try {
        const activeId = await repositoryRef.current.getActiveId();
        const storedDrafts = await repositoryRef.current.list();
        const draftsById = new Map(storedDrafts.map((draft) => [draft.id, draft]));
        const journalByDraft = new Map<string, ReturnType<typeof loadManualJournal>>();
        for (const operation of loadManualJournal()) {
          const draft = draftsById.get(operation.draftId);
          if (!draft) continue;
          draftsById.set(operation.draftId, applyManualOperation(draft, operation));
          journalByDraft.set(operation.draftId, [
            ...(journalByDraft.get(operation.draftId) ?? []),
            operation,
          ]);
        }
        for (const [draftId, operations] of journalByDraft) {
          const recovered = draftsById.get(draftId);
          if (!recovered) continue;
          const recoveredAt = now();
          const nextRecovered = { ...recovered, updatedAt: recoveredAt };
          await repositoryRef.current.save(nextRecovered);
          draftsById.set(draftId, nextRecovered);
          for (const operation of operations) acknowledgeManualOperation(operation.operationId);
        }
        const nextLedger = activeId ? draftsById.get(activeId) : undefined;
        if (!live) return;
        setLedger(nextLedger ?? null);
        setDrafts([...draftsById.values()].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)));
      } catch {
        if (live) setStatus({ tone: "warning", message: "Local storage is unavailable. Work will remain in this tab." });
      } finally {
        if (live) setHydrated(true);
      }
    })();
    return () => {
      live = false;
      // A deferred close survives real unmounts while avoiding React StrictMode's
      // intentional setup → cleanup → setup development cycle.
      pendingCloseRef.current = window.setTimeout(() => {
        void repository.close();
        pendingCloseRef.current = null;
      }, 0);
    };
  }, []);

  const persist = useCallback(
    async (next: DraftLedger) => {
      setLedger(next);
      try {
        await repositoryRef.current.saveAndActivate(next);
        setDrafts((current) => [next, ...current.filter((draft) => draft.id !== next.id)]);
        return true;
      } catch {
        setStatus({ tone: "warning", message: "Changes are visible but not durable. Retry or export this draft." });
        return false;
      }
    },
    [],
  );

  const acceptProposal = useCallback(
    async (proposal: ImportProposal, raw: { plain: string; html: string }, target?: DraftLedger | null) => {
      if (!proposal.match) return;
      const base = target === undefined ? ledger : target;
      const duplicate = base?.imports.find(
        (entry) => entry.active && entry.fingerprint === proposal.fingerprint,
      );
      if (duplicate) {
        if (base && base.id !== ledger?.id) {
          try {
            await repositoryRef.current.setActiveId(base.id);
            setLedger(base);
          } catch {
            setStatus({ tone: "warning", message: "The matching draft could not be reopened. Your active draft was unchanged." });
            return;
          }
        }
        setLastRejectedCapture(null);
        setPendingDecision(null);
        setStatus({ tone: "success", message: "No Changes — this snapshot is already active." });
        return;
      }
      const rawChars = raw.plain.length + raw.html.length;
      const retainedRawChars = base?.imports.reduce(
        (total, entry) => total + (entry.raw?.plain.length ?? 0) + (entry.raw?.html.length ?? 0),
        0,
      ) ?? 0;
      if ((base?.imports.length ?? 0) >= MAX_DRAFT_IMPORTS || retainedRawChars + rawChars > MAX_DRAFT_RAW_CHARS) {
        setStatus({
          tone: "error",
          message: "This draft has reached its local history limit. Export it, then start a fresh draft.",
        });
        return;
      }
      const timestamp = now();
      const changes = summarizeMatchChanges(base ? replayDraft(base).match : null, proposal.match);
      const next: DraftLedger = base
        ? {
            ...base,
            updatedAt: timestamp,
            imports: [
              ...base.imports,
              {
                id: makeId(),
                capturedAt: timestamp,
                active: true,
                fingerprint: proposal.fingerprint,
                match: proposal.match,
                diagnostics: proposal.diagnostics,
                changes,
                raw,
              },
            ],
          }
        : {
            id: drafts.some((draft) => draft.id === `draft:${proposal.match?.id}`)
              ? `draft:${proposal.match.id}:${makeId()}`
              : `draft:${proposal.match.id}`,
            createdAt: timestamp,
            updatedAt: timestamp,
            imports: [
              {
                id: makeId(),
                capturedAt: timestamp,
                active: true,
                fingerprint: proposal.fingerprint,
                match: proposal.match,
                diagnostics: proposal.diagnostics,
                changes,
                raw,
              },
            ],
            manual: {},
            manualBaselines: {},
            manualMaps: {},
            manualPlayers: {},
          };
      if (!(await persist(next))) return;
      setLastRejectedCapture(null);
      setPendingDecision(null);
      const message = proposal.diagnostics.length
        ? `Imported with ${proposal.diagnostics.length} item${proposal.diagnostics.length === 1 ? "" : "s"} to review — see Fix before copying.`
        : `Imported ${proposal.match.maps.length} maps and ${proposal.match.players.length} player rows.`;
      setStatus({ tone: proposal.diagnostics.length ? "warning" : "success", message });
    },
    [drafts, ledger, persist, setPendingDecision],
  );

  const importClipboard = useCallback(
    async (
      raw: { plain: string; html: string },
      options?: { onDifferentMatch?: "ask" | "switch-or-create" },
    ) => {
      setStatus({ tone: "working", message: "Reading copied HLTV data…" });
      const proposal = parseHltvClipboard(raw);
      if (!proposal.match) {
        if (proposal.kind !== "rejected") setLastRejectedCapture(raw);
        setStatus({
          tone: proposal.kind === "rejected" ? "error" : "warning",
          message: proposal.diagnostics[0] ?? "No usable match data was found.",
        });
        return;
      }
      const activeMatch = ledger ? replayDraft(ledger).match : null;
      if (activeMatch && activeMatch.id !== proposal.match.id) {
        const matching = drafts.find((draft) => replayDraft(draft).match?.id === proposal.match?.id);
        if (options?.onDifferentMatch === "switch-or-create") {
          // An extension capture names its match explicitly, so switch to the
          // matching draft or create one instead of asking.
          const target = matching ? (await repositoryRef.current.get(matching.id)) ?? matching : null;
          await acceptProposal(proposal, raw, target);
          return;
        }
        setPendingDecision({
          proposal,
          raw,
          matchingDraftId: matching?.id,
          compatibleActive: hasCompatibleDisplayIdentity(activeMatch, proposal.match),
        });
        setStatus({ tone: "warning", message: "This looks like a different match. Choose its destination." });
        return;
      }
      await acceptProposal(proposal, raw);
    },
    [acceptProposal, drafts, ledger, setPendingDecision],
  );

  const retryLastRejected = useCallback(async () => {
    if (!lastRejectedCapture) return;
    await importClipboard(lastRejectedCapture);
  }, [importClipboard, lastRejectedCapture]);

  const updateManual = useCallback(
    async (field: keyof ManualFields, value: string | number) => {
      if (!ledger) return;
      const operationId = makeId();
      const baseline = ledger.manualBaselines?.[field] ?? parserValueForField(ledger, field);
      try {
        appendManualOperation({
          version: 1,
          kind: "scalar",
          draftId: ledger.id,
          operationId,
          field,
          value,
          baseline,
        });
      } catch {
        setStatus({ tone: "warning", message: "This edit is not durable yet. Browser storage is unavailable." });
      }
      const next = {
        ...ledger,
        updatedAt: now(),
        manual: { ...ledger.manual, [field]: value },
        manualBaselines: { ...ledger.manualBaselines, [field]: baseline },
      };
      if (!(await persist(next))) return;
      try { acknowledgeManualOperation(operationId); } catch { /* Replaying the same value is idempotent. */ }
      setStatus({ tone: "success", message: "Saved manual correction." });
    },
    [ledger, persist],
  );

  const restoreParserOwnership = useCallback(
    async (field: keyof ManualFields) => {
      if (!ledger) return;
      const manual = { ...ledger.manual };
      const manualBaselines = { ...ledger.manualBaselines };
      delete manual[field];
      delete manualBaselines[field];
      if (!(await persist({ ...ledger, updatedAt: now(), manual, manualBaselines }))) return;
      setStatus({ tone: "success", message: "Parser ownership restored." });
    },
    [ledger, persist],
  );

  const keepManual = useCallback(
    async (field: keyof ManualFields) => {
      if (!ledger) return;
      const imported = parserValueForField(ledger, field);
      if (imported === undefined) return;
      if (!(await persist({
        ...ledger,
        updatedAt: now(),
        manualBaselines: { ...ledger.manualBaselines, [field]: imported },
      }))) return;
      setStatus({ tone: "success", message: "Kept your correction and acknowledged this import." });
    },
    [ledger, persist],
  );

  const updateManualMap = useCallback(
    async (mapId: string, field: "name" | "team1Score" | "team2Score", value: string | number) => {
      if (!ledger) return;
      const operationId = makeId();
      try {
        appendManualOperation({
          version: 1,
          kind: "map",
          draftId: ledger.id,
          operationId,
          targetId: mapId,
          field,
          value,
        });
      } catch {
        setStatus({ tone: "warning", message: "This map edit is not durable yet. Browser storage is unavailable." });
      }
      if (!(await persist({
        ...ledger,
        updatedAt: now(),
        manualMaps: {
          ...ledger.manualMaps,
          [mapId]: { ...ledger.manualMaps?.[mapId], [field]: value },
        },
      }))) return;
      try { acknowledgeManualOperation(operationId); } catch { /* Replaying the same value is idempotent. */ }
      setStatus({ tone: "success", message: "Saved map correction." });
    },
    [ledger, persist],
  );

  const restoreParserMap = useCallback(
    async (mapId: string) => {
      if (!ledger?.manualMaps?.[mapId]) return;
      const manualMaps = { ...ledger.manualMaps };
      delete manualMaps[mapId];
      if (!(await persist({ ...ledger, updatedAt: now(), manualMaps }))) return;
      setStatus({ tone: "success", message: "Parser ownership restored for this map." });
    },
    [ledger, persist],
  );

  const updateManualPlayer = useCallback(
    async (
      playerId: string,
      field: "name" | "team" | "country" | "awper" | "igl" | "kills" | "deaths" | "adr" | "swing" | "rating",
      value: string | number | boolean,
    ) => {
      if (!ledger) return;
      const operationId = makeId();
      const currentMatch = replayDraft(ledger).match;
      const teamSide = field === "team"
        ? value === currentMatch?.team1.name
          ? "team1"
          : value === currentMatch?.team2.name
            ? "team2"
            : undefined
        : undefined;
      try {
        appendManualOperation({
          version: 1,
          kind: "player",
          draftId: ledger.id,
          operationId,
          targetId: playerId,
          field,
          value,
          teamSide,
        });
      } catch {
        setStatus({ tone: "warning", message: "This player edit is not durable yet. Browser storage is unavailable." });
      }
      if (!(await persist({
        ...ledger,
        updatedAt: now(),
        manualPlayers: {
          ...ledger.manualPlayers,
          [playerId]: {
            ...ledger.manualPlayers?.[playerId],
            [field]: value,
            ...(teamSide ? { teamSide } : {}),
          },
        },
      }))) return;
      try { acknowledgeManualOperation(operationId); } catch { /* Replaying the same value is idempotent. */ }
      setStatus({ tone: "success", message: "Saved player-stat correction." });
    },
    [ledger, persist],
  );

  const restoreParserPlayer = useCallback(
    async (playerId: string) => {
      if (!ledger?.manualPlayers?.[playerId]) return;
      const manualPlayers = { ...ledger.manualPlayers };
      delete manualPlayers[playerId];
      if (!(await persist({ ...ledger, updatedAt: now(), manualPlayers }))) return;
      setStatus({ tone: "success", message: "Parser ownership restored for this player row." });
    },
    [ledger, persist],
  );

  const toggleImport = useCallback(
    async (id: string) => {
      if (!ledger) return;
      await persist({
        ...ledger,
        updatedAt: now(),
        imports: ledger.imports.map((entry) =>
          entry.id === id ? { ...entry, active: !entry.active } : entry,
        ),
      });
    },
    [ledger, persist],
  );

  const switchDraft = useCallback(async (id: string) => {
    const next = await repositoryRef.current.get(id);
    if (!next) return;
    setLedger(next);
    await repositoryRef.current.setActiveId(id);
    setStatus({ tone: "idle", message: "Draft restored from this browser." });
  }, []);

  const resolveMatchDecision = useCallback(
    async (action: "switch" | "create" | "associate" | "cancel") => {
      if (!pendingDecision) return;
      if (action === "cancel") {
        setPendingDecision(null);
        setStatus({ tone: "idle", message: "Import cancelled. The active draft was unchanged." });
        return;
      }
      const target =
        action === "switch" && pendingDecision.matchingDraftId
          ? await repositoryRef.current.get(pendingDecision.matchingDraftId)
          : action === "associate"
            ? ledger
            : null;
      const activeMatch = target ? replayDraft(target).match : null;
      const proposal = action === "associate" && pendingDecision.proposal.match && activeMatch
        ? {
            ...pendingDecision.proposal,
            match: {
              ...pendingDecision.proposal.match,
              id: activeMatch.id,
              sourceUrl: pendingDecision.proposal.match.sourceUrl || activeMatch.sourceUrl,
            },
          }
        : pendingDecision.proposal;
      await acceptProposal(proposal, pendingDecision.raw, target);
    },
    [acceptProposal, ledger, pendingDecision, setPendingDecision],
  );

  const clearDraft = useCallback(async () => {
    if (!ledger) return;
    await repositoryRef.current.clear(ledger.id);
    const remaining = await repositoryRef.current.list();
    const next = remaining[0] ?? null;
    setLedger(next);
    setDrafts(remaining);
    await repositoryRef.current.setActiveId(next?.id ?? null);
    setStatus({ tone: "success", message: "Draft and its local source history were cleared." });
  }, [ledger]);

  const exportBundle = useCallback(() => {
    if (!ledger) return;
    try {
      const matchName = replayDraft(ledger).match?.event || "pmt-draft";
      download(`${matchName.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.pmt.json`, exportDraftBundle(ledger));
      setStatus({ tone: "success", message: "Portable draft bundle downloaded." });
    } catch (error) {
      setStatus({ tone: "error", message: error instanceof Error ? error.message : "Draft could not be exported." });
    }
  }, [ledger]);

  const readBundle = useCallback(async (file: File) => {
    try {
      if (file.size > MAX_BUNDLE_CHARS) throw new Error("Bundle is too large.");
      const bundle = parseDraftBundle(await file.text());
      const existing = await repositoryRef.current.get(bundle.ledger.id);
      if (existing && JSON.stringify(existing) !== JSON.stringify(bundle.ledger)) {
        setPendingBundle(bundle.ledger);
        return;
      }
      if (!(await persist(bundle.ledger))) return;
      setStatus({ tone: "success", message: existing ? "Identical bundle — No Changes." : "Bundle imported." });
    } catch (error) {
      setStatus({ tone: "error", message: error instanceof Error ? error.message : "Bundle could not be imported." });
    }
  }, [persist]);

  const resolveBundle = useCallback(
    async (action: "replace" | "copy" | "cancel") => {
      if (!pendingBundle) return;
      if (action === "cancel") {
        setPendingBundle(null);
        return;
      }
      const next = action === "copy" ? { ...pendingBundle, id: `${pendingBundle.id}:copy:${makeId()}` } : pendingBundle;
      if (!(await persist(next))) return;
      setPendingBundle(null);
      setStatus({ tone: "success", message: action === "copy" ? "Bundle imported as a copy." : "Local draft replaced by bundle." });
    },
    [pendingBundle, persist],
  );

  const projection = useMemo(() => (ledger ? replayDraft(ledger) : { match: null, conflicts: [] }), [ledger]);
  const output = useMemo(() => renderPmt(projection.match), [projection.match]);

  return {
    hydrated,
    ledger,
    drafts,
    projection,
    output,
    status,
    pendingDecision,
    hasPendingDecision,
    pendingBundle,
    importClipboard,
    updateManual,
    updateManualMap,
    updateManualPlayer,
    restoreParserOwnership,
    keepManual,
    restoreParserMap,
    restoreParserPlayer,
    toggleImport,
    switchDraft,
    resolveMatchDecision,
    clearDraft,
    exportBundle,
    readBundle,
    resolveBundle,
    lastRejectedCapture,
    retryLastRejected,
  };
}
