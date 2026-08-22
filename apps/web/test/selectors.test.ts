import type { Report, ReportPr } from "@pr-lens/core";
import { describe, expect, it } from "vitest";
import { agoLabel, normalizeView, scoreOf, selectView, sizeBucket, topReasons } from "../src/lib/selectors.js";

function makePr(overrides: Partial<ReportPr> & { number: number }): ReportPr {
  return {
    title: `PR ${String(overrides.number)}`,
    author: "octocat",
    url: `https://github.com/o/r/pull/${String(overrides.number)}`,
    updatedAt: "2026-08-21T12:00:00.000Z",
    isDraft: false,
    mergeable: "MERGEABLE",
    additions: 10,
    deletions: 5,
    changedFiles: 2,
    ci: "SUCCESS",
    reviewState: "NONE",
    labels: [],
    componentPrimary: "core",
    componentsSecondary: [],
    componentShares: { core: 1 },
    scores: { reviewability: { score: 50, breakdown: [] } },
    ...overrides,
  };
}

function makeReport(prs: ReportPr[]): Report {
  return {
    repo: "o/r",
    generatedAt: "2026-08-21T12:00:00.000Z",
    components: [],
    prs,
  };
}

describe("selectView: component filter", () => {
  const prA = makePr({ number: 1, componentPrimary: "auth", componentsSecondary: ["core"] });
  const prB = makePr({ number: 2, componentPrimary: "ui", componentsSecondary: ["ui2"] });
  const prC = makePr({ number: 3, componentPrimary: "core", componentsSecondary: [] });
  const report = makeReport([prA, prB, prC]);

  it("matches by primary or secondary component, excludes non-matches", () => {
    const result = selectView(report, { component: "core", query: "", sort: "reviewability" });
    expect(result.map((p) => p.number).sort()).toEqual([1, 3]);
  });

  it("returns everything when component is null", () => {
    const result = selectView(report, { component: null, query: "", sort: "reviewability" });
    expect(result.map((p) => p.number).sort()).toEqual([1, 2, 3]);
  });
});

describe("selectView: query filter", () => {
  const prA = makePr({ number: 1, title: "Fix login bug" });
  const prB = makePr({ number: 2, title: "Refactor rendering pipeline" });
  const prC = makePr({ number: 3, title: "Add core cache layer" });
  const report = makeReport([prA, prB, prC]);

  it("matches title case-insensitively", () => {
    const result = selectView(report, { component: null, query: "CORE cache", sort: "reviewability" });
    expect(result.map((p) => p.number)).toEqual([3]);
  });
});

describe("selectView: sort orders", () => {
  // Values are deliberately chosen so each of the four sorts below produces a
  // DISTINCT permutation of [1, 2, 3] — a mis-wired sort (e.g. affinity
  // accidentally sorting by newest) would be caught by a mismatched order.
  //   reviewability (score desc):        1, 3, 2
  //   newest (updatedAt desc):           3, 1, 2
  //   smallest (additions+deletions asc):2, 1, 3
  //   affinity (componentShares desc):   2, 3, 1
  const prA = makePr({
    number: 1,
    updatedAt: "2026-08-21T12:00:00.000Z",
    additions: 30,
    deletions: 20,
    componentShares: { core: 0.1 },
    scores: { reviewability: { score: 90, breakdown: [] } },
  });
  const prB = makePr({
    number: 2,
    updatedAt: "2026-08-21T08:00:00.000Z",
    additions: 5,
    deletions: 5,
    componentShares: { core: 0.9 },
    scores: { reviewability: { score: 30, breakdown: [] } },
  });
  const prC = makePr({
    number: 3,
    updatedAt: "2026-08-21T16:00:00.000Z",
    additions: 100,
    deletions: 100,
    componentShares: { core: 0.5 },
    scores: { reviewability: { score: 60, breakdown: [] } },
  });
  const report = makeReport([prA, prB, prC]);

  it("reviewability: score desc", () => {
    const result = selectView(report, { component: null, query: "", sort: "reviewability" });
    expect(result.map((p) => p.number)).toEqual([1, 3, 2]);
  });

  it("affinity: componentShares[component] desc", () => {
    const result = selectView(report, { component: "core", query: "", sort: "affinity" });
    expect(result.map((p) => p.number)).toEqual([2, 3, 1]);
  });

  it("affinity falls back to reviewability order when component is null", () => {
    const result = selectView(report, { component: null, query: "", sort: "affinity" });
    expect(result.map((p) => p.number)).toEqual([1, 3, 2]);
  });

  it("newest: updatedAt desc", () => {
    const result = selectView(report, { component: null, query: "", sort: "newest" });
    expect(result.map((p) => p.number)).toEqual([3, 1, 2]);
  });

  it("smallest: additions+deletions asc", () => {
    const result = selectView(report, { component: null, query: "", sort: "smallest" });
    expect(result.map((p) => p.number)).toEqual([2, 1, 3]);
  });
});

describe("scoreOf", () => {
  it("returns the reviewability score", () => {
    expect(scoreOf(makePr({ number: 1, scores: { reviewability: { score: 77, breakdown: [] } } }))).toBe(77);
  });

  it("returns 0 when reviewability score is missing", () => {
    expect(scoreOf(makePr({ number: 1, scores: {} }))).toBe(0);
  });
});

describe("sizeBucket", () => {
  it.each([
    [49, "S"],
    [50, "M"],
    [299, "M"],
    [300, "L"],
    [999, "L"],
    [1000, "XL"],
  ] as const)("total lines %d -> %s", (total, expected) => {
    const pr = makePr({ number: 1, additions: total, deletions: 0 });
    expect(sizeBucket(pr)).toBe(expected);
  });
});

describe("topReasons", () => {
  it("sorts by weight*value desc and excludes weight-0 entries", () => {
    const pr = makePr({
      number: 1,
      scores: {
        reviewability: {
          score: 50,
          breakdown: [
            { factor: "diffSize", weight: 0.25, value: 0.5, reason: "small diff" },
            { factor: "ciStatus", weight: 0.2, value: 1, reason: "CI green" },
            { factor: "codeComplexity", weight: 0, value: 0, reason: "not implemented" },
            { factor: "reviewState", weight: 0.15, value: 1, reason: "1 approval" },
          ],
        },
      },
    });
    expect(topReasons(pr, 3)).toEqual(["CI green", "1 approval", "small diff"]);
    expect(topReasons(pr, 3)).not.toContain("not implemented");
  });
});

describe("normalizeView", () => {
  it("resets affinity sort to reviewability when component is null", () => {
    const result = normalizeView({ component: null, query: "", sort: "affinity" });
    expect(result).toEqual({ component: null, query: "", sort: "reviewability" });
  });

  it("leaves affinity sort untouched when a component is selected", () => {
    const opts = { component: "core", query: "", sort: "affinity" } as const;
    expect(normalizeView(opts)).toEqual(opts);
  });

  it("leaves non-affinity sorts untouched regardless of component", () => {
    const opts = { component: null, query: "x", sort: "newest" } as const;
    expect(normalizeView(opts)).toEqual(opts);
  });
});

describe("agoLabel", () => {
  const now = new Date("2026-08-21T12:00:00.000Z").getTime();

  it("formats minutes", () => {
    expect(agoLabel("2026-08-21T11:57:00.000Z", now)).toBe("3m ago");
  });

  it("formats hours", () => {
    expect(agoLabel("2026-08-21T10:00:00.000Z", now)).toBe("2h ago");
  });

  it("formats days", () => {
    expect(agoLabel("2026-08-16T12:00:00.000Z", now)).toBe("5d ago");
  });
});
