import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "../../../src/app/App";

const plain = readFileSync(
  resolve(process.cwd(), "tests/fixtures/hltv/completed-bo3/clipboard.txt"),
  "utf8",
);
const html = readFileSync(
  resolve(process.cwd(), "tests/fixtures/hltv/completed-bo3/clipboard.html"),
  "utf8",
);
const duplicatedLabelsPlain = readFileSync(
  resolve(process.cwd(), "tests/fixtures/hltv/duplicated-labels/clipboard.txt"),
  "utf8",
);

describe("command center", () => {
  beforeEach(async () => {
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.deleteDatabase("pmt-thread-creator");
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
      request.onblocked = () => resolve();
    });
  });
  afterEach(async () => {
    cleanup();
    await new Promise((resolve) => window.setTimeout(resolve, 0));
  });

  it("starts with a focused, concise paste workflow", async () => {
    render(<App />);
    expect(await screen.findByRole("heading", { name: /paste an hltv match page/i })).toBeVisible();
    const paste = await screen.findByLabelText(/paste copied hltv page/i);
    await waitFor(() => expect(paste).toHaveFocus());
    expect(screen.queryByRole("button", { name: /copy title/i })).not.toBeInTheDocument();
  });

  it("turns a real dual-MIME paste into a copy-ready preview", async () => {
    render(<App />);
    const paste = await screen.findByLabelText(/paste copied hltv page/i);
    fireEvent.paste(paste, {
      clipboardData: {
        getData: (type: string) => (type === "text/html" ? html : plain),
      },
    });

    expect(await screen.findByRole("heading", { name: /100 Thieves vs Eternal Fire/ })).toBeVisible();
    expect(screen.getByRole("button", { name: /copy title/i })).toBeEnabled();
    expect(screen.getByText(/ready to post/i)).toBeVisible();
  });

  it("imports extension capture batches and acknowledges them", async () => {
    render(<App />);
    await screen.findByLabelText(/paste copied hltv page/i);

    const acks: string[] = [];
    const onAck = (event: MessageEvent) => {
      const data = event.data as { source?: string; kind?: string; batchId?: string } | null;
      if (data?.source === "pmt-match-desk-app" && data.kind === "batch-received" && data.batchId) {
        acks.push(data.batchId);
      }
    };
    window.addEventListener("message", onAck);
    try {
      const batch = {
        source: "pmt-match-desk-extension",
        kind: "capture-batch",
        batchId: "batch-1",
        captures: [{ plain, html }],
      };
      const send = () =>
        window.dispatchEvent(
          new MessageEvent("message", { data: batch, origin: window.location.origin, source: window }),
        );
      send();
      send(); // a bridge retry of the same batch must not import twice

      expect(await screen.findByRole("heading", { name: /100 Thieves vs Eternal Fire/ })).toBeVisible();
      expect(screen.getByText(/ready to post/i)).toBeVisible();
      await waitFor(() => expect(acks).toContain("batch-1"));
      const historyItems = screen.getByTestId("import-history").querySelectorAll(":scope > li");
      expect(historyItems).toHaveLength(1);
    } finally {
      window.removeEventListener("message", onAck);
    }
  });

  it("switches or creates a draft for extension captures of a different match without asking", async () => {
    render(<App />);
    const paste = await screen.findByLabelText(/paste copied hltv page/i);
    fireEvent.paste(paste, {
      clipboardData: {
        getData: (type: string) => (type === "text/plain" ? duplicatedLabelsPlain : ""),
      },
    });
    expect(await screen.findByRole("heading", { name: /QuantumX vs Alter Ego/ })).toBeVisible();

    window.dispatchEvent(
      new MessageEvent("message", {
        data: {
          source: "pmt-match-desk-extension",
          kind: "capture-batch",
          batchId: "batch-2",
          captures: [{ plain, html }],
        },
        origin: window.location.origin,
        source: window,
      }),
    );

    expect(await screen.findByRole("heading", { name: /100 Thieves vs Eternal Fire/ })).toBeVisible();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByText(/ready to post/i)).toBeVisible();
  });

  it("opens the old Reddit submit page with the title prefilled", async () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    try {
      render(<App />);
      const paste = await screen.findByLabelText(/paste copied hltv page/i);
      fireEvent.paste(paste, {
        clipboardData: {
          getData: (type: string) => (type === "text/html" ? html : plain),
        },
      });
      const button = await screen.findByRole("button", { name: /post on reddit/i });
      await waitFor(() => expect(button).toBeEnabled());

      fireEvent.click(button);

      await waitFor(() => expect(open).toHaveBeenCalledTimes(1));
      const url = String(open.mock.calls[0][0]);
      expect(url).toContain("https://old.reddit.com/r/GlobalOffensive/submit?selftext=true&title=");
      expect(url).toContain(encodeURIComponent("Post-Match Discussion"));
      expect(url.length).toBeLessThanOrEqual(7500);
    } finally {
      open.mockRestore();
    }
  });

  it("shows the extension capture progress panel", async () => {
    render(<App />);
    await screen.findByLabelText(/paste copied hltv page/i);

    const send = (steps: Array<{ label: string; status: string }>) =>
      window.dispatchEvent(
        new MessageEvent("message", {
          data: { source: "pmt-match-desk-extension", kind: "capture-progress", steps },
          origin: window.location.origin,
          source: window,
        }),
      );
    send([
      { label: "Match page", status: "done" },
      { label: "Mirage stats", status: "active" },
      { label: "Nuke stats", status: "pending" },
    ]);

    expect(await screen.findByText("Importing from HLTV")).toBeVisible();
    expect(screen.getByText("Mirage stats")).toBeVisible();

    send([
      { label: "Match page", status: "done" },
      { label: "Mirage stats", status: "done" },
      { label: "Nuke stats", status: "failed" },
    ]);
    expect(await screen.findByText("Nuke stats — skipped")).toBeVisible();
  });

  it("ignores window messages that are not extension capture batches", async () => {
    render(<App />);
    await screen.findByLabelText(/paste copied hltv page/i);

    window.dispatchEvent(
      new MessageEvent("message", {
        data: {
          source: "someone-else",
          kind: "capture-batch",
          batchId: "batch-x",
          captures: [{ plain, html }],
        },
        origin: window.location.origin,
        source: window,
      }),
    );

    await new Promise((resolve) => window.setTimeout(resolve, 50));
    expect(screen.queryByRole("button", { name: /copy title/i })).not.toBeInTheDocument();
  });

  it("explains a missing source URL and lets the operator resolve it", async () => {
    render(<App />);
    const paste = await screen.findByLabelText(/paste copied hltv page/i);
    fireEvent.paste(paste, {
      clipboardData: {
        getData: (type: string) => (type === "text/plain" ? duplicatedLabelsPlain : ""),
      },
    });

    expect(await screen.findByRole("heading", { name: /QuantumX vs Alter Ego/ })).toBeVisible();
    expect(screen.getByText("Fix before copying")).toBeVisible();
    expect(screen.getByText(/match URL could not be identified/i)).toBeVisible();
    const sourceUrl = screen.getByLabelText(/HLTV match URL/i);
    expect(screen.getByRole("button", { name: /copy body/i })).toBeDisabled();

    fireEvent.change(sourceUrl, {
      target: { value: "https://www.hltv.org/matches/2397000/quantumx-vs-alter-ego-event" },
    });

    await waitFor(() => expect(screen.getByRole("button", { name: /copy body/i })).toBeEnabled());
    expect(screen.getByText(/ready to post/i)).toBeVisible();
  });
});
