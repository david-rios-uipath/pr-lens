import type { Report } from "@pr-lens/core";

export type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "loaded"; report: Report; refreshError: string | null };

export function afterReportLoaded(report: Report): LoadState {
  return { status: "loaded", report, refreshError: null };
}

export function afterLoadError(message: string): LoadState {
  return { status: "error", message };
}

/**
 * A failed refresh must never discard an already-loaded report — keep
 * showing the current list and surface the failure alongside it. Only
 * degrades to the full-page error state if nothing was loaded yet.
 */
export function afterRefreshError(prev: LoadState, message: string): LoadState {
  return prev.status === "loaded" ? { ...prev, refreshError: message } : { status: "error", message };
}

export function afterDismissRefreshError(prev: LoadState): LoadState {
  return prev.status === "loaded" ? { ...prev, refreshError: null } : prev;
}
