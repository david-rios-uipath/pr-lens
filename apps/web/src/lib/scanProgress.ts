import type { ScanProgressEvent, ScanStage } from "@pr-lens/core/progress";
import { SCAN_STAGE_LABELS, SCAN_STAGES } from "@pr-lens/core/progress";

export interface StageStatus {
  stage: ScanStage;
  label: string;
  state: "pending" | "active" | "done";
  elapsedMs?: number;
  detail?: string;
}

export type ScanProgress = StageStatus[];

export function initialScanProgress(): ScanProgress {
  return SCAN_STAGES.map((stage) => ({ stage, label: SCAN_STAGE_LABELS[stage], state: "pending" }));
}

export function formatElapsed(ms: number): string {
  return ms < 1000 ? `${String(Math.round(ms))}ms` : `${(ms / 1000).toFixed(1)}s`;
}

export function applyScanEvent(progress: ScanProgress, event: ScanProgressEvent): ScanProgress {
  return progress.map((s) => {
    if (s.stage !== event.stage) return s;
    if (event.status === "start") return { ...s, state: "active" };
    const updates = {
      ...(event.detail === undefined ? {} : { detail: event.detail }),
      ...(event.elapsedMs === undefined ? {} : { elapsedMs: event.elapsedMs }),
    };
    if (event.status === "progress") return { ...s, ...updates };
    return { ...s, state: "done", ...updates };
  });
}
