import type { Report, ReportPr } from "@pr-lens/core";
import { affinityScore } from "@pr-lens/core";

export interface LsOptions {
  component?: string;
  sort: "reviewability" | "affinity";
  limit: number;
}

export function selectPrs(report: Report, opts: LsOptions): ReportPr[] {
  const component = opts.component;
  let prs = report.prs;
  if (component !== undefined) {
    prs = prs.filter((pr) => pr.componentPrimary === component || pr.componentsSecondary.includes(component));
  }

  const sorted = [...prs];
  if (opts.sort === "affinity") {
    if (component === undefined) {
      throw new Error("--sort affinity requires --component");
    }
    sorted.sort((a, b) => affinityScore(b.componentShares, component) - affinityScore(a.componentShares, component));
  } else {
    sorted.sort((a, b) => (b.scores.reviewability?.score ?? 0) - (a.scores.reviewability?.score ?? 0));
  }

  return sorted.slice(0, opts.limit);
}

// Strips C0/C1 control chars (incl. ESC) so untrusted strings (PR titles, authors,
// component names, breakdown reasons) can't inject terminal escape sequences.
// eslint-disable-next-line no-control-regex -- intentional: this is the control-char filter.
const CONTROL_CHARS = /[\u0000-\u001F\u007F-\u009F]/g;

export function sanitize(value: string): string {
  return value.replace(CONTROL_CHARS, "");
}

function pad(value: string, width: number): string {
  return value.length >= width ? value.slice(0, width) : value.padEnd(width);
}

function truncateTitle(title: string, max: number): string {
  return title.length <= max ? title : `${title.slice(0, max - 1)}…`;
}

function topReasons(pr: ReportPr): string {
  const breakdown = pr.scores.reviewability?.breakdown ?? [];
  return [...breakdown]
    .filter((entry) => entry.weight > 0)
    .sort((a, b) => b.weight * b.value - a.weight * a.value)
    .slice(0, 2)
    .map((entry) => sanitize(entry.reason))
    .join(" · ");
}

export function renderTable(prs: ReportPr[], opts: LsOptions): string {
  const showAffinity = opts.sort === "affinity";
  const component = opts.component;

  const header = [
    pad("#", 4),
    pad("rev", 5),
    ...(showAffinity ? [pad("aff", 5)] : []),
    pad("pr", 7),
    pad("title", 50),
    pad("component", 14),
    pad("diff", 14),
    pad("ci", 8),
    "reasons",
  ].join(" ");

  const rows = prs.map((pr, index) => {
    const cols = [
      pad(String(index + 1), 4),
      pad(String(pr.scores.reviewability?.score ?? 0), 5),
      ...(showAffinity && component !== undefined
        ? [pad(String(affinityScore(pr.componentShares, component)), 5)]
        : []),
      pad(`#${String(pr.number)}`, 7),
      pad(truncateTitle(sanitize(pr.title), 50), 50),
      pad(sanitize(pr.componentPrimary), 14),
      pad(`+${String(pr.additions)}/-${String(pr.deletions)}`, 14),
      pad(pr.ci, 8),
      topReasons(pr),
    ];
    return cols.join(" ");
  });

  return [header, ...rows].join("\n");
}

export function renderComponents(report: Report): string {
  return report.components.map((c) => `${sanitize(c.name)}  ${String(c.prCount)}`).join("\n");
}

export function staleMs(spec: string): number {
  const match = /^(\d+)(s|m|h)$/.exec(spec);
  const numStr = match?.[1];
  const unit = match?.[2];
  if (numStr === undefined || unit === undefined) {
    throw new Error(`Invalid duration: ${spec} (expected e.g. "30s", "15m", "2h")`);
  }
  const multiplier = unit === "s" ? 1000 : unit === "m" ? 60_000 : 3_600_000;
  return Number(numStr) * multiplier;
}

export function timeAgo(generatedAt: string, nowMs: number): string {
  const diffMs = nowMs - new Date(generatedAt).getTime();
  const seconds = diffMs / 1000;
  if (seconds < 60) return "just now";
  const minutes = seconds / 60;
  if (minutes < 60) return `${String(Math.floor(minutes))} min ago`;
  const hours = minutes / 60;
  if (hours < 24) return `${String(Math.floor(hours))} h ago`;
  const days = hours / 24;
  return `${String(Math.floor(days))} d ago`;
}
