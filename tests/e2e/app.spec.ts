import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test, type Page } from "@playwright/test";

const plain = readFileSync(
  resolve(process.cwd(), "tests/fixtures/hltv/completed-bo3/clipboard.txt"),
  "utf8",
);
const html = readFileSync(
  resolve(process.cwd(), "tests/fixtures/hltv/completed-bo3/clipboard.html"),
  "utf8",
);
const mapPlain = readFileSync(
  resolve(process.cwd(), "tests/fixtures/hltv/mapstats-ancient/clipboard.txt"),
  "utf8",
);
const mapHtml = readFileSync(
  resolve(process.cwd(), "tests/fixtures/hltv/mapstats-ancient/clipboard.html"),
  "utf8",
);

async function pasteCapture(
  page: Page,
  capture: { plain: string; html: string } = { plain, html },
) {
  await page.getByLabel("Paste copied HLTV page").evaluate(
    (target, payload) => {
      const transfer = new DataTransfer();
      transfer.setData("text/plain", payload.plain);
      transfer.setData("text/html", payload.html);
      target.dispatchEvent(
        new ClipboardEvent("paste", {
          bubbles: true,
          cancelable: true,
          clipboardData: transfer,
        }),
      );
    },
    capture,
  );
}

test("first run leads with the focused three-step paste workflow", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { name: /paste an hltv match page/i })).toBeVisible();
  await expect(page.getByText("Open the finished match on HLTV")).toBeVisible();
  await expect(page.getByText("Nothing leaves this browser.")).toBeVisible();
  await expect(page.getByLabel("Paste copied HLTV page")).toBeFocused();
  await expect(page.getByRole("button", { name: /copy title/i })).toHaveCount(0);
});

test("a real HLTV paste becomes a copy-ready Reddit preview well under 30 seconds", async ({
  context,
  page,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/");

  const startedAt = Date.now();
  await pasteCapture(page);

  await expect(page.getByText("Ready to post")).toBeVisible();
  await expect(page.getByRole("heading", { name: /100 Thieves vs Eternal Fire/ })).toBeVisible();
  await expect(page.getByText("Full Match Stats")).toBeVisible();
  await expect(page.getByText("🇩🇰 device ⊕").first()).toBeVisible();
  await expect(page.getByText("🇬🇧 Gizmy ♛").first()).toBeVisible();
  await expect(page.getByText("Map Vetoes")).toBeVisible();
  await expect(page.getByText("MAP 1: Ancient")).toBeVisible();
  const twoDigitMapScore = page.getByLabel("Ancient Eternal Fire score");
  await expect(twoDigitMapScore).toHaveValue("13");
  expect(await twoDigitMapScore.evaluate((input) => input.getBoundingClientRect().width)).toBeGreaterThanOrEqual(48);
  expect(Date.now() - startedAt).toBeLessThan(30_000);

  await page.getByRole("button", { name: /copy title/i }).click();
  await expect(page.getByRole("button", { name: /copied/i })).toBeVisible();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toContain(
    "100 Thieves vs Eternal Fire",
  );
});

test("the active draft and manual fixes survive a reload", async ({ page }) => {
  await page.goto("/");
  await pasteCapture(page);
  await expect(page.getByText("Ready to post")).toBeVisible();

  await page.getByLabel("Event").fill("Community Cup");
  await expect(page.getByRole("heading", { name: /community cup/i })).toBeVisible();
  await expect(page.getByText("Saved manual correction.")).toBeVisible();
  await expect(page.getByText("Ready to post")).toBeVisible();
  await page.getByLabel("Ancient 100 Thieves score").fill("16");
  await expect(page.getByText("Saved map correction.")).toBeVisible();
  await page.reload();

  await expect(page.getByLabel("Event")).toHaveValue("Community Cup");
  await expect(page.getByLabel("Ancient 100 Thieves score")).toHaveValue("16");
  await expect(page.getByRole("heading", { name: /community cup/i })).toBeVisible();
});

test("an exported raw-data bundle restores a cleared draft exactly", async ({ page }) => {
  await page.goto("/");
  await pasteCapture(page);
  await page.getByLabel("Event").fill("Community Cup");
  await expect(page.getByText("Saved manual correction.")).toBeVisible();

  await page.getByRole("button", { name: "Export bundle" }).click();
  await expect(page.getByRole("dialog", { name: /complete local record/i })).toContainText(
    "raw HLTV clipboard payloads",
  );
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: /i understand.*export/i }).click();
  const bundlePath = await (await downloadPromise).path();
  expect(bundlePath).toBeTruthy();

  await page.getByRole("button", { name: "Clear this draft" }).click();
  await expect(page.getByRole("dialog", { name: /clear this draft/i })).toContainText(
    "import history",
  );
  await page.getByRole("dialog", { name: /clear this draft/i }).getByRole("button", { name: "Clear draft" }).click();
  await expect(page.getByRole("heading", { name: /paste an hltv match page/i })).toBeVisible();

  await page.locator("input[type='file']").setInputFiles(bundlePath!);
  await expect(page.getByLabel("Event")).toHaveValue("Community Cup");
  await expect(page.getByTestId("import-history").locator("> li")).toHaveCount(1);
});

