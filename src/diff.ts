/**
 * cidiff core: classify a PR's check runs against its base.
 *
 * Classification order matters and follows the order proven in Greenlight's
 * CI triage: external blockers first (deploy previews, hosted services, and
 * checks waiting on maintainer approval are not code failures), then
 * pre-existing (failing on both head and base), then introduced (passing on
 * base, failing on head). A failing head check with no usable base evidence
 * is "indeterminate", never guessed into either bucket.
 */
import type {
  Category,
  CheckRunSummary,
  CheckVerdict,
  DiffReport,
  FetchFn,
} from "./types.js";

export const VERSION = "0.1.0";

const GH_API = "https://api.github.com";

const FAILING = new Set(["failure", "timed_out"]);
const PASSING = new Set(["success"]);
const BLOCKED = new Set(["action_required"]);

/**
 * Check names that indicate a hosted or deploy surface rather than the
 * repo's own test suite. Matched case-insensitively as substrings.
 */
export const EXTERNAL_PATTERNS = [
  "vercel",
  "netlify",
  "cloudflare",
  "render",
  "railway",
  "heroku",
  "deploy preview",
  "preview deployment",
  "deployment",
  "fly.io",
];

export function isExternalName(name: string): boolean {
  const lower = name.toLowerCase();
  return EXTERNAL_PATTERNS.some((p) => lower.includes(p));
}

export function parseRepoRef(ref: string): { owner: string; repo: string } {
  const m = /^([^/\s]+)\/([^/\s]+)$/.exec(ref.trim().replace(/\.git$/, ""));
  if (!m) throw new Error(`Expected owner/repo, got: ${ref}`);
  return { owner: m[1], repo: m[2] };
}

function ghHeaders(token?: string): Record<string, string> {
  const h: Record<string, string> = {
    "User-Agent": `cidiff/${VERSION}`,
    Accept: "application/vnd.github+json",
  };
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}

/** Keep only the newest run per check name (highest id wins). */
export function dedupeRuns(runs: CheckRunSummary[]): Map<string, CheckRunSummary> {
  const map = new Map<string, CheckRunSummary>();
  for (const run of runs) {
    const existing = map.get(run.name);
    if (!existing || run.id > existing.id) map.set(run.name, run);
  }
  return map;
}

function classifyOne(
  name: string,
  head: CheckRunSummary | undefined,
  base: CheckRunSummary | undefined,
  headWorkflowRan: boolean,
): CheckVerdict {
  const headConclusion = head?.conclusion ?? null;
  const baseConclusion = base?.conclusion ?? null;
  const htmlUrl = head?.htmlUrl ?? base?.htmlUrl;

  if (head && head.status !== "completed") {
    return {
      name,
      category: "pending",
      headConclusion,
      baseConclusion,
      detail: `Head run is ${head.status}, no conclusion yet`,
      htmlUrl,
    };
  }

  // A check that fails on base and has no head run at all. If the head has
  // real check runs, the workflow system ran and this check is gone:
  // fixed, removed, or renamed. If the head has NO check runs (a few app
  // statuses like Snyk do not prove the workflow ran), CI probably never
  // ran (the classic fork PR approval gate), and calling this "fixed"
  // would be inventing a result: it is indeterminate.
  if (!head && base) {
    if (baseConclusion && FAILING.has(baseConclusion)) {
      if (!headWorkflowRan) {
        return {
          name,
          category: "indeterminate",
          headConclusion: null,
          baseConclusion,
          detail:
            "Failing on base, and the head commit has no check runs, so there is nothing to compare. CI may not have run on the head yet",
          htmlUrl,
        };
      }
      return {
        name,
        category: "fixed",
        headConclusion: null,
        baseConclusion,
        detail: "Failing on base, no run on head (fixed, removed, or renamed)",
        htmlUrl,
      };
    }
    // Base-only and not failing: no signal about the PR. No verdict is
    // emitted for these (classifyRuns filters them out).
    return {
      name,
      category: "passing",
      headConclusion: null,
      baseConclusion,
      detail: "Only present on base, not failing there",
      htmlUrl,
    };
  }

  if (!head) {
    return {
      name,
      category: "indeterminate",
      headConclusion: null,
      baseConclusion: null,
      detail: "No run on head or base",
    };
  }

  if (headConclusion && BLOCKED.has(headConclusion)) {
    return {
      name,
      category: "external",
      headConclusion,
      baseConclusion,
      detail: "Waiting on maintainer approval to run (action_required). Not a code failure",
      htmlUrl,
    };
  }

  if (headConclusion && FAILING.has(headConclusion)) {
    if (isExternalName(name)) {
      return {
        name,
        category: "external",
        headConclusion,
        baseConclusion,
        detail: "Hosted or deploy surface failure, matched by check name. Not the PR's test suite",
        htmlUrl,
      };
    }
    if (baseConclusion && FAILING.has(baseConclusion)) {
      return {
        name,
        category: "pre-existing",
        headConclusion,
        baseConclusion,
        detail: "Failing on both head and base with the same check name",
        htmlUrl,
      };
    }
    if (baseConclusion && PASSING.has(baseConclusion)) {
      return {
        name,
        category: "introduced",
        headConclusion,
        baseConclusion,
        detail: "Passing on base, failing on head. This one is the PR's to fix",
        htmlUrl,
      };
    }
    if (!base) {
      return {
        name,
        category: "indeterminate",
        headConclusion,
        baseConclusion: null,
        detail: "Failing on head, but no base run exists for this check, so pre-existing cannot be ruled out",
        htmlUrl,
      };
    }
    return {
      name,
      category: "indeterminate",
      headConclusion,
      baseConclusion,
      detail: `Failing on head; base run concluded ${baseConclusion ?? "without a conclusion"}, which is not usable pass/fail evidence`,
      htmlUrl,
    };
  }

  if (headConclusion && PASSING.has(headConclusion)) {
    if (baseConclusion && FAILING.has(baseConclusion)) {
      return {
        name,
        category: "fixed",
        headConclusion,
        baseConclusion,
        detail: "Failing on base, passing on head. The PR fixed this check",
        htmlUrl,
      };
    }
    return {
      name,
      category: "passing",
      headConclusion,
      baseConclusion,
      detail: "Passing on head",
      htmlUrl,
    };
  }

  return {
    name,
    category: "indeterminate",
    headConclusion,
    baseConclusion,
    detail: `Head run concluded ${headConclusion ?? "without a conclusion"} (neutral, skipped, cancelled, or stale), not usable as pass or fail`,
    htmlUrl,
  };
}

