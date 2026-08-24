import type { Report, ReportPr } from "@pr-lens/core";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_VIEW,
  affinityOf,
  agoLabel,
  authorCounts,
  componentCounts,
  normalizeView,
  reviewLabel,
  scoreOf,
  selectView,
  sizeBucket,
  topReasons,
  unreviewedCount,
} from "../src/lib/selectors";
import type { ViewOptions } from "../src/lib/selectors";

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
    const result = selectView(report, { components: ["core"], authors: [], query: "", sort: "reviewability", sortDir: "desc", hideApproved: false, hideDrafts: false });
    expect(result.map((p) => p.number).sort()).toEqual([1, 3]);
  });

  it("returns everything when no components are selected", () => {
    const result = selectView(report, { components: [], authors: [], query: "", sort: "reviewability", sortDir: "desc", hideApproved: false, hideDrafts: false });
    expect(result.map((p) => p.number).sort()).toEqual([1, 2, 3]);
  });

  it("ORs multiple selected components", () => {
    const result = selectView(report, {
      components: ["auth", "ui"],
      authors: [],
      query: "",
      sort: "reviewability",
      sortDir: "desc", hideApproved: false, hideDrafts: false,
    });
    expect(result.map((p) => p.number).sort()).toEqual([1, 2]);
  });
});

describe("selectView: author filter", () => {
  const prA = makePr({ number: 1, author: "octocat" });
  const prB = makePr({ number: 2, author: "hubot" });
  const prC = makePr({ number: 3, author: "monalisa" });
  const report = makeReport([prA, prB, prC]);
  const base = { components: [], authors: [], query: "", sort: "reviewability" as const, sortDir: "desc" as const, hideApproved: false, hideDrafts: false };

  it("keeps only PRs by the selected author", () => {
    const result = selectView(report, { ...base, authors: ["hubot"] });
    expect(result.map((p) => p.number)).toEqual([2]);
  });

  it("ORs multiple selected authors", () => {
    const result = selectView(report, { ...base, authors: ["octocat", "monalisa"] });
    expect(result.map((p) => p.number).sort()).toEqual([1, 3]);
  });

  it("returns everything when no authors are selected", () => {
    const result = selectView(report, { ...base, authors: [] });
    expect(result.map((p) => p.number).sort()).toEqual([1, 2, 3]);
  });

  it("returns nothing for an author with no PRs", () => {
    expect(selectView(report, { ...base, authors: ["ghost"] })).toEqual([]);
  });

  it("matches logins case-sensitively, as GitHub logins are exact", () => {
    expect(selectView(report, { ...base, authors: ["Hubot"] })).toEqual([]);
  });

  it("ANDs with the component filter rather than widening it", () => {
    const mixed = makeReport([
      makePr({ number: 1, author: "octocat", componentPrimary: "auth" }),
      makePr({ number: 2, author: "hubot", componentPrimary: "auth" }),
      makePr({ number: 3, author: "octocat", componentPrimary: "ui" }),
    ]);
    const result = selectView(mixed, { ...base, components: ["auth"], authors: ["octocat"] });
    expect(result.map((p) => p.number)).toEqual([1]);
  });

  it("selects no authors by default", () => {
    expect(DEFAULT_VIEW.authors).toEqual([]);
  });
});

describe("selectView: query filter", () => {
  const prA = makePr({ number: 1, title: "Fix login bug" });
  const prB = makePr({ number: 2, title: "Refactor rendering pipeline" });
  const prC = makePr({ number: 3, title: "Add core cache layer" });
  const report = makeReport([prA, prB, prC]);

  it("matches title case-insensitively", () => {
    const result = selectView(report, { components: [], authors: [], query: "CORE cache", sort: "reviewability", sortDir: "desc", hideApproved: false, hideDrafts: false });
    expect(result.map((p) => p.number)).toEqual([3]);
  });
});

describe("selectView: hideApproved filter", () => {
  const approved = makePr({ number: 1, reviewState: "APPROVED" });
  const pending = makePr({ number: 2, reviewState: "REVIEW_REQUIRED" });
  const changes = makePr({ number: 3, reviewState: "CHANGES_REQUESTED" });
  const report = makeReport([approved, pending, changes]);

  it("drops approved PRs when hideApproved is set", () => {
    const result = selectView(report, { ...DEFAULT_VIEW, hideApproved: true });
    expect(result.map((p) => p.number).sort()).toEqual([2, 3]);
  });

  it("keeps approved PRs when hideApproved is cleared", () => {
    const result = selectView(report, { ...DEFAULT_VIEW, hideApproved: false, hideDrafts: false });
    expect(result.map((p) => p.number).sort()).toEqual([1, 2, 3]);
  });

  it("hides approved by default", () => {
    expect(DEFAULT_VIEW.hideApproved).toBe(true);
    expect(selectView(report, DEFAULT_VIEW).map((p) => p.number).sort()).toEqual([2, 3]);
  });
});

