import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { reportSchema } from "../src/report";
import { buildReport, runScan } from "../src/scan";
import type { PrData } from "../src/types";
import { fixturePages, twoPhaseFetch } from "./githubStub";

const NOW = new Date("2026-08-21T00:00:00.000Z").getTime();

const docsPr: PrData = {
  number: 1,
  title: "Fix typo in docs",
  author: "alice",
  url: "https://github.com/o/r/pull/1",
  createdAt: "2026-08-20T10:00:00Z",
  updatedAt: "2026-08-20T12:00:00Z",
  isDraft: false,
  mergeable: "MERGEABLE",
  additions: 2,
  deletions: 1,
  changedFiles: 1,
  approvals: 1,
  ci: "SUCCESS",
  reviewState: "APPROVED",
  labels: ["docs"],
  files: [{ path: "README.md", additions: 2, deletions: 1 }],
};

const giantPr: PrData = {
  number: 2,
  title: "Huge failing draft refactor",
  author: "bob",
  url: "https://github.com/o/r/pull/2",
  createdAt: "2026-08-10T10:00:00Z",
  updatedAt: "2026-08-10T12:00:00Z",
  isDraft: true,
  mergeable: "CONFLICTING",
  additions: 3000,
  deletions: 1500,
  changedFiles: 80,
  approvals: 0,
  ci: "FAILURE",
  reviewState: "NONE",
  labels: [],
  files: [
    { path: "src/engine.ts", additions: 2500, deletions: 1200 },
    { path: "src/utils.ts", additions: 500, deletions: 300 },
  ],
};

describe("buildReport", () => {
  it("sorts PRs by reviewability score descending", () => {
    const report = buildReport("o/r", [docsPr, giantPr], () => NOW);
    expect(report.prs.map((p) => p.number)).toEqual([docsPr.number, giantPr.number]);
  });

  it("produces a report that validates against reportSchema", () => {
    const report = buildReport("o/r", [docsPr, giantPr], () => NOW);
    expect(reportSchema.parse(report)).toBeTruthy();
  });

  it("populates componentPrimary for each PR", () => {
    const report = buildReport("o/r", [docsPr, giantPr], () => NOW);
    for (const pr of report.prs) {
      expect(pr.componentPrimary.length).toBeGreaterThan(0);
    }
  });

  it("computes componentShares that sum to ~1 per PR", () => {
    const report = buildReport("o/r", [docsPr, giantPr], () => NOW);
    for (const pr of report.prs) {
      const total = Object.values(pr.componentShares).reduce((sum, v) => sum + v, 0);
      expect(total).toBeCloseTo(1, 5);
    }
  });

  it("sets generatedAt from the injected clock", () => {
    const report = buildReport("o/r", [docsPr, giantPr], () => NOW);
    expect(report.generatedAt).toBe(new Date(NOW).toISOString());
  });

  it("breaks ties by PR number ascending", () => {
    const twin: PrData = { ...docsPr, number: 3 };
    const report = buildReport("o/r", [twin, docsPr], () => NOW);
    // both have identical scores, so lower number comes first
    expect(report.prs.map((p) => p.number)).toEqual([docsPr.number, twin.number]);
  });

  it("applies weight overrides to reviewability scoring", () => {
    const defaultReport = buildReport("o/r", [giantPr], () => NOW);
    const overriddenReport = buildReport("o/r", [giantPr], () => NOW, { diffSize: 0 });
    expect(overriddenReport.prs[0]?.scores.reviewability.score).not.toBe(
      defaultReport.prs[0]?.scores.reviewability.score,
    );
  });
});

async function makeFetchStub() {
  return twoPhaseFetch(await fixturePages()).fetchImpl;
}

describe("runScan", () => {
  it("fetches, scores, and writes the report file", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pr-lens-"));
    const report = await runScan({
      repo: "UiPath/flow-workbench",
      dir,
      fetchImpl: await makeFetchStub(),
      env: { GITHUB_TOKEN: "tok" },
    });

    expect(report.prs).toHaveLength(3);
    const written = await readFile(join(dir, ".pr-lens", "reports", "UiPath__flow-workbench.json"), "utf8");
    const parsed: unknown = JSON.parse(written);
    expect(reportSchema.parse(parsed)).toEqual(report);
  });

  it("applies weight overrides from .pr-lens/config.json", async () => {
    const dirDefault = await mkdtemp(join(tmpdir(), "pr-lens-"));
    const reportDefault = await runScan({
      repo: "UiPath/flow-workbench",
      dir: dirDefault,
      fetchImpl: await makeFetchStub(),
      env: { GITHUB_TOKEN: "tok" },
    });

    const dirCustom = await mkdtemp(join(tmpdir(), "pr-lens-"));
    await mkdir(join(dirCustom, ".pr-lens"), { recursive: true });
    await writeFile(
      join(dirCustom, ".pr-lens", "config.json"),
      JSON.stringify({ weights: { filesTouched: 0, diffSize: 1 } }),
    );
    const reportCustom = await runScan({
      repo: "UiPath/flow-workbench",
      dir: dirCustom,
      fetchImpl: await makeFetchStub(),
      env: { GITHUB_TOKEN: "tok" },
    });

    const defaultScore = reportDefault.prs.find((p) => p.number === 101)?.scores.reviewability.score;
    const customScore = reportCustom.prs.find((p) => p.number === 101)?.scores.reviewability.score;
    expect(defaultScore).toBeDefined();
    expect(customScore).toBeDefined();
    expect(customScore).not.toBe(defaultScore);
  });
});