/** Pure classification: head runs vs base runs. */
export function classifyRuns(
  headRuns: CheckRunSummary[],
  baseRuns: CheckRunSummary[],
  headCheckRunCount: number = headRuns.length,
): CheckVerdict[] {
  const head = dedupeRuns(headRuns);
  const base = dedupeRuns(baseRuns);
  const headWorkflowRan = headCheckRunCount > 0;
  const names = new Set<string>([...head.keys(), ...base.keys()]);
  const verdicts = [...names]
    .sort((a, b) => a.localeCompare(b))
    .map((name) => classifyOne(name, head.get(name), base.get(name), headWorkflowRan))
    .filter((v) => {
      // Drop base-only non-failing checks: they say nothing about the PR
      // and only inflate the passing count.
      const headRun = head.get(v.name);
      if (!headRun && v.category === "passing") return false;
      return true;
    });
  const order: Category[] = [
    "introduced",
    "external",
    "pre-existing",
    "indeterminate",
    "pending",
    "fixed",
    "passing",
  ];
  verdicts.sort(
    (a, b) =>
      order.indexOf(a.category) - order.indexOf(b.category) ||
      a.name.localeCompare(b.name),
  );
  return verdicts;
}

export function buildReport(
  repo: string,
  headSha: string,
  baseSha: string,
  verdicts: CheckVerdict[],
  prNumber?: number,
  warnings: string[] = [],
): DiffReport {
  const counts = {
    introduced: 0,
    "pre-existing": 0,
    external: 0,
    fixed: 0,
    passing: 0,
    indeterminate: 0,
    pending: 0,
  } as Record<Category, number>;
  for (const v of verdicts) counts[v.category]++;
  return {
    repo,
    prNumber,
    headSha,
    baseSha,
    verdicts,
    counts,
    introduced: counts.introduced,
    warnings,
    checkedAt: new Date().toISOString(),
  };
}

/**
 * Map legacy commit statuses (the Statuses API) into check run shape.
 * Some CI systems and apps (Snyk, CodeRabbit, older setups) report this
 * way instead of as check runs; ignoring them loses real evidence.
 * Synthetic id 0 means a real check run of the same name always wins
 * the dedupe.
 */
