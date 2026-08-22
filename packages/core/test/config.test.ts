import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { configSchema, readConfig } from "../src/config.js";

describe("configSchema", () => {
  it("accepts an empty object", () => {
    expect(configSchema.parse({})).toEqual({});
  });

  it("accepts repo and weights", () => {
    const parsed = configSchema.parse({ repo: "o/r", weights: { diffSize: 0.5 } });
    expect(parsed).toEqual({ repo: "o/r", weights: { diffSize: 0.5 } });
  });

  it("rejects a repo without a slash", () => {
    expect(configSchema.safeParse({ repo: "not-a-repo" }).success).toBe(false);
  });
});

describe("readConfig", () => {
  it("returns {} when the config file is missing", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pr-lens-"));
    await expect(readConfig(dir)).resolves.toEqual({});
  });

  it("reads a valid config file", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pr-lens-"));
    await mkdir(join(dir, ".pr-lens"), { recursive: true });
    await writeFile(join(dir, ".pr-lens", "config.json"), JSON.stringify({ repo: "o/r" }));
    await expect(readConfig(dir)).resolves.toEqual({ repo: "o/r" });
  });

  it("throws a descriptive error for invalid JSON", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pr-lens-"));
    await mkdir(join(dir, ".pr-lens"), { recursive: true });
    await writeFile(join(dir, ".pr-lens", "config.json"), "{ not json");
    await expect(readConfig(dir)).rejects.toThrow(/config/i);
  });

  it("throws a descriptive error for schema violations", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pr-lens-"));
    await mkdir(join(dir, ".pr-lens"), { recursive: true });
    await writeFile(join(dir, ".pr-lens", "config.json"), JSON.stringify({ repo: "bad-repo" }));
    await expect(readConfig(dir)).rejects.toThrow(/config/i);
  });
});
