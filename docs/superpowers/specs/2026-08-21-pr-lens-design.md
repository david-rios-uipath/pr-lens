# pr-lens — Design Spec

**Date:** 2026-08-21
**Status:** Approved design, pre-implementation

## Purpose

A fully local tool that ranks a repo's open PRs by how quick/easy they are to
review, so a reviewer (human or coding agent) can direct their energy at the
easiest wins. One repo at a time (e.g. `UiPath/flow-workbench`). No hosting,
no stored credentials.

## Decisions (settled during brainstorming)

- **Entirely local.** No hosted components. GitHub token comes from
  `GITHUB_TOKEN` env or `gh auth token`; it is never persisted or sent to a
  browser.
- **Pure-heuristic scoring.** No LLM calls. Deterministic, explainable.
- **Report-centric data flow.** The CLI generates a local report; the web app
  renders it. The web app has no GitHub access of its own.
- **Components auto-derived** from PR file paths — no manual config required.
- **pnpm** workspaces monorepo; strict TypeScript; Node 20+.
- **@primer/react** for the web UI — GitHub look, dark theme default.
- **One repo at a time**, resolved from flag → config → cwd git remote.

## Architecture

pnpm monorepo, three workspace packages:

```
packages/core   — reusable library: GitHub client, scoring, components, report
packages/cli    — `pr-lens` binary; also serves the web app locally
apps/web        — Vite + React + @primer/react UI
```

### Data flow

```
GitHub GraphQL API → core (fetch → score → cluster) → .pr-lens/report.json
                                                          ↓            ↓
                                                    pr-lens ls    pr-lens web → browser
```

1. `pr-lens scan` fetches open PRs (one paginated GraphQL query: metadata,
   changed files with per-file additions/deletions, CI rollup, review states,
   labels, draft/mergeable status).
2. Core scores each PR, derives components, writes a single report JSON to
   `.pr-lens/report.json`.
3. Consumers read the report. Staleness is explicit: both UIs show
   "generated N minutes ago"; refresh = re-run scan. Nothing polls in the
   background.

## Core library (`packages/core`)

Modules:

- `github.ts` — GraphQL client. Token resolution: `GITHUB_TOKEN` env, else
  `gh auth token`. Never persisted.
- `scoring.ts` — dimension registry + pure engine. Each **scoring
  dimension** is a named set of weighted factors producing
  `{ score: 0–100, breakdown }`. The engine runs once per dimension per PR.
- `components.ts` — component map derivation from file paths.
- `report.ts` — report schema (zod) + read/write helpers.

### Scoring dimensions

Scores are multi-dimensional. Two dimensions ship initially; new ones just
register in the dimension list — no schema change.

- **`reviewability`** (default sort) — how quick/easy the PR is to review.
  Factors below.
- **`componentAffinity`** — how concentrated the PR is in a given component:
  the share of the PR's changed lines inside that component's paths. It is
  context-dependent (affinity *to the component being filtered by*), so the
  report stores a per-PR `componentShares` map (`component → 0–1`) and the
  dimension is evaluated against the active component filter. These shares
  also define the primary/secondary component mapping quantitatively
  (primary = largest share).

### Reviewability factors

Each factor contributes a weighted amount; the breakdown names every factor
so both UIs can explain the ranking.

| Factor | Signal |
| --- | --- |
| `diffSize` | Log-scaled additions+deletions; small PRs score far higher |
| `filesTouched` | Fewer files / fewer directories = more focused |
| `ciStatus` | Green boosts; failing or pending drags heavily |
| `reviewState` | Not draft, no changes-requested; part-approved PRs get a "finish the job" boost |
| `age` | Recently updated beats stale; very fresh (<1h) slightly dampened |
| `changeNature` | Docs-only / test-only / config-only / pure-rename PRs get a big boost |
| `mergeability` | Conflicted PRs penalized |
| `codeComplexity` | **Placeholder — not implemented.** Registered in the factor registry, weights constant, and report schema, but returns a neutral contribution with weight 0. Algorithm TBD (user researching separately). Implementing it later is a one-function swap + weight change; no schema migration. Could alternatively graduate into its own dimension. |

Weights live in one exported constant, overridable via optional
`.pr-lens/config.json`. No tuning machinery beyond that.

### Component derivation

At scan time, cluster the paths touched by open PRs:

- Root candidate components at meaningful directory prefixes (e.g.
  second-level dirs under `src/`, or package roots in a monorepo).
- Merge prefixes that consistently co-occur within the same PRs.
- Component name = the shared path prefix.
- Each PR maps to one primary component (most-touched paths) plus any
  secondary ones. A PR touching everything maps to `cross-cutting`.

No configuration needed; adapts to any repo layout.

### Report schema (shape)

