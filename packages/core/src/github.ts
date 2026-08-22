import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { z } from "zod";
import { GithubApiError, TokenMissingError } from "./errors";
import type { CiStatus, PrData, ReviewState } from "./types";

const execFileAsync = promisify(execFile);

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

const GITHUB_GRAPHQL_URL = "https://api.github.com/graphql";

const PR_NODE_QUERY = `
  query($owner: String!, $name: String!, $after: String) {
    repository(owner: $owner, name: $name) {
      pullRequests(states: OPEN, first: 100, after: $after) {
        nodes {
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
        }
        pageInfo { hasNextPage endCursor }
      }
    }
  }
`;

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

const pullRequestsPageSchema = z.object({
  nodes: z.array(prNodeSchema),
  pageInfo: z.object({
    hasNextPage: z.boolean(),
    endCursor: z.string().nullable(),
  }),
});

const graphqlErrorSchema = z.object({
  message: z.string(),
});

const graphqlEnvelopeSchema = z.object({
  data: z
    .object({
      repository: z.object({
        pullRequests: pullRequestsPageSchema,
      }),
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
): Promise<PrData[]> {
  const [owner, name] = repo.split("/");
  if (owner === undefined || name === undefined) {
    throw new GithubApiError(`Invalid repo format: ${repo}`, 400);
  }

  const nodes: PrNode[] = [];
  let after: string | null = null;
  let hasNextPage = true;

  while (hasNextPage) {
    const response = await fetchImpl(GITHUB_GRAPHQL_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query: PR_NODE_QUERY,
        variables: { owner, name, after },
      }),
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

    const page = parsed.data.data.repository.pullRequests;
    nodes.push(...page.nodes);
    hasNextPage = page.pageInfo.hasNextPage;
    after = page.pageInfo.endCursor;
  }

  // Branch rules only matter when reviewDecision is null; one fetch per distinct base branch.
  const branchesNeedingRules = [
    ...new Set(nodes.filter((n) => n.reviewDecision === null).map((n) => n.baseRefName)),
  ];
  const rules = await Promise.all(
    branchesNeedingRules.map((branch) => fetchBranchRule(owner, name, branch, token, fetchImpl)),
  );
  const rulesByBranch = new Map(branchesNeedingRules.map((branch, i) => [branch, rules[i]]));

  return nodes.map((node) => mapNode(node, rulesByBranch.get(node.baseRefName)));
}
