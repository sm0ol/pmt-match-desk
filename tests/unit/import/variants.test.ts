import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parseHltvClipboard } from "../../../src/import/parseHltvClipboard";

const plain = readFileSync(
  resolve(process.cwd(), "tests/fixtures/hltv/completed-bo3/clipboard.txt"),
  "utf8",
);
const html = readFileSync(
  resolve(process.cwd(), "tests/fixtures/hltv/completed-bo3/clipboard.html"),
  "utf8",
);

const parse = (variant: string) => parseHltvClipboard({ plain: variant, html });

describe("main-page layout and series variants", () => {
  it.each([
    ["BO1", "Best of 1 (Online)", 1],
    ["BO5", "Best of 5 (Online)", 5],
  ])("recognizes a %s series", (_name, format, expected) => {
    expect(parse(plain.replace("Best of 3 (Online)", format)).match?.bestOf).toBe(expected);
  });

  it("recognizes a live snapshot as the same stable match", () => {
    const proposal = parse(plain.replace("Match over", "LIVE"));
    expect(proposal.kind).toBe("main-match");
    expect(proposal.match?.id).toBe("2397078");
    expect(proposal.match?.state).toBe("live");
  });

  it("rejects copied HTML beyond the structural depth budget", () => {
    const deepHtml = `${"<div>".repeat(90)}HLTV${"</div>".repeat(90)}`;
    const proposal = parseHltvClipboard({ plain: "HLTV Match stats", html: deepHtml });
    expect(proposal.kind).toBe("rejected");
    expect(proposal.confidence).toBe("missing");
    expect(proposal.diagnostics[0]).toMatch(/structurally complex/i);
  });

  it("retains overtime map scores without regulation-score assumptions", () => {
    const overtime = plain
      .replace("Ancient\n\n100 Thieves\n9", "Ancient\n\n100 Thieves\n16")
      .replace("Eternal Fire\n13\nDust2", "Eternal Fire\n19\nDust2");
    expect(parse(overtime).match?.maps[0]).toMatchObject({ team1Score: 16, team2Score: 19 });
  });

  it("omits unavailable detailed statistics without losing the core match", () => {
    const proposal = parse(plain.slice(0, plain.indexOf("Match stats")));
    expect(proposal.match?.players).toEqual([]);
    expect(proposal.match?.maps).toHaveLength(3);
  });

  it("ignores extra page chrome and flags a missing stage without guessing", () => {
    const degraded = `Advertisement\nCookie settings\n${plain}`.replace(
      "* Quarter-final. Winner advances to the Closed Qualifier.",
      "",
    );
    const proposal = parse(degraded);
    expect(proposal.match?.stage).toBe("");
    expect(proposal.confidence).toBe("review");
    expect(proposal.diagnostics).toContain("Event stage is missing and needs a quick edit.");
  });
});
