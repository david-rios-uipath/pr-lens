import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { ReportNotFoundError } from "./errors.js";

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

function reportPath(dir: string): string {
  return join(dir, ".pr-lens", "report.json");
}

export async function readReport(dir: string): Promise<Report> {
  const path = reportPath(dir);
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

export async function writeReport(dir: string, report: Report): Promise<void> {
  const finalPath = reportPath(dir);
  const tmpPath = `${finalPath}.tmp`;
  await mkdir(join(dir, ".pr-lens"), { recursive: true });
  await writeFile(tmpPath, JSON.stringify(report, null, 2));
  await rename(tmpPath, finalPath);
}
