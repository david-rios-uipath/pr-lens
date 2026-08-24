export interface PrFile {
  path: string;
  additions: number;
  deletions: number;
}

export type CiStatus = "SUCCESS" | "FAILURE" | "PENDING" | "NONE";

export type Mergeable = "MERGEABLE" | "CONFLICTING" | "UNKNOWN";

export type ReviewState = "APPROVED" | "CHANGES_REQUESTED" | "REVIEW_REQUIRED" | "NONE";

export interface PrData {
  number: number;
  title: string;
  author: string;
  url: string;
  createdAt: string;
  updatedAt: string;
  isDraft: boolean;
  mergeable: Mergeable;
  additions: number;
  deletions: number;
  changedFiles: number;
  approvals: number;
  ci: CiStatus;
  reviewState: ReviewState;
  labels: string[];
  files: PrFile[];
}