describe("selectView: hideDrafts filter", () => {
  const draft = makePr({ number: 1, isDraft: true });
  const ready = makePr({ number: 2, isDraft: false });
  const report = makeReport([draft, ready]);

  it("drops drafts when hideDrafts is set", () => {
    const result = selectView(report, { ...DEFAULT_VIEW, hideDrafts: true });
    expect(result.map((p) => p.number)).toEqual([2]);
  });

  it("keeps drafts when hideDrafts is cleared", () => {
    const result = selectView(report, { ...DEFAULT_VIEW, hideDrafts: false });
    expect(result.map((p) => p.number).sort()).toEqual([1, 2]);
  });

  it("hides drafts by default", () => {
    expect(DEFAULT_VIEW.hideDrafts).toBe(true);
    expect(selectView(report, DEFAULT_VIEW).map((p) => p.number)).toEqual([2]);
  });

  it("drops an approved draft under either toggle alone", () => {
    const approvedDraft = makeReport([makePr({ number: 1, isDraft: true, reviewState: "APPROVED" })]);
    expect(selectView(approvedDraft, { ...DEFAULT_VIEW, hideApproved: false, hideDrafts: true })).toEqual([]);
    expect(selectView(approvedDraft, { ...DEFAULT_VIEW, hideApproved: true, hideDrafts: false })).toEqual([]);
  });

  it("applies hideDrafts to component counts", () => {
    const withDraft: Report = {
      ...makeReport([makePr({ number: 1, isDraft: true, componentPrimary: "auth" })]),
      components: [{ name: "auth", prCount: 1 }],
    };
    expect(componentCounts(withDraft, DEFAULT_VIEW)).toEqual([{ name: "auth", prCount: 0 }]);
    expect(componentCounts(withDraft, { ...DEFAULT_VIEW, hideDrafts: false })).toEqual([
      { name: "auth", prCount: 1 },
    ]);
  });

  it("applies hideDrafts to author counts", () => {
    const withDraft = makeReport([makePr({ number: 1, isDraft: true, author: "hubot" })]);
    expect(authorCounts(withDraft, DEFAULT_VIEW)).toEqual([{ login: "hubot", prCount: 0 }]);
    expect(authorCounts(withDraft, { ...DEFAULT_VIEW, hideDrafts: false })).toEqual([
      { login: "hubot", prCount: 1 },
    ]);
  });
});

describe("selectView: sort orders", () => {
  // Values are deliberately chosen so each of the four sorts below produces a
  // DISTINCT permutation of [1, 2, 3] — a mis-wired sort (e.g. affinity
  // accidentally sorting by newest) would be caught by a mismatched order.
  //   reviewability (score desc):        1, 3, 2
  //   updated (updatedAt desc):          3, 1, 2
  //   size (additions+deletions asc):    2, 1, 3
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
    const result = selectView(report, { components: [], authors: [], query: "", sort: "reviewability", sortDir: "desc", hideApproved: false, hideDrafts: false });
    expect(result.map((p) => p.number)).toEqual([1, 3, 2]);
  });

  it("affinity: componentShares[component] desc", () => {
    const result = selectView(report, { components: ["core"], authors: [], query: "", sort: "affinity", sortDir: "desc", hideApproved: false, hideDrafts: false });
    expect(result.map((p) => p.number)).toEqual([2, 3, 1]);
  });

  it("affinity with multiple components sorts by max share among them", () => {
    const withAuth = makeReport([{ ...prA, componentShares: { core: 0.1, auth: 0.8 } }, prB, prC]);
    const result = selectView(withAuth, { components: ["core", "auth"], authors: [], query: "", sort: "affinity", sortDir: "desc", hideApproved: false, hideDrafts: false });
    expect(result.map((p) => p.number)).toEqual([2, 1, 3]);
  });

  it("affinity falls back to reviewability order when no components are selected", () => {
    const result = selectView(report, { components: [], authors: [], query: "", sort: "affinity", sortDir: "desc", hideApproved: false, hideDrafts: false });
    expect(result.map((p) => p.number)).toEqual([1, 3, 2]);
  });

  it("updated: updatedAt desc", () => {
    const result = selectView(report, { components: [], authors: [], query: "", sort: "updated", sortDir: "desc", hideApproved: false, hideDrafts: false });
    expect(result.map((p) => p.number)).toEqual([3, 1, 2]);
  });

  it("size: additions+deletions asc", () => {
    const result = selectView(report, { components: [], authors: [], query: "", sort: "size", sortDir: "asc", hideApproved: false, hideDrafts: false });
    expect(result.map((p) => p.number)).toEqual([2, 1, 3]);
  });

  it("sortDir asc reverses every key", () => {
    const base = { components: ["core"], authors: [], query: "", hideApproved: false, hideDrafts: false };
    for (const sort of ["reviewability", "affinity", "updated", "size"] as const) {
      const desc = selectView(report, { ...base, sort, sortDir: "desc" }).map((p) => p.number);
      const asc = selectView(report, { ...base, sort, sortDir: "asc" }).map((p) => p.number);
      expect(asc).toEqual([...desc].reverse());
    }
  });
});

