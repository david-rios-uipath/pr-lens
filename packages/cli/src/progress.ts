import type { ScanProgressEvent } from "@pr-lens/core";
import { SCAN_STAGE_LABELS } from "@pr-lens/core";

function formatElapsed(ms: number): string {
  return ms < 1000 ? `${String(Math.round(ms))}ms` : `${(ms / 1000).toFixed(1)}s`;
}

export function formatProgressEvent(event: ScanProgressEvent): string {
  const label = SCAN_STAGE_LABELS[event.stage];
  if (event.status === "start") {
    return `▸ ${label}`;
  }
  if (event.status === "progress") {
    return `  ${label}${event.detail === undefined ? "" : ` — ${event.detail}`}`;
  }
  const timing = [formatElapsed(event.elapsedMs ?? 0), ...(event.detail === undefined ? [] : [event.detail])].join(" · ");
  return `✓ ${label} (${timing})`;
}
