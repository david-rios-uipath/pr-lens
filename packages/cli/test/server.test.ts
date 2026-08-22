import { mkdtemp, writeFile } from "node:fs/promises";
import type { Server } from "node:http";
import { createConnection } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Report } from "@pr-lens/core";
import { ReportNotFoundError, TokenMissingError } from "@pr-lens/core";
import { afterEach, describe, expect, it } from "vitest";
import { createServer } from "../src/server.js";
import type { ServerDeps } from "../src/server.js";

const FIXTURE_REPORT: Report = {
  repo: "acme/widgets",
  generatedAt: "2026-08-21T00:00:00.000Z",
  components: [{ name: "core", prCount: 1 }],
  prs: [
    {
      number: 1,
      title: "Fix bug",
      author: "octocat",
      url: "https://github.com/acme/widgets/pull/1",
      updatedAt: "2026-08-20T00:00:00.000Z",
      isDraft: false,
      mergeable: "MERGEABLE",
      additions: 10,
      deletions: 2,
      changedFiles: 1,
      ci: "SUCCESS",
      reviewState: "NONE",
      labels: [],
      componentPrimary: "core",
      componentsSecondary: [],
      componentShares: { core: 1 },
      scores: { reviewability: { score: 0.5, breakdown: [] } },
    },
  ],
};

function baseDeps(overrides: Partial<ServerDeps> = {}): ServerDeps {
  return {
    dir: "/tmp/does-not-matter",
    webDist: null,
    scan: () => Promise.resolve(FIXTURE_REPORT),
    readReport: () => Promise.resolve(FIXTURE_REPORT),
    ...overrides,
  };
}

async function listen(server: Server): Promise<string> {
  await new Promise<void>((resolvePromise) => {
    server.listen(0, "127.0.0.1", () => {
      resolvePromise();
    });
  });
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("expected server to bind to a port");
  }
  return `http://127.0.0.1:${String(address.port)}`;
}

/**
 * fetch() and node's http client both normalize "../" out of a request path
 * before it's ever sent over the wire, so a genuine traversal attempt has to
 * be written directly to the socket to bypass that normalization.
 */
function rawGet(base: string, rawPath: string): Promise<number> {
  const url = new URL(base);
  return new Promise((resolvePromise, reject) => {
    const socket = createConnection({ host: url.hostname, port: Number(url.port) }, () => {
      socket.write(`GET ${rawPath} HTTP/1.1\r\nHost: ${url.host}\r\nConnection: close\r\n\r\n`);
    });
    let data = "";
    socket.on("data", (chunk: Buffer) => {
      data += chunk.toString();
    });
    socket.on("end", () => {
      const statusLine = data.split("\r\n")[0] ?? "";
      const match = /^HTTP\/1\.1 (\d+)/.exec(statusLine);
      resolvePromise(match?.[1] !== undefined ? Number(match[1]) : 0);
    });
    socket.on("error", reject);
  });
}

function close(server: Server): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    server.close((err) => {
      if (err) reject(err);
      else resolvePromise();
    });
  });
}

