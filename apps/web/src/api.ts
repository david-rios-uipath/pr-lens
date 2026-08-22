import type { Report, ReportSummary } from "@pr-lens/core";

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

export function triggerScan(repo?: string): Promise<Report> {
  return requestJson<Report>(withRepo("/api/scan", repo), { method: "POST" });
}

export async function fetchRepos(): Promise<ReportSummary[]> {
  const body = await requestJson<{ repos: ReportSummary[] }>("/api/repos");
  return body.repos;
}
