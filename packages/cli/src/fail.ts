import { GithubApiError, ReportNotFoundError, RepoResolutionError, TokenMissingError } from "@pr-lens/core";

export function messageFor(err: unknown): string {
  if (err instanceof TokenMissingError) {
    return err.message;
  }
  if (err instanceof ReportNotFoundError) {
    return `No report found at ${err.path}. Run \`pr-lens scan\` first.`;
  }
  if (err instanceof GithubApiError) {
    if (err.rateLimitResetAt !== undefined) {
      return `GitHub rate limit hit (resets ${err.rateLimitResetAt}).`;
    }
    return `GitHub API error (${String(err.status)}): ${err.message}`;
  }
  if (err instanceof RepoResolutionError) {
    return err.message;
  }
  return String(err);
}

export function fail(err: unknown): never {
  console.error(messageFor(err));
  process.exit(1);
}
