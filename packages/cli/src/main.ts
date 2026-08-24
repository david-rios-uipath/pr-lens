#!/usr/bin/env node
import { Command } from "commander";
import { registerBrief } from "./commands/brief";
import { registerComponents } from "./commands/components";
import { registerLs } from "./commands/ls";
import { registerScan } from "./commands/scan";
import { registerWeb } from "./commands/web";
import { fail } from "./fail";

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
