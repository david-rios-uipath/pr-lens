import { readConfig } from "./config";
import { CROSS_CUTTING, deriveComponents } from "./components";
import type { FetchLike } from "./github";
import { fetchOpenPrs, resolveToken } from "./github";
import type { ScanProgressListener } from "./progress";
import { timedStage } from "./progress";
import type { Report, ReportPr } from "./report";
import { writeReport } from "./report";
import { evaluateDimension, REVIEWABILITY_FACTORS } from "./scoring";
import type { PrData } from "./types";

/** Pure: derives components, scores each PR, and assembles a sorted report. */
export function buildReport(
  repo: string,
  prs: PrData[],
  now: () => number,
  weights?: Record<string, number>,
): Report {
  const { components, perPr } = deriveComponents(prs.map((p) => ({ number: p.number, files: p.files })));
  const factors = REVIEWABILITY_FACTORS.map((f) => ({
    ...f,
    weight: weights?.[f.name] ?? f.weight,
  }));

  const reportPrs: { pr: ReportPr; reviewabilityScore: number }[] = prs.map((pr) => {
    const info = perPr.get(pr.number);
    const reviewability = evaluateDimension(factors, pr);
    return {
      reviewabilityScore: reviewability.score,
      pr: {
        number: pr.number,
        title: pr.title,
        author: pr.author,
        url: pr.url,
        updatedAt: pr.updatedAt,
        isDraft: pr.isDraft,
        mergeable: pr.mergeable,
        additions: pr.additions,
        deletions: pr.deletions,
        changedFiles: pr.changedFiles,
        ci: pr.ci,
        reviewState: pr.reviewState,
        labels: pr.labels,
        componentPrimary: info?.primary ?? CROSS_CUTTING,
        componentsSecondary: info?.secondary ?? [],
        componentShares: info?.shares ?? {},
        scores: { reviewability },
      },
    };
  });

  reportPrs.sort(
    (a, b) => b.reviewabilityScore - a.reviewabilityScore || a.pr.number - b.pr.number,
  );

  return {
    repo,
    generatedAt: new Date(now()).toISOString(),
    components,
    prs: reportPrs.map((r) => r.pr),
  };
}

export async function runScan(opts: {
  repo: string;
  dir: string;
  fetchImpl?: FetchLike;
  env?: Record<string, string | undefined>;
  onProgress?: ScanProgressListener;
}): Promise<Report> {
  const { onProgress } = opts;
  const token = await timedStage(onProgress, "resolve-token", () => resolveToken(opts.env));
  const prs = await fetchOpenPrs(opts.repo, token, opts.fetchImpl, onProgress);
  const config = await timedStage(onProgress, "read-config", () => readConfig(opts.dir));
  const report = await timedStage(onProgress, "build-report", () =>
    buildReport(opts.repo, prs, () => Date.now(), config.weights),
  );
  await timedStage(onProgress, "write-report", () => writeReport(opts.dir, report));
  return report;
}
