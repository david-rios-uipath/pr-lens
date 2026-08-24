import { z } from "zod";
import { GithubApiError } from "./errors";
import type { FetchLike } from "./github";
import type { DimensionScore } from "./report";
import type { PrFile } from "./types";

const GITHUB_GRAPHQL_URL = "https://api.github.com/graphql";

export interface BriefData {
  number: number;
  title: string;
  author: string;
  url: string;
  body: string;
  baseRef: string;
  headRef: string;
  ci: { name: string; status: string }[];
  reviewComments: { author: string; path: string | null; body: string }[];
  linkedIssues: { number: number; title: string }[];
  files: PrFile[];
  diff: string;
}

const BRIEF_QUERY = `
  query($owner: String!, $name: String!, $number: Int!) {
    repository(owner: $owner, name: $name) {
      pullRequest(number: $number) {
        title
        url
        author { login }
        baseRefName
        headRefName
        body
        closingIssuesReferences(first: 10) { nodes { number title } }
        files(first: 100) { nodes { path additions deletions } }
        reviewThreads(first: 50) {
          nodes {
            comments(first: 10) { nodes { author { login } path body } }
          }
        }
        commits(last: 1) {
          nodes {
            commit {
              statusCheckRollup {
                contexts(first: 50) {
                  nodes {
                    __typename
                    ... on CheckRun { name conclusion }
                    ... on StatusContext { context state }
                  }
                }
              }
            }
          }
        }
      }
    }
  }
`;

const authorSchema = z.object({ login: z.string() }).nullable();

const checkContextNodeSchema = z.union([
  z.object({ __typename: z.literal("CheckRun"), name: z.string(), conclusion: z.string().nullable() }),
  z.object({ __typename: z.literal("StatusContext"), context: z.string(), state: z.string() }),
]);

const pullRequestSchema = z.object({
  title: z.string(),
  url: z.string(),
  author: authorSchema,
  baseRefName: z.string(),
  headRefName: z.string(),
  body: z.string().nullable(),
  closingIssuesReferences: z.object({
    nodes: z.array(z.object({ number: z.number(), title: z.string() })),
  }),
  files: z.object({
    nodes: z.array(z.object({ path: z.string(), additions: z.number(), deletions: z.number() })),
  }),
  reviewThreads: z.object({
    nodes: z.array(
      z.object({
        comments: z.object({
          nodes: z.array(z.object({ author: authorSchema, path: z.string().nullable(), body: z.string() })),
        }),
      }),
    ),
  }),
  commits: z.object({
    nodes: z.array(
      z.object({
        commit: z.object({
          statusCheckRollup: z
            .object({ contexts: z.object({ nodes: z.array(checkContextNodeSchema) }) })
            .nullable(),
        }),
      }),
    ),
  }),
});

const graphqlEnvelopeSchema = z.object({
  data: z
    .object({
      repository: z.object({ pullRequest: pullRequestSchema.nullable() }),
    })
    .nullable()
    .optional(),
  errors: z.array(z.object({ message: z.string() })).optional(),
});

type CheckContextNode = z.infer<typeof checkContextNodeSchema>;

