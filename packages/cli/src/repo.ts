import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readConfig, RepoResolutionError } from "@pr-lens/core";

const execFileAsync = promisify(execFile);

const SSH_REMOTE = /^git@github\.com:([^/]+)\/(.+?)(?:\.git)?$/;
const HTTPS_REMOTE = /^https:\/\/github\.com\/([^/]+)\/(.+?)(?:\.git)?$/;

function parseRemote(url: string): string | undefined {
  const match = SSH_REMOTE.exec(url) ?? HTTPS_REMOTE.exec(url);
  if (match?.[1] === undefined || match[2] === undefined) {
    return undefined;
  }
  return `${match[1]}/${match[2]}`;
}

async function gitRemoteRepo(dir: string): Promise<string | undefined> {
  try {
    const { stdout } = await execFileAsync("git", ["remote", "get-url", "origin"], { cwd: dir });
    return parseRemote(stdout.trim());
  } catch {
    return undefined;
  }
}

export async function resolveRepo(opts: {
  flag?: string;
  dir: string;
  env?: Record<string, string | undefined>;
}): Promise<string> {
  if (opts.flag !== undefined && opts.flag.length > 0) {
    return opts.flag;
  }

  const config = await readConfig(opts.dir);
  if (config.repo !== undefined) {
    return config.repo;
  }

  const fromRemote = await gitRemoteRepo(opts.dir);
  if (fromRemote !== undefined) {
    return fromRemote;
  }

  throw new RepoResolutionError(
    "Could not determine repo. Pass --repo <owner/name>, set repo in .pr-lens/config.json, or run inside a git repo with a github.com origin remote.",
  );
}
