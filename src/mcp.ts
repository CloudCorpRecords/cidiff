/**
 * cidiff MCP server. Tools: diff_pr_ci, diff_ci_runs.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { diffPr, diffRuns, VERSION } from "./diff.js";

const server = new McpServer({ name: "cidiff", version: VERSION });

server.tool(
  "diff_pr_ci",
  "Compare a GitHub PR's check runs against its base commit and classify every check: introduced (passing on base, failing on head), pre-existing (failing on both), external (deploy or hosted surface, or waiting on maintainer approval), fixed, passing, indeterminate (no usable base evidence), or pending. Answers the question every red PR actually asks: which of these failures are mine?",
  {
    repo: z.string().describe("Repo in owner/repo form, e.g. usebruno/bruno"),
    pr: z.number().describe("Pull request number"),
  },
  async ({ repo, pr }) => {
    const report = await diffPr(fetch, repo, pr);
    return { content: [{ type: "text" as const, text: JSON.stringify(report, null, 2) }] };
  },
);

server.tool(
  "diff_ci_runs",
  "Compare check runs between two commits in a repo (head vs base) with the same classification as diff_pr_ci, for cases where you have SHAs instead of a PR number.",
  {
    repo: z.string().describe("Repo in owner/repo form"),
    headSha: z.string().describe("Head commit SHA"),
    baseSha: z.string().describe("Base commit SHA"),
  },
  async ({ repo, headSha, baseSha }) => {
    const report = await diffRuns(fetch, repo, headSha, baseSha);
    return { content: [{ type: "text" as const, text: JSON.stringify(report, null, 2) }] };
  },
);

async function main(): Promise<void> {
  await server.connect(new StdioServerTransport());
}

void main();