export function mapStatuses(
  statuses: Array<{ context?: string; state?: string; target_url?: string }>,
): CheckRunSummary[] {
  return statuses
    .filter((s) => typeof s.context === "string")
    .map((s) => {
      const state = s.state ?? "";
      if (state === "success") {
        return { id: 0, name: s.context as string, status: "completed", conclusion: "success", htmlUrl: s.target_url };
      }
      if (state === "failure" || state === "error") {
        return { id: 0, name: s.context as string, status: "completed", conclusion: "failure", htmlUrl: s.target_url };
      }
      return { id: 0, name: s.context as string, status: "in_progress", conclusion: null, htmlUrl: s.target_url };
    });
}

async function ghJson(
  fetchFn: FetchFn,
  path: string,
  token?: string,
): Promise<Record<string, unknown>> {
  const res = await fetchFn(`${GH_API}${path}`, { headers: ghHeaders(token) });
  if (!res.ok) {
    throw new Error(`GitHub API ${res.status} for ${path}`);
  }
  return (await res.json()) as Record<string, unknown>;
}

export async function fetchCheckRuns(
  fetchFn: FetchFn,
  owner: string,
  repo: string,
  sha: string,
  token?: string,
): Promise<CheckRunSummary[]> {
  const data = await ghJson(
    fetchFn,
    `/repos/${owner}/${repo}/commits/${sha}/check-runs?per_page=100`,
    token,
  );
  const runs = Array.isArray(data.check_runs) ? data.check_runs : [];
  return runs.map((raw) => {
    const r = raw as Record<string, unknown>;
    return {
      id: typeof r.id === "number" ? r.id : 0,
      name: typeof r.name === "string" ? r.name : "unknown",
      status: typeof r.status === "string" ? r.status : "completed",
      conclusion: typeof r.conclusion === "string" ? r.conclusion : null,
      htmlUrl: typeof r.html_url === "string" ? r.html_url : undefined,
    };
  });
}

export async function fetchStatuses(
  fetchFn: FetchFn,
  owner: string,
  repo: string,
  sha: string,
  token?: string,
): Promise<CheckRunSummary[]> {
  const res = await fetchFn(`${GH_API}/repos/${owner}/${repo}/commits/${sha}/status`, {
    headers: ghHeaders(token),
  });
  if (!res.ok) return [];
  const data = (await res.json().catch(() => null)) as { statuses?: unknown[] } | null;
  if (!data || !Array.isArray(data.statuses)) return [];
  return mapStatuses(data.statuses as Array<{ context?: string; state?: string; target_url?: string }>);
}

export interface Evidence {
  /** Real check runs only. Zero here means the workflow system produced nothing. */
  checkRuns: CheckRunSummary[];
  /** Legacy commit statuses (apps and older CI). */
  statuses: CheckRunSummary[];
  /** Merged evidence used for classification. */
  all: CheckRunSummary[];
}

/** All check evidence for a commit: check runs plus legacy statuses. */
export async function fetchEvidence(
  fetchFn: FetchFn,
  owner: string,
  repo: string,
  sha: string,
  token?: string,
): Promise<Evidence> {
  const [checkRuns, statuses] = await Promise.all([
    fetchCheckRuns(fetchFn, owner, repo, sha, token).catch(() => [] as CheckRunSummary[]),
    fetchStatuses(fetchFn, owner, repo, sha, token),
  ]);
  return { checkRuns, statuses, all: [...statuses, ...checkRuns] };
}

/**
 * When a commit has no check runs, its check suites explain why. The big
 * one: fork PR suites sit at action_required until a maintainer approves
 * the workflow run, which means CI has not produced evidence yet.
 */
export async function fetchHeadWarnings(
  fetchFn: FetchFn,
  owner: string,
  repo: string,
  headSha: string,
  headCheckRunCount: number,
  headStatusCount: number,
  token?: string,
): Promise<string[]> {
  if (headCheckRunCount > 0) return [];
  const warnings: string[] = [
    headStatusCount > 0
      ? `No check runs on head commit ${headSha.slice(0, 12)} (only ${headStatusCount} commit status(es)). The workflow system has produced no evidence to diff against; base check failures below are indeterminate, not fixed.`
      : `No check runs or commit statuses found on head commit ${headSha.slice(0, 12)}. There is no head CI evidence to diff against; base failures below are indeterminate, not fixed.`,
  ];
  try {
    const data = await ghJson(
      fetchFn,
      `/repos/${owner}/${repo}/commits/${headSha}/check-suites?per_page=20`,
      token,
    );
    const suites = Array.isArray(data.check_suites) ? data.check_suites : [];
    const blocked = suites.filter((s) => {
      const suite = s as Record<string, unknown>;
      return suite.conclusion === "action_required" || suite.status === "action_required";
    });
    if (blocked.length > 0) {
      warnings.push(
        `${blocked.length} check suite(s) on the head commit are action_required: CI is waiting on maintainer approval to run (typical for fork PRs). The failures cannot be classified until CI actually runs.`,
      );
    } else if (suites.length > 0) {
      warnings.push(
        `${suites.length} check suite(s) exist on the head commit but produced no check runs yet.`,
      );
    }
  } catch {
    /* warnings are best-effort; the empty-evidence warning already stands */
  }
  return warnings;
}

