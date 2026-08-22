import type { Report, ReportPr } from "@pr-lens/core";

export type SortKey = "reviewability" | "affinity" | "newest" | "smallest";

export interface ViewOptions {
  component: string | null;
  query: string;
  sort: SortKey;
}

export function scoreOf(pr: ReportPr): number {
  return pr.scores.reviewability?.score ?? 0;
}

function affinityOf(pr: ReportPr, component: string): number {
  return pr.componentShares[component] ?? 0;
}

function totalLines(pr: ReportPr): number {
  return pr.additions + pr.deletions;
}

function matchesComponent(pr: ReportPr, component: string): boolean {
  return pr.componentPrimary === component || pr.componentsSecondary.includes(component);
}

export function selectView(report: Report, opts: ViewOptions): ReportPr[] {
  const { component, query, sort } = opts;
  const q = query.trim().toLowerCase();

  let prs = report.prs;
  if (component !== null) {
    prs = prs.filter((pr) => matchesComponent(pr, component));
  }
  if (q.length > 0) {
    prs = prs.filter((pr) => pr.title.toLowerCase().includes(q));
  }

  const sorted = [...prs];
  switch (sort) {
    case "affinity":
      if (component === null) {
        sorted.sort((a, b) => scoreOf(b) - scoreOf(a));
      } else {
        sorted.sort((a, b) => affinityOf(b, component) - affinityOf(a, component));
      }
      break;
    case "newest":
      sorted.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
      break;
    case "smallest":
      sorted.sort((a, b) => totalLines(a) - totalLines(b));
      break;
    case "reviewability":
      sorted.sort((a, b) => scoreOf(b) - scoreOf(a));
      break;
  }
  return sorted;
}

export function topReasons(pr: ReportPr, n: number): string[] {
  const breakdown = pr.scores.reviewability?.breakdown ?? [];
  return [...breakdown]
    .filter((entry) => entry.weight > 0)
    .sort((a, b) => b.weight * b.value - a.weight * a.value)
    .slice(0, n)
    .map((entry) => entry.reason);
}

export function sizeBucket(pr: ReportPr): "S" | "M" | "L" | "XL" {
  const total = totalLines(pr);
  if (total < 50) return "S";
  if (total < 300) return "M";
  if (total < 1000) return "L";
  return "XL";
}

export function agoLabel(iso: string, now: number): string {
  const diffMs = now - new Date(iso).getTime();
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 60) return `${String(minutes)}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${String(hours)}h ago`;
  const days = Math.floor(hours / 24);
  return `${String(days)}d ago`;
}
