import { affinityScore, readReport, runScan } from "@pr-lens/core";
import type { Command } from "commander";
import { fail } from "../fail.js";
import type { LsOptions } from "../render.js";
import { renderTable, selectPrs, staleMs, timeAgo } from "../render.js";
import { resolveRepo } from "../repo.js";

interface LsCliOptions {
  component?: string;
  sort: string;
  limit: string;
  json?: boolean;
  staleAfter?: string;
}

function parseSort(sort: string): LsOptions["sort"] {
  if (sort === "reviewability" || sort === "affinity") {
    return sort;
  }
  throw new Error(`Invalid --sort value: ${sort} (expected "reviewability" or "affinity")`);
}

export function registerLs(program: Command): void {
  program
    .command("ls")
    .description("List open PRs ranked by score")
    .option("--component <name>", "filter to PRs touching this component")
    .option("--sort <dim>", "reviewability or affinity", "reviewability")
    .option("--limit <n>", "max rows to show", "20")
    .option("--json", "print JSON instead of a table")
    .option("--stale-after <dur>", "re-scan if the report is older than this (e.g. 15m, 2h)")
    .action(async (options: LsCliOptions) => {
      try {
        const dir = process.cwd();
        let report = await readReport(dir);

        if (options.staleAfter !== undefined) {
          const maxAgeMs = staleMs(options.staleAfter);
          const ageMs = Date.now() - new Date(report.generatedAt).getTime();
          if (ageMs > maxAgeMs) {
            const repo = await resolveRepo({ dir });
            report = await runScan({ repo, dir });
          }
        }

        const opts: LsOptions = {
          ...(options.component === undefined ? {} : { component: options.component }),
          sort: parseSort(options.sort),
          limit: Number(options.limit),
        };
        const selected = selectPrs(report, opts);

        if (options.json === true) {
          const component = opts.component;
          const prs =
            component === undefined
              ? selected
              : selected.map((pr) => ({ ...pr, affinity: affinityScore(pr.componentShares, component) }));
          console.log(JSON.stringify({ generatedAt: report.generatedAt, prs }, null, 2));
          return;
        }

        console.log(`${report.repo} · generated ${timeAgo(report.generatedAt, Date.now())}`);
        console.log(renderTable(selected, opts));
      } catch (err) {
        fail(err);
      }
    });
}
