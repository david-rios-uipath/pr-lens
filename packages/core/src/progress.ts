/** Scan pipeline stages, in execution order. */
export const SCAN_STAGES = [
  "resolve-token",
  "fetch-prs",
  "fetch-branch-rules",
  "read-config",
  "build-report",
  "write-report",
] as const;

export type ScanStage = (typeof SCAN_STAGES)[number];

export const SCAN_STAGE_LABELS: Record<ScanStage, string> = {
  "resolve-token": "Resolve token",
  "fetch-prs": "Fetch PRs",
  "fetch-branch-rules": "Fetch branch rules",
  "read-config": "Read config",
  "build-report": "Build report",
  "write-report": "Write report",
};

export interface ScanProgressEvent {
  stage: ScanStage;
  status: "start" | "progress" | "done";
  /** Set on "done". */
  elapsedMs?: number;
  /** e.g. "page 2 · 187 PRs" */
  detail?: string;
}

export type ScanProgressListener = (event: ScanProgressEvent) => void;

/** Runs one stage, emitting start/done events with elapsed time around it. */
export async function timedStage<T>(
  onProgress: ScanProgressListener | undefined,
  stage: ScanStage,
  fn: () => Promise<T> | T,
  detail?: (result: T) => string,
): Promise<T> {
  onProgress?.({ stage, status: "start" });
  const started = performance.now();
  const result = await fn();
  const detailText = detail?.(result);
  onProgress?.({
    stage,
    status: "done",
    elapsedMs: performance.now() - started,
    ...(detailText === undefined ? {} : { detail: detailText }),
  });
  return result;
}
