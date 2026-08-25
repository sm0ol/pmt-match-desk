import { useEffect, useRef, useState, type ClipboardEvent, type ReactNode } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { DraftLedger, ManualFields } from "../domain/types";
import { useDraftController, type WorkStatus } from "./useDraftController";
import "./styles.css";

function BrandMark() {
  return <span className="brand-mark" aria-hidden="true">P</span>;
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
    <label className="paste-target">
      <span className="paste-kicker">IMPORT CHANNEL / ALWAYS LISTENING</span>
      <textarea
        ref={ref}
        aria-label="Paste copied HLTV page"
        onPaste={paste}
        placeholder="Paste copied HLTV page here…"
        rows={2}
      />
      <span className="paste-shortcut"><kbd>⌘</kbd><kbd>V</kbd> or <kbd>Ctrl</kbd><kbd>V</kbd></span>
    </label>
  );
}

function StatusPill({ tone, children }: { tone: WorkStatus["tone"]; children: ReactNode }) {
  return <span className={`status-pill status-${tone}`} role="status" aria-live="polite">{children}</span>;
}

function ChangeSummary({ changes = [] }: { changes?: NonNullable<import("../domain/types").ImportRecord["changes"]> }) {
  const meaningful = changes.filter((change) => change.kind !== "unchanged");
  const counts = changes.reduce<Record<string, number>>((result, change) => {
    result[change.kind] = (result[change.kind] ?? 0) + 1;
    return result;
  }, {});
  return (
    <details className="change-summary">
      <summary aria-label="Show import changes">
        <span className="change-added">+{counts.added ?? 0}</span>
        <span className="change-changed">Δ{counts.changed ?? 0}</span>
        <span className="change-retained">↺{counts.retained ?? 0}</span>
      </summary>
      <ul>
        {(meaningful.length ? meaningful : changes.slice(0, 1)).map((change, index) => (
          <li key={`${change.field}:${index}`}>
            <span>{change.kind}</span>
            <strong>{change.field}</strong>
            {change.kind === "changed" && <small>{change.before} → {change.after}</small>}
            {change.kind === "retained" && <small>{change.before} kept from the prior snapshot</small>}
            {change.kind === "added" && <small>{change.after}</small>}
          </li>
        ))}
      </ul>
    </details>
  );
}

