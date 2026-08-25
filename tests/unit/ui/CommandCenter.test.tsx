import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import App from "../../../src/app/App";

const plain = readFileSync(
  resolve(process.cwd(), "tests/fixtures/hltv/completed-bo3/clipboard.txt"),
  "utf8",
);
const html = readFileSync(
  resolve(process.cwd(), "tests/fixtures/hltv/completed-bo3/clipboard.html"),
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
    expect(await screen.findByRole("heading", { name: /turn hltv into a post/i })).toBeVisible();
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

    expect(await screen.findByRole("heading", { name: /^100 Thieves vs Eternal Fire$/ })).toBeVisible();
    expect(screen.getByRole("button", { name: /copy title/i })).toBeEnabled();
    expect(screen.getByText(/ready to post/i)).toBeVisible();
  });
});
