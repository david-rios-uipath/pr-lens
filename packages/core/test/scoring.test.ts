import { describe, expect, it } from "vitest";
import type { PrData } from "../src/types";
import { affinityScore, evaluateDimension, REVIEWABILITY_FACTORS, scorePr } from "../src/scoring";

const factors = REVIEWABILITY_FACTORS;

function pr(overrides: Partial<PrData>): PrData {
  return {
    number: 1, title: "t", author: "a", url: "u",
    createdAt: "2026-08-20T12:00:00Z", updatedAt: "2026-08-21T10:00:00Z",
    isDraft: false, mergeable: "MERGEABLE",
    additions: 10, deletions: 5, changedFiles: 2, approvals: 0,
    ci: "SUCCESS", reviewState: "NONE", labels: [],
    files: [{ path: "src/a.ts", additions: 10, deletions: 5 }],
    ...overrides,
  };
}

describe("evaluateDimension", () => {
  it("scores a tiny PR high and a huge conflicting PR low", () => {
    const easy = evaluateDimension(factors, pr({}));
    const hard = evaluateDimension(factors, pr({
      additions: 3000, deletions: 500, changedFiles: 80, mergeable: "CONFLICTING",
    }));
    expect(easy.score).toBeGreaterThan(60);
    expect(hard.score).toBeLessThan(15);
  });

  it("includes every factor in the breakdown, including codeComplexity", () => {
    const { breakdown } = evaluateDimension(factors, pr({}));
    expect(breakdown.map((b) => b.factor)).toEqual([
      "diffSize", "filesTouched", "changeNature", "mergeability", "codeComplexity",
    ]);
    const cc = breakdown.find((b) => b.factor === "codeComplexity");
    expect(cc).toMatchObject({ weight: 0, value: 0 });
  });

  it("boosts docs-only PRs via changeNature", () => {
    const docs = evaluateDimension(factors, pr({ files: [{ path: "docs/x.md", additions: 3, deletions: 0 }] }));
    const mixed = evaluateDimension(factors, pr({}));
    expect(docs.score).toBeGreaterThan(mixed.score);
  });

  it("ignores review state, approvals, CI, and age", () => {
    const base = evaluateDimension(factors, pr({}));
    const cr = evaluateDimension(factors, pr({ reviewState: "CHANGES_REQUESTED" }));
    const ok = evaluateDimension(factors, pr({ approvals: 1, reviewState: "APPROVED" }));
    const redCi = evaluateDimension(factors, pr({ ci: "FAILURE" }));
    const stale = evaluateDimension(factors, pr({ updatedAt: "2025-01-01T00:00:00Z" }));
    expect(cr.score).toBe(base.score);
    expect(ok.score).toBe(base.score);
    expect(redCi.score).toBe(base.score);
    expect(stale.score).toBe(base.score);
  });
});

describe("scorePr", () => {
  it("returns a reviewability dimension and honors weight overrides", () => {
    const base = scorePr(pr({ additions: 3000, deletions: 500 }));
    const noSize = scorePr(pr({ additions: 3000, deletions: 500 }), { diffSize: 0 });
    expect(base.reviewability).toBeDefined();
    expect(noSize.reviewability?.score ?? 0).toBeGreaterThan(base.reviewability?.score ?? 101);
  });
});

describe("affinityScore", () => {
  it("maps shares to 0-100 and missing components to 0", () => {
    expect(affinityScore({ ui: 0.8 }, "ui")).toBe(80);
    expect(affinityScore({ ui: 0.8 }, "api")).toBe(0);
  });
});
