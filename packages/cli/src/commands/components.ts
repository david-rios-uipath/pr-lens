import { readReport } from "@pr-lens/core";
import type { Command } from "commander";
import { fail } from "../fail.js";
import { renderComponents } from "../render.js";

export function registerComponents(program: Command): void {
  program
    .command("components")
    .description("List detected components and PR counts")
    .action(async () => {
      try {
        const dir = process.cwd();
        const report = await readReport(dir);
        console.log(renderComponents(report));
      } catch (err) {
        fail(err);
      }
    });
}
