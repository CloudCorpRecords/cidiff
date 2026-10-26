/**
 * cidiff types.
 *
 * A DiffReport compares the check runs on a PR head commit against the
 * check runs on its base commit and classifies every check. The point is
 * the classification, not the raw failure count: a PR with 12 failing
 * checks where 11 were already failing on the base has one real problem.
 */

export interface CheckRunSummary {
  id: number;
  name: string;
  status: string;
  conclusion: string | null;
  htmlUrl?: string;
}

export type Category =
  | "introduced"
  | "pre-existing"
  | "external"
  | "fixed"
  | "passing"
  | "indeterminate"
  | "pending";

export interface CheckVerdict {
  name: string;
  category: Category;
  headConclusion: string | null;
  baseConclusion: string | null;
  detail: string;
  htmlUrl?: string;
  /**
   * True when the completed check runs for this check on one commit
   * disagree with each other (at least one pass and at least one fail on
   * the same commit). That is flaky evidence: a single outcome from an
   * unstable side cannot support a confident attribution, so failing
   * verdicts that would rest on it are withheld as indeterminate.
   */
  flaky?: boolean;
  /** Completed real check runs seen for this check on the head commit. */
  headAttempts?: number;
  /** Completed real check runs seen for this check on the base commit. */
  baseAttempts?: number;
}

export interface DiffReport {
  repo: string;
  prNumber?: number;
  headSha: string;
  baseSha: string;
  verdicts: CheckVerdict[];
  counts: Record<Category, number>;
  /** Failing checks the PR introduced. The CLI exit code is 1 when > 0. */
  introduced: number;
  /** Verdicts whose evidence is flaky (runs on one commit disagreed). */
  flaky: number;
  /**
   * Report level caveats, e.g. no check evidence exists on the head commit
   * at all, or CI is waiting on maintainer approval (fork PRs). A report
   * with warnings must be read with them, never as a clean bill of health.
   */
  warnings: string[];
  checkedAt: string;
}

/** Minimal fetch surface so tests can inject fixtures. */
export interface FetchResponse {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
  text(): Promise<string>;
}

export type FetchFn = (
  url: string,
  init?: { headers?: Record<string, string> },
) => Promise<FetchResponse>;
