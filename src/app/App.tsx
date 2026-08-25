import { useEffect, useId, useRef, useState, type ClipboardEvent, type ReactNode } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { DraftLedger, ImportRecord, ManualFields } from "../domain/types";
import type { PmtIssue } from "../output/renderPmt";
import { useDraftController, type WorkStatus } from "./useDraftController";

const PASTE_LABEL = "Paste copied HLTV page";

function focusPasteTarget() {
  document.querySelector<HTMLTextAreaElement>(`textarea[aria-label='${PASTE_LABEL}']`)?.focus();
}

function PasteTarget({
  onCapture,
  autoFocus,
}: {
  onCapture: (capture: { plain: string; html: string }) => void;
  autoFocus?: boolean;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (autoFocus) ref.current?.focus();
  }, [autoFocus]);
  const paste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    const capture = {
      plain: event.clipboardData.getData("text/plain"),
      html: event.clipboardData.getData("text/html"),
    };
    if (!capture.plain && !capture.html) return;
    event.preventDefault();
    event.currentTarget.value = "";
    onCapture(capture);
  };
  return (
    <Textarea
      ref={ref}
      aria-label={PASTE_LABEL}
      onPaste={paste}
      placeholder="Paste the copied HLTV match page here (Ctrl+V)"
      rows={2}
      className="resize-none border-dashed bg-background"
    />
  );
}

function BrandMark() {
  return (
    <span className="flex items-center gap-2">
      <span
        aria-hidden="true"
        className="flex size-5 items-center justify-center rounded-sm bg-primary text-[11px] font-bold leading-none text-primary-foreground"
      >
        P
      </span>
      <span className="text-sm font-semibold tracking-tight">PMT Thread Creator</span>
    </span>
  );
}

function StatusText({ status }: { status: WorkStatus }) {
  return (
    <span
      role="status"
      aria-live="polite"
      title={status.message}
      className={`max-w-[48ch] truncate text-sm ${status.tone === "error" ? "text-destructive" : "text-muted-foreground"}`}
    >
      {status.tone === "idle" ? "" : status.message}
    </span>
  );
}

const ISSUE_COPY: Record<PmtIssue, { label: string; guidance: string }> = {
  match: { label: "Match data", guidance: "Paste a complete HLTV match page." },
  "match live": {
    label: "Match still live",
    guidance: "Draft is prepared. Paste the final page once the match is over.",
  },
  "team 1": { label: "Team one", guidance: "Enter the first team below." },
  "team 2": { label: "Team two", guidance: "Enter the second team below." },
  event: { label: "Event", guidance: "Enter the tournament name below." },
  stage: { label: "Stage", guidance: "Enter the event stage below." },
  "HLTV URL": { label: "HLTV match URL", guidance: "Paste the match page URL below." },
};

const FIELD_LABELS: Record<keyof ManualFields, string> = {
  sourceUrl: "HLTV match URL",
  team1Name: "Team one",
  team2Name: "Team two",
  team1Country: "Team one flag code",
  team2Country: "Team two flag code",
  team1Score: "Team one score",
  team2Score: "Team two score",
  event: "Event",
  stage: "Stage",
  context: "Context line",
};

function ChangeSummary({ changes = [] }: { changes?: NonNullable<ImportRecord["changes"]> }) {
  const meaningful = changes.filter((change) => change.kind !== "unchanged");
  return (
    <details className="text-xs">
      <summary aria-label="Show import changes" className="cursor-pointer text-muted-foreground">
        Changes ({meaningful.length})
      </summary>
      <ul className="mt-1 flex flex-col gap-1">
        {(meaningful.length ? meaningful : changes.slice(0, 1)).map((change, index) => (
          <li key={`${change.field}:${index}`} className="flex flex-wrap gap-x-2">
            <span className="text-muted-foreground">{change.kind}</span>
            <strong className="font-medium [overflow-wrap:anywhere]">{change.field}</strong>
            {change.kind === "changed" && (
              <span className="text-muted-foreground">{change.before} → {change.after}</span>
            )}
            {change.kind === "retained" && (
              <span className="text-muted-foreground">{change.before} kept</span>
            )}
            {change.kind === "added" && <span className="text-muted-foreground">{change.after}</span>}
          </li>
        ))}
      </ul>
    </details>
  );
}

