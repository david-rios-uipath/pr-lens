import { execFile } from "node:child_process";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { RepoResolutionError } from "@pr-lens/core";
import { describe, expect, it } from "vitest";
import { resolveRepo } from "../src/repo.js";

const execFileAsync = promisify(execFile);

async function makeTmpDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "pr-lens-cli-"));
}

async function initGitWithRemote(dir: string, url: string): Promise<void> {
  await execFileAsync("git", ["init"], { cwd: dir });
  await execFileAsync("git", ["remote", "add", "origin", url], { cwd: dir });
}

describe("resolveRepo", () => {
  it("prefers the flag over everything else", async () => {
    const dir = await makeTmpDir();
    await mkdir(join(dir, ".pr-lens"), { recursive: true });
    await writeFile(join(dir, ".pr-lens", "config.json"), JSON.stringify({ repo: "config/owner" }));
    await expect(resolveRepo({ flag: "flag/owner", dir })).resolves.toBe("flag/owner");
  });

  it("falls back to the config file when no flag is given", async () => {
    const dir = await makeTmpDir();
    await mkdir(join(dir, ".pr-lens"), { recursive: true });
    await writeFile(join(dir, ".pr-lens", "config.json"), JSON.stringify({ repo: "config/owner" }));
    await expect(resolveRepo({ dir })).resolves.toBe("config/owner");
  });

  it("parses an ssh git remote when no flag or config is set", async () => {
    const dir = await makeTmpDir();
    await initGitWithRemote(dir, "git@github.com:acme/widgets.git");
    await expect(resolveRepo({ dir })).resolves.toBe("acme/widgets");
  });

  it("parses an https git remote when no flag or config is set", async () => {
    const dir = await makeTmpDir();
    await initGitWithRemote(dir, "https://github.com/acme/widgets.git");
    await expect(resolveRepo({ dir })).resolves.toBe("acme/widgets");
  });

  it("parses an https git remote without a .git suffix", async () => {
    const dir = await makeTmpDir();
    await initGitWithRemote(dir, "https://github.com/acme/widgets");
    await expect(resolveRepo({ dir })).resolves.toBe("acme/widgets");
  });

  it("rejects with RepoResolutionError when no source is available", async () => {
    const dir = await makeTmpDir();
    await expect(resolveRepo({ dir })).rejects.toBeInstanceOf(RepoResolutionError);
  });
});
