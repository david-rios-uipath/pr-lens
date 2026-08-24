import { mkdir, readdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { ReportNotFoundError } from "./errors";

function isErrno(err: unknown): err is NodeJS.ErrnoException {
  return err instanceof Error && "code" in err;
}

const ciStatusSchema = z.enum(["SUCCESS", "FAILURE", "PENDING", "NONE"]);
const mergeableSchema = z.enum(["MERGEABLE", "CONFLICTING", "UNKNOWN"]);
const reviewStateSchema = z.enum(["APPROVED", "CHANGES_REQUESTED", "REVIEW_REQUIRED", "NONE"]);

export const factorBreakdownSchema = z.object({
  factor: z.string(),
  weight: z.number(),
  value: z.number(),
  reason: z.string(),
});

export const dimensionScoreSchema = z.object({
  score: z.number(),
  breakdown: z.array(factorBreakdownSchema),
});

export const reportPrSchema = z.object({
  number: z.number(),
  title: z.string(),
  author: z.string(),
  url: z.string(),
  updatedAt: z.string(),
  isDraft: z.boolean(),
  mergeable: mergeableSchema,
  additions: z.number(),
  deletions: z.number(),
  changedFiles: z.number(),
  ci: ciStatusSchema,
  reviewState: reviewStateSchema,
  labels: z.array(z.string()),
  componentPrimary: z.string(),
  componentsSecondary: z.array(z.string()),
  componentShares: z.record(z.number().min(0).max(1)),
  scores: z.record(dimensionScoreSchema),
});

export const reportSchema = z.object({
  repo: z.string(),
  generatedAt: z.string(),
  components: z.array(
    z.object({
      name: z.string(),
      prCount: z.number(),
    }),
  ),
  prs: z.array(reportPrSchema),
});

export type FactorBreakdown = z.infer<typeof factorBreakdownSchema>;
export type DimensionScore = z.infer<typeof dimensionScoreSchema>;
export type ReportPr = z.infer<typeof reportPrSchema>;
export type Report = z.infer<typeof reportSchema>;

export interface ReportSummary {
  repo: string;
  generatedAt: string;
}

const REPO_FORMAT = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

export function isValidRepoName(repo: string): boolean {
  const [owner, name] = repo.split("/");
  return REPO_FORMAT.test(repo) && owner !== "." && owner !== ".." && name !== "." && name !== "..";
}

/** Filesystem key for a repo: "owner/name" → "owner__name". */
export function repoKey(repo: string): string {
  if (!isValidRepoName(repo)) {
    throw new Error(`Invalid repo name: ${repo} (expected owner/name)`);
  }
  const [owner, name] = repo.split("/");
  return `${owner ?? ""}__${name ?? ""}`;
}

function legacyReportPath(dir: string): string {
  return join(dir, ".pr-lens", "report.json");
}

function reportsDir(dir: string): string {
  return join(dir, ".pr-lens", "reports");
}

function reportPath(dir: string, repo: string): string {
  return join(reportsDir(dir), `${repoKey(repo)}.json`);
}

async function readReportFile(path: string): Promise<Report> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (err) {
    if (isErrno(err) && err.code === "ENOENT") {
      throw new ReportNotFoundError(path);
    }
    throw err;
  }

  const parsed: unknown = JSON.parse(raw);
  const result = reportSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(`Invalid report file at ${path}: ${result.error.message}`);
  }
  return result.data;
}

export async function readReport(dir: string, repo: string): Promise<Report> {
  try {
    return await readReportFile(reportPath(dir, repo));
  } catch (err) {
    if (!(err instanceof ReportNotFoundError)) {
      throw err;
    }
    // Fall back to the pre-multi-repo report.json if it belongs to this repo.
    try {
      const legacy = await readReportFile(legacyReportPath(dir));
      if (legacy.repo === repo) {
        return legacy;
      }
    } catch {
      // ignore — surface the keyed-path error below
    }
    throw err;
  }
}

export async function writeReport(dir: string, report: Report): Promise<void> {
  const finalPath = reportPath(dir, report.repo);
  const tmpPath = `${finalPath}.tmp`;
  await mkdir(reportsDir(dir), { recursive: true });
  await writeFile(tmpPath, JSON.stringify(report, null, 2));
  await rename(tmpPath, finalPath);
}

/** Lists stored reports (including a legacy report.json), newest first. */
export async function listReports(dir: string): Promise<ReportSummary[]> {
  const summaries = new Map<string, ReportSummary>();

  let entries: string[] = [];
  try {
    entries = await readdir(reportsDir(dir));
  } catch (err) {
    if (!isErrno(err) || err.code !== "ENOENT") {
      throw err;
    }
  }

  for (const entry of entries.filter((e) => e.endsWith(".json"))) {
    try {
      const report = await readReportFile(join(reportsDir(dir), entry));
      summaries.set(report.repo, { repo: report.repo, generatedAt: report.generatedAt });
    } catch {
      // skip unreadable/malformed files — one bad report shouldn't hide the rest
    }
  }

  try {
    const legacy = await readReportFile(legacyReportPath(dir));
    if (!summaries.has(legacy.repo)) {
      summaries.set(legacy.repo, { repo: legacy.repo, generatedAt: legacy.generatedAt });
    }
  } catch {
    // no legacy report — nothing to add
  }

  return [...summaries.values()].sort(
    (a, b) => new Date(b.generatedAt).getTime() - new Date(a.generatedAt).getTime(),
  );
}
