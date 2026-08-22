import type { DimensionScore, FactorBreakdown } from "./report.js";
import type { PrData } from "./types.js";

export interface FactorResult {
  value: number;
  reason: string;
}

export interface Factor {
  name: string;
  weight: number;
  evaluate(pr: PrData): FactorResult;
}

const diffSizeFactor: Factor = {
  name: "diffSize",
  weight: 0.25,
  evaluate(pr) {
    const total = pr.additions + pr.deletions;
    const value = 1 - Math.min(1, Math.log10(1 + total) / Math.log10(2001));
    return { value, reason: `${String(total)} lines changed` };
  },
};

const filesTouchedFactor: Factor = {
  name: "filesTouched",
  weight: 0.15,
  evaluate(pr) {
    const value = 1 - Math.min(1, Math.log10(1 + pr.changedFiles) / Math.log10(51));
    return { value, reason: `${String(pr.changedFiles)} files` };
  },
};

const ciStatusFactor: Factor = {
  name: "ciStatus",
  weight: 0.2,
  evaluate(pr) {
    switch (pr.ci) {
      case "SUCCESS":
        return { value: 1, reason: "CI green" };
      case "NONE":
        return { value: 0.6, reason: "no CI" };
      case "PENDING":
        return { value: 0.3, reason: "CI pending" };
      case "FAILURE":
        return { value: 0, reason: "CI failing" };
    }
  },
};

const reviewStateFactor: Factor = {
  name: "reviewState",
  weight: 0.15,
  evaluate(pr) {
    if (pr.isDraft) return { value: 0, reason: "draft" };
    if (pr.reviewState === "CHANGES_REQUESTED") {
      return { value: 0.2, reason: "changes requested" };
    }
    if (pr.approvals > 0) {
      return { value: 1, reason: `${String(pr.approvals)} approval(s)` };
    }
    return { value: 0.7, reason: "awaiting review" };
  },
};

function makeAgeFactor(now: () => number): Factor {
  return {
    name: "age",
    weight: 0.1,
    evaluate(pr) {
      const hours = (now() - new Date(pr.updatedAt).getTime()) / (1000 * 60 * 60);
      if (hours < 1) return { value: 0.8, reason: "very fresh" };
      if (hours < 24) return { value: 1, reason: "updated today" };
      if (hours < 72) return { value: 0.8, reason: "updated this week" };
      if (hours < 168) return { value: 0.6, reason: "updated within 7d" };
      return { value: 0.3, reason: "stale" };
    },
  };
}

const DOCS_EXT = /\.(md|mdx|txt)$/i;
const TEST_DIR = /(^|\/)(tests?|__tests__|spec)\//;
const TEST_EXT = /\.(test|spec)\.[cm]?[jt]sx?$/;
const CONFIG_EXT = /\.(json|ya?ml|toml)$/;

const changeNatureFactor: Factor = {
  name: "changeNature",
  weight: 0.1,
  evaluate(pr) {
    const files = pr.files;
    if (files.length === 0) {
      return { value: 0.4, reason: "mixed changes" };
    }
    const isDocs = files.every((f) => DOCS_EXT.test(f.path) || f.path.startsWith("docs/"));
    if (isDocs) return { value: 1, reason: "docs-only" };

    const isTests = files.every((f) => TEST_DIR.test(f.path) || TEST_EXT.test(f.path));
    if (isTests) return { value: 1, reason: "test-only" };

    const isConfig = files.every((f) => CONFIG_EXT.test(f.path)) && pr.changedFiles <= 5;
    if (isConfig) return { value: 1, reason: "config-only" };

    return { value: 0.4, reason: "mixed changes" };
  },
};

const mergeabilityFactor: Factor = {
  name: "mergeability",
  weight: 0.05,
  evaluate(pr) {
    switch (pr.mergeable) {
      case "MERGEABLE":
        return { value: 1, reason: "mergeable" };
      case "UNKNOWN":
        return { value: 0.7, reason: "mergeability unknown" };
      case "CONFLICTING":
        return { value: 0, reason: "has conflicts" };
    }
  },
};

const codeComplexityFactor: Factor = {
  name: "codeComplexity",
  weight: 0,
  evaluate() {
    return { value: 0, reason: "not implemented — algorithm TBD" };
  },
};

export function makeReviewabilityFactors(now: () => number): readonly Factor[] {
  return [
    diffSizeFactor,
    filesTouchedFactor,
    ciStatusFactor,
    reviewStateFactor,
    makeAgeFactor(now),
    changeNatureFactor,
    mergeabilityFactor,
    codeComplexityFactor,
  ];
}

export const REVIEWABILITY_FACTORS: readonly Factor[] = makeReviewabilityFactors(() => Date.now());

export function evaluateDimension(factors: readonly Factor[], pr: PrData): DimensionScore {
  const breakdown: FactorBreakdown[] = factors.map((f) => {
    const result = f.evaluate(pr);
    return { factor: f.name, weight: f.weight, value: result.value, reason: result.reason };
  });

  let weightedSum = 0;
  let weightTotal = 0;
  for (const entry of breakdown) {
    if (entry.weight > 0) {
      weightedSum += entry.weight * entry.value;
      weightTotal += entry.weight;
    }
  }

  const score = weightTotal > 0 ? Math.round((100 * weightedSum) / weightTotal) : 0;
  return { score, breakdown };
}

export function scorePr(
  pr: PrData,
  weightOverrides?: Record<string, number>,
): Record<string, DimensionScore> {
  const factors = REVIEWABILITY_FACTORS.map((f) => ({
    ...f,
    weight: weightOverrides?.[f.name] ?? f.weight,
  }));
  return { reviewability: evaluateDimension(factors, pr) };
}

export function affinityScore(shares: Record<string, number>, component: string): number {
  return Math.round((shares[component] ?? 0) * 100);
}
