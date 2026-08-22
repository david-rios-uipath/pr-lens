import type { PrFile } from "./types.js";

export const CROSS_CUTTING = "cross-cutting";

export interface PrComponentInfo {
  shares: Record<string, number>;
  primary: string;
  secondary: string[];
}

export interface ComponentDerivation {
  components: { name: string; prCount: number }[];
  perPr: Map<number, PrComponentInfo>;
}

const NESTED_ROOTS = new Set(["src", "packages", "apps", "libs", "lib"]);

export function componentKey(path: string): string {
  const segments = path.split("/");
  if (segments.length < 2) {
    return "root";
  }
  const [first, second] = segments;
  if (first !== undefined && second !== undefined && NESTED_ROOTS.has(first) && segments.length >= 3) {
    return `${first}/${second}`;
  }
  return first ?? "root";
}

// Small union-find over component keys, used to merge always-co-occurring keys.
class UnionFind {
  private readonly parent = new Map<string, string>();

  find(key: string): string {
    const parent = this.parent.get(key);
    if (parent === undefined) {
      this.parent.set(key, key);
      return key;
    }
    if (parent === key) {
      return key;
    }
    const root = this.find(parent);
    this.parent.set(key, root);
    return root;
  }

  union(a: string, b: string): void {
    const rootA = this.find(a);
    const rootB = this.find(b);
    if (rootA !== rootB) {
      this.parent.set(rootA, rootB);
    }
  }
}

export function deriveComponents(prs: { number: number; files: PrFile[] }[]): ComponentDerivation {
  // Step 1: per PR, sum changed lines per componentKey, compute raw shares.
  const rawSharesByPr = new Map<number, Map<string, number>>();
  const prsByKey = new Map<string, Set<number>>();

  for (const pr of prs) {
    const linesByKey = new Map<string, number>();
    for (const file of pr.files) {
      const key = componentKey(file.path);
      const lines = Math.max(1, file.additions + file.deletions);
      linesByKey.set(key, (linesByKey.get(key) ?? 0) + lines);
    }
    const total = [...linesByKey.values()].reduce((sum, n) => sum + n, 0);
    const shares = new Map<string, number>();
    for (const [key, lines] of linesByKey) {
      shares.set(key, total > 0 ? lines / total : 0);
      let prSet = prsByKey.get(key);
      if (prSet === undefined) {
        prSet = new Set();
        prsByKey.set(key, prSet);
      }
      prSet.add(pr.number);
    }
    rawSharesByPr.set(pr.number, shares);
  }

  // Step 2: merge keys that always co-occur (appear in >=2 PRs, identical PR sets).
  const uf = new UnionFind();
  const keys = [...prsByKey.keys()];
  for (let i = 0; i < keys.length; i++) {
    for (let j = i + 1; j < keys.length; j++) {
      const a = keys[i];
      const b = keys[j];
      if (a === undefined || b === undefined) continue;
      const prsA = prsByKey.get(a);
      const prsB = prsByKey.get(b);
      if (prsA === undefined || prsB === undefined) continue;
      if (prsA.size < 2 || prsB.size < 2) continue;
      if (setsEqual(prsA, prsB)) {
        uf.union(a, b);
      }
    }
  }

  const mergedNameByRoot = new Map<string, string>();
  const membersByRoot = new Map<string, string[]>();
  for (const key of keys) {
    const root = uf.find(key);
    const members = membersByRoot.get(root) ?? [];
    members.push(key);
    membersByRoot.set(root, members);
  }
  for (const [root, members] of membersByRoot) {
    mergedNameByRoot.set(root, [...members].sort().join("+"));
  }

  const mergedNameByKey = new Map<string, string>();
  for (const key of keys) {
    const root = uf.find(key);
    const name = mergedNameByRoot.get(root);
    if (name !== undefined) {
      mergedNameByKey.set(key, name);
    }
  }

  // Recompute shares per PR under merged names.
  const mergedSharesByPr = new Map<number, Map<string, number>>();
  for (const [prNumber, shares] of rawSharesByPr) {
    const merged = new Map<string, number>();
    for (const [key, share] of shares) {
      const name = mergedNameByKey.get(key) ?? key;
      merged.set(name, (merged.get(name) ?? 0) + share);
    }
    mergedSharesByPr.set(prNumber, merged);
  }

  // Step 3: determine primary/secondary per PR.
  const perPr = new Map<number, PrComponentInfo>();
  const prCountByComponent = new Map<string, number>();

  for (const pr of prs) {
    const shares = mergedSharesByPr.get(pr.number) ?? new Map<string, number>();
    const sharesRecord: Record<string, number> = {};
    for (const [name, share] of shares) {
      sharesRecord[name] = share;
    }

    let topName: string | undefined;
    let topShare = -Infinity;
    for (const [name, share] of shares) {
      if (share > topShare) {
        topShare = share;
        topName = name;
      }
    }

    const primary = topName !== undefined && topShare >= 0.35 ? topName : CROSS_CUTTING;

    const secondary = [...shares.entries()]
      .filter(([name, share]) => name !== primary && share >= 0.15)
      .sort((a, b) => b[1] - a[1])
      .map(([name]) => name);

    perPr.set(pr.number, { shares: sharesRecord, primary, secondary });

    prCountByComponent.set(primary, (prCountByComponent.get(primary) ?? 0) + 1);
    for (const name of secondary) {
      prCountByComponent.set(name, (prCountByComponent.get(name) ?? 0) + 1);
    }
  }

  // Step 4: build the components list.
  const components = [...prCountByComponent.entries()]
    .map(([name, prCount]) => ({ name, prCount }))
    .sort((a, b) => b.prCount - a.prCount || a.name.localeCompare(b.name));

  return { components, perPr };
}

function setsEqual(a: Set<number>, b: Set<number>): boolean {
  if (a.size !== b.size) return false;
  for (const value of a) {
    if (!b.has(value)) return false;
  }
  return true;
}