test("a paste for a different match cannot silently overwrite the active draft", async ({ page }) => {
  await page.goto("/");
  await pasteCapture(page);
  await expect(page.getByText("Ready to post")).toBeVisible();

  const incoming = {
    plain: plain.replaceAll("100 Thieves", "Ninjas in Pyjamas").replaceAll("Eternal Fire", "Astralis"),
    html: html.replaceAll("100 Thieves", "Ninjas in Pyjamas").replaceAll("Eternal Fire", "Astralis"),
  };
  await pasteCapture(page, incoming);

  const dialog = page.getByRole("dialog", { name: /another match/i });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText("100 Thieves vs Eternal Fire")).toBeVisible();
  await expect(dialog.getByText("Ninjas in Pyjamas vs Astralis")).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Cancel" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(page.getByLabel("Paste copied HLTV page").first()).toBeFocused();
  await expect(page.getByRole("heading", { name: /100 Thieves vs Eternal Fire/ })).toBeVisible();
});

test("Create new keeps a different match isolated from the active draft", async ({ page }) => {
  await page.goto("/");
  await pasteCapture(page);
  const incoming = {
    plain: plain.replaceAll("100 Thieves", "Ninjas in Pyjamas").replaceAll("Eternal Fire", "Astralis"),
    html: html.replaceAll("100 Thieves", "Ninjas in Pyjamas").replaceAll("Eternal Fire", "Astralis"),
  };
  await pasteCapture(page, incoming);

  await page.getByRole("dialog", { name: /another match/i }).getByRole("button", { name: "Create new draft" }).click();
  await expect(page.getByRole("heading", { name: /Ninjas in Pyjamas vs Astralis/ })).toBeVisible();
  const switcher = page.getByLabel("Draft");
  await expect(switcher.locator("option")).toHaveCount(2);
  await switcher.selectOption({ label: "100 Thieves / Eternal Fire" });
  await expect(page.getByRole("heading", { name: /100 Thieves vs Eternal Fire/ })).toBeVisible();
  await expect(page.getByTestId("import-history").locator("> li")).toHaveCount(1);
});

test("Switch and import reopens a matching draft without duplicating its capture", async ({ page }) => {
  await page.goto("/");
  await pasteCapture(page);
  const incoming = {
    plain: plain.replaceAll("100 Thieves", "Ninjas in Pyjamas").replaceAll("Eternal Fire", "Astralis"),
    html: html.replaceAll("100 Thieves", "Ninjas in Pyjamas").replaceAll("Eternal Fire", "Astralis"),
  };
  await pasteCapture(page, incoming);
  await page.getByRole("dialog", { name: /another match/i }).getByRole("button", { name: "Create new draft" }).click();
  await expect(page.getByRole("heading", { name: /Ninjas in Pyjamas vs Astralis/ })).toBeVisible();

  await pasteCapture(page);
  const dialog = page.getByRole("dialog", { name: /another match/i });
  await dialog.getByRole("button", { name: "Switch and import" }).click();

  await expect(page.getByRole("heading", { name: /100 Thieves vs Eternal Fire/ })).toBeVisible();
  await expect(page.getByTestId("import-history").locator("> li")).toHaveCount(1);
  await expect(page.getByText(/no changes/i)).toBeVisible();
});

