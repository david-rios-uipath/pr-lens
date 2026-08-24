import { readFile } from "node:fs/promises";

export type NodeOverrides = Record<string, unknown>;

export const NODE_DEFAULTS = {
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

interface GqlRequestBody {
  query: string;
  variables: { after?: string | null };
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200 });
}

/** Our requests always carry a JSON string body; anything else is a stub bug. */
export function bodyText(init?: RequestInit): string {
  return typeof init?.body === "string" ? init.body : "";
}

/** Numbers requested by a hydrate query, in alias order (pr0, pr1, ...). */
function requestedNumbers(query: string): number[] {
  return [...query.matchAll(/pullRequest\(number: (\d+)\)/g)].map((m) => Number(m[1]));
}

export interface TwoPhaseStub {
  fetchImpl: (url: string, init?: RequestInit) => Promise<Response>;
  rulesCalls: string[];
  enumerateCalls: number[];
  hydrateCalls: number[][];
}

/**
 * Serves the two-phase GitHub protocol: enumerate queries return each page's
 * PR numbers, hydrate queries return the matching full nodes (keyed pr0, pr1, ...),
 * and /rules/branches/{branch} returns per-branch rules.
 */
export function twoPhaseFetch(
  pages: NodeOverrides[][],
  rulesByBranch: Record<string, unknown[]> = {},
): TwoPhaseStub {
  const nodes = pages.flat().map((n) => ({ ...NODE_DEFAULTS, ...n }));
  const byNumber = new Map(nodes.map((n) => [n.number, n]));
  const rulesCalls: string[] = [];
  const enumerateCalls: number[] = [];
  const hydrateCalls: number[][] = [];
  let enumeratePage = 0;

  const fetchImpl = (url: string, init?: RequestInit) => {
    const rulesMatch = /\/rules\/branches\/([^/?]+)$/.exec(url);
    if (rulesMatch?.[1] !== undefined) {
      const branch = decodeURIComponent(rulesMatch[1]);
      rulesCalls.push(branch);
      return Promise.resolve(jsonResponse(rulesByBranch[branch] ?? []));
    }

    const body = JSON.parse(bodyText(init)) as GqlRequestBody;
    if (body.query.includes("pullRequests(")) {
      const page = pages[enumeratePage] ?? [];
      enumeratePage += 1;
      enumerateCalls.push(page.length);
      return Promise.resolve(
        jsonResponse({
          data: {
            repository: {
              pullRequests: {
                nodes: page.map((n) => ({ number: ({ ...NODE_DEFAULTS, ...n }).number })),
                pageInfo: {
                  hasNextPage: enumeratePage < pages.length,
                  endCursor: enumeratePage < pages.length ? `C${String(enumeratePage)}` : null,
                },
              },
            },
          },
        }),
      );
    }

    const numbers = requestedNumbers(body.query);
    hydrateCalls.push(numbers);
    const repository = Object.fromEntries(numbers.map((n, i) => [`pr${String(i)}`, byNumber.get(n) ?? null]));
    return Promise.resolve(jsonResponse({ data: { repository } }));
  };

  return { fetchImpl, rulesCalls, enumerateCalls, hydrateCalls };
}

/** The three fixture PRs (101–103) split across two enumerate pages, as node arrays. */
export async function fixturePages(): Promise<NodeOverrides[][]> {
  const load = async (n: number) => {
    const raw = JSON.parse(await readFile(new URL(`./fixtures/prs-page${String(n)}.json`, import.meta.url), "utf8")) as {
      data: { repository: { pullRequests: { nodes: NodeOverrides[] } } };
    };
    return raw.data.repository.pullRequests.nodes;
  };
  return [await load(1), await load(2)];
}