describe("componentCounts", () => {
  const prs = [
    makePr({ number: 1, title: "Fix login bug", componentPrimary: "auth", componentsSecondary: ["core"] }),
    makePr({ number: 2, title: "Refactor rendering", componentPrimary: "ui", reviewState: "APPROVED" }),
    makePr({ number: 3, title: "Add core cache", componentPrimary: "core" }),
  ];
  const report: Report = {
    ...makeReport(prs),
    components: [
      { name: "auth", prCount: 1 },
      { name: "core", prCount: 2 },
      { name: "ui", prCount: 1 },
    ],
  };

  it("counts primary and secondary matches, sorted by count desc then name", () => {
    expect(componentCounts(report, { ...DEFAULT_VIEW, hideApproved: false, hideDrafts: false })).toEqual([
      { name: "core", prCount: 2 },
      { name: "auth", prCount: 1 },
      { name: "ui", prCount: 1 },
    ]);
  });

  it("applies the query filter to counts", () => {
    expect(componentCounts(report, { ...DEFAULT_VIEW, query: "login", hideApproved: false, hideDrafts: false })).toEqual([
      { name: "auth", prCount: 1 },
      { name: "core", prCount: 1 },
      { name: "ui", prCount: 0 },
    ]);
  });

  it("applies hideApproved to counts", () => {
    const counts = componentCounts(report, { ...DEFAULT_VIEW, hideApproved: true });
    expect(counts).toContainEqual({ name: "ui", prCount: 0 });
  });

  it("applies the author selection to counts", () => {
    const byAuthor: Report = {
      ...makeReport([
        makePr({ number: 1, author: "octocat", componentPrimary: "auth" }),
        makePr({ number: 2, author: "hubot", componentPrimary: "core" }),
      ]),
      components: [
        { name: "auth", prCount: 1 },
        { name: "core", prCount: 1 },
      ],
    };
    expect(componentCounts(byAuthor, { ...DEFAULT_VIEW, authors: ["octocat"], hideApproved: false, hideDrafts: false })).toEqual([
      { name: "auth", prCount: 1 },
      { name: "core", prCount: 0 },
    ]);
  });

  it("ignores the component selection so other counts stay visible", () => {
    const counts = componentCounts(report, { ...DEFAULT_VIEW, components: ["auth"], hideApproved: false, hideDrafts: false });
    expect(counts).toContainEqual({ name: "core", prCount: 2 });
    expect(counts).toContainEqual({ name: "ui", prCount: 1 });
  });
});

describe("authorCounts", () => {
  const report = makeReport([
    makePr({ number: 1, author: "octocat", title: "Fix login bug", componentPrimary: "auth" }),
    makePr({ number: 2, author: "octocat", title: "Refactor rendering", componentPrimary: "ui" }),
    makePr({ number: 3, author: "hubot", title: "Add core cache", componentPrimary: "core" }),
    makePr({ number: 4, author: "monalisa", title: "Tidy login form", componentPrimary: "auth", reviewState: "APPROVED" }),
  ]);

  it("lists each distinct author once, sorted by count desc then login", () => {
    expect(authorCounts(report, { ...DEFAULT_VIEW, hideApproved: false, hideDrafts: false })).toEqual([
      { login: "octocat", prCount: 2 },
      { login: "hubot", prCount: 1 },
      { login: "monalisa", prCount: 1 },
    ]);
  });

  it("applies the query filter to counts", () => {
    expect(authorCounts(report, { ...DEFAULT_VIEW, query: "login", hideApproved: false, hideDrafts: false })).toEqual([
      { login: "monalisa", prCount: 1 },
      { login: "octocat", prCount: 1 },
      { login: "hubot", prCount: 0 },
    ]);
  });

  it("applies hideApproved to counts", () => {
    expect(authorCounts(report, { ...DEFAULT_VIEW, hideApproved: true })).toContainEqual({
      login: "monalisa",
      prCount: 0,
    });
  });

  it("applies the component selection to counts", () => {
    expect(authorCounts(report, { ...DEFAULT_VIEW, components: ["auth"], hideApproved: false, hideDrafts: false })).toEqual([
      { login: "monalisa", prCount: 1 },
      { login: "octocat", prCount: 1 },
      { login: "hubot", prCount: 0 },
    ]);
  });

  it("ignores its own author selection so other authors stay pickable", () => {
    const counts = authorCounts(report, { ...DEFAULT_VIEW, authors: ["hubot"], hideApproved: false, hideDrafts: false });
    expect(counts).toContainEqual({ login: "octocat", prCount: 2 });
    expect(counts).toContainEqual({ login: "monalisa", prCount: 1 });
  });

  it("keeps zero-count authors in the list so options never vanish mid-interaction", () => {
    const counts = authorCounts(report, { ...DEFAULT_VIEW, query: "nothing matches", hideApproved: false, hideDrafts: false });
    expect(counts.map((a) => a.login).sort()).toEqual(["hubot", "monalisa", "octocat"]);
    expect(counts.every((a) => a.prCount === 0)).toBe(true);
  });
});

