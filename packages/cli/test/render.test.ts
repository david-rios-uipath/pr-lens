import type { Report, ReportPr } from "@pr-lens/core";
import { describe, expect, it } from "vitest";
import { renderComponents, renderTable, sanitize, selectPrs, staleMs, timeAgo } from "../src/render.js";

function makePr(overrides: Partial<ReportPr> & { number: number }): ReportPr {
  return {
    number: overrides.number,
    title: `PR ${String(overrides.number)}`,
    author: "octocat",
    url: `https://example.com/pr/${String(overrides.number)}`,
    updatedAt: "2026-08-21T00:00:00.000Z",
    isDraft: false,
    mergeable: "MERGEABLE",
    additions: 10,
    deletions: 2,
    changedFiles: 3,
    ci: "SUCCESS",
    reviewState: "REVIEW_REQUIRED",
    labels: [],
    componentPrimary: "core",
    componentsSecondary: [],
    componentShares: { core: 1 },
    scores: {
      reviewability: {
        score: 50,
        breakdown: [
          { factor: "diffSize", weight: 0.25, value: 0.9, reason: "12 lines changed" },
          { factor: "ciStatus", weight: 0.2, value: 1, reason: "CI green" },
          { factor: "reviewState", weight: 0, value: 0, reason: "n/a" },
        ],
      },
    },
    ...overrides,
  };
}

const pr1 = makePr({
  number: 1,
  title: "Add feature A to core",
  componentPrimary: "core",
  componentsSecondary: [],
  componentShares: { core: 0.9, cli: 0.1 },
  scores: {
    reviewability: {
      score: 50,
      breakdown: [
        { factor: "diffSize", weight: 0.25, value: 0.9, reason: "12 lines changed" },
        { factor: "ciStatus", weight: 0.2, value: 1, reason: "CI green" },
      ],
    },
  },
});

const pr2 = makePr({
  number: 2,
  title:
    "Fix bug in CLI parsing that is really quite long and definitely exceeds fifty characters",
  componentPrimary: "cli",
  componentsSecondary: ["core"],
  componentShares: { cli: 0.6, core: 0.4 },
  scores: {
    reviewability: {
      score: 90,
      breakdown: [
        { factor: "diffSize", weight: 0.25, value: 1, reason: "3 lines changed" },
        { factor: "ciStatus", weight: 0.2, value: 1, reason: "CI green" },
      ],
    },
  },
});

const pr3 = makePr({
  number: 3,
  title: "Refactor core internals",
  componentPrimary: "core",
  componentsSecondary: [],
  componentShares: { core: 0.3, docs: 0.7 },
  scores: {
    reviewability: {
      score: 70,
      breakdown: [
        { factor: "diffSize", weight: 0.25, value: 0.5, reason: "500 lines changed" },
        { factor: "ciStatus", weight: 0.2, value: 0, reason: "CI failing" },
      ],
    },
  },
});

const report: Report = {
  repo: "acme/widgets",
  generatedAt: "2026-08-21T00:00:00.000Z",
  components: [
    { name: "core", prCount: 3 },
    { name: "cli", prCount: 2 },
    { name: "docs", prCount: 1 },
  ],
  prs: [pr1, pr2, pr3],
};

describe("selectPrs", () => {
  it("filters by component, matching primary or secondary", () => {
    const selected = selectPrs(report, { component: "core", sort: "reviewability", limit: 20 });
    expect(selected.map((p) => p.number)).toEqual([2, 3, 1]);
  });

  it("sorts by reviewability score descending", () => {
    const selected = selectPrs(report, { sort: "reviewability", limit: 20 });
    expect(selected.map((p) => p.number)).toEqual([2, 3, 1]);
  });

  it("sorts by affinity descending, which differs from reviewability ordering", () => {
    const selected = selectPrs(report, { component: "core", sort: "affinity", limit: 20 });
    expect(selected.map((p) => p.number)).toEqual([1, 2, 3]);
  });

  it("throws when sorting by affinity without a component", () => {
    expect(() => selectPrs(report, { sort: "affinity", limit: 20 })).toThrow(
      "--sort affinity requires --component",
    );
  });

  it("respects the limit", () => {
    const selected = selectPrs(report, { sort: "reviewability", limit: 1 });
    expect(selected).toHaveLength(1);
    expect(selected[0]?.number).toBe(2);
  });
});

