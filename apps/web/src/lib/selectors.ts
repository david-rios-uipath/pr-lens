import type { Report, ReportPr } from "@pr-lens/core";

export type SortKey = "reviewability" | "affinity" | "updated" | "size";

/** Applies to the sort key's metric: "desc" = highest score / most recent / largest first. */
export type SortDir = "desc" | "asc";

export interface ViewOptions {
  components: string[];
  /** Selected author logins; empty means "all authors". */
  authors: string[];
  query: string;
  sort: SortKey;
  sortDir: SortDir;
  hideApproved: boolean;
  hideDrafts: boolean;
}

/**
 * Approved PRs and drafts are hidden by default — the list is for finding work
 * that still needs review, and a draft isn't asking for any.
 */
export const DEFAULT_VIEW: ViewOptions = {
  components: [],
  authors: [],
  query: "",
  sort: "reviewability",
  sortDir: "desc",
  hideApproved: true,
  hideDrafts: true,
};

export function scoreOf(pr: ReportPr): number {
  return pr.scores.reviewability?.score ?? 0;
}

export function affinityOf(pr: ReportPr, components: string[]): number {
  return components.reduce((max, c) => Math.max(max, pr.componentShares[c] ?? 0), 0);
}

function totalLines(pr: ReportPr): number {
  return pr.additions + pr.deletions;
}

function matchesComponent(pr: ReportPr, component: string): boolean {
  return pr.componentPrimary === component || pr.componentsSecondary.includes(component);
}

function filterByComponents(prs: ReportPr[], components: string[]): ReportPr[] {
  if (components.length === 0) return prs;
  return prs.filter((pr) => components.some((c) => matchesComponent(pr, c)));
}

function filterByAuthors(prs: ReportPr[], authors: string[]): ReportPr[] {
  if (authors.length === 0) return prs;
  return prs.filter((pr) => authors.includes(pr.author));
}

/** Filters that apply regardless of which facet's counts are being computed. */
function filterByQueryAndState(prs: ReportPr[], opts: ViewOptions): ReportPr[] {
  const q = opts.query.trim().toLowerCase();
  if (q.length > 0) {
    prs = prs.filter((pr) => pr.title.toLowerCase().includes(q));
  }
  if (opts.hideApproved) {
    prs = prs.filter((pr) => pr.reviewState !== "APPROVED");
  }
  if (opts.hideDrafts) {
    prs = prs.filter((pr) => !pr.isDraft);
  }
  return prs;
}

/** The value the sort key ranks on. Higher always means "first" under sortDir "desc". */
function sortMetric(pr: ReportPr, sort: SortKey, components: string[]): number {
  switch (sort) {
    // Affinity is meaningless without a component selection — fall back to the score.
    case "affinity":
      return components.length === 0 ? scoreOf(pr) : affinityOf(pr, components);
    case "updated":
      return new Date(pr.updatedAt).getTime();
    case "size":
      return totalLines(pr);
    case "reviewability":
      return scoreOf(pr);
  }
}

export function selectView(report: Report, opts: ViewOptions): ReportPr[] {
  const { components, authors, sort, sortDir } = opts;

  let prs = filterByComponents(report.prs, components);
  prs = filterByAuthors(prs, authors);
  prs = filterByQueryAndState(prs, opts);

  const sign = sortDir === "asc" ? -1 : 1;
  return [...prs].sort(
    (a, b) => sign * (sortMetric(b, sort, components) - sortMetric(a, sort, components)),
  );
}

/**
 * Per-component PR counts under every active filter except the component
 * selection itself, so picking one component doesn't zero out the rest of
 * the dropdown.
 */
export function componentCounts(report: Report, opts: ViewOptions): { name: string; prCount: number }[] {
  const prs = filterByQueryAndState(filterByAuthors(report.prs, opts.authors), opts);
  return report.components
    .map((c) => ({ name: c.name, prCount: prs.filter((pr) => matchesComponent(pr, c.name)).length }))
    .sort((a, b) => b.prCount - a.prCount || a.name.localeCompare(b.name));
}

/**
 * Per-author PR counts under every active filter except the author
 * selection itself, so picking one author doesn't zero out the rest of
 * the dropdown. The login list comes from the unfiltered report — a
 * zero-count author stays listed rather than vanishing mid-interaction.
 */
export function authorCounts(report: Report, opts: ViewOptions): { login: string; prCount: number }[] {
  const prs = filterByQueryAndState(filterByComponents(report.prs, opts.components), opts);
  const logins = [...new Set(report.prs.map((pr) => pr.author))];
  return logins
    .map((login) => ({ login, prCount: prs.filter((pr) => pr.author === login).length }))
    .sort((a, b) => b.prCount - a.prCount || a.login.localeCompare(b.login));
}

/**
 * PRs still awaiting a first review, across the whole report — deliberately
 * independent of ViewOptions so narrowing the list can't shrink the total.
 * Approved and changes-requested have both had a review; a draft isn't
 * asking for one.
 */
export function unreviewedCount(report: Report): number {
  return report.prs.filter(
    (pr) => !pr.isDraft && (pr.reviewState === "REVIEW_REQUIRED" || pr.reviewState === "NONE"),
  ).length;
}

/** Affinity sort requires at least one selected component; otherwise fall back to reviewability. */
export function normalizeView(opts: ViewOptions): ViewOptions {
  if (opts.sort === "affinity" && opts.components.length === 0) {
    return { ...opts, sort: "reviewability" };
  }
  return opts;
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

export interface ReviewLabelDescriptor {
  text: string;
  variant: "success" | "danger";
}

/** Draft/approved/changes-requested are worth flagging; review-required/none add noise. */
export function reviewLabel(pr: ReportPr): ReviewLabelDescriptor | null {
  if (pr.isDraft) return { text: "Draft", variant: "danger" };
  if (pr.reviewState === "APPROVED") return { text: "Approved", variant: "success" };
  if (pr.reviewState === "CHANGES_REQUESTED") return { text: "Changes requested", variant: "danger" };
  return null;
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
