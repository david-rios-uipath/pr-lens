export class TokenMissingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TokenMissingError";
  }
}

export class ReportNotFoundError extends Error {
  constructor(public path: string) {
    super(`Report not found at ${path}`);
    this.name = "ReportNotFoundError";
  }
}

export class GithubApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public rateLimitResetAt?: string,
  ) {
    super(message);
    this.name = "GithubApiError";
  }
}

export class RepoResolutionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RepoResolutionError";
  }
}
