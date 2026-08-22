import type { Report } from "@pr-lens/core";

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

async function requestReport(input: RequestInfo, init?: RequestInit): Promise<Report> {
  const res = await fetch(input, init);
  if (!res.ok) {
    throw new Error(await parseErrorMessage(res));
  }
  return (await res.json()) as Report;
}

export function fetchReport(): Promise<Report> {
  return requestReport("/api/report");
}

export function triggerScan(): Promise<Report> {
  return requestReport("/api/scan", { method: "POST" });
}
