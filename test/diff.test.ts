import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildReport, classifyRuns, dedupeRuns, isExternalName, mapStatuses } from "../src/diff.js";
import type { CheckRunSummary } from "../src/types.js";

let seq = 0;
function run(
  name: string,
  conclusion: string | null,
  status = "completed",
): CheckRunSummary {
  return { id: ++seq, name, status, conclusion, htmlUrl: `https://example.com/${name}` };
}

function byName(verdicts: ReturnType<typeof classifyRuns>, name: string) {
  return verdicts.find((v) => v.name === name);
}

describe("classifyRuns", () => {
  it("introduced: passing on base, failing on head", () => {
    const v = classifyRuns([run("test", "failure")], [run("test", "success")]);
    assert.equal(byName(v, "test")?.category, "introduced");
  });

  it("pre-existing: failing on both", () => {
    const v = classifyRuns([run("test", "failure")], [run("test", "failure")]);
    assert.equal(byName(v, "test")?.category, "pre-existing");
  });

  it("external wins over introduced for deploy surfaces", () => {
    const v = classifyRuns(
      [run("Vercel Preview Deployment", "failure")],
      [run("Vercel Preview Deployment", "success")],
    );
    assert.equal(byName(v, "Vercel Preview Deployment")?.category, "external");
  });

  it("action_required is external (waiting on a maintainer), not a failure", () => {
    const v = classifyRuns([run("build", "action_required")], [run("build", "success")]);
    assert.equal(byName(v, "build")?.category, "external");
  });

  it("fixed: failing on base, passing on head", () => {
    const v = classifyRuns([run("lint", "success")], [run("lint", "failure")]);
    assert.equal(byName(v, "lint")?.category, "fixed");
  });

  it("fixed: failing on base, absent on head, while other head checks ran", () => {
    const v = classifyRuns(
      [run("test", "success")],
      [run("old-check", "failure"), run("test", "success")],
    );
    assert.equal(byName(v, "old-check")?.category, "fixed");
  });

  it("indeterminate, NOT fixed: base failures when the head has no evidence at all", () => {
    // The fork PR shape: CI never ran on the head (suites action_required),
    // so zero head runs exist. Calling base failures "fixed" would be
    // inventing a result.
    const v = classifyRuns([], [run("unit", "failure"), run("lint", "success")]);
    assert.equal(byName(v, "unit")?.category, "indeterminate");
    // Base-only passing checks are dropped entirely, not counted as passing.
    assert.equal(byName(v, "lint"), undefined);
  });

  it("base-only passing checks do not inflate the passing count", () => {
    const v = classifyRuns(
      [run("test", "success")],
      [run("test", "success"), run("base-only", "success")],
    );
    assert.equal(byName(v, "base-only"), undefined);
    assert.equal(byName(v, "test")?.category, "passing");
  });

  it("indeterminate: failing on head with no base run (never guessed)", () => {
    const v = classifyRuns([run("new-test", "failure")], []);
    assert.equal(byName(v, "new-test")?.category, "indeterminate");
  });

  it("indeterminate: base evidence is neutral, not pass or fail", () => {
    const v = classifyRuns([run("test", "failure")], [run("test", "skipped")]);
    assert.equal(byName(v, "test")?.category, "indeterminate");
  });

  it("pending: head run has not completed", () => {
    const v = classifyRuns([run("test", null, "in_progress")], [run("test", "success")]);
    assert.equal(byName(v, "test")?.category, "pending");
  });

  it("passing: success on head", () => {
    const v = classifyRuns([run("test", "success")], [run("test", "success")]);
    assert.equal(byName(v, "test")?.category, "passing");
  });

  it("timed_out counts as failing", () => {
    const v = classifyRuns([run("test", "timed_out")], [run("test", "success")]);
    assert.equal(byName(v, "test")?.category, "introduced");
  });
});

describe("dedupeRuns", () => {
  it("newest run per name wins", () => {
    const older = run("test", "failure");
    const newer = { ...run("test", "success"), id: older.id + 100 };
    const map = dedupeRuns([older, newer]);
    assert.equal(map.get("test")?.conclusion, "success");
    const v = classifyRuns([older, newer], [run("test", "success")]);
    assert.equal(byName(v, "test")?.category, "passing");
  });
});

describe("buildReport", () => {
  it("counts categories and exposes the introduced total", () => {
    const verdicts = classifyRuns(
      [run("a", "failure"), run("b", "failure"), run("c", "success")],
      [run("a", "success"), run("b", "failure"), run("c", "success")],
    );
    const report = buildReport("acme/repo", "head", "base", verdicts, 42);
    assert.equal(report.introduced, 1);
    assert.equal(report.counts["pre-existing"], 1);
    assert.equal(report.counts.passing, 1);
    assert.equal(report.prNumber, 42);
  });
});

describe("mapStatuses", () => {
  it("maps legacy commit statuses into check run shape", () => {
    const mapped = mapStatuses([
      { context: "security/snyk", state: "success", target_url: "https://snyk.example" },
      { context: "ci/old", state: "failure" },
      { context: "ci/pending", state: "pending" },
      { state: "success" },
    ]);
    assert.equal(mapped.length, 3);
    assert.equal(mapped[0].conclusion, "success");
    assert.equal(mapped[0].status, "completed");
    assert.equal(mapped[1].conclusion, "failure");
    assert.equal(mapped[2].status, "in_progress");
    assert.equal(mapped[2].conclusion, null);
  });

  it("statuses-only head (Actions never ran): base failures stay indeterminate", () => {
    // Bruno fork PR shape: head has app statuses (Snyk, CodeRabbit) but
    // zero check runs because the suites wait on maintainer approval.
    const head = mapStatuses([{ context: "security/snyk", state: "success" }]);
    const v = classifyRuns(
      head,
      [run("unit", "failure"), run("security/snyk", "success")],
      0,
    );
    assert.equal(byName(v, "unit")?.category, "indeterminate");
    assert.equal(byName(v, "security/snyk")?.category, "passing");
  });

  it("a real check run wins dedupe over a same-name status", () => {
    const status = mapStatuses([{ context: "build", state: "failure" }]);
    const real = run("build", "success");
    const v = classifyRuns([...status, real], [run("build", "success")]);
    assert.equal(byName(v, "build")?.category, "passing");
  });
});

describe("isExternalName", () => {
  it("matches deploy and hosted surfaces case-insensitively", () => {
    assert.equal(isExternalName("Vercel Preview"), true);
    assert.equal(isExternalName("netlify / deploy"), true);
    assert.equal(isExternalName("unit tests"), false);
  });
});
