import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { readReport, runScan } from "@pr-lens/core";
import type { Command } from "commander";
import { fail } from "../fail.js";
import { resolveRepo } from "../repo.js";
import { createServer } from "../server.js";

const DEFAULT_PORT = 4310;

function resolveWebDist(): string | null {
  const dist = fileURLToPath(new URL("../../../../apps/web/dist", import.meta.url));
  return existsSync(dist) ? dist : null;
}

export function registerWeb(program: Command): void {
  program
    .command("web")
    .description("Run a local web server for browsing reports")
    .option("--port <n>", "port to listen on", String(DEFAULT_PORT))
    .action((options: { port: string }) => {
      const port = Number(options.port);
      if (!Number.isInteger(port) || port <= 0) {
        fail(new Error(`Invalid --port value: ${options.port}`));
        return;
      }

      const dir = process.cwd();
      const server = createServer({
        dir,
        webDist: resolveWebDist(),
        scan: async () => {
          const repo = await resolveRepo({ dir });
          return runScan({ repo, dir });
        },
        readReport: () => readReport(dir),
      });

      server.listen(port, "127.0.0.1", () => {
        console.log(`pr-lens web on http://localhost:${String(port)}`);
      });
    });
}
