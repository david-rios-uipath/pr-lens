import { describe, expect, it } from "vitest";
import { componentKey, CROSS_CUTTING, deriveComponents } from "../src/components.js";

const f = (path: string, lines = 10) => ({ path, additions: lines, deletions: 0 });

describe("componentKey", () => {
  it("uses two segments under src/packages/apps", () => {
    expect(componentKey("src/flow-editor/x.ts")).toBe("src/flow-editor");
    expect(componentKey("packages/core/src/a.ts")).toBe("packages/core");
  });
  it("uses one segment elsewhere and root for top-level files", () => {
    expect(componentKey("scripts/build.sh")).toBe("scripts");
    expect(componentKey("README.md")).toBe("root");
  });
});

describe("deriveComponents", () => {
  it("computes shares and primary/secondary", () => {
    const d = deriveComponents([
      { number: 1, files: [f("src/editor/a.ts", 80), f("src/shared/b.ts", 20)] },
    ]);
    const info = d.perPr.get(1);
    expect(info?.primary).toBe("src/editor");
    expect(info?.shares["src/editor"]).toBeCloseTo(0.8);
    expect(info?.secondary).toEqual(["src/shared"]);
  });

  it("marks scattered PRs as cross-cutting", () => {
    const d = deriveComponents([
      { number: 2, files: [f("src/a/x.ts", 10), f("src/b/y.ts", 10), f("src/c/z.ts", 10), f("src/d/w.ts", 10)] },
    ]);
    expect(d.perPr.get(2)?.primary).toBe(CROSS_CUTTING);
  });

  it("merges keys that always co-occur across >=2 PRs", () => {
    const d = deriveComponents([
      { number: 1, files: [f("src/a/x.ts"), f("src/a-types/x.ts")] },
      { number: 2, files: [f("src/a/y.ts"), f("src/a-types/y.ts")] },
      { number: 3, files: [f("src/b/z.ts")] },
    ]);
    expect(d.perPr.get(1)?.primary).toBe("src/a+src/a-types");
    expect(d.components.map((c) => c.name)).toContain("src/a+src/a-types");
  });

  it("counts PRs per component", () => {
    const d = deriveComponents([
      { number: 1, files: [f("src/a/x.ts")] },
      { number: 2, files: [f("src/a/y.ts")] },
    ]);
    expect(d.components).toEqual([{ name: "src/a", prCount: 2 }]);
  });
});
