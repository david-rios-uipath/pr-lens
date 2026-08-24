import type { DimensionScore } from "@pr-lens/core";
import {
  fetchBrief,
  ReportNotFoundError,
  readReport,
  renderBriefMarkdown,
  resolveToken,
  sanitizeMultiline,
} from "@pr-lens/core";
import type { Command } from "commander";
import { fail } from "../fail";
import { resolveRepo } from "../repo";

interface BriefCliOptions {
  json?: boolean;
  md?: boolean;
}

async function findScore(dir: string, repo: string, number: number): Promise<DimensionScore | undefined> {
  try {
    const report = await readReport(dir, repo);
    return report.prs.find((pr) => pr.number === number)?.scores.reviewability;
  } catch (err) {
    if (err instanceof ReportNotFoundError) {
      return undefined;
    }
    throw err;
  }
}

export function registerBrief(program: Command): void {
  program
    .command("brief <number>")
    .description("Generate an agent-ready review packet for a single PR")
    .option("--json", "print JSON instead of markdown")
    .option("--md", "print markdown (default)")
    .action(async (numberArg: string, options: BriefCliOptions) => {
      try {
        const dir = process.cwd();
        const number = Number(numberArg);
        if (!Number.isInteger(number) || number <= 0) {
          throw new Error(`Invalid PR number: ${numberArg}`);
        }

        const repo = await resolveRepo({ dir });
        const token = await resolveToken();
        const brief = await fetchBrief(repo, number, token);
        const score = await findScore(dir, repo, number);

        if (options.json === true) {
          console.log(JSON.stringify({ ...brief, score }, null, 2));
          return;
        }

        console.log(sanitizeMultiline(renderBriefMarkdown(brief, score)));
      } catch (err) {
        fail(err);
      }
    });
}
