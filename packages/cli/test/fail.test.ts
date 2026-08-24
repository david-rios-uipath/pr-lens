import {
  GithubApiError,
  ReportNotFoundError,
  RepoResolutionError,
  TokenMissingError,
} from "@pr-lens/core";
import { describe, expect, it } from "vitest";
import { messageFor } from "../src/fail";

describe("messageFor", () => {
  it("returns the message for TokenMissingError", () => {
    const err = new TokenMissingError("No GitHub token found. Set GITHUB_TOKEN or run `gh auth login`.");
    expect(messageFor(err)).toBe("No GitHub token found. Set GITHUB_TOKEN or run `gh auth login`.");
  });

  it("returns a guidance message for ReportNotFoundError", () => {
    const err = new ReportNotFoundError("/tmp/repo/.pr-lens/report.json");
    expect(messageFor(err)).toBe(
      "No report found at /tmp/repo/.pr-lens/report.json. Run `pr-lens scan` first.",
    );
  });

  it("returns a rate-limit message for GithubApiError with rateLimitResetAt", () => {
    const err = new GithubApiError("rate limited", 403, "2026-08-21T12:00:00Z");
    expect(messageFor(err)).toBe("GitHub rate limit hit (resets 2026-08-21T12:00:00Z).");
  });

  it("returns a status message for other GithubApiError", () => {
    const err = new GithubApiError("boom", 500);
    expect(messageFor(err)).toBe("GitHub API error (500): boom");
  });

  it("returns the message for RepoResolutionError", () => {
    const err = new RepoResolutionError("Could not determine repo. Pass --repo <owner/name>.");
    expect(messageFor(err)).toBe("Could not determine repo. Pass --repo <owner/name>.");
  });

  it("falls back to String(err) for anything else", () => {
    expect(messageFor(new Error("plain"))).toBe(String(new Error("plain")));
    expect(messageFor("oops")).toBe("oops");
  });
});
