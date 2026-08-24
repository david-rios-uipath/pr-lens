import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { z } from "zod";
import { GithubApiError, TokenMissingError } from "./errors";
import type { ScanProgressListener } from "./progress";
import { timedStage } from "./progress";
import { withRetry } from "./retry";
import type { CiStatus, PrData, ReviewState } from "./types";

const execFileAsync = promisify(execFile);

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

const GITHUB_GRAPHQL_URL = "https://api.github.com/graphql";

// Small hydration chunks keep each query well under GitHub's execution timeout,
// which otherwise surfaces as intermittent 502s on repos with many large PRs.
const ENUMERATE_PAGE_SIZE = 100;
const HYDRATE_CHUNK_SIZE = 25;
const HYDRATE_CONCURRENCY = 4;
const RETRYABLE_STATUSES = new Set([502, 503, 504]);

const PR_LIST_QUERY = `
  query($owner: String!, $name: String!, $after: String) {
    repository(owner: $owner, name: $name) {
      pullRequests(states: OPEN, first: ${String(ENUMERATE_PAGE_SIZE)}, after: $after) {
        nodes { number }
        pageInfo { hasNextPage endCursor }
      }
    }
  }
`;

const PR_FIELDS = `
  number
  title
  url
  isDraft
  createdAt
  updatedAt
  additions
  deletions
  changedFiles
  mergeable
  baseRefName
  author { login }
  labels(first: 20) { nodes { name } }
  reviewDecision
  latestReviews(first: 30) { nodes { state submittedAt } }
  commits(last: 1) {
    nodes { commit { statusCheckRollup { state } pushedDate committedDate } }
  }
  files(first: 100) { nodes { path additions deletions } }
`;

function hydrateQuery(numbers: number[]): string {
  const fields = numbers
    .map((n, i) => `pr${String(i)}: pullRequest(number: ${String(n)}) { ${PR_FIELDS} }`)
    .join("\n");
  return `
    query($owner: String!, $name: String!) {
      repository(owner: $owner, name: $name) {
        ${fields}
      }
    }
  `;
}

const prNodeSchema = z.object({
  number: z.number(),
  title: z.string(),
  url: z.string(),
  isDraft: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
  additions: z.number(),
  deletions: z.number(),
  changedFiles: z.number(),
  mergeable: z.enum(["MERGEABLE", "CONFLICTING", "UNKNOWN"]),
  baseRefName: z.string(),
  author: z.object({ login: z.string() }).nullable(),
  labels: z.object({ nodes: z.array(z.object({ name: z.string() })) }),
  reviewDecision: z.enum(["APPROVED", "CHANGES_REQUESTED", "REVIEW_REQUIRED"]).nullable(),
  latestReviews: z.object({
    nodes: z.array(z.object({ state: z.string(), submittedAt: z.string().nullable() })),
  }),
  commits: z.object({
    nodes: z.array(
      z.object({
        commit: z.object({
          statusCheckRollup: z.object({ state: z.string() }).nullable(),
          pushedDate: z.string().nullable(),
          committedDate: z.string(),
        }),
      }),
    ),
  }),
  files: z.object({
    nodes: z.array(
      z.object({
        path: z.string(),
        additions: z.number(),
        deletions: z.number(),
      }),
    ),
  }),
});

const enumeratePageSchema = z.object({
  pullRequests: z.object({
    nodes: z.array(z.object({ number: z.number() })),
    pageInfo: z.object({
      hasNextPage: z.boolean(),
      endCursor: z.string().nullable(),
    }),
  }),
});

const hydrateResultSchema = z.record(prNodeSchema.nullable());

const graphqlErrorSchema = z.object({
  message: z.string(),
});

const graphqlEnvelopeSchema = z.object({
  data: z
    .object({
      repository: z.unknown(),
    })
    .nullable()
    .optional(),
  errors: z.array(graphqlErrorSchema).optional(),
});

type PrNode = z.infer<typeof prNodeSchema>;

const branchRulesSchema = z.array(
  z.object({
    type: z.string(),
    parameters: z.unknown().optional(),
  }),
);

const pullRequestRuleParamsSchema = z.object({
  required_approving_review_count: z.number().optional(),
  require_last_push_approval: z.boolean().optional(),
});

interface PullRequestRule {
  requiredApprovingReviewCount: number;
  requireLastPushApproval: boolean;
}

function mapCiStatus(state: string | null | undefined): CiStatus {
  if (state === "SUCCESS") return "SUCCESS";
  if (state === "FAILURE" || state === "ERROR") return "FAILURE";
  if (state === "PENDING" || state === "EXPECTED") return "PENDING";
  return "NONE";
}

function countApprovals(node: PrNode): number {
  return node.latestReviews.nodes.filter((r) => r.state === "APPROVED").length;
}

