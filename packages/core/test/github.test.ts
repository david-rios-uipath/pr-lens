import { describe, expect, it } from "vitest";
import { GithubApiError, TokenMissingError } from "../src/errors";
import { fetchOpenPrs, resolveToken } from "../src/github";
import type { NodeOverrides } from "./githubStub";
import { bodyText, fixturePages, twoPhaseFetch } from "./githubStub";

const approvedAt = (submittedAt: string) => ({ state: "APPROVED", submittedAt });
const pullRequestRule = (params: Record<string, unknown>) => ({ type: "pull_request", parameters: params });

describe("resolveToken", () => {
  it("prefers GITHUB_TOKEN from env", async () => {
    await expect(resolveToken({ GITHUB_TOKEN: "tok" })).resolves.toBe("tok");
  });
  it("throws TokenMissingError when nothing available", async () => {
    await expect(resolveToken({ GITHUB_TOKEN: undefined, PATH: "/nonexistent" }))
      .rejects.toBeInstanceOf(TokenMissingError);
  });
});

describe("fetchOpenPrs", () => {
  it("enumerates pages, hydrates, and maps nodes to PrData", async () => {
    const { fetchImpl, enumerateCalls } = twoPhaseFetch(await fixturePages());
    const prs = await fetchOpenPrs("UiPath/flow-workbench", "tok", fetchImpl);
    expect(enumerateCalls).toEqual([2, 1]);
    expect(prs).toHaveLength(3);
    expect(prs[0]).toMatchObject({ number: 101, ci: "SUCCESS", reviewState: "APPROVED", approvals: 1 });
    expect(prs[1]).toMatchObject({ author: "ghost", mergeable: "CONFLICTING", ci: "FAILURE", isDraft: true });
    expect(prs[2]).toMatchObject({ ci: "PENDING", reviewState: "NONE" });
  });

  it("hydrates in chunks of 25, preserving enumerate order", async () => {
    const nodes: NodeOverrides[] = Array.from({ length: 30 }, (_, i) => ({
      number: i + 1,
      reviewDecision: "APPROVED",
    }));
    const { fetchImpl, hydrateCalls } = twoPhaseFetch([nodes]);
    const prs = await fetchOpenPrs("o/r", "tok", fetchImpl);
    expect(hydrateCalls.map((c) => c.length).sort((a, b) => b - a)).toEqual([25, 5]);
    expect(prs.map((p) => p.number)).toEqual(nodes.map((n) => n.number));
  });

  it("skips PRs that disappear between enumerate and hydrate", async () => {
    const stub = twoPhaseFetch([[{ number: 1, reviewDecision: "APPROVED" }, { number: 2, reviewDecision: "APPROVED" }]]);
    // Enumerate advertises PR 3, but it's not hydratable (closed in between).
    const fetchImpl = (url: string, init?: RequestInit) => {
      if (bodyText(init).includes("pullRequests(")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              data: {
                repository: {
                  pullRequests: {
                    nodes: [{ number: 1 }, { number: 2 }, { number: 3 }],
                    pageInfo: { hasNextPage: false, endCursor: null },
                  },
                },
              },
            }),
            { status: 200 },
          ),
        );
      }
      return stub.fetchImpl(url, init);
    };
    const prs = await fetchOpenPrs("o/r", "tok", fetchImpl);
    expect(prs.map((p) => p.number)).toEqual([1, 2]);
  });

  it("retries a request that fails with 502 and succeeds", async () => {
    const { fetchImpl } = twoPhaseFetch([[{ number: 1, reviewDecision: "APPROVED" }]]);
    let failed = false;
    const flaky = (url: string, init?: RequestInit) => {
      if (!failed && bodyText(init).includes("pullRequest(number:")) {
        failed = true;
        return Promise.resolve(new Response("bad gateway", { status: 502 }));
      }
      return fetchImpl(url, init);
    };
    const prs = await fetchOpenPrs("o/r", "tok", flaky);
    expect(failed).toBe(true);
    expect(prs.map((p) => p.number)).toEqual([1]);
  });

  it("does not retry non-transient failures", async () => {
    let calls = 0;
    const fetchImpl = () => {
      calls += 1;
      return Promise.resolve(new Response("forbidden", { status: 401 }));
    };
    await expect(fetchOpenPrs("o/r", "tok", fetchImpl)).rejects.toBeInstanceOf(GithubApiError);
    expect(calls).toBe(1);
  });

  it("trusts a non-null reviewDecision and never fetches branch rules", async () => {
    const { fetchImpl, rulesCalls } = twoPhaseFetch(
      [[{ reviewDecision: "CHANGES_REQUESTED", latestReviews: { nodes: [approvedAt("2026-08-02T00:00:00Z")] } }]],
      {},
    );
    const prs = await fetchOpenPrs("o/r", "tok", fetchImpl);
    expect(prs[0]?.reviewState).toBe("CHANGES_REQUESTED");
    expect(rulesCalls).toEqual([]);
  });

  it("marks APPROVED when approvals meet the ruleset's required count", async () => {
    const { fetchImpl } = twoPhaseFetch(
      [[{ latestReviews: { nodes: [approvedAt("2026-08-02T00:00:00Z")] } }]],
      { main: [pullRequestRule({ required_approving_review_count: 1 })] },
    );
    const prs = await fetchOpenPrs("o/r", "tok", fetchImpl);
    expect(prs[0]?.reviewState).toBe("APPROVED");
  });

  it("marks REVIEW_REQUIRED when approvals fall short of the required count", async () => {
    const { fetchImpl } = twoPhaseFetch(
      [[{ latestReviews: { nodes: [approvedAt("2026-08-02T00:00:00Z")] } }]],
      { main: [pullRequestRule({ required_approving_review_count: 2 })] },
    );
    const prs = await fetchOpenPrs("o/r", "tok", fetchImpl);
    expect(prs[0]?.reviewState).toBe("REVIEW_REQUIRED");
  });

  it("counts each reviewer once via latestReviews, so a superseded approval doesn't satisfy the rule", async () => {
    const { fetchImpl } = twoPhaseFetch(
      [[{ latestReviews: { nodes: [{ state: "CHANGES_REQUESTED", submittedAt: "2026-08-03T00:00:00Z" }] } }]],
      { main: [pullRequestRule({ required_approving_review_count: 1 })] },
    );
    const prs = await fetchOpenPrs("o/r", "tok", fetchImpl);
    expect(prs[0]?.reviewState).toBe("CHANGES_REQUESTED");
    expect(prs[0]?.approvals).toBe(0);
  });

  it("requires an approval after the last push when require_last_push_approval is set", async () => {
    const rules = {
      main: [pullRequestRule({ required_approving_review_count: 1, require_last_push_approval: true })],
    };
    const stale = twoPhaseFetch([[{ latestReviews: { nodes: [approvedAt("2026-08-01T08:30:00Z")] } }]], rules);
    const fresh = twoPhaseFetch([[{ latestReviews: { nodes: [approvedAt("2026-08-01T09:30:00Z")] } }]], rules);
    const [stalePrs, freshPrs] = await Promise.all([
      fetchOpenPrs("o/r", "tok", stale.fetchImpl),
      fetchOpenPrs("o/r", "tok", fresh.fetchImpl),
    ]);
    expect(stalePrs[0]?.reviewState).toBe("REVIEW_REQUIRED");
    expect(freshPrs[0]?.reviewState).toBe("APPROVED");
  });

  it("falls back to approvals > 0 when the base branch has no review rule", async () => {
    const { fetchImpl } = twoPhaseFetch(
      [[
        { number: 1, latestReviews: { nodes: [approvedAt("2026-08-02T00:00:00Z")] } },
        { number: 2, latestReviews: { nodes: [] } },
      ]],
      { main: [] },
    );
    const prs = await fetchOpenPrs("o/r", "tok", fetchImpl);
    expect(prs[0]?.reviewState).toBe("APPROVED");
    expect(prs[1]?.reviewState).toBe("NONE");
  });

  it("fetches rules once per distinct base branch", async () => {
    const { fetchImpl, rulesCalls } = twoPhaseFetch(
      [[
        { number: 1, baseRefName: "develop" },
        { number: 2, baseRefName: "develop" },
        { number: 3, baseRefName: "release/1.0" },
      ]],
      {},
    );
    await fetchOpenPrs("o/r", "tok", fetchImpl);
    expect(rulesCalls.sort()).toEqual(["develop", "release/1.0"]);
  });

  it("surfaces rate limits with reset time", async () => {
    const fetchImpl = () =>
      Promise.resolve(
        new Response("rate limited", {
          status: 403,
          headers: { "x-ratelimit-reset": "1787000000" },
        }),
      );
    await expect(fetchOpenPrs("o/r", "tok", fetchImpl)).rejects.toSatisfy(
      (e: unknown) => e instanceof GithubApiError && e.status === 403 && e.rateLimitResetAt !== undefined,
    );
  });
});
