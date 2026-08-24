import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { fetchOpenPrs } from "../src/github";
import type { ScanProgressEvent } from "../src/progress";
import { SCAN_STAGES } from "../src/progress";
import { runScan } from "../src/scan";
import { fixturePages, twoPhaseFetch } from "./githubStub";

async function makeFetchStub() {
  return twoPhaseFetch(await fixturePages()).fetchImpl;
}

function collect() {
  const events: ScanProgressEvent[] = [];
  return { events, onProgress: (e: ScanProgressEvent) => events.push(e) };
}

const ofStage = (events: ScanProgressEvent[], stage: string) => events.filter((e) => e.stage === stage);

describe("fetchOpenPrs progress", () => {
  it("emits start, per-page and per-chunk progress, and done for fetch-prs", async () => {
    const { events, onProgress } = collect();
    await fetchOpenPrs("UiPath/flow-workbench", "tok", await makeFetchStub(), onProgress);

    const fetchEvents = ofStage(events, "fetch-prs");
    expect(fetchEvents.map((e) => e.status)).toEqual(["start", "progress", "progress", "progress", "done"]);
    expect(fetchEvents[1]?.detail).toContain("page 1");
    expect(fetchEvents[2]?.detail).toContain("page 2");
    expect(fetchEvents[3]?.detail).toContain("hydrated 3/3");
    const done = fetchEvents[4];
    expect(done?.elapsedMs).toBeGreaterThanOrEqual(0);
    expect(done?.detail).toContain("3 PRs");
  });

  it("emits start and done for fetch-branch-rules with the branch count", async () => {
    const { events, onProgress } = collect();
    await fetchOpenPrs("UiPath/flow-workbench", "tok", await makeFetchStub(), onProgress);

    const ruleEvents = ofStage(events, "fetch-branch-rules");
    expect(ruleEvents.map((e) => e.status)).toEqual(["start", "done"]);
    expect(ruleEvents[1]?.elapsedMs).toBeGreaterThanOrEqual(0);
    expect(ruleEvents[1]?.detail).toMatch(/\d+ branch/);
  });
});

describe("runScan progress", () => {
  it("emits every stage in pipeline order with elapsed times on done", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pr-lens-"));
    const { events, onProgress } = collect();
    await runScan({
      repo: "UiPath/flow-workbench",
      dir,
      fetchImpl: await makeFetchStub(),
      env: { GITHUB_TOKEN: "tok" },
      onProgress,
    });

    const startedStages = events.filter((e) => e.status === "start").map((e) => e.stage);
    expect(startedStages).toEqual([...SCAN_STAGES]);

    for (const stage of SCAN_STAGES) {
      const done = ofStage(events, stage).at(-1);
      expect(done?.status).toBe("done");
      expect(done?.elapsedMs).toBeGreaterThanOrEqual(0);
    }
  });

  it("each stage starts only after the previous stage is done", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pr-lens-"));
    const { events, onProgress } = collect();
    await runScan({
      repo: "UiPath/flow-workbench",
      dir,
      fetchImpl: await makeFetchStub(),
      env: { GITHUB_TOKEN: "tok" },
      onProgress,
    });

    const transitions = events.filter((e) => e.status !== "progress");
    for (let i = 0; i < transitions.length; i += 2) {
      expect(transitions[i]?.status).toBe("start");
      expect(transitions[i + 1]?.status).toBe("done");
      expect(transitions[i + 1]?.stage).toBe(transitions[i]?.stage);
    }
  });
});
