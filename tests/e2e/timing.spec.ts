import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test, type Browser, type Page } from "@playwright/test";

const plain = readFileSync(
  resolve(process.cwd(), "tests/fixtures/hltv/completed-bo3/clipboard.txt"),
  "utf8",
);
const html = readFileSync(
  resolve(process.cwd(), "tests/fixtures/hltv/completed-bo3/clipboard.html"),
  "utf8",
);

interface TimedWorkflow {
  name: "core" | "flagged-fix" | "enriched";
  capture: { plain: string; html: string };
  fix?: (page: Page) => Promise<void>;
}

async function paste(page: Page, capture: { plain: string; html: string }) {
  await page.getByLabel("Paste copied HLTV page").evaluate((target, payload) => {
    const transfer = new DataTransfer();
    transfer.setData("text/plain", payload.plain);
    transfer.setData("text/html", payload.html);
    target.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: transfer }));
  }, capture);
}

async function timeWorkflow(browser: Browser, workflow: TimedWorkflow): Promise<number> {
  const context = await browser.newContext({ permissions: ["clipboard-read", "clipboard-write"] });
  const page = await context.newPage();
  await page.goto("/");
  const startedAt = performance.now();
  await paste(page, workflow.capture);
  if (workflow.fix) await workflow.fix(page);
  await expect(page.getByText("READY TO POST")).toBeVisible();
  await page.getByRole("button", { name: "Copy title" }).click();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toContain("Post-Match Discussion");
  await page.getByRole("button", { name: "Copy body" }).click();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toContain("Post-Match Team");
  const elapsed = Math.round(performance.now() - startedAt);
  await context.close();
  return elapsed;
}

test("three consecutive core, flagged-fix, and enriched runs remain under 30 seconds", async ({
  browser,
}, testInfo) => {
  const workflows: TimedWorkflow[] = [
    {
      name: "core",
      capture: { plain: plain.slice(0, plain.indexOf("Match stats")), html },
    },
    {
      name: "flagged-fix",
      capture: {
        plain: plain.replace("* Quarter-final. Winner advances to the Closed Qualifier.", ""),
        html,
      },
      fix: async (page) => {
        await expect(page.getByText("REVIEW NEEDED")).toBeVisible();
        await page.getByLabel("Stage").fill("Quarter-final");
      },
    },
    { name: "enriched", capture: { plain, html } },
  ];
  const results: Record<string, number[]> = {};

  for (const workflow of workflows) {
    results[workflow.name] = [];
    for (let run = 0; run < 3; run += 1) {
      const elapsed = await timeWorkflow(browser, workflow);
      results[workflow.name].push(elapsed);
      expect(elapsed, `${workflow.name} run ${run + 1}`).toBeLessThan(30_000);
    }
  }

  await testInfo.attach("under-30-seconds.json", {
    body: JSON.stringify(results, null, 2),
    contentType: "application/json",
  });
});
