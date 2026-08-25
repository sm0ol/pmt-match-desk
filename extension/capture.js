// Runs on HLTV match and map-stats pages. Answers capture requests from the
// background worker with the same dual payload a Ctrl+A / Ctrl+C produces:
// the page text and the page HTML.

// The app's parser rejects oversized input, so stay inside its budgets.
const MAX_PLAIN_CHARS = 119000;
const MAX_HTML_CHARS = 2900000;

function buildCapture() {
  const clone = document.body.cloneNode(true);
  for (const element of clone.querySelectorAll(
    "script, noscript, style, iframe, canvas, video, audio, link, template",
  )) {
    element.remove();
  }
  let html = clone.outerHTML;
  if (html.length > MAX_HTML_CHARS) {
    for (const element of clone.querySelectorAll("[style]")) element.removeAttribute("style");
    html = clone.outerHTML.slice(0, MAX_HTML_CHARS);
  }
  const statsLinks = [];
  const seen = new Set();
  for (const anchor of document.querySelectorAll('a[href*="/stats/matches/mapstatsid/"]')) {
    if (seen.has(anchor.href)) continue;
    seen.add(anchor.href);
    const holder = anchor.closest("[class*='mapholder']");
    const nameNode = holder ? holder.querySelector("[class*='mapname']") : null;
    statsLinks.push({ url: anchor.href, name: (nameNode ? nameNode.textContent : "").trim() });
  }
  return {
    plain: document.body.innerText.slice(0, MAX_PLAIN_CHARS),
    html,
    url: location.href,
    statsLinks,
  };
}

// One-shot mode shows the capture progress on the HLTV page itself, so the
// user never has to look at the desk tab. All text goes in via textContent.
const OVERLAY_ID = "pmt-capture-overlay";
let overlayTimer = null;

const STEP_ICONS = { pending: "○", active: "…", done: "✓", failed: "✕" };
const STEP_COLORS = { pending: "#6b7280", active: "#60a5fa", done: "#34d399", failed: "#f87171" };

function getOverlay() {
  let overlay = document.getElementById(OVERLAY_ID);
  if (overlay) return overlay;
  overlay = document.createElement("div");
  overlay.id = OVERLAY_ID;
  overlay.style.cssText = [
    "position:fixed",
    "top:16px",
    "right:16px",
    "z-index:2147483647",
    "min-width:240px",
    "max-width:320px",
    "background:#111318",
    "color:#e5e7eb",
    "border:1px solid #2b303b",
    "border-radius:10px",
    "padding:12px 14px",
    "font:12px/1.5 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif",
    "box-shadow:0 8px 24px rgba(0,0,0,.45)",
  ].join(";");
  const title = document.createElement("div");
  title.dataset.role = "title";
  title.textContent = "PMT Match Desk";
  title.style.cssText = "font-weight:600;margin-bottom:6px;color:#f9fafb";
  const list = document.createElement("div");
  list.dataset.role = "steps";
  overlay.append(title, list);
  document.documentElement.append(overlay);
  return overlay;
}

function renderOverlaySteps(steps) {
  if (overlayTimer) {
    clearTimeout(overlayTimer);
    overlayTimer = null;
  }
  const overlay = getOverlay();
  overlay.querySelector("[data-role='title']").textContent = "PMT Match Desk — building draft";
  const list = overlay.querySelector("[data-role='steps']");
  list.textContent = "";
  for (const step of steps) {
    const row = document.createElement("div");
    row.style.cssText = "display:flex;gap:8px;align-items:baseline";
    const icon = document.createElement("span");
    const status = STEP_ICONS[step.status] ? step.status : "pending";
    icon.textContent = STEP_ICONS[status];
    icon.style.cssText = `width:12px;color:${STEP_COLORS[status]}`;
    const label = document.createElement("span");
    label.textContent = step.detail ? `${step.label} — ${step.detail}` : step.label;
    if (status === "failed") label.style.color = "#f87171";
    row.append(icon, label);
    list.append(row);
  }
}

function renderOverlayFinal(ok, message) {
  const overlay = getOverlay();
  overlay.querySelector("[data-role='title']").textContent = ok
    ? "PMT Match Desk — done"
    : "PMT Match Desk";
  const list = overlay.querySelector("[data-role='steps']");
  const note = document.createElement("div");
  note.textContent = message;
  note.style.cssText = `margin-top:6px;color:${ok ? "#34d399" : "#fbbf24"}`;
  list.append(note);
  if (overlayTimer) clearTimeout(overlayTimer);
  overlayTimer = setTimeout(() => overlay.remove(), ok ? 4000 : 8000);
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message && message.type === "pmt-capture") {
    sendResponse(buildCapture());
    return false;
  }
  if (message && message.type === "pmt-progress" && Array.isArray(message.steps)) {
    renderOverlaySteps(message.steps);
    sendResponse({ ok: true });
    return false;
  }
  if (message && message.type === "pmt-overlay-final") {
    renderOverlayFinal(message.ok === true, typeof message.message === "string" ? message.message : "");
    sendResponse({ ok: true });
    return false;
  }
  return false;
});