/**
 * reviewDecision is null on repos whose review requirements live in rulesets.
 * Fall back to comparing current approvals (latest per author, so
 * stale-but-undismissed ones still count) against the base branch's rule.
 */
function resolveReviewState(node: PrNode, rule: PullRequestRule | undefined): ReviewState {
  if (node.reviewDecision !== null) return node.reviewDecision;
  if (node.latestReviews.nodes.some((r) => r.state === "CHANGES_REQUESTED")) return "CHANGES_REQUESTED";

  const approvals = node.latestReviews.nodes.filter(
    (r) => r.state === "APPROVED" && r.submittedAt !== null,
  );
  if (rule === undefined) return approvals.length > 0 ? "APPROVED" : "NONE";
  if (approvals.length < rule.requiredApprovingReviewCount) return "REVIEW_REQUIRED";

  if (rule.requireLastPushApproval) {
    const head = node.commits.nodes[0]?.commit;
    const pushedAt = head?.pushedDate ?? head?.committedDate;
    if (pushedAt !== undefined && !approvals.some((a) => a.submittedAt !== null && a.submittedAt > pushedAt)) {
      return "REVIEW_REQUIRED";
    }
  }
  return "APPROVED";
}

async function fetchBranchRule(
  owner: string,
  name: string,
  branch: string,
  token: string,
  fetchImpl: FetchLike,
): Promise<PullRequestRule | undefined> {
  const url = `https://api.github.com/repos/${owner}/${name}/rules/branches/${encodeURIComponent(branch)}`;
  const response = await fetchImpl(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
    },
  });

  if (!response.ok) {
    throw new GithubApiError(
      `GitHub branch rules request failed with status ${String(response.status)}`,
      response.status,
      rateLimitResetAt(response),
    );
  }

  const raw: unknown = await response.json();
  const rules = branchRulesSchema.safeParse(raw);
  if (!rules.success) {
    throw new GithubApiError(`Invalid branch rules response: ${rules.error.message}`, response.status);
  }

  const prRule = rules.data.find((r) => r.type === "pull_request");
  if (prRule === undefined) return undefined;

  const params = pullRequestRuleParamsSchema.safeParse(prRule.parameters ?? {});
  return {
    requiredApprovingReviewCount: params.success ? (params.data.required_approving_review_count ?? 0) : 0,
    requireLastPushApproval: params.success && (params.data.require_last_push_approval ?? false),
  };
}

function mapNode(node: PrNode, rule: PullRequestRule | undefined): PrData {
  const rollup = node.commits.nodes[0]?.commit.statusCheckRollup;
  return {
    number: node.number,
    title: node.title,
    author: node.author?.login ?? "ghost",
    url: node.url,
    createdAt: node.createdAt,
    updatedAt: node.updatedAt,
    isDraft: node.isDraft,
    mergeable: node.mergeable,
    additions: node.additions,
    deletions: node.deletions,
    changedFiles: node.changedFiles,
    approvals: countApprovals(node),
    ci: mapCiStatus(rollup?.state),
    reviewState: resolveReviewState(node, rule),
    labels: node.labels.nodes.map((l) => l.name),
    files: node.files.nodes.map((f) => ({
      path: f.path,
      additions: f.additions,
      deletions: f.deletions,
    })),
  };
}

export async function resolveToken(env: Record<string, string | undefined> = process.env): Promise<string> {
  const fromEnv = env.GITHUB_TOKEN;
  if (fromEnv !== undefined && fromEnv.length > 0) {
    return fromEnv;
  }

  try {
    const { stdout } = await execFileAsync("gh", ["auth", "token"], { env });
    const token = stdout.trim();
    if (token.length === 0) {
      throw new TokenMissingError("No GitHub token found. Set GITHUB_TOKEN or run `gh auth login`.");
    }
    return token;
  } catch {
    throw new TokenMissingError("No GitHub token found. Set GITHUB_TOKEN or run `gh auth login`.");
  }
}

function rateLimitResetAt(response: Response): string | undefined {
  const header = response.headers.get("x-ratelimit-reset");
  if (header === null) {
    return undefined;
  }
  const seconds = Number(header);
  if (Number.isNaN(seconds)) {
    return undefined;
  }
  return new Date(seconds * 1000).toISOString();
}

