import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { fetchBrief, renderBriefMarkdown, sanitizeMultiline } from "../src/brief";
import { GithubApiError } from "../src/errors";
import type { DimensionScore } from "../src/report";

const ESC = String.fromCharCode(27);
const BELL = String.fromCharCode(7);
const CR = String.fromCharCode(13);
const DEL = String.fromCharCode(127);

const briefFixture = async () =>
  new Response(await readFile(new URL("./fixtures/brief-pr.json", import.meta.url), "utf8"), { status: 200 });

const diffFixture = async () =>
  new Response(await readFile(new URL("./fixtures/brief.diff", import.meta.url), "utf8"), { status: 200 });

const rawDiffFixture = () => readFile(new URL("./fixtures/brief.diff", import.meta.url), "utf8");

function routeFetch() {
  return (url: string) => {
    if (url.includes("/graphql")) return briefFixture();
    return diffFixture();
  };
}

describe("fetchBrief", () => {
  it("maps GraphQL + REST diff response into BriefData", async () => {
    const brief = await fetchBrief("UiPath/flow-workbench", 42, "tok", routeFetch());

    expect(brief.number).toBe(42);
    expect(brief.title).toBe("Add retry logic to fetch client");
    expect(brief.author).toBe("alice");
    expect(brief.url).toBe("https://github.com/UiPath/flow-workbench/pull/42");
    expect(brief.baseRef).toBe("main");
    expect(brief.headRef).toBe("feat/retry-logic");
    expect(brief.body).toContain("exponential backoff");

    expect(brief.ci).toHaveLength(2);
    expect(brief.ci).toContainEqual({ name: "build", status: "SUCCESS" });
    expect(brief.ci).toContainEqual({ name: "ci/lint", status: "PENDING" });

    expect(brief.reviewComments).toHaveLength(1);
    expect(brief.reviewComments[0]).toMatchObject({
      author: "bob",
      path: "src/fetchClient.ts",
      body: "Should this backoff be configurable?",
    });

    expect(brief.linkedIssues).toEqual([
      { number: 17, title: "Fetch client fails on transient network errors" },
    ]);

    expect(brief.files).toEqual([
      { path: "src/fetchClient.ts", additions: 40, deletions: 5 },
      { path: "src/fetchClient.test.ts", additions: 60, deletions: 0 },
    ]);

    expect(brief.diff).toBe(await rawDiffFixture());
  });

  it("defaults review comment author to ghost when author is null", async () => {
    const fixture = JSON.parse(await readFile(new URL("./fixtures/brief-pr.json", import.meta.url), "utf8")) as {
      data: { repository: { pullRequest: { reviewThreads: { nodes: unknown[] } } } };
    };
    fixture.data.repository.pullRequest.reviewThreads.nodes = [
      { comments: { nodes: [{ author: null, path: null, body: "anonymous comment" }] } },
    ];
    const brief = await fetchBrief("UiPath/flow-workbench", 42, "tok", (url: string) => {
      if (url.includes("/graphql")) {
        return Promise.resolve(new Response(JSON.stringify(fixture), { status: 200 }));
      }
      return diffFixture();
    });
    expect(brief.reviewComments).toEqual([{ author: "ghost", path: null, body: "anonymous comment" }]);
  });

  it("throws GithubApiError on non-200 GraphQL response", async () => {
    await expect(
      fetchBrief("o/r", 1, "tok", () => Promise.resolve(new Response("boom", { status: 500 }))),
    ).rejects.toBeInstanceOf(GithubApiError);
  });

  it("throws GithubApiError with rate-limit reset on non-200 REST diff response", async () => {
    await expect(
      fetchBrief("o/r", 1, "tok", (url: string) => {
        if (url.includes("/graphql")) return briefFixture();
        return Promise.resolve(
          new Response("rate limited", { status: 403, headers: { "x-ratelimit-reset": "1787000000" } }),
        );
      }),
    ).rejects.toSatisfy((e: unknown) => e instanceof GithubApiError && e.rateLimitResetAt !== undefined);
  });
});

describe("renderBriefMarkdown", () => {
  it("renders all sections including score table and fenced diff", async () => {
    const brief = await fetchBrief("UiPath/flow-workbench", 42, "tok", routeFetch());
    const score: DimensionScore = {
      score: 82,
      breakdown: [{ factor: "diffSize", weight: 0.25, value: 0.9, reason: "105 lines changed" }],
    };
    const md = renderBriefMarkdown(brief, score);

    expect(md).toContain("# PR #42: Add retry logic to fetch client");
    expect(md).toContain("## Description");
    expect(md).toContain("## Score");
    expect(md).toContain("diffSize");
    expect(md).toContain("## CI");
    expect(md).toContain("build");
    expect(md).toContain("## Review comments");
    expect(md).toContain("bob");
    expect(md).toContain("## Linked issues");
    expect(md).toContain("#17");
    expect(md).toContain("## Changed files");
    expect(md).toContain("src/fetchClient.ts");
    expect(md).toContain("## Diff");
    expect(md).toContain("```diff");
    expect(md).toContain("fetchJson");
  });

  it("omits the score table when no score is provided", async () => {
    const brief = await fetchBrief("UiPath/flow-workbench", 42, "tok", routeFetch());
    const md = renderBriefMarkdown(brief);
    expect(md).not.toContain("## Score");
  });

  it("renders placeholders for empty body/comments/issues", async () => {
    const brief = await fetchBrief("UiPath/flow-workbench", 42, "tok", routeFetch());
    const empty = { ...brief, body: "", reviewComments: [], linkedIssues: [] };
    const md = renderBriefMarkdown(empty);
    expect(md).toContain("_none_");
  });
});

describe("sanitizeMultiline", () => {
  it("strips C0/C1 control chars but keeps newlines and tabs", () => {
    const input = `line one\n\ttabbed${ESC}[31mred${BELL}bell${CR}cr${DEL}del`;
    const result = sanitizeMultiline(input);
    expect(result).toBe("line one\n\ttabbed[31mredbellcrdel");
  });

  it("strips a bare carriage return (line-overwrite spoofing primitive)", () => {
    const result = sanitizeMultiline("a\rb\nc\td");
    expect(result).toBe("ab\nc\td");
  });

  it("strips terminal escape sequences from renderBriefMarkdown output before printing", async () => {
    const brief = await fetchBrief("UiPath/flow-workbench", 42, "tok", routeFetch());
    const malicious = { ...brief, body: `hello${ESC}[31mred${CR}${BELL}\ntext` };
    const md = renderBriefMarkdown(malicious);
    const sanitized = sanitizeMultiline(md);
    expect(sanitized.includes(ESC)).toBe(false);
    expect(sanitized.includes(CR)).toBe(false);
    expect(sanitized.includes(BELL)).toBe(false);
    expect(sanitized).toContain("\n");
    expect(sanitized).toContain("hello");
    expect(sanitized).toContain("[31mred");
    expect(sanitized).toContain("text");
  });
});