function ImportHistory({
  imports,
  onToggleImport,
}: {
  imports: ImportRecord[];
  onToggleImport: (id: string) => void;
}) {
  return (
    <ol data-testid="import-history" className="flex flex-col gap-1">
      {[...imports].reverse().map((entry) => (
        <li key={entry.id} className="flex items-start justify-between gap-2 border-b py-2 text-sm last:border-b-0">
          <div className="flex flex-col gap-1">
            <span>
              {entry.match.maps.length} maps, {entry.match.players.length} player rows
              {!entry.active && <span className="text-muted-foreground"> (reverted)</span>}
            </span>
            <ChangeSummary changes={entry.changes} />
          </div>
          <Button variant="ghost" size="sm" onClick={() => onToggleImport(entry.id)}>
            {entry.active ? "Revert" : "Restore"}
          </Button>
        </li>
      ))}
    </ol>
  );
}

function BundleImportButton({ onImportBundle }: { onImportBundle: (file: File) => void }) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <Button variant="outline" size="sm" onClick={() => input.current?.click()}>
        Import bundle
      </Button>
      <input
        ref={input}
        type="file"
        accept=".json,.pmt.json,application/json"
        hidden
        onChange={(event) => event.target.files?.[0] && onImportBundle(event.target.files[0])}
      />
    </>
  );
}

function DraftSelect({
  value,
  drafts,
  onChange,
}: {
  value: string;
  drafts: DraftLedger[];
  onChange: (id: string) => void;
}) {
  const id = useId();
  return (
    <div className="flex items-center gap-2">
      <Label htmlFor={id} className="text-muted-foreground">Draft</Label>
      <select
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-8 max-w-52 rounded-md border border-input bg-transparent px-2 text-sm"
      >
        {drafts.map((draft) => {
          const match = draft.imports.find((entry) => entry.active)?.match;
          return (
            <option key={draft.id} value={draft.id}>
              {match ? `${match.team1.name} / ${match.team2.name}` : draft.id}
            </option>
          );
        })}
      </select>
    </div>
  );
}

function TopBar({ children }: { children?: ReactNode }) {
  return (
    <header className="sticky top-0 z-20 border-b bg-background/90 backdrop-blur">
      <div className="mx-auto flex min-h-12 w-full max-w-6xl flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-1.5">
        <BrandMark />
        <div className="flex min-w-0 flex-wrap items-center gap-3">{children}</div>
      </div>
    </header>
  );
}

function EmptyState({
  onCapture,
  onImportBundle,
  status,
  canRetry,
  onRetry,
}: {
  onCapture: (capture: { plain: string; html: string }) => void;
  onImportBundle: (file: File) => void;
  status: WorkStatus;
  canRetry?: boolean;
  onRetry?: () => void;
}) {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-muted/40 px-4 py-16">
      <div className="flex w-full max-w-lg flex-col gap-4">
        <BrandMark />
        <Card>
          <CardHeader>
            <h1 className="text-base font-semibold leading-none">Paste an HLTV match page</h1>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <ol className="list-decimal pl-5 text-sm text-muted-foreground">
              <li>Open the finished match on HLTV</li>
              <li>Select the whole page and copy it (Ctrl+A, Ctrl+C)</li>
              <li>Paste it below</li>
            </ol>
            <PasteTarget onCapture={onCapture} autoFocus />
            {status.tone !== "idle" && (
              <p
                role="status"
                aria-live="polite"
                className={`text-sm ${status.tone === "error" ? "text-destructive" : "text-muted-foreground"}`}
              >
                {status.message}
              </p>
            )}
            {canRetry && (
              <Button variant="outline" size="sm" className="self-start" onClick={onRetry}>
                Retry last recognized paste
              </Button>
            )}
            <div className="flex items-center gap-2">
              <BundleImportButton onImportBundle={onImportBundle} />
              <span className="text-xs text-muted-foreground">Restores a previously exported draft.</span>
            </div>
          </CardContent>
        </Card>
        <p className="text-center text-xs text-muted-foreground">
          Nothing leaves this browser. Drafts are stored locally.
        </p>
      </div>
    </main>
  );
}