describe("staleMs", () => {
  it("parses seconds", () => {
    expect(staleMs("30s")).toBe(30_000);
  });

  it("parses minutes", () => {
    expect(staleMs("15m")).toBe(900_000);
  });

  it("parses hours", () => {
    expect(staleMs("2h")).toBe(7_200_000);
  });

  it("rejects garbage", () => {
    expect(() => staleMs("banana")).toThrow();
    expect(() => staleMs("15")).toThrow();
    expect(() => staleMs("-5m")).toThrow();
  });
});

describe("timeAgo", () => {
  const base = new Date("2026-08-21T00:10:00.000Z").getTime();

  it("says just now for under a minute", () => {
    expect(timeAgo("2026-08-21T00:09:30.000Z", base)).toBe("just now");
  });

  it("says N min ago for under an hour", () => {
    expect(timeAgo("2026-08-21T00:05:00.000Z", base)).toBe("5 min ago");
  });

  it("says N h ago for under a day", () => {
    expect(timeAgo("2026-08-20T22:10:00.000Z", base)).toBe("2 h ago");
  });

  it("says N d ago otherwise", () => {
    expect(timeAgo("2026-08-18T00:10:00.000Z", base)).toBe("3 d ago");
  });
});

describe("renderTable", () => {
  it("renders rank, top title, and a breakdown reason", () => {
    const selected = selectPrs(report, { sort: "reviewability", limit: 20 });
    const table = renderTable(selected, { sort: "reviewability", limit: 20 });
    expect(table).toContain("1");
    expect(table).toContain("CLI parsing");
    expect(table).toContain("CI green");
  });

  it("truncates titles longer than 50 characters", () => {
    const selected = [pr2];
    const table = renderTable(selected, { sort: "reviewability", limit: 20 });
    expect(table).not.toContain(pr2.title);
  });

  it("includes an affinity column when sorting by affinity", () => {
    const selected = selectPrs(report, { component: "core", sort: "affinity", limit: 20 });
    const table = renderTable(selected, { component: "core", sort: "affinity", limit: 20 });
    expect(table).toContain("aff");
  });
});

describe("renderComponents", () => {
  it("lists component names with PR counts", () => {
    const output = renderComponents(report);
    expect(output).toContain("core");
    expect(output).toContain("3");
    expect(output).toContain("cli");
    expect(output).toContain("2");
    expect(output).toContain("docs");
    expect(output).toContain("1");
  });
});

describe("sanitize", () => {
  const cases: { name: string; input: string; expected: string }[] = [
    { name: "ESC + CSI clear-screen", input: "clear\x1b[2Jscreen", expected: "clear[2Jscreen" },
    { name: "BEL", input: "ping\x07pong", expected: "pingpong" },
    { name: "OSC title-set sequence", input: "\x1b]0;pwned\x07done", expected: "]0;pwneddone" },
    { name: "lone ESC", input: "esc\x1bhere", expected: "eschere" },
    { name: "C1 control char", input: "c1\u0085here", expected: "c1here" },
    { name: "plain text is untouched", input: "Add feature A", expected: "Add feature A" },
  ];

  it.each(cases)("strips $name", ({ input, expected }) => {
    expect(sanitize(input)).toBe(expected);
  });
});

describe("terminal-escape injection", () => {
  const maliciousTitle = "Evil PR\x1b[2Jcleared\x07beeped";

  it("renderTable strips control bytes from an untrusted title", () => {
    const evilPr = makePr({ number: 99, title: maliciousTitle });
    const table = renderTable([evilPr], { sort: "reviewability", limit: 20 });
    expect(table).not.toContain("\x1b");
    expect(table).not.toContain("\x07");
    expect(table).toContain("Evil PR");
    expect(table).toContain("cleared");
    expect(table).toContain("beeped");
  });

  it("renderComponents strips control bytes from an untrusted component name", () => {
    const evilReport: Report = {
      ...report,
      components: [{ name: "co\x1bre", prCount: 1 }],
    };
    const output = renderComponents(evilReport);
    expect(output).not.toContain("\x1b");
    expect(output).toContain("core");
  });

  it("selectPrs (the --json data path) leaves the raw title untouched", () => {
    const evilPr = makePr({ number: 99, title: maliciousTitle });
    const evilReport: Report = { ...report, prs: [evilPr] };
    const selected = selectPrs(evilReport, { sort: "reviewability", limit: 20 });
    expect(selected[0]?.title).toBe(maliciousTitle);
    expect(JSON.stringify(selected[0])).toContain(JSON.stringify(maliciousTitle).slice(1, -1));
  });
});
