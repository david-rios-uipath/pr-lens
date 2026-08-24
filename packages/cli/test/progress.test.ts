import { describe, expect, it } from "vitest";
import { formatProgressEvent } from "../src/progress";

describe("formatProgressEvent", () => {
  it("renders a start event as the stage label", () => {
    expect(formatProgressEvent({ stage: "fetch-prs", status: "start" })).toBe("▸ Fetch PRs");
  });

  it("renders a progress event with its detail", () => {
    expect(
      formatProgressEvent({ stage: "fetch-prs", status: "progress", detail: "page 2 · 187 PRs" }),
    ).toBe("  Fetch PRs — page 2 · 187 PRs");
  });

  it("renders a done event with elapsed millis under a second", () => {
    expect(formatProgressEvent({ stage: "resolve-token", status: "done", elapsedMs: 12.4 })).toBe(
      "✓ Resolve token (12ms)",
    );
  });

  it("renders a done event with elapsed seconds and detail", () => {
    expect(
      formatProgressEvent({ stage: "fetch-prs", status: "done", elapsedMs: 1234, detail: "3 PRs" }),
    ).toBe("✓ Fetch PRs (1.2s · 3 PRs)");
  });
});
