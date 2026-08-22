import { describe, expect, it } from "vitest";
import type { PrData } from "../src/types.js";
import { affinityScore, evaluateDimension, makeReviewabilityFactors, scorePr } from "../src/scoring.js";

const NOW = new Date("2026-08-21T12:00:00Z").getTime();
const factors = makeReviewabilityFactors(() => NOW);

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
  it("scores a tiny green PR high and a huge red draft low", () => {
    const easy = evaluateDimension(factors, pr({}));
    const hard = evaluateDimension(factors, pr({
      additions: 3000, deletions: 500, changedFiles: 80, isDraft: true,
      ci: "FAILURE", mergeable: "CONFLICTING", updatedAt: "2026-08-01T00:00:00Z",
    }));
    expect(easy.score).toBeGreaterThan(75);
    expect(hard.score).toBeLessThan(15);
  });

  it("includes every factor in the breakdown, including codeComplexity", () => {
    const { breakdown } = evaluateDimension(factors, pr({}));
    expect(breakdown.map((b) => b.factor)).toEqual([
      "diffSize", "filesTouched", "ciStatus", "reviewState",
      "age", "changeNature", "mergeability", "codeComplexity",
    ]);
    const cc = breakdown.find((b) => b.factor === "codeComplexity");
    expect(cc).toMatchObject({ weight: 0, value: 0 });
  });

  it("boosts docs-only PRs via changeNature", () => {
    const docs = evaluateDimension(factors, pr({ files: [{ path: "docs/x.md", additions: 3, deletions: 0 }] }));
    const mixed = evaluateDimension(factors, pr({}));
    expect(docs.score).toBeGreaterThan(mixed.score);
  });

  it("penalizes changes-requested and rewards approvals", () => {
    const cr = evaluateDimension(factors, pr({ reviewState: "CHANGES_REQUESTED" }));
    const ok = evaluateDimension(factors, pr({ approvals: 1, reviewState: "APPROVED" }));
    expect(ok.score).toBeGreaterThan(cr.score);
  });
});

describe("scorePr", () => {
  it("returns a reviewability dimension and honors weight overrides", () => {
    const base = scorePr(pr({ ci: "FAILURE" }));
    const noCi = scorePr(pr({ ci: "FAILURE" }), { ciStatus: 0 });
    expect(base.reviewability).toBeDefined();
    expect(noCi.reviewability?.score ?? 0).toBeGreaterThan(base.reviewability?.score ?? 101);
  });
});

describe("affinityScore", () => {
  it("maps shares to 0-100 and missing components to 0", () => {
    expect(affinityScore({ ui: 0.8 }, "ui")).toBe(80);
    expect(affinityScore({ ui: 0.8 }, "api")).toBe(0);
  });
});
