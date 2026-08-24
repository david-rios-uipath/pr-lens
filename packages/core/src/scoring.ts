import type { DimensionScore, FactorBreakdown } from "./report";
import type { PrData } from "./types";

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

export const REVIEWABILITY_FACTORS: readonly Factor[] = [
  diffSizeFactor,
  filesTouchedFactor,
  changeNatureFactor,
  mergeabilityFactor,
  codeComplexityFactor,
];

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
