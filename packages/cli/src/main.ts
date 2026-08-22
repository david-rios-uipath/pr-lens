#!/usr/bin/env node
import { Command } from "commander";
import { registerScan } from "./commands/scan.js";
import { fail } from "./fail.js";

const program = new Command();
program.name("pr-lens").description("Prioritize open pull requests for review");

registerScan(program);

try {
  await program.parseAsync(process.argv);
} catch (err) {
  fail(err);
}
