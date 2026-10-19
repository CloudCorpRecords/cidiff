# cidiff

**Which of these CI failures are actually yours?**

A red PR with 12 failing checks usually has one real problem. The rest were already failing on the base branch, belong to a deploy preview service, or are waiting on a maintainer to approve the workflow run. Today you find that out by clicking through every check twice, once on the PR and once on the base, and comparing by eye.

cidiff does that comparison for you. It reads the check runs and commit statuses on the PR head commit and on its base commit, and classifies every check:

| category | meaning |
| --- | --- |
| `introduced` | Passing on base, failing on head. This one is the PR's to fix |
| `pre-existing` | Failing on both head and base with the same check name |
| `external` | A hosted or deploy surface (Vercel, Netlify, Cloudflare, and friends, matched by check name), or a check waiting on maintainer approval (`action_required`) |
| `fixed` | Failing on base, passing on head, or gone while other head checks ran |
| `passing` | Passing on head |
| `indeterminate` | Failing, but there is no usable base evidence to prove it either way |
| `pending` | The head run has not finished |

Exit code 1 when introduced failures exist, 0 otherwise, so it drops straight into a CI gate or a maintainer's triage script.

## The honesty rules

cidiff was extracted from the CI triage inside [Greenlight](https://github.com/CloudCorpRecords/greenlight), where it classified 89 failing checks across 46 open PRs in one sweep and found zero introduced. Getting that number right depends on refusing to guess:

- **No base evidence means indeterminate, never a verdict.** A failing head check with no base run is reported as unproven, in both directions.
- **Base failures are only "fixed" when the head actually ran checks.** On day one, dogfooding against a real fork PR (usebruno/bruno #9569) showed the trap: the PR's check suites were stuck at `action_required`, waiting for a maintainer to approve the workflow, so the head commit had zero check runs. A naive differ reported every base failure as fixed and every base pass as passing. cidiff detects the empty head, reads the check suites, and says in plain warnings: CI has not run on this head, these failures cannot be classified yet.
- **Legacy commit statuses count as evidence.** Snyk, CodeRabbit, and older CI systems report through the Statuses API, not check runs. cidiff merges both, with real check runs winning on name collisions.
- **External blockers classify first.** A failing Vercel preview is not a test failure, and a check that needs maintainer approval is not a code failure. Both are reported as external before any base comparison happens.

## Usage

### CLI

```bash
# Classify a PR's checks against its base
npx @reneturcios/cidiff pr usebruno/bruno 9569

# Machine readable output
npx @reneturcios/cidiff pr owner/repo 123 --json

# Compare two commits directly
npx @reneturcios/cidiff runs owner/repo --head <sha> --base <sha>
```

Example output (the fork PR case above, real output):

```
cidiff usebruno/bruno PR #9569: 0 introduced, 0 pre-existing, 0 external, 0 fixed, 6 indeterminate, 0 pending, 2 passing
  [WARNING] No check runs on head commit 885c6fafed1e (only 2 commit status(es)). The workflow system has produced no evidence to diff against; base check failures below are indeterminate, not fixed.
  [WARNING] 3 check suite(s) on the head commit are action_required: CI is waiting on maintainer approval to run (typical for fork PRs). The failures cannot be classified until CI actually runs.
  [INDETERMINATE] Unit Tests (Linux): Failing on base, and the head commit has no check runs, so there is nothing to compare. CI may not have run on the head yet
  [PASSING] CodeRabbit, security/snyk (Bruno)
Verdict: no introduced failures. Any failing checks are pre-existing, external, or unproven either way (indeterminate).
```

Known limit, stated plainly: the base comparison uses the check evidence recorded for the PR's base commit (the base branch tip stored in the PR object), and checks are matched by exact name. A renamed check looks like a removal plus an addition. Both limits are visible in the output rather than hidden.

Set `GITHUB_TOKEN` for the higher authenticated GitHub API rate limit. No other credentials are needed for public repos.

### MCP server

Add to your MCP client config:

```json
{
  "mcpServers": {
    "cidiff": {
      "command": "npx",
      "args": ["-y", "@reneturcios/cidiff", "mcp"]
    }
  }
}
```

Tools:

- `diff_pr_ci`: repo plus PR number, returns the full classified report as JSON.
- `diff_ci_runs`: repo plus head and base SHAs, same classification without a PR.

### Docker

```bash
docker run -i ghcr.io/cloudcorprecords/cidiff mcp
docker run --rm ghcr.io/cloudcorprecords/cidiff pr owner/repo 123
```

## The toolkit

cidiff is Wave 1, package 2 of a planned family of small, single-purpose developer tools by the same author, all built the same way: one bin that serves a CLI and an MCP server, deterministic checks with evidence, no invented answers. Its sibling [shipcheck](https://github.com/CloudCorpRecords/shipcheck) verifies finished releases, and it verifies cidiff's own releases in return.

- [greenlight](https://github.com/CloudCorpRecords/greenlight): pre-flight checks for open-source contributions: is this issue actually landable?
- [shipcheck](https://github.com/CloudCorpRecords/shipcheck): release verification: git tag, release, npm, MCP Registry, and GHCR must agree, or NO-GO.
- [prwatch](https://github.com/CloudCorpRecords/prwatch): attention report for your open PRs: what needs you right now.
- [claimcheck](https://github.com/CloudCorpRecords/claimcheck): stale-claim states and parked fixes on forks.
- [gatefile](https://github.com/CloudCorpRecords/gatefile): extract hidden contribution gates into machine-readable contribution-gates.json.
- [pkgverdict](https://github.com/CloudCorpRecords/pkgverdict): pre-install verdicts for npm packages: GO, RISKY, FAKE, or MISSING.

## Development

```bash
npm install
npm run build
npm test   # 19 tests, classification logic runs on fixtures, no network
```

## License

MIT
