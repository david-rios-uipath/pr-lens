# pr-lens

Prioritize open pull requests for review. Scans a GitHub repo's open PRs,
scores them with a heuristic, groups them into components by changed paths,
and gives you a CLI and a local web UI to browse the results.

## Install

```
pnpm install && pnpm build
```

This builds `packages/core`, `packages/cli`, and `apps/web`. The CLI binary
lives at `packages/cli/dist/main.js` (`bin: pr-lens`).

Run it via:

- `pnpm pr-lens <command>` from the repo root (a convenience script wired to
  `node packages/cli/dist/main.js`), or
- `node packages/cli/dist/main.js <command>` from any directory, or
- `pnpm link --global` inside `packages/cli` to get a `pr-lens` binary on
  your `PATH`.

Commands operate on the current working directory: they look for
`.pr-lens/reports/` and `.pr-lens/config.json` relative to `process.cwd()`.
Reports are stored per repo (one file per `owner/name`), so a single
directory can hold reports for several repos side by side; pass `--repo` to
pick one, or let it resolve from config / the git remote.

## Token setup

pr-lens talks to the GitHub GraphQL and REST APIs. It resolves a token in
this order:

1. `GITHUB_TOKEN` environment variable, if set and non-empty.
2. `gh auth token` (requires `gh auth login` to have been run).

The token is never written to disk or to the report file.

## Commands

### `scan`

Fetches all open PRs for a repo, scores them, derives components, and writes
`.pr-lens/report.json`.

```
pr-lens scan --repo UiPath/flow-workbench
```

- `--repo <owner/name>` — optional. If omitted, the repo is resolved from
  `.pr-lens/config.json`'s `repo` field, then from the `origin` git remote of
  the current directory (github.com only). If none of those resolve, it
  fails with instructions.

Output:

```
Scanned 3 open PRs in UiPath/flow-workbench → .pr-lens/reports/UiPath__flow-workbench.json
```

### `ls`

Lists PRs from the last scan, ranked by score.

```
pr-lens ls
```

```
UiPath/flow-workbench · generated 11 h ago
#    rev   pr      title                                              component      diff           ci       reasons
1    88    #412    Fix flaky retry logic in scan poller               packages/core  +18/-6         SUCCESS  24 lines changed · CI green
2    85    #405    Update README for new scan flags                   docs           +40/-10        NONE     50 lines changed · 1 files
3    32    #398    Rework component affinity scoring for monorepo la… packages/core  +620/-210      FAILURE  mixed changes · changes requested
```

Options:

- `--repo <owner/name>` — repo whose report to read (default: same
  resolution order as `scan`).
