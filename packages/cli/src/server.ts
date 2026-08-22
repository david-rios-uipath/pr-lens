import { readFile, realpath } from "node:fs/promises";
import { createServer as createHttpServer } from "node:http";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import { extname, resolve, sep } from "node:path";
import type { Report } from "@pr-lens/core";
import { ReportNotFoundError } from "@pr-lens/core";
import { messageFor } from "./fail.js";

export interface ServerDeps {
  dir: string;
  webDist: string | null;
  scan: () => Promise<Report>;
  readReport: () => Promise<Report>;
}

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".json": "application/json",
};

function contentTypeFor(path: string): string {
  return CONTENT_TYPES[extname(path)] ?? "application/octet-stream";
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

function acceptsHtml(req: IncomingMessage): boolean {
  const accept = req.headers.accept;
  return accept === undefined || accept.length === 0 || accept.includes("text/html") || accept.includes("*/*");
}

/** Serves index.html for client-side routes; only reachable for paths inside webDist. */
async function serveIndexFallback(resolvedDist: string, req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (!acceptsHtml(req)) {
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Not Found");
    return;
  }
  try {
    const data = await readFile(resolve(resolvedDist, "index.html"));
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(data);
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Not Found");
  }
}

async function serveStatic(webDist: string | null, pathname: string, req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (webDist === null) {
    res.writeHead(503, { "Content-Type": "text/plain" });
    res.end("web app not built — run pnpm --filter @pr-lens/web build");
    return;
  }

  const resolvedDist = resolve(webDist);

  let decodedPath: string;
  try {
    decodedPath = decodeURIComponent(pathname);
  } catch {
    res.writeHead(400, { "Content-Type": "text/plain" });
    res.end("Bad Request");
    return;
  }

  const requestedPath = decodedPath === "/" ? "index.html" : decodedPath.replace(/^\/+/, "");
  const resolvedTarget = resolve(resolvedDist, requestedPath);
  const isInsideDist = resolvedTarget === resolvedDist || resolvedTarget.startsWith(resolvedDist + sep);

  if (!isInsideDist) {
    // Path traversal attempt — never fall back to the SPA index for these.
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Not Found");
    return;
  }

  // The lexical prefix check above doesn't catch a symlink inside webDist
  // that points outside it — resolve real paths and re-check before reading.
  let realTarget: string;
  try {
    realTarget = await realpath(resolvedTarget);
  } catch {
    await serveIndexFallback(resolvedDist, req, res);
    return;
  }

  const realDist = await realpath(resolvedDist).catch(() => resolvedDist);
  const isReallyInsideDist = realTarget === realDist || realTarget.startsWith(realDist + sep);
  if (!isReallyInsideDist) {
    // Symlink escape — never fall back to the SPA index for these either.
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Not Found");
    return;
  }

  try {
    const data = await readFile(realTarget);
    res.writeHead(200, { "Content-Type": contentTypeFor(resolvedTarget) });
    res.end(data);
  } catch {
    await serveIndexFallback(resolvedDist, req, res);
  }
}

export function createServer(deps: ServerDeps): Server {
  let inFlightScan: Promise<Report> | null = null;

  function runScanOnce(): Promise<Report> {
    inFlightScan ??= deps.scan().finally(() => {
      inFlightScan = null;
    });
    return inFlightScan;
  }

  async function handleReport(res: ServerResponse): Promise<void> {
    try {
      const report = await deps.readReport();
      sendJson(res, 200, report);
    } catch (err) {
      sendJson(res, err instanceof ReportNotFoundError ? 404 : 500, { error: messageFor(err) });
    }
  }

  async function handleScan(res: ServerResponse): Promise<void> {
    try {
      const report = await runScanOnce();
      sendJson(res, 200, report);
    } catch (err) {
      sendJson(res, 500, { error: messageFor(err) });
    }
  }

  return createHttpServer((req, res) => {
    void (async () => {
      const method = req.method ?? "GET";
      const pathname = (req.url ?? "/").split("?")[0] ?? "/";

      if (method !== "GET" && method !== "POST") {
        if (pathname.startsWith("/api/")) {
          sendJson(res, 405, { error: "Method Not Allowed" });
          return;
        }
        res.writeHead(405, { "Content-Type": "text/plain" });
        res.end("Method Not Allowed");
        return;
      }

      if (pathname === "/api/report") {
        if (method !== "GET") {
          sendJson(res, 405, { error: "Method Not Allowed" });
          return;
        }
        await handleReport(res);
        return;
      }

      if (pathname === "/api/scan") {
        if (method !== "POST") {
          sendJson(res, 405, { error: "Method Not Allowed" });
          return;
        }
        await handleScan(res);
        return;
      }

      if (pathname.startsWith("/api/")) {
        sendJson(res, 404, { error: "Not Found" });
        return;
      }

      if (method !== "GET") {
        res.writeHead(404, { "Content-Type": "text/plain" });
        res.end("Not Found");
        return;
      }

      await serveStatic(deps.webDist, pathname, req, res);
    })();
  });
}
