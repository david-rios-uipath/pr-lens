import { repoKey, runScan } from "@pr-lens/core";
import type { Command } from "commander";
import { fail } from "../fail";
import { formatProgressEvent } from "../progress";
import { resolveRepo } from "../repo";

export function registerScan(program: Command): void {
  program
    .command("scan")
    .description("Scan open PRs for a repo and write a report")
    .option("--repo <owner/name>", "GitHub repo to scan")
    .action(async (options: { repo?: string }) => {
      try {
        const dir = process.cwd();
        const repo = await resolveRepo(options.repo === undefined ? { dir } : { flag: options.repo, dir });
        const report = await runScan({
          repo,
          dir,
          onProgress: (event) => {
            process.stderr.write(`${formatProgressEvent(event)}\n`);
          },
        });
        console.log(`Scanned ${String(report.prs.length)} open PRs in ${repo} → .pr-lens/reports/${repoKey(repo)}.json`);
      } catch (err) {
        fail(err);
      }
    });
}
