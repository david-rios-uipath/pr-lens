import type { Report, ReportSummary, ScanProgressEvent } from "@pr-lens/core";
import { createSseParser } from "./lib/sse";

interface ErrorBody {
  error?: string;
}

async function parseErrorMessage(res: Response): Promise<string> {
  try {
    const body: unknown = await res.json();
    const error = (body as ErrorBody).error;
    if (typeof error === "string" && error.length > 0) {
      return error;
    }
  } catch {
    // response wasn't JSON — fall through to the status text below
  }
  return `Request failed: ${String(res.status)}`;
}

async function requestJson<T>(input: RequestInfo, init?: RequestInit): Promise<T> {
  const res = await fetch(input, init);
  if (!res.ok) {
    throw new Error(await parseErrorMessage(res));
  }
  return (await res.json()) as T;
}

function withRepo(path: string, repo?: string): string {
  return repo === undefined ? path : `${path}?repo=${encodeURIComponent(repo)}`;
}

export function fetchReport(repo?: string): Promise<Report> {
  return requestJson<Report>(withRepo("/api/report", repo));
}

export async function triggerScan(
  repo?: string,
  onProgress?: (event: ScanProgressEvent) => void,
): Promise<Report> {
  const res = await fetch(withRepo("/api/scan", repo), {
    method: "POST",
    headers: { Accept: "text/event-stream" },
  });
  if (!res.ok) {
    throw new Error(await parseErrorMessage(res));
  }
  const isStream = res.headers.get("content-type")?.includes("text/event-stream") ?? false;
  if (!isStream || res.body === null) {
    return (await res.json()) as Report;
  }

  let report: Report | undefined;
  let scanError: string | undefined;
  const parser = createSseParser((event, data) => {
    if (event === "progress") {
      onProgress?.(data as ScanProgressEvent);
    } else if (event === "report") {
      report = data as Report;
    } else if (event === "error") {
      scanError = (data as { error: string }).error;
    }
  });

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parser.push(decoder.decode(value, { stream: true }));
  }

  if (scanError !== undefined) {
    throw new Error(scanError);
  }
  if (report === undefined) {
    throw new Error("Scan stream ended without a report");
  }
  return report;
}

export async function fetchRepos(): Promise<ReportSummary[]> {
  const body = await requestJson<{ repos: ReportSummary[] }>("/api/repos");
  return body.repos;
}
