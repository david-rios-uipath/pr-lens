#!/usr/bin/env node
import { Command } from "commander";
import { registerBrief } from "./commands/brief.js";
import { registerComponents } from "./commands/components.js";
import { registerLs } from "./commands/ls.js";
import { registerScan } from "./commands/scan.js";
import { registerWeb } from "./commands/web.js";
import { fail } from "./fail.js";

const program = new Command();
program.name("pr-lens").description("Prioritize open pull requests for review");

registerScan(program);
registerLs(program);
registerComponents(program);
registerBrief(program);
registerWeb(program);

try {
  await program.parseAsync(process.argv);
} catch (err) {
  fail(err);
}
