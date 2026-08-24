import { readReport } from "@pr-lens/core";
import type { Command } from "commander";
import { fail } from "../fail";
import { renderComponents } from "../render";
import { resolveRepo } from "../repo";

export function registerComponents(program: Command): void {
  program
    .command("components")
    .description("List detected components and PR counts")
    .option("--repo <owner/name>", "repo whose report to read")
    .action(async (options: { repo?: string }) => {
      try {
        const dir = process.cwd();
        const repo = await resolveRepo(options.repo === undefined ? { dir } : { flag: options.repo, dir });
        const report = await readReport(dir, repo);
        console.log(renderComponents(report));
      } catch (err) {
        fail(err);
      }
    });
}