function mapCheckContext(node: CheckContextNode): { name: string; status: string } {
  if (node.__typename === "CheckRun") {
    return { name: node.name, status: node.conclusion ?? "PENDING" };
  }
  return { name: node.context, status: node.state };
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

export async function fetchBrief(
  repo: string,
  number: number,
  token: string,
  fetchImpl: FetchLike = fetch,
): Promise<BriefData> {
  const [owner, name] = repo.split("/");
  if (owner === undefined || name === undefined) {
    throw new GithubApiError(`Invalid repo format: ${repo}`, 400);
  }

  const graphqlResponse = await fetchImpl(GITHUB_GRAPHQL_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      query: BRIEF_QUERY,
      variables: { owner, name, number },
    }),
  });

  if (!graphqlResponse.ok) {
    const resetAt = rateLimitResetAt(graphqlResponse);
    throw new GithubApiError(
      `GitHub API request failed with status ${String(graphqlResponse.status)}`,
      graphqlResponse.status,
      resetAt,
    );
  }

  const raw: unknown = await graphqlResponse.json();
  const parsed = graphqlEnvelopeSchema.safeParse(raw);
  if (!parsed.success) {
    throw new GithubApiError(`Invalid GraphQL response: ${parsed.error.message}`, graphqlResponse.status);
  }

  if (parsed.data.errors !== undefined && parsed.data.errors.length > 0) {
    const messages = parsed.data.errors.map((e) => e.message).join("; ");
    throw new GithubApiError(`GraphQL errors: ${messages}`, graphqlResponse.status);
  }

  const pullRequest = parsed.data.data?.repository.pullRequest;
  if (pullRequest === null || pullRequest === undefined) {
    throw new GithubApiError(`PR #${String(number)} not found in ${repo}`, graphqlResponse.status);
  }

  const diffResponse = await fetchImpl(`https://api.github.com/repos/${repo}/pulls/${String(number)}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github.diff",
    },
  });

  if (!diffResponse.ok) {
    const resetAt = rateLimitResetAt(diffResponse);
    throw new GithubApiError(
      `GitHub API request failed with status ${String(diffResponse.status)}`,
      diffResponse.status,
      resetAt,
    );
  }

  const diff = await diffResponse.text();

  const rollup = pullRequest.commits.nodes[0]?.commit.statusCheckRollup;
  const reviewComments = pullRequest.reviewThreads.nodes.flatMap((thread) =>
    thread.comments.nodes.map((comment) => ({
      author: comment.author?.login ?? "ghost",
      path: comment.path,
      body: comment.body,
    })),
  );

  return {
    number,
    title: pullRequest.title,
    author: pullRequest.author?.login ?? "ghost",
    url: pullRequest.url,
    body: pullRequest.body ?? "",
    baseRef: pullRequest.baseRefName,
    headRef: pullRequest.headRefName,
    ci: (rollup?.contexts.nodes ?? []).map(mapCheckContext),
    reviewComments,
    linkedIssues: pullRequest.closingIssuesReferences.nodes,
    files: pullRequest.files.nodes,
    diff,
  };
}

// Strips C0/C1 control chars (incl. ESC) but keeps \n and \t, so untrusted
// markdown (PR bodies/diffs/comments) can't inject terminal escape sequences
// while remaining readable multi-line markdown.
// eslint-disable-next-line no-control-regex -- intentional: this is the control-char filter.
const CONTROL_CHARS_KEEP_NEWLINE_TAB = /[\u0000-\u0008\u000B-\u001F\u007F-\u009F]/g;

export function sanitizeMultiline(value: string): string {
  return value.replace(CONTROL_CHARS_KEEP_NEWLINE_TAB, "");
}

function renderCiChecklist(ci: BriefData["ci"]): string {
  if (ci.length === 0) return "_none_";
  return ci.map((c) => `- [${c.status === "SUCCESS" ? "x" : " "}] ${c.name} (${c.status})`).join("\n");
}

function renderReviewComments(comments: BriefData["reviewComments"]): string {
  if (comments.length === 0) return "_none_";
  return comments
    .map((c) => `- **${c.author}**${c.path === null ? "" : ` (\`${c.path}\`)`}: ${c.body}`)
    .join("\n");
}

function renderLinkedIssues(issues: BriefData["linkedIssues"]): string {
  if (issues.length === 0) return "_none_";
  return issues.map((i) => `- #${String(i.number)} ${i.title}`).join("\n");
}

function renderChangedFiles(files: PrFile[]): string {
  if (files.length === 0) return "_none_";
  return files.map((f) => `- ${f.path} (+${String(f.additions)}/-${String(f.deletions)})`).join("\n");
}

function renderScoreTable(score: DimensionScore): string {
  const rows = score.breakdown
    .map((b) => `| ${b.factor} | ${String(b.weight)} | ${String(b.value)} | ${b.reason} |`)
    .join("\n");
  return [
    `## Score`,
    "",
    `Overall: **${String(score.score)}**`,
    "",
    "| Factor | Weight | Value | Reason |",
    "| --- | --- | --- | --- |",
    rows,
  ].join("\n");
}

export function renderBriefMarkdown(brief: BriefData, score?: DimensionScore): string {
  const sections = [
    `# PR #${String(brief.number)}: ${brief.title}`,
    `**${brief.author}** · ${brief.baseRef}←${brief.headRef} · ${brief.url}`,
    ["## Description", "", brief.body.length === 0 ? "_none_" : brief.body].join("\n"),
    ...(score === undefined ? [] : [renderScoreTable(score)]),
    ["## CI", "", renderCiChecklist(brief.ci)].join("\n"),
    ["## Review comments", "", renderReviewComments(brief.reviewComments)].join("\n"),
    ["## Linked issues", "", renderLinkedIssues(brief.linkedIssues)].join("\n"),
    ["## Changed files", "", renderChangedFiles(brief.files)].join("\n"),
    ["## Diff", "", "```diff", brief.diff, "```"].join("\n"),
  ];
  return sections.join("\n\n");
}
