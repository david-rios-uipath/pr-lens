import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { GithubApiError, TokenMissingError } from "../src/errors.js";
import { fetchOpenPrs, resolveToken } from "../src/github.js";

const page = async (n: number) =>
  new Response(await readFile(new URL(`./fixtures/prs-page${String(n)}.json`, import.meta.url), "utf8"), {
    status: 200,
  });

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
    const prs = await fetchOpenPrs("UiPath/flow-workbench", "tok", async () => page(++call));
    expect(prs).toHaveLength(3);
    expect(prs[0]).toMatchObject({ number: 101, ci: "SUCCESS", reviewState: "APPROVED", approvals: 1 });
    expect(prs[1]).toMatchObject({ author: "ghost", mergeable: "CONFLICTING", ci: "FAILURE", isDraft: true });
    expect(prs[2]).toMatchObject({ ci: "PENDING", reviewState: "NONE" });
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
