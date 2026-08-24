import { readFile, realpath } from "node:fs/promises";
import { createServer as createHttpServer } from "node:http";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import { extname, resolve, sep } from "node:path";
import type { Report, ReportSummary, ScanProgressEvent, ScanProgressListener } from "@pr-lens/core";
import { isValidRepoName, ReportNotFoundError } from "@pr-lens/core";
import { messageFor } from "./fail";

export interface ServerDeps {
  dir: string;
  webDist: string | null;
  scan: (repo?: string, onProgress?: ScanProgressListener) => Promise<Report>;
  readReport: (repo?: string) => Promise<Report>;
  listReports: () => Promise<ReportSummary[]>;
}

/** Returns the validated ?repo= value, undefined if absent, or null if malformed. */
function repoParam(url: string): string | undefined | null {
  const value = new URL(url, "http://localhost").searchParams.get("repo");
  if (value === null) {
    return undefined;
  }
  return isValidRepoName(value) ? value : null;
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

interface InFlightScan {
  promise: Promise<Report>;
  /** Events emitted so far, replayed to late SSE subscribers. */
  events: ScanProgressEvent[];
  listeners: Set<ScanProgressListener>;
}

function sendSseEvent(res: ServerResponse, event: string, data: unknown): void {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

export function createServer(deps: ServerDeps): Server {
  const inFlightScans = new Map<string, InFlightScan>();

  function runScanOnce(repo?: string): InFlightScan {
    const key = repo ?? "";
    const existing = inFlightScans.get(key);
    if (existing !== undefined) {
      return existing;
    }
    // Built piecewise: the scan may emit progress synchronously, before the entry object exists.
    const events: ScanProgressEvent[] = [];
    const listeners = new Set<ScanProgressListener>();
    const promise = deps
      .scan(repo, (event) => {
        events.push(event);
        for (const listener of listeners) {
          listener(event);
        }
      })
      .finally(() => {
        inFlightScans.delete(key);
      });
    const entry: InFlightScan = { events, listeners, promise };
    inFlightScans.set(key, entry);
    return entry;
  }

  async function handleReport(res: ServerResponse, repo?: string): Promise<void> {
    try {
      const report = await deps.readReport(repo);
      sendJson(res, 200, report);
    } catch (err) {
      sendJson(res, err instanceof ReportNotFoundError ? 404 : 500, { error: messageFor(err) });
    }
  }

  async function handleScan(req: IncomingMessage, res: ServerResponse, repo?: string): Promise<void> {
    const entry = runScanOnce(repo);

    if (req.headers.accept?.includes("text/event-stream") === true) {
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });
      const listener: ScanProgressListener = (event) => {
        sendSseEvent(res, "progress", event);
      };
      for (const event of entry.events) {
        listener(event);
      }
      entry.listeners.add(listener);
      try {
        const report = await entry.promise;
        sendSseEvent(res, "report", report);
      } catch (err) {
        sendSseEvent(res, "error", { error: messageFor(err) });
      } finally {
        entry.listeners.delete(listener);
        res.end();
      }
      return;
    }

    try {
      sendJson(res, 200, await entry.promise);
    } catch (err) {
      sendJson(res, 500, { error: messageFor(err) });
    }
  }

  async function handleRepos(res: ServerResponse): Promise<void> {
    try {
      sendJson(res, 200, { repos: await deps.listReports() });
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

      if (pathname === "/api/report" || pathname === "/api/scan") {
        const expected = pathname === "/api/report" ? "GET" : "POST";
        if (method !== expected) {
          sendJson(res, 405, { error: "Method Not Allowed" });
          return;
        }
        const repo = repoParam(req.url ?? "/");
        if (repo === null) {
          sendJson(res, 400, { error: "Invalid repo parameter (expected owner/name)" });
          return;
        }
        await (pathname === "/api/report" ? handleReport(res, repo) : handleScan(req, res, repo));
        return;
      }

      if (pathname === "/api/repos") {
        if (method !== "GET") {
          sendJson(res, 405, { error: "Method Not Allowed" });
          return;
        }
        await handleRepos(res);
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