- `--component <name>` — filter to PRs whose primary or secondary component
  matches (see [Components](#components-1) below).
- `--sort <dim>` — `reviewability` (default) or `affinity`. `affinity`
  requires `--component` and sorts by that component's share of the diff.
- `--limit <n>` — max rows to show (default `20`).
- `--json` — print JSON instead of a table (for scripts/agents).
- `--stale-after <dur>` — re-scan first if the report is older than this
  duration (e.g. `15m`, `2h`, `30s`); otherwise `ls` only ever reads the
  existing report.

Example with affinity sort:

```
pr-lens ls --component packages/core --sort affinity
```

```
UiPath/flow-workbench · generated 11 h ago
#    rev   aff   pr      title                                              component      diff           ci       reasons
1    88    100   #412    Fix flaky retry logic in scan poller               packages/core  +18/-6         SUCCESS  24 lines changed · CI green
2    32    70    #398    Rework component affinity scoring for monorepo la… packages/core  +620/-210      FAILURE  mixed changes · changes requested
```

`--json` output shape (one PR shown, trimmed):

```json
{
  "generatedAt": "2026-08-21T18:00:00.000Z",
  "prs": [
    {
      "number": 412,
      "title": "Fix flaky retry logic in scan poller",
      "author": "alicedev",
      "componentPrimary": "packages/core",
      "componentShares": { "packages/core": 1 },
      "scores": {
        "reviewability": {
          "score": 88,
          "breakdown": [
            { "factor": "diffSize", "weight": 0.25, "value": 0.92, "reason": "24 lines changed" }
          ]
        }
      }
    }
  ]
}
```

### `components`

Lists detected components and how many open PRs touch each. Accepts
`--repo <owner/name>` like `ls`.

```
pr-lens components
```

```
packages/core  2
apps/web  1
docs  1
```

Components are derived from changed file paths (top-level directory, or
`<root>/<name>` for nested roots like `src/`, `packages/`, `apps/`, `libs/`,
`lib/`), then merged when two path-derived keys always co-occur across PRs.
A PR's primary component is whichever component has the largest share of its
changed lines (≥35%); anything below that threshold falls back to
`cross-cutting`. Secondary components are anything else with ≥15% share.

### `brief <number>`

Generates an agent-ready review packet for a single PR: description, score
breakdown, CI checks, review comments, linked issues, changed files, and the
full diff. Fetches live from GitHub (not from the cached report).

```
pr-lens brief 412 --md
```

```markdown
# PR #412: Fix flaky retry logic in scan poller
**alicedev** · main←fix/retry-poller · https://github.com/UiPath/flow-workbench/pull/412

## Description

Fixes a race in the scan poller's retry backoff.

## Score

Overall: **88**

| Factor | Weight | Value | Reason |
| --- | --- | --- | --- |
| diffSize | 0.25 | 0.92 | 24 lines changed |
| ... | | | |

## CI

- [x] build (SUCCESS)

## Review comments

_none_

## Linked issues

_none_

## Changed files

- packages/core/src/scan.ts (+12/-4)

## Diff

​```diff
...
​```
```

- `--json` — print the same data (plus the cached `reviewability` score, if a
  report exists) as JSON instead of markdown.
- `--md` — markdown output (default; explicit flag is a no-op).

`brief` needs a resolved repo (same resolution order as `scan`) and a
GitHub token; it does not require a prior `scan`, but if that repo's stored
report contains the PR number, its cached `reviewability` score is attached
to the output.

### `web`

Serves the built web UI (`apps/web/dist`) plus a small JSON API over the
current directory's stored reports.

```
pr-lens web --port 4310
```

```
pr-lens web on http://localhost:4310
```

- `--port <n>` — port to listen on (default `4310`).
- `GET /api/repos` — lists stored reports (`{ repos: [{ repo, generatedAt }] }`),
  newest first.
- `GET /api/report[?repo=owner/name]` — returns that repo's cached report
  (default: repo resolved the same way as `scan`), or 404 if none exists yet.
- `POST /api/scan[?repo=owner/name]` — runs a fresh scan for that repo and
  returns the new report. Concurrent scan requests for the same repo are
  coalesced into a single in-flight scan.

If `apps/web/dist` hasn't been built, static asset requests return 503 with
a hint to run `pnpm --filter @pr-lens/web build` (covered by `pnpm build` at
the root).

The UI is a dark, GitHub-styled table (built with Vite + React +
`@primer/react`) that reads `/api/report` on load and has a Refresh button
that calls `POST /api/scan`. When more than one repo has a stored report,
the header title becomes a menu for switching between them.

## File formats

### `.pr-lens/reports/<owner>__<name>.json`

Written by `scan` (one file per repo), read by `ls`, `components`, and `web`.
Validated against a zod schema (`@pr-lens/core`'s `reportSchema`) on read. A
pre-multi-repo `.pr-lens/report.json` is still read as a fallback for the
repo it belongs to, so existing reports keep working.

```json
{
  "repo": "owner/name",
  "generatedAt": "2026-08-21T18:00:00.000Z",
  "components": [{ "name": "packages/core", "prCount": 2 }],
  "prs": [
    {
      "number": 412,
      "title": "...",
      "author": "...",
      "url": "...",
      "updatedAt": "...",
      "isDraft": false,
      "mergeable": "MERGEABLE",
      "additions": 18,
      "deletions": 6,
      "changedFiles": 2,
      "ci": "SUCCESS",
      "reviewState": "REVIEW_REQUIRED",
      "labels": ["bug"],
      "componentPrimary": "packages/core",
      "componentsSecondary": [],
      "componentShares": { "packages/core": 1 },
      "scores": {
        "reviewability": {
          "score": 88,
          "breakdown": [
            { "factor": "diffSize", "weight": 0.25, "value": 0.92, "reason": "24 lines changed" }
          ]
        }
      }
    }
  ]
}
```

`scores` currently holds one dimension, `reviewability` (0–100, a weighted
average of the factors below). The second dimension, **componentAffinity**,
isn't stored per PR — it's computed on demand from `componentShares` for
whichever `--component` you filter on (`ls --sort affinity`, or
`affinityScore()` from `@pr-lens/core`).

The five reviewability factors (each a `{ factor, weight, value, reason }`
entry in `breakdown`):

| Factor | Default weight | What it measures |
| --- | --- | --- |
| `diffSize` | 0.25 | Total lines changed (smaller = higher) |
| `filesTouched` | 0.15 | Number of changed files (fewer = higher) |
| `changeNature` | 0.10 | Docs-only / test-only / config-only vs. mixed |
| `mergeability` | 0.05 | Merge conflict state |
| `codeComplexity` | 0 | **Reserved placeholder — algorithm TBD.** Always contributes value `0` at weight `0`, so it never affects the score. |

### `.pr-lens/config.json`

Optional. Read by `scan`, `ls --stale-after`, `brief`, and `web` (via repo
resolution).

```json
{
  "repo": "owner/name",
  "weights": {
    "diffSize": 0.3,
    "filesTouched": 0.25
  }
}
```

- `repo` — optional `owner/name` override, checked before falling back to
  the git remote.
- `weights` — optional partial override of factor weights by name (any of
  the five factor names above). Unspecified factors keep their defaults.
  Weights don't need to sum to 1; `reviewability` is a weighted average over
  factors with weight > 0.

Missing config file is not an error — it's treated as `{}`.

## Development

From the repo root:

```
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```