function RevertedDraft({
  ledger,
  drafts,
  status,
  onCapture,
  onToggleImport,
  onSwitchDraft,
}: {
  ledger: DraftLedger;
  drafts: DraftLedger[];
  status: WorkStatus;
  onCapture: (capture: { plain: string; html: string }) => void;
  onToggleImport: (id: string) => void;
  onSwitchDraft: (id: string) => void;
}) {
  return (
    <div className="min-h-screen bg-muted/40">
      <TopBar>
        <StatusText status={status} />
        <DraftSelect value={ledger.id} drafts={drafts} onChange={onSwitchDraft} />
      </TopBar>
      <main className="mx-auto flex w-full max-w-xl flex-col gap-4 px-4 py-16">
        <Card>
          <CardHeader>
            <h1 className="text-base font-semibold leading-none">This draft is fully reverted</h1>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <p className="text-sm text-muted-foreground">
              Restore an import below or paste a new snapshot.
            </p>
            <PasteTarget onCapture={onCapture} autoFocus />
            <h2 className="text-sm font-medium">Import history</h2>
            <ol data-testid="import-history" className="flex flex-col gap-1">
              {[...ledger.imports].reverse().map((entry) => (
                <li key={entry.id} className="flex items-center justify-between gap-2 border-b py-2 text-sm last:border-b-0">
                  <span>{entry.match.team1.name} vs {entry.match.team2.name}</span>
                  <Button variant="ghost" size="sm" onClick={() => onToggleImport(entry.id)}>
                    Restore
                  </Button>
                </li>
              ))}
            </ol>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}

function EditField({
  label,
  value,
  type = "text",
  onCommit,
}: {
  label: string;
  value: string | number;
  type?: "text" | "number";
  onCommit: (value: string | number) => void;
}) {
  const id = useId();
  return (
    <Field>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Input
        id={id}
        type={type}
        value={value}
        min={type === "number" ? 0 : undefined}
        className={type === "number" ? "tabular-nums" : undefined}
        onChange={(event) => onCommit(type === "number" ? Number(event.target.value) : event.target.value)}
      />
    </Field>
  );
}

function PostPreview({ title, body }: { title: string; body: string }) {
  return (
    <Card aria-label="Post preview" className="gap-4">
      <CardHeader className="border-b">
        <h2 className="text-lg font-semibold leading-snug tracking-tight">{title}</h2>
      </CardHeader>
      <CardContent className="markdown-preview">
        <Markdown
          remarkPlugins={[remarkGfm]}
          skipHtml
          components={{
            img: () => null,
            a: ({ children, href }) => (
              <a href={href} target="_blank" rel="noreferrer noopener">{children}</a>
            ),
          }}
        >
          {body.replaceAll("&nbsp;", "")}
        </Markdown>
      </CardContent>
    </Card>
  );
}

function CopyButton({ label, value, disabled }: { label: string; value: string; disabled?: boolean }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  const resetTimer = useRef<number | null>(null);
  useEffect(() => () => {
    if (resetTimer.current !== null) window.clearTimeout(resetTimer.current);
  }, []);
  const markCopied = () => {
    if (resetTimer.current !== null) window.clearTimeout(resetTimer.current);
    setState("copied");
    resetTimer.current = window.setTimeout(() => {
      setState("idle");
      resetTimer.current = null;
    }, 1800);
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      markCopied();
    } catch {
      const textarea = document.createElement("textarea");
      textarea.value = value;
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.append(textarea);
      textarea.select();
      try {
        if (document.execCommand("copy")) markCopied();
        else setState("failed");
      } finally {
        textarea.remove();
      }
    }
  };
  return (
    <div className="relative">
      <Button onClick={copy} disabled={disabled}>
        {state === "copied" ? "Copied" : label}
      </Button>
      {state === "failed" && (
        <span role="status" className="absolute right-0 top-full z-10 mt-1 w-56 rounded-md border border-destructive bg-background p-2 text-xs text-destructive">
          Copy was blocked. Select the preview text or retry.
        </span>
      )}
    </div>
  );
}