test("the sole reverted source stays visible and can be restored", async ({ page }) => {
  await page.goto("/");
  await pasteCapture(page);
  await page.getByTestId("import-history").locator("> li").first().getByRole("button", { name: "Revert" }).click();

  await expect(page.getByRole("heading", { name: /fully reverted/i })).toBeVisible();
  await page.getByRole("button", { name: "Restore" }).click();
  await expect(page.getByText("Ready to post")).toBeVisible();
  await expect(page.getByRole("heading", { name: /100 Thieves vs Eternal Fire/ })).toBeVisible();
});

test("a newer snapshot shows its diff and preserves a human-owned correction", async ({ page }) => {
  await page.goto("/");
  await pasteCapture(page);
  await expect(page.getByText("Ready to post")).toBeVisible();
  await page.getByLabel("Stage").fill("Community final");
  await expect(page.getByText("Saved manual correction.")).toBeVisible();

  const incoming = {
    plain: plain.replace(
      "* Quarter-final. Winner advances to the Closed Qualifier.",
      "* Grand final. Winner qualifies for the main event.",
    ),
    html,
  };
  await pasteCapture(page, incoming);

  await expect(page.getByText("1 parser conflict")).toBeVisible();
  await expect(page.getByLabel("Stage")).toHaveValue("Community final");
  await page.getByRole("button", { name: "Keep mine" }).click();
  await expect(page.getByText("Ready to post")).toBeVisible();
  await expect(page.getByLabel("Stage")).toHaveValue("Community final");
  const latestImport = page.getByTestId("import-history").locator("> li").first();
  await latestImport.locator("summary[aria-label='Show import changes']").click();
  await expect(latestImport.getByText("stage", { exact: true })).toBeVisible();
  await latestImport.getByRole("button", { name: "Revert" }).click();
  await expect(page.getByLabel("Stage")).toHaveValue("Community final");
});

test("a map-stat page can arrive before the main page and enriches one draft", async ({ page }) => {
  await page.goto("/");
  await pasteCapture(page, { plain: mapPlain, html: mapHtml });

  await expect(page.getByText("Review needed")).toBeVisible();
  await expect(page.getByLabel("Map 1 name")).toHaveValue("Ancient");
  await pasteCapture(page);

  await expect(page.getByText("Ready to post")).toBeVisible();
  await expect(page.getByTestId("import-history").locator("> li")).toHaveCount(2);
  await expect(page.getByRole("heading", { name: /100 Thieves vs Eternal Fire/ })).toBeVisible();
});

test("the command center remains usable at a narrow phone viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await pasteCapture(page);

  await expect(page.getByRole("button", { name: /copy title/i })).toBeVisible();
  await expect(page.getByLabel("Quick edits")).toBeVisible();
  const widths = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    content: document.documentElement.scrollWidth,
  }));
  expect(widths.content).toBeLessThanOrEqual(widths.viewport);
});

test("hostile pasted markup is rejected without making an external request", async ({ page }) => {
  const externalRequests: string[] = [];
  page.on("request", (request) => {
    if (!request.url().startsWith("http://127.0.0.1:4173")) externalRequests.push(request.url());
  });
  await page.goto("/");

  await pasteCapture(page, {
    plain: "HLTV Match stats",
    html: '<img src="https://attacker.invalid/pixel"><script>fetch("https://attacker.invalid/x")</script>',
  });

  await expect(page.getByText(/core match block could not be read/i)).toBeVisible();
  expect(externalRequests).toEqual([]);
});
