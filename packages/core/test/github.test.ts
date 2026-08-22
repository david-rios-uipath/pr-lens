import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { GithubApiError, TokenMissingError } from "../src/errors";
import { fetchOpenPrs, resolveToken } from "../src/github";

const page = async (n: number) =>
  new Response(await readFile(new URL(`./fixtures/prs-page${String(n)}.json`, import.meta.url), "utf8"), {
    status: 200,
  });

const NODE_DEFAULTS = {
  number: 1,
  title: "A PR",
  url: "https://github.com/o/r/pull/1",
  isDraft: false,
  createdAt: "2026-08-01T10:00:00Z",
  updatedAt: "2026-08-02T10:00:00Z",
  additions: 1,
  deletions: 1,
  changedFiles: 1,
  mergeable: "MERGEABLE",
  baseRefName: "main",
  author: { login: "alice" },
  labels: { nodes: [] },
  reviewDecision: null,
  latestReviews: { nodes: [] },
  commits: {
    nodes: [
      {
        commit: {
          statusCheckRollup: { state: "SUCCESS" },
          pushedDate: "2026-08-01T09:00:00Z",
          committedDate: "2026-08-01T08:00:00Z",
        },
      },
    ],
  },
  files: { nodes: [{ path: "a.ts", additions: 1, deletions: 1 }] },
};

type NodeOverrides = Record<string, unknown>;

const gqlPage = (nodes: NodeOverrides[]) =>
  new Response(
    JSON.stringify({
      data: {
        repository: {
          pullRequests: {
            nodes: nodes.map((n) => ({ ...NODE_DEFAULTS, ...n })),
            pageInfo: { hasNextPage: false, endCursor: null },
          },
        },
      },
    }),
    { status: 200 },
  );

/** Routes GraphQL to the given page and /rules/branches/{branch} to per-branch rules. */
function routedFetch(nodes: NodeOverrides[], rulesByBranch: Record<string, unknown[]>) {
  const rulesCalls: string[] = [];
  const fetchImpl = (url: string) => {
    const match = /\/rules\/branches\/([^/?]+)$/.exec(url);
    if (match?.[1] !== undefined) {
      const branch = decodeURIComponent(match[1]);
      rulesCalls.push(branch);
      return Promise.resolve(new Response(JSON.stringify(rulesByBranch[branch] ?? []), { status: 200 }));
    }
    return Promise.resolve(gqlPage(nodes));
  };
  return { fetchImpl, rulesCalls };
}

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
  it("paginates and maps nodes to PrData", async () => {
    let call = 0;
    const prs = await fetchOpenPrs("UiPath/flow-workbench", "tok", async (url) =>
      url.includes("/rules/branches/") ? new Response("[]", { status: 200 }) : page(++call),
    );
    expect(prs).toHaveLength(3);
    expect(prs[0]).toMatchObject({ number: 101, ci: "SUCCESS", reviewState: "APPROVED", approvals: 1 });
    expect(prs[1]).toMatchObject({ author: "ghost", mergeable: "CONFLICTING", ci: "FAILURE", isDraft: true });
    expect(prs[2]).toMatchObject({ ci: "PENDING", reviewState: "NONE" });
  });

  it("trusts a non-null reviewDecision and never fetches branch rules", async () => {
    const { fetchImpl, rulesCalls } = routedFetch(
      [{ reviewDecision: "CHANGES_REQUESTED", latestReviews: { nodes: [approvedAt("2026-08-02T00:00:00Z")] } }],
      {},
    );
    const prs = await fetchOpenPrs("o/r", "tok", fetchImpl);
    expect(prs[0]?.reviewState).toBe("CHANGES_REQUESTED");
    expect(rulesCalls).toEqual([]);
  });

  it("marks APPROVED when approvals meet the ruleset's required count", async () => {
    const { fetchImpl } = routedFetch(
      [{ latestReviews: { nodes: [approvedAt("2026-08-02T00:00:00Z")] } }],
      { main: [pullRequestRule({ required_approving_review_count: 1 })] },
    );
    const prs = await fetchOpenPrs("o/r", "tok", fetchImpl);
    expect(prs[0]?.reviewState).toBe("APPROVED");
  });

  it("marks REVIEW_REQUIRED when approvals fall short of the required count", async () => {
    const { fetchImpl } = routedFetch(
      [{ latestReviews: { nodes: [approvedAt("2026-08-02T00:00:00Z")] } }],
      { main: [pullRequestRule({ required_approving_review_count: 2 })] },
    );
    const prs = await fetchOpenPrs("o/r", "tok", fetchImpl);
    expect(prs[0]?.reviewState).toBe("REVIEW_REQUIRED");
  });

  it("counts each reviewer once via latestReviews, so a superseded approval doesn't satisfy the rule", async () => {
    const { fetchImpl } = routedFetch(
      [{ latestReviews: { nodes: [{ state: "CHANGES_REQUESTED", submittedAt: "2026-08-03T00:00:00Z" }] } }],
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
    const stale = routedFetch(
      [{ latestReviews: { nodes: [approvedAt("2026-08-01T08:30:00Z")] } }],
      rules,
    );
    const fresh = routedFetch(
      [{ latestReviews: { nodes: [approvedAt("2026-08-01T09:30:00Z")] } }],
      rules,
    );
    const [stalePrs, freshPrs] = await Promise.all([
      fetchOpenPrs("o/r", "tok", stale.fetchImpl),
      fetchOpenPrs("o/r", "tok", fresh.fetchImpl),
    ]);
    expect(stalePrs[0]?.reviewState).toBe("REVIEW_REQUIRED");
    expect(freshPrs[0]?.reviewState).toBe("APPROVED");
  });

  it("falls back to approvals > 0 when the base branch has no review rule", async () => {
    const { fetchImpl } = routedFetch(
      [
        { number: 1, latestReviews: { nodes: [approvedAt("2026-08-02T00:00:00Z")] } },
        { number: 2, latestReviews: { nodes: [] } },
      ],
      { main: [] },
    );
    const prs = await fetchOpenPrs("o/r", "tok", fetchImpl);
    expect(prs[0]?.reviewState).toBe("APPROVED");
    expect(prs[1]?.reviewState).toBe("NONE");
  });

  it("fetches rules once per distinct base branch", async () => {
    const { fetchImpl, rulesCalls } = routedFetch(
      [
        { number: 1, baseRefName: "develop" },
        { number: 2, baseRefName: "develop" },
        { number: 3, baseRefName: "release/1.0" },
      ],
      {},
    );
    await fetchOpenPrs("o/r", "tok", fetchImpl);
    expect(rulesCalls.sort()).toEqual(["develop", "release/1.0"]);
  });

  it("surfaces rate limits with reset time", async () => {
    const resp = new Response("rate limited", {
      status: 403,
      headers: { "x-ratelimit-reset": "1787000000" },
    });
    await expect(fetchOpenPrs("o/r", "tok", () => Promise.resolve(resp))).rejects.toSatisfy(
      (e: unknown) => e instanceof GithubApiError && e.status === 403 && e.rateLimitResetAt !== undefined,
    );
  });
});