describe("createServer", () => {
  let server: Server | undefined;

  afterEach(async () => {
    if (server !== undefined) {
      await close(server);
      server = undefined;
    }
  });

  it("GET /api/report returns the report as JSON", async () => {
    server = createServer(baseDeps());
    const base = await listen(server);

    const res = await fetch(`${base}/api/report`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
    const body: unknown = await res.json();
    expect(body).toEqual(FIXTURE_REPORT);
  });

  it("GET /api/report returns 404 with the error message when the report is missing", async () => {
    const path = "/tmp/somewhere/.pr-lens/report.json";
    server = createServer(
      baseDeps({
        readReport: () => Promise.reject(new ReportNotFoundError(path)),
      }),
    );
    const base = await listen(server);

    const res = await fetch(`${base}/api/report`);
    expect(res.status).toBe(404);
    const body: unknown = await res.json();
    expect(body).toEqual({ error: `No report found at ${path}. Run \`pr-lens scan\` first.` });
  });

  it("POST /api/scan returns 500 with the error message when the scan fails", async () => {
    server = createServer(
      baseDeps({
        scan: () => Promise.reject(new TokenMissingError("No GitHub token found. Set GITHUB_TOKEN or run `gh auth login`.")),
      }),
    );
    const base = await listen(server);

    const res = await fetch(`${base}/api/scan`, { method: "POST" });
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("GITHUB_TOKEN");
  });

  it("POST /api/scan returns the report on success", async () => {
    server = createServer(baseDeps());
    const base = await listen(server);

    const res = await fetch(`${base}/api/scan`, { method: "POST" });
    expect(res.status).toBe(200);
    const body: unknown = await res.json();
    expect(body).toEqual(FIXTURE_REPORT);
  });

  it("serializes concurrent scans into a single in-flight call", async () => {
    let calls = 0;
    server = createServer(
      baseDeps({
        scan: async () => {
          calls++;
          await new Promise((r) => setTimeout(r, 20));
          return FIXTURE_REPORT;
        },
      }),
    );
    const base = await listen(server);

    const [a, b] = await Promise.all([
      fetch(`${base}/api/scan`, { method: "POST" }),
      fetch(`${base}/api/scan`, { method: "POST" }),
    ]);
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(calls).toBe(1);
  });

  it("returns 503 text when webDist is null", async () => {
    server = createServer(baseDeps({ webDist: null }));
    const base = await listen(server);

    const res = await fetch(`${base}/`);
    expect(res.status).toBe(503);
    const body = await res.text();
    expect(body).toBe("web app not built — run pnpm --filter @pr-lens/web build");
  });

  it("serves index.html for /", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pr-lens-web-"));
    await writeFile(join(dir, "index.html"), "<html><body>hi</body></html>");
    server = createServer(baseDeps({ webDist: dir }));
    const base = await listen(server);

    const res = await fetch(`${base}/`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    expect(await res.text()).toBe("<html><body>hi</body></html>");
  });

  it("serves a static file with the correct content type", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pr-lens-web-"));
    await writeFile(join(dir, "index.html"), "<html></html>");
    await writeFile(join(dir, "app.js"), "console.log('hi')");
    server = createServer(baseDeps({ webDist: dir }));
    const base = await listen(server);

    const res = await fetch(`${base}/app.js`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/javascript");
    expect(await res.text()).toBe("console.log('hi')");
  });

  it("falls back to index.html for unknown SPA routes", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pr-lens-web-"));
    await writeFile(join(dir, "index.html"), "<html>spa</html>");
    server = createServer(baseDeps({ webDist: dir }));
    const base = await listen(server);

    const res = await fetch(`${base}/some/client/route`, { headers: { Accept: "text/html" } });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("<html>spa</html>");
  });

  it("blocks path traversal with a literal ../ and does not leak files outside webDist", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pr-lens-web-"));
    await writeFile(join(dir, "index.html"), "<html></html>");
    server = createServer(baseDeps({ webDist: dir }));
    const base = await listen(server);

    const status = await rawGet(base, "/../etc/passwd");
    expect(status).not.toBe(200);
    expect(status).toBe(404);
  });

  it("blocks path traversal using a URL-encoded ..%2f", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pr-lens-web-"));
    await writeFile(join(dir, "index.html"), "<html></html>");
    server = createServer(baseDeps({ webDist: dir }));
    const base = await listen(server);

    const status = await rawGet(base, "/..%2f..%2f..%2f..%2f..%2fetc%2fpasswd");
    expect(status).not.toBe(200);
    expect(status).toBe(404);
  });

  it("denies non-GET/POST methods with 405", async () => {
    server = createServer(baseDeps());
    const base = await listen(server);

    const res = await fetch(`${base}/api/report`, { method: "DELETE" });
    expect(res.status).toBe(405);
  });
});
