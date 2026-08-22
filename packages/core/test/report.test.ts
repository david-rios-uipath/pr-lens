import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ReportNotFoundError } from "../src/errors.js";
import { readReport, writeReport, type Report } from "../src/report.js";

const sample: Report = {
  repo: "UiPath/flow-workbench",
  generatedAt: "2026-08-21T00:00:00.000Z",
  components: [{ name: "src/flow-editor", prCount: 1 }],
  prs: [
    {
      number: 1, title: "Fix typo", author: "octocat",
      url: "https://github.com/UiPath/flow-workbench/pull/1",
      updatedAt: "2026-08-21T00:00:00.000Z", isDraft: false,
      mergeable: "MERGEABLE", additions: 1, deletions: 1, changedFiles: 1,
      ci: "SUCCESS", reviewState: "NONE", labels: [],
      componentPrimary: "src/flow-editor", componentsSecondary: [],
      componentShares: { "src/flow-editor": 1 },
      scores: {
        reviewability: {
          score: 90,
          breakdown: [{ factor: "diffSize", weight: 0.25, value: 1, reason: "2 lines changed" }],
        },
      },
    },
  ],
};

describe("report round-trip", () => {
  it("writes then reads an identical report", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pr-lens-"));
    await writeReport(dir, sample);
    await expect(readReport(dir)).resolves.toEqual(sample);
  });

  it("throws ReportNotFoundError when missing", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pr-lens-"));
    await expect(readReport(dir)).rejects.toBeInstanceOf(ReportNotFoundError);
  });

  it("rejects a malformed report file", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pr-lens-"));
    const { mkdir, writeFile } = await import("node:fs/promises");
    await mkdir(join(dir, ".pr-lens"), { recursive: true });
    await writeFile(join(dir, ".pr-lens", "report.json"), JSON.stringify({ nope: true }));
    await expect(readReport(dir)).rejects.toThrow(/report/i);
  });
});
