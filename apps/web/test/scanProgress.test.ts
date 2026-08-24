import { SCAN_STAGES } from "@pr-lens/core/progress";
import { describe, expect, it } from "vitest";
import { applyScanEvent, formatElapsed, initialScanProgress } from "../src/lib/scanProgress";

describe("initialScanProgress", () => {
  it("lists every stage as pending", () => {
    const progress = initialScanProgress();
    expect(progress.map((s) => s.stage)).toEqual([...SCAN_STAGES]);
    expect(progress.every((s) => s.state === "pending")).toBe(true);
  });
});

describe("formatElapsed", () => {
  it("renders millis under a second and seconds above", () => {
    expect(formatElapsed(12.4)).toBe("12ms");
    expect(formatElapsed(1234)).toBe("1.2s");
  });
});

describe("applyScanEvent", () => {
  it("marks a stage active on start", () => {
    const progress = applyScanEvent(initialScanProgress(), { stage: "resolve-token", status: "start" });
    expect(progress[0]).toMatchObject({ stage: "resolve-token", state: "active" });
    expect(progress[1]?.state).toBe("pending");
  });

  it("records detail from progress events on the active stage", () => {
    let progress = initialScanProgress();
    progress = applyScanEvent(progress, { stage: "fetch-prs", status: "start" });
    progress = applyScanEvent(progress, { stage: "fetch-prs", status: "progress", detail: "page 2 · 187 PRs" });
    const fetchStage = progress.find((s) => s.stage === "fetch-prs");
    expect(fetchStage).toMatchObject({ state: "active", detail: "page 2 · 187 PRs" });
  });

  it("marks a stage done with elapsed time and final detail", () => {
    let progress = initialScanProgress();
    progress = applyScanEvent(progress, { stage: "fetch-prs", status: "start" });
    progress = applyScanEvent(progress, { stage: "fetch-prs", status: "done", elapsedMs: 1234, detail: "3 PRs" });
    const fetchStage = progress.find((s) => s.stage === "fetch-prs");
    expect(fetchStage).toMatchObject({ state: "done", elapsedMs: 1234, detail: "3 PRs" });
  });

  it("does not mutate the previous progress array", () => {
    const before = initialScanProgress();
    applyScanEvent(before, { stage: "resolve-token", status: "start" });
    expect(before[0]?.state).toBe("pending");
  });
});