export interface PrInfo {
  headSha: string;
  baseSha: string;
  title: string;
}

export async function fetchPr(
  fetchFn: FetchFn,
  owner: string,
  repo: string,
  prNumber: number,
  token?: string,
): Promise<PrInfo> {
  const data = await ghJson(fetchFn, `/repos/${owner}/${repo}/pulls/${prNumber}`, token);
  const head = data.head as Record<string, unknown>;
  const base = data.base as Record<string, unknown>;
  return {
    headSha: String(head.sha),
    baseSha: String(base.sha),
    title: typeof data.title === "string" ? data.title : "",
  };
}

export async function diffPr(
  fetchFn: FetchFn,
  repoRef: string,
  prNumber: number,
  token?: string,
): Promise<DiffReport> {
  const { owner, repo } = parseRepoRef(repoRef);
  const tok = token ?? process.env.GITHUB_TOKEN;
  const pr = await fetchPr(fetchFn, owner, repo, prNumber, tok);
  const [headEv, baseEv] = await Promise.all([
    fetchEvidence(fetchFn, owner, repo, pr.headSha, tok),
    fetchEvidence(fetchFn, owner, repo, pr.baseSha, tok),
  ]);
  const warnings = await fetchHeadWarnings(
    fetchFn, owner, repo, pr.headSha, headEv.checkRuns.length, headEv.statuses.length, tok,
  );
  return buildReport(
    `${owner}/${repo}`,
    pr.headSha,
    pr.baseSha,
    classifyRuns(headEv.all, baseEv.all, headEv.checkRuns.length),
    prNumber,
    warnings,
  );
}

export async function diffRuns(
  fetchFn: FetchFn,
  repoRef: string,
  headSha: string,
  baseSha: string,
  token?: string,
): Promise<DiffReport> {
  const { owner, repo } = parseRepoRef(repoRef);
  const tok = token ?? process.env.GITHUB_TOKEN;
  const [headEv, baseEv] = await Promise.all([
    fetchEvidence(fetchFn, owner, repo, headSha, tok),
    fetchEvidence(fetchFn, owner, repo, baseSha, tok),
  ]);
  const warnings = await fetchHeadWarnings(
    fetchFn, owner, repo, headSha, headEv.checkRuns.length, headEv.statuses.length, tok,
  );
  return buildReport(
    `${owner}/${repo}`,
    headSha,
    baseSha,
    classifyRuns(headEv.all, baseEv.all, headEv.checkRuns.length),
    undefined,
    warnings,
  );
}

export function renderReport(report: DiffReport): string {
  const lines: string[] = [];
  const label = report.prNumber
    ? `${report.repo} PR #${report.prNumber}`
    : report.repo;
  lines.push(
    `cidiff ${label}: ${report.introduced} introduced, ${report.counts["pre-existing"]} pre-existing, ${report.counts.external} external, ${report.counts.fixed} fixed, ${report.counts.indeterminate} indeterminate, ${report.counts.pending} pending, ${report.counts.passing} passing`,
  );
  for (const w of report.warnings) lines.push(`  [WARNING] ${w}`);
  for (const v of report.verdicts) {
    if (v.category === "passing") continue;
    lines.push(`  [${v.category.toUpperCase()}] ${v.name}: ${v.detail}`);
  }
  const passing = report.verdicts.filter((v) => v.category === "passing");
  if (passing.length > 0) {
    lines.push(`  [PASSING] ${passing.map((v) => v.name).join(", ")}`);
  }
  if (report.introduced > 0) {
    lines.push(
      `Verdict: ${report.introduced} failing check(s) were introduced by this PR. Fix those; the pre-existing and external failures are not this PR's fault.`,
    );
  } else {
    lines.push(
      "Verdict: no introduced failures. Any failing checks are pre-existing, external, or unproven either way (indeterminate).",
    );
  }
  return lines.join("\n");
}
