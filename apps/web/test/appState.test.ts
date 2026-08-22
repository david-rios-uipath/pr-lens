import type { Report } from "@pr-lens/core";
import { describe, expect, it } from "vitest";
import {
  afterDismissRefreshError,
  afterLoadError,
  afterRefreshError,
  afterReportLoaded,
} from "../src/lib/appState";
import type { LoadState } from "../src/lib/appState";

function makeReport(repo: string): Report {
  return { repo, generatedAt: "2026-08-21T12:00:00.000Z", components: [], prs: [] };
}

describe("afterReportLoaded", () => {
  it("moves to loaded with no refresh error", () => {
    const report = makeReport("o/r");
    expect(afterReportLoaded(report)).toEqual({ status: "loaded", report, refreshError: null });
  });
});

describe("afterLoadError", () => {
  it("moves to the full-page error state", () => {
    expect(afterLoadError("boom")).toEqual({ status: "error", message: "boom" });
  });
});

describe("afterRefreshError", () => {
  it("keeps the loaded report visible and attaches a refreshError, when already loaded", () => {
    const report = makeReport("o/r");
    const prev = afterReportLoaded(report);
    const next = afterRefreshError(prev, "scan failed");
    expect(next).toEqual({ status: "loaded", report, refreshError: "scan failed" });
  });

  it("falls back to the full-page error state when nothing was loaded yet", () => {
    const prev: LoadState = { status: "loading" };
    const next = afterRefreshError(prev, "scan failed");
    expect(next).toEqual({ status: "error", message: "scan failed" });
  });

  it("overwrites a previous refreshError rather than accumulating it", () => {
    const report = makeReport("o/r");
    const prev = afterRefreshError(afterReportLoaded(report), "first failure");
    const next = afterRefreshError(prev, "second failure");
    expect(next).toEqual({ status: "loaded", report, refreshError: "second failure" });
  });
});

describe("afterDismissRefreshError", () => {
  it("clears the refreshError when loaded", () => {
    const report = makeReport("o/r");
    const prev = afterRefreshError(afterReportLoaded(report), "scan failed");
    expect(afterDismissRefreshError(prev)).toEqual({ status: "loaded", report, refreshError: null });
  });

  it("is a no-op when not loaded", () => {
    const prev: LoadState = { status: "loading" };
    expect(afterDismissRefreshError(prev)).toEqual({ status: "loading" });
  });
});