describe("unreviewedCount", () => {
  it("counts PRs awaiting a first review", () => {
    const report = makeReport([
      makePr({ number: 1, reviewState: "REVIEW_REQUIRED" }),
      makePr({ number: 2, reviewState: "NONE" }),
    ]);
    expect(unreviewedCount(report)).toBe(2);
  });

  it("excludes PRs that have already been reviewed", () => {
    const report = makeReport([
      makePr({ number: 1, reviewState: "APPROVED" }),
      makePr({ number: 2, reviewState: "CHANGES_REQUESTED" }),
      makePr({ number: 3, reviewState: "REVIEW_REQUIRED" }),
    ]);
    expect(unreviewedCount(report)).toBe(1);
  });

  it("excludes drafts, which aren't asking for review yet", () => {
    const report = makeReport([
      makePr({ number: 1, reviewState: "REVIEW_REQUIRED", isDraft: true }),
      makePr({ number: 2, reviewState: "NONE", isDraft: false }),
    ]);
    expect(unreviewedCount(report)).toBe(1);
  });

  it("returns 0 when nothing is awaiting review", () => {
    expect(unreviewedCount(makeReport([makePr({ number: 1, reviewState: "APPROVED" })]))).toBe(0);
    expect(unreviewedCount(makeReport([]))).toBe(0);
  });
});

describe("affinityOf", () => {
  const pr = makePr({ number: 1, componentShares: { core: 0.3, auth: 0.7 } });

  it("returns the max share among the selected components", () => {
    expect(affinityOf(pr, ["core", "auth"])).toBe(0.7);
    expect(affinityOf(pr, ["core"])).toBe(0.3);
  });

  it("returns 0 for unknown components or an empty selection", () => {
    expect(affinityOf(pr, ["missing"])).toBe(0);
    expect(affinityOf(pr, [])).toBe(0);
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
  it("resets affinity sort to reviewability when no components are selected", () => {
    const result = normalizeView({ components: [], authors: [], query: "", sort: "affinity", sortDir: "desc", hideApproved: false, hideDrafts: false });
    expect(result).toEqual({ components: [], authors: [], query: "", sort: "reviewability", sortDir: "desc", hideApproved: false, hideDrafts: false });
  });

  it("leaves affinity sort untouched when components are selected", () => {
    const opts: ViewOptions = { components: ["core"], authors: [], query: "", sort: "affinity", sortDir: "desc", hideApproved: false, hideDrafts: false };
    expect(normalizeView(opts)).toEqual(opts);
  });

  it("leaves non-affinity sorts untouched regardless of selection", () => {
    const opts: ViewOptions = { components: [], authors: [], query: "x", sort: "updated", sortDir: "desc", hideApproved: false, hideDrafts: false };
    expect(normalizeView(opts)).toEqual(opts);
  });
});

describe("reviewLabel", () => {
  it("shows Draft when isDraft, regardless of reviewState", () => {
    const pr = makePr({ number: 1, isDraft: true, reviewState: "APPROVED" });
    expect(reviewLabel(pr)).toEqual({ text: "Draft", variant: "danger" });
  });

  it("shows Approved in success variant", () => {
    const pr = makePr({ number: 1, isDraft: false, reviewState: "APPROVED" });
    expect(reviewLabel(pr)).toEqual({ text: "Approved", variant: "success" });
  });

  it("shows Changes requested in danger variant", () => {
    const pr = makePr({ number: 1, isDraft: false, reviewState: "CHANGES_REQUESTED" });
    expect(reviewLabel(pr)).toEqual({ text: "Changes requested", variant: "danger" });
  });

  it.each(["REVIEW_REQUIRED", "NONE"] as const)("returns null for %s to avoid noise", (reviewState) => {
    const pr = makePr({ number: 1, isDraft: false, reviewState });
    expect(reviewLabel(pr)).toBeNull();
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
