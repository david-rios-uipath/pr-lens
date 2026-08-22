import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ReportNotFoundError } from "../src/errors";
import { listReports, readReport, repoKey, writeReport, type Report } from "../src/report";

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
    await expect(readReport(dir, sample.repo)).resolves.toEqual(sample);
  });

  it("stores reports for different repos side by side", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pr-lens-"));
    const other: Report = { ...sample, repo: "acme/widgets", prs: [] };
    await writeReport(dir, sample);
    await writeReport(dir, other);
    await expect(readReport(dir, sample.repo)).resolves.toEqual(sample);
    await expect(readReport(dir, other.repo)).resolves.toEqual(other);
  });

  it("throws ReportNotFoundError when missing", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pr-lens-"));
    await expect(readReport(dir, sample.repo)).rejects.toBeInstanceOf(ReportNotFoundError);
  });

  it("rejects a malformed report file", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pr-lens-"));
    const { mkdir, writeFile } = await import("node:fs/promises");
    await mkdir(join(dir, ".pr-lens", "reports"), { recursive: true });
    await writeFile(join(dir, ".pr-lens", "reports", `${repoKey(sample.repo)}.json`), JSON.stringify({ nope: true }));
    await expect(readReport(dir, sample.repo)).rejects.toThrow(/report/i);
  });
});

describe("legacy report.json fallback", () => {
  async function writeLegacy(dir: string, report: Report): Promise<void> {
    const { mkdir, writeFile } = await import("node:fs/promises");
    await mkdir(join(dir, ".pr-lens"), { recursive: true });
    await writeFile(join(dir, ".pr-lens", "report.json"), JSON.stringify(report));
  }

  it("reads a legacy report.json for its own repo", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pr-lens-"));
    await writeLegacy(dir, sample);
    await expect(readReport(dir, sample.repo)).resolves.toEqual(sample);
  });

  it("does not serve a legacy report for a different repo", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pr-lens-"));
    await writeLegacy(dir, sample);
    await expect(readReport(dir, "acme/widgets")).rejects.toBeInstanceOf(ReportNotFoundError);
  });
});

describe("repoKey", () => {
  it("maps owner/name to a flat filename key", () => {
    expect(repoKey("UiPath/flow-workbench")).toBe("UiPath__flow-workbench");
  });

  it.each(["no-slash", "a/b/c", "../escape", "a/..", "owner/na me"])("rejects %s", (repo) => {
    expect(() => repoKey(repo)).toThrow(/invalid repo/i);
  });
});

describe("listReports", () => {
  it("returns an empty list when nothing was scanned", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pr-lens-"));
    await expect(listReports(dir)).resolves.toEqual([]);
  });

  it("lists stored reports newest first and includes a legacy report", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pr-lens-"));
    const newer: Report = { ...sample, repo: "acme/widgets", generatedAt: "2026-08-22T00:00:00.000Z", prs: [] };
    await writeReport(dir, sample);
    await writeReport(dir, newer);
    const legacy: Report = { ...sample, repo: "acme/legacy", generatedAt: "2026-08-20T00:00:00.000Z", prs: [] };
    const { mkdir, writeFile } = await import("node:fs/promises");
    await mkdir(join(dir, ".pr-lens"), { recursive: true });
    await writeFile(join(dir, ".pr-lens", "report.json"), JSON.stringify(legacy));

    await expect(listReports(dir)).resolves.toEqual([
      { repo: "acme/widgets", generatedAt: "2026-08-22T00:00:00.000Z" },
      { repo: sample.repo, generatedAt: sample.generatedAt },
      { repo: "acme/legacy", generatedAt: "2026-08-20T00:00:00.000Z" },
    ]);
  });

  it("prefers the keyed report over a stale legacy copy of the same repo", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pr-lens-"));
    await writeReport(dir, sample);
    const stale: Report = { ...sample, generatedAt: "2020-01-01T00:00:00.000Z" };
    const { mkdir, writeFile } = await import("node:fs/promises");
    await mkdir(join(dir, ".pr-lens"), { recursive: true });
    await writeFile(join(dir, ".pr-lens", "report.json"), JSON.stringify(stale));

    await expect(listReports(dir)).resolves.toEqual([{ repo: sample.repo, generatedAt: sample.generatedAt }]);
  });
});
