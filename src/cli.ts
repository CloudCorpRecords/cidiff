#!/usr/bin/env node
/**
 * cidiff CLI.
 *
 *   cidiff pr owner/repo <pr-number> [--json]
 *   cidiff runs owner/repo --head <sha> --base <sha> [--json]
 *   cidiff mcp
 *
 * Exit codes: 0 no introduced failures, 1 introduced failures found, 2 error.
 * GITHUB_TOKEN is optional and only raises GitHub API rate limits.
 *
 * Note the honest limit: the base comparison uses the check runs recorded
 * for the PR's base commit (the base branch tip in the PR object). A check
 * with no base run is reported indeterminate, never guessed.
 */
import { diffPr, diffRuns, renderReport, VERSION } from "./diff.js";

function usage(): never {
  console.error(`Usage:
  cidiff pr owner/repo <pr-number> [--json]
  cidiff runs owner/repo --head <sha> --base <sha> [--json]
  cidiff mcp
  cidiff --version`);
  process.exit(2);
}

function flag(args: string[], name: string): string | undefined {
  const idx = args.indexOf(name);
  return idx >= 0 && idx + 1 < args.length ? args[idx + 1] : undefined;
}

function has(args: string[], name: string): boolean {
  return args.includes(name);
}

async function main(): Promise<void> {
  const [cmd, ...rest] = process.argv.slice(2);
  if (cmd === "--version" || cmd === "-v") {
    console.log(VERSION);
    return;
  }
  if (cmd === "mcp") {
    await import("./mcp.js");
    return;
  }
  if (!cmd) usage();
  try {
    if (cmd === "pr") {
      const [repoRef, prRaw] = rest.filter((a) => !a.startsWith("--"));
      const prNumber = Number(prRaw);
      if (!repoRef || !Number.isInteger(prNumber) || prNumber <= 0) usage();
      const report = await diffPr(fetch, repoRef, prNumber);
      if (has(rest, "--json")) console.log(JSON.stringify(report, null, 2));
      else console.log(renderReport(report));
      process.exit(report.introduced > 0 ? 1 : 0);
    } else if (cmd === "runs") {
      const [repoRef] = rest.filter((a) => !a.startsWith("--"));
      const head = flag(rest, "--head");
      const base = flag(rest, "--base");
      if (!repoRef || !head || !base) usage();
      const report = await diffRuns(fetch, repoRef, head, base);
      if (has(rest, "--json")) console.log(JSON.stringify(report, null, 2));
      else console.log(renderReport(report));
      process.exit(report.introduced > 0 ? 1 : 0);
    } else {
      usage();
    }
  } catch (err) {
    console.error(`error: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(2);
  }
}

void main();