```jsonc
{
  "repo": "UiPath/flow-workbench",
  "generatedAt": "…ISO…",
  "components": [{ "name": "…", "prCount": 3 }],
  "prs": [
    {
      "number": 123, "title": "…", "author": "…", "url": "…",
      "updatedAt": "…", "isDraft": false, "mergeable": "MERGEABLE",
      "additions": 120, "deletions": 45, "changedFiles": 4,
      "ci": "SUCCESS", "reviewState": "…", "labels": ["…"],
      "componentPrimary": "…", "componentsSecondary": ["…"],
      "componentShares": { "flow-editor": 0.8, "shared-ui": 0.2 },
      "scores": {
        "reviewability": {
          "score": 87,
          "breakdown": [{ "factor": "diffSize", "weight": 0.2, "value": 0.9, "reason": "…" }]
        }
      }
    }
  ]
}
```

Validated with zod on read and write.

## CLI (`packages/cli`, binary `pr-lens`)

- `pr-lens scan [--repo owner/name]` — fetch, score, write
  `.pr-lens/report.json`. Repo resolution: flag → `.pr-lens/config.json` →
  cwd git remote.
- `pr-lens ls [--component <name>] [--sort reviewability|affinity] [--limit N]
  [--json] [--stale-after 15m]` — ranked table: rank, score, PR #, title,
  component, size, CI, top scoring reasons. `--sort affinity` requires
  `--component` (affinity is relative to a component). `--json` emits all
  score dimensions for agents. `--stale-after` auto-rescans if the report is
  older.
- `pr-lens components` — derived components with PR counts (valid filter
  values for humans and agents).
- `pr-lens brief <number> [--json|--md]` — everything an agent needs to
  review the PR: full metadata, description, the diff itself, changed-file
  tree, CI check results, existing review comments, linked issues, score
  breakdown. Markdown default (prompt-ready), `--json` structured.
- `pr-lens web [--port 4310]` — serve the built web app + report, plus:
  - `GET /api/report` — current report JSON
  - `POST /api/scan` — re-run scan server-side (token stays server-side)

Error UX: every failure mode maps to a specific, actionable message — missing
token → "run `gh auth login` or set GITHUB_TOKEN"; missing report → "run
`pr-lens scan`"; rate limit → includes reset time; bad repo → says what was
tried.

## Web app (`apps/web`)

- **Stack:** Vite + React + TypeScript + @primer/react.
  `data-color-mode="dark"` default, light/dark toggle.
- **Layout:** single list page modeled on GitHub's PR list. Header: repo
  name, "generated N min ago", Refresh button. Left rail / filter row:
  component filters with PR counts. Main column: ranked PR list.
- **PR row:** rank + color-graded score badge; title/number/author/updated-at
  in GitHub's list style; CI status icon; review state; size (`+120 −45` and
  S/M/L/XL chip); component labels; top 2–3 scoring reasons as subtle text.
  Clicking the row opens the PR on github.com in a new tab.
- **Controls:** component filter, free-text title filter, sort
  (reviewability default; newest / smallest; **component affinity** when a
  component filter is active), per-row expandable score-breakdown popover
  showing every factor including the inert `codeComplexity` placeholder.
- **Data:** fetches `/api/report`; Refresh calls `POST /api/scan` then
  reloads. No token, no GitHub calls, no browser-persisted state.

## Testing

Vitest across the workspace.

- **core:** table-driven scoring tests (fixture PRs → expected breakdowns);
  component clustering against synthetic path sets (monorepo layout, flat
  layout, cross-cutting PR); report schema round-trip; GitHub client against
  recorded GraphQL fixtures — no live API in tests.
- **cli:** smoke tests against a fixture report.
- **web:** component tests for row/filter logic. No e2e harness (local tool,
  YAGNI).

## Error handling

- Core throws typed errors; the CLI translates them into actionable messages.
- Scan is all-or-nothing: a partial fetch never overwrites a good report.
- The web server returns scan errors as JSON; the UI shows a flash banner.

## Repo hygiene

- `.pr-lens/` gitignored (reports are local artifacts).
- Node 20+, strict TypeScript, shared tsconfig/eslint at the root.
- **Linting is strict and type-checked:** typescript-eslint with
  `strictTypeChecked` config; unnecessary casts are errors
  (`@typescript-eslint/no-unnecessary-type-assertion: error`, plus
  `no-unsafe-*` and `no-explicit-any` as errors). Lint must pass in CI/tests
  with zero warnings (`--max-warnings 0`).
- pnpm for all package management.

## Out of scope (explicitly)

- Hosting of any kind (was considered — UiPath Coded Web App / JS Function
  BFF / centralized poller — all rejected in favor of fully local).
- LLM-based scoring.
- Multi-repo views.
- `codeComplexity` algorithm (placeholder only; separate research).
