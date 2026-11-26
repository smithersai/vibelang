import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { hostGap } from "../../test/durable-host-gap.mjs";

const smithersDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const cliPkg = path.join(smithersDir, "node_modules/@smthrs/cli/package.json");

function createProject(t) {
  const root = mkdtempSync(path.join(os.tmpdir(), "fuzz-campaign-test-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(path.join(root, "package.json"), "{}\n");
  cpSync(path.join(smithersDir, "flows/fuzz-campaign"), path.join(root, ".smithers/flows/fuzz-campaign"), { recursive: true });
  cpSync(path.join(smithersDir, "package.json"), path.join(root, ".smithers/package.json"));
  symlinkSync(path.join(smithersDir, "node_modules"), path.join(root, ".smithers/node_modules"));
  mkdirSync(path.join(root, ".flows"));
  return root;
}

function runSmthrs(root, ...args) {
  const { bin } = JSON.parse(readFileSync(cliPkg, "utf8"));
  const entry = path.join(path.dirname(cliPkg), typeof bin === "string" ? bin : bin.smthrs);
  const res = spawnSync(process.execPath, [entry, ...args, "--root", root, "--format", "json"], {
    cwd: root,
    encoding: "utf8",
    timeout: 180_000
  });
  return { status: res.status, stdout: res.stdout, stderr: res.stderr, json: () => JSON.parse(res.stdout) };
}

function createFixtureRepo(root, scriptBody) {
  const repo = path.join(root, "fixture-repo");
  mkdirSync(path.join(repo, "typescript/tsc/internal/vibelangfuzz"), { recursive: true });
  writeFileSync(path.join(repo, "typescript/tsc/internal/vibelangfuzz/campaign.sh"), scriptBody, { mode: 0o755 });
  return repo;
}

const twoCrashersScript = `#!/bin/sh
set -eu
mkdir -p "$CAMPAIGN_OUT/crashers/FuzzCompile" "$CAMPAIGN_OUT/crashers/FuzzParse"
printf 'crasher-input-1\\n' > "$CAMPAIGN_OUT/crashers/FuzzCompile/deadbeef01"
printf 'crasher-input-2\\n' > "$CAMPAIGN_OUT/crashers/FuzzParse/cafebabe02"
printf 'panic: nil pointer dereference in lower\\n' > "$CAMPAIGN_OUT/FuzzCompile.log"
printf 'panic: unexpected token in match arm\\n' > "$CAMPAIGN_OUT/FuzzParse.log"
printf 'FuzzCompile  1m  exit 1\\nFuzzParse  1m  exit 1\\n' > "$CAMPAIGN_OUT/summary.txt"
exit 1
`;

const brokenCampaignScript = `#!/bin/sh
echo "fatal: go toolchain missing before fuzzing" >&2
exit 2
`;

test("fuzz-campaign files two findings, records duplicates on repeat, and fails on broken campaign (#471)", (t) => {
  const root = createProject(t);
  const repo = createFixtureRepo(root, twoCrashersScript);
  const findings = path.join(root, "findings");

  // Run 1: two crashers -> two filed findings, resolved: true
  const run1 = path.join(root, "run-1");
  const start1 = runSmthrs(root, "flow", "start", "fuzz-campaign", "--data", JSON.stringify({
    run: run1,
    repo,
    findings,
    machine: [],
    duration: "5s"
  }));
  const gap = hostGap(start1.stdout + start1.stderr);
  if (gap) {
    t.skip(gap);
    return;
  }
  assert.equal(start1.status, 0, start1.stdout + start1.stderr);
  const report1 = JSON.parse(readFileSync(path.join(run1, "report.json"), "utf8"));
  assert.equal(report1.resolved, true);
  assert.equal(report1.crashers, 2);
  assert.equal(report1.filed, 2);
  assert.equal(report1.duplicates, 0);
  const index1 = JSON.parse(readFileSync(path.join(findings, "index.json"), "utf8"));
  assert.equal(Object.keys(index1).length, 2);
  for (const entry of Object.values(index1)) {
    assert.ok(existsSync(path.join(findings, entry.file)), `finding file exists: ${entry.file}`);
  }

  // Run 2: same two crashers -> recorded as duplicates, still resolved: true
  const run2 = path.join(root, "run-2");
  const start2 = runSmthrs(root, "flow", "start", "fuzz-campaign", "--data", JSON.stringify({
    run: run2,
    repo,
    findings,
    machine: [],
    duration: "5s"
  }));
  assert.equal(start2.status, 0, start2.stdout + start2.stderr);
  const report2 = JSON.parse(readFileSync(path.join(run2, "report.json"), "utf8"));
  assert.equal(report2.resolved, true);
  assert.equal(report2.crashers, 2);
  assert.equal(report2.filed, 0);
  assert.equal(report2.duplicates, 2);
  const duplicates = JSON.parse(readFileSync(path.join(findings, "duplicates.json"), "utf8"));
  assert.equal(duplicates.length, 2);

  // Run 3: campaign breaks before fuzzing -> fails the run with its log
  const brokenRepo = path.join(root, "broken-repo");
  mkdirSync(path.join(brokenRepo, "typescript/tsc/internal/vibelangfuzz"), { recursive: true });
  writeFileSync(path.join(brokenRepo, "typescript/tsc/internal/vibelangfuzz/campaign.sh"), brokenCampaignScript, { mode: 0o755 });
  const run3 = path.join(root, "run-3");
  const start3 = runSmthrs(root, "flow", "start", "fuzz-campaign", "--data", JSON.stringify({
    run: run3,
    repo: brokenRepo,
    findings,
    machine: [],
    duration: "5s"
  }));
  assert.equal(start3.json().status, "failed", start3.stdout + start3.stderr);
  assert.match(readFileSync(path.join(run3, "logs/campaign.log"), "utf8"), /go toolchain missing before fuzzing/);

  // Verify all three runs appear in smthrs runs list
  const runs = runSmthrs(root, "runs", "list", "--sort", "oldest");
  assert.equal(runs.status, 0, runs.stderr);
  assert.deepEqual(
    runs.json().items.map(({ flowId, status }) => ({ flowId, status })),
    [
      { flowId: "fuzz-campaign", status: "completed" },
      { flowId: "fuzz-campaign", status: "completed" },
      { flowId: "fuzz-campaign", status: "failed" }
    ]
  );
});
