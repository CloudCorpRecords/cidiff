# Changelog

## 0.1.2 (2026-10-25)

Flaky test attribution. classifyRuns previously deduped to the newest run per check name and threw the rest away, so a check that passed and failed on the same commit (same code, rerun) was attributed as confidently as a stable one. Now the discarded runs count as evidence: when completed real check runs for a check on one commit disagree, the verdict is flagged `flaky` with head and base attempt counts, comparative attributions resting on an unstable side (introduced, pre-existing, fixed) are withheld as indeterminate, and the report gains a `flaky` total plus a `[FLAKY]` line in the text output. A passing latest outcome keeps its passing verdict, flagged. Legacy commit statuses (synthetic id 0) are not reruns and never count as attempts. The action_required fixtures from the backlog already existed and are unchanged. 31 tests passing.

## 0.1.1 (2026-10-23)

GitHub API base URL can be overridden with `CIDIFF_GITHUB_BASE_URL` (fallback `GITHUB_BASE_URL`, default https://api.github.com) so the tool can run through a local proxy at the authenticated rate limit — the same pattern as Greenlight's `GREENLIGHT_GITHUB_BASE_URL` (PT-1). 24 tests passing.

## 0.1.0 (2026-10-19)

First release. Wave 1, package 2 of the 100-packages plan.

- `cidiff pr owner/repo <number>`: compares check runs and commit statuses on the
  PR head against the base commit and classifies every check as introduced,
  pre-existing, external, fixed, passing, indeterminate, or pending. Exit 1
  when introduced failures exist.
- `cidiff runs owner/repo --head <sha> --base <sha>`: the same diff for raw SHAs.
- MCP server with `diff_pr_ci` and `diff_ci_runs` tools.
- Honesty rules learned from real dogfood on day one: a failing head check with
  no usable base evidence is indeterminate, never guessed. Base failures are
  only called fixed when the head actually has check runs; when a fork PR's
  suites are stuck at action_required (CI waiting on maintainer approval), the
  report says so in plain warnings instead of inventing verdicts. Legacy commit
  statuses (Snyk, CodeRabbit, older CI) count as evidence alongside check runs.
