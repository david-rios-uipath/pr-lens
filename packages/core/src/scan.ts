import { readConfig } from "./config.js";
import { CROSS_CUTTING, deriveComponents } from "./components.js";
import type { FetchLike } from "./github.js";
import { fetchOpenPrs, resolveToken } from "./github.js";
import type { Report, ReportPr } from "./report.js";
import { writeReport } from "./report.js";
import { evaluateDimension, makeReviewabilityFactors } from "./scoring.js";
import type { PrData } from "./types.js";

/** Pure: derives components, scores each PR, and assembles a sorted report. */
export function buildReport(
  repo: string,
  prs: PrData[],
  now: () => number,
  weights?: Record<string, number>,
): Report {
  const { components, perPr } = deriveComponents(prs.map((p) => ({ number: p.number, files: p.files })));
  const factors = makeReviewabilityFactors(now).map((f) => ({
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
}): Promise<Report> {
  const token = await resolveToken(opts.env);
  const prs = await fetchOpenPrs(opts.repo, token, opts.fetchImpl);
  const config = await readConfig(opts.dir);
  const report = buildReport(opts.repo, prs, () => Date.now(), config.weights);
  await writeReport(opts.dir, report);
  return report;
}