export async function fetchOpenPrs(
  repo: string,
  token: string,
  fetchImpl: FetchLike = fetch,
  onProgress?: ScanProgressListener,
): Promise<PrData[]> {
  const [owner, name] = repo.split("/");
  if (owner === undefined || name === undefined) {
    throw new GithubApiError(`Invalid repo format: ${repo}`, 400);
  }

  const nodes = await timedStage(
    onProgress,
    "fetch-prs",
    () => fetchPrNodes(owner, name, token, fetchImpl, onProgress),
    (result) => `${String(result.length)} PRs`,
  );

  // Branch rules only matter when reviewDecision is null; one fetch per distinct base branch.
  const branchesNeedingRules = [
    ...new Set(nodes.filter((n) => n.reviewDecision === null).map((n) => n.baseRefName)),
  ];
  const rules = await timedStage(
    onProgress,
    "fetch-branch-rules",
    () =>
      Promise.all(
        branchesNeedingRules.map((branch) =>
          withRetry(() => fetchBranchRule(owner, name, branch, token, fetchImpl), {
            isRetryable: isTransientGithubError,
          }),
        ),
      ),
    () => `${String(branchesNeedingRules.length)} ${branchesNeedingRules.length === 1 ? "branch" : "branches"}`,
  );
  const rulesByBranch = new Map(branchesNeedingRules.map((branch, i) => [branch, rules[i]]));

  return nodes.map((node) => mapNode(node, rulesByBranch.get(node.baseRefName)));
}

function isTransientGithubError(err: unknown): boolean {
  return err instanceof GithubApiError && RETRYABLE_STATUSES.has(err.status);
}

/** POSTs a GraphQL query (with retry on transient failures) and returns `data.repository`. */
async function graphqlRequest(
  token: string,
  fetchImpl: FetchLike,
  query: string,
  variables: Record<string, string | null>,
): Promise<unknown> {
  return withRetry(
    async () => {
      const response = await fetchImpl(GITHUB_GRAPHQL_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ query, variables }),
      });

      if (!response.ok) {
        const resetAt = rateLimitResetAt(response);
        throw new GithubApiError(
          `GitHub API request failed with status ${String(response.status)}`,
          response.status,
          resetAt,
        );
      }

      const raw: unknown = await response.json();
      const parsed = graphqlEnvelopeSchema.safeParse(raw);
      if (!parsed.success) {
        throw new GithubApiError(`Invalid GraphQL response: ${parsed.error.message}`, response.status);
      }

      if (parsed.data.errors !== undefined && parsed.data.errors.length > 0) {
        const messages = parsed.data.errors.map((e) => e.message).join("; ");
        throw new GithubApiError(`GraphQL errors: ${messages}`, response.status);
      }

      if (parsed.data.data === null || parsed.data.data === undefined) {
        throw new GithubApiError("GraphQL response missing data", response.status);
      }

      return parsed.data.data.repository;
    },
    { isRetryable: isTransientGithubError },
  );
}

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

/** Runs fn over items with at most `limit` in flight, preserving item order in the result. */
async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      const item = items[index] as T;
      results[index] = await fn(item);
    }
  });
  await Promise.all(workers);
  return results;
}

/**
 * Two-phase fetch: enumerate PR numbers with cheap sequential pages, then
 * hydrate full details in small parallel chunks. Keeps each query cheap
 * enough to avoid GitHub's execution-timeout 502s on large repos.
 */
async function fetchPrNodes(
  owner: string,
  name: string,
  token: string,
  fetchImpl: FetchLike,
  onProgress?: ScanProgressListener,
): Promise<PrNode[]> {
  const numbers: number[] = [];
  let after: string | null = null;
  let hasNextPage = true;
  let pageCount = 0;

  while (hasNextPage) {
    const repository = await graphqlRequest(token, fetchImpl, PR_LIST_QUERY, { owner, name, after });
    const parsed = enumeratePageSchema.safeParse(repository);
    if (!parsed.success) {
      throw new GithubApiError(`Invalid PR list response: ${parsed.error.message}`, 200);
    }
    const page = parsed.data.pullRequests;
    numbers.push(...page.nodes.map((n) => n.number));
    pageCount += 1;
    onProgress?.({
      stage: "fetch-prs",
      status: "progress",
      detail: `page ${String(pageCount)} · ${String(numbers.length)} PRs`,
    });
    hasNextPage = page.pageInfo.hasNextPage;
    after = page.pageInfo.endCursor;
  }

  let hydrated = 0;
  const chunkedNodes = await mapWithConcurrency(chunk(numbers, HYDRATE_CHUNK_SIZE), HYDRATE_CONCURRENCY, async (chunkNumbers) => {
    const repository = await graphqlRequest(token, fetchImpl, hydrateQuery(chunkNumbers), { owner, name });
    const parsed = hydrateResultSchema.safeParse(repository);
    if (!parsed.success) {
      throw new GithubApiError(`Invalid PR details response: ${parsed.error.message}`, 200);
    }
    // A null alias means the PR closed between enumerate and hydrate — skip it.
    const nodes = chunkNumbers
      .map((_, i) => parsed.data[`pr${String(i)}`])
      .filter((n): n is PrNode => n !== null && n !== undefined);
    hydrated += nodes.length;
    onProgress?.({
      stage: "fetch-prs",
      status: "progress",
      detail: `hydrated ${String(hydrated)}/${String(numbers.length)} PRs`,
    });
    return nodes;
  });

  return chunkedNodes.flat();
}
