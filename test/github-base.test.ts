import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { githubApiBase, fetchCheckRuns, VERSION } from "../src/diff.js";
import type { FetchFn } from "../src/types.js";

const ENV_KEYS = ["CIDIFF_GITHUB_BASE_URL", "GITHUB_BASE_URL"];
let saved: Record<string, string | undefined> = {};

beforeEach(() => {
  saved = {};
  for (const k of ENV_KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe("githubApiBase (PT-1)", () => {
  it("defaults to https://api.github.com", () => {
    assert.equal(githubApiBase(), "https://api.github.com");
  });

  it("honors CIDIFF_GITHUB_BASE_URL and strips trailing slashes", () => {
    process.env.CIDIFF_GITHUB_BASE_URL = "http://127.0.0.1:8792/";
    assert.equal(githubApiBase(), "http://127.0.0.1:8792");
  });

  it("falls back to GITHUB_BASE_URL; tool env wins", () => {
    process.env.GITHUB_BASE_URL = "http://127.0.0.1:9999";
    assert.equal(githubApiBase(), "http://127.0.0.1:9999");
    process.env.CIDIFF_GITHUB_BASE_URL = "http://127.0.0.1:8792";
    assert.equal(githubApiBase(), "http://127.0.0.1:8792");
  });

  it("API calls actually go to the configured base URL", async () => {
    process.env.CIDIFF_GITHUB_BASE_URL = "http://proxy.invalid:8792";
    const seen: string[] = [];
    const stub = (async (url: string | URL) => {
      seen.push(String(url));
      return {
        ok: true,
        status: 200,
        json: async () => ({ check_runs: [] }),
      };
    }) as unknown as FetchFn;
    await fetchCheckRuns(stub, "o", "r", "abc123");
    assert.equal(seen.length, 1);
    assert.ok(seen[0].startsWith("http://proxy.invalid:8792/repos/o/r/commits/abc123/check-runs"), seen[0]);
  });

  it("release version is 0.1.1", () => {
    assert.equal(VERSION, "0.1.1");
  });
});