function EmptyDesk({
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
  const bundleInput = useRef<HTMLInputElement>(null);
  return (
    <main className="empty-desk">
      <div className="empty-grid" aria-hidden="true" />
      <header className="empty-topbar">
        <a className="brand" href="#top" aria-label="PMT Thread Creator home">
          <BrandMark />
          <span>POST-MATCH TEAM</span>
        </a>
        <span className="local-badge">LOCAL / PRIVATE</span>
      </header>
      <section className="empty-copy">
        <span className="eyebrow">MATCH DESK 01 — HUMAN ASSISTED</span>
        <h1>Turn HLTV into a post.<br /><em>Before chat asks where it is.</em></h1>
        <p>One paste builds the thread. You handle the calls that need a human.</p>
      </section>
      <section className="empty-import" aria-label="Import instructions">
        <ol className="import-steps">
          <li><span>01</span> Open the finished match on HLTV</li>
          <li><span>02</span> Press Ctrl+A, then Ctrl+C</li>
          <li><span>03</span> Paste below</li>
        </ol>
        <PasteTarget onCapture={onCapture} autoFocus />
        {status.tone !== "idle" && (
          <div className={`empty-status status-${status.tone}`} role="status" aria-live="polite">
            {status.message}
          </div>
        )}
        {canRetry && <button onClick={onRetry}>Retry last recognized paste</button>}
        <p className="privacy-note">Nothing leaves this browser. No account. No scraper. No telemetry.</p>
        <div className="empty-recovery">
          <button onClick={() => bundleInput.current?.click()}>Import saved bundle</button>
          <span>Recovery bundles may contain raw copied source data.</span>
          <input
            ref={bundleInput}
            type="file"
            accept=".json,.pmt.json,application/json"
            hidden
            onChange={(event) => event.target.files?.[0] && onImportBundle(event.target.files[0])}
          />
        </div>
      </section>
      <footer className="empty-footer"><span>BUILT FOR r/GLOBALOFFENSIVE</span><span>PMT / 2026</span></footer>
    </main>
  );
}

function DormantDraft({
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
    <main className="empty-desk dormant-desk">
      <header className="empty-topbar">
        <a className="brand" href="#top"><BrandMark /><span>PMT / MATCH DESK</span></a>
        <label className="draft-select-label">DRAFT
          <select value={ledger.id} onChange={(event) => onSwitchDraft(event.target.value)}>
            {drafts.map((draft) => <option key={draft.id} value={draft.id}>{draft.id}</option>)}
          </select>
        </label>
      </header>
      <section className="empty-copy">
        <span className="eyebrow">DRAFT HISTORY / NO ACTIVE SOURCES</span>
        <h1>This draft is fully reverted.<br /><em>Restore a source or paste a new snapshot.</em></h1>
        <StatusPill tone={status.tone}>{status.message}</StatusPill>
      </section>
      <section className="empty-import dormant-recovery" aria-label="Reverted import recovery">
        <PasteTarget onCapture={onCapture} autoFocus />
        <h2>Import history</h2>
        <ol className="history-list">
          {[...ledger.imports].reverse().map((entry) => (
            <li key={entry.id}>
              <div><strong>{entry.match.team1.name} vs {entry.match.team2.name}</strong><small>Reverted source</small></div>
              <button onClick={() => onToggleImport(entry.id)}>Restore</button>
            </li>
          ))}
        </ol>
      </section>
    </main>
  );
}

function Field({
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
  return (
    <label className="field">
      <span>{label}</span>
      <input
        type={type}
        value={value}
        min={type === "number" ? 0 : undefined}
        onChange={(event) => onCommit(type === "number" ? Number(event.target.value) : event.target.value)}
      />
    </label>
  );
}

function RedditPreview({ title, body }: { title: string; body: string }) {
  return (
    <article className="reddit-card" aria-label="Reddit-style live preview">
      <div className="reddit-votes" aria-hidden="true"><span>▲</span><strong>—</strong><span>▼</span></div>
      <div className="reddit-post">
        <div className="reddit-meta">Posted by <span>u/PostMatchTeam</span> just now</div>
        <h2>{title}</h2>
        <div className="flair">Discussion | Esports</div>
        <div className="reddit-body">
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
        </div>
      </div>
    </article>
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
    <div className="copy-action">
      <button className="copy-button" onClick={copy} disabled={disabled}>{state === "copied" ? "Copied" : label}<span aria-hidden="true">↗</span></button>
      {state === "failed" && <span className="copy-note" role="status">Copy was blocked. Select the preview text or retry.</span>}
    </div>
  );
}

function Dialog({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  const dialogRef = useRef<HTMLElement>(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const dialog = dialogRef.current;
    if (!dialog) return;
    const buttons = () => [...dialog.querySelectorAll<HTMLElement>("button, input, select, textarea, [href], [tabindex]:not([tabindex='-1'])")].filter((element) => !element.hasAttribute("disabled"));
    (dialog.querySelector<HTMLElement>(".dialog-actions button:last-child") ?? buttons()[0])?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = buttons();
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    dialog.addEventListener("keydown", keydown);
    return () => {
      dialog.removeEventListener("keydown", keydown);
      previous?.focus();
    };
  }, []);
  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section ref={dialogRef} className="dialog" role="dialog" aria-modal="true" aria-labelledby="dialog-title">
        <button className="dialog-close" onClick={onClose} aria-label="Close dialog">×</button>
        <span className="eyebrow">DECISION REQUIRED</span>
        <h2 id="dialog-title">{title}</h2>
        {children}
      </section>
    </div>
  );
}

export default function App() {
  const controller = useDraftController();
  const { importClipboard } = controller;
  const [showExport, setShowExport] = useState(false);
  const [showClear, setShowClear] = useState(false);
  const importInput = useRef<HTMLInputElement>(null);
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

  if (!controller.hydrated) return <div className="boot-screen">Opening match desk…</div>;
  if (!ledger) {
    return (
      <EmptyDesk
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
      <DormantDraft
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
  const ready = controller.output.ready && controller.projection.conflicts.length === 0;
  const cancelMatchDecision = () => {
    void controller.resolveMatchDecision("cancel");
    window.requestAnimationFrame(() => {
      document.querySelector<HTMLTextAreaElement>("textarea[aria-label='Paste copied HLTV page']")?.focus();
    });
  };

  return (
    <div className="app-shell" id="top">
      <header className="app-topbar">
        <a className="brand" href="#top"><BrandMark /><span>PMT / MATCH DESK</span></a>
        <div className="top-actions">
          <StatusPill tone={controller.status.tone}>{controller.status.message}</StatusPill>
          <label className="draft-select-label">DRAFT
            <select value={ledger.id} onChange={(event) => void controller.switchDraft(event.target.value)}>
              {controller.drafts.map((draft) => {
                const draftMatch = draft.imports.find((entry) => entry.active)?.match;
                return <option key={draft.id} value={draft.id}>{draftMatch ? `${draftMatch.team1.name} / ${draftMatch.team2.name}` : draft.id}</option>;
              })}
            </select>
          </label>
        </div>
      </header>

      <div className="command-grid">
        <aside className="status-rail" aria-label="Draft readiness">
          <div className="rail-label">POST STATUS</div>
          <div className={`readiness ${ready ? "is-ready" : "needs-work"}`}>
            <span className="readiness-dot" />
            <div><strong>{ready ? "READY TO POST" : "REVIEW NEEDED"}</strong><small>{ready ? "Core fields are complete" : `${controller.output.issues.length + controller.projection.conflicts.length} blocking item${controller.output.issues.length + controller.projection.conflicts.length === 1 ? "" : "s"}`}</small></div>
          </div>
          {controller.lastRejectedCapture && (
            <button onClick={() => void controller.retryLastRejected()}>Retry last recognized paste</button>
          )}
          <dl className="signal-list">
            <div><dt>IMPORTS</dt><dd>{ledger.imports.length.toString().padStart(2, "0")}</dd></div>
            <div><dt>MAPS</dt><dd>{match.maps.length.toString().padStart(2, "0")}</dd></div>
            <div><dt>PLAYERS</dt><dd>{match.players.length.toString().padStart(2, "0")}</dd></div>
            <div><dt>CONFLICTS</dt><dd className={controller.projection.conflicts.length ? "hot" : ""}>{controller.projection.conflicts.length.toString().padStart(2, "0")}</dd></div>
          </dl>
          <section className="rail-section">
            <h3>Import history</h3>
            <ol className="history-list">
              {[...ledger.imports].reverse().map((entry, index) => (
                <li key={entry.id}>
                  <span className={`history-index ${entry.active ? "active" : ""}`}>{String(ledger.imports.length - index).padStart(2, "0")}</span>
                  <div><strong>{entry.match.maps.length} maps / {entry.match.players.length} stats</strong><small>{entry.active ? "Active source" : "Reverted"}</small><ChangeSummary changes={entry.changes} /></div>
                  <button onClick={() => void controller.toggleImport(entry.id)}>{entry.active ? "Revert" : "Restore"}</button>
                </li>
              ))}
            </ol>
          </section>
          <section className="rail-section data-actions">
            <h3>Portable recovery</h3>
            <button onClick={() => setShowExport(true)}>Export bundle</button>
            <button onClick={() => importInput.current?.click()}>Import bundle</button>
            <input
              ref={importInput}
              type="file"
              accept=".json,.pmt.json,application/json"
              hidden
              onChange={(event) => event.target.files?.[0] && void controller.readBundle(event.target.files[0])}
            />
            <button className="danger-text" onClick={() => setShowClear(true)}>Clear this draft</button>
          </section>
        </aside>

        <main className="preview-column">
          <PasteTarget onCapture={(capture) => void controller.importClipboard(capture)} />
          <div className="preview-heading">
            <div><span className="eyebrow">LIVE OUTPUT / REDDIT PREVIEW</span><h1>{match.team1.name} <em>vs</em> {match.team2.name}</h1></div>
            <div className="copy-cluster">
              <CopyButton label="Copy title" value={controller.output.title} disabled={!ready} />
              <CopyButton label="Copy body" value={controller.output.body} disabled={!ready} />
            </div>
          </div>
          <RedditPreview title={controller.output.title} body={controller.output.body} />
        </main>

        <aside className="edit-panel" aria-label="Quick edits">
          <div className="panel-heading"><span className="eyebrow">HUMAN CONTROL</span><h2>Quick fixes</h2><p>Edits here stay yours when a newer page is pasted.</p></div>
          {controller.projection.conflicts.length > 0 && (
            <section className="conflict-box">
              <h3>{controller.projection.conflicts.length} parser conflict{controller.projection.conflicts.length === 1 ? "" : "s"}</h3>
              {controller.projection.conflicts.map((conflict) => (
                <div className="conflict-row" key={conflict.field}>
                  <span>{conflict.field}</span><p>Mine: <strong>{conflict.mine}</strong><br />Imported: <strong>{conflict.imported}</strong></p>
                  <button onClick={() => void controller.keepManual(conflict.field)}>Keep mine</button>
                  <button onClick={() => void controller.restoreParserOwnership(conflict.field)}>Use imported</button>
                </div>
              ))}
            </section>
          )}
          <div className="field-grid scores-grid">
            <Field label="Team one" value={match.team1.name} onCommit={commit("team1Name")} />
            <Field label="Score" value={match.seriesScore[0]} type="number" onCommit={commit("team1Score")} />
            <Field label="Team two" value={match.team2.name} onCommit={commit("team2Name")} />
            <Field label="Score" value={match.seriesScore[1]} type="number" onCommit={commit("team2Score")} />
          </div>
          <Field label="Event" value={match.event} onCommit={commit("event")} />
          <Field label="Stage" value={match.stage} onCommit={commit("stage")} />
          <label className="field"><span>Context line</span><textarea value={match.context} rows={3} onChange={(event) => commit("context")(event.target.value)} /></label>
          <section className="parsed-data">
            <h3>Parsed maps <span>{match.maps.length}</span></h3>
            {match.maps.map((map, index) => (
              <div className="map-row" key={map.id}>
                <span>{String(index + 1).padStart(2, "0")}</span>
                <input aria-label={`Map ${index + 1} name`} value={map.name} onChange={(event) => void controller.updateManualMap(map.id, "name", event.target.value)} />
                <div className="map-score-edit">
                  <input aria-label={`${map.name} ${match.team1.name} score`} type="number" min={0} value={map.team1Score} onChange={(event) => void controller.updateManualMap(map.id, "team1Score", Number(event.target.value))} />
                  <b>—</b>
                  <input aria-label={`${map.name} ${match.team2.name} score`} type="number" min={0} value={map.team2Score} onChange={(event) => void controller.updateManualMap(map.id, "team2Score", Number(event.target.value))} />
                </div>
                {ledger.manualMaps?.[map.id] && <button onClick={() => void controller.restoreParserMap(map.id)}>Use parsed</button>}
              </div>
            ))}
          </section>
          {match.players.length > 0 && (
            <details className="player-editors">
              <summary>Player stats <span>{match.players.length}</span></summary>
              <p>Corrections stay human-owned across later imports.</p>
              {match.players.map((player) => (
                <section className="player-editor" key={player.id}>
                  <div className="player-editor-head">
                    <input aria-label={`${player.name} name`} value={player.name} onChange={(event) => void controller.updateManualPlayer(player.id, "name", event.target.value)} />
                    <select aria-label={`${player.name} team`} value={player.team} onChange={(event) => void controller.updateManualPlayer(player.id, "team", event.target.value)}>
                      <option value={match.team1.name}>{match.team1.name}</option>
                      <option value={match.team2.name}>{match.team2.name}</option>
                    </select>
                  </div>
                  <div className="player-stat-grid">
                    {(["kills", "deaths", "adr", "rating"] as const).map((field) => (
                      <label key={field}><span>{field}</span><input aria-label={`${player.name} ${field}`} type="number" min={0} step={field === "rating" || field === "adr" ? "0.01" : "1"} value={player[field]} onChange={(event) => void controller.updateManualPlayer(player.id, field, Number(event.target.value))} /></label>
                    ))}
                    <label><span>swing</span><input aria-label={`${player.name} swing`} value={player.swing} onChange={(event) => void controller.updateManualPlayer(player.id, "swing", event.target.value)} /></label>
                  </div>
                  {ledger.manualPlayers?.[player.id] && <button onClick={() => void controller.restoreParserPlayer(player.id)}>Use parsed row</button>}
                </section>
              ))}
            </details>
          )}
        </aside>
      </div>

      {controller.pendingDecision && (
        <Dialog title="That paste belongs to another match" onClose={cancelMatchDecision}>
          <div className="identity-compare"><div><span>ACTIVE</span><strong>{match.team1.name} vs {match.team2.name}</strong></div><div><span>INCOMING</span><strong>{controller.pendingDecision.proposal.match?.team1.name} vs {controller.pendingDecision.proposal.match?.team2.name}</strong></div></div>
          <p>The active draft will not change until you choose a destination.</p>
          <div className="dialog-actions">
            {controller.pendingDecision.compatibleActive && <button className="primary" onClick={() => void controller.resolveMatchDecision("associate")}>Import into active draft</button>}
            {controller.pendingDecision.matchingDraftId && <button onClick={() => void controller.resolveMatchDecision("switch")}>Switch and import</button>}
            <button className={controller.pendingDecision.compatibleActive ? "" : "primary"} onClick={() => void controller.resolveMatchDecision("create")}>Create new draft</button>
            <button onClick={cancelMatchDecision}>Cancel</button>
          </div>
        </Dialog>
      )}

      {controller.pendingBundle && (
        <Dialog title="A draft with this identity already exists" onClose={() => void controller.resolveBundle("cancel")}>
          <p>This archive includes raw clipboard payloads and manual notes. Replace removes the local version; Import as Copy keeps both.</p>
          <div className="dialog-actions"><button className="danger" onClick={() => void controller.resolveBundle("replace")}>Replace local draft</button><button className="primary" onClick={() => void controller.resolveBundle("copy")}>Import as copy</button><button onClick={() => void controller.resolveBundle("cancel")}>Cancel</button></div>
        </Dialog>
      )}

      {showExport && (
        <Dialog title="Export the complete local record?" onClose={() => setShowExport(false)}>
          <p>The bundle contains the structured draft, import history, manual edits, and the raw HLTV clipboard payloads. Share it only with people you trust.</p>
          <div className="dialog-actions"><button className="primary" onClick={() => { controller.exportBundle(); setShowExport(false); }}>I understand — export</button><button onClick={() => setShowExport(false)}>Cancel</button></div>
        </Dialog>
      )}

      {showClear && (
        <Dialog title="Clear this draft from this browser?" onClose={() => setShowClear(false)}>
          <p>This permanently removes its snapshots, import history, manual notes, and recovery record. Other drafts are untouched.</p>
          <div className="dialog-actions"><button className="danger" onClick={() => { void controller.clearDraft(); setShowClear(false); }}>Clear draft</button><button onClick={() => setShowClear(false)}>Cancel</button></div>
        </Dialog>
      )}
    </div>
  );
}
