import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";

export const configSchema = z.object({
  repo: z
    .string()
    .regex(/^[^/]+\/[^/]+$/)
    .optional(),
  weights: z.record(z.number()).optional(),
});

export type PrLensConfig = z.infer<typeof configSchema>;

function isErrno(err: unknown): err is NodeJS.ErrnoException {
  return err instanceof Error && "code" in err;
}

function configPath(dir: string): string {
  return join(dir, ".pr-lens", "config.json");
}

export async function readConfig(dir: string): Promise<PrLensConfig> {
  const path = configPath(dir);
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (err) {
    if (isErrno(err) && err.code === "ENOENT") {
      return {};
    }
    throw err;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new Error(`Invalid config file at ${path}: not valid JSON (${reason})`);
  }

  const result = configSchema.safeParse(parsed);
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("; ");
    throw new Error(`Invalid config file at ${path}: ${issues}`);
  }
  return result.data;
}