export default function App() {
  const controller = useDraftController();
  const { importClipboard } = controller;
  const [showExport, setShowExport] = useState(false);
  const [showClear, setShowClear] = useState(false);
  const match = controller.projection.match;
  const ledger = controller.ledger;

  useEffect(() => {
    const globalPaste = (event: globalThis.ClipboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.matches("input, textarea, [contenteditable='true']")) return;
      const plain = event.clipboardData?.getData("text/plain") ?? "";
      const html = event.clipboardData?.getData("text/html") ?? "";
      if (!/HLTV|Match stats|Best of \d+/i.test(`${plain} ${html.slice(0, 5000)}`)) return;
      event.preventDefault();
      void importClipboard({ plain, html });
    };
    window.addEventListener("paste", globalPaste);
    return () => window.removeEventListener("paste", globalPaste);
  }, [importClipboard]);

  if (!controller.hydrated) {
    return <div className="grid min-h-screen place-items-center text-muted-foreground">Loading…</div>;
  }
  if (!ledger) {
    return (
      <EmptyState
        onCapture={(capture) => void controller.importClipboard(capture)}
        onImportBundle={(file) => void controller.readBundle(file)}
        status={controller.status}
        canRetry={Boolean(controller.lastRejectedCapture)}
        onRetry={() => void controller.retryLastRejected()}
      />
    );
  }
  if (!match) {
    return (
      <RevertedDraft
        ledger={ledger}
        drafts={controller.drafts}
        status={controller.status}
        onCapture={(capture) => void controller.importClipboard(capture)}
        onToggleImport={(id) => void controller.toggleImport(id)}
        onSwitchDraft={(id) => void controller.switchDraft(id)}
      />
    );
  }

  const commit = (field: keyof ManualFields) => (value: string | number) => void controller.updateManual(field, value);
  const conflicts = controller.projection.conflicts;
  const ready = controller.output.ready && conflicts.length === 0;
  const activeDiagnostics = ready
    ? []
    : ledger.imports
      .filter((entry) => entry.active)
      .flatMap((entry) => entry.diagnostics ?? []);

  return (
    <div className="min-h-screen bg-muted/40">
      <TopBar>
        <StatusText status={controller.status} />
        <DraftSelect
          value={ledger.id}
          drafts={controller.drafts}
          onChange={(id) => void controller.switchDraft(id)}
        />
      </TopBar>

      <div className="mx-auto grid w-full max-w-6xl gap-6 px-4 py-6 lg:grid-cols-[minmax(0,24rem)_minmax(0,1fr)]">
        <section aria-label="Quick edits" className="flex min-w-0 flex-col gap-4">
          <PasteTarget onCapture={(capture) => void controller.importClipboard(capture)} />
          {controller.lastRejectedCapture && (
            <Button variant="outline" size="sm" className="self-start" onClick={() => void controller.retryLastRejected()}>
              Retry last recognized paste
            </Button>
          )}

          {!ready && (
            <Alert>
              <AlertTitle>Fix before copying</AlertTitle>
              <AlertDescription>
                <ul className="flex flex-col gap-1">
                  {controller.output.issues.map((issue) => {
                    const copy = ISSUE_COPY[issue];
                    const diagnostic = activeDiagnostics.find((item) => (
                      issue === "HLTV URL" ? /URL/i.test(item) : item.toLowerCase().includes(issue.toLowerCase())
                    ));
                    return (
                      <li key={issue}>
                        <strong className="font-medium">{copy.label}:</strong> {diagnostic ?? copy.guidance}
                      </li>
                    );
                  })}
                  {conflicts.map((conflict) => (
                    <li key={`conflict:${conflict.field}`}>
                      <strong className="font-medium">{FIELD_LABELS[conflict.field]}:</strong> resolve the conflict below.
                    </li>
                  ))}
                </ul>
              </AlertDescription>
            </Alert>
          )}

          {conflicts.length > 0 && (
            <Alert>
              <AlertTitle>
                {conflicts.length} parser conflict{conflicts.length === 1 ? "" : "s"}
              </AlertTitle>
              <AlertDescription>
                <div className="flex flex-col gap-3">
                  {conflicts.map((conflict) => (
                    <div key={conflict.field} className="flex flex-col gap-1">
                      <span className="font-medium">{FIELD_LABELS[conflict.field]}</span>
                      <span>Mine: {conflict.mine}</span>
                      <span>Imported: {conflict.imported}</span>
                      <div className="flex gap-2">
                        <Button variant="outline" size="sm" onClick={() => void controller.keepManual(conflict.field)}>
                          Keep mine
                        </Button>
                        <Button variant="outline" size="sm" onClick={() => void controller.restoreParserOwnership(conflict.field)}>
                          Use imported
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              </AlertDescription>
            </Alert>
          )}

          <Card>
            <CardHeader>
              <CardTitle>Match</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <div className="grid grid-cols-[minmax(0,1fr)_4rem_4.5rem] gap-3">
                <EditField label="Team one" value={match.team1.name} onCommit={commit("team1Name")} />
                <EditField label="Flag" value={match.team1.country ?? ""} onCommit={commit("team1Country")} />
                <EditField label="Score" value={match.seriesScore[0]} type="number" onCommit={commit("team1Score")} />
                <EditField label="Team two" value={match.team2.name} onCommit={commit("team2Name")} />
                <EditField label="Flag" value={match.team2.country ?? ""} onCommit={commit("team2Country")} />
                <EditField label="Score" value={match.seriesScore[1]} type="number" onCommit={commit("team2Score")} />
              </div>
              <EditField label="Event" value={match.event} onCommit={commit("event")} />
              <EditField label="Stage" value={match.stage} onCommit={commit("stage")} />
              <EditField label="HLTV match URL" value={match.sourceUrl} onCommit={commit("sourceUrl")} />
              <Field>
                <FieldLabel htmlFor="context-line">Context line</FieldLabel>
                <Textarea
                  id="context-line"
                  value={match.context}
                  rows={3}
                  onChange={(event) => commit("context")(event.target.value)}
                />
              </Field>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Maps ({match.maps.length})</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-2">
            {match.maps.map((map, index) => (
              <div key={map.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2">
                <Input
                  aria-label={`Map ${index + 1} name`}
                  value={map.name}
                  onChange={(event) => void controller.updateManualMap(map.id, "name", event.target.value)}
                />
                <div className="flex items-center gap-1">
                  <Input
                    aria-label={`${map.name} ${match.team1.name} score`}
                    type="number"
                    min={0}
                    value={map.team1Score}
                    onChange={(event) => void controller.updateManualMap(map.id, "team1Score", Number(event.target.value))}
                    className="w-14 text-center tabular-nums"
                  />
                  <span aria-hidden="true">–</span>
                  <Input
                    aria-label={`${map.name} ${match.team2.name} score`}
                    type="number"
                    min={0}
                    value={map.team2Score}
                    onChange={(event) => void controller.updateManualMap(map.id, "team2Score", Number(event.target.value))}
                    className="w-14 text-center tabular-nums"
                  />
                </div>
                {ledger.manualMaps?.[map.id] && (
                  <Button variant="ghost" size="sm" className="col-span-2 justify-self-start" onClick={() => void controller.restoreParserMap(map.id)}>
                    Use parsed
                  </Button>
                )}
              </div>
            ))}

            {match.players.length > 0 && (
              <details className="pt-2">
                <summary className="cursor-pointer text-sm font-medium">
                  Player stats ({match.players.length})
                </summary>
              <div className="mt-2 flex flex-col gap-3">
                {match.players.map((player) => (
                  <div key={player.id} className="flex flex-col gap-2 border-b pb-3 last:border-b-0">
                    <div className="grid grid-cols-2 gap-2">
                      <Input
                        aria-label={`${player.name} name`}
                        value={player.name}
                        onChange={(event) => void controller.updateManualPlayer(player.id, "name", event.target.value)}
                      />
                      <select
                        aria-label={`${player.name} team`}
                        value={player.team}
                        onChange={(event) => void controller.updateManualPlayer(player.id, "team", event.target.value)}
                        className="h-9 min-w-0 rounded-md border border-input bg-transparent px-2 text-sm"
                      >
                        <option value={match.team1.name}>{match.team1.name}</option>
                        <option value={match.team2.name}>{match.team2.name}</option>
                      </select>
                    </div>
                    <div className="flex items-center gap-4">
                      <Input
                        aria-label={`${player.name} flag code`}
                        value={player.country ?? ""}
                        placeholder="Flag"
                        maxLength={8}
                        className="w-20 uppercase"
                        onChange={(event) => void controller.updateManualPlayer(player.id, "country", event.target.value)}
                      />
                      <label className="flex items-center gap-1.5 text-xs">
                        <input
                          type="checkbox"
                          aria-label={`${player.name} AWPer`}
                          className="size-3.5 accent-primary"
                          checked={Boolean(player.awper)}
                          onChange={(event) => void controller.updateManualPlayer(player.id, "awper", event.target.checked)}
                        />
                        AWP ⊕
                      </label>
                      <label className="flex items-center gap-1.5 text-xs">
                        <input
                          type="checkbox"
                          aria-label={`${player.name} in-game leader`}
                          className="size-3.5 accent-primary"
                          checked={Boolean(player.igl)}
                          onChange={(event) => void controller.updateManualPlayer(player.id, "igl", event.target.checked)}
                        />
                        IGL ♛
                      </label>
                    </div>
                    <div className="grid grid-cols-5 gap-2">
                      {(["kills", "deaths", "adr", "rating"] as const).map((field) => (
                        <Field key={field}>
                          <FieldLabel htmlFor={`${player.id}-${field}`} className="text-xs text-muted-foreground">{field}</FieldLabel>
                          <Input
                            id={`${player.id}-${field}`}
                            aria-label={`${player.name} ${field}`}
                            type="number"
                            min={0}
                            step={field === "rating" || field === "adr" ? "0.01" : "1"}
                            value={player[field]}
                            onChange={(event) => void controller.updateManualPlayer(player.id, field, Number(event.target.value))}
                          />
                        </Field>
                      ))}
                      <Field>
                        <FieldLabel htmlFor={`${player.id}-swing`} className="text-xs text-muted-foreground">swing</FieldLabel>
                        <Input
                          id={`${player.id}-swing`}
                          aria-label={`${player.name} swing`}
                          value={player.swing}
                          onChange={(event) => void controller.updateManualPlayer(player.id, "swing", event.target.value)}
                        />
                      </Field>
                    </div>
                    {ledger.manualPlayers?.[player.id] && (
                      <Button variant="ghost" size="sm" className="self-start" onClick={() => void controller.restoreParserPlayer(player.id)}>
                        Use parsed row
                      </Button>
                    )}
                  </div>
                ))}
              </div>
              </details>
            )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Imports ({ledger.imports.length})</CardTitle>
            </CardHeader>
            <CardContent>
              <ImportHistory imports={ledger.imports} onToggleImport={(id) => void controller.toggleImport(id)} />
            </CardContent>
            <CardFooter className="flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={() => setShowExport(true)}>
                Export bundle
              </Button>
              <BundleImportButton onImportBundle={(file) => void controller.readBundle(file)} />
              <Button variant="outline" size="sm" className="text-destructive" onClick={() => setShowClear(true)}>
                Clear this draft
              </Button>
            </CardFooter>
          </Card>
        </section>

        <main className="flex min-w-0 flex-col gap-3">
          <div className="sticky top-14 z-10 flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-background px-3 py-2 shadow-sm">
            <span className="flex items-center gap-2 text-sm font-medium">
              <span
                aria-hidden="true"
                className={`size-2 rounded-full ${ready ? "bg-emerald-500" : "bg-amber-500"}`}
              />
              {ready ? "Ready to post" : "Review needed"}
            </span>
            <div className="flex gap-2">
              <CopyButton label="Copy title" value={controller.output.title} disabled={!ready} />
              <CopyButton label="Copy body" value={controller.output.body} disabled={!ready} />
            </div>
          </div>
          <PostPreview title={controller.output.title} body={controller.output.body} />
        </main>
      </div>

      <Dialog
        open={Boolean(controller.pendingDecision)}
        onOpenChange={(open) => !open && void controller.resolveMatchDecision("cancel")}
      >
        <DialogContent
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            document.getElementById("match-decision-cancel")?.focus();
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            focusPasteTarget();
          }}
        >
          <DialogHeader>
            <DialogTitle>That paste belongs to another match</DialogTitle>
            <DialogDescription>
              The active draft will not change until you choose a destination.
            </DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <div className="text-xs text-muted-foreground">Active</div>
              <div>{match.team1.name} vs {match.team2.name}</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Incoming</div>
              <div>
                {controller.pendingDecision?.proposal.match?.team1.name} vs {controller.pendingDecision?.proposal.match?.team2.name}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button id="match-decision-cancel" variant="outline" onClick={() => void controller.resolveMatchDecision("cancel")}>
              Cancel
            </Button>
            {controller.pendingDecision?.matchingDraftId && (
              <Button variant="outline" onClick={() => void controller.resolveMatchDecision("switch")}>
                Switch and import
              </Button>
            )}
            <Button
              variant={controller.pendingDecision?.compatibleActive ? "outline" : "default"}
              onClick={() => void controller.resolveMatchDecision("create")}
            >
              Create new draft
            </Button>
            {controller.pendingDecision?.compatibleActive && (
              <Button onClick={() => void controller.resolveMatchDecision("associate")}>
                Import into active draft
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(controller.pendingBundle)}
        onOpenChange={(open) => !open && void controller.resolveBundle("cancel")}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>A draft with this identity already exists</DialogTitle>
            <DialogDescription>
              This archive includes raw clipboard payloads and manual notes. Replace removes the local version; Import as copy keeps both.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => void controller.resolveBundle("cancel")}>Cancel</Button>
            <Button variant="destructive" onClick={() => void controller.resolveBundle("replace")}>Replace local draft</Button>
            <Button onClick={() => void controller.resolveBundle("copy")}>Import as copy</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showExport} onOpenChange={setShowExport}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Export the complete local record?</DialogTitle>
            <DialogDescription>
              The bundle contains the structured draft, import history, manual edits, and the raw HLTV clipboard payloads. Share it only with people you trust.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowExport(false)}>Cancel</Button>
            <Button onClick={() => { controller.exportBundle(); setShowExport(false); }}>
              I understand — export
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showClear} onOpenChange={setShowClear}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Clear this draft from this browser?</DialogTitle>
            <DialogDescription>
              This permanently removes its snapshots, import history, manual notes, and recovery record. Other drafts are untouched.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowClear(false)}>Cancel</Button>
            <Button variant="destructive" onClick={() => { void controller.clearDraft(); setShowClear(false); }}>
              Clear draft
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
